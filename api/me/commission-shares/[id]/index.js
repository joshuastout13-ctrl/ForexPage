import { parseCookies, verifySession } from "../../../../../lib/auth.js";
import { supabase } from "../../../../../lib/supabase.js";

export default async function handler(req, res) {
  try {
    const cookies = parseCookies(req);
    const session = verifySession(cookies.scff_session);

    if (!session?.investorId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const { investorId } = session;
    const { id } = req.query;

    if (req.method === "PATCH") {
      const updates = req.body;

      // Verify ownership
      const { data: existing, error: getErr } = await supabase
        .from("commission_shares")
        .select("source_investor_id")
        .eq("id", id)
        .single();

      if (getErr || !existing) return res.status(404).json({ error: "Share not found" });
      if (String(existing.source_investor_id).toLowerCase() !== String(investorId).toLowerCase()) {
        return res.status(403).json({ error: "Forbidden" });
      }

      // Allowed fields to update by investor: commission_percent, effective_start_date, notes
      const allowedUpdates = {};
      if (updates.commission_percent !== undefined) allowedUpdates.commission_percent = updates.commission_percent;
      if (updates.effective_start_date !== undefined) allowedUpdates.effective_start_date = updates.effective_start_date;
      if (updates.notes !== undefined) allowedUpdates.notes = updates.notes;
      allowedUpdates.updated_at = new Date();

      const { data, error } = await supabase
        .from("commission_shares")
        .update(allowedUpdates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return res.status(200).json({ share: data });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    console.error("[Commission Shares [id] API]", error);
    res.status(500).json({ error: error.message || "Internal server error" });
  }
}
