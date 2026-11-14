import { verifyAdminSession } from "../../../lib/adminAuth.js";
import { supabase } from "../../../lib/supabase.js";
import {
  assertAuthoritativeProductionDb,
  assertAuditActor,
  buildDeterministicIdempotencyKey
} from "../../../lib/financial-mutation-guard.js";
import { assertPeriodUnlocked, isPeriodLockedError } from "../../../lib/period-lock-guard.js";
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

      await assertPeriodUnlocked(supabase, { effectiveDate: effDate }, "create_deposit");

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

      // ── Prevention 1: Internal Transfer Misclassification Guard ──────────
      if (rawTreatment === "NEW_CASH") {
        const typeStr = String(body.type || "").trim().toLowerCase();
        const notesStr = String(body.notes || "").toLowerCase();
        const isTransferType = typeStr === "transfer" || typeStr === "internal_transfer";
        const isTransferNote = notesStr.includes("internal transfer") || notesStr.includes("transfer from") || notesStr.includes("transfer to");
        if (isTransferType || isTransferNote) {
          return res.status(400).json({
            error: "INTERNAL_TRANSFER_MISCLASSIFIED: Internal transfers between investor accounts must not be posted as NEW_CASH deposits. Use the dedicated internal transfer workflow to maintain balanced debit and credit legs and preserve certified outside cash."
          });
        }
      }

      // ── Prevention 2: Embedded Starting Capital Duplicate Guard ──────────
      const { data: accRecord } = await supabase
        .from("investor_accounts")
        .select("id, starting_capital, open_date, name")
        .eq("id", accountId)
        .single();

      if (accRecord && rawTreatment === "NEW_CASH") {
        const startCap = Number(accRecord.starting_capital || 0);
        const openDateStr = accRecord.open_date ? String(accRecord.open_date).slice(0, 10) : "";
        const entryMonth = entryDate.slice(0, 7);
        const openMonth = openDateStr.slice(0, 7);

        const isSameAmount = startCap > 0 && Math.abs(startCap - amount) < 0.001;
        const isSamePeriod = openDateStr && (entryDate === openDateStr || effDate === `${openMonth}-01` || entryMonth === openMonth);

        if (isSameAmount && isSamePeriod) {
          const hasExplicitConfirm = Boolean(body.confirm_additional_to_starting_capital || body.confirm_additional_funding);
          if (!hasExplicitConfirm) {
            return res.status(409).json({
              error: `EMBEDDED_STARTING_CAPITAL_DUPLICATE: This deposit amount ($${amount.toFixed(2)}) and date (${entryDate}) match the account's initial starting capital ($${startCap.toFixed(2)}) and opening date (${openDateStr}). The economic effect of this funding is already embedded in the account opening balance. Posting this as NEW_CASH would duplicate the investor's balance. If this is a distinct additional external contribution beyond the starting capital, administrator confirmation is required (set confirm_additional_to_starting_capital: true). If certifying provenance of the initial capital, use accounting_treatment: 'HISTORICAL_PROVENANCE'.`,
              accountStartingCapital: startCap,
              accountOpenDate: openDateStr
            });
          }
        }
      }

      // ── Prevention 3: Pre-Existing Confirmed Economic Duplicate Check ────
      const { data: existingDupes } = await supabase
        .from("deposits")
        .select("id, amount, date, effective_accounting_date, status, accounting_treatment, notes")
        .eq("investor_id", investorId)
        .eq("account_id", accountId)
        .eq("amount", amount)
        .eq("status", "confirmed")
        .eq("accounting_treatment", rawTreatment);

      if (existingDupes && existingDupes.length > 0) {
        const hasDateMatch = existingDupes.some(d => {
          const dDate = String(d.date || "").slice(0, 10);
          const dEff = String(d.effective_accounting_date || "").slice(0, 10);
          return dDate === entryDate || dEff === effDate;
        });

        if (hasDateMatch && !body.confirm_duplicate_economic_deposit) {
          const matchedDupe = existingDupes[0];
          return res.status(409).json({
            error: `DUPLICATE_ECONOMIC_DEPOSIT: An active ${rawTreatment} deposit of $${amount.toFixed(2)} on ${entryDate} (effective ${effDate}) already exists for this account (Deposit ID: ${matchedDupe.id}). If this is a separate legitimate transaction, administrator confirmation is required (set confirm_duplicate_economic_deposit: true).`,
            existingDepositId: matchedDupe.id
          });
        }
      }

      // ── Idempotency Key (Strict Fail-Closed Contract) ────────────────────
      // A durable operation ID (idempotency_key) generated once per intended transaction
      // and reused across retries is STRICTLY REQUIRED.
      // Do NOT derive a missing key from investor/account/date/amount — that can collapse
      // two legitimate same-amount transactions. Fail closed instead of guessing.
      let idempotencyKey = body.idempotency_key || body.idempotencyKey || null;
      if (!idempotencyKey || typeof idempotencyKey !== "string" || !idempotencyKey.trim()) {
        return res.status(400).json({
          error: "MISSING_IDEMPOTENCY_KEY: A durable idempotency_key is strictly required for financial deposit mutations to guarantee exactly-once processing. Supply a persistent operation ID.",
          code: "MISSING_IDEMPOTENCY_KEY"
        });
      }
      idempotencyKey = String(idempotencyKey).trim().slice(0, 255);

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

      // ── Authoritative Save Path: Invoke Atomic Database RPC (Under Investor Advisory Lock) ──
      const { data: rpcRes, error: rpcErr } = await supabase.rpc("create_deposit_atomic", {
        p_investor_id: investorId,
        p_account_id: accountId,
        p_amount: amount,
        p_date: entryDate,
        p_effective_date: effDate,
        p_accounting_treatment: rawTreatment,
        p_status: rawStatus,
        p_type: body.type || "Wire",
        p_notes: body.notes || "",
        p_idempotency_key: idempotencyKey,
        p_created_by: auditActor
      });

      if (rpcErr) {
        const msg = String(rpcErr.message || "");
        if (msg.includes("PERIOD_LOCKED")) {
          return res.status(409).json({ error: msg, code: "PERIOD_LOCKED" });
        }
        if (msg.includes("IDEMPOTENCY_KEY_PAYLOAD_MISMATCH")) {
          return res.status(409).json({
            error: msg,
            code: "IDEMPOTENCY_KEY_PAYLOAD_MISMATCH",
            idempotency_key: idempotencyKey
          });
        }
        if (msg.includes("INVALID_AMOUNT") || msg.includes("INVALID_ACCOUNTING_TREATMENT") || msg.includes("INVALID_DEPOSIT_STATUS")) {
          return res.status(400).json({ error: msg });
        }
        // Unique index violation backstop
        if (msg.includes("idx_deposits_idempotency_key") || rpcErr.code === "23505") {
          const { data: existingDep } = await supabase
            .from("deposits")
            .select("*")
            .eq("idempotency_key", idempotencyKey)
            .maybeSingle();

          if (existingDep) {
            // Compare the COMPLETE canonical payload of all relevant transaction fields:
            const isMatch =
              String(existingDep.investor_id || '').toLowerCase() === String(investorId).toLowerCase() &&
              String(existingDep.account_id || '').toLowerCase() === String(accountId).toLowerCase() &&
              Math.abs(Number(existingDep.amount) - amount) < 0.001 &&
              String(existingDep.date || '').slice(0, 10) === String(entryDate).slice(0, 10) &&
              String(existingDep.effective_accounting_date || '').slice(0, 10) === String(effDate).slice(0, 10) &&
              String(existingDep.accounting_treatment || 'NEW_CASH').toUpperCase() === String(rawTreatment).toUpperCase() &&
              String(existingDep.status || 'confirmed').toLowerCase() === String(rawStatus).toLowerCase() &&
              String(existingDep.type || 'Wire').toLowerCase() === String(body.type || 'Wire').toLowerCase();

            if (isMatch) {
              return res.status(200).json({
                success: true,
                deposit: existingDep,
                idempotency_replay: true,
                status: "IDEMPOTENT_REPLAY"
              });
            } else {
              return res.status(409).json({
                error: `IDEMPOTENCY_KEY_PAYLOAD_MISMATCH: Key ${idempotencyKey} was already used with a different deposit payload.`,
                code: "IDEMPOTENCY_KEY_PAYLOAD_MISMATCH",
                existing_deposit_id: existingDep.id
              });
            }
          }
        }
        throw rpcErr;
      }

      if (rpcRes) {
        const isReplay = rpcRes.status === "IDEMPOTENT_REPLAY" || rpcRes.idempotency_replay === true;
        return res.status(200).json({
          success: true,
          deposit: rpcRes.deposit,
          idempotency_replay: isReplay,
          status: rpcRes.status || (isReplay ? "IDEMPOTENT_REPLAY" : "SUCCESS")
        });
      }
    } catch (err) {
      if (isPeriodLockedError(err)) {
        return res.status(409).json({ error: err.message, code: "PERIOD_LOCKED" });
      }
      const isAuthDbUnavailable = String(err?.message || "").includes("AUTHORITATIVE_PRODUCTION_DB_UNAVAILABLE");
      return res.status(isAuthDbUnavailable ? 503 : 500).json({ error: err.message });
    }
  }

  res.setHeader("Allow", ["GET", "POST"]);
  res.status(405).json({ error: "Method not allowed" });
}
