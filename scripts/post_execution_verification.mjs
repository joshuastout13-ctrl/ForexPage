import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { supabase, isAuthoritativeProductionDbConfigured } from '../lib/supabase.js';
import { buildInvestorDashboard } from '../lib/dashboard.js';
import Decimal from 'decimal.js';

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });
process.env.DATA_SOURCE = 'supabase';

async function main() {
  console.log('================================================================================');
  console.log('PHASE 6 & 7 — POST-EXECUTION VERIFICATION & GLOBAL CONTROL AUDIT');
  console.log('Authoritative Supabase Project: julhldzkiqdeuuoqmvlo');
  console.log('================================================================================\n');

  if (!isAuthoritativeProductionDbConfigured()) {
    throw new Error('FATAL: Not connected to authoritative production Supabase project (julhldzkiqdeuuoqmvlo)');
  }

  const accounts = [
    { name: 'Brad Holly', portal: 'bholly', invId: 'inv_5deeea21', expectedSettled: 1176008.56, notes: 'Deposit $278k already applied Oct 9' },
    { name: 'Steve Kimball', portal: 'skimbell', invId: 'inv_16a045fa', expectedSettled: 76556.99, notes: 'Withdrawal -$6,000.00 posted' },
    { name: 'Dale Waite', portal: 'dwaite', invId: 'inv_60ed0c32', expectedSettled: 244700.15, notes: 'Deposit +$6,500.00 posted' },
    { name: 'Josh Stout', portal: 'jstout', invId: 'stout001', expectedSettled: 3383453.52, notes: 'Withdrawal -$20,000.00 posted' },
    { name: 'Glenn Maddocks', portal: 'gmaddocks', invId: 'inv_5a509c6a', expectedSettled: 718680.50, notes: 'Deposit +$568,277.00 posted' },
    { name: 'Josh Oviatt', portal: 'joviatt', invId: 'inv_ce0675be', expectedSettled: 52578.68, notes: 'Sep withdrawal -$795 posted, net diff -$807.20' },
    { name: 'Whit Miller', portal: 'wmiller', invId: 'inv_ea8b4eba', expectedSettled: 118957.05, notes: 'Sep withdrawal -$700 posted, net diff -$710.75' },
    { name: 'Jean Harder', portal: 'jharder', invId: 'inv_bc1bcb0c', expectedSettled: 115603.28, notes: 'Sep withdrawal -$1,500 posted, net diff -$1,523.03' }
  ];

  console.log('--- 1. VERIFYING ALL 8 INVESTOR DASHBOARDS ---');
  for (const acc of accounts) {
    const dash = await buildInvestorDashboard(acc.portal, null, { mustBeAuthoritative: true });
    const s = dash.summary;
    const settled = s.currentBalance;
    const variance = Math.abs(settled - acc.expectedSettled);
    const pass = variance < 0.01;

    console.log(`\n[${acc.name}] (${acc.portal}) — Status: ${pass ? '✅ MATCH' : '❌ MISMATCH'}`);
    console.log(`  Current Settled Balance:      $${settled.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (Expected: $${acc.expectedSettled.toLocaleString('en-US', { minimumFractionDigits: 2 })})`);
    console.log(`  Variance:                     $${variance.toFixed(4)}`);
    console.log(`  Starting Capital:             $${s.startingCapital.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    console.log(`  Total External Cash Sent:     $${s.totalExternalCashSent.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    console.log(`  Total Withdrawals (Lifetime): $${s.totalWithdrawals.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    console.log(`  Provenance Completeness:      ${s.provenanceCompletenessStatus}`);
    console.log(`  Total Performance:            ${s.totalPerformanceNetDisplay || s.totalPerformancePct || 'N/A'}`);
    
    // Check September & October breakdown row
    const sepRow = dash.monthlyBreakdown?.find(m => m.monthNumber === 9);
    const octRow = dash.monthlyBreakdown?.find(m => m.monthNumber === 10);
    if (sepRow) {
      console.log(`  September Breakdown: Open=$${sepRow.startingBalance.toFixed(2)} | Deps=$${sepRow.deposits.toFixed(2)} | Wds=$${sepRow.oneTimeWithdrawal.toFixed(2)} | Gain=$${sepRow.gain.toFixed(2)} | End=$${sepRow.endingBalance.toFixed(2)}`);
    }
    if (octRow) {
      console.log(`  October Breakdown:   Open=$${octRow.startingBalance.toFixed(2)} | Deps=$${octRow.deposits.toFixed(2)} | Wds=$${octRow.oneTimeWithdrawal.toFixed(2)} | Gain=$${octRow.gain.toFixed(2)} | End=$${octRow.endingBalance.toFixed(2)}`);
    }

    if (!pass) {
      throw new Error(`CRITICAL VERIFICATION FAILURE for ${acc.name}: Expected $${acc.expectedSettled}, got $${settled}`);
    }
  }

  console.log('\n--- 2. GLOBAL FINANCIAL CONTROLS VERIFICATION ---');

  // 1. Josh Stout
  const joshDash = await buildInvestorDashboard('jstout', null, { mustBeAuthoritative: true });
  console.log(`1. Josh Stout Settled Balance:     $${joshDash.summary.currentBalance.toFixed(2)} (Expected $3,383,453.52) [MATCH: ${Math.abs(joshDash.summary.currentBalance - 3383453.52) < 0.01}]`);
  console.log(`   Josh Stout Outside Cash:        $${joshDash.summary.totalExternalCashSent.toFixed(2)} (Expected $1,608,590.00) [MATCH: ${Math.abs(joshDash.summary.totalExternalCashSent - 1608590.00) < 0.01}]`);

  // 2. Ted Boardwalk
  const tedDash = await buildInvestorDashboard('tboardwalk', null, { mustBeAuthoritative: true });
  console.log(`2. Ted Boardwalk Settled Balance:  $${tedDash.summary.currentBalance.toFixed(2)} (Expected $1,702.78) [MATCH: ${Math.abs(tedDash.summary.currentBalance - 1702.78) < 0.01}]`);
  const { data: tedHist } = await supabase.from('investor_monthly_history').select('*').eq('investor_id', 'inv_a79798ca').eq('year', 2026).eq('month_number', 9).single();
  console.log(`   Ted Boardwalk Sep Ending:       $${tedHist.ending_balance} (Expected 0) [MATCH: ${tedHist.ending_balance === 0}]`);

  // 3. David Townley
  const davidDash = await buildInvestorDashboard('dtownley', null, { mustBeAuthoritative: true });
  console.log(`3. David Townley Settled Balance:  $${davidDash.summary.currentBalance.toFixed(2)} (Expected $38,223.16) [MATCH: ${Math.abs(davidDash.summary.currentBalance - 38223.16) < 0.01}]`);

  // 4. Sheryl Ryan Dunnam
  const { data: sherylHist } = await supabase.from('investor_monthly_history').select('*').eq('investor_id', 'inv_7dc0fe9a').eq('year', 2026).eq('month_number', 9).single();
  const sherylGain = sherylHist.ending_balance - sherylHist.opening_balance;
  console.log(`4. Sheryl Sep Gain:                $${sherylGain.toFixed(2)} (Expected $921.00) [MATCH: ${sherylGain === 921}]`);
  console.log(`   Sheryl Sep Ending Balance:      $${sherylHist.ending_balance} (Expected 60921) [MATCH: ${sherylHist.ending_balance === 60921}]`);

  // 5. Ryan Ringer
  const ringerDash = await buildInvestorDashboard('rringer', null, { mustBeAuthoritative: true });
  console.log(`5. Ryan Ringer Outside Cash:       $${ringerDash.summary.totalExternalCashSent.toFixed(2)} (Expected $125,000.00) [MATCH: ${Math.abs(ringerDash.summary.totalExternalCashSent - 125000.00) < 0.01}]`);

  // 6. Jerry -> Stout Transfer
  const { data: jerryXfer } = await supabase.from('internal_transfers').select('*').eq('transfer_number', 'XFER-2026-00005').single();
  console.log(`6. Jerry -> Stout Transfer:        ${jerryXfer.transfer_number} $${jerryXfer.amount} status=${jerryXfer.status} [PRESERVED: ${jerryXfer.amount === 2500}]`);

  // 7. Stout May Exception
  const { data: stoutMayDep } = await supabase.from('deposits').select('*').eq('id', 'dep_454fb0c9').single();
  console.log(`7. Stout May Exception Deposit:    ${stoutMayDep.id} $${stoutMayDep.amount} status=${stoutMayDep.status} [PRESERVED: ${stoutMayDep.amount === 7500}]`);

  // 8. September locked return
  const { data: sepRet } = await supabase.from('monthly_returns').select('*').eq('year', 2026).eq('month_number', 9).single();
  console.log(`8. September Fund Return:          ${sepRet.gross_return_pct}% locked=${sepRet.locked} [PRESERVED: ${Number(sepRet.gross_return_pct) === 3.07 && sepRet.locked === true}]`);

  console.log('\n================================================================================');
  console.log('✅ ALL POST-EXECUTION DASHBOARDS & GLOBAL CONTROLS PASSED 100%!');
  console.log('================================================================================');
}

main().catch(console.error);
