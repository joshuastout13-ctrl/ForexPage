/**
 * FOREXPAGE — CommonJS bridge for lib/month-state.js
 *
 * This file re-implements the fund accounting month-state logic using CommonJS
 * module syntax so it can be required() by .cjs audit/tooling scripts that
 * cannot use dynamic import() easily.
 *
 * SINGLE SOURCE OF TRUTH: The algorithm here MUST remain identical to
 * lib/month-state.js. If the ESM module changes, this file must change
 * in the same way.
 *
 * Canonical Timezone: America/Los_Angeles (Pacific Time)
 * DST Safety: Uses IANA tz name via toLocaleString — never hard-codes UTC-7/-8.
 */

"use strict";

const FUND_ACCOUNTING_TIMEZONE = "America/Los_Angeles";

const MonthState = {
  HISTORICAL_SETTLED: "HISTORICAL_SETTLED",
  CURRENT_OPEN: "CURRENT_OPEN",
  FUTURE: "FUTURE"
};

/**
 * Returns the current date/time components in America/Los_Angeles.
 * Accepts an optional asOfDate for deterministic testing.
 * @param {Date|string|number|null} [asOfDate=null]
 * @returns {{ year:number, monthNumber:number, day:number, ptDate:Date, ptString:string }}
 */
function getFundAccountingDate(asOfDate = null) {
  const d = asOfDate ? new Date(asOfDate) : new Date();
  if (isNaN(d.getTime())) {
    throw new Error(`INVALID_DATE: Cannot parse asOfDate: ${asOfDate}`);
  }
  const ptString = d.toLocaleString("en-US", { timeZone: FUND_ACCOUNTING_TIMEZONE });
  const ptDate = new Date(ptString);
  return {
    year: ptDate.getFullYear(),
    monthNumber: ptDate.getMonth() + 1, // 1-12
    day: ptDate.getDate(),
    ptDate,
    ptString
  };
}

function isMonthExplicitlyFinalizedAndLocked(year, monthNumber, returnsList = [], asOfDate = null) {
  const y = Number(year);
  const m = Number(monthNumber);
  const current = getFundAccountingDate(asOfDate);
  if (y < current.year) return true;
  const ret = returnsList.find(r =>
    Number(r.year || r.Year) === y &&
    Number(r.month_number || r.monthNumber || r.month) === m
  );
  if (!ret) return false;
  return ret.locked === true || String(ret.locked).trim().toLowerCase() === 'true';
}

function hasSettledHistoryForPeriod(year, monthNumber, historyList = []) {
  if (!Array.isArray(historyList) || historyList.length === 0) return false;
  const y = Number(year);
  const m = Number(monthNumber);
  return historyList.some((h) => {
    if (!h) return false;
    if (Number(h.year) !== y || Number(h.month_number ?? h.monthNumber ?? h.month) !== m) return false;
    const notesUpper = String(h.notes || "").trim().toUpperCase();
    if (notesUpper.startsWith("PROJECTION_VOIDED")) return false;
    if (h.locked === true || String(h.locked).trim().toLowerCase() === "true") return true;
    const hasEnding = h.ending_balance !== null && h.ending_balance !== undefined && h.ending_balance !== "";
    if (!hasEnding) return false;
    const opening = Number(h.opening_balance || 0);
    const deposits = Number(h.deposits || 0);
    const withdrawals = Number(h.withdrawals || 0);
    const draw = Number(h.recurring_draw || 0);
    const ending = Number(h.ending_balance);
    if (!Number.isFinite(ending)) return false;
    const impliedGain = (ending + draw) - (opening + deposits - withdrawals);
    if (Math.abs(impliedGain) > 0.05) return true;
    const isManualRow = (
      h.is_manual === true || String(h.is_manual).trim().toLowerCase() === "true" ||
      h.ismanual === true || String(h.ismanual).trim().toLowerCase() === "true"
    );
    if (isManualRow && h.manual_gain_amount !== null && h.manual_gain_amount !== undefined && Math.abs(Number(h.manual_gain_amount)) > 0.05) {
      return true;
    }
    return false;
  });
}

/**
 * Evaluates the fund accounting month state for a (year, monthNumber) pair.
 * @param {number} year
 * @param {number} monthNumber - 1-12
 * @param {Date|string|number|null} [asOfDate=null]
 * @param {{ returnsList?: Array, historyList?: Array }} [options={}]
 * @returns {string} MonthState constant
 */
function evaluateMonthState(year, monthNumber, asOfDate = null, options = {}) {
  const current = getFundAccountingDate(asOfDate);
  const targetPeriod = Number(year) * 12 + Number(monthNumber);
  const currentPeriod = current.year * 12 + current.monthNumber;
  if (targetPeriod < currentPeriod) {
    if (options && (options.returnsList || options.historyList)) {
      const returnsList = options.returnsList || [];
      if (isMonthExplicitlyFinalizedAndLocked(year, monthNumber, returnsList, asOfDate)) {
        return MonthState.HISTORICAL_SETTLED;
      }
      const ret = returnsList.find(r =>
        Number(r.year || r.Year) === Number(year) &&
        Number(r.month_number || r.monthNumber || r.month) === Number(monthNumber)
      );
      if (ret && (ret.is_override === true || String(ret.is_override).trim().toLowerCase() === "true")) {
        return MonthState.HISTORICAL_SETTLED;
      }
      if (options.historyList && hasSettledHistoryForPeriod(year, monthNumber, options.historyList)) {
        return MonthState.HISTORICAL_SETTLED;
      }
      return MonthState.CURRENT_OPEN;
    }
    return MonthState.HISTORICAL_SETTLED;
  }
  if (targetPeriod === currentPeriod) return MonthState.CURRENT_OPEN;
  return MonthState.FUTURE;
}

/**
 * Returns the last completed month index (0-12) for the targetYear.
 * @param {number} targetYear
 * @param {Date|string|number|null} [asOfDate=null]
 * @returns {number}
 */
function getLastCompletedMonth(targetYear, asOfDate = null) {
  const current = getFundAccountingDate(asOfDate);
  const y = Number(targetYear);
  if (y < current.year) return 12;
  if (y === current.year) return Math.max(0, current.monthNumber - 1);
  return 0;
}

/**
 * Returns { year, month } for the last completed period, crossing year boundaries safely.
 * @param {Date|string|number|null} [asOfDate=null]
 * @returns {{ year: number, month: number }}
 */
function getLastCompletedMonthWithYear(asOfDate = null) {
  const current = getFundAccountingDate(asOfDate);
  if (current.monthNumber === 1) {
    return { year: current.year - 1, month: 12 };
  }
  return { year: current.year, month: current.monthNumber - 1 };
}

module.exports = {
  FUND_ACCOUNTING_TIMEZONE,
  MonthState,
  getFundAccountingDate,
  evaluateMonthState,
  getLastCompletedMonth,
  getLastCompletedMonthWithYear
};
