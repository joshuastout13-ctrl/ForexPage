import { verifyAdminSession } from "../../../../lib/adminAuth.js";
import { supabase } from "../../../../lib/supabase.js";

export default async function handler(req, res) {
  const session = verifyAdminSession(req);
  if (!session) return res.status(401).json({ error: "Unauthorized" });

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: "Missing withdrawal ID" });

  if (req.method === "PATCH") {
    try {
      const body = req.body || {};
      const updates = {};
      
      if (body.investorId !== undefined) updates.investor_id = body.investorId;
      if (body.accountId !== undefined) updates.account_id = body.accountId;
      if (body.requestDate !== undefined) updates.request_date = body.requestDate;
      if (body.year !== undefined) updates.year = Number(body.year);
      if (body.monthNumber !== undefined) updates.month_number = Number(body.monthNumber);
      if (body.month !== undefined) updates.month = body.month;
      if (body.amount !== undefined) updates.amount = Number(body.amount);
      if (body.status !== undefined) updates.status = body.status;
      if (body.notes !== undefined) updates.notes = body.notes;

      const { data, error } = await supabase.from("withdrawals").update(updates).eq("id", id).select();
      if (error) throw error;

      return res.status(200).json({ success: true, withdrawal: data[0] });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  res.status(405).json({ error: "Method not allowed" });
}
