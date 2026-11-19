import Decimal from "decimal.js";
import { isDrawFulfillmentWithdrawal } from "./accounting-engine.js";

/**
 * Parses an ISO date string to UTC midday to avoid timezone day-shift around month boundaries.
 */
export function parseUtcMiddayDate(rawDate) {
  if (!rawDate) return null;
  const d = new Date(rawDate);
  if (isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12, 0, 0));
}

/**
 * Returns true if calendar month (year, monthNumber) is on or after startDate's month.
 */
export function isPeriodStarted(year, monthNumber, startDate) {
  if (!startDate) return true;
  const sYr = startDate.getUTCFullYear();
  const sMo = startDate.getUTCMonth() + 1;
  return year > sYr || (year === sYr && monthNumber >= sMo);
}

/**
 * Keeps pre-start months at $0 and seeds starting_capital when transitioning into an account's first active month
 * so locked $0 PRE_START prior rows never zero out mid-year starters during recalculation.
 */
export function applyPreStartTransitionBalances({
  targetYear,
  monthNumber,
  startDate,
  accounts = [],
  accountBalances = {}
}) {
  const prevYear = monthNumber === 1 ? targetYear - 1 : targetYear;
  const prevMonth = monthNumber === 1 ? 12 : monthNumber - 1;
  const isStarted = isPeriodStarted(targetYear, monthNumber, startDate);
  const wasPreviouslyStarted = isPeriodStarted(prevYear, prevMonth, startDate);

  if (!isStarted) {
    for (const acc of accounts) {
      accountBalances[acc.id] = new Decimal(0);
    }
    return { isStarted: false, transitionedToActive: false };
  }

  if (!wasPreviouslyStarted) {
    for (const acc of accounts) {
      accountBalances[acc.id] = new Decimal(acc.starting_capital || 0);
    }
    return { isStarted: true, transitionedToActive: true };
  }

  return { isStarted: true, transitionedToActive: false };
}

/**
 * Normalizes and buckets valid, non-void deposits, withdrawals, and ACTIVE
 * commission earnings by month/account for recalculation endpoints.
 */
export function buildRecalcCashflowBuckets({
  deposits = [],
  withdrawals = [],
  commEarnings = [],
  accounts = [],
  targetYear,
  sourceIdSet = null
}) {
  const defaultAccountId = accounts[0]?.id || null;
  const depsByM = {};
  const depsByMAcc = {};

  for (const d of deposits || []) {
    if (sourceIdSet && !sourceIdSet.has(String(d.investor_id || "").trim().toLowerCase())) continue;

    const typeUpper = String(d.type || "").trim().toUpperCase();
    const statusLower = String(d.status || "").trim().toLowerCase();
    const treatment = String(d.accounting_treatment || "NEW_CASH").trim().toUpperCase();
    if (typeUpper === "VOID" || typeUpper === "HISTORICAL_PROVENANCE") continue;
    if (treatment === "HISTORICAL_PROVENANCE") continue;
    if (String(d.idempotency_key || "").startsWith("hist_prov_")) continue;
    if (String(d.notes || "").includes("[HISTORICAL_PROVENANCE]")) continue;
    if (d.is_commission === true || String(d.is_commission).toLowerCase() === "true") continue;
    if (statusLower && !["confirmed", "completed", "approved"].includes(statusLower)) continue;

    const rawDate = d.effective_accounting_date || d.date || "";
    const dt = new Date(rawDate);
    if (isNaN(dt.getTime()) || dt.getUTCFullYear() !== targetYear) continue;

    const m = dt.getUTCMonth() + 1;
    const amt = Number(d.amount || 0);
    const accId = d.account_id || defaultAccountId;

    depsByM[m] = (depsByM[m] || 0) + amt;
    if (accId) {
      if (!depsByMAcc[m]) depsByMAcc[m] = {};
      depsByMAcc[m][accId] = (depsByMAcc[m][accId] || 0) + amt;
    }
  }

  const wdsByM = {};
  const wdsByMAcc = {};
  const drawWdsByM = {};

  for (const w of withdrawals || []) {
    if (sourceIdSet && !sourceIdSet.has(String(w.investor_id || "").trim().toLowerCase())) continue;

    const stLower = String(w.status || "").trim().toLowerCase();
    if (stLower && !["approved", "completed", "pending"].includes(stLower)) continue;

    let wYear = null;
    let wMonth = null;
    if (w.effective_accounting_date || w.request_date) {
      const eff = String(w.effective_accounting_date || w.request_date).slice(0, 10);
      const dt = new Date(eff);
      if (!isNaN(dt.getTime())) {
        wYear = dt.getUTCFullYear();
        wMonth = dt.getUTCMonth() + 1;
      }
    }
    if (!wYear && (w.year || w.effective_year)) {
      wYear = Number(w.year || w.effective_year);
    }
    if (!wMonth && w.month_number) {
      wMonth = Number(w.month_number);
    }
    if (wYear !== targetYear || !wMonth || wMonth < 1 || wMonth > 12) continue;

    const amt = Number(w.amount || 0);
    const accId = w.account_id || defaultAccountId;

    wdsByM[wMonth] = (wdsByM[wMonth] || 0) + amt;
    if (accId) {
      if (!wdsByMAcc[wMonth]) wdsByMAcc[wMonth] = {};
      wdsByMAcc[wMonth][accId] = (wdsByMAcc[wMonth][accId] || 0) + amt;
    }
    if (isDrawFulfillmentWithdrawal(w)) {
      drawWdsByM[wMonth] = (drawWdsByM[wMonth] || new Decimal(0)).add(amt);
    }
  }

  const commEarningsByM = {};
  for (const e of commEarnings || []) {
    if (sourceIdSet && !sourceIdSet.has(String(e.recipient_id || "").trim().toLowerCase())) continue;
    const statusUpper = String(e.status || "ACTIVE").trim().toUpperCase();
    if (statusUpper !== "ACTIVE") continue;
    const key = `${e.year}_${e.month_number}`;
    commEarningsByM[key] = (commEarningsByM[key] || 0) + Number(e.amount || 0);
  }

  return { depsByM, depsByMAcc, wdsByM, wdsByMAcc, drawWdsByM, commEarningsByM };
}
