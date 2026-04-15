import { readSheet, numberValue, truthy, monthNumberFromRow } from "./sheets.js";
import { fetchMyfxbookHeadlines } from "./myfxbook.js";
import { CONFIG } from "./config.js";

const MONTH_NAMES = [
  "", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
];

/**
 * Builds the full dashboard payload for a given investor ID.
 * Fetches all sheet tabs and Myfxbook headlines in parallel.
 */
export async function buildDashboard(investorId) {
  const id = String(investorId ?? "").trim();
  if (!id) throw Object.assign(new Error("Missing investor ID"), { status: 400 });

  const [investors, accounts, deposits, withdrawals, monthlyReturns, myfxbook] =
    await Promise.all([
      readSheet(CONFIG.tabs.investors),
      readSheet(CONFIG.tabs.accounts),
      readSheet(CONFIG.tabs.deposits),
      readSheet(CONFIG.tabs.withdrawals),
      readSheet(CONFIG.tabs.monthlyReturns),
      fetchMyfxbookHeadlines()
    ]);

  // Match by investorid or id column (case-insensitive normalised key)
  const investor = investors.find(
    (r) => String(r.investorid ?? r.id ?? "").trim() === id
  );
  if (!investor) {
    throw Object.assign(new Error("Investor not found"), { status: 404 });
  }

  const byInvestor = (rows) =>
    rows.filter((r) => String(r.investorid ?? r.id ?? "").trim() === id);

  // Build monthly returns array, sorted chronologically
  const returns = monthlyReturns
    .map((r) => {
      const month = monthNumberFromRow(r);
      const year = numberValue(r.Year ?? r.year, CONFIG.defaultFundYear);
      const pct = numberValue(
        r.Return ?? r.return ?? r.returnpct ?? r.monthlyreturn,
        null
      );
      return {
        year,
        month,
        monthName: MONTH_NAMES[month] ?? String(r.Month ?? r.month ?? "").trim(),
        returnPct: pct
      };
    })
    .filter((r) => r.month >= 1 && r.month <= 12)
    .sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month);

  // Summary totals from deposits / withdrawals
  const totalDeposited = byInvestor(deposits).reduce(
    (s, r) => s + numberValue(r.Amount ?? r.amount, 0),
    0
  );
  const totalWithdrawn = byInvestor(withdrawals).reduce(
    (s, r) => s + numberValue(r.Amount ?? r.amount, 0),
    0
  );

  return {
    investor: {
      id,
      name: String(
        investor.Name ?? investor.name ?? investor.investorname ?? ""
      ).trim(),
      email: String(investor.Email ?? investor.email ?? "").trim()
    },
    summary: {
      totalDeposited,
      totalWithdrawn,
      netDeposited: totalDeposited - totalWithdrawn
    },
    accounts: byInvestor(accounts),
    deposits: byInvestor(deposits),
    withdrawals: byInvestor(withdrawals),
    monthlyReturns: returns,
    myfxbook
  };
}
