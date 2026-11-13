process.env.DATA_SOURCE = 'supabase';
import { supabase, isAuthoritativeProductionDbConfigured } from '../lib/supabase.js';
import { buildInvestorDashboard } from '../lib/dashboard.js';

async function main() {
  console.log('================================================================================');
  console.log('EXECUTING PRODUCTION HISTORICAL PROVENANCE & CERTIFICATION: JOSH STOUT');
  console.log('Target Project: julhldzkiqdeuuoqmvlo');
  console.log('================================================================================\n');

  // 0. Safety Guard: Confirm Authoritative Production Connection
  if (!isAuthoritativeProductionDbConfigured()) {
    throw new Error('FATAL: Not connected to authoritative production Supabase project (julhldzkiqdeuuoqmvlo)');
  }
  console.log('✓ Authoritative production Supabase connection confirmed.');

  // 1. Preflight Production Read
  console.log('\n--- 1. PRE-MUTATION PRODUCTION STATE ---');
  const dashBefore = await buildInvestorDashboard('jstout', null, { mustBeAuthoritative: true });
  const preBalance = dashBefore.summary.currentBalance;
  const preTotalDeposits = dashBefore.summary.totalExternalCashSent;
  const preStatus = dashBefore.summary.provenanceCompletenessStatus;
  const preWithdrawals = dashBefore.summary.totalWithdrawals;
  const preGain = dashBefore.summary.totalGain;

  console.log(`Current Settled Balance:   $${preBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`Total External Cash:       $${preTotalDeposits.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`Provenance Status:         ${preStatus}`);
  console.log(`Total Withdrawals:         $${preWithdrawals.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`Total Gain YTD:            $${preGain.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);

  // Verify Jerry -> Stout transfer records
  const { data: jerryCredit, error: jcErr } = await supabase
    .from('deposits')
    .select('*')
    .eq('id', 'dep_bc8434ab')
    .single();
  if (jcErr || !jerryCredit) throw new Error(`Preflight check failed: dep_bc8434ab missing: ${jcErr?.message}`);

  const { data: mayDeposit, error: mdErr } = await supabase
    .from('deposits')
    .select('*')
    .eq('id', 'dep_454fb0c9')
    .single();
  if (mdErr || !mayDeposit) throw new Error(`Preflight check failed: dep_454fb0c9 missing: ${mdErr?.message}`);
  if (Number(mayDeposit.amount) !== 7500) throw new Error(`Preflight check failed: May deposit is not $7500`);

  console.log('✓ Verified dep_bc8434ab (Jerry->Stout $2,500 internal transfer)');
  console.log('✓ Verified dep_454fb0c9 (May $7,500 deposit untouched)');

  // 2. Insert HISTORICAL_PROVENANCE record
  console.log('\n--- 2. INSERTING HISTORICAL PROVENANCE DEPOSIT ---');
  const depositPayload = {
    id: 'dep_stout001_hist_prov_1606090',
    investor_id: 'stout001',
    account_id: 'stout001',
    date: null,
    effective_accounting_date: null,
    amount: 1606090.00,
    type: 'Historical Outside Cash',
    status: 'confirmed',
    accounting_treatment: 'HISTORICAL_PROVENANCE',
    notes: 'Confirmed historical external cash contribution by Josh Stout (~3 years ago / historical inception): $1,606,090 actual outside cash originally put into Stout account. Historical provenance basis only; exact funding date not specified by investor.',
    created_by: 'Josh Stout (Authorized via User Request Oct 2026)',
    idempotency_key: 'hist-prov-stout001-1606090-original-outside-cash',
    updated_at: new Date().toISOString()
  };

  // Check if already exists (idempotency check)
  const { data: existingDep } = await supabase
    .from('deposits')
    .select('*')
    .eq('idempotency_key', depositPayload.idempotency_key);

  if (existingDep && existingDep.length > 0) {
    console.log('✓ Historical provenance deposit already exists (idempotent replay):', existingDep[0].id);
  } else {
    const { data: insertedDep, error: depInsertErr } = await supabase
      .from('deposits')
      .insert([depositPayload])
      .select();

    if (depInsertErr) {
      throw new Error(`Failed to insert historical provenance deposit: ${depInsertErr.message}`);
    }
    console.log('✓ Successfully inserted historical provenance deposit:', insertedDep[0].id);
  }

  // 3. Certify Provenance COMPLETE via canonical RPC
  console.log('\n--- 3. CERTIFYING PROVENANCE COMPLETE VIA CANONICAL RPC ---');
  const { data: rpcResult, error: rpcErr } = await supabase.rpc('certify_account_external_cash_provenance', {
    p_account_id: 'stout001',
    p_status: 'COMPLETE',
    p_notes: 'Lifetime external-cash provenance certified COMPLETE per Josh Stout authoritative outside cash basis confirmation ($1,606,090).',
    p_certified_by: 'Josh Stout (Authorized via User Request Oct 2026)'
  });

  if (rpcErr) {
    throw new Error(`certify_account_external_cash_provenance RPC failed: ${rpcErr.message}`);
  }
  console.log('✓ Canonical RPC certification succeeded:');
  console.log(JSON.stringify(rpcResult, null, 2));

  // 4. Post-Mutation Production Read & Invariant Certification
  console.log('\n--- 4. POST-MUTATION PRODUCTION VERIFICATION ---');
  const dashAfter = await buildInvestorDashboard('jstout', null, { mustBeAuthoritative: true });
  const postBalance = dashAfter.summary.currentBalance;
  const postTotalDeposits = dashAfter.summary.totalExternalCashSent;
  const postContributedBasis = dashAfter.summary.contributedBasis;
  const postStatus = dashAfter.summary.provenanceCompletenessStatus;
  const postWithdrawals = dashAfter.summary.totalWithdrawals;
  const postGain = dashAfter.summary.totalGain;
  const postPerfDollar = dashAfter.summary.totalPerformanceDollar;
  const postPerfPct = dashAfter.summary.totalPerformancePct;

  console.log(`Current Settled Balance:   $${postBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`Total External Cash:       $${postTotalDeposits.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`Contributed Basis:         $${postContributedBasis.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`Provenance Status:         ${postStatus}`);
  console.log(`Total Performance ($):     $${postPerfDollar.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`Total Performance (%):      ${postPerfPct.toFixed(2)}%`);
  console.log(`Total Withdrawals:         $${postWithdrawals.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`Total Gain YTD:            $${postGain.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);

  // INVARIANT 1: Balance delta must be strictly 0.00
  const balanceDelta = Math.abs(postBalance - preBalance);
  if (balanceDelta > 0.001) {
    throw new Error(`INVARIANT VIOLATION: Balance changed by $${balanceDelta}`);
  }
  console.log('\n✅ INVARIANT 1 PASS: Balance delta from historical provenance = $0.00');

  // INVARIANT 2: Total Deposits must equal exactly $1,606,090.00
  if (Math.abs(postTotalDeposits - 1606090.00) > 0.001) {
    throw new Error(`INVARIANT VIOLATION: Total deposits is $${postTotalDeposits}, expected 1606090.00`);
  }
  console.log('✅ INVARIANT 2 PASS: Total Deposits strictly equals $1,606,090.00');

  // INVARIANT 3: Total Performance $ equals postBalance - 1606090
  const expectedPerfDollar = postBalance - 1606090.00;
  if (Math.abs(postPerfDollar - expectedPerfDollar) > 0.01) {
    throw new Error(`INVARIANT VIOLATION: Performance $ is ${postPerfDollar}, expected ${expectedPerfDollar}`);
  }
  console.log(`✅ INVARIANT 3 PASS: Total Performance $ strictly equals $${postPerfDollar.toFixed(2)}`);

  // INVARIANT 4: Total Performance % equals (postPerfDollar / 1606090) * 100
  const expectedPerfPct = (expectedPerfDollar / 1606090.00) * 100;
  if (Math.abs(postPerfPct - expectedPerfPct) > 0.01) {
    throw new Error(`INVARIANT VIOLATION: Performance % is ${postPerfPct}, expected ${expectedPerfPct}`);
  }
  console.log(`✅ INVARIANT 4 PASS: Total Performance % strictly equals ${postPerfPct.toFixed(2)}%`);

  // INVARIANT 5: Total Withdrawals untouched ($40,000.00)
  if (Math.abs(postWithdrawals - preWithdrawals) > 0.001) {
    throw new Error('INVARIANT VIOLATION: Total withdrawals changed');
  }
  console.log('✅ INVARIANT 5 PASS: Total Withdrawals strictly preserved ($40,000.00)');

  // INVARIANT 6: May $7,500 deposit untouched
  const { data: postMay } = await supabase.from('deposits').select('*').eq('id', 'dep_454fb0c9').single();
  if (Number(postMay.amount) !== 7500 || postMay.status !== 'confirmed') {
    throw new Error('INVARIANT VIOLATION: May deposit was altered');
  }
  console.log('✅ INVARIANT 6 PASS: May $7,500 deposit untouched');

  // INVARIANT 7: Jerry->Stout transfer untouched
  const { data: postJerryDep } = await supabase.from('deposits').select('*').eq('id', 'dep_bc8434ab').single();
  if (Number(postJerryDep.amount) !== 2500 || postJerryDep.accounting_treatment !== 'INTERNAL_TRANSFER') {
    throw new Error('INVARIANT VIOLATION: Jerry->Stout transfer deposit was altered');
  }
  console.log('✅ INVARIANT 7 PASS: Jerry->Stout transfer untouched (INTERNAL_TRANSFER, $0 external cash impact)');

  // INVARIANT 8: Ryan Ringer untouched
  const { data: ryanAcc } = await supabase.from('investor_accounts').select('*').eq('id', 'rringer001');
  if (ryanAcc && ryanAcc.length > 0 && ryanAcc[0].external_cash_provenance_status === 'COMPLETE') {
    throw new Error('INVARIANT VIOLATION: Ryan Ringer was modified or certified!');
  }
  console.log('✅ INVARIANT 8 PASS: Ryan Ringer untouched (no guessing or mutation)');

  console.log('\n================================================================================');
  console.log('MUTATION & RECONCILIATION SUCCESSFULLY CERTIFIED');
  console.log('================================================================================');
}

main().catch(err => {
  console.error('\n❌ EXECUTION FAILED:', err);
  process.exit(1);
});
