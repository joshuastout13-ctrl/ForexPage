import { readSheet, numberValue, monthNumberFromRow } from "./sheets.js";
import { getMyfxbookLive } from "./myfxbook.js";
import { CONFIG } from "./config.js";

function pctStringToNumber(s) {
  if (s == null) return 0;
  return numberValue(String(s).replace(/[%\s]/g, ""), 0);
}

/**
 * Builds the full dashboard payload for a given investor ID.
 * Fetches all sheet tabs in parallel, then fetches Myfxbook live stats.
 */
export async function buildInvestorDashboard(investorId) {
  const id = String(investorId ?? "").trim();
  if (!id) throw Object.assign(new Error("Missing investor ID"), { status: 400 });

  const [
    investors,
    depositsSheet,
    withdrawalsSheet,
    monthlyReturnsSheet,
    livePerformanceSheet
  ] = await Promise.all([
    readSheet(CONFIG.tabs.investors),
    readSheet(CONFIG.tabs.deposits),
    readSheet(CONFIG.tabs.withdrawals),
    readSheet(CONFIG.tabs.monthlyReturns),
    readSheet(CONFIG.tabs.livePerformance)
  ]);

  const investor = investors.find(
    (r) => String(r.investorid ?? r.id ?? "").trim() === id
  );
  if (!investor) {
    throw Object.assign(new Error("Investor not found"), { status: 404 });
  }

  const firstName = String(investor.firstname ?? "").trim();
  const lastName = String(investor.lastname ?? "").trim();
  const displayName =
    [firstName, lastName].filter(Boolean).join(" ") ||
    String(investor.name ?? investor.investorname ?? "").trim();

  // "Investor Split %" header normalises to "investorsplit"
  const splitPct = numberValue(
    investor.investorsplit ?? investor.splitpct ?? investor.split,
    100
  );

  // "Recurring Monthly Draw" header normalises to "recurringmonthlydraw"
  const recurringMonthlyDraw = numberValue(
    investor.recurringmonthlydraw ?? investor.monthlydraw,
    0
  );

  // "Starting Capital" or similar
  const startCapital = numberValue(
    investor.startingcapital ?? investor.initialcapital ?? investor.startcapital,
    0
  );

  // "Start Date" header normalises to "startdate"
  const startDateRaw = String(investor.startdate ?? "").trim();
  const startDate = startDateRaw
    ? new Date(startDateRaw)
    : new Date(CONFIG.defaultFundYear, 0, 1);

  const year = CONFIG.defaultFundYear;

  // Deposits bucketed by month number for this investor
  const byMonthDeposits = {};
  for (const row of depositsSheet) {
    if (String(row.investorid ?? row.id ?? "").trim() !== id) continue;
    const m = monthNumberFromRow(row);
    if (m >= 1 && m <= 12) {
      byMonthDeposits[m] =
        (byMonthDeposits[m] || 0) + numberValue(row.amount ?? row.Amount, 0);
    }
  }

  // Withdrawals bucketed by month number for this investor
  const byMonthWithdrawals = {};
  for (const row of withdrawalsSheet) {
    if (String(row.investorid ?? row.id ?? "").trim() !== id) continue;
    const m = monthNumberFromRow(row);
    if (m >= 1 && m <= 12) {
      byMonthWithdrawals[m] =
        (byMonthWithdrawals[m] || 0) + numberValue(row.amount ?? row.Amount, 0);
    }
  }

  // "Gross Return %" header normalises to "grossreturn"
  const monthlyRows = monthlyReturnsSheet
    .map((r) => ({
      month: String(r.Month ?? r.month ?? "").trim(),
      monthNumber: monthNumberFromRow(r),
      grossReturnPct: numberValue(
        r.grossreturn ?? r.grossreturnpct ?? r.returnpct ?? r.return ?? r.Return,
        0
      )
    }))
    .filter((r) => r.monthNumber >= 1 && r.monthNumber <= 12)
    .sort((a, b) => a.monthNumber - b.monthNumber);

  let balance = startCapital;
  let totalGain = 0;
  let totalOut = 0;
  const breakdown = [];

  for (const row of monthlyRows) {
    const monthNo = row.monthNumber;
    const isBeforeStart =
      year === startDate.getFullYear() && monthNo < startDate.getMonth() + 1;

    if (isBeforeStart) {
      breakdown.push({
        month: row.month,
        monthNumber: monthNo,
        grossReturnPct: row.grossReturnPct,
        effectiveReturnPct: 0,
        startingBalance: 0,
        gain: 0,
        recurringDraw: 0,
        oneTimeWithdrawal: 0,
        deposits: 0,
        endingBalance: 0
      });
      continue;
    }

    let startingBalance = balance;

    const depositsThisMonth = byMonthDeposits[monthNo] || 0;
    const withdrawalsThisMonth = byMonthWithdrawals[monthNo] || 0;

    startingBalance += depositsThisMonth;
    startingBalance -= withdrawalsThisMonth;
    if (startingBalance < 0) startingBalance = 0;

    const effectiveReturnPct = row.grossReturnPct * (splitPct / 100);
    const gain = startingBalance * (effectiveReturnPct / 100);
    let endingBalance = startingBalance + gain - recurringMonthlyDraw;
    if (endingBalance < 0) endingBalance = 0;

    balance = endingBalance;
    totalGain += gain;
    totalOut += recurringMonthlyDraw + withdrawalsThisMonth;

    breakdown.push({
      month: row.month,
      monthNumber: monthNo,
      grossReturnPct: row.grossReturnPct,
      effectiveReturnPct,
      startingBalance,
      gain,
      recurringDraw: recurringMonthlyDraw,
      oneTimeWithdrawal: withdrawalsThisMonth,
      deposits: depositsThisMonth,
      endingBalance
    });
  }

  let live;
  try {
    live = await getMyfxbookLive();
  } catch {
    live = {
      today:
        livePerformanceSheet.find((r) => String(r.metric).toLowerCase() === "today")
          ?.value || "0.00%",
      week:
        livePerformanceSheet.find((r) => String(r.metric).toLowerCase().includes("week"))
          ?.value || "0.00%",
      month:
        livePerformanceSheet.find((r) => String(r.metric).toLowerCase().includes("month"))
          ?.value || "0.00%",
      year:
        livePerformanceSheet.find((r) => String(r.metric).toLowerCase().includes("year"))
          ?.value || "0.00%",
      gain: "0.00%",
      absGain: "0.00%",
      daily: "0.00%",
      monthly: "0.00%",
      fetchedAt: new Date().toISOString()
    };
  }

  const liveBase = balance || startCapital;
  const liveDollarGains = {
    today: liveBase * (pctStringToNumber(live.today) / 100),
    week: liveBase * (pctStringToNumber(live.week) / 100),
    month: liveBase * (pctStringToNumber(live.month) / 100),
    year: liveBase * (pctStringToNumber(live.year) / 100)
  };

  return {
    investor: {
      investorId,
      name: displayName,
      splitPct,
      recurringMonthlyDraw
    },
    summary: {
      startingCapital: startCapital,
      currentBalance: balance,
      totalGain,
      totalDrawsAndWithdrawals: totalOut,
      netChange: balance - startCapital
    },
    live,
    liveDollarGains,
    monthlyHistory: monthlyRows.map((r) => ({
      month: r.month,
      monthNumber: r.monthNumber,
      grossReturnPct: r.grossReturnPct
    })),
    breakdown
  };
}
