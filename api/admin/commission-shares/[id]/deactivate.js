import { verifyAdminSession } from "../../../../lib/adminAuth.js";
import { supabase } from "../../../../lib/supabase.js";

export default async function handler(req, res) {
  try {
    const session = verifyAdminSession(req);
    if (!session) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { id } = req.query;

    if (req.method === "POST") {
      const { data, error } = await supabase
        .from("commission_shares")
        .update({ 
          status: "cancelled",
          effective_end_date: new Date().toISOString().split('T')[0],
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
    console.error("[Admin Commission Shares Deactivate API]", error);
    res.status(500).json({ error: error.message || "Internal server error" });
  }
}
