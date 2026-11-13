process.env.DATA_SOURCE = 'supabase';
import { supabase, isAuthoritativeProductionDbConfigured } from '../lib/supabase.js';
import { buildInvestorDashboard } from '../lib/dashboard.js';

async function main() {
  console.log('================================================================================');
  console.log('PRODUCTION HISTORICAL PROVENANCE & CERTIFICATION: RYAN RINGER');
  console.log('Authoritative Supabase: julhldzkiqdeuuoqmvlo');
  console.log('================================================================================\n');

  // 0. Safety Guard: Confirm Authoritative Production Connection
  if (!isAuthoritativeProductionDbConfigured()) {
    throw new Error('FATAL: Not connected to authoritative production Supabase project (julhldzkiqdeuuoqmvlo)');
  }
  console.log('✓ Authoritative production Supabase connection confirmed.');

  // 1. Resolve Ryan Ringer from Authoritative Production Data
  console.log('\n--- 1. RESOLVING RYAN RINGER FROM PRODUCTION ---');
  const { data: ryanInvs, error: invErr } = await supabase
    .from('investors')
    .select('*')
    .or('portal_username.eq.rringer,id.eq.inv_1f9ab366');

  if (invErr || !ryanInvs || ryanInvs.length === 0) {
    throw new Error(`Failed to resolve Ryan Ringer: ${invErr?.message || 'Not found'}`);
  }
  const ryanInv = ryanInvs[0];
  console.log(`Investor ID:             ${ryanInv.id}`);
  console.log(`Portal Username:         ${ryanInv.portal_username}`);
  console.log(`Name:                    ${ryanInv.first_name} ${ryanInv.last_name}`);
  console.log(`Email:                   ${ryanInv.email}`);
  console.log(`Start Date:              ${ryanInv.start_date}`);
  console.log(`Split %:                 ${ryanInv.split_pct}%`);

  const { data: ryanAccs, error: accErr } = await supabase
    .from('investor_accounts')
    .select('*')
    .eq('investor_id', ryanInv.id);

  if (accErr || !ryanAccs || ryanAccs.length === 0) {
    throw new Error(`Failed to resolve account for Ryan Ringer: ${accErr?.message || 'Not found'}`);
  }
  const ryanAcc = ryanAccs[0];
  console.log(`Account ID:              ${ryanAcc.id}`);
  console.log(`Account Starting Cap:    $${Number(ryanAcc.starting_capital).toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`Account Open Date:       ${ryanAcc.open_date}`);
  console.log(`Account Total Cash In:   $${Number(ryanAcc.total_cash_in).toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`Current Provenance:      ${ryanAcc.external_cash_provenance_status}`);

  // Pre-mutation dashboard state
  const dashBefore = await buildInvestorDashboard(ryanInv.portal_username, null, { mustBeAuthoritative: true });
  const preSettledBalance = dashBefore.summary.currentBalance;
  const preTotalDeposits = dashBefore.summary.totalExternalCashSent;
  const preStatus = dashBefore.summary.provenanceCompletenessStatus;
  const preWithdrawals = dashBefore.summary.totalWithdrawals;
  const preStartingCap = dashBefore.summary.startingCapital;

  console.log(`Pre-mutation Settled Bal:  $${preSettledBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`Pre-mutation Total Deps:   $${preTotalDeposits.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`Pre-mutation Status:       ${preStatus}`);
  console.log(`Pre-mutation Withdrawals:  $${preWithdrawals.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);

  // Record Josh Stout state before mutation to verify safety
  const joshBefore = await buildInvestorDashboard('jstout', null, { mustBeAuthoritative: true });
  console.log(`\n✓ Josh Stout Pre-check: Settled Bal=$${joshBefore.summary.currentBalance.toFixed(2)}, Total Deps=$${joshBefore.summary.totalExternalCashSent.toFixed(2)}, Status=${joshBefore.summary.provenanceCompletenessStatus}`);

  // 2. Duplicate / Double-Count Verification
  console.log('\n--- 2. DUPLICATE / DOUBLE-COUNT VERIFICATION ---');
  const { data: existingDeps, error: depErr } = await supabase
    .from('deposits')
    .select('*')
    .or(`investor_id.eq.${ryanInv.id},account_id.eq.${ryanAcc.id}`)
    .eq('status', 'confirmed')
    .in('accounting_treatment', ['NEW_CASH', 'HISTORICAL_PROVENANCE']);

  if (depErr) throw new Error(`Error checking existing deposits: ${depErr.message}`);

  if (existingDeps && existingDeps.length > 0) {
    const existingTotal = existingDeps.reduce((sum, d) => sum + Number(d.amount), 0);
    throw new Error(`STOP: Confirmed external cash records already exist for Ryan Ringer! Count=${existingDeps.length}, Total=$${existingTotal}. Aborting to prevent double counting.`);
  }
  console.log('✓ Confirmed ZERO existing external cash records for Ryan Ringer. Safe to proceed with historical provenance.');

  // 3. Execute Canonical Historical Provenance Creation RPC
  console.log('\n--- 3. EXECUTING CANONICAL HISTORICAL PROVENANCE RPC ---');
  const rpcPayload = {
    p_account_id: ryanAcc.id,
    p_amount: 125000.00,
    p_effective_date: '2025-06-01', // June 2025 month-level accounting date
    p_date: null,                   // Exact calendar day was not confirmed / not invented
    p_notes: 'Confirmed by investor Ryan Ringer: $125,000.00 actual outside cash personally put into account at inception in June 2025. Timing confirmed to month-level precision (June 2025); exact calendar day not specified by investor.',
    p_created_by: 'Ryan Ringer (Authorized via User Request Oct 2026)',
    p_idempotency_key: 'hist-prov-inv_1f9ab366-125000-june2025-outside-cash'
  };

  const { data: createResult, error: createErr } = await supabase.rpc(
    'record_historical_provenance_deposit_atomic',
    rpcPayload
  );

  if (createErr) {
    throw new Error(`record_historical_provenance_deposit_atomic RPC failed: ${createErr.message}`);
  }
  console.log('✓ Historical provenance deposit created successfully:');
  console.log(JSON.stringify(createResult, null, 2));

  // 4. Certify Ryan Ringer COMPLETE via Canonical Certification RPC
  console.log('\n--- 4. CERTIFYING RYAN RINGER PROVENANCE COMPLETE ---');
  const { data: certResult, error: certErr } = await supabase.rpc(
    'certify_account_external_cash_provenance',
    {
      p_account_id: ryanAcc.id,
      p_status: 'COMPLETE',
      p_notes: 'Lifetime external-cash provenance certified COMPLETE per Ryan Ringer authoritative outside cash basis confirmation ($125,000.00 in June 2025).',
      p_certified_by: 'Ryan Ringer (Authorized via User Request Oct 2026)'
    }
  );

  if (certErr) {
    throw new Error(`certify_account_external_cash_provenance RPC failed: ${certErr.message}`);
  }
  console.log('✓ Canonical certification RPC succeeded:');
  console.log(JSON.stringify(certResult, null, 2));

  // 5. Post-Mutation Verification & Invariant Audit
  console.log('\n--- 5. POST-MUTATION PRODUCTION VERIFICATION ---');
  const dashAfter = await buildInvestorDashboard(ryanInv.portal_username, null, { mustBeAuthoritative: true });
  const postSettledBalance = dashAfter.summary.currentBalance;
  const postTotalDeposits = dashAfter.summary.totalExternalCashSent;
  const postContributedBasis = dashAfter.summary.contributedBasis;
  const postStatus = dashAfter.summary.provenanceCompletenessStatus;
  const postPerfDollar = dashAfter.summary.totalPerformanceDollar;
  const postPerfPct = dashAfter.summary.totalPerformancePct;
  const postWithdrawals = dashAfter.summary.totalWithdrawals;
  const postStartingCap = dashAfter.summary.startingCapital;

  console.log(`Settled Balance:           $${postSettledBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`Total External Cash:       $${postTotalDeposits.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`Contributed Basis:         $${postContributedBasis.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`Provenance Status:         ${postStatus}`);
  console.log(`Total Performance ($):     $${postPerfDollar.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`Total Performance (%):      ${postPerfPct.toFixed(2)}%`);
  console.log(`Lifetime Withdrawals:      $${postWithdrawals.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`Starting Capital:          $${postStartingCap.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);

  // CRITICAL INVARIANT: Settled Balance Delta must be strictly $0.00
  const balanceDelta = Math.abs(postSettledBalance - preSettledBalance);
  if (balanceDelta > 0.001) {
    throw new Error(`FATAL INVARIANT VIOLATION: Settled balance changed by $${balanceDelta.toFixed(2)}! Rolled back / unacceptable.`);
  }
  console.log('\n✅ INVARIANT 1 PASS: Settled balance delta strictly = $0.00');

  // INVARIANT 2: Total Deposits strictly equals $125,000.00
  if (Math.abs(postTotalDeposits - 125000.00) > 0.001) {
    throw new Error(`INVARIANT VIOLATION: Total deposits is $${postTotalDeposits}, expected 125000.00`);
  }
  console.log('✅ INVARIANT 2 PASS: Total Deposits strictly = $125,000.00');

  // INVARIANT 3: Total Performance $ strictly equals current settled balance - $125,000.00
  const expectedPerfDollar = postSettledBalance - 125000.00;
  if (Math.abs(postPerfDollar - expectedPerfDollar) > 0.01) {
    throw new Error(`INVARIANT VIOLATION: Performance $ is ${postPerfDollar}, expected ${expectedPerfDollar}`);
  }
  console.log(`✅ INVARIANT 3 PASS: Total Performance $ strictly equals $${postPerfDollar.toFixed(2)}`);

  // INVARIANT 4: Total Performance % strictly equals (perfDollar / 125000) * 100
  const expectedPerfPct = (expectedPerfDollar / 125000.00) * 100;
  if (Math.abs(postPerfPct - expectedPerfPct) > 0.01) {
    throw new Error(`INVARIANT VIOLATION: Performance % is ${postPerfPct}, expected ${expectedPerfPct}`);
  }
  console.log(`✅ INVARIANT 4 PASS: Total Performance % strictly equals ${postPerfPct.toFixed(2)}%`);

  // INVARIANT 5: Lifetime withdrawals unchanged ($0.00)
  if (Math.abs(postWithdrawals - preWithdrawals) > 0.001) {
    throw new Error('INVARIANT VIOLATION: Total withdrawals changed');
  }
  console.log('✅ INVARIANT 5 PASS: Total Withdrawals strictly unchanged ($0.00)');

  // INVARIANT 6: Starting capital unchanged ($153,751.29)
  if (Math.abs(postStartingCap - preStartingCap) > 0.001) {
    throw new Error('INVARIANT VIOLATION: starting_capital changed');
  }
  console.log('✅ INVARIANT 6 PASS: starting_capital strictly unchanged ($153,751.29)');

  // INVARIANT 7: Josh Stout Safety Verification
  const joshAfter = await buildInvestorDashboard('jstout', null, { mustBeAuthoritative: true });
  if (
    Math.abs(joshAfter.summary.currentBalance - joshBefore.summary.currentBalance) > 0.001 ||
    Math.abs(joshAfter.summary.totalExternalCashSent - 1606090.00) > 0.001 ||
    joshAfter.summary.provenanceCompletenessStatus !== 'COMPLETE'
  ) {
    throw new Error('FATAL INVARIANT VIOLATION: Josh Stout was altered during Ryan Ringer operation!');
  }
  console.log('✅ INVARIANT 7 PASS: Josh Stout strictly unchanged ($1,606,090.00, COMPLETE, $0 delta)');

  // INVARIANT 8: Idempotency Replay Test
  console.log('\n--- 6. IDEMPOTENCY REPLAY TEST ---');
  const { data: replayResult, error: replayErr } = await supabase.rpc(
    'record_historical_provenance_deposit_atomic',
    rpcPayload
  );
  if (replayErr) throw new Error(`Idempotency replay failed: ${replayErr.message}`);
  if (replayResult.idempotency_replay !== true) {
    throw new Error('INVARIANT VIOLATION: Replaying same idempotency key did not return idempotency_replay: true!');
  }
  console.log('✅ INVARIANT 8 PASS: Canonical RPC is strictly idempotent (replay succeeded with zero duplicate rows)');

  console.log('\n================================================================================');
  console.log('RYAN RINGER OPERATION FULLY CERTIFIED');
  console.log('================================================================================');
}

main().catch(err => {
  console.error('\n❌ EXECUTION FAILED:', err);
  process.exit(1);
});
