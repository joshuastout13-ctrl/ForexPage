import { readSheet, num, bool, monthNum, filterInvestors } from "./sheets.js";
import { readSupabaseTable } from "./supabase.js";
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

  const useSupabase = process.env.DATA_SOURCE === "supabase";

  let rawInvestors, accounts, returnsSheet, depositsSheet, withdrawalsSheet, live;

  if (useSupabase) {
    console.log(`[Dashboard] Loading data from Supabase for investor ${id}`);
    [rawInvestors, accounts, returnsSheet, depositsSheet, withdrawalsSheet, historyTable, commissionEarningsTable, live] = await Promise.all([
      readSupabaseTable("investors"),
      readSupabaseTable("investor_accounts"),
      readSupabaseTable("monthly_returns"),
      readSupabaseTable("deposits"),
      readSupabaseTable("withdrawals"),
      readSupabaseTable("investor_monthly_history"),
      readSupabaseTable("commission_earnings"),
      getMyfxbookLive()
    ]);
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
    var historyTable = []; // Not implemented for Sheets
    var commissionEarningsTable = [];
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

  const historyRecords = (historyTable || []).filter(r => String(r.investor_id || r.investorid || "").trim() === internalId && num(r.year) === targetYear);

  // 5. Compounding Logic
  let balance = startCapital;
  let totalGain = 0;
  let totalWithdrawals = 0;
  let totalCashIn = 0;
  let summaryBalance = startCapital; // The "Current" balance for summary card

  const now = new Date();
  const currentMonthIdx = now.getMonth() + 1; // 1-12
  const currentYearIdx = now.getFullYear();

  const breakdown = [];
  let investorCompoundedYtd = 1;

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

    const deps = depByMonth[m] || 0;
    const wds = wdByMonth[m] || 0;

    // 1. Adjusted Basis for Gain (Balance + Deposits)
    // We calculate gain BEFORE withdrawals are subtracted to match user expectation (Gain / Starting Balance = %)
    let gainBasis = Math.max(0, balance + deps);
    let gain = 0;
    let ending = 0;
    let effPct = row.grossReturnPct * (splitPct / 100);
    let isManual = false;

    // Check for manual history override
    const historyRow = historyRecords.find(hr => hr.month_number === m);
    
    // Basis for Gain (Balance + Deposits)
    // Adjusted Start (Balance + Deposits - Withdrawals)
    const adjustedStart = historyRow 
      ? (num(historyRow.opening_balance) + num(historyRow.deposits) - num(historyRow.withdrawals))
      : (balance + deps - wds);
    if (historyRow) {
      // If we have a historical record, it takes priority
      // We still use the manual opening balance if provided
      const manualStart = num(historyRow.opening_balance);
      const manualDeps = num(historyRow.deposits);
      const manualWds = num(historyRow.withdrawals);
      
      const manualGainBasis = Math.max(0, manualStart + manualDeps);
      gain = num(historyRow.manual_gain_amount ?? (manualGainBasis * (num(historyRow.manual_return_pct ?? effPct) / 100)));
      ending = num(historyRow.ending_balance);
      isManual = bool(historyRow.is_manual ?? historyRow.ismanual);
    } else {
      // Standard calculation
      gain = gainBasis * (effPct / 100);
      ending = Math.max(0, gainBasis - wds + gain - recurringDraw);
    }

    // ONLY accumulate summary metrics for months that have occurred (Historical or Current)
    const isHistoricalOrCurrent = (targetYear < currentYearIdx) || (targetYear === currentYearIdx && m <= currentMonthIdx) || historyRow;
    
    if (isHistoricalOrCurrent) {
      totalGain += gain;
      
      // Prioritize manual history values for the summary card if they exist
      const effectiveWd = historyRow ? num(historyRow.withdrawals) : wds;
      const effectiveDraw = historyRow ? num(historyRow.recurring_draw) : (ending > 0 || recurringDraw > 0 ? recurringDraw : 0);
      
      totalWithdrawals += (effectiveWd + effectiveDraw);
      summaryBalance = ending;
      
      const currentEffPct = isManual && historyRow.manual_return_pct ? num(historyRow.manual_return_pct) : effPct;
      if (isStarted) {
        investorCompoundedYtd *= (1 + (currentEffPct / 100));
      }
    }
    
    breakdown.push({
      month: row.month,
      monthNumber: m,
      grossReturnPct: row.grossReturnPct,
      effectiveReturnPct: isManual && historyRow.manual_return_pct ? historyRow.manual_return_pct : effPct,
      startingBalance: historyRow ? num(historyRow.opening_balance) : balance,
      adjustedStartingBalance: adjustedStart,
      gain,
      recurringDraw,
      oneTimeWithdrawal: wds,
      deposits: deps,
      endingBalance: ending,
      isProjection: !isHistoricalOrCurrent,
      isManual
    });

    balance = ending;
  }

  // 6. Live Performance Dollar Gains (Use the summary balance, not the year-end projection)
  const liveBase = summaryBalance;
  const investorYtdPct = (investorCompoundedYtd - 1) * 100;
  const fmt = (n) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;

  // Use the fund's live performance year (from ZenRows/API)
  // (Removed investor-specific override to ensure "Live Fund Performance" reflects the fund)

  const liveDollarGains = {
    today: liveBase * (pctToNum(live.today) / 100),
    week: liveBase * (pctToNum(live.week) / 100),
    month: liveBase * (pctToNum(live.month) / 100),
    year: totalGain
  };

  // 7. Overall Performance (Based on manual total_cash_in if available, otherwise startCapital)
  // The user requested: Total Cash In / Current Balance (Ratio)
  // But ROI is usually: (Current Balance - Total Cash In) / Total Cash In
  const manualCashIn = investorAccounts.reduce((sum, a) => sum + num(a.total_cash_in || a.totalcashin), 0);
  const effectiveCashIn = manualCashIn || startCapital;
  
  const totalPerformancePct = effectiveCashIn > 0 ? ((summaryBalance - effectiveCashIn) / effectiveCashIn) * 100 : 0;
  const totalPerformanceDollar = summaryBalance - effectiveCashIn;

  // 8. Commission Earnings
  let commissionsEarnedYear = 0;
  let commissionsEarnedMonth = 0;
  
  if (commissionEarningsTable && commissionEarningsTable.length > 0) {
    const myEarnings = commissionEarningsTable.filter(r => String(r.recipient_id).toLowerCase() === internalId.toLowerCase());
    myEarnings.forEach(e => {
      const eYear = num(e.year);
      const eMonth = num(e.month_number);
      if (eYear === targetYear) {
        commissionsEarnedYear += num(e.amount);
        if (eMonth === currentMonthIdx) {
          commissionsEarnedMonth += num(e.amount);
        }
      }
    });
  }

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
      totalCashIn: effectiveCashIn,
      totalPerformancePct,
      totalPerformanceDollar,
      netChange: summaryBalance - startCapital,
      commissionsEarnedMonth,
      commissionsEarnedYear
    },
    source: `${useSupabase ? "Supabase" : "Sheets"} | ${live.source}`,
    live,
    liveDollarGains,
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
    breakdown
  };
}
