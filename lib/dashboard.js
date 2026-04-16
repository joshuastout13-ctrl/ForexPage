import { readSheet, num, bool, monthNum, filterInvestors } from "./sheets.js";
import { CONFIG } from "./config.js";
import { getMyfxbookLive } from "./myfxbook.js";

function pctToNum(s) {
  return num(String(s || "").replace(/[%\s]/g, ""), 0);
}

/**
 * Builds the full dashboard payload for a given investor ID.
 */
export async function buildInvestorDashboard(investorId) {
  const id = String(investorId ?? "").trim();
  if (!id) throw Object.assign(new Error("Missing investor ID"), { status: 400 });

  const [rawInvestors, accounts, returnsSheet, depositsSheet, withdrawalsSheet, live] = await Promise.all([
    readSheet(CONFIG.tabs.investors),
    readSheet(CONFIG.tabs.investorAccounts),
    readSheet(CONFIG.tabs.monthlyReturns),
    readSheet(CONFIG.tabs.deposits),
    readSheet(CONFIG.tabs.withdrawals),
    getMyfxbookLive()
  ]);

  const investors = filterInvestors(rawInvestors);


  // 1. Find the investor
  const investor = investors.find(
    (r) => String(r.portalusername ?? r.username ?? "").trim() === id
  );
  if (!investor) {
    throw Object.assign(new Error("Investor not found"), { status: 404 });
  }

  // 2. Resolve Internal ID (Used for filtering other tabs)
  // Mapping based on "Investors Investor ID" or "Investor ID"
  const internalId = String(
    investor.investorsinvestorid ?? investor.investorid ?? investor.id ?? investor.portalusername ?? ""
  ).trim();

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
  const startDateStr = String(investor.startdate ?? investor.date ?? "");
  const startDate = startDateStr ? new Date(startDateStr) : null;

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
      grossReturnPct: num(r.grossreturn ?? r.grossreturnpct ?? r.return, 0)
    }))
    .filter((r) => r.monthNumber >= 1 && r.monthNumber <= 12)
    .sort((a, b) => a.monthNumber - b.monthNumber);

  const depByMonth = {};
  depositsSheet.forEach((r) => {
    if (String(r.investorid ?? r.id ?? "").trim() !== internalId) return;
    const m = monthNum(r);
    if (m >= 1 && m <= 12) depByMonth[m] = (depByMonth[m] || 0) + num(r.amount ?? r.Amount, 0);
  });

  const wdByMonth = {};
  withdrawalsSheet.forEach((r) => {
    if (String(r.investorid ?? r.id ?? "").trim() !== internalId) return;
    // Only approved/completed withdrawals
    if (!bool(r.status ?? r.Status ?? "active")) return;
    
    // Check year if column exists, otherwise assume current year
    const wdYear = num(r.effectiveyear ?? r.year ?? targetYear);
    if (wdYear !== targetYear) return;

    const m = monthNum(r);
    if (m >= 1 && m <= 12) wdByMonth[m] = (wdByMonth[m] || 0) + num(r.amount ?? r.Amount, 0);
  });

  // 5. Compounding Logic
  let balance = startCapital;
  let totalGain = 0;
  let totalWithdrawals = 0;
  let summaryBalance = startCapital; // The "Current" balance for summary card

  const now = new Date();
  const currentMonthIdx = now.getMonth() + 1; // 1-12
  const currentYearIdx = now.getFullYear();

  const breakdown = [];

  for (const row of monthlyHistory) {
    const m = row.monthNumber;
    
    // Start date check (Zero rows before investor starts)
    const isStarted = !startDate || (targetYear > startDate.getFullYear()) || 
                      (targetYear === startDate.getFullYear() && m >= (startDate.getMonth() + 1));

    if (!isStarted) {
      breakdown.push({
        month: row.month, monthNumber: m, grossReturnPct: 0, effectiveReturnPct: 0,
        startingBalance: 0, gain: 0, recurringDraw: 0, oneTimeWithdrawal: 0, deposits: 0, endingBalance: 0
      });
      continue;
    }

    const deps = depByMonth[m] || 0;
    const wds = wdByMonth[m] || 0;

    // Calculation order:
    // 1. Adjusted Start (Balance + Deposits - Withdrawals)
    const adjustedStart = Math.max(0, balance + deps - wds);
    
    // 2. Calculate Gain (Applied to adjusted start)
    const effectivePct = row.grossReturnPct * (splitPct / 100);
    const gain = adjustedStart * (effectivePct / 100);
    
    // 3. Subtract Recurring Draw (Applied after gain)
    const finalEnding = Math.max(0, adjustedStart + gain - recurringDraw);

    // ONLY accumulate summary metrics for months that have occurred (Historical or Current)
    const isHistoricalOrCurrent = (targetYear < currentYearIdx) || (targetYear === currentYearIdx && m <= currentMonthIdx);
    
    if (isHistoricalOrCurrent) {
      totalGain += gain;
      totalWithdrawals += (wds + (finalEnding > 0 || recurringDraw > 0 ? recurringDraw : 0));
      summaryBalance = finalEnding;
    }
    
    breakdown.push({
      month: row.month,
      monthNumber: m,
      grossReturnPct: row.grossReturnPct,
      effectiveReturnPct: effectivePct,
      startingBalance: balance,
      adjustedStartingBalance: adjustedStart,
      gain,
      recurringDraw,
      oneTimeWithdrawal: wds,
      deposits: deps,
      endingBalance: finalEnding,
      isProjection: !isHistoricalOrCurrent
    });

    balance = finalEnding;
  }

  // 6. Live Performance Dollar Gains (Use the summary balance, not the year-end projection)
  const liveBase = summaryBalance;
  const liveDollarGains = {
    today: liveBase * (pctToNum(live.today) / 100),
    week: liveBase * (pctToNum(live.week) / 100),
    month: liveBase * (pctToNum(live.month) / 100),
    year: liveBase * (pctToNum(live.year) / 100)
  };

  return {
    investor: { 
      investorId: id, 
      name: displayName, 
      splitPct, 
      recurringMonthlyDraw: recurringDraw,
      startDate: startDateStr
    },
    summary: {
      startingCapital: startCapital,
      currentBalance: summaryBalance,
      totalGain,
      totalWithdrawals,
      netChange: summaryBalance - startCapital
    },
    live,
    liveDollarGains,
    monthlyHistory: monthlyHistory.map((r) => ({
      month: r.month,
      monthNumber: r.monthNumber,
      grossReturnPct: r.grossReturnPct
    })),
    breakdown
  };
}
