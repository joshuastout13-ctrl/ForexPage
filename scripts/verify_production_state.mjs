process.env.DATA_SOURCE = 'supabase';
import { supabase } from '../lib/supabase.js';
import { buildInvestorDashboard } from '../lib/dashboard.js';

async function verifyLive() {
  console.log('=== VERIFYING AUTHORITATIVE PRODUCTION DATABASE STATE ===');

  // 1. Verify Jerry's Rogue Jets withdrawal row
  const { data: jerryWd, error: jerryErr } = await supabase
    .from('withdrawals')
    .select('id, investor_id, amount, status, effective_accounting_date, year, month_number, month, updated_by, created_at')
    .eq('id', 'wd_jerrys_20260801_d00164e8')
    .single();

  if (jerryErr) {
    console.error('Failed to fetch Jerry withdrawal:', jerryErr);
    process.exit(1);
  }
  console.log('\n[1] Jerry\'s Rogue Jets withdrawal row in production DB:');
  console.log(JSON.stringify(jerryWd, null, 2));

  if (jerryWd.status !== 'Approved' || jerryWd.updated_by !== null) {
    console.error('ERROR: Jerry withdrawal has been altered! Expected Approved with null updated_by, got:', jerryWd);
    process.exit(1);
  } else {
    console.log('  -> CONFIRMED: Jerry withdrawal is pristine, unaltered in production DB (status: Approved, updated_by: null).');
  }

  // 2. Verify Joshua Stout account and dashboard in production
  const { data: stoutAcc, error: stoutErr } = await supabase
    .from('investor_accounts')
    .select('id, investor_id, external_cash_provenance_status, provenance_certified_at, provenance_certified_by, provenance_certification_notes')
    .eq('id', 'stout001')
    .single();

  if (stoutErr) {
    console.error('Failed to fetch stout001 account:', stoutErr);
    process.exit(1);
  }
  console.log('\n[2] Joshua Stout account record in production DB:');
  console.log(JSON.stringify(stoutAcc, null, 2));

  if (stoutAcc.external_cash_provenance_status !== 'PARTIAL') {
    console.error('ERROR: stout001 provenance status expected PARTIAL, got:', stoutAcc.external_cash_provenance_status);
    process.exit(1);
  } else {
    console.log('  -> CONFIRMED: stout001 external_cash_provenance_status is PARTIAL.');
  }

  // 3. Build live dashboard for jstout directly from production DB
  console.log('\n[3] Building live dashboard for jstout against authoritative production DB...');
  const dashboard = await buildInvestorDashboard('jstout', null, { mustBeAuthoritative: true });

  console.log('  Current Balance:              $', dashboard.summary.currentBalance.toLocaleString('en-US', { minimumFractionDigits: 2 }));
  console.log('  Total Deposits (Proven Cash): $', dashboard.summary.totalExternalCashSent.toLocaleString('en-US', { minimumFractionDigits: 2 }));
  console.log('  Provenance Status:            ', dashboard.summary.provenanceCompletenessStatus);
  console.log('  Total Performance $:          ', dashboard.summary.totalPerformanceDollar);
  console.log('  Total Performance %:          ', dashboard.summary.totalPerformancePct);
  console.log('  isProven:                     ', dashboard.summary.isProven);

  if (dashboard.summary.totalPerformanceDollar !== null || dashboard.summary.totalPerformancePct !== null) {
    console.error('ERROR: Total Performance is NOT null under PARTIAL status!');
    process.exit(1);
  } else {
    console.log('  -> CONFIRMED: Total Performance is strictly null under PARTIAL provenance status.');
  }

  // 4. Test certify_account_external_cash_provenance RPC parameter signature via PostgREST
  console.log('\n[4] Verifying certify_account_external_cash_provenance RPC callable in production...');
  const { data: rpcTest, error: rpcErr } = await supabase.rpc('certify_account_external_cash_provenance', {
    p_account_id: 'non_existent_test_acc',
    p_status: 'PARTIAL',
    p_notes: 'QA signature probe',
    p_certified_by: 'qa_agent'
  });

  if (rpcErr && rpcErr.message && rpcErr.message.includes('ACCOUNT_NOT_FOUND')) {
    console.log('  -> CONFIRMED: certify_account_external_cash_provenance RPC is live, callable, and fail-closed (raised ACCOUNT_NOT_FOUND for non-existent test account).');
  } else if (rpcErr) {
    console.error('Unexpected RPC probe error:', rpcErr);
    process.exit(1);
  } else {
    console.log('RPC probe returned data:', JSON.stringify(rpcTest));
  }

  console.log('\n=== ALL PRODUCTION PRE-FLIGHT VERIFICATIONS PASSED ===');
}

verifyLive().catch(err => {
  console.error(err);
  process.exit(1);
});
