import { verifyAdminSession } from "../../../../lib/adminAuth.js";
import { supabase } from "../../../../lib/supabase.js";

export default async function handler(req, res) {
  try {
    const session = verifyAdminSession(req);
    if (!session) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { id, action } = req.query;

    if (req.method === "POST" && action === "deactivate") {
      const { data, error } = await supabase
        .from("commission_shares")
        .update({ 
          status: "cancelled",
          effective_end_date: new Date(),
          updated_at: new Date()
        })
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return res.status(200).json({ share: data });
    }
    
    if (req.method === "POST" && action === "reactivate") {
      const { data, error } = await supabase
        .from("commission_shares")
        .update({ 
          status: "active",
          effective_end_date: null,
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
    console.error("[Admin Commission Shares [action] API]", error);
    res.status(500).json({ error: error.message || "Internal server error" });
  }
}
