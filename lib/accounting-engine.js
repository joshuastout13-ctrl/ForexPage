import Decimal from "decimal.js";

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

function roundMoney(dec) {
  return dec.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

function toDec(val, fallback = 0) {
  if (val === null || val === undefined || isNaN(val)) return new Decimal(fallback);
  return new Decimal(val);
}

/**
 * Pure Single Investor Monthly Accounting Engine
 * 
 * AUTHORITATIVE BUSINESS RULES:
 * 1. Cash flows (deposits/withdrawals) effectively apply on 1st of month (no proration).
 * 2. Prior month incoming commissions credit to 1st of month eligible capital.
 * 3. eligibleCapital = priorEndingBalance + deposits - withdrawals + priorMonthIncomingCommissions.
 * 4. grossFundResult = eligibleCapital * fundReturnPct / 100 (rounded to cents).
 * 5. Profit Month:
 *    - Recipient commissions calculated first: roundMoney(grossFundResult * recipientPct_i / 100)
 *    - Source investor gets remainder when configured total % == 100%:
 *      sourceGainLoss = grossFundResult - sum(recipientCommissions)
 *    - Rounding adjustment favors the source investor.
 * 6. Loss Month:
 *    - Recipient commissions are strictly $0.00.
 *    - Source investor absorbs only their configured split % of the loss:
 *      sourceGainLoss = roundMoney(grossFundResult * sourceSplitPct / 100)
 * 7. Zero Month:
 *    - grossFundResult = 0, sourceGainLoss = 0, recipientCommissions = 0.
 * 8. endingBeforeDraw = eligibleCapital + sourceGainLoss.
 * 9. endingBalance = max(0, endingBeforeDraw - recurringDraw).
 * 
 * NO DATABASE CALLS INSIDE THIS PURE FUNCTION.
 */
export function calculateInvestorMonth({
  year,
  month,
  investorId,
  startDate = null,
  priorEndingBalance = 0,
  deposits = 0,
  withdrawals = 0,
  priorMonthIncomingCommissions = 0,
  fundReturnPct = 0,
  sourceSplitPct = 100,
  commissionShares = [],
  recurringDraw = 0,
  currencyTolerance = 0.05,
  percentageTolerance = 0.01
}) {
  const decPriorEnding = toDec(priorEndingBalance);
  const decDeposits = toDec(deposits);
  const decWithdrawals = toDec(withdrawals);
  const decIncomingCommissions = toDec(priorMonthIncomingCommissions);
  const decFundReturnPct = toDec(fundReturnPct);
  const decSourceSplitPct = toDec(sourceSplitPct !== null && sourceSplitPct !== undefined ? sourceSplitPct : 100);
  const decRecurringDraw = toDec(recurringDraw);

  const periodStartStr = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDayNum = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const periodEndStr = `${year}-${String(month).padStart(2, '0')}-${String(lastDayNum).padStart(2, '0')}`;

  // Start Date validation
  let isStarted = true;
  if (startDate) {
    const sdStr = String(startDate).slice(0, 10);
    if (sdStr > periodEndStr) {
      isStarted = false;
    }
  }

  // 1. Calculate Month Opening Capital Base (Josh Confirmed General Accounting Rule)
  // Month opening base = prior ending balance + prior month incoming commissions capitalized
  // Month starting / return-eligible capital = opening base + new deposits - withdrawals
  const decOpeningBalance = decPriorEnding.add(decIncomingCommissions);
  const decEligibleCapital = decOpeningBalance
    .add(decDeposits)
    .sub(decWithdrawals);

  if (!isStarted) {
    return {
      investorId,
      year,
      month,
      isPreStart: true,
      resultType: "PRE_START",
      openingBalance: decOpeningBalance.toNumber(),
      deposits: decDeposits.toNumber(),
      withdrawals: decWithdrawals.toNumber(),
      incomingCommissionCredits: decIncomingCommissions.toNumber(),
      eligibleCapital: 0,
      fundReturnPct: 0,
      effectiveInvestorReturnPct: 0,
      grossFundResult: 0,
      sourceGainLoss: 0,
      recipientAllocations: [],
      totalRecipientCommissions: 0,
      endingBeforeDraw: 0,
      recurringDraw: 0,
      endingBalance: 0,
      configuredAllocationPct: decSourceSplitPct.toNumber(),
      unallocatedPct: 0,
      unallocatedAmount: 0,
      roundingAdjustment: 0,
      reconciliation: {
        status: "PASS",
        reason: "Investor start date is after this period.",
        difference: 0
      }
    };
  }

  // 2. Gross Fund Result
  let decGrossFundResult = roundMoney(decEligibleCapital.mul(decFundReturnPct).div(100));

  let resultType = "ZERO";
  if (decFundReturnPct.gt(0)) {
    resultType = "PROFIT";
  } else if (decFundReturnPct.lt(0)) {
    resultType = "LOSS";
  }

  // Calculate total configured percentage
  let recipientPctTotal = new Decimal(0);
  const shares = commissionShares || [];
  shares.forEach(s => {
    const p = toDec(s.commission_percent || s.commissionPercent || s.percent || 0);
    recipientPctTotal = recipientPctTotal.add(p);
  });

  const decTotalConfiguredPct = decSourceSplitPct.add(recipientPctTotal);
  const decUnallocatedPct = new Decimal(100).sub(decTotalConfiguredPct);

  let decSourceGainLoss = new Decimal(0);
  let decTotalRecipientCommissions = new Decimal(0);
  let roundingAdjustment = 0;
  const recipientAllocations = [];

  // Effective return % for source investor
  let effectiveInvestorReturnPct = 0;
  if (!decFundReturnPct.isZero()) {
    effectiveInvestorReturnPct = decFundReturnPct.mul(decSourceSplitPct).div(100).toNumber();
  }

  if (resultType === "ZERO") {
    // ZERO MONTH
    shares.forEach(s => {
      const commPct = toDec(s.commission_percent || s.commissionPercent || s.split_pct || s.splitPct || s.percent || 0).toNumber();
      recipientAllocations.push({
        id: s.id,
        recipientId: s.recipientId || s.recipient_investor_id || s.recipient_id,
        recipientName: s.recipientName || s.recipient_name || s.name || "Recipient",
        recipientUsername: s.recipientUsername || s.recipient_username || s.username || s.recipient_investor_id || s.recipient_id || s.recipientId || "unknown",
        commissionPercent: commPct,
        amount: 0
      });
    });
  } else if (resultType === "LOSS") {
    // LOSS MONTH
    // Source investor absorbs their configured share of fund loss
    decSourceGainLoss = roundMoney(decGrossFundResult.mul(decSourceSplitPct).div(100));
    
    // Recipients receive $0.00
    shares.forEach(s => {
      const commPct = toDec(s.commission_percent || s.commissionPercent || s.split_pct || s.splitPct || s.percent || 0).toNumber();
      recipientAllocations.push({
        id: s.id,
        recipientId: s.recipientId || s.recipient_investor_id || s.recipient_id,
        recipientName: s.recipientName || s.recipient_name || s.name || "Recipient",
        recipientUsername: s.recipientUsername || s.recipient_username || s.username || s.recipient_investor_id || s.recipient_id || s.recipientId || "unknown",
        commissionPercent: commPct,
        amount: 0
      });
    });
  } else {
    // PROFIT MONTH
    // 1. Calculate each recipient's rounded cent amount
    shares.forEach(s => {
      const commPctDec = toDec(s.commission_percent || s.commissionPercent || s.split_pct || s.splitPct || s.percent || 0);
      const decRecAmt = roundMoney(decGrossFundResult.mul(commPctDec).div(100));
      decTotalRecipientCommissions = decTotalRecipientCommissions.add(decRecAmt);

      recipientAllocations.push({
        id: s.id,
        recipientId: s.recipientId || s.recipient_investor_id || s.recipient_id,
        recipientName: s.recipientName || s.recipient_name || s.name || "Recipient",
        recipientUsername: s.recipientUsername || s.recipient_username || s.username || s.recipient_investor_id || s.recipient_id || s.recipientId || "unknown",
        commissionPercent: commPctDec.toNumber(),
        amount: decRecAmt.toNumber()
      });
    });

    // 2. Authoritative Rounding Policy:
    // If configured total % is ~100%, source investor gets remainder (grossFundResult - sum(recipients))
    const is100Pct = decTotalConfiguredPct.sub(100).abs().lte(percentageTolerance);

    if (is100Pct) {
      decSourceGainLoss = decGrossFundResult.sub(decTotalRecipientCommissions);

      // Naive source amount for rounding adjustment reporting
      const naiveSource = roundMoney(decGrossFundResult.mul(decSourceSplitPct).div(100));
      roundingAdjustment = decSourceGainLoss.sub(naiveSource).toNumber();
    } else {
      decSourceGainLoss = roundMoney(decGrossFundResult.mul(decSourceSplitPct).div(100));
    }
  }

  // 3. Ending Balance Calculation
  const decEndingBeforeDraw = decEligibleCapital.add(decSourceGainLoss);
  const decEndingBalance = decEndingBeforeDraw.sub(decRecurringDraw);

  // 4. Allocation Reconciliation Audit
  const decTotalDistributed = decSourceGainLoss.add(decTotalRecipientCommissions);
  const decUnallocatedAmount = decGrossFundResult.sub(decTotalDistributed);

  let reconcilStatus = "PASS";
  let reconcilReason = "Reconciled cleanly.";

  if (resultType === "PROFIT") {
    const is100Pct = decTotalConfiguredPct.sub(100).abs().lte(percentageTolerance);
    const isFullyDistributed = decUnallocatedAmount.abs().lte(currencyTolerance);

    if (!is100Pct || !isFullyDistributed) {
      reconcilStatus = "FLAGGED";
      if (decTotalConfiguredPct.gt(100)) {
        reconcilReason = `Over-allocated commission configuration: ${decTotalConfiguredPct.toFixed(2)}% total configured.`;
      } else if (decTotalConfiguredPct.lt(100)) {
        reconcilReason = `Under-allocated commission configuration: ${decTotalConfiguredPct.toFixed(2)}% total configured (${decUnallocatedPct.toFixed(2)}% unallocated).`;
      } else {
        reconcilReason = `Unallocated residual amount of $${decUnallocatedAmount.toFixed(2)}.`;
      }
    }
  }

  if (decEligibleCapital.lt(0)) {
    reconcilStatus = "FLAGGED";
    reconcilReason = `Negative eligible capital base: $${decEligibleCapital.toFixed(2)}.`;
  } else if (decEndingBalance.lt(0)) {
    reconcilStatus = "FLAGGED";
    reconcilReason = `Negative ending balance: $${decEndingBalance.toFixed(2)}.`;
  }

  return {
    investorId,
    year,
    month,
    isPreStart: false,
    resultType,

    openingBalance: decOpeningBalance.toNumber(),
    startingBalance: decEligibleCapital.toNumber(),
    deposits: decDeposits.toNumber(),
    withdrawals: decWithdrawals.toNumber(),
    incomingCommissionCredits: decIncomingCommissions.toNumber(),
    eligibleCapital: decEligibleCapital.toNumber(),

    fundReturnPct: decFundReturnPct.toNumber(),
    effectiveInvestorReturnPct,

    grossFundResult: decGrossFundResult.toNumber(),
    sourceGainLoss: decSourceGainLoss.toNumber(),

    recipientAllocations,
    totalRecipientCommissions: decTotalRecipientCommissions.toNumber(),

    endingBeforeDraw: decEndingBeforeDraw.toNumber(),
    recurringDraw: decRecurringDraw.toNumber(),
    endingBalance: decEndingBalance.toNumber(),

    configuredAllocationPct: decTotalConfiguredPct.toNumber(),
    unallocatedPct: decUnallocatedPct.toNumber(),
    unallocatedAmount: decUnallocatedAmount.toNumber(),

    roundingAdjustment,

    reconciliation: {
      status: reconcilStatus,
      reason: reconcilReason,
      difference: decUnallocatedAmount.toNumber()
    }
  };
}

/**
 * Determines if a deposit row should be excluded from all cash calculations.
 * Shared exclusion logic for both balance-affecting and total-external-cash functions.
 *
 * Excluded when ANY of the following are true:
 * - type === 'VOID' (legacy soft-delete pattern)
 * - status === 'void' or 'cancelled' (new status column)
 * - type === 'COMMISSION' (commission capitalization is NOT external cash)
 * - is_commission === true
 */
function isDepositExcluded(d) {
  const typeStr = String(d.type || '').toUpperCase();
  const statusStr = String(d.status || '').toUpperCase();
  return (
    typeStr === 'VOID' ||
    statusStr === 'VOID' ||
    statusStr === 'CANCELLED' ||
    typeStr === 'COMMISSION' ||
    d.is_commission === true ||
    d.iscommission === true
  );
}

/**
 * Shared deposit row date filtering.
 */
function isDepositInPeriod(d, targetYear, maxMonth) {
  if (targetYear !== null && targetYear !== undefined) {
    const dYear = Number(
      d.effective_year ||
      d.year ||
      (d.effective_accounting_date ? new Date(d.effective_accounting_date).getUTCFullYear() : null) ||
      (d.date ? new Date(d.date).getUTCFullYear() : targetYear)
    );
    if (dYear !== targetYear) return false;
  }
  if (maxMonth !== null && maxMonth !== undefined) {
    const dMonth = Number(
      d.month_number ||
      d.monthno ||
      (d.effective_accounting_date ? new Date(d.effective_accounting_date).getUTCMonth() + 1 : null) ||
      (d.date ? new Date(d.date).getUTCMonth() + 1 : 1)
    );
    if (dMonth > maxMonth) return false;
  }
  return true;
}

/**
 * Calculates cumulative BALANCE-AFFECTING deposits for an investor.
 *
 * Authoritative Rule (Josh Sep 2026):
 * Only deposits with accounting_treatment = 'NEW_CASH' (or no treatment set,
 * for backward-compat with legacy rows) affect the monthly accounting balance.
 * HISTORICAL_PROVENANCE deposits establish cash provenance but do NOT
 * add to the compounding balance (that money is already in the imported baseline).
 *
 * Use this function to feed the monthly compounding/eligible-capital calculation.
 *
 * EXCLUDE:
 * - VOID / CANCELLED / COMMISSION records
 * - accounting_treatment = 'HISTORICAL_PROVENANCE'
 */
export function calculateBalanceAffectingDeposits({
  depositRows = [],
  targetYear = null,
  maxMonth = null,
  accountStartDate = null
} = {}) {
  let total = new Decimal(0);

  (depositRows || []).forEach(d => {
    if (isDepositExcluded(d)) return;
    // HISTORICAL_PROVENANCE rows do NOT affect the accounting balance
    const treatment = String(d.accounting_treatment || 'UNVERIFIED_LEGACY').toUpperCase();
    if (treatment === 'HISTORICAL_PROVENANCE') return;
    // Both NEW_CASH and UNVERIFIED_LEGACY rows affect the monthly compounding balance
    if (!isDepositInPeriod(d, targetYear, maxMonth)) return;
    const amt = new Decimal(d.amount || d.Amount || 0);
    if (amt.isPositive() && !amt.isZero()) {
      total = total.add(amt);
    }
  });

  return total.toNumber();
}

/**
 * Calculates Total External Cash Sent by an investor.
 *
 * Authoritative Client Contract (Josh Sep 2026):
 * Total Deposits = ALL confirmed external cash records Josh has entered,
 * regardless of accounting_treatment (NEW_CASH or HISTORICAL_PROVENANCE).
 * This is the denominator for Total Performance % calculation.
 *
 * INCLUDE:
 * - accounting_treatment = 'NEW_CASH'
 * - accounting_treatment = 'HISTORICAL_PROVENANCE'
 *
 * EXCLUDE:
 * - accounting_treatment = 'UNVERIFIED_LEGACY' (not proven external cash)
 * - VOID / CANCELLED records
 * - COMMISSION records
 * - starting_capital (never a deposit row)
 * - cutover/migration baselines (never a deposit row)
 *
 * Returns { total, hasConfirmedRecords } where hasConfirmedRecords is false
 * when no qualifying rows exist (signals that Total Performance is UNKNOWN).
 */
export function calculateTotalExternalCash({
  depositRows = [],
  targetYear = null,
  maxMonth = null,
  accountStartDate = null
} = {}) {
  let total = new Decimal(0);
  let hasConfirmedRecords = false;

  (depositRows || []).forEach(d => {
    if (isDepositExcluded(d)) return;
    // Only explicitly proven external cash (NEW_CASH or HISTORICAL_PROVENANCE) qualifies.
    // UNVERIFIED_LEGACY rows are excluded until Josh certifies them as genuine cash.
    const treatment = String(d.accounting_treatment || '').toUpperCase();
    if (treatment !== 'NEW_CASH' && treatment !== 'HISTORICAL_PROVENANCE') {
      return;
    }
    if (!isDepositInPeriod(d, targetYear, maxMonth)) return;
    const amt = new Decimal(d.amount || d.Amount || 0);
    if (amt.isPositive() && !amt.isZero()) {
      total = total.add(amt);
      hasConfirmedRecords = true;
    }
  });

  return { total: total.toNumber(), hasConfirmedRecords };
}

/**
 * @deprecated Use calculateBalanceAffectingDeposits() or calculateTotalExternalCash() instead.
 * Kept for backward compatibility with existing callers during migration.
 * Behavior: equivalent to calculateBalanceAffectingDeposits (excludes HISTORICAL_PROVENANCE).
 */
export function calculateTotalDeposits({
  baselineCashIn = 0,
  startingCapital = 0,
  depositRows = [],
  targetYear = null,
  maxMonth = null,
  accountStartDate = null
} = {}) {
  return calculateBalanceAffectingDeposits({ depositRows, targetYear, maxMonth, accountStartDate });
}

/**
 * Extracts a normalized YYYY-MM-DD date string from a transaction row.
 */
function extractRowDateString(row) {
  if (!row) return null;
  const rawDate = row.effective_accounting_date || row.date || row.request_date;
  if (rawDate) {
    if (rawDate instanceof Date) {
      return rawDate.toISOString().slice(0, 10);
    }
    const s = String(rawDate).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
      return s.slice(0, 10);
    }
    const d = new Date(s);
    if (!isNaN(d.getTime())) {
      return d.toISOString().slice(0, 10);
    }
  }

  const yr = Number(row.year ?? row.effective_year ?? row.effectiveyear);
  let mo = row.month_number ?? row.monthnumber ?? row.month_no ?? row.monthno ?? row.month;
  if (typeof mo === 'string' && isNaN(Number(mo))) {
    const MONTH_MAP = {
      january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3,
      april: 4, apr: 4, may: 5, june: 6, jun: 6, july: 7, jul: 7,
      august: 8, aug: 8, september: 9, sep: 9, sept: 9, october: 10, oct: 10,
      november: 11, nov: 11, december: 12, dec: 12
    };
    mo = MONTH_MAP[mo.toLowerCase()] || null;
  }
  mo = Number(mo);
  if (yr && mo >= 1 && mo <= 12) {
    return `${yr}-${String(mo).padStart(2, '0')}-01`;
  }

  if (row.created_at) {
    const d = new Date(row.created_at);
    if (!isNaN(d.getTime())) {
      return d.toISOString().slice(0, 10);
    }
  }

  return null;
}

