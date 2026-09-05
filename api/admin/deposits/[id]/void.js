import { verifyAdminSession } from "../../../../lib/adminAuth.js";
import { supabase } from "../../../../lib/supabase.js";
import { assertAuthoritativeProductionDb, assertAuditActor } from "../../../../lib/financial-mutation-guard.js";

export default async function handler(req, res) {
  const session = verifyAdminSession(req);
  if (!session) return res.status(401).json({ error: "Unauthorized" });

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: "Missing deposit ID" });

  if (req.method === "POST") {
    try {
      await assertAuthoritativeProductionDb("void_deposit");
      const auditActor = assertAuditActor(session?.adminId || session?.userId || req.body?.updated_by, "void_deposit");

      // Mark type as VOID
      const updates = {
         type: "VOID",
         updated_at: new Date().toISOString()
      };

      const { data, error } = await supabase.from("deposits").update(updates).eq("id", id).select();
      if (error) throw error;

      return res.status(200).json({ success: true, deposit: data[0] });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  res.status(405).json({ error: "Method not allowed" });
}
