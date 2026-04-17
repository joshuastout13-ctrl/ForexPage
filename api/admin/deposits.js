import { verifyAdminSession } from "../../lib/adminAuth.js";
import { supabase } from "../../lib/supabase.js";
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
      
      const payload = {
        id: `dep_${crypto.randomBytes(4).toString("hex")}`,
        investor_id: body.investorId,
        account_id: body.accountId,
        date: body.date || new Date().toISOString().split('T')[0],
        amount: Number(body.amount || 0),
        type: body.type || "Deposit", // Deposit, Initial, etc
        notes: body.notes || ""
      };

      if (!payload.investor_id || !payload.account_id) throw new Error("investorId and accountId are required");

      const { data, error } = await supabase.from("deposits").insert([payload]).select();
      if (error) throw error;

      return res.status(200).json({ success: true, deposit: data[0] });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  res.status(405).json({ error: "Method not allowed" });
}
