import { verifyAdminSession } from "../../../lib/adminAuth.js";
import { supabase } from "../../../lib/supabase.js";

export default async function handler(req, res) {
  const session = verifyAdminSession(req);
  if (!session) return res.status(401).json({ error: "Unauthorized" });

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: "Missing investor ID" });

  if (req.method === "PATCH") {
    try {
      const body = req.body || {};
      const updates = {};
      
      if (body.firstName !== undefined) updates.first_name = body.firstName;
      if (body.lastName !== undefined) updates.last_name = body.lastName;
      if (body.email !== undefined) updates.email = body.email;
      if (body.portalUsername !== undefined) updates.portal_username = body.portalUsername;
      if (body.tempPassword !== undefined) updates.temp_password = body.tempPassword;
      if (body.splitPct !== undefined) updates.split_pct = Number(body.splitPct);
      if (body.monthlyDraw !== undefined) updates.monthly_draw = Number(body.monthlyDraw);
      if (body.startDate !== undefined) updates.start_date = body.startDate;
      if (body.role !== undefined) updates.role = body.role;
      if (body.notes !== undefined) updates.notes = body.notes;

      // Update investors table
      const { data, error } = await supabase.from("investors").update(updates).eq("id", id).select();
      if (error) throw error;

      return res.status(200).json({ success: true, investor: data[0] });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  res.status(405).json({ error: "Method not allowed" });
}
