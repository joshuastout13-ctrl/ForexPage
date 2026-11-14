import { supabase as defaultSupabase } from "./supabase.js";

function toIsoDate(val, fallback = null) {
  if (!val) return fallback;
  return String(val).slice(0, 10);
}

export function ruleAppliesToPeriod(rule, year, month) {
  if (!rule || String(rule.status || "").toLowerCase() === "cancelled") return false;
  const mm = String(month).padStart(2, "0");
  const periodStart = `${year}-${mm}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const periodEnd = `${year}-${mm}-${String(lastDay).padStart(2, "0")}`;

  const start = toIsoDate(rule.effective_start_date, "1900-01-01");
  const end = rule.effective_end_date ? toIsoDate(rule.effective_end_date) : null;

  if (start > periodEnd) return false;
  if (end !== null && end < periodStart) return false;
  return true;
}

function datesOverlap(startA, endA, startB, endB) {
  const sA = toIsoDate(startA, "1900-01-01");
  const eA = toIsoDate(endA, "9999-12-31");
  const sB = toIsoDate(startB, "1900-01-01");
  const eB = toIsoDate(endB, "9999-12-31");
  return sA <= eB && sB <= eA;
}

function createValidationError(status, code, message) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

export async function getFinalizedPeriods(client) {
  const db = client || defaultSupabase;
  if (!db) return [];

  const [apRes, mrRes] = await Promise.all([
    db.from("accounting_periods").select("year, month_number, status").eq("status", "FINALIZED"),
    db.from("monthly_returns").select("year, month_number, locked, status")
  ]);

  const map = new Map();
  for (const row of apRes?.data || []) {
    if (row.year && row.month_number) {
      map.set(`${row.year}-${row.month_number}`, { year: Number(row.year), month_number: Number(row.month_number) });
    }
  }
  for (const row of mrRes?.data || []) {
    const isLocked =
      row.locked === true ||
      String(row.locked).toLowerCase() === "true" ||
      String(row.status || "").toUpperCase() === "FINALIZED" ||
      String(row.status || "").toUpperCase() === "FINAL_RETURN_CAPTURED";
    if (isLocked && row.year && row.month_number) {
      map.set(`${row.year}-${row.month_number}`, { year: Number(row.year), month_number: Number(row.month_number) });
    }
  }
  return Array.from(map.values());
}

/**
 * Validates a proposed commission_shares create/update/end/reactivate operation.
 * Enforces:
 * - valid percentage (0 < pct <= 100) and valid date ordering
 * - non-self sharing
 * - no overlapping non-cancelled date windows for the same (source, account, recipient)
 * - pointwise pool limit: source split_pct + overlapping shares <= 100%
 * - no retroactive mutation of finalized/locked accounting periods
 */
export async function validateCommissionShareMutation(
  client,
  candidate,
  { existing = null, excludeId = null, finalizedPeriods: preloadedPeriods = null } = {}
) {
  const db = client || defaultSupabase;
  const status = String(candidate.status || "active").toLowerCase();
  if (!["active", "ended", "cancelled"].includes(status)) {
    throw createValidationError(400, "INVALID_SHARE_STATUS", `Invalid status '${status}'. Must be active, ended, or cancelled.`);
  }

  const pct = Number(candidate.commission_percent);
  if (Number.isNaN(pct) || pct <= 0 || pct > 100) {
    throw createValidationError(400, "INVALID_COMMISSION_PERCENT", "Commission percentage must be > 0 and <= 100.");
  }

  const start = toIsoDate(candidate.effective_start_date, "1900-01-01");
  const end = candidate.effective_end_date ? toIsoDate(candidate.effective_end_date) : null;
  if (end && end < start) {
    throw createValidationError(400, "INVALID_DATE_RANGE", `effective_end_date (${end}) cannot precede effective_start_date (${start}).`);
  }

  const finalizedPeriods = preloadedPeriods || (await getFinalizedPeriods(db));
  for (const fp of finalizedPeriods) {
    const beforeApplies = existing ? ruleAppliesToPeriod(existing, fp.year, fp.month_number) : false;
    const afterApplies = status !== "cancelled" ? ruleAppliesToPeriod(candidate, fp.year, fp.month_number) : false;
    const changedEconomics =
      beforeApplies &&
      afterApplies &&
      (Math.abs(Number(existing.commission_percent) - pct) > 1e-6 ||
        String(existing.recipient_investor_id || "").toLowerCase() !== String(candidate.recipient_investor_id || "").toLowerCase() ||
        String(existing.source_investor_id || "").toLowerCase() !== String(candidate.source_investor_id || "").toLowerCase() ||
        String(existing.source_account_id || "").toLowerCase() !== String(candidate.source_account_id || "").toLowerCase());

    if (beforeApplies !== afterApplies || changedEconomics) {
      throw createValidationError(
        409,
        "PERIOD_LOCKED",
        `PERIOD_LOCKED: Commission share change alters finalized/locked period ${fp.year}-${String(fp.month_number).padStart(2, "0")}. Use an effective date in an open period instead of rewriting locked history.`
      );
    }
  }

  if (status === "cancelled" || !db) {
    return { valid: true };
  }

  // Resolve source investor and split_pct
  const sourceIdRaw = String(candidate.source_investor_id || "").trim();
  let sourceInv = null;
  if (sourceIdRaw) {
    const { data: invList } = await db
      .from("investors")
      .select("id, portal_username, split_pct");
    sourceInv = (invList || []).find(
      i =>
        String(i.id || "").toLowerCase() === sourceIdRaw.toLowerCase() ||
        String(i.portal_username || "").toLowerCase() === sourceIdRaw.toLowerCase()
    ) || null;
  }

  const recipientIdLower = String(candidate.recipient_investor_id || "").trim().toLowerCase();
  const sourceIdsLower = new Set([sourceIdRaw.toLowerCase()]);
  if (sourceInv?.id) sourceIdsLower.add(String(sourceInv.id).toLowerCase());
  if (sourceInv?.portal_username) sourceIdsLower.add(String(sourceInv.portal_username).toLowerCase());

  if (sourceIdsLower.has(recipientIdLower)) {
    throw createValidationError(400, "SELF_SHARE_NOT_ALLOWED", "Cannot share commission with the source investor themselves.");
  }

  const { data: allShares } = await db
    .from("commission_shares")
    .select("id, source_investor_id, source_account_id, recipient_investor_id, commission_percent, effective_start_date, effective_end_date, status");

  const relevantShares = (allShares || []).filter(s => {
    if (excludeId && String(s.id) === String(excludeId)) return false;
    if (String(s.status || "").toLowerCase() === "cancelled") return false;
    const sSrc = String(s.source_investor_id || "").trim().toLowerCase();
    if (!sourceIdsLower.has(sSrc)) return false;
    return String(s.source_account_id || "") === String(candidate.source_account_id || "");
  });

  // Check pairwise recipient overlap
  for (const s of relevantShares) {
    if (String(s.recipient_investor_id || "").trim().toLowerCase() === recipientIdLower) {
      if (datesOverlap(start, end, s.effective_start_date, s.effective_end_date)) {
        throw createValidationError(
          409,
          "OVERLAPPING_COMMISSION_SHARE",
          `OVERLAPPING_COMMISSION_SHARE: Date range ${start}..${end || "open"} overlaps existing share ${s.id} (${s.effective_start_date}..${s.effective_end_date || "open"}) for this recipient.`
        );
      }
    }
  }

  // Pointwise pool check across all boundary dates in [start, end]
  const invSplit = sourceInv ? Number(sourceInv.split_pct ?? 100) : 100;
  const candidateCheckPoints = new Set([start]);
  for (const s of relevantShares) {
    const sStart = toIsoDate(s.effective_start_date, "1900-01-01");
    if (sStart >= start && (!end || sStart <= end)) {
      candidateCheckPoints.add(sStart);
    }
  }

  for (const point of candidateCheckPoints) {
    const activeAtPoint = relevantShares.filter(s => {
      if (String(s.status || "active").toLowerCase() === "cancelled") return false;
      const sStart = toIsoDate(s.effective_start_date, "1900-01-01");
      const sEnd = toIsoDate(s.effective_end_date, "9999-12-31");
      return sStart <= point && point <= sEnd;
    });

    const otherPct = activeAtPoint.reduce((sum, s) => sum + Number(s.commission_percent || 0), 0);
    const total = invSplit + otherPct + pct;
    if (total > 100.01) {
      throw createValidationError(
        400,
        "COMMISSION_ALLOCATION_EXCEEDS_100_PCT",
        `Total allocation on ${point} is ${total.toFixed(2)}% (investor split ${invSplit}% + existing shares ${otherPct.toFixed(2)}% + new share ${pct.toFixed(2)}%), exceeding 100%.`
      );
    }
  }

  return { valid: true };
}

/**
 * Shared lifecycle transition for admin commission-share deactivate ("ended") and reactivate ("active").
 */
export async function executeCommissionShareLifecycleAction(client, { id, action, effectiveEndDate = null }) {
  const db = client || defaultSupabase;
  if (!id) throw createValidationError(400, "MISSING_ID", "Commission share ID is required");
  if (action !== "deactivate" && action !== "reactivate") {
    throw createValidationError(400, "INVALID_ACTION", `Unsupported lifecycle action: ${action}`);
  }

  const { data: existing, error: fetchErr } = await db
    .from("commission_shares")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (fetchErr) throw fetchErr;
  if (!existing) throw createValidationError(404, "SHARE_NOT_FOUND", `Commission share not found: ${id}`);

  const todayIso = new Date().toISOString().split("T")[0];
  const targetStatus = action === "deactivate" ? "ended" : "active";
  const targetEndDate = action === "deactivate"
    ? (effectiveEndDate ? toIsoDate(effectiveEndDate) : todayIso)
    : (effectiveEndDate ? toIsoDate(effectiveEndDate) : null);

  const candidate = {
    ...existing,
    status: targetStatus,
    effective_end_date: targetEndDate
  };

  await validateCommissionShareMutation(db, candidate, { existing, excludeId: id });

  const { data, error } = await db
    .from("commission_shares")
    .update({
      status: targetStatus,
      effective_end_date: targetEndDate,
      updated_at: new Date()
    })
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return data;
}
