import { verifyAdminSession } from "../../lib/adminAuth.js";
import { supabase } from "../../lib/supabase.js";

export default async function handler(req, res) {
  const session = verifyAdminSession(req);
  if (!session) return res.status(401).json({ error: "Unauthorized" });

  if (req.method === "GET") {
    try {
      const { data, error } = await supabase.from("live_performance").select("*").order("updated_at", { ascending: false });
      if (error) throw error;
      return res.status(200).json({ livePerformance: data });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === "PATCH") {
    try {
      const body = req.body || {};
      const { metric } = body;
      
      if (!metric) throw new Error("metric column is required to update live performance");

      const updates = {};
      if (body.valuePct !== undefined) updates.value_pct = Number(body.valuePct);
      if (body.source !== undefined) updates.source = body.source;
      if (body.isOverride !== undefined) updates.is_override = Boolean(body.isOverride);
      if (body.notes !== undefined) updates.notes = body.notes;
      updates.updated_at = new Date().toISOString();
      updates.last_updated = new Date().toISOString();

      const { data, error } = await supabase.from("live_performance").update(updates).eq("metric", metric).select();
      if (error) throw error;

      return res.status(200).json({ success: true, livePerformanceItem: data[0] });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  res.status(405).json({ error: "Method not allowed" });
}
