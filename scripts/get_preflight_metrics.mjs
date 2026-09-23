import { supabase } from '../lib/supabase.js';
import { buildInvestorDashboard } from '../lib/dashboard.js';

async function main() {
  process.env.DATA_SOURCE = 'supabase';
  console.log('=== AUTHORITATIVE PRE-FLIGHT FINANCIAL METRICS ===\n');

  // Jerry's Rogue Jets (jerrys001)
  console.log('--- JERRY (jerrys001) ---');
  const dJerry = await buildInvestorDashboard('jerrys001', null, { mustBeAuthoritative: true });
  console.log('Current Balance:    $', dJerry.summary.currentBalance.toLocaleString('en-US', { minimumFractionDigits: 2 }));
  console.log('Total Withdrawals:  $', dJerry.summary.totalWithdrawals.toLocaleString('en-US', { minimumFractionDigits: 2 }));
  console.log('Total Deposits:     $', dJerry.summary.totalExternalCashSent.toLocaleString('en-US', { minimumFractionDigits: 2 }));
  console.log('Total Gain YTD:     $', dJerry.summary.totalGain.toLocaleString('en-US', { minimumFractionDigits: 2 }));

  // Josh Stout (jstout / stout001)
  console.log('\n--- JOSH STOUT (stout001) ---');
  const dStout = await buildInvestorDashboard('jstout', null, { mustBeAuthoritative: true });
  console.log('Current Balance:    $', dStout.summary.currentBalance.toLocaleString('en-US', { minimumFractionDigits: 2 }));
  console.log('Total Withdrawals:  $', dStout.summary.totalWithdrawals.toLocaleString('en-US', { minimumFractionDigits: 2 }));
  console.log('Total Deposits:     $', dStout.summary.totalExternalCashSent.toLocaleString('en-US', { minimumFractionDigits: 2 }));
  console.log('Provenance Status:  ', dStout.summary.provenanceCompletenessStatus);
  console.log('Total Gain YTD:     $', dStout.summary.totalGain.toLocaleString('en-US', { minimumFractionDigits: 2 }));
}

main().catch(console.error);
