process.env.DATA_SOURCE = 'supabase';
import { supabase } from '../lib/supabase.js';
import { buildInvestorDashboard } from '../lib/dashboard.js';

async function run() {
  console.log('=== RUNNING BUILD_INVESTOR_DASHBOARD FOR JSTOUT ===');
  const d = await buildInvestorDashboard('jstout', null, { mustBeAuthoritative: true });

  console.log('SUMMARY:');
  console.log(JSON.stringify(d.summary, null, 2));

  console.log('\nBREAKDOWN (MONTH BY MONTH):');
  d.breakdown.forEach(b => {
    console.log(`Month ${b.monthNumber} (${b.month}): Starting=${b.startingBalance}, Deps=${b.deposits}, Wds=${b.oneTimeWithdrawal}, Draw=${b.recurringDraw}, Gain=${b.gain}, End=${b.endingBalance}, HistComp=${b.isHistoricalCompleted}, Open=${b.isOpenMonth}, Proj=${b.isProjection}, Manual=${b.isManual}`);
  });
}

run().catch(console.error);