/**
 * Normalizes a date or date string into YYYY-MM-DD format.
 */
function normalizeDateString(dateVal) {
  if (!dateVal) return null;
  if (dateVal instanceof Date) {
    return dateVal.toISOString().slice(0, 10);
  }
  const s = String(dateVal).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    return s.slice(0, 10);
  }
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10);
  }
  return null;
}

/**
 * Calculates Lifetime Settled Account Withdrawals for an investor.
 *
 * Authoritative Product Definition (Josh confirmed Sep 2026):
 * WITHDRAWALS CARD = TOTAL ACCOUNT WITHDRAWALS, LIFETIME.
 *
 * Rules:
 * 1. Scope starts at the account's actual activation/open date (accountStartDate).
 *    Pre-activation transactions are excluded.
 * 2. Includes qualifying withdrawals across ALL calendar years (lifetime, not YTD).
 * 3. Includes current/open-month withdrawals once the withdrawal has actually
 *    reached a settled/qualifying lifecycle status (does not wait for month close).
 * 4. Qualifying/Settled statuses: 'Completed', 'Approved'.
 *    - Approved is canonical settled status under accounting engine: it has economically
 *      left the return-eligible capital base on the 1st of the effective month.
 * 5. Excluded statuses: 'Pending', 'Cancelled', 'Void', 'Rejected'.
 * 6. Single counting: counts each economic withdrawal exactly once.
 *    - De-duplicates identical row IDs or linked transfer representations.
 *    - Does not add recurring_draw separately if already represented in withdrawals.
 * 7. If asOfDate is provided, excludes future-dated withdrawals strictly beyond asOfDate.
 *
 * @param {Array} withdrawalRows - Authoritative withdrawal records across all years
 * @param {string|Date|null} accountStartDate - Account start date / open date
 * @param {string|Date|null} asOfDate - Optional effective as-of date
 * @returns {{ total: number, count: number, qualifyingRows: Array, excludedRows: Array }}
 */
