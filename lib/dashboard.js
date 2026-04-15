import { readSheet, num, bool, monthNum } from "./sheets.js";
import { CONFIG } from "./config.js";

function pctToNum(s) {
  return num(String(s || "").replace(/[%\s]/g, ""), 0);
}

/**
 * Builds the full dashboard payload for a given investor ID.
 * Reads all sheet tabs in parallel; Myfxbook is not used.
 */
export async function buildInvestorDashboard(investorId) {
  const id = String(investorId ?? "").trim();
  if (!id) throw Object.assign(new Error("Missing investor ID"), { status: 400 });

  const [investors, returnsSheet, depositsSheet, withdrawalsSheet] = await Promise.all([
    readSheet(CONFIG.tabs.investors),
    readSheet(CONFIG.tabs.monthlyReturns),
    readSheet(CONFIG.tabs.deposits),
    readSheet(CONFIG.tabs.withdrawals)
  ]);

  // Find investor row — check investorid, id, portalusername, or username
  const investor = investors.find(
    (r) =>
      String(r.investorid ?? r.id ?? r.portalusername ?? r.username ?? "").trim() === id
  );
  if (!investor) {
    throw Object.assign(new Error("Investor not found"), { status: 404 });
  }

  // Display name
  const firstName = String(investor.firstname ?? "").trim();
  const lastName = String(investor.lastname ?? "").trim();
  const displayName =
    [firstName, lastName].filter(Boolean).join(" ") ||
    String(investor.name ?? investor.investorname ?? id).trim();

  // Key investor fields — try several normalized column-name variants
  const splitPct = num(investor.investorsplit ?? investor.splitpct ?? investor.split, 100);
  const recurringDraw = num(investor.recurringmonthlydraw ?? investor.monthlydraw, 0);
  const startCapital = num(
    investor.startingcapital ?? investor.initialcapital ?? investor.startcapital,
    0
  );

  // Monthly returns, sorted Jan → Dec
  const monthlyHistory = returnsSheet
    .map((r) => ({
      month: String(r.Month ?? r.month ?? "").trim(),
      monthNumber: monthNum(r),
      grossReturnPct: num(
        r.grossreturn ?? r.grossreturnpct ?? r.returnpct ?? r.return ?? r.Return,
        0
      )
    }))
    .filter((r) => r.monthNumber >= 1 && r.monthNumber <= 12)
    .sort((a, b) => a.monthNumber - b.monthNumber);

  // Deposits per month for this investor
  const depByMonth = {};
  for (const r of depositsSheet) {
    if (String(r.investorid ?? r.id ?? "").trim() !== id) continue;
    const m = monthNum(r);
    if (m >= 1 && m <= 12) depByMonth[m] = (depByMonth[m] || 0) + num(r.amount ?? r.Amount, 0);
  }

  // Withdrawals per month for this investor
  const wdByMonth = {};
  for (const r of withdrawalsSheet) {
    if (String(r.investorid ?? r.id ?? "").trim() !== id) continue;
    const m = monthNum(r);
    if (m >= 1 && m <= 12) wdByMonth[m] = (wdByMonth[m] || 0) + num(r.amount ?? r.Amount, 0);
  }

  // Month-by-month compounding
  let balance = startCapital;
  let totalGain = 0;
  const breakdown = [];

  for (const row of monthlyHistory) {
    const m = row.monthNumber;
    const deps = depByMonth[m] || 0;
    const wds = wdByMonth[m] || 0;

    const startBal = Math.max(0, balance + deps - wds);
    const effectivePct = row.grossReturnPct * (splitPct / 100);
    const gain = startBal * (effectivePct / 100);
    const endBal = Math.max(0, startBal + gain - recurringDraw);

    balance = endBal;
    totalGain += gain;

    breakdown.push({
      month: row.month,
      monthNumber: m,
      grossReturnPct: row.grossReturnPct,
      effectiveReturnPct: effectivePct,
      startingBalance: startBal,
      gain,
      recurringDraw,
      oneTimeWithdrawal: wds,
      deposits: deps,
      endingBalance: endBal
    });
  }

  // Live performance — zeroed out (no external scraping)
  const live = {
    today: "0.00%",
    week: "0.00%",
    month: "0.00%",
    year: "0.00%",
    gain: "0.00%",
    absGain: "0.00%",
    daily: "0.00%",
    monthly: "0.00%",
    fetchedAt: new Date().toISOString()
  };

  const liveBase = balance || startCapital;
  const liveDollarGains = {
    today: liveBase * (pctToNum(live.today) / 100),
    week: liveBase * (pctToNum(live.week) / 100),
    month: liveBase * (pctToNum(live.month) / 100),
    year: liveBase * (pctToNum(live.year) / 100)
  };

  return {
    investor: { investorId: id, name: displayName, splitPct, recurringMonthlyDraw: recurringDraw },
    summary: {
      startingCapital: startCapital,
      currentBalance: balance,
      totalGain,
      netChange: balance - startCapital
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
