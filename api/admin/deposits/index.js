import { verifyAdminSession } from "../../../lib/adminAuth.js";
import { supabase } from "../../../lib/supabase.js";
import {
  assertAuthoritativeProductionDb,
  assertAuditActor,
  buildDeterministicIdempotencyKey
} from "../../../lib/financial-mutation-guard.js";
import crypto from "node:crypto";

/**
 * Admin Deposit API — Create & List
 *
 * POST /api/admin/deposits
 *
 * REQUIRED FIELDS:
 *   investorId / investor_id — target investor
 *   accountId / account_id   — target account
 *   amount                   — positive dollar amount
 *   date                     — actual funding date (ISO date)
 *   accounting_treatment     — 'NEW_CASH' | 'HISTORICAL_PROVENANCE'
 *
 * OPTIONAL:
 *   effectiveAccountingDate  — first-of-month for accounting; computed from date if absent
 *   type                     — payment method label (Wire, Check, Cash, etc.)
 *   notes                    — free-text reference
 *   idempotency_key          — caller-provided deterministic key for duplicate prevention
 *
 * ACCOUNTING_TREATMENT SEMANTICS:
 *   NEW_CASH            -> cash that ADDS to the accounting balance (new or missed capital)
 *   HISTORICAL_PROVENANCE -> cash Josh confirms was received historically but whose
 *                           economic effect is ALREADY in the imported/cutover baseline.
 *                           Establishes Total Deposits provenance WITHOUT affecting balance.
 *
 * STATUS LIFECYCLE: confirmed -> void (via /void endpoint) | cancelled (via PATCH)
 * Physical DELETE is permanently blocked (HTTP 405).
 */
