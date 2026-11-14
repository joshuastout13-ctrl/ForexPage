/**
 * FOREXPAGE — AUTHORITATIVE FUND ACCOUNTING MONTH-STATE MODULE
 * 
 * Canonical Timezone: America/Los_Angeles (Pacific Time)
 * 
 * Explicit Month States:
 * - HISTORICAL_SETTLED: Completed period. Trading gains & commissions are booked/capitalized into settled ledger.
 * - CURRENT_OPEN: Active in-progress month. Live metrics display unclosed gains; settled accounting excludes them.
 * - FUTURE: Unstarted periods. Projection only.
 * 
 * DST Safety: All computations use IANA tz semantics via Intl. UTC offset (UTC-7 PDT / UTC-8 PST) is
 * never hard-coded. The browser or Node runtime resolves the offset automatically.
 */

export const FUND_ACCOUNTING_TIMEZONE = "America/Los_Angeles";

export const MonthState = {
  HISTORICAL_SETTLED: "HISTORICAL_SETTLED",
  CURRENT_OPEN: "CURRENT_OPEN",
  FUTURE: "FUTURE"
};

/**
 * Returns the current date and time components strictly in America/Los_Angeles.
 * Allows deterministic simulation via optional asOfDate.
 * 
 * DST-safe: uses Intl.DateTimeFormat / toLocaleString with an explicit IANA timezone,
 * never hard-codes UTC-7 or UTC-8.
 * 
 * @param {Date|string|number|null} [asOfDate=null] - Optional simulated date/timestamp.
 * @returns {{ year:number, monthNumber:number, day:number, hours:number, minutes:number, seconds:number, ptDate:Date, ptString:string }}
 */
export function getFundAccountingDate(asOfDate = null) {
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
    hours: ptDate.getHours(),
    minutes: ptDate.getMinutes(),
    seconds: ptDate.getSeconds(),
    ptDate,
    ptString
  };
}

/**
 * Returns true if the target month has objective settlement evidence in investor_monthly_history
 * (explicit lock, non-zero settled trading gain booked into ending_balance, or non-zero manual override),
 * distinguishing settled legacy historical months from unclosed calendar-rollover placeholders.
 *
 * @param {number} year - Target calendar year
 * @param {number} monthNumber - Target month number (1-12)
 * @param {Array} [historyList=[]] - Array of investor_monthly_history records
 * @returns {boolean}
 */
