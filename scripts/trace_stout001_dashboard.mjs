process.env.DATA_SOURCE = 'supabase';
import { supabase } from '../lib/supabase.js';
import { buildInvestorDashboard } from '../lib/dashboard.js';

async function run() {
  console.log('=== RUNNING BUILD_INVESTOR_DASHBOARD FOR stout001 ===');
  const d = await buildInvestorDashboard('stout001', null, { mustBeAuthoritative: true });

  console.log('SUMMARY for stout001:');
  console.log(JSON.stringify(d.summary, null, 2));

  console.log('\nBREAKDOWN (MONTH BY MONTH):');
  d.breakdown.forEach(b => {
    console.log(`Month ${b.monthNumber} (${b.month}): Starting=${b.startingBalance}, AdjStart=${b.adjustedStartingBalance}, Deps=${b.deposits}, Wds=${b.oneTimeWithdrawal}, Draw=${b.recurringDraw}, Gain=${b.gain}, End=${b.endingBalance}, HistComp=${b.isHistoricalCompleted}, Open=${b.isOpenMonth}, Proj=${b.isProjection}, Manual=${b.isManual}`);
  });
}

run().catch(console.error);
