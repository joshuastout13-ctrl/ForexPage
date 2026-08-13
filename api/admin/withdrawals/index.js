import { verifyAdminSession } from "../../../lib/adminAuth.js";
import { supabase } from "../../../lib/supabase.js";
import crypto from "node:crypto";

export default async function handler(req, res) {
  const session = verifyAdminSession(req);
  if (!session) return res.status(401).json({ error: "Unauthorized" });

  if (req.method === "GET") {
    try {
      const { data, error } = await supabase.from("withdrawals").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return res.status(200).json({ withdrawals: data });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === "POST") {
    try {
      const body = req.body || {};
      const entryDate = body.requestDate || body.date || new Date().toISOString().split('T')[0];
      let effDate = body.effectiveAccountingDate || body.effective_accounting_date;

      if (!effDate) {
        const dt = new Date(entryDate);
        const y = dt.getUTCFullYear();
        const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
        effDate = `${y}-${m}-01`;
      }

      if (!effDate.endsWith("-01")) {
        throw new Error("INVALID_EFFECTIVE_DATE: Effective accounting date must be the 1st day of the month (e.g. YYYY-MM-01).");
      }
      
      const payload = {
        id: `wd_${crypto.randomBytes(4).toString("hex")}`,
        investor_id: body.investorId,
        account_id: body.accountId,
        request_date: entryDate,
        effective_accounting_date: effDate,
        year: Number(body.year || new Date().getFullYear()),
        month_number: Number(body.monthNumber || new Date().getMonth() + 1),
        month: body.month || "Unknown",
        amount: Number(body.amount || 0),
        status: body.status || "Pending", // Pending, Approved, Completed, Cancelled
        notes: body.notes || ""
      };

      if (!payload.investor_id || !payload.account_id) throw new Error("investorId and accountId are required");

      const { data, error } = await supabase.from("withdrawals").insert([payload]).select();
      if (error) throw error;

      return res.status(200).json({ success: true, withdrawal: data[0] });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  res.status(405).json({ error: "Method not allowed" });
}
