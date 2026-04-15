import { verifySession, parseCookies } from "../lib/auth.js";
import { readSheet, numberValue, truthy, monthNumberFromRow } from "../lib/sheets.js";
import { fetchLiveStats, parseLivePct } from "../lib/myfxbook.js";
import { CONFIG } from "../lib/config.js";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

export default async function handler(req, res) {
  const cookies = parseCookies(req);
  const token = cookies.scff_session || "";
  const session = verifySession(token);

  if (!session) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  try {
    const [investors, accounts, deposits, withdrawals, monthlyReturns, live] =
      await Promise.all([
        readSheet(CONFIG.tabs.investors),
        readSheet(CONFIG.tabs.accounts),
        readSheet(CONFIG.tabs.deposits),
        readSheet(CONFIG.tabs.withdrawals),
        readSheet(CONFIG.tabs.monthlyReturns),
        fetchLiveStats()
      ]);

    const investor = investors.find(
      (r) =>
        String(r.username || "").trim().toLowerCase() === session.username.toLowerCase()
    );

    if (!investor || !truthy(investor.active)) {
      return res.status(401).json({ error: "Investor not found" });
    }

    const splitPct = numberValue(
      investor.splitpct || investor["split pct"] || investor["split%"],
      100
    );

    const account = accounts.find(
      (r) =>
        String(r.username || "").trim().toLowerCase() === session.username.toLowerCase()
    );

    const initialDeposit = account
      ? numberValue(account.initialdeposit || account["initial deposit"])
      : 0;
    const recurringDraw = account
      ? numberValue(account.recurringdraw || account["recurring draw"])
      : 0;
    const fundYear = account
      ? numberValue(
          account.year || account.fundingyear || account["funding year"],
          CONFIG.defaultFundYear
        )
      : CONFIG.defaultFundYear;

    const myDeposits = deposits.filter(
      (r) =>
        String(r.username || "").trim().toLowerCase() === session.username.toLowerCase()
    );
    const myWithdrawals = withdrawals.filter(
      (r) =>
        String(r.username || "").trim().toLowerCase() === session.username.toLowerCase()
    );

    const returns = monthlyReturns.filter(
      (r) => numberValue(r.year, CONFIG.defaultFundYear) === fundYear
    );

    let balance = initialDeposit;
    let totalGain = 0;
    const breakdown = [];
    const monthlyHistory = [];

    for (let m = 1; m <= 12; m++) {
      const monthReturn = returns.find((r) => monthNumberFromRow(r) === m);
      if (!monthReturn) continue;

      const grossReturnPct = numberValue(
        monthReturn.grossreturnpct ||
          monthReturn["gross return pct"] ||
          monthReturn["gross return"] ||
          monthReturn.returnpct ||
          monthReturn.return
      );

      monthlyHistory.push({ month: MONTHS[m - 1], grossReturnPct });

      const monthDeposits = myDeposits
        .filter(
          (r) =>
            numberValue(r.month, NaN) === m ||
            String(r.month || "").trim().toLowerCase() === MONTHS[m - 1].toLowerCase()
        )
        .reduce((sum, r) => sum + numberValue(r.amount), 0);

      const monthOneTime = myWithdrawals
        .filter(
          (r) =>
            (numberValue(r.month, NaN) === m ||
              String(r.month || "").trim().toLowerCase() === MONTHS[m - 1].toLowerCase()) &&
            String(r.type || "").trim().toLowerCase() !== "recurring"
        )
        .reduce((sum, r) => sum + numberValue(r.amount), 0);

      const startingBalance = balance + monthDeposits - monthOneTime;
      const effectiveReturnPct = grossReturnPct * (splitPct / 100);
      const gain = startingBalance * (effectiveReturnPct / 100);
      const endingBalance = startingBalance + gain - recurringDraw;

      totalGain += gain;
      balance = endingBalance;

      breakdown.push({
        month: MONTHS[m - 1],
        startingBalance,
        grossReturnPct,
        effectiveReturnPct,
        gain,
        deposits: monthDeposits,
        recurringDraw,
        oneTimeWithdrawal: monthOneTime,
        endingBalance
      });
    }

    const currentBalance = balance;
    const netChange = currentBalance - initialDeposit;

    const liveDollarGains = {
      today: currentBalance * (parseLivePct(live.today) / 100),
      week: currentBalance * (parseLivePct(live.week) / 100),
      month: currentBalance * (parseLivePct(live.month) / 100),
      year: currentBalance * (parseLivePct(live.year) / 100)
    };

    return res.status(200).json({
      investor: {
        name: String(investor.name || investor.Name || session.username),
        splitPct
      },
      summary: {
        startingCapital: initialDeposit,
        currentBalance,
        totalGain,
        netChange
      },
      live,
      liveDollarGains,
      monthlyHistory,
      breakdown
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
