import { verifyAdminSession } from "../../../lib/adminAuth.js";
import { supabase } from "../../../lib/supabase.js";
import crypto from "node:crypto";

export default async function handler(req, res) {
  const session = verifyAdminSession(req);
  if (!session) return res.status(401).json({ error: "Unauthorized" });

  if (req.method === "GET") {
    try {
      const { data, error } = await supabase.from("deposits").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return res.status(200).json({ deposits: data });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === "POST") {
    try {
      const body = req.body || {};
      const entryDate = body.date || new Date().toISOString().split('T')[0];
      let effDate = body.effectiveAccountingDate || body.effective_accounting_date;
      
      if (effDate) {
        const parts = String(effDate).slice(0, 10).split('-');
        if (parts.length === 3) {
          effDate = `${parts[0]}-${parts[1].padStart(2, '0')}-01`;
        }
      } else {
        const dt = new Date(entryDate);
        const y = dt.getUTCFullYear();
        const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
        effDate = `${y}-${m}-01`;
      }

      let investorId = body.investorId || body.investor_id;
      let accountId = body.accountId || body.account_id;

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

      if (!investorId || !accountId) {
        throw new Error("investorId and accountId are required");
      }

      const payload = {
        id: body.id || `dep_${crypto.randomBytes(4).toString("hex")}`,
        investor_id: investorId,
        account_id: accountId,
        date: entryDate,
        effective_accounting_date: effDate,
        amount: Number(body.amount || 0),
        type: body.type || "Deposit",
        notes: body.notes || ""
      };

      if (isNaN(payload.amount) || payload.amount <= 0) {
        throw new Error("INVALID_AMOUNT: Amount must be strictly greater than $0.00");
      }

      let insertRes = await supabase.from("deposits").insert([payload]).select();
      if (insertRes.error) {
        // Fallback if effective_accounting_date column does not exist in target table
        if (insertRes.error.message && insertRes.error.message.includes("effective_accounting_date")) {
          const fallbackPayload = { ...payload };
          delete fallbackPayload.effective_accounting_date;
          insertRes = await supabase.from("deposits").insert([fallbackPayload]).select();
        }
      }
      if (insertRes.error) throw insertRes.error;

      return res.status(200).json({ success: true, deposit: insertRes.data[0] });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  res.setHeader("Allow", ["GET", "POST"]);
  res.status(405).json({ error: "Method not allowed" });
}
