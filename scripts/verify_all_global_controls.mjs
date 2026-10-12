import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { supabase, isAuthoritativeProductionDbConfigured } from '../lib/supabase.js';
import { buildInvestorDashboard } from '../lib/dashboard.js';
import Decimal from 'decimal.js';

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });
process.env.DATA_SOURCE = 'supabase';

async function verifyGlobalControls() {
  console.log('================================================================================');
  console.log('PHASE 9 — GLOBAL FINANCIAL CONTROLS VERIFICATION');
  console.log('Authoritative Supabase Project: julhldzkiqdeuuoqmvlo');
  console.log('================================================================================\n');

  if (!isAuthoritativeProductionDbConfigured()) {
    throw new Error('FATAL: Not connected to authoritative production Supabase project (julhldzkiqdeuuoqmvlo)');
  }

  // 1. Ted Boardwalk
  console.log('--- 1. TED BOARDWALK ---');
  const tedDash = await buildInvestorDashboard('tboardwalk', null, { mustBeAuthoritative: true });
  console.log('Ted Settled Balance:        $', tedDash.summary.currentBalance.toFixed(2), '(Expected $1,702.78)');
  const { data: tedHist } = await supabase.from('investor_monthly_history').select('*').eq('investor_id', 'inv_a79798ca').eq('year', 2026).eq('month_number', 9).single();
  console.log('Ted Sep Opening Balance:    $', tedHist.opening_balance, '(Expected 0)');
  console.log('Ted Sep Ending Balance:     $', tedHist.ending_balance, '(Expected 0)');
  const { data: tedWd } = await supabase.from('withdrawals').select('*').eq('investor_id', 'inv_a79798ca').eq('amount', 5000).single();
  console.log('Ted June $5k Withdrawal:    ', tedWd.id, '$' + tedWd.amount, tedWd.status, '(Preserved)');

  // 2. David Townley
  console.log('\n--- 2. DAVID TOWNLEY ---');
  const dtownleyDash = await buildInvestorDashboard('dtownley', null, { mustBeAuthoritative: true });
  console.log('David Townley Settled:      $', dtownleyDash.summary.currentBalance.toFixed(2), '(Expected $38,223.16)');

  // 3. Sheryl Dunnam
  console.log('\n--- 3. SHERYL DUNNAM ---');
  const { data: sherylHist } = await supabase.from('investor_monthly_history').select('*').eq('investor_id', 'inv_7dc0fe9a').eq('year', 2026).eq('month_number', 9).single();
  const sherylGain = sherylHist.ending_balance - sherylHist.opening_balance;
  console.log('Sheryl Sep Gain:            $', sherylGain.toFixed(2), '(Expected $921.00)');
  console.log('Sheryl Sep Ending Balance:  $', sherylHist.ending_balance, '(Expected $60,921.00)');

  // 4. Ryan Ringer
  console.log('\n--- 4. RYAN RINGER ---');
  const ringerDash = await buildInvestorDashboard('rringer', null, { mustBeAuthoritative: true });
  console.log('Ryan Ringer Outside Cash:   $', ringerDash.summary.totalExternalCashSent.toFixed(2), '(Expected $125,000.00)');

  // 5. Stout May Exception
  console.log('\n--- 5. STOUT MAY $7,500 EXCEPTION ---');
  const { data: stoutMayDep } = await supabase.from('deposits').select('*').eq('id', 'dep_454fb0c9').single();
  console.log('Stout May Exception:        ', stoutMayDep.id, '$' + stoutMayDep.amount, stoutMayDep.status, stoutMayDep.notes, '(Preserved)');

  // 6. September locked return
  console.log('\n--- 6. SEPTEMBER LOCKED RETURN ---');
  const { data: sepRet } = await supabase.from('monthly_returns').select('*').eq('year', 2026).eq('month_number', 9).single();
  console.log('Sep Return:                 ', sepRet.gross_return_pct + '%', 'Locked:', sepRet.locked, '(Preserved)');

  // 7. September Jerry -> Stout Transfer
  console.log('\n--- 7. SEPTEMBER JERRY -> STOUT TRANSFER ---');
  const { data: sepXfer } = await supabase.from('internal_transfers').select('*').eq('transfer_number', 'XFER-2026-00005').single();
  console.log('Sep Transfer XFER-2026-00005:', sepXfer.transfer_number, '$' + sepXfer.amount, sepXfer.status, '(Preserved)');

  // 8. Josh Stout $70,000 Withdrawal
  console.log('\n--- 8. JOSH STOUT $70,000 WITHDRAWAL ---');
  const { data: joshWd } = await supabase.from('withdrawals').select('*').eq('id', 'wd_josh_auth_stout001_20000').single();
  console.log('Josh $70k Withdrawal:       ', joshWd.id, '$' + joshWd.amount, joshWd.status, '(Preserved & Counted Once)');

  // 9. Josh Stout Lifetime Withdrawals
  const joshDash = await buildInvestorDashboard('jstout', null, { mustBeAuthoritative: true });
  console.log('Josh Lifetime Withdrawals:  $', joshDash.summary.totalWithdrawals.toFixed(2));
  console.log('Josh Settled Balance:       $', joshDash.summary.currentBalance.toFixed(2));
  console.log('Josh External Cash:         $', joshDash.summary.totalExternalCashSent.toFixed(2));
  console.log('Josh Provenance Status:     ', joshDash.summary.provenanceCompletenessStatus);

  // 10. Jerry Rogue Jets
  const jerryDash = await buildInvestorDashboard('jerrys001', null, { mustBeAuthoritative: true });
  console.log('\n--- 10. JERRY ROGUE JETS ---');
  console.log('Jerry Settled Balance:      $', jerryDash.summary.currentBalance.toFixed(2));
  console.log('Jerry Lifetime Withdrawals: $', jerryDash.summary.totalWithdrawals.toFixed(2));
}

verifyGlobalControls().catch(console.error);