export function calculateLifetimeSettledWithdrawals({
  withdrawalRows = [],
  accountStartDate = null,
  asOfDate = null
} = {}) {
  let total = new Decimal(0);
  const qualifyingRows = [];
  const excludedRows = [];

  const startStr = normalizeDateString(accountStartDate);
  const asOfStr = normalizeDateString(asOfDate);

  const seenIds = new Set();
  const seenTransferIds = new Set();
  const seenIdempotencyKeys = new Set();

  (withdrawalRows || []).forEach(row => {
    // 1. Status Check: Must be settled ('completed' or 'approved')
    const s = String(row.status ?? row.Status ?? '').trim().toLowerCase();
    const isSettled = (s === 'completed' || s === 'approved');
    if (!isSettled) {
      excludedRows.push({ row, reason: `STATUS_NOT_SETTLED: ${row.status}` });
      return;
    }

    // 2. Date normalization & Pre-activation exclusion
    const rowDateStr = extractRowDateString(row);
    if (startStr && rowDateStr) {
      if (rowDateStr < startStr) {
        excludedRows.push({ row, reason: `PRE_ACTIVATION: ${rowDateStr} < ${startStr}` });
        return;
      }
    } else if (startStr && !rowDateStr && (row.year || row.effective_year)) {
      const startYr = Number(startStr.slice(0, 4));
      const rowYr = Number(row.year || row.effective_year);
      if (rowYr < startYr) {
        excludedRows.push({ row, reason: `PRE_ACTIVATION_YEAR: ${rowYr} < ${startYr}` });
        return;
      }
    }

    // 3. As-Of Date check (exclude future-dated records relative to asOfDate)
    if (asOfStr && rowDateStr) {
      if (rowDateStr > asOfStr) {
        excludedRows.push({ row, reason: `FUTURE_DATE: ${rowDateStr} > ${asOfStr}` });
        return;
      }
    }

    // 4. De-duplication: each economic withdrawal counted once
    if (row.id) {
      const idKey = String(row.id).trim();
      if (seenIds.has(idKey)) {
        excludedRows.push({ row, reason: `DUPLICATE_ROW_ID: ${row.id}` });
        return;
      }
      seenIds.add(idKey);
    }

    if (row.transfer_id) {
      const transferKey = String(row.transfer_id).trim();
      if (seenTransferIds.has(transferKey)) {
        excludedRows.push({ row, reason: `DUPLICATE_TRANSFER_ID: ${row.transfer_id}` });
        return;
      }
      seenTransferIds.add(transferKey);
    }

    if (row.idempotency_key) {
      const idempKey = String(row.idempotency_key).trim();
      if (seenIdempotencyKeys.has(idempKey)) {
        excludedRows.push({ row, reason: `DUPLICATE_IDEMPOTENCY_KEY: ${row.idempotency_key}` });
        return;
      }
      seenIdempotencyKeys.add(idempKey);
    }

    // 5. Amount summation
    const amt = new Decimal(row.amount ?? row.Amount ?? 0);
    if (amt.isPositive() && !amt.isZero()) {
      total = total.add(amt);
      qualifyingRows.push(row);
    } else {
      excludedRows.push({ row, reason: `ZERO_OR_NEGATIVE_AMOUNT: ${amt.toString()}` });
    }
  });

  return {
    total: roundMoney(total).toNumber(),
    count: qualifyingRows.length,
    qualifyingRows,
    excludedRows
  };
}

