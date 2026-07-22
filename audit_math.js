import { readSupabaseTable } from "./lib/supabase.js";
import { buildInvestorDashboard } from "./lib/dashboard.js";

async function run() {
  const [investors, accounts, returns, deposits, wds, history, commEarnings, commShares] = await Promise.all([
    readSupabaseTable("investors"),
    readSupabaseTable("investor_accounts"),
    readSupabaseTable("monthly_returns"),
    readSupabaseTable("deposits"),
    readSupabaseTable("withdrawals"),
    readSupabaseTable("investor_monthly_history"),
    readSupabaseTable("commission_earnings"),
    readSupabaseTable("commission_shares"),
  ]);

  const preloaded = {
    rawInvestors: investors, accounts, returnsSheet: returns,
    depositsSheet: deposits, withdrawalsSheet: wds, historyTable: history,
    commissionEarningsTable: commEarnings, commissionSharesTable: commShares,
    live: { today: "0%", week: "0%", month: "0%", source: "API" }
  };

  for (const id of ["Tkruger", "vmoss", "Arichards"]) {
    try {
      const db = await buildInvestorDashboard(id, preloaded);
      console.log(`\n=== ${id} ===`);
      console.log(`Current Balance: ${db.summary.currentBalance}`);
      for (const b of db.breakdown) {
        if (b.monthNumber >= 4 && b.monthNumber <= 6) {
          console.log(`Month ${b.monthNumber}: Start=${b.startingBalance}, AdjStart=${b.adjustedStartingBalance}, Deps=${b.deposits}, Wds=${b.oneTimeWithdrawal}, Gain=${b.gain}, End=${b.endingBalance}`);
        }
      }
    } catch (e) {
      console.error(e.message);
    }
  }
}
run();
