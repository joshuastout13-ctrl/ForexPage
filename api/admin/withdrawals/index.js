import { verifyAdminSession } from "../../../lib/adminAuth.js";
import { supabase } from "../../../lib/supabase.js";
import { calculateAvailableWithdrawalEquity } from "../../../lib/withdrawal-validation.js";
import crypto from "node:crypto";

export default async function handler(req, res) {
  const session = verifyAdminSession(req);
  if (!session) return res.status(401).json({ error: "Unauthorized" });

  if (req.method === "GET") {
    try {
      const { data, error } = await supabase.from("withdrawals").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return res.status(200).json({ withdrawals: data });
    } catch (error) {
      return res.status(500).json({ error: "Failed to retrieve withdrawals." });
    }
  }

  if (req.method === "POST") {
    try {
      const body = req.body || {};
      const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

      let monthIdx = 1;
      let monthName = "Jan";
      if (typeof body.month === 'string') {
        monthName = body.month;
        const found = monthNames.indexOf(body.month);
        monthIdx = found !== -1 ? found + 1 : 1;
      } else if (typeof body.month === 'number') {
        monthIdx = body.month;
        monthName = monthNames[monthIdx - 1] || "Jan";
      }

      const year = parseInt(body.year, 10) || new Date().getFullYear();
      let rawEffDate = body.effective_accounting_date || body.effectiveAccountingDate || body.effectiveDate;
      if (rawEffDate) {
        const parts = String(rawEffDate).slice(0, 10).split('-');
        if (parts.length === 3) {
          rawEffDate = `${parts[0]}-${parts[1].padStart(2, '0')}-01`;
        }
      }
      const effDate = rawEffDate || `${year}-${String(monthIdx).padStart(2, '0')}-01`;

      // Validate Effective Date: Must be strictly first-of-month (YYYY-MM-01)
      if (!effDate || !/^\d{4}-\d{2}-01$/.test(effDate)) {
        return res.status(400).json({
          error: `INVALID_EFFECTIVE_DATE: Effective date must be the first day of the month ('YYYY-MM-01'). Received: ${effDate}`
        });
      }

      let investorId = body.investor_id || body.investorId;
      let accountId = body.account_id || body.accountId;

      // Auto-resolve investorId from accountId if missing
      if (!investorId && accountId) {
        const { data: acc } = await supabase.from("investor_accounts").select("investor_id").eq("id", accountId).single();
        if (acc && acc.investor_id) {
          investorId = acc.investor_id;
        }
      }
      // Auto-resolve accountId from investorId if missing
      if (investorId && !accountId) {
        const { data: accs } = await supabase.from("investor_accounts").select("id").eq("investor_id", investorId).limit(1);
        if (accs && accs.length > 0) {
          accountId = accs[0].id;
        }
      }

      const payload = {
        id: body.id || `wd_${crypto.randomBytes(4).toString("hex")}`,
        investor_id: investorId,
        account_id: accountId,
        amount: parseFloat(body.amount),
        request_date: body.request_date || body.requestDate || effDate,
        effective_accounting_date: effDate,
        year: year,
        month_number: monthIdx,
        month: monthName,
        status: body.status || "Pending",
        notes: body.notes || "",
        idempotency_key: body.idempotency_key || body.idempotencyKey || null,
        created_by: body.created_by || (session?.adminId || "admin")
      };

      if (!payload.investor_id || !payload.account_id) {
        return res.status(400).json({ error: "investorId and accountId are required" });
      }

      if (isNaN(payload.amount) || payload.amount <= 0) {
        return res.status(400).json({ error: "INVALID_AMOUNT: Amount must be strictly greater than $0.00" });
      }

      // 1. Authoritative Save Path: Invoke Atomic Database RPC (Under Investor Advisory Lock)
      try {
        const { data: rpcData, error: rpcError } = await supabase.rpc("create_withdrawal_atomic", {
          p_investor_id: payload.investor_id,
          p_account_id: payload.account_id,
          p_amount: payload.amount,
          p_effective_date: effDate,
          p_status: payload.status,
          p_notes: payload.notes,
          p_idempotency_key: payload.idempotency_key,
          p_created_by: payload.created_by
        });

        if (!rpcError && rpcData) {
          const isReplay = rpcData.status === "IDEMPOTENT_REPLAY";
          return res.status(isReplay ? 200 : 201).json({
            status: rpcData.status,
            withdrawal: rpcData.withdrawal,
            availableEquityBefore: rpcData.available_equity_before,
            availableEquityAfter: rpcData.available_equity_after,
            idempotency_replay: isReplay
          });
        }

        // Map RPC error codes to safe HTTP responses
        if (rpcError) {
          const msg = rpcError.message || "";
          if (msg.includes("WITHDRAWAL_EXCEEDS_AVAILABLE_EQUITY") ||
              msg.includes("INVALID_EFFECTIVE_DATE") ||
              msg.includes("INVALID_AMOUNT") ||
              msg.includes("INVALID_WITHDRAWAL_STATUS")) {
            return res.status(400).json({ error: msg });
          }
          if (msg.includes("ACCOUNTING_HISTORY_INCOMPLETE") ||
              msg.includes("ACCOUNT_START_DATE_CONFLICT") ||
              msg.includes("IDEMPOTENCY_KEY_PAYLOAD_MISMATCH")) {
            return res.status(409).json({ error: msg });
          }
          if (msg.includes("INVESTOR_NOT_FOUND")) {
            return res.status(404).json({ error: msg });
          }
          // If RPC is missing in DB (42883 undefined_function), fall through to application-level validation
          if (!msg.includes("does not exist") && rpcError.code !== "42883") {
            throw rpcError;
          }
        }
      } catch (rpcEx) {
        if (!rpcEx.message?.includes("does not exist")) {
          throw rpcEx;
        }
      }

      // 2. Application-Level Fallback (when RPC is not yet installed in target database)
      if (payload.idempotency_key) {
        const { data: existingWd } = await supabase
          .from("withdrawals")
          .select("*")
          .eq("idempotency_key", payload.idempotency_key)
          .single();

        if (existingWd) {
          if (existingWd.investor_id === payload.investor_id && Math.abs(existingWd.amount - payload.amount) < 0.01) {
            return res.status(200).json({
              status: "IDEMPOTENT_REPLAY",
              withdrawal: existingWd,
              idempotency_replay: true
            });
          } else {
            return res.status(409).json({
              error: `IDEMPOTENCY_KEY_PAYLOAD_MISMATCH: Key ${payload.idempotency_key} conflict`
            });
          }
        }
      }

      const { availableEquity } = await calculateAvailableWithdrawalEquity(payload.investor_id, effDate, {
        accountId: payload.account_id
      });

      if (payload.amount > availableEquity) {
        return res.status(400).json({
          error: `WITHDRAWAL_EXCEEDS_AVAILABLE_EQUITY: Requested amount ($${payload.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}) exceeds available account equity ($${availableEquity.toLocaleString('en-US', { minimumFractionDigits: 2 })}) at effective date ${effDate}.`,
          availableEquity,
          requestedAmount: payload.amount,
          effectiveDate: effDate
        });
      }

      let insertRes = await supabase.from("withdrawals").insert([payload]).select();
      if (insertRes.error && insertRes.error.message && insertRes.error.message.includes("effective_accounting_date")) {
        const fallbackPayload = { ...payload };
        delete fallbackPayload.effective_accounting_date;
        insertRes = await supabase.from("withdrawals").insert([fallbackPayload]).select();
      }
      if (insertRes.error) throw insertRes.error;

      return res.status(201).json({
        status: "SUCCESS",
        withdrawal: insertRes.data[0],
        availableEquityBefore: availableEquity,
        availableEquityAfter: availableEquity - payload.amount,
        idempotency_replay: false
      });
    } catch (error) {
      console.error("Error creating withdrawal:", error);
      return res.status(400).json({ error: error.message || "Withdrawal creation failed." });
    }
  }

  res.setHeader("Allow", ["GET", "POST"]);
  return res.status(405).json({ error: "Method not allowed" });
}
