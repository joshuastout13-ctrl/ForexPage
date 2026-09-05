import { verifyAdminSession } from "../../../lib/adminAuth.js";
import { supabase } from "../../../lib/supabase.js";
import { calculateAvailableWithdrawalEquity } from "../../../lib/withdrawal-validation.js";
import { assertAuthoritativeProductionDb, assertAuditActor, buildDeterministicIdempotencyKey } from "../../../lib/financial-mutation-guard.js";
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
      // 0. Fail-closed Authoritative DB and Audit Actor Preconditions
      await assertAuthoritativeProductionDb("create_withdrawal");
      const auditActor = assertAuditActor(session?.adminId || session?.userId || req.body?.created_by, "create_withdrawal");

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

      const numAmount = parseFloat(body.amount);
      let idempotencyKey = body.idempotency_key || body.idempotencyKey || null;

      // Construct canonical deterministic key if correction purpose is provided and no explicit key supplied
      if (!idempotencyKey && (body.purpose || body.is_correction)) {
        idempotencyKey = buildDeterministicIdempotencyKey({
          type: "withdrawal",
          investorId: investorId || "unknown",
          effectiveDate: effDate,
          amountCents: Math.round(numAmount * 100),
          purpose: body.purpose || "authorized_correction"
        });
      }

      const payload = {
        id: body.id || `wd_${crypto.randomBytes(4).toString("hex")}`,
        investor_id: investorId,
        account_id: accountId,
        amount: numAmount,
        request_date: body.request_date || body.requestDate || effDate,
        effective_accounting_date: effDate,
        year: year,
        month_number: monthIdx,
        month: monthName,
        status: body.status || "Pending",
        notes: body.notes || "",
        idempotency_key: idempotencyKey,
        created_by: auditActor
      };

      if (!payload.investor_id || !payload.account_id) {
        return res.status(400).json({ error: "investorId and accountId are required" });
      }

      if (isNaN(payload.amount) || payload.amount <= 0) {
        return res.status(400).json({ error: "INVALID_AMOUNT: Amount must be strictly greater than $0.00" });
      }

      if (!supabase) {
        return res.status(503).json({
          error: "PACKAGE_B_RPC_UNAVAILABLE: Database client is not configured. Raw financial mutation blocked."
        });
      }

      // 1. Authoritative Save Path: Invoke Atomic Database RPC (Under Investor Advisory Lock)
      try {
        const allowDuplicateAmount = Boolean(body.allow_duplicate_amount || body.allowDuplicateAmount);
        const { data: rpcData, error: rpcError } = await supabase.rpc("create_withdrawal_atomic", {
          p_investor_id: payload.investor_id,
          p_account_id: payload.account_id,
          p_amount: payload.amount,
          p_effective_date: effDate,
          p_status: payload.status,
          p_notes: payload.notes,
          p_idempotency_key: payload.idempotency_key,
          p_created_by: payload.created_by,
          p_allow_duplicate_amount: allowDuplicateAmount
        });

        if (!rpcError && rpcData) {
          if (rpcData.status === "DUPLICATE_ECONOMIC_TRANSACTION") {
            return res.status(409).json({
              error: rpcData.error || "DUPLICATE_ECONOMIC_TRANSACTION: Duplicate active withdrawal already exists for this investor and effective date.",
              code: "DUPLICATE_ECONOMIC_TRANSACTION",
              existing_withdrawal_id: rpcData.existing_withdrawal_id,
              existing_withdrawal_status: rpcData.existing_withdrawal_status,
              existing_idempotency_key: rpcData.existing_idempotency_key,
              amount: rpcData.amount,
              effective_accounting_date: rpcData.effective_accounting_date
            });
          }

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
          if (msg.includes("DUPLICATE_ECONOMIC_TRANSACTION")) {
            return res.status(409).json({ error: msg, code: "DUPLICATE_ECONOMIC_TRANSACTION" });
          }
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

          const isMissingRpc = !msg || 
            msg.includes("does not exist") || 
            msg.includes("schema cache") || 
            msg.includes("Could not find the function") || 
            rpcError.code === "42883" || 
            rpcError.code === "PGRST202";

          if (isMissingRpc) {
            return res.status(503).json({
              error: "PACKAGE_B_RPC_UNAVAILABLE: Database concurrency control function (create_withdrawal_atomic) is not installed or unavailable in the target database. Raw financial insertion is blocked."
            });
          }

          return res.status(400).json({ error: msg });
        }
      } catch (rpcEx) {
        const exMsg = rpcEx.message || "";
        const isMissingRpc = exMsg.includes("does not exist") || 
          exMsg.includes("schema cache") || 
          exMsg.includes("Could not find the function") || 
          rpcEx.code === "42883" || 
          rpcEx.code === "PGRST202";

        if (isMissingRpc) {
          return res.status(503).json({
            error: "PACKAGE_B_RPC_UNAVAILABLE: Database concurrency control function (create_withdrawal_atomic) is not installed or unavailable in the target database. Raw financial insertion is blocked."
          });
        }

        return res.status(400).json({ error: exMsg || "Withdrawal creation failed." });
      }

      return res.status(503).json({
        error: "PACKAGE_B_RPC_UNAVAILABLE: Unable to complete atomic withdrawal creation."
      });
    } catch (error) {
      console.error("Error creating withdrawal:", error);
      const isAuthDbUnavailable = String(error?.message || "").includes("AUTHORITATIVE_PRODUCTION_DB_UNAVAILABLE");
      return res.status(isAuthDbUnavailable ? 503 : 400).json({ error: error.message || "Withdrawal creation failed." });
    }
  }

  res.setHeader("Allow", ["GET", "POST"]);
  return res.status(405).json({ error: "Method not allowed" });
}