export function hasSettledHistoryForPeriod(year, monthNumber, historyList = []) {
  if (!Array.isArray(historyList) || historyList.length === 0) return false;
  const y = Number(year);
  const m = Number(monthNumber);
  return historyList.some((h) => {
    if (!h) return false;
    if (Number(h.year) !== y || Number(h.month_number ?? h.monthNumber ?? h.monthnumber ?? h.month) !== m) return false;
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
 * Evaluates the authoritative month state for a given (year, monthNumber)
 * relative to fund accounting time in America/Los_Angeles.
 * 
 * @param {number} year - Target calendar year (e.g. 2026)
 * @param {number} monthNumber - Target month number (1-12)
 * @param {Date|string|number|null} [asOfDate=null] - Optional simulated date/timestamp
 * @param {{ returnsList?: Array, historyList?: Array }} [options={}] - Optional returns/history evidence
 * @returns {string} MonthState ('HISTORICAL_SETTLED' | 'CURRENT_OPEN' | 'FUTURE')
 */
export function evaluateMonthState(year, monthNumber, asOfDate = null, options = {}) {
  const current = getFundAccountingDate(asOfDate);
  const targetPeriod = Number(year) * 12 + Number(monthNumber);
  const currentPeriod = current.year * 12 + current.monthNumber;

  if (targetPeriod < currentPeriod) {
    // Calendar rollover alone does not settle unfinalized periods.
    // When returnsList/historyList are provided, accept locked returns, explicit manual overrides,
    // or settled historical ledger rows, while keeping unclosed rollover placeholders as CURRENT_OPEN.
    if (options && (options.returnsList || options.historyList)) {
      const returnsList = options.returnsList || [];
      const isLocked = isMonthExplicitlyFinalizedAndLocked(year, monthNumber, returnsList, asOfDate);
      if (isLocked) return MonthState.HISTORICAL_SETTLED;

      const ret = returnsList.find(r =>
        Number(r.year ?? r.Year) === Number(year) &&
        Number(r.month_number ?? r.monthNumber ?? r.monthnumber ?? r.month) === Number(monthNumber)
      );
      const isManualOverride = Boolean(
        ret && (ret.is_override === true || String(ret.is_override).trim().toLowerCase() === "true")
      );
      if (isManualOverride) return MonthState.HISTORICAL_SETTLED;

      if (options.historyList && hasSettledHistoryForPeriod(year, monthNumber, options.historyList)) {
        return MonthState.HISTORICAL_SETTLED;
      }

      return MonthState.CURRENT_OPEN;
    }
    return MonthState.HISTORICAL_SETTLED;
  } else if (targetPeriod === currentPeriod) {
    return MonthState.CURRENT_OPEN;
  } else {
    return MonthState.FUTURE;
  }
}

/**
 * Returns the last completed historical month index (1-12) for a given targetYear.
 * Returns 0 if no months in targetYear are completed yet.
 * Returns 12 if targetYear is fully in the past.
 * 
 * @param {number} targetYear - Year being audited/calculated
 * @param {Date|string|number|null} [asOfDate=null] - Optional simulated date/timestamp
 * @returns {number} 0-12
 */
export function getLastCompletedMonth(targetYear, asOfDate = null) {
  const current = getFundAccountingDate(asOfDate);
  const y = Number(targetYear);
  if (y < current.year) return 12;
  if (y === current.year) return Math.max(0, current.monthNumber - 1);
  return 0; // Future year
}

/**
 * Returns the last completed month as { year, month } — preserving year context
 * across year boundaries (e.g. Jan 1 2027 → { year: 2026, month: 12 }).
 * 
 * @param {Date|string|number|null} [asOfDate=null] - Optional simulated date/timestamp
 * @returns {{ year: number, month: number }}
 */
export function getLastCompletedMonthWithYear(asOfDate = null) {
  const current = getFundAccountingDate(asOfDate);
  if (current.monthNumber === 1) {
    // January: last completed month is December of the prior year
    return { year: current.year - 1, month: 12 };
  }
  return { year: current.year, month: current.monthNumber - 1 };
}

/**
 * Returns true if the target month is fully closed and settled.
 */
export function isHistoricalSettled(year, monthNumber, asOfDate = null) {
  return evaluateMonthState(year, monthNumber, asOfDate) === MonthState.HISTORICAL_SETTLED;
}

/**
 * Returns true only if the month has been explicitly finalized and locked in monthly_returns.
 * A calendar rollover alone is NOT authorization to consider a month finalized.
 * 
 * @param {number} year - Target calendar year
 * @param {number} monthNumber - Target month number (1-12)
 * @param {Array} [returnsList=[]] - Array of monthly_returns records
 * @returns {boolean}
 */
export function isMonthExplicitlyFinalizedAndLocked(year, monthNumber, returnsList = [], asOfDate = null) {
  const y = Number(year);
  const m = Number(monthNumber);
  const current = getFundAccountingDate(asOfDate);

  // Prior settled years
  if (y < current.year) return true;

  const ret = returnsList.find(r => 
    Number(r.year ?? r.Year) === y && 
    Number(r.month_number ?? r.monthNumber ?? r.monthnumber ?? r.month) === m
  );
  if (!ret) return false;
  return ret.locked === true || String(ret.locked).trim().toLowerCase() === 'true';
}

/**
 * Returns true if the target month is the currently active open calendar month.
 */
export function isCurrentOpen(year, monthNumber, asOfDate = null) {
  return evaluateMonthState(year, monthNumber, asOfDate) === MonthState.CURRENT_OPEN;
}

/**
 * Returns true if the target month is in the future.
 */
export function isFuture(year, monthNumber, asOfDate = null) {
  return evaluateMonthState(year, monthNumber, asOfDate) === MonthState.FUTURE;
}