/**
 * Calculates Lifetime / Entire-Account Performance for an investor.
 *
 * Authoritative Direct Client Contract (Josh Aug/Sep 2026):
 * "Total performance is the total amount of cash in / the current balance"
 * "If I put in $1 million and now the account has $3 million, it should show a 200% gain."
 *
 * Direct Cash-In Formulas:
 * 1. Total External Cash Sent = sum of ALL confirmed external cash deposit records
 *    (both NEW_CASH and HISTORICAL_PROVENANCE treatments).
 *    starting_capital is NEVER used as external cash — it is the accounting baseline only.
 * 2. Total Performance $ = Current Balance - Total External Cash Sent
 * 3. Total Performance % = Total External Cash Sent > 0
 *      ? ((Current Balance - Total External Cash Sent) / Total External Cash Sent) * 100
 *      : null  ← UNKNOWN, not fabricated
 *
 * FAIL-CLOSED RULE (Josh Sep 2026):
 * If there are NO confirmed external cash deposit records in the deposits table:
 * - Do NOT substitute starting_capital as the denominator.
 * - Return provenanceStatus = 'NO_CONFIRMED_EXTERNAL_CASH'.
 * - Return totalPerformanceDollar = null, totalPerformancePct = null.
 * - The caller must display 'Not Established' or equivalent — never fabricate 0%.
 *
 * Withdrawals are NOT added back (current balance naturally reflects them).
 * Commissions are NOT external cash.
 * Cutover/migration baselines are NOT external cash.
 *
 * @param {number|null} totalExternalCashSent
 *   The sum from calculateTotalExternalCash().total. Pass null when no records exist.
 * @param {boolean} hasConfirmedExternalCashRecords
 *   true when at least one qualifying deposit row exists.
 * @param {number} currentBalance  The current settled accounting balance.
 * @param {string} provenanceCompletenessStatus  'UNKNOWN' | 'PARTIAL' | 'COMPLETE'.
 *   Total Performance $ and % MUST NOT be calculated unless status is explicitly COMPLETE.
 * @param {string|null} provenanceOriginType  Optional descriptor for the provenance source.
 */
