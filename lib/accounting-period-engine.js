import Decimal from "decimal.js";
import crypto from "crypto";
import { calculateInvestorMonth } from "./accounting-engine.js";
import { getApplicableCommissionShares } from "./commission-utils.js";

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

function toNum(val, fallback = 0) {
  if (val === null || val === undefined || isNaN(val)) return fallback;
  return new Decimal(val).toNumber();
}

/**
 * Monthly Accounting Period Engine
 * 
 * Computes complete proposed monthly accounting run for all active investors in memory.
 * Performs zero database writes.
 */
export function calculateAccountingPeriod({
  year,
  month,
  fundReturnPct = null,
  returnSource = "MYFXBOOK_LIVE",
  returnStatus = "OPEN",
  capturedAt = new Date().toISOString(),
  investors = [],
  accounts = [],
  deposits = [],
  withdrawals = [],
  commissionShares = [],
  monthlyHistory = [],
  commissionEarnings = [],
  monthlyReturns = []
}) {
  const periodStartStr = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDayNum = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const periodEndStr = `${year}-${String(month).padStart(2, '0')}-${String(lastDayNum).padStart(2, '0')}`;

  // 1. Resolve Monthly Return %
  let periodFundReturnPct = fundReturnPct;
  let resolvedSource = returnSource;
  let resolvedStatus = returnStatus;
  let resolvedCapturedAt = capturedAt;

  if (periodFundReturnPct === null || periodFundReturnPct === undefined) {
    const foundReturn = (monthlyReturns || []).find(
      r => toNum(r.year || r.Year) === year && toNum(r.month_number || r.monthNumber || r.month) === month
    );
    if (foundReturn) {
      periodFundReturnPct = toNum(foundReturn.gross_return_pct ?? foundReturn.grossreturn ?? foundReturn.return, 0);
      resolvedSource = foundReturn.source || "DATABASE_MONTHLY_RETURNS";
      resolvedStatus = foundReturn.status || "OPEN";
      resolvedCapturedAt = foundReturn.captured_at || foundReturn.last_updated || new Date().toISOString();
    }
  }

  const isMissingReturn = periodFundReturnPct === null || periodFundReturnPct === undefined;
  const effectiveReturnPct = periodFundReturnPct !== null ? periodFundReturnPct : 0;

  // 2. Identify incoming commissions earned in Month N-1 (credits to Month N capital)
  const prevYear = month === 1 ? year - 1 : year;
  const prevMonthNum = month === 1 ? 12 : month - 1;

  const incomingCommissionsByRecipient = {};
  (commissionEarnings || []).forEach(e => {
    const eYear = toNum(e.year);
    const eMonth = toNum(e.month_number || e.month);
    if (eYear === prevYear && eMonth === prevMonthNum) {
      const recId = String(e.recipient_id || e.recipient_investor_id || '').toLowerCase();
      if (recId) {
        incomingCommissionsByRecipient[recId] = (incomingCommissionsByRecipient[recId] || new Decimal(0)).add(toNum(e.amount));
      }
    }
  });

  // 3. Map deposits and withdrawals for Month N
  const depositsByInvestor = {};
  const nonFirstDayCashflows = [];
  const depositKeys = new Set();
  const duplicateDeposits = [];

  (deposits || []).forEach(d => {
    if (String(d.type || '').toUpperCase() === 'VOID') return;
    const effDateStr = d.effective_accounting_date || d.effective_date;
    const dDateStr = String(effDateStr || d.date || d.created_at || '').slice(0, 10);
    if (!dDateStr) return;

    const dDate = new Date(dDateStr);
    const dYear = dDate.getUTCFullYear();
    const dMonth = dDate.getUTCMonth() + 1;
    const dDay = dDate.getUTCDate();

    if (dYear === year && dMonth === month) {
      const invId = String(d.investor_id || d.investorid || d.id || '').toLowerCase();
      const amt = toNum(d.amount);
      
      if (invId) {
        depositsByInvestor[invId] = (depositsByInvestor[invId] || new Decimal(0)).add(amt);
      }

      if (dDay !== 1) {
        nonFirstDayCashflows.push({ type: 'DEPOSIT', investorId: invId, date: dDateStr, amount: amt });
      }

      const dupKey = `${invId}_${dDateStr}_${amt}`;
      if (depositKeys.has(dupKey)) {
        duplicateDeposits.push({ investorId: invId, date: dDateStr, amount: amt });
      } else {
        depositKeys.add(dupKey);
      }
    }
  });

  const withdrawalsByInvestor = {};
  const withdrawalKeys = new Set();
  const duplicateWithdrawals = [];

  (withdrawals || []).forEach(w => {
    const status = String(w.status || '').toLowerCase();
    if (status === 'cancelled' || status === 'rejected') return;

    const effDateStr = w.effective_accounting_date || w.effective_date;
    const wDateStr = String(effDateStr || w.request_date || w.date || w.created_at || '').slice(0, 10);
    let wYear = year;
    let wMonth = month;

    if (effDateStr) {
      const d = new Date(effDateStr);
      wYear = d.getUTCFullYear();
      wMonth = d.getUTCMonth() + 1;
    } else if (w.effective_year || w.year) {
      wYear = toNum(w.effective_year || w.year);
      if (w.month_number || w.month) {
        wMonth = toNum(w.month_number || w.month);
      }
    } else if (wDateStr) {
      const d = new Date(wDateStr);
      wYear = d.getUTCFullYear();
      wMonth = d.getUTCMonth() + 1;
    }

    if (wYear === year && wMonth === month) {
      const invId = String(w.investor_id || w.investorid || w.id || '').toLowerCase();
      const amt = toNum(w.amount);

      if (invId) {
        withdrawalsByInvestor[invId] = (withdrawalsByInvestor[invId] || new Decimal(0)).add(amt);
      }

      if (wDateStr && new Date(wDateStr).getUTCDate() !== 1) {
        nonFirstDayCashflows.push({ type: 'WITHDRAWAL', investorId: invId, date: wDateStr, amount: amt });
      }

      const dupKey = `${invId}_${wDateStr}_${amt}`;
      if (withdrawalKeys.has(dupKey)) {
        duplicateWithdrawals.push({ investorId: invId, date: wDateStr, amount: amt });
      } else {
        withdrawalKeys.add(dupKey);
      }
    }
  });

  // 4. Calculate for each investor
  const calculatedInvestors = [];
  let grossEligibleCapital = new Decimal(0);
  let totalGrossFundResult = new Decimal(0);
  let totalSourceGainLoss = new Decimal(0);
  let totalRecipientCommissions = new Decimal(0);
  let passCount = 0;
  let flaggedCount = 0;

  const activeInvestors = (investors || []).filter(i => i.active !== false && i.active !== 'false');

  for (const inv of activeInvestors) {
    const rawInvId = String(inv.id || '').trim();
    const username = String(inv.portal_username || inv.portalusername || inv.username || '').trim();
    const invIdLower = rawInvId.toLowerCase();
    const usernameLower = username.toLowerCase();

    const name = [inv.first_name || inv.firstname, inv.last_name || inv.lastname].filter(Boolean).join(' ') || inv.name || rawInvId;

    let priorEndingBalance = 0;
    const invHistory = (monthlyHistory || []).filter(
      h => String(h.investor_id || h.investorid || '').toLowerCase() === invIdLower ||
           String(h.investor_id || h.investorid || '').toLowerCase() === usernameLower
    );

    const prevHist = invHistory.find(h => toNum(h.year) === prevYear && toNum(h.month_number) === prevMonthNum);
    
    const invAccs = (accounts || []).filter(
      a => String(a.investor_id || a.investorid || '').toLowerCase() === invIdLower ||
           String(a.investor_id || a.investorid || '').toLowerCase() === usernameLower
    );

    if (prevHist && prevHist.ending_balance !== null && prevHist.ending_balance !== undefined) {
      priorEndingBalance = toNum(prevHist.ending_balance);
    } else {
      if (invAccs.length > 0) {
        priorEndingBalance = invAccs.reduce((sum, a) => sum + toNum(a.starting_capital || a.startingcapital || a.capital), 0);
      }
    }

    const idSet = new Set([
      invIdLower,
      usernameLower,
      ...invAccs.map(a => String(a.id || '').toLowerCase())
    ].filter(Boolean));

    const applicableShares = getApplicableCommissionShares({
      shares: commissionShares || [],
      year,
      month,
      sourceIdSet: idSet
    });

    const recPairCounts = {};
    let hasOverlap = false;
    applicableShares.forEach(s => {
      const rec = String(s.recipient_investor_id || s.recipient_id || '').toLowerCase();
      recPairCounts[rec] = (recPairCounts[rec] || 0) + 1;
      if (recPairCounts[rec] > 1) hasOverlap = true;
    });

    let incomingCommDec = new Decimal(0);
    idSet.forEach(alias => {
      if (incomingCommissionsByRecipient[alias]) {
        incomingCommDec = incomingCommDec.add(incomingCommissionsByRecipient[alias]);
      }
    });

    let depsDec = new Decimal(0);
    idSet.forEach(alias => {
      if (depositsByInvestor[alias]) {
        depsDec = depsDec.add(depositsByInvestor[alias]);
      }
    });

    let wdsDec = new Decimal(0);
    idSet.forEach(alias => {
      if (withdrawalsByInvestor[alias]) {
        wdsDec = wdsDec.add(withdrawalsByInvestor[alias]);
      }
    });

    const sourceSplitPct = inv.split_pct !== null && inv.split_pct !== undefined
      ? toNum(inv.split_pct)
      : (inv.splitPct !== undefined ? toNum(inv.splitPct) : null);

    const recurringDraw = toNum(inv.monthly_draw || inv.monthlydraw || inv.recurring_draw || 0);

    const result = calculateInvestorMonth({
      year,
      month,
      investorId: rawInvId || username,
      startDate: inv.start_date || inv.startdate || null,
      priorEndingBalance,
      deposits: depsDec.toNumber(),
      withdrawals: wdsDec.toNumber(),
      priorMonthIncomingCommissions: incomingCommDec.toNumber(),
      fundReturnPct: effectiveReturnPct,
      sourceSplitPct: sourceSplitPct !== null ? sourceSplitPct : 100,
      commissionShares: applicableShares,
      recurringDraw
    });

    const flags = [];

    if (isMissingReturn) flags.push("MISSING_RETURN");
    if (sourceSplitPct === null) flags.push("MISSING_SOURCE_SPLIT");
    if (hasOverlap) flags.push("OVERLAPPING_RULES");
    if (result.eligibleCapital < 0) flags.push("NEGATIVE_ELIGIBLE_CAPITAL");
    if (result.endingBalance < 0) flags.push("NEGATIVE_ENDING_BALANCE");

    if (result.resultType === "PROFIT") {
      if (result.configuredAllocationPct < 99.99) flags.push("UNDER_ALLOCATED_RULES");
      else if (result.configuredAllocationPct > 100.01) flags.push("OVER_ALLOCATED_RULES");
    }

    const nonFirstDaysForInv = nonFirstDayCashflows.filter(
      c => c.investorId === invIdLower || c.investorId === usernameLower
    );
    if (nonFirstDaysForInv.length > 0) flags.push("NON_FIRST_DAY_CASHFLOW");

    let status = flags.length === 0 && result.reconciliation.status === "PASS" ? "PASS" : "FLAGGED";
    let flagReason = flags.length > 0 ? flags.join(", ") : result.reconciliation.reason;

    if (status === "PASS") passCount++;
    else flaggedCount++;

    grossEligibleCapital = grossEligibleCapital.add(result.eligibleCapital);
    totalGrossFundResult = totalGrossFundResult.add(result.grossFundResult);
    totalSourceGainLoss = totalSourceGainLoss.add(result.sourceGainLoss);
    totalRecipientCommissions = totalRecipientCommissions.add(result.totalRecipientCommissions);

    calculatedInvestors.push({
      investorId: rawInvId || username,
      username,
      name,
      splitPct: sourceSplitPct,
      startDate: inv.start_date || null,
      priorEndingBalance: result.openingBalance,
      deposits: result.deposits,
      withdrawals: result.withdrawals,
      incomingCommissionCredit: result.incomingCommissionCredits,
      eligibleCapital: result.eligibleCapital,
      fundReturnPct: result.fundReturnPct,
      effectiveReturnPct: result.effectiveInvestorReturnPct,
      grossFundResult: result.grossFundResult,
      sourceGainLoss: result.sourceGainLoss,
      recipientAllocations: result.recipientAllocations,
      totalRecipientCommissions: result.totalRecipientCommissions,
      endingBeforeDraw: result.endingBeforeDraw,
      recurringDraw: result.recurringDraw,
      endingBalance: result.endingBalance,
      status,
      flagReason,
      flags,
      roundingAdjustment: result.roundingAdjustment
    });
  }

  // Generate deterministic Input Fingerprint (inputHash)
  const inputHashPayload = {
    year,
    month,
    effectiveReturnPct,
    investorsCount: activeInvestors.length,
    calculatedInvestors: calculatedInvestors.map(i => ({
      id: i.investorId,
      prior: i.priorEndingBalance,
      deps: i.deposits,
      wds: i.withdrawals,
      comm: i.incomingCommissionCredit,
      split: i.splitPct,
      end: i.endingBalance
    }))
  };

  const inputHash = crypto
    .createHash("sha256")
    .update(JSON.stringify(inputHashPayload))
    .digest("hex");

  const previewRunId = `preview_${crypto.randomUUID ? crypto.randomUUID() : Date.now()}`;
  const generatedAt = new Date().toISOString();
  const canFinalize = flaggedCount === 0 && !isMissingReturn && inputHash !== null;

  return {
    previewRunId,
    previewStatus: "SHADOW_ONLY",
    generatedAt,
    inputHash,
    canFinalize,
    period: {
      year,
      month,
      startDate: periodStartStr,
      endDate: periodEndStr
    },
    fundReturnPct: effectiveReturnPct,
    returnSource: resolvedSource,
    returnStatus: resolvedStatus,
    returnCapturedAt: resolvedCapturedAt,
    summary: {
      investorsCalculated: calculatedInvestors.length,
      grossEligibleCapital: grossEligibleCapital.toNumber(),
      totalGrossFundResult: totalGrossFundResult.toNumber(),
      totalSourceGainLoss: totalSourceGainLoss.toNumber(),
      totalRecipientCommissions: totalRecipientCommissions.toNumber(),
      passCount,
      flaggedCount,
      canFinalize
    },
    investors: calculatedInvestors
  };
}
