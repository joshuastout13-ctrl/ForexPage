import Decimal from "decimal.js";

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

/**
 * ===== AUTHORITATIVE CLIENT BUSINESS RULE — DEPOSIT/WITHDRAWAL TIMING =====
 *
 * Client confirmed:
 *   "Withdrawals and deposits only occur on the first so we don't have to prorate anything."
 *
 * Therefore:
 *   DEPOSITS:  effective on first day of month, included in that month's eligible capital.
 *   WITHDRAWALS: effective on first day of month, removed before applying that month's return.
 *   No mid-month proration is implemented or required.
 *
 * Conceptually:
 *   eligibleCapital =
 *     priorEndingBalance
 *     + firstOfMonthDeposits
 *     - firstOfMonthWithdrawals
 *     + applicable credited commissions (per established credit timing)
 *
 *   Then apply monthly return × source share.
 */

function toNum(val, fallback = 0) {
  if (val === null || val === undefined || isNaN(val)) return fallback;
  return new Decimal(val).toNumber();
}

function roundMoney(dec) {
  return dec.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/**
 * Authoritative Centralized Financial Commission Engine
 * 
 * MODEL B (PERCENT OF GROSS PROFIT)
 * 
 * ===== AUTHORITATIVE CLIENT BUSINESS RULES =====
 * 
 * POSITIVE MONTH:
 *   grossResult = eligibleCapital * (grossReturnPct / 100)
 *   Each recipient_i = roundMoney(grossResult * recipientPct_i / 100)
 *   sourceAmount = grossResult - SUM(roundedRecipientAmounts)
 *   Rounding remainder always favors the source/main investor.
 * 
 * ZERO MONTH:
 *   grossResult = 0, sourceAmount = 0, all recipients = 0
 * 
 * NEGATIVE (LOSS) MONTH:
 *   grossResult = eligibleCapital * (grossReturnPct / 100)   [negative]
 *   sourceAmount = grossResult * (sourceSplitPct / 100)      [negative]
 *   ALL recipient commissions = $0.00
 *   Recipients NEVER receive negative commissions.
 *   The source/main investor absorbs only their configured share of the fund loss.
 * 
 * ROUNDING POLICY (Authoritative):
 *   "Send any rounding adjustment in the favor of the investor."
 *   sourceAmount = grossResult - SUM(roundedRecipientAmounts)
 *   This guarantees exact cent reconciliation.
 * 
 * @param {Object} params
 * @param {number} [params.grossProfit] - Total gross result ($), can be negative
 * @param {number} [params.eligibleCapital] - Capital base if grossProfit not direct
 * @param {number} [params.grossReturnPct] - Fund return % if grossProfit not direct
 * @param {number} params.sourceSplitPct - Investor split % (e.g. 50, 65, 70, 75)
 * @param {Array}  params.commissionShares - Active recipient shares
 * @param {number} [params.currencyTolerance=0.05] - Tolerance for pass/flag status in $
 * @param {number} [params.percentageTolerance=0.5] - Tolerance for pass/flag status in %
 */
export function calculateCommissionAllocation({
  grossProfit: inputGrossProfit,
  eligibleCapital = 0,
  grossReturnPct = 0,
  sourceSplitPct = 100,
  commissionShares = [],
  currencyTolerance = 0.05,
  percentageTolerance = 0.5
}) {
  const decSplitPct = new Decimal(sourceSplitPct !== null && sourceSplitPct !== undefined ? sourceSplitPct : 100);
  
  // Calculate Gross Result if not explicitly passed
  let decGrossResult;
  if (inputGrossProfit !== undefined && inputGrossProfit !== null) {
    decGrossResult = new Decimal(inputGrossProfit);
  } else {
    decGrossResult = new Decimal(eligibleCapital).mul(grossReturnPct).div(100);
  }
  decGrossResult = roundMoney(decGrossResult);
  const grossResult = decGrossResult.toNumber();

  // Determine result type
  let resultType;
  if (decGrossResult.isZero()) {
    resultType = "ZERO";
  } else if (decGrossResult.lt(0)) {
    resultType = "LOSS";
  } else {
    resultType = "PROFIT";
  }

  // Calculate effective return percentage if capital was provided
  let sourceEffectiveReturnPct = 0;
  if (grossReturnPct !== 0) {
    sourceEffectiveReturnPct = new Decimal(grossReturnPct).mul(decSplitPct).div(100).toNumber();
  }

  // Build recipient percentage total for configuration audit
  let recipientPctTotal = 0;
  const shares = commissionShares || [];
  shares.forEach(s => {
    recipientPctTotal += toNum(s.commission_percent || s.commissionPercent || s.percent);
  });

  const totalConfiguredPct = toNum((decSplitPct.toNumber() + recipientPctTotal).toFixed(2));
  const unallocatedPct = toNum((100 - totalConfiguredPct).toFixed(2));

  // ========================================================
  // ZERO MONTH — No profit, no loss, no commissions
  // ========================================================
  if (resultType === "ZERO") {
    const recipientBreakdown = shares.map(s => {
      const commPct = toNum(s.commission_percent || s.commissionPercent || s.percent);
      return {
        id: s.id,
        recipientId: s.recipientId || s.recipient_investor_id || s.recipient_id,
        recipientName: s.recipientName || s.recipient_name || s.name || "Recipient",
        recipientUsername: s.recipientUsername || s.recipient_username || s.username || s.recipientId,
        commissionPercent: commPct,
        effectivePctOfGrossProfit: commPct,
        amountReceived: 0,
        effectiveStartDate: s.effectiveStartDate || s.effective_start_date || null,
        effectiveEndDate: s.effectiveEndDate || s.effective_end_date || null,
        status: s.status || "active"
      };
    });

    return {
      resultType: "ZERO",
      grossResult: 0,
      grossProfit: 0, // backward compat alias
      sourceSplitPct: decSplitPct.toNumber(),
      sourceAmount: 0,
      sourceEffectiveReturnPct,
      recipientBreakdown,
      recipientPctTotal: parseFloat(recipientPctTotal.toFixed(2)),
      totalConfiguredPct,
      totalRecipientAmount: 0,
      totalDistributedAmount: 0,
      unallocatedPct,
      unallocatedAmount: 0,
      varianceAmount: 0,
      roundingAdjustment: 0,
      status: "PASS",
      isPass: true,
      flagReason: ""
    };
  }

  // ========================================================
  // LOSS MONTH — Recipients receive $0, source absorbs their share
  // ========================================================
  if (resultType === "LOSS") {
    // Source absorbs only their configured share of the fund loss
    const decSourceAmount = roundMoney(decGrossResult.mul(decSplitPct).div(100));
    const sourceAmount = decSourceAmount.toNumber();

    const recipientBreakdown = shares.map(s => {
      const commPct = toNum(s.commission_percent || s.commissionPercent || s.percent);
      return {
        id: s.id,
        recipientId: s.recipientId || s.recipient_investor_id || s.recipient_id,
        recipientName: s.recipientName || s.recipient_name || s.name || "Recipient",
        recipientUsername: s.recipientUsername || s.recipient_username || s.username || s.recipientId,
        commissionPercent: commPct,
        effectivePctOfGrossProfit: commPct,
        amountReceived: 0, // NEVER negative
        effectiveStartDate: s.effectiveStartDate || s.effective_start_date || null,
        effectiveEndDate: s.effectiveEndDate || s.effective_end_date || null,
        status: s.status || "active"
      };
    });

    return {
      resultType: "LOSS",
      grossResult,
      grossProfit: grossResult, // backward compat alias
      sourceSplitPct: decSplitPct.toNumber(),
      sourceAmount,
      sourceEffectiveReturnPct,
      recipientBreakdown,
      recipientPctTotal: parseFloat(recipientPctTotal.toFixed(2)),
      totalConfiguredPct,
      totalRecipientAmount: 0,
      totalDistributedAmount: sourceAmount, // only the source loss
      unallocatedPct: 0,
      unallocatedAmount: 0,
      varianceAmount: 0,
      roundingAdjustment: 0,
      status: "PASS",
      isPass: true,
      flagReason: "Commissions are $0 during losing months per fund rules."
    };
  }

  // ========================================================
  // PROFIT MONTH — Full Model B allocation with rounding policy
  // ========================================================

  // 1. Calculate each recipient amount individually, rounded to cents
  let decTotalRecipients = new Decimal(0);

  const recipientBreakdown = shares.map((s) => {
    const commPct = toNum(s.commission_percent || s.commissionPercent || s.percent);

    // MODEL B: Direct percentage of gross profit, rounded to cents
    const decRecAmt = roundMoney(decGrossResult.mul(commPct).div(100));
    const recAmt = decRecAmt.toNumber();
    decTotalRecipients = decTotalRecipients.add(decRecAmt);

    return {
      id: s.id,
      recipientId: s.recipientId || s.recipient_investor_id || s.recipient_id,
      recipientName: s.recipientName || s.recipient_name || s.name || "Recipient",
      recipientUsername: s.recipientUsername || s.recipient_username || s.username || s.recipientId,
      commissionPercent: commPct,
      effectivePctOfGrossProfit: commPct,
      amountReceived: recAmt,
      effectiveStartDate: s.effectiveStartDate || s.effective_start_date || null,
      effectiveEndDate: s.effectiveEndDate || s.effective_end_date || null,
      status: s.status || "active"
    };
  });

  // 2. AUTHORITATIVE ROUNDING POLICY:
  //    "Send any rounding adjustment in the favor of the investor."
  //
  //    sourceAmount = grossResult - SUM(roundedRecipientAmounts)
  //
  //    This guarantees:
  //    - sourceAmount + SUM(recipientAmounts) = grossResult exactly to the cent
  //    - Any rounding remainder favors the investor
  //
  //    Only apply this when configured percentages total ~100%.
  //    Otherwise, calculate source naively and report the variance.
  
  const isPctApprox100 = Math.abs(totalConfiguredPct - 100) <= 0.01;
  
  let decSourceAmount;
  let roundingAdjustment = 0;

  if (isPctApprox100) {
    // Rounding-safe: source gets the remainder after all recipients are rounded
    decSourceAmount = decGrossResult.sub(decTotalRecipients);
    
    // Calculate what the naïve source amount would have been for reporting
    const naiveSource = roundMoney(decGrossResult.mul(decSplitPct).div(100));
    roundingAdjustment = decSourceAmount.sub(naiveSource).toNumber();
  } else {
    // Configuration doesn't total 100% — use naïve calculation
    decSourceAmount = roundMoney(decGrossResult.mul(decSplitPct).div(100));
  }

  // 3. Totals & Reconciliation
  let decTotalDistributed = decSourceAmount.add(decTotalRecipients);
  let decUnallocated = decGrossResult.sub(decTotalDistributed);

  const sourceAmount = decSourceAmount.toNumber();
  const totalRecipientAmount = decTotalRecipients.toNumber();
  const totalDistributedAmount = decTotalDistributed.toNumber();
  const unallocatedAmount = decUnallocated.toNumber();
  const varianceAmount = unallocatedAmount;

  // 4. Determine PASS / FLAGGED Status
  const isPct100 = Math.abs(totalConfiguredPct - 100) <= percentageTolerance;
  const isFullyAllocated = Math.abs(unallocatedAmount) <= currencyTolerance;
  const isPass = isPct100 && isFullyAllocated;
  const status = isPass ? "PASS" : "FLAGGED";

  let flagReason = "";
  if (!isPass) {
    if (unallocatedAmount > currencyTolerance) {
      flagReason = `Unallocated pool remaining: $${unallocatedAmount.toFixed(2)} (${unallocatedPct.toFixed(1)}% of gross).`;
    } else if (unallocatedAmount < -currencyTolerance) {
      flagReason = `Total allocations exceed gross profit by $${Math.abs(unallocatedAmount).toFixed(2)} (${Math.abs(unallocatedPct).toFixed(1)}%).`;
    } else {
      flagReason = `Configured allocation total (${totalConfiguredPct}%) does not equal 100%.`;
    }
  }

  return {
    resultType: "PROFIT",
    grossResult,
    grossProfit: grossResult, // backward compat alias
    sourceSplitPct: decSplitPct.toNumber(),
    sourceAmount,
    sourceEffectiveReturnPct,
    recipientBreakdown,
    recipientPctTotal: parseFloat(recipientPctTotal.toFixed(2)),
    totalConfiguredPct,
    totalRecipientAmount,
    totalDistributedAmount,
    unallocatedPct,
    unallocatedAmount,
    varianceAmount,
    roundingAdjustment,
    status,
    isPass,
    flagReason
  };
}
