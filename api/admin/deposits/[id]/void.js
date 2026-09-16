import { verifyAdminSession } from "../../../../lib/adminAuth.js";
import { supabase } from "../../../../lib/supabase.js";
import { assertAuthoritativeProductionDb, assertAuditActor } from "../../../../lib/financial-mutation-guard.js";

/**
 * Admin Deposit Void API
 *
 * POST /api/admin/deposits/[id]/void
 *
 * Marks a deposit as void WITHOUT physically deleting it.
 * Maintains full audit trail: voided_at, voided_by, void_reason.
 *
 * A voided deposit:
 * - Is excluded from Total Deposits (calculateTotalExternalCash)
 * - Is excluded from balance-affecting calculations (calculateBalanceAffectingDeposits)
 * - Remains permanently in the ledger for audit purposes
 *
 * Body (optional):
 *   void_reason  — text description of why the deposit was voided
 */
export default async function handler(req, res) {
  const session = verifyAdminSession(req);
  if (!session) return res.status(401).json({ error: "Unauthorized" });

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: "Missing deposit ID" });

  if (req.method === "POST") {
    try {
      await assertAuthoritativeProductionDb("void_deposit");
      const auditActor = assertAuditActor(
        session?.adminId || session?.userId || req.body?.voided_by,
        "void_deposit"
      );

      const now = new Date().toISOString();

      // Verify the deposit exists and is not already voided
      const { data: existing, error: fetchErr } = await supabase
        .from("deposits")
        .select("id, status, type, amount, investor_id")
        .eq("id", id)
        .single();

      if (fetchErr || !existing) {
        return res.status(404).json({ error: `Deposit not found: ${id}` });
      }

      const currentStatus = String(existing.status || "").toLowerCase();
      const currentType = String(existing.type || "").toUpperCase();

      if (currentStatus === "void" || currentType === "VOID") {
        return res.status(409).json({
          error: `ALREADY_VOIDED: Deposit ${id} is already voided. No action taken.`,
          deposit: existing
        });
      }

      // Apply void — set both legacy type='VOID' and new status='void' for full compatibility
      const updates = {
        type: "VOID",           // backward-compat: existing queries check type='VOID'
        status: "void",         // new: schema_update_v5 status column
        voided_at: now,
        voided_by: auditActor,
        void_reason: req.body?.void_reason || null,
        updated_at: now
      };

      const { data, error: updateErr } = await supabase
        .from("deposits")
        .update(updates)
        .eq("id", id)
        .select();

      if (updateErr) throw updateErr;

      return res.status(200).json({
        success: true,
        message: `Deposit ${id} has been voided. It will no longer count toward Total Deposits or accounting balances.`,
        deposit: data[0]
      });
    } catch (err) {
      const isAuthDbUnavailable = String(err?.message || "").includes("AUTHORITATIVE_PRODUCTION_DB_UNAVAILABLE");
      return res.status(isAuthDbUnavailable ? 503 : 500).json({ error: err.message });
    }
  }

  res.status(405).json({ error: "Method not allowed. Use POST to void a deposit." });
}
