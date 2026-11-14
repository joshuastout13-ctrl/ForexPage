import { verifyAdminSession } from "../../../../lib/adminAuth.js";
import { supabase } from "../../../../lib/supabase.js";

export default async function handler(req, res) {
  const session = verifyAdminSession(req);
  if (!session) return res.status(401).json({ error: "Unauthorized" });

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: "Missing investor ID" });

  if (req.method === "POST") {
    try {
      const { action } = req.body || {};
      
      if (action !== "deactivate" && action !== "reactivate") {
        return res.status(400).json({ error: "Invalid action. Use 'deactivate' or 'reactivate'" });
      }

      const active = action === "reactivate";

      const updates = {
         active: active
      };

      const { data, error } = await supabase.from("investors").update(updates).eq("id", id).select();
      if (error) throw error;

      const updatedInv = data && data[0];
      const targetAccountStatus = active ? "Active" : "Inactive";
      const matchIds = [id, updatedInv?.portal_username].filter(Boolean);
      const { error: accSyncErr } = await supabase
        .from("investor_accounts")
        .update({ status: targetAccountStatus })
        .in("investor_id", matchIds);

      if (accSyncErr) throw accSyncErr;

      return res.status(200).json({ success: true, investor: updatedInv, accountStatusSynced: targetAccountStatus });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  res.status(405).json({ error: "Method not allowed" });
}
