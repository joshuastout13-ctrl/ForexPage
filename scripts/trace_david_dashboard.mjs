process.env.DATA_SOURCE = 'supabase';
import { buildInvestorDashboard } from '../lib/dashboard.js';

async function main() {
  console.log('=== LIVE DASHBOARD FOR DAVID TOWNLEY (dtownley) ===\n');
  const d = await buildInvestorDashboard('dtownley', null, { mustBeAuthoritative: true });
  
  console.log('SUMMARY:');
  console.log(JSON.stringify(d.summary, null, 2));

  console.log('\nBREAKDOWN:');
  d.breakdown.forEach(b => {
    console.log(`Month ${String(b.monthNumber).padStart(2)} (${b.month.padEnd(9)}): Starting=$${Number(b.startingBalance).toFixed(2).padStart(10)} | Deps=$${Number(b.deposits).toFixed(2).padStart(8)} | Wds=$${Number(b.oneTimeWithdrawal).toFixed(2).padStart(8)} | CommAdded=$${Number(b.commissionAdded).toFixed(2).padStart(8)} | Gain=$${Number(b.gain).toFixed(2).padStart(9)} | End=$${Number(b.endingBalance).toFixed(2).padStart(10)} | HistComp=${b.isHistoricalCompleted} | Open=${b.isOpenMonth}`);
  });
}

main().catch(console.error);
