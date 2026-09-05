import { verifyAdminSession } from "../../../lib/adminAuth.js";
import { supabase } from "../../../lib/supabase.js";
import { assertAuthoritativeProductionDb, assertAuditActor } from "../../../lib/financial-mutation-guard.js";

export default async function handler(req, res) {
  const session = verifyAdminSession(req);
  if (!session) return res.status(401).json({ error: "Unauthorized" });

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: "Missing deposit ID" });

  if (req.method === "PATCH" || req.method === "PUT") {
    try {
      await assertAuthoritativeProductionDb("update_deposit");
      const auditActor = assertAuditActor(session?.adminId || session?.userId || req.body?.updated_by, "update_deposit");

      const body = req.body || {};
      const updates = {};
      
      let investorId = body.investorId || body.investor_id;
      let accountId = body.accountId || body.account_id;

      if (!investorId && accountId) {
        const { data: acc } = await supabase.from("investor_accounts").select("investor_id").eq("id", accountId).single();
        if (acc && acc.investor_id) investorId = acc.investor_id;
      }

      if (investorId !== undefined) updates.investor_id = investorId;
      if (accountId !== undefined) updates.account_id = accountId;
      if (body.date !== undefined) updates.date = body.date;
      if (body.effectiveAccountingDate !== undefined || body.effective_accounting_date !== undefined) {
        updates.effective_accounting_date = body.effectiveAccountingDate || body.effective_accounting_date;
      }
      if (body.amount !== undefined) updates.amount = Number(body.amount);
      if (body.type !== undefined) updates.type = body.type;
      if (body.notes !== undefined) updates.notes = body.notes;

      let updateRes = await supabase.from("deposits").update(updates).eq("id", id).select();
      if (updateRes.error && updateRes.error.message && updateRes.error.message.includes("effective_accounting_date")) {
        delete updates.effective_accounting_date;
        updateRes = await supabase.from("deposits").update(updates).eq("id", id).select();
      }
      if (updateRes.error) throw updateRes.error;

      return res.status(200).json({ success: true, deposit: updateRes.data[0] });
    } catch (err) {
      const isAuthDbUnavailable = String(err?.message || "").includes("AUTHORITATIVE_PRODUCTION_DB_UNAVAILABLE");
      return res.status(isAuthDbUnavailable ? 503 : 500).json({ error: err.message });
    }
  }

  if (req.method === "DELETE") {
    res.setHeader("Allow", ["PATCH", "PUT"]);
    return res.status(405).json({
      error: "METHOD_NOT_ALLOWED: Physical deletion of financial deposit records is permanently disabled to preserve ledger audit integrity. Void the record via POST /api/admin/deposits/[id]/void or record an explicit ledger adjustment."
    });
  }

  res.setHeader("Allow", ["PATCH", "PUT"]);
  res.status(405).json({ error: "Method not allowed" });
}