export default async function handler(req, res) {
  const session = verifyAdminSession(req);
  if (!session) return res.status(401).json({ error: "Unauthorized" });

  // ─── GET: List all deposits ───────────────────────────────────────────────
  if (req.method === "GET") {
    try {
      const { data, error } = await supabase
        .from("deposits")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return res.status(200).json({ deposits: data });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ─── POST: Create deposit ─────────────────────────────────────────────────
  if (req.method === "POST") {
    try {
      await assertAuthoritativeProductionDb("create_deposit");
      const auditActor = assertAuditActor(
        session?.adminId || session?.userId || req.body?.created_by,
        "create_deposit"
      );

      const body = req.body || {};

      // ── Validate accounting_treatment ─────────────────────────────────────
      const ALLOWED_TREATMENTS = ["NEW_CASH", "HISTORICAL_PROVENANCE", "UNVERIFIED_LEGACY"];
      const rawTreatment = String(body.accounting_treatment || body.accountingTreatment || "NEW_CASH").toUpperCase();
      if (!ALLOWED_TREATMENTS.includes(rawTreatment)) {
        return res.status(400).json({
          error: `INVALID_ACCOUNTING_TREATMENT: '${rawTreatment}' is not allowed. ` +
            `Must be one of: ${ALLOWED_TREATMENTS.join(", ")}. ` +
            `Use NEW_CASH for balance-affecting deposits, HISTORICAL_PROVENANCE for provenance-only records.`
        });
      }

      // ── Validate status ───────────────────────────────────────────────────
      const ALLOWED_STATUSES = ["confirmed", "void", "cancelled"];
      const rawStatus = String(body.status || "confirmed").toLowerCase();
      if (!ALLOWED_STATUSES.includes(rawStatus)) {
        return res.status(400).json({
          error: `INVALID_STATUS: '${rawStatus}' is not allowed. Must be one of: ${ALLOWED_STATUSES.join(", ")}.`
        });
      }

      // ── Resolve dates ─────────────────────────────────────────────────────
      const entryDate = body.date || new Date().toISOString().split("T")[0];
      let effDate = body.effectiveAccountingDate || body.effective_accounting_date;

      if (effDate) {
        const parts = String(effDate).slice(0, 10).split("-");
        if (parts.length === 3) {
          effDate = `${parts[0]}-${parts[1].padStart(2, "0")}-01`;
        }
      } else {
        const dt = new Date(entryDate);
        const y = dt.getUTCFullYear();
        const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
        effDate = `${y}-${m}-01`;
      }

      // ── Resolve investor + account ────────────────────────────────────────
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
      if (investorId && !accountId) {
        const { data: accs } = await supabase
          .from("investor_accounts")
          .select("id")
          .eq("investor_id", investorId)
          .limit(1);
        if (accs?.length > 0) accountId = accs[0].id;
      }

      if (!investorId || !accountId) {
        return res.status(400).json({ error: "investorId and accountId are required" });
      }

      // ── Validate amount ───────────────────────────────────────────────────
      const amount = Number(body.amount || 0);
      if (isNaN(amount) || amount <= 0) {
        return res.status(400).json({
          error: "INVALID_AMOUNT: Amount must be strictly greater than $0.00"
        });
      }
      const amountCents = Math.round(amount * 100);

      // ── Idempotency key ───────────────────────────────────────────────────
      // Every deposit (including NEW_CASH) MUST receive a non-null idempotency_key
      // so the database unique index idx_deposits_idempotency_key atomically
      // prevents duplicate economic inserts on concurrent/retried submissions.
      let idempotencyKey = body.idempotency_key || body.idempotencyKey || null;
      if (idempotencyKey) {
        // Normalize caller-provided key (e.g. client mutation UUID preserved across retries)
        idempotencyKey = String(idempotencyKey).trim().slice(0, 255);
      } else if (rawTreatment === "HISTORICAL_PROVENANCE") {
        // Historical provenance records MUST be idempotent — build deterministic key
        try {
          idempotencyKey = buildDeterministicIdempotencyKey({
            type: "deposit",
            investorId,
            effectiveDate: effDate,
            amountCents,
            purpose: `historical_provenance_${rawTreatment.toLowerCase()}`
          });
        } catch (keyErr) {
          return res.status(400).json({ error: `IDEMPOTENCY_KEY_ERROR: ${keyErr.message}` });
        }
      } else {
        // Fail-safe: NEVER allow ANY deposit row to have a NULL idempotency_key.
        idempotencyKey = `dep_mut_${crypto.randomUUID()}`;
      }

      // ── Build payload ─────────────────────────────────────────────────────
      const payload = {
        id: body.id || `dep_${crypto.randomBytes(4).toString("hex")}`,
        investor_id: investorId,
        account_id: accountId,
        date: entryDate,
        effective_accounting_date: effDate,
        amount,
        accounting_treatment: rawTreatment,
        status: rawStatus,
        type: body.type || "Wire",
        notes: body.notes || "",
        created_by: auditActor,
        updated_at: new Date().toISOString(),
        idempotency_key: idempotencyKey
      };

      // ── Insert with idempotency duplicate detection ───────────────────────
      const { data: inserted, error: insertErr } = await supabase
        .from("deposits")
        .insert([payload])
        .select();

      if (insertErr) {
        // Detect unique constraint violation on idempotency_key
        const msg = String(insertErr.message || "");
        if (
          msg.includes("idx_deposits_idempotency_key") ||
          msg.includes("unique") ||
          insertErr.code === "23505"
        ) {
          return res.status(409).json({
            error: "DUPLICATE_DEPOSIT: A deposit with this idempotency key already exists. " +
              "This submission is a duplicate and has been blocked to prevent double-counting.",
            idempotency_key: idempotencyKey
          });
        }
        throw insertErr;
      }

      return res.status(200).json({ success: true, deposit: inserted[0] });
    } catch (err) {
      const isAuthDbUnavailable = String(err?.message || "").includes("AUTHORITATIVE_PRODUCTION_DB_UNAVAILABLE");
      return res.status(isAuthDbUnavailable ? 503 : 500).json({ error: err.message });
    }
  }

  res.setHeader("Allow", ["GET", "POST"]);
  res.status(405).json({ error: "Method not allowed" });
}
