import { verifyAdminSession } from "../../lib/adminAuth.js";
import { supabase } from "../../lib/supabase.js";
import crypto from "node:crypto";

export default async function handler(req, res) {
  const session = verifyAdminSession(req);
  if (!session) return res.status(401).json({ error: "Unauthorized" });

  if (req.method === "GET") {
    try {
      const { data, error } = await supabase.from("investor_accounts").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return res.status(200).json({ accounts: data });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === "POST") {
    try {
      const body = req.body || {};
      
      const newId = body.id || `acc_${crypto.randomBytes(4).toString("hex")}`;
      
      const payload = {
        id: newId,
        investor_id: body.investorId,
        name: body.name || "Main Account",
        starting_capital: Number(body.startingCapital || 0),
        total_cash_in: Number(body.totalCashIn || 0),
        open_date: body.openDate || new Date().toISOString().split('T')[0],
        status: body.status || "Active",
        notes: body.notes || ""
      };

      if (!payload.investor_id) throw new Error("Missing required field: investorId");

      const { data, error } = await supabase.from("investor_accounts").insert([payload]).select();
      if (error) throw error;

      return res.status(200).json({ success: true, account: data[0] });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  res.status(405).json({ error: "Method not allowed" });
}
