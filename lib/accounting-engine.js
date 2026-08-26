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

  // 1. Calculate Eligible Capital Base
  const decOpeningBalance = decPriorEnding;
  const decEligibleCapital = decPriorEnding
    .add(decDeposits)
    .sub(decWithdrawals)
    .add(decIncomingCommissions);

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
 * Calculates cumulative external cash deposits contributed by an investor.
 *
 * Authoritative Client Semantics (Josh Aug 2026):
 * Total Deposits = sum of qualifying ADDITIONAL EXTERNAL CASH DEPOSIT transactions
 * within the dashboard's applicable reporting period.
 *
 * EXCLUDE:
 * - starting capital
 * - cutover/opening baseline
 * - referral commissions
 * - commission capitalization
 * - internal balance adjustments
 * - migration/seed capital
 * - VOID/cancelled deposits
 * - future-period deposits outside the displayed reporting scope.
 *
 * Uses Decimal.js for precise cent math.
 */
export function calculateTotalDeposits({
  baselineCashIn = 0,
  startingCapital = 0,
  depositRows = [],
  targetYear = null,
  maxMonth = null,
  accountStartDate = null
} = {}) {
  let total = new Decimal(0);

  (depositRows || []).forEach(d => {
    const typeStr = String(d.type || '').toUpperCase();
    const statusStr = String(d.status || '').toUpperCase();
    if (typeStr === 'VOID' || statusStr === 'VOID' || statusStr === 'CANCELLED' || typeStr === 'COMMISSION' || d.is_commission || d.iscommission) {
      return;
    }

    if (targetYear !== null && targetYear !== undefined) {
      const dYear = Number(d.effective_year || d.year || (d.date ? new Date(d.date).getUTCFullYear() : targetYear));
      if (dYear !== targetYear) return;
    }

    if (maxMonth !== null && maxMonth !== undefined) {
      const dMonth = Number(d.month_number || d.monthno || (d.date ? new Date(d.date).getUTCMonth() + 1 : 1));
      if (dMonth > maxMonth) return;
    }

    const amt = new Decimal(d.amount || d.Amount || 0);
    if (amt.isPositive() && !amt.isZero()) {
      total = total.add(amt);
    }
  });

  return total.toNumber();
}

