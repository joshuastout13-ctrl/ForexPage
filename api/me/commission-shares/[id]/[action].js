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
    const { id, action } = req.query;

    if (req.method === "POST" && action === "end") {
      const { effective_end_date } = req.body;
      if (!effective_end_date) {
        return res.status(400).json({ error: "Missing effective_end_date" });
      }

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

      const { data, error } = await supabase
        .from("commission_shares")
        .update({ 
          effective_end_date, 
          status: "ended",
          updated_at: new Date()
        })
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
