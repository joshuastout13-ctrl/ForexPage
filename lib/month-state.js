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
 * Evaluates the authoritative month state for a given (year, monthNumber)
 * relative to fund accounting time in America/Los_Angeles.
 * 
 * @param {number} year - Target calendar year (e.g. 2026)
 * @param {number} monthNumber - Target month number (1-12)
 * @param {Date|string|number|null} [asOfDate=null] - Optional simulated date/timestamp
 * @returns {string} MonthState ('HISTORICAL_SETTLED' | 'CURRENT_OPEN' | 'FUTURE')
 */
export function evaluateMonthState(year, monthNumber, asOfDate = null) {
  const current = getFundAccountingDate(asOfDate);
  const targetPeriod = Number(year) * 12 + Number(monthNumber);
  const currentPeriod = current.year * 12 + current.monthNumber;

  if (targetPeriod < currentPeriod) {
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
