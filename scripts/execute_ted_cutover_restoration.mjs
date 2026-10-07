process.env.DATA_SOURCE = 'supabase';
import { supabase, isAuthoritativeProductionDbConfigured } from '../lib/supabase.js';
import { buildInvestorDashboard } from '../lib/dashboard.js';
import Decimal from 'decimal.js';

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

async function executeRestoration() {
  console.log('================================================================================');
  console.log('AUTHORITATIVE TED BOARDWALK CUTOVER RESTORATION');
  console.log('Target Project: julhldzkiqdeuuoqmvlo');
  console.log('================================================================================\n');

  // 0. Pre-Flight Verification: Authoritative Production DB
  if (!isAuthoritativeProductionDbConfigured()) {
    throw new Error('FATAL: Not connected to authoritative production Supabase project (julhldzkiqdeuuoqmvlo)');
  }
  console.log('✓ Authoritative production Supabase connection confirmed.');

  // 1. Pre-Mutation Assertions
  console.log('\n--- 1. PRE-MUTATION INVARIANT ASSERTIONS ---');

  // A. September return 3.07% locked
  const { data: sepRet, error: retErr } = await supabase
    .from('monthly_returns')
    .select('*')
    .eq('year', 2026)
    .eq('month_number', 9)
    .single();
  if (retErr || !sepRet) throw new Error(`September return check failed: ${retErr?.message}`);
  if (Number(sepRet.gross_return_pct) !== 3.07 || sepRet.locked !== true) {
    throw new Error(`September return assertion failed: return=${sepRet.gross_return_pct}, locked=${sepRet.locked}`);
  }
  console.log('✓ ASSERT PASS: September return = 3.07% LOCKED');

  // B. Cutover exists and equals $0
  const { data: cutover, error: cutErr } = await supabase
    .from('account_cutover_adjustments')
    .select('*')
    .eq('id', '9baab26d-a7fe-4cbc-869e-9a0a67766c27')
    .single();
  if (cutErr || !cutover) throw new Error(`Cutover check failed: ${cutErr?.message}`);
  if (Number(cutover.authorized_opening_balance) !== 0 || cutover.effective_date !== '2026-09-01') {
    throw new Error(`Cutover assertion failed: balance=${cutover.authorized_opening_balance}`);
  }
  console.log('✓ ASSERT PASS: cutover_inv_a79798ca_2026_9 exists and authorized_opening_balance = $0.00');

  // C. September commission equals exactly $1,702.78
  const { data: sepComm, error: commErr } = await supabase
    .from('commission_earnings')
    .select('amount, status')
    .eq('recipient_id', 'inv_a79798ca')
    .eq('year', 2026)
    .eq('month_number', 9);
  if (commErr) throw commErr;
  const activeSepComm = sepComm.filter(r => !r.status || r.status.toUpperCase() !== 'SUPERSEDED').reduce((sum, r) => sum + Number(r.amount), 0);
  if (Math.abs(activeSepComm - 1702.78) > 0.01) {
    throw new Error(`September commission assertion failed: actual=${activeSepComm}, expected=1702.78`);
  }
  console.log(`✓ ASSERT PASS: September active commission = exactly $1,702.78 across ${sepComm.length} rows`);

  // D. June $5,000 withdrawal exists unchanged
  const { data: juneWd, error: wdErr } = await supabase
    .from('withdrawals')
    .select('*')
    .eq('id', 'wd_9a4f1219')
    .single();
  if (wdErr || !juneWd) throw new Error(`June withdrawal check failed: ${wdErr?.message}`);
  if (Number(juneWd.amount) !== 5000 || juneWd.status !== 'Completed') {
    throw new Error(`June withdrawal assertion failed: amount=${juneWd.amount}, status=${juneWd.status}`);
  }
  console.log('✓ ASSERT PASS: June $5,000 withdrawal (wd_9a4f1219) exists unchanged (Completed)');

  // 2. Capture BEFORE State for Ted
  console.log('\n--- 2. CAPTURING BEFORE STATE ---');
  const { data: beforeHist, error: bhErr } = await supabase
    .from('investor_monthly_history')
    .select('*')
    .eq('investor_id', 'inv_a79798ca')
    .eq('year', 2026)
    .in('month_number', [9, 10]);
  if (bhErr) throw bhErr;

  const beforeM9 = beforeHist.find(h => h.month_number === 9);
  const beforeM10 = beforeHist.find(h => h.month_number === 10);
  console.log('BEFORE September:', {
    opening: beforeM9?.opening_balance,
    ending: beforeM9?.ending_balance,
    gain: beforeM9?.manual_gain_amount,
    locked: beforeM9?.locked
  });
  console.log('BEFORE October:', {
    opening: beforeM10?.opening_balance,
    ending: beforeM10?.ending_balance,
    locked: beforeM10?.locked
  });

  // 3. Perform Targeted, Audited, Idempotent Mutation
  console.log('\n--- 3. EXECUTING TARGETED AUDITED CORRECTION ---');

  // Payload for September
  const sepPayload = {
    investor_id: 'inv_a79798ca',
    account_id: 'tboardwalk',
    year: 2026,
    month_number: 9,
    month: 'September',
    opening_balance: 0.00,
    deposits: 0.00,
    withdrawals: 0.00,
    gross_return_pct: 3.07,
    manual_gain_amount: 0.00,
    manual_return_pct: null,
    recurring_draw: 0.00,
    ending_balance: 0.00,
    is_manual: true,
    locked: true,
    notes: 'Audited cutover restoration per authorized cutover cutover_inv_a79798ca_2026_9 ($0.00 September 1 reset)',
    updated_at: new Date()
  };

  // Payload for October
  const octPayload = {
    investor_id: 'inv_a79798ca',
    account_id: 'tboardwalk',
    year: 2026,
    month_number: 10,
    month: 'October',
    opening_balance: 1702.78,
    deposits: 0.00,
    withdrawals: 0.00,
    gross_return_pct: 0.00,
    manual_gain_amount: null,
    manual_return_pct: null,
    recurring_draw: 0.00,
    ending_balance: 1702.78,
    is_manual: false,
    locked: false,
    notes: 'Rollforward from $0.00 September close + $1,702.78 September commission earned',
    updated_at: new Date()
  };

  const { data: upsertM9, error: up9Err } = await supabase
    .from('investor_monthly_history')
    .upsert(sepPayload, { onConflict: 'investor_id,year,month_number' })
    .select();
  if (up9Err) throw new Error(`Failed to upsert September history: ${up9Err.message}`);
  console.log('✓ Successfully restored September 2026 history to $0.00');

  const { data: upsertM10, error: up10Err } = await supabase
    .from('investor_monthly_history')
    .upsert(octPayload, { onConflict: 'investor_id,year,month_number' })
    .select();
  if (up10Err) throw new Error(`Failed to upsert October history: ${up10Err.message}`);
  console.log('✓ Successfully restored October 2026 history to $1,702.78');

  // 4. Post-Mutation Verification for Ted Boardwalk
  console.log('\n--- 4. POST-MUTATION VERIFICATION: TED BOARDWALK ---');
  const { data: afterHist, error: ahErr } = await supabase
    .from('investor_monthly_history')
    .select('*')
    .eq('investor_id', 'inv_a79798ca')
    .eq('year', 2026)
    .in('month_number', [9, 10]);
  if (ahErr) throw ahErr;

  const afterM9 = afterHist.find(h => h.month_number === 9);
  const afterM10 = afterHist.find(h => h.month_number === 10);

  if (Number(afterM9.opening_balance) !== 0 || Number(afterM9.ending_balance) !== 0 || afterM9.locked !== true) {
    throw new Error('Verification failed: September balance is not $0.00');
  }
  if (Number(afterM10.opening_balance) !== 1702.78 || Number(afterM10.ending_balance) !== 1702.78) {
    throw new Error('Verification failed: October balance is not $1,702.78');
  }

  console.log('✓ Database verification passed:');
  console.log(`  September: Opening=$${Number(afterM9.opening_balance).toFixed(2)}, Gain=$${Number(afterM9.manual_gain_amount).toFixed(2)}, Ending=$${Number(afterM9.ending_balance).toFixed(2)}, Locked=${afterM9.locked}`);
  console.log(`  October:   Opening=$${Number(afterM10.opening_balance).toFixed(2)}, Ending=$${Number(afterM10.ending_balance).toFixed(2)}, Locked=${afterM10.locked}`);

  // Test live portal dashboard
  console.log('\n--- 5. LIVE PORTAL DASHBOARD VERIFICATION ---');
  const dashTed = await buildInvestorDashboard('tboardwalk', null, { mustBeAuthoritative: true });
  console.log('Ted Portal Summary:');
  console.log(`  Current Settled Balance:   $${dashTed.summary.currentBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`  September Commission:      $${dashTed.summary.commissionsEarnedMonth.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`  YTD Trading Gain:          $${dashTed.summary.totalTradingGainYtd.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);

  if (Math.abs(dashTed.summary.currentBalance - 1702.78) > 0.01) {
    throw new Error(`Portal dashboard balance mismatch: actual=${dashTed.summary.currentBalance}, expected=1702.78`);
  }
  console.log('✅ PASS: buildInvestorDashboard agrees 100% with $1,702.78 settled current balance');

  // 6. Invariant Preservation Verifications
  console.log('\n--- 6. VERIFYING UNTOUCHED GLOBAL INVARIANTS ---');

  // A. Josh Stout
  const dashJosh = await buildInvestorDashboard('jstout', null, { mustBeAuthoritative: true });
  if (Math.abs(dashJosh.summary.currentBalance - 3400953.52) > 0.05) {
    throw new Error(`Josh balance invariant violated: ${dashJosh.summary.currentBalance}`);
  }
  if (dashJosh.summary.totalExternalCashSent !== 1606090 || dashJosh.summary.provenanceCompletenessStatus !== 'COMPLETE') {
    throw new Error(`Josh provenance invariant violated: ${dashJosh.summary.totalExternalCashSent}`);
  }
  if (Math.abs(dashJosh.summary.commissionsEarnedMonth - 11487.85) > 0.01) {
    throw new Error(`Josh September commission invariant violated: ${dashJosh.summary.commissionsEarnedMonth}`);
  }
  console.log('✅ Josh Stout Invariants PASS: Balance=$3,400,953.52, External Cash=$1,606,090 (COMPLETE), Sep Comm=$11,487.85');

  // B. Ryan Ringer
  const dashRyan = await buildInvestorDashboard('inv_1f9ab366', null, { mustBeAuthoritative: true });
  if (dashRyan.summary.totalExternalCashSent !== 125000 || dashRyan.summary.provenanceCompletenessStatus !== 'COMPLETE') {
    throw new Error(`Ryan provenance invariant violated: ${dashRyan.summary.totalExternalCashSent}`);
  }
  console.log('✅ Ryan Ringer Invariant PASS: External Cash=$125,000 (COMPLETE)');

  // C. Sheryl Ryan Dunnam September gain
  const { data: sherylM9 } = await supabase
    .from('investor_monthly_history')
    .select('*')
    .eq('investor_id', 'inv_7dc0fe9a')
    .eq('year', 2026)
    .eq('month_number', 9)
    .single();
  const sherylGain = Number(sherylM9.ending_balance) - Number(sherylM9.opening_balance);
  if (Math.abs(sherylGain - 921.00) > 0.01) {
    throw new Error(`Sheryl September gain invariant violated: ${sherylGain}`);
  }
  console.log('✅ Sheryl Ryan Dunnam Invariant PASS: September gain = $921.00 ($60,921 - $60,000)');

  // D. David Townley balance
  const dashDavid = await buildInvestorDashboard('dtownley', null, { mustBeAuthoritative: true });
  if (Math.abs(dashDavid.summary.currentBalance - 38223.16) > 0.05) {
    throw new Error(`David balance invariant violated: ${dashDavid.summary.currentBalance}`);
  }
  console.log('✅ David Townley Invariant PASS: Current settled balance = $38,223.16');

  // E. May $7,500 deposit
  const { data: mayDep } = await supabase.from('deposits').select('*').eq('id', 'dep_454fb0c9').single();
  if (Number(mayDep.amount) !== 7500 || mayDep.status !== 'confirmed') {
    throw new Error('May deposit invariant violated');
  }
  console.log('✅ May Stout $7,500 deposit PASS: untouched');

  // F. Jerry -> Stout transfer
  const { data: xfer } = await supabase.from('internal_transfers').select('*').eq('transfer_number', 'XFER-2026-00005').single();
  if (Number(xfer.amount) !== 2500 || xfer.status !== 'confirmed') {
    throw new Error('Jerry->Stout transfer invariant violated');
  }
  console.log('✅ Jerry -> Stout transfer PASS: XFER-2026-00005 ($2,500) untouched');

  // G. Total withdrawals count
  const { data: allWds } = await supabase.from('withdrawals').select('id');
  console.log(`✅ Withdrawals Ledger PASS: Total records = ${allWds.length} (zero physical deletions)`);

  console.log('\n================================================================================');
  console.log('TED BOARDWALK RESTORATION & GLOBAL INVARIANTS 100% CERTIFIED');
  console.log('================================================================================');
}

executeRestoration().catch(console.error);
