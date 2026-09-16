import { verifyAdminSession } from "../../../lib/adminAuth.js";
import { supabase } from "../../../lib/supabase.js";
import { assertAuthoritativeProductionDb, assertAuditActor } from "../../../lib/financial-mutation-guard.js";

/**
 * Admin Deposit API — Edit single deposit
 *
 * PATCH /api/admin/deposits/[id]
 *
 * Supports updating: investor_id, account_id, date, effective_accounting_date,
 * amount, type, notes, accounting_treatment, status.
 *
 * Physical DELETE is permanently blocked (HTTP 405) — use the /void endpoint instead.
 */
export default async function handler(req, res) {
  const session = verifyAdminSession(req);
  if (!session) return res.status(401).json({ error: "Unauthorized" });

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: "Missing deposit ID" });

  // ─── PATCH / PUT: Edit deposit ────────────────────────────────────────────
  if (req.method === "PATCH" || req.method === "PUT") {
    try {
      await assertAuthoritativeProductionDb("update_deposit");
      const auditActor = assertAuditActor(
        session?.adminId || session?.userId || req.body?.updated_by,
        "update_deposit"
      );

      const body = req.body || {};
      const updates = {};

      // ── Resolve investor/account ──────────────────────────────────────────
      let investorId = body.investorId || body.investor_id;
      let accountId = body.accountId || body.account_id;

      if (!investorId && accountId) {
        const { data: acc } = await supabase
          .from("investor_accounts")
          .select("investor_id")
          .eq("id", accountId)
          .single();
        if (acc?.investor_id) investorId = acc.investor_id;
      }

      if (investorId !== undefined) updates.investor_id = investorId;
      if (accountId !== undefined) updates.account_id = accountId;
      if (body.date !== undefined) updates.date = body.date;
      if (body.effectiveAccountingDate !== undefined || body.effective_accounting_date !== undefined) {
        updates.effective_accounting_date = body.effectiveAccountingDate || body.effective_accounting_date;
      }
      if (body.amount !== undefined) {
        const amt = Number(body.amount);
        if (isNaN(amt) || amt <= 0) {
          return res.status(400).json({ error: "INVALID_AMOUNT: Amount must be strictly greater than $0.00" });
        }
        updates.amount = amt;
      }
      if (body.type !== undefined) updates.type = body.type;
      if (body.notes !== undefined) updates.notes = body.notes;

      // ── accounting_treatment validation ───────────────────────────────────
      if (body.accounting_treatment !== undefined || body.accountingTreatment !== undefined) {
        const ALLOWED_TREATMENTS = ["NEW_CASH", "HISTORICAL_PROVENANCE"];
        const rawTreatment = String(
          body.accounting_treatment || body.accountingTreatment || "NEW_CASH"
        ).toUpperCase();
        if (!ALLOWED_TREATMENTS.includes(rawTreatment)) {
          return res.status(400).json({
            error: `INVALID_ACCOUNTING_TREATMENT: '${rawTreatment}' is not allowed. ` +
              `Must be one of: ${ALLOWED_TREATMENTS.join(", ")}.`
          });
        }
        updates.accounting_treatment = rawTreatment;
      }

      // ── status validation (PATCH can move to 'cancelled'; voiding uses /void) ──
      if (body.status !== undefined) {
        const ALLOWED_STATUSES = ["confirmed", "cancelled"];
        const rawStatus = String(body.status).toLowerCase();
        if (!ALLOWED_STATUSES.includes(rawStatus)) {
          return res.status(400).json({
            error: `INVALID_STATUS_TRANSITION: Cannot set status='${rawStatus}' via PATCH. ` +
              `Use /void endpoint to void a deposit. Allowed via PATCH: ${ALLOWED_STATUSES.join(", ")}.`
          });
        }
        updates.status = rawStatus;
      }

      // Always write updated_at and capture who made the change
      updates.updated_at = new Date().toISOString();

      const { data, error: updateErr } = await supabase
        .from("deposits")
        .update(updates)
        .eq("id", id)
        .select();

      if (updateErr) throw updateErr;

      return res.status(200).json({ success: true, deposit: data[0] });
    } catch (err) {
      const isAuthDbUnavailable = String(err?.message || "").includes("AUTHORITATIVE_PRODUCTION_DB_UNAVAILABLE");
      return res.status(isAuthDbUnavailable ? 503 : 500).json({ error: err.message });
    }
  }

  // ─── DELETE: Permanently blocked ─────────────────────────────────────────
  if (req.method === "DELETE") {
    res.setHeader("Allow", ["PATCH", "PUT"]);
    return res.status(405).json({
      error: "METHOD_NOT_ALLOWED: Physical deletion of financial deposit records is permanently " +
        "disabled to preserve ledger audit integrity. " +
        "Void the record via POST /api/admin/deposits/[id]/void or " +
        "cancel it via PATCH /api/admin/deposits/[id] with status='cancelled'."
    });
  }

  res.setHeader("Allow", ["PATCH", "PUT"]);
  res.status(405).json({ error: "Method not allowed" });
}
