import { readSheet, num, bool, monthNum, filterInvestors } from "./sheets.js";
import { readSupabaseTable, normalizeRow, isAuthoritativeProductionDbConfigured } from "./supabase.js";
import { CONFIG } from "./config.js";
import { getMyfxbookLive } from "./myfxbook.js";
import { getApplicableCommissionShare, getApplicableCommissionShares } from "./commission-utils.js";
import { calculateTotalDeposits, calculateLifetimePerformance } from "./accounting-engine.js";

import Decimal from "decimal.js";
Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

function pctToNum(s) {
  return num(String(s || "").replace(/[%\s]/g, ""), 0);
}

function precise(val) {
  return new Decimal(val || 0).toNumber();
}

function roundMoney(d) {
  return new Decimal(d || 0).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/**
 * Builds the full dashboard payload for a given investor ID.
 * 
 * @param {string} investorId - Target investor ID or username.
 * @param {Object} [preloadedData=null] - Optional preloaded data bundle.
 * @param {Object} [options={}] - Options object.
 * @param {boolean} [options.mustBeAuthoritative=false] - When true, strictly requires authoritative production Supabase connection and aborts on non-authoritative fallback.
 */
export async function buildInvestorDashboard(investorId, preloadedData = null, options = {}) {
  const { mustBeAuthoritative = false } = options || {};
  const id = String(investorId ?? "").trim();
  if (!id) throw Object.assign(new Error("Missing investor ID"), { status: 400 });

  const useSupabase = process.env.DATA_SOURCE === "supabase";
  const isAuthoritative = isAuthoritativeProductionDbConfigured();

  if (mustBeAuthoritative && (!useSupabase || !isAuthoritative)) {
    throw new Error("AUTHORITATIVE_PRODUCTION_DB_UNAVAILABLE: Financial preflight or calculation requires authoritative production database (julhldzkiqdeuuoqmvlo), but it is not configured or connected.");
  }

  let rawInvestors, accounts, returnsSheet, depositsSheet, withdrawalsSheet, live;
  let historyTable = [];
  let commissionEarningsTable = [];
  let commissionSharesTable = [];
  let commissionRulesTable = [];
  let cutoverTable = [];

  if (preloadedData) {
    ({ rawInvestors, accounts, returnsSheet, depositsSheet, withdrawalsSheet, historyTable, commissionEarningsTable, commissionSharesTable, commissionRulesTable, cutoverAdjustments: cutoverTable, cutovers: cutoverTable, live } = preloadedData);
    if (useSupabase) {
      if (rawInvestors) rawInvestors = rawInvestors.map(normalizeRow);
      if (accounts) accounts = accounts.map(normalizeRow);
      if (returnsSheet) returnsSheet = returnsSheet.map(normalizeRow);
      if (depositsSheet) depositsSheet = depositsSheet.map(normalizeRow);
      if (withdrawalsSheet) withdrawalsSheet = withdrawalsSheet.map(normalizeRow);
      if (historyTable) historyTable = historyTable.map(normalizeRow);
      if (commissionEarningsTable) commissionEarningsTable = commissionEarningsTable.map(normalizeRow);
      if (commissionSharesTable) commissionSharesTable = commissionSharesTable.map(normalizeRow);
      if (commissionRulesTable) commissionRulesTable = commissionRulesTable.map(normalizeRow);
      if (cutoverTable) cutoverTable = cutoverTable.map(normalizeRow);
    }
  } else if (useSupabase) {
    console.log(`[Dashboard] Loading data from Supabase for investor ${id}`);
    const [invs, accs, rets, deps, wds, hist, commE, commS, commR, liveData, cuts] = await Promise.all([
      readSupabaseTable("investors"),
      readSupabaseTable("investor_accounts"),
      readSupabaseTable("monthly_returns"),
      readSupabaseTable("deposits"),
      readSupabaseTable("withdrawals"),
      readSupabaseTable("investor_monthly_history"),
      readSupabaseTable("commission_earnings"),
      readSupabaseTable("commission_shares"),
      readSupabaseTable("commission_rules"),
      getMyfxbookLive(),
      readSupabaseTable("account_cutover_adjustments").catch(() => [])
    ]);
    rawInvestors = invs;
    accounts = accs;
    returnsSheet = rets;
    depositsSheet = deps;
    withdrawalsSheet = wds;
    historyTable = hist;
    commissionEarningsTable = commE;
    commissionSharesTable = commS;
    commissionRulesTable = commR;
    live = liveData;
    cutoverTable = cuts || [];
  } else {
    console.log(`[Dashboard] Loading data from Google Sheets for investor ${id}`);
    [rawInvestors, accounts, returnsSheet, depositsSheet, withdrawalsSheet, live] = await Promise.all([
      readSheet(CONFIG.tabs.investors),
      readSheet(CONFIG.tabs.investorAccounts),
      readSheet(CONFIG.tabs.monthlyReturns),
      readSheet(CONFIG.tabs.deposits),
      readSheet(CONFIG.tabs.withdrawals),
      getMyfxbookLive()
    ]);
    historyTable = [];
    commissionEarningsTable = [];
    commissionSharesTable = [];
    commissionRulesTable = [];
    cutoverTable = [];
  }

  const investors = filterInvestors(rawInvestors);


  // 1. Find the investor (case-insensitive, matching by username or internal ID)
  const targetId = id.toLowerCase();
  const investor = investors.find((r) => {
    const rowUser = String(r.portalusername ?? r.username ?? "").trim().toLowerCase();
    const rowId = String(r.investorsinvestorid ?? r.investorid ?? r.id ?? "").trim().toLowerCase();
    return rowUser === targetId || rowId === targetId;
  });
  
  if (!investor) {
    throw Object.assign(new Error(`Investor not found: "${id}"`), { status: 404 });
  }

  // 2. Resolve Internal ID (Used for filtering other tabs)
  // Mapping based on "Investors Investor ID" or "Investor ID"
  const internalId = String(
    investor.investorsinvestorid ?? investor.investorid ?? investor.id ?? investor.portalusername ?? ""
  ).trim();

  const investorIdSet = new Set([
    internalId,
    investor.id,
    investor.portalusername,
    investor.portal_username,
    investor.username,
    investor.email,
    investor.portal_email,
    investor.investorsinvestorid,
    investor.investorid
  ].filter(Boolean).map(s => String(s).trim().toLowerCase()));

  // 3. Aggregate Starting Capital from Investor_Accounts
  const investorAccounts = accounts.filter(
    (r) => String(r.investorid ?? r.id ?? "").trim() === internalId
  );
  let startCapital = 0;
  const activeAccounts = investorAccounts.filter((r) => bool(r.status ?? r.Status));
  
  if (activeAccounts.length > 0) {
    startCapital = activeAccounts.reduce((sum, r) => sum + num(r.startingcapital ?? r.capital ?? r.Amount), 0);
  } else if (investorAccounts.length > 0) {
    // Fallback to first matching account if none are explicitly "Active"
    startCapital = num(investorAccounts[0].startingcapital ?? investorAccounts[0].capital ?? investorAccounts[0].Amount);
  }

  // 4. Setup Investor metadata
  const splitPct = num(investor.investorsplit ?? investor.investorsplitpct ?? investor.split, 100);
  const recurringDraw = num(investor.recurringmonthlydraw ?? investor.monthlydraw, 0);
  const startDateStr = String(investor.opendate ?? investor.startdate ?? investor.date ?? "");
  // Force parsing as UTC mid-day to avoid timezone drift (e.g. March 1st becoming Feb 28th)
  let startDate = null;
  if (startDateStr) {
    const d = new Date(startDateStr);
    if (!isNaN(d.getTime())) {
      startDate = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12, 0, 0));
    }
  }

  const firstName = String(investor.firstname ?? "").trim();
  const lastName = String(investor.lastname ?? "").trim();
  const displayName = [firstName, lastName].filter(Boolean).join(" ") || String(investor.name ?? id).trim();

  // 5. Map returns, deposits, and withdrawals
  const targetYear = CONFIG.defaultFundYear;
  const monthlyHistory = returnsSheet
    .filter((r) => {
      const rowYear = num(r.monthlyreturnsgrossfundreturnsbeforeinvestorsplityear ?? r.year ?? r.Year);
      return rowYear === targetYear;
    })
    .map((r) => ({
      month: String(r.Month ?? r.month ?? "").trim(),
      monthNumber: monthNum(r),
      grossReturnPct: num(r.gross_return_pct ?? r.grossreturn ?? r.grossreturnpct ?? r.return, 0)
    }))
    .filter((r) => r.monthNumber >= 1 && r.monthNumber <= 12)
    .sort((a, b) => a.monthNumber - b.monthNumber);

  const depByMonth = {};
  const commDepByMonthRaw = {};
  depositsSheet.forEach((r) => {
    if (String(r.investorid ?? r.id ?? "").trim() !== internalId) return;
    if (String(r.type ?? "").toUpperCase() === "VOID") return;
    const m = monthNum(r);
    if (m >= 1 && m <= 12) {
      const amt = num(r.amount ?? r.Amount, 0);
      depByMonth[m] = (depByMonth[m] || 0) + amt;
      if (r.is_commission || r.iscommission) {
        commDepByMonthRaw[m] = (commDepByMonthRaw[m] || 0) + amt;
      }
    }
  });

  // Adjust depByMonth so only the regular deposit is used for balance calculations.
  const commDepByMonth = commDepByMonthRaw;
  Object.keys(commDepByMonth).forEach(m => {
    depByMonth[m] = (depByMonth[m] || 0) - commDepByMonth[m];
  });

  const wdByMonth = {};
  const pendingWdByMonth = {};
  withdrawalsSheet.forEach((r) => {
    if (String(r.investorid ?? r.id ?? "").trim() !== internalId) return;
    
    // Check year if column exists, otherwise assume current year
    const wdYear = num(r.effectiveyear ?? r.year ?? targetYear);
    if (wdYear !== targetYear) return;

    const m = monthNum(r);
    const status = String(r.status ?? r.Status ?? "active").toLowerCase();
    const isPending = status === "pending";
    const isCancelled = status === "cancelled";
    
    if (m >= 1 && m <= 12 && !isCancelled) {
      if (isPending) {
        pendingWdByMonth[m] = (pendingWdByMonth[m] || 0) + num(r.amount ?? r.Amount, 0);
      } else {
        wdByMonth[m] = (wdByMonth[m] || 0) + num(r.amount ?? r.Amount, 0);
      }
    }
  });

  const historyRecords = (historyTable || []).filter(r => String(r.investor_id || r.investorid || "").trim() === internalId && num(r.year) === targetYear);

  // 5. Compounding Logic with High-Precision Decimal math
  let balance = new Decimal(startCapital);
  let totalGain = new Decimal(0);
  let totalWithdrawals = new Decimal(0);
  let summaryBalance = new Decimal(startCapital); // The "Current" balance for summary card
  const decSplitPct = new Decimal(splitPct);
  const decRecurringDraw = new Decimal(recurringDraw);

  const ptString = new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" });
  const now = new Date(ptString);
  const currentMonthIdx = now.getMonth() + 1; // 1-12
  const currentYearIdx = now.getFullYear();

  const breakdown = [];
  let investorCompoundedYtd = new Decimal(1);

  for (const row of monthlyHistory) {
    const m = row.monthNumber;
    
    // Start date check (Zero rows before investor starts)
    const isStarted = !startDate || (targetYear > startDate.getUTCFullYear()) || 
                      (targetYear === startDate.getUTCFullYear() && m >= (startDate.getUTCMonth() + 1));

    if (!isStarted) {
      breakdown.push({
        month: row.month, monthNumber: m, grossReturnPct: 0, effectiveReturnPct: 0,
        startingBalance: 0, gain: 0, recurringDraw: 0, oneTimeWithdrawal: 0, deposits: 0, endingBalance: 0
      });
      continue;
    }

    const deps = new Decimal(depByMonth[m] || 0);
    const wds = new Decimal(wdByMonth[m] || 0);
    const pendingWds = new Decimal(pendingWdByMonth[m] || 0);
    const grossPct = new Decimal(row.grossReturnPct || 0);

    let effPct = grossPct.mul(decSplitPct).div(100);
    let isManual = false;

    // Check for manual history override
    const historyRow = historyRecords.find(hr => hr.month_number === m);
    
    // Calculation order per TASK 3:
    // 1. prior ending balance (balance)
    // 2. + deposits (deps)
    // 3. - approved/completed withdrawals (wds)
    // 4. apply gross return x split %
    // 5. - recurring draw
    const startingBal = historyRow ? new Decimal(historyRow.opening_balance || 0) : balance;
    const adjustedStart = historyRow 
      ? new Decimal(historyRow.opening_balance || 0).add(historyRow.deposits || 0).sub(historyRow.withdrawals || 0)
      : balance.add(deps).sub(wds);

    let gain = new Decimal(0);
    let ending = new Decimal(0);

    if (historyRow) {
      // If we have a historical record, it takes priority
      const manualGainBasis = adjustedStart;
      if (historyRow.manual_gain_amount !== null && historyRow.manual_gain_amount !== undefined) {
        gain = new Decimal(historyRow.manual_gain_amount || 0);
      } else {
        const returnPct = (historyRow.manual_return_pct !== null && historyRow.manual_return_pct !== undefined)
          ? new Decimal(historyRow.manual_return_pct)
          : effPct;
        gain = manualGainBasis.mul(returnPct).div(100);
      }
      ending = new Decimal(historyRow.ending_balance || 0);
      isManual = bool(historyRow.is_manual ?? historyRow.ismanual);
    } else {
      // Standard high-precision calculation
      gain = adjustedStart.mul(effPct).div(100);
      ending = Decimal.max(0, adjustedStart.add(gain).sub(decRecurringDraw));
    }

    // ONLY accumulate summary metrics for months that have occurred (Historical or Current)
    const isPastOrCurrent = (targetYear < currentYearIdx) || (targetYear === currentYearIdx && m <= currentMonthIdx);
    const isHistoricalCompleted = (targetYear < currentYearIdx) || (targetYear === currentYearIdx && m < currentMonthIdx);
    const isOpenMonth = (targetYear === currentYearIdx && m === currentMonthIdx);
    const isHistoricalOrCurrent = isPastOrCurrent || (historyRow && isManual);

    // Authoritative Open-Month Rule:
    // In an open month, unclosed trading gains remain live/informational only.
    // They must NOT be booked into settled accounting (Current Balance, Total Gain YTD,
    // Total Performance, or settled breakdown Net Return/Gain).
    let settledGain = gain;
    let settledEffPct = (isManual && historyRow && historyRow.manual_return_pct !== null && historyRow.manual_return_pct !== undefined ? new Decimal(historyRow.manual_return_pct) : effPct).toNumber();
    let settledGrossPct = grossPct.toNumber();

    if (isOpenMonth && !(historyRow && isManual)) {
      settledGain = new Decimal(0);
      settledEffPct = 0;
      settledGrossPct = 0;
      ending = Decimal.max(0, adjustedStart.sub(decRecurringDraw));
    }
    
    if (isHistoricalOrCurrent) {
      // Only completed historical months add to settled Total Gain YTD and compound into investor YTD
      if (isHistoricalCompleted || (historyRow && isManual && !isOpenMonth)) {
        totalGain = totalGain.add(gain);
        const currentEffPct = isManual && historyRow.manual_return_pct !== null && historyRow.manual_return_pct !== undefined ? new Decimal(historyRow.manual_return_pct) : effPct;
        if (isStarted) {
          investorCompoundedYtd = investorCompoundedYtd.mul(new Decimal(1).add(currentEffPct.div(100)));
        }
      }
      
      // Prioritize manual history values for the summary card if they exist
      const effectiveWd = historyRow ? new Decimal(historyRow.withdrawals || 0) : wds;
      const effectiveDraw = historyRow ? new Decimal(historyRow.recurring_draw || 0) : (ending.gt(0) || decRecurringDraw.gt(0) ? decRecurringDraw : new Decimal(0));
      
      totalWithdrawals = totalWithdrawals.add(effectiveWd).add(effectiveDraw);
      summaryBalance = ending;
    }
    
    // Calculate commissions earned in THIS month using canonical Decimal cent arithmetic
    let commissionsEarned = new Decimal(0);
    if (commissionEarningsTable && commissionEarningsTable.length > 0) {
      const monthlyComms = commissionEarningsTable.filter(r => {
        const recId = String(r.recipient_id || r.recipientid || r.recipient_investor_id || "").trim().toLowerCase();
        return (recId === internalId.toLowerCase() || (investorIdSet && investorIdSet.has(recId))) && 
          num(r.year) === targetYear && 
          num(r.month_number) === m;
      });
      commissionsEarned = monthlyComms.reduce((sum, r) => 
        sum.add(roundMoney(r.amount)), 
        new Decimal(0)
      );
    }
    // Add manual commission deposits
    if (commDepByMonth[m]) {
      commissionsEarned = commissionsEarned.add(roundMoney(commDepByMonth[m]));
    }
    commissionsEarned = roundMoney(commissionsEarned);

    // Commission month-close rule:
    // Open-month commissions are still accruing intramonth and are not yet finalized or capitalized.
    // Future projection rows must not capitalize open-month commission prematurely.
    let displayCommissionsEarned = commissionsEarned.toNumber();
    if (isOpenMonth && !(historyRow && isManual)) {
      displayCommissionsEarned = 0;
    }

    breakdown.push({
      month: row.month,
      monthNumber: m,
      grossReturnPct: settledGrossPct,
      effectiveReturnPct: settledEffPct,
      startingBalance: startingBal.toNumber(),
      adjustedStartingBalance: adjustedStart.toNumber(),
      gain: settledGain.toNumber(),
      commissionsEarned: displayCommissionsEarned,
      recurringDraw: decRecurringDraw.toNumber(),
      oneTimeWithdrawal: wds.toNumber(),
      pendingWithdrawal: pendingWds.toNumber(),
      deposits: deps.toNumber(),
      endingBalance: ending.toNumber(),
      isHistoricalCompleted,
      isOpenMonth,
      isProjection: !isHistoricalOrCurrent,
      isManual
    });

    // For compounding: Add commissions earned THIS month to NEXT month's starting balance
    // In an open month, unclosed commission is NOT added into future projection starting balance
    balance = ending.add(displayCommissionsEarned);
  }

  // 6. Live Performance Dollar Gains & Canonical Account Performance (Net Investor Share)
  const currentMonthBreakdown = breakdown.find(r => r.monthNumber === currentMonthIdx);
  const liveBase = currentMonthBreakdown ? (currentMonthBreakdown.adjustedStartingBalance ?? 0) : (summaryBalance ? summaryBalance.toNumber() : 0);
  const investorYtdPct = investorCompoundedYtd.sub(1).mul(100).toNumber();

  const safeLive = live || {};
  const lastMonthNum = currentMonthIdx === 1 ? 12 : currentMonthIdx - 1;
  const lastMonthRow = monthlyHistory.find(r => r.monthNumber === lastMonthNum);
  const lastBreakdownRow = breakdown.find(r => r.monthNumber === lastMonthNum);

  const lastMonthPctNum = lastMonthRow ? Number(lastMonthRow.grossReturnPct || 0) : 0;
  safeLive.lastMonth = `${lastMonthPctNum >= 0 ? "+" : ""}${lastMonthPctNum.toFixed(2)}%`;

  const weekPctVal = pctToNum(safeLive.week);
  let monthPctVal = pctToNum(safeLive.month);
  if (monthPctVal === 0 && weekPctVal > 0) {
    monthPctVal = weekPctVal;
    safeLive.month = `${monthPctVal >= 0 ? "+" : ""}${monthPctVal.toFixed(2)}%`;
  }

  // Multiplier for investor split (e.g. 50% split -> 0.50)
  const decSplitMultiplier = new Decimal(splitPct || 0).div(100);

  const todayGrossPct = pctToNum(safeLive.today);
  const weekGrossPct = weekPctVal;
  const monthGrossPct = monthPctVal;
  const lastMonthGrossPct = lastMonthPctNum;
  const yearGrossPct = pctToNum(safeLive.year);

  // Canonical Net Dollar Earnings
  const todayNetDollar = new Decimal(liveBase || 0).mul(todayGrossPct).div(100).mul(decSplitMultiplier).toNumber();
  const weekNetDollar = new Decimal(liveBase || 0).mul(weekGrossPct).div(100).mul(decSplitMultiplier).toNumber();
  const monthNetDollar = new Decimal(liveBase || 0).mul(monthGrossPct).div(100).mul(decSplitMultiplier).toNumber();
  const lastMonthNetDollar = lastBreakdownRow ? (lastBreakdownRow.gain || 0) : new Decimal(liveBase || 0).mul(lastMonthGrossPct).div(100).mul(decSplitMultiplier).toNumber();
  const yearNetDollar = totalGain ? totalGain.toNumber() : 0;

  // Canonical Net Return Percentages
  const todayNetPct = new Decimal(todayGrossPct).mul(decSplitMultiplier).toNumber();
  const weekNetPct = new Decimal(weekGrossPct).mul(decSplitMultiplier).toNumber();
  const monthNetPct = new Decimal(monthGrossPct).mul(decSplitMultiplier).toNumber();
  const lastMonthNetPct = lastBreakdownRow ? lastBreakdownRow.effectiveReturnPct : new Decimal(lastMonthGrossPct).mul(decSplitMultiplier).toNumber();
  const yearNetPct = investorYtdPct;

  const liveDollarGains = {
    today: todayNetDollar,
    week: weekNetDollar,
    month: monthNetDollar,
    lastMonth: lastMonthNetDollar,
    year: yearNetDollar
  };

  const fundPerformance = {
    today: { grossReturnPct: todayGrossPct, label: safeLive.today || "+0.00%" },
    week: { grossReturnPct: weekGrossPct, label: safeLive.week || "+0.00%" },
    month: { grossReturnPct: monthGrossPct, label: safeLive.month || "+0.00%" },
    lastMonth: { grossReturnPct: lastMonthGrossPct, label: safeLive.lastMonth || "+0.00%" },
    year: { grossReturnPct: yearGrossPct, label: safeLive.year || "+0.00%" }
  };

  const accountPerformance = {
    splitPct,
    today: { netDollar: todayNetDollar, netReturnPct: todayNetPct },
    week: { netDollar: weekNetDollar, netReturnPct: weekNetPct },
    month: { netDollar: monthNetDollar, netReturnPct: monthNetPct },
    lastMonth: { netDollar: lastMonthNetDollar, netReturnPct: lastMonthNetPct },
    year: { netDollar: yearNetDollar, netReturnPct: yearNetPct }
  };

  // 7. Overall Performance & Cumulative Contributed Cash (Total Deposits)
  // Authoritative Client Policy (Josh Aug 2026):
  // Total Deposits = sum of qualifying ADDITIONAL EXTERNAL CASH DEPOSIT transactions within applicable reporting period.
  // Excludes: starting capital, cutovers, commissions, internal adjustments, VOID/cancelled records.
  const myIdSet = new Set([
    internalId,
    investor.id,
    investor.portalusername,
    investor.portal_username,
    investor.username,
    investor.email,
    investor.portal_email,
    investor.investorsinvestorid,
    investor.investorid,
    ...investorAccounts.map(a => String(a.id || "").trim())
  ].filter(Boolean).map(s => String(s).trim().toLowerCase()));

  const myDeposits = (depositsSheet || []).filter(r => {
    const rId = String(r.investorid ?? r.investor_id ?? r.id ?? "").trim().toLowerCase();
    const rAccId = String(r.account_id ?? r.accountid ?? "").trim().toLowerCase();
    return myIdSet.has(rId) || (rAccId && myIdSet.has(rAccId));
  });

  const effectiveCashIn = calculateTotalDeposits({
    depositRows: myDeposits,
    targetYear,
    maxMonth: currentMonthIdx,
    accountStartDate: startDate
  });
  
  // Resolve any authorized durable cutover for this investor
  const myCutovers = (cutoverTable || []).filter(c => {
    const cInvId = String(c.investor_id || c.investorid || '').trim().toLowerCase();
    return myIdSet.has(cInvId);
  }).sort((a, b) => (Number(b.year || targetYear) * 12 + Number(b.month_number || 1)) - (Number(a.year || targetYear) * 12 + Number(a.month_number || 1)));

  const latestCutover = myCutovers[0] || null;
  let cutoverBaseline = null;
  let lifetimeDeposits = 0;

  if (latestCutover && latestCutover.authorized_opening_balance !== undefined && latestCutover.authorized_opening_balance !== null) {
    cutoverBaseline = num(latestCutover.authorized_opening_balance);
    const cutoverMonth = Number(latestCutover.month_number || 1);
    const cutoverYear = Number(latestCutover.year || targetYear);

    // Only sum deposits effective on or after the cutover month
    const postCutoverDeposits = myDeposits.filter(d => {
      const dYear = Number(d.effective_year || d.year || (d.date ? new Date(d.date).getUTCFullYear() : targetYear));
      const dMonth = Number(d.month_number || d.monthno || (d.date ? new Date(d.date).getUTCMonth() + 1 : 1));
      if (dYear < cutoverYear) return false;
      if (dYear === cutoverYear && dMonth < cutoverMonth) return false;
      return true;
    });

    lifetimeDeposits = calculateTotalDeposits({
      depositRows: postCutoverDeposits,
      targetYear,
      maxMonth: currentMonthIdx,
      accountStartDate: startDate
    });
  } else {
    lifetimeDeposits = calculateTotalDeposits({
      depositRows: myDeposits,
      targetYear,
      maxMonth: currentMonthIdx,
      accountStartDate: startDate
    });
  }

  // Authoritative Direct Client Contract (Josh Aug/Sep 2026):
  // Total External Cash Sent = Initial Proven Cash Funding + Qualifying Additional External Cash Deposits
  // Total Performance $ = Current Balance - Total External Cash Sent
  // Total Performance % = (Current Balance - Total External Cash Sent) / Total External Cash Sent * 100
  let explicitInitialCash = null;
  let explicitOriginType = null;
  if (activeAccounts.length > 0 && activeAccounts[0].initial_cash_contribution !== undefined && activeAccounts[0].initial_cash_contribution !== null) {
    explicitInitialCash = activeAccounts.reduce((sum, r) => sum + num(r.initial_cash_contribution, 0), 0);
    explicitOriginType = activeAccounts[0].capital_origin_type || 'EXTERNAL_CASH';
  }

  const lifetimePerf = calculateLifetimePerformance({
    startingCapital: startCapital,
    initialCashContribution: explicitInitialCash,
    cutoverBaseline,
    cumulativeDeposits: lifetimeDeposits,
    currentBalance: summaryBalance.toNumber(),
    provenanceOriginType: explicitOriginType
  });

  const totalPerformanceDollar = lifetimePerf.totalPerformanceDollar;
  const totalPerformancePct = lifetimePerf.totalPerformancePct;
  const contributedBasis = lifetimePerf.contributedBasis;

  // Build unified commission rules/shares list
  const unifiedSharesTable = [];
  (commissionSharesTable || []).forEach(s => {
    unifiedSharesTable.push({
      id: s.id,
      source_investor_id: String(s.source_investor_id || s.investor_id || s.investorid || '').trim(),
      source_account_id: s.source_account_id ? String(s.source_account_id).trim() : null,
      recipient_investor_id: String(s.recipient_investor_id || s.recipient_id || s.recipientid || '').trim(),
      commission_percent: num(s.commission_percent || s.percent),
      effective_start_date: s.effective_start_date || '2000-01-01',
      effective_end_date: s.effective_end_date || null,
      status: String(s.status || 'active').toLowerCase()
    });
  });
  (commissionRulesTable || []).forEach(r => {
    const srcId = String(r.source_investor_id || r.investor_id || r.investorid || '').trim();
    const recId = String(r.recipient_investor_id || r.recipient_id || r.recipientid || '').trim();
    const accId = r.source_account_id || r.account_id || r.accountid;
    const pct = num(r.commission_percent || r.percent);
    if (srcId && recId && pct > 0) {
      unifiedSharesTable.push({
        id: r.id,
        source_investor_id: srcId,
        source_account_id: accId ? String(accId).trim() : null,
        recipient_investor_id: recId,
        commission_percent: pct,
        effective_start_date: r.effective_start_date || r.created_at || r.createdat || '2000-01-01',
        effective_end_date: r.effective_end_date || null,
        status: String(r.status || 'active').toLowerCase()
      });
    }
  });

  // 8. Commission Earnings
  const monthNames = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  
  // investorIdSet initialized at startup

  const myEarnings = (commissionEarningsTable || []).filter(r => {
    const recId = String(r.recipient_id || r.recipientid || r.recipient_investor_id || '').trim().toLowerCase();
    return investorIdSet.has(recId);
  });

  let latestInvestorCommMonth = 0;
  if (myEarnings.length > 0) {
    const thisYearEarnings = myEarnings.filter(r => num(r.year) === targetYear);
    if (thisYearEarnings.length > 0) {
      latestInvestorCommMonth = Math.max(...thisYearEarnings.map(e => num(e.month_number)));
    }
  }
  const manualCommMonths = Object.keys(commDepByMonth).map(Number);
  if (manualCommMonths.length > 0) {
    latestInvestorCommMonth = Math.max(latestInvestorCommMonth, ...manualCommMonths);
  }

  // Find latest published gross return month from returnsSheet / monthly_returns
  let latestFundReturnMonth = 0;
  if (returnsSheet && returnsSheet.length > 0) {
    const publishedReturns = returnsSheet.filter(r => num(r.year || r.Year) === targetYear && num(r.grossreturn || r.grossreturnpct || r.gross_return_pct || r.return, 0) !== 0);
    if (publishedReturns.length > 0) {
      latestFundReturnMonth = Math.max(...publishedReturns.map(r => monthNum(r)));
    }
  }

  // Completed month cutoff for commission cards (Stakeholder Rule B):
  // Monthly card represents the last completed earning month (e.g. August in September).
  // YTD commission ends with the last completed month.
  const lastCompletedMonth = (targetYear < currentYearIdx)
    ? 12
    : Math.max(0, currentMonthIdx - 1);

  const displayCommMonthIdx = lastCompletedMonth;
  const displayCommMonthName = monthNames[displayCommMonthIdx] || "N/A";

  let commissionsEarnedYear = new Decimal(0);
  let commissionsEarnedMonth = new Decimal(0);
  
  const grouped = {};

  const investorMap = new Map();
  (rawInvestors || []).forEach(i => {
    if (i.id) investorMap.set(String(i.id).toLowerCase(), i);
    if (i.portal_username) investorMap.set(String(i.portal_username).toLowerCase(), i);
    if (i.portalusername) investorMap.set(String(i.portalusername).toLowerCase(), i);
    if (i.investorid) investorMap.set(String(i.investorid).toLowerCase(), i);
    if (i.investorsinvestorid) investorMap.set(String(i.investorsinvestorid).toLowerCase(), i);
  });

  if (myEarnings.length > 0) {
    myEarnings.forEach(e => {
      const eYear = num(e.year);
      const eMonth = num(e.month_number);
      if (eYear === targetYear) {
        const isCompletedMonth = (targetYear < currentYearIdx) || (targetYear === currentYearIdx && eMonth <= lastCompletedMonth);
        if (isCompletedMonth) {
          const amt = roundMoney(e.amount);
          commissionsEarnedYear = commissionsEarnedYear.add(amt);
          if (eMonth === displayCommMonthIdx) {
            commissionsEarnedMonth = commissionsEarnedMonth.add(amt);
          }

          const sourceId = e.source_investor_id;
          if (!grouped[sourceId]) {
            const sid = String(sourceId).toLowerCase();
            const sourceInvestor = investorMap.get(sid) || {};
            const firstName = String(sourceInvestor.first_name || sourceInvestor.firstname || "").trim();
            const lastName = String(sourceInvestor.last_name || sourceInvestor.lastname || "").trim();
            const name = [firstName, lastName].filter(Boolean).join(" ") || String(sourceInvestor.name || sourceId).trim();
            
            const sourceIdSet = new Set([
              sourceId,
              sourceInvestor.id,
              sourceInvestor.portal_username,
              sourceInvestor.portalusername,
              sourceInvestor.investorid
            ].filter(Boolean).map(s => String(s).trim().toLowerCase()));

            let percent = 0;
            const share = getApplicableCommissionShare({
              shares: unifiedSharesTable,
              year: targetYear,
              month: displayCommMonthIdx,
              sourceIdSet,
              recipientIdSet: investorIdSet
            });
            if (share) percent = share.commission_percent;

            let sourceBalance = 0;
            const sourceAccs = accounts.filter(a => sourceIdSet.has(String(a.investor_id || a.id || '').trim().toLowerCase()));
            sourceAccs.forEach(acc => {
              const srcHist = (historyTable || []).filter(h => 
                sourceIdSet.has(String(h.investor_id || h.investorid || '').trim().toLowerCase()) && 
                num(h.year) === targetYear && 
                num(h.month_number) <= displayCommMonthIdx
              ).sort((a, b) => num(b.month_number) - num(a.month_number))[0];

              if (srcHist && num(srcHist.opening_balance) > 0) {
                // Truthful commission basis: eligible capital that generated trading profits
                sourceBalance += (num(srcHist.opening_balance) + num(srcHist.deposits || 0) - num(srcHist.withdrawals || 0));
              } else if (srcHist && num(srcHist.ending_balance) > 0) {
                sourceBalance += num(srcHist.ending_balance);
              } else {
                sourceBalance += num(acc.starting_capital || acc.capital || acc.Amount, 0);
              }
            });

            grouped[sourceId] = {
              sourceName: name,
              sourceBalance: sourceBalance,
              eligibleCapital: sourceBalance,
              percent: percent,
              monthAmount: 0,
              yearAmount: 0
            };
          }
          grouped[sourceId].yearAmount = roundMoney(new Decimal(grouped[sourceId].yearAmount || 0).add(amt)).toNumber();
          if (eMonth === displayCommMonthIdx) {
            grouped[sourceId].monthAmount = roundMoney(new Decimal(grouped[sourceId].monthAmount || 0).add(amt)).toNumber();
          }
        }
      }
    });
  } else {
    // Dynamic Fallback: calculate from unifiedSharesTable using date-aware selection
    const myShares = getApplicableCommissionShares({
      shares: unifiedSharesTable,
      year: targetYear,
      month: displayCommMonthIdx,
      recipientIdSet: investorIdSet
    });
    
    myShares.forEach(share => {
      const sourceId = share.source_investor_id;
      const sourceInvestor = rawInvestors.find(i => {
        const sid = String(sourceId).toLowerCase();
        return String(i.id || '').toLowerCase() === sid ||
               String(i.portal_username || i.portalusername || '').toLowerCase() === sid ||
               String(i.investorid || i.investorsinvestorid || '').toLowerCase() === sid;
      }) || {};
      const firstName = String(sourceInvestor.first_name || sourceInvestor.firstname || "").trim();
      const lastName = String(sourceInvestor.last_name || sourceInvestor.lastname || "").trim();
      const name = [firstName, lastName].filter(Boolean).join(" ") || String(sourceInvestor.name || sourceId).trim();

      const sourceIdSet = new Set([
        sourceId,
        sourceInvestor.id,
        sourceInvestor.portal_username,
        sourceInvestor.portalusername,
        sourceInvestor.investorid
      ].filter(Boolean).map(s => String(s).trim().toLowerCase()));

      if (!grouped[sourceId]) {
        let sourceBalance = 0;
        const sourceAccs = accounts.filter(a => sourceIdSet.has(String(a.investor_id || a.id || '').trim().toLowerCase()));
        sourceAccs.forEach(acc => {
          const srcHist = (historyTable || []).filter(h => 
            sourceIdSet.has(String(h.investor_id || h.investorid || '').trim().toLowerCase()) && 
            num(h.year) === targetYear && 
            num(h.month_number) <= displayCommMonthIdx
          ).sort((a, b) => num(b.month_number) - num(a.month_number))[0];

          if (srcHist && num(srcHist.opening_balance) > 0) {
            // Truthful commission basis: eligible capital that generated trading profits
            sourceBalance += (num(srcHist.opening_balance) + num(srcHist.deposits || 0) - num(srcHist.withdrawals || 0));
          } else if (srcHist && num(srcHist.ending_balance) > 0) {
            sourceBalance += num(srcHist.ending_balance);
          } else {
            sourceBalance += num(acc.starting_capital || acc.capital || acc.Amount, 0);
          }
        });

        grouped[sourceId] = {
          sourceName: name,
          sourceBalance: sourceBalance,
          eligibleCapital: sourceBalance,
          percent: share.commission_percent,
          monthAmount: 0,
          yearAmount: 0
        };
      }

      // Calculate approximate monthly profit for source investor
      const sourceAccounts = accounts.filter(a => sourceIdSet.has(String(a.investor_id || a.id || '').trim().toLowerCase()));
      sourceAccounts.forEach(acc => {
        let accBalance = num(acc.starting_capital || acc.capital, 0);
        for (let m = 1; m <= 12; m++) {
          if (targetYear === currentYearIdx && m > lastCompletedMonth) break;

          const mRow = returnsSheet.find(r => num(r.year || r.Year) === targetYear && monthNum(r) === m);
          const grossPct = mRow ? num(mRow.gross_return_pct || mRow.grossreturn || mRow.grossreturnpct || mRow.return, 0) : 0;
          
          const monthProfit = roundMoney(new Decimal(accBalance).mul(grossPct).div(100));
          const commAmt = roundMoney(monthProfit.mul(share.commission_percent).div(100));

          if (commAmt.gt(0)) {
            commissionsEarnedYear = commissionsEarnedYear.add(commAmt);
            grouped[sourceId].yearAmount = roundMoney(new Decimal(grouped[sourceId].yearAmount || 0).add(commAmt)).toNumber();
            if (m === displayCommMonthIdx) {
              commissionsEarnedMonth = commissionsEarnedMonth.add(commAmt);
              grouped[sourceId].monthAmount = roundMoney(new Decimal(grouped[sourceId].monthAmount || 0).add(commAmt)).toNumber();
            }
          }
          accBalance = accBalance + (monthProfit * (num(acc.split_pct, 100) / 100));
        }
      });
    });
  }

  // Include manual commission deposits in the breakdown
  let manualMonthAmt = new Decimal(0);
  let manualYearAmt = new Decimal(0);
  Object.keys(commDepByMonth).forEach(mNum => {
    const m = Number(mNum);
    if (m <= lastCompletedMonth) {
      const amt = roundMoney(commDepByMonth[mNum]);
      manualYearAmt = manualYearAmt.add(amt);
      if (m === displayCommMonthIdx) {
        manualMonthAmt = manualMonthAmt.add(amt);
      }
    }
  });

  if (manualYearAmt.gt(0)) {
    grouped["manual_deposit"] = {
      sourceName: "Commission Added (Manual)",
      percent: "-",
      monthAmount: manualMonthAmt.toNumber(),
      yearAmount: manualYearAmt.toNumber()
    };
  }

  const commissionBreakdown = [];
  for (const sourceId in grouped) {
    commissionBreakdown.push(grouped[sourceId]);
  }
  commissionBreakdown.sort((a, b) => b.yearAmount - a.yearAmount);

  return {
    investor: { 
      investorId: id, 
      name: displayName, 
      splitPct, 
      recurringMonthlyDraw: recurringDraw,
      startDate: startDateStr,
      showFundPerformance: bool(investor.show_fund_performance ?? investor.showfundperformance),
      hasCommissionAccount: activeAccounts.some(a => bool(a.is_commission || a.is_commission === "true"))
    },
    summary: {
      startingCapital: startCapital,
      currentBalance: summaryBalance.toNumber(),
      totalGain: totalGain.toNumber(),
      totalTradingGainYtd: totalGain.toNumber(),
      totalTradingGainLifetime: totalGain.toNumber(),
      totalWithdrawals: totalWithdrawals.toNumber(),
      totalCashIn: effectiveCashIn,
      externalDepositsYtd: effectiveCashIn,
      externalDepositsLifetime: calculateTotalDeposits({ depositRows: myDeposits }),
      contributedBasis,
      lifetimeContributedBasis: contributedBasis,
      totalPerformancePct,
      netTradingReturnYtd: investorYtdPct,
      netTradingReturnLifetime: investorYtdPct,
      totalPerformanceDollar,
      netChange: summaryBalance.sub(startCapital).toNumber(),
      commissionsEarnedMonth: commissionsEarnedMonth.toNumber(),
      commissionsEarnedYear: commissionsEarnedYear.toNumber(),
      commMonthName: displayCommMonthName
    },
    dataSourceAuthority: (useSupabase && isAuthoritative) ? "AUTHORITATIVE_PRODUCTION_DB" : "NONAUTHORITATIVE_FALLBACK",
    source: `${useSupabase ? "Supabase" : "Sheets"} | ${safeLive.source || "System Default"}`,
    live: safeLive,
    liveDollarGains,
    fundPerformance,
    accountPerformance,
    monthlyHistory: monthlyHistory.map((r) => {
      const m = r.monthNumber;
      const isStarted = !startDate || (targetYear > startDate.getUTCFullYear()) || 
                       (targetYear === startDate.getUTCFullYear() && m >= (startDate.getUTCMonth() + 1));
      return {
        month: r.month,
        monthNumber: r.monthNumber,
        grossReturnPct: isStarted ? r.grossReturnPct : 0
      };
    }),
    commissionBreakdown,
    breakdown
  };
}