export function calculateLifetimePerformance({
  totalExternalCashSent = null,
  hasConfirmedExternalCashRecords = false,
  currentBalance = 0,
  provenanceCompletenessStatus = 'UNKNOWN',
  provenanceOriginType = null,
  // Legacy params kept for backward-compat callers during migration:
  startingCapital = 0,
  initialCashContribution = null,
  cutoverBaseline = null,
  cumulativeDeposits = 0
} = {}) {
  const decBalance = new Decimal(currentBalance || 0);
  const normCompleteness = String(provenanceCompletenessStatus || 'UNKNOWN').trim().toUpperCase();
  const isCertifiedComplete = normCompleteness === 'COMPLETE';

  // -------------------------------------------------------------------------
  // AUTHORITATIVE PATH (new callers using calculateTotalExternalCash())
  // -------------------------------------------------------------------------
  if (totalExternalCashSent !== null && totalExternalCashSent !== undefined) {
    const decCash = new Decimal(totalExternalCashSent);
    const hasCash = hasConfirmedExternalCashRecords && decCash.gt(0);

    if (!hasCash || decCash.lte(0)) {
      // FAIL CLOSED — no confirmed external cash records
      return {
        contributedBasis: 0,
        totalExternalCashSent: 0,
        totalPerformanceDollar: null,
        totalPerformancePct: null,
        isProven: false,
        provenanceStatus: 'NO_CONFIRMED_EXTERNAL_CASH',
        provenanceCompleteness: 'UNKNOWN',
        provenanceCompletenessStatus: 'UNKNOWN'
      };
    }

    // Provenance is PARTIAL (verification in progress):
    // Verified Total Deposits is shown, but Performance $ and % are NEVER calculated
    // until Josh/admin explicitly certifies account funding completeness.
    if (!isCertifiedComplete) {
      return {
        contributedBasis: decCash.toNumber(),
        totalExternalCashSent: decCash.toNumber(),
        totalPerformanceDollar: null,
        totalPerformancePct: null,
        isProven: false,
        provenanceStatus: 'PARTIAL',
        provenanceCompleteness: 'PARTIAL',
        provenanceCompletenessStatus: 'PARTIAL'
      };
    }

    // ONLY when explicitly certified COMPLETE:
    const totalPerformanceDollar = decBalance.sub(decCash);
    const totalPerformancePct = totalPerformanceDollar.div(decCash).mul(100);

    return {
      contributedBasis: decCash.toNumber(),
      totalExternalCashSent: decCash.toNumber(),
      totalPerformanceDollar: totalPerformanceDollar.toNumber(),
      totalPerformancePct: totalPerformancePct.toNumber(),
      isProven: true,
      provenanceStatus: provenanceOriginType || 'COMPLETE',
      provenanceCompleteness: 'COMPLETE',
      provenanceCompletenessStatus: 'COMPLETE'
    };
  }

  // -------------------------------------------------------------------------
  // LEGACY COMPATIBILITY PATH (old callers passing initialCashContribution, etc.)
  // Maintained during migration. After all callers are updated, this block
  // can be removed.
  // -------------------------------------------------------------------------
  let baseCapital = new Decimal(0);
  let isProven = false;
  let provenanceStatus = 'NO_CONFIRMED_EXTERNAL_CASH';

  if (
    initialCashContribution !== null &&
    initialCashContribution !== undefined &&
    !isNaN(Number(initialCashContribution))
  ) {
    baseCapital = new Decimal(initialCashContribution);
    isProven = true;
    provenanceStatus = provenanceOriginType || 'EXTERNAL_CASH';
  } else if (
    cutoverBaseline !== null &&
    cutoverBaseline !== undefined &&
    !isNaN(Number(cutoverBaseline))
  ) {
    baseCapital = new Decimal(cutoverBaseline);
    isProven = true;
    provenanceStatus = 'CUTOVER_BASELINE';
  }
  // NOTE: starting_capital fallback is INTENTIONALLY REMOVED.
  // starting_capital is the accounting baseline seed, not proven external cash.
  // If no initialCashContribution or cutoverBaseline is provided,
  // performance is UNKNOWN — not fabricated from starting_capital.

  const decDeposits = new Decimal(cumulativeDeposits || 0);
  const totalCashDec = baseCapital.add(decDeposits);

  if (!isProven || totalCashDec.lte(0)) {
    return {
      contributedBasis: 0,
      totalExternalCashSent: 0,
      totalPerformanceDollar: null,
      totalPerformancePct: null,
      isProven: false,
      provenanceStatus: 'NO_CONFIRMED_EXTERNAL_CASH',
      provenanceCompleteness: 'UNKNOWN'
    };
  }

  if (!isCertifiedComplete) {
    return {
      contributedBasis: totalCashDec.toNumber(),
      totalExternalCashSent: totalCashDec.toNumber(),
      totalPerformanceDollar: null,
      totalPerformancePct: null,
      isProven: false,
      provenanceStatus: 'PARTIAL',
      provenanceCompleteness: 'PARTIAL'
    };
  }

  const totalPerformanceDollar = decBalance.sub(totalCashDec);
  const totalPerformancePct = totalCashDec.gt(0)
    ? totalPerformanceDollar.div(totalCashDec).mul(100)
    : null;

  return {
    contributedBasis: totalCashDec.toNumber(),
    totalExternalCashSent: totalCashDec.toNumber(),
    totalPerformanceDollar: totalPerformanceDollar.toNumber(),
    totalPerformancePct: totalPerformancePct !== null ? totalPerformancePct.toNumber() : null,
    isProven: true,
    provenanceStatus: provenanceOriginType || 'COMPLETE',
    provenanceCompleteness: 'COMPLETE'
  };
}

