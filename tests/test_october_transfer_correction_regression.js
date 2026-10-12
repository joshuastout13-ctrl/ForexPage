import assert from 'assert';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { supabase, isAuthoritativeProductionDbConfigured } from '../lib/supabase.js';
import { buildInvestorDashboard } from '../lib/dashboard.js';
import { sql } from '../scripts/inspect_internal_transfer_rpc.mjs';
import Decimal from 'decimal.js';

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });
process.env.DATA_SOURCE = 'supabase';

const IDEMPOTENCY_KEY = 'JOSH_AUTHORIZED_JERRY_STOUT_OCTOBER_2026_TRANSFER_ADOPTION';

async function runRegressionSuite() {
  console.log('================================================================================');
  console.log('REGRESSION SUITE: OCTOBER 2026 JERRY -> STOUT TRANSFER ADOPTION & JOSH $70K WD');
  console.log('Authoritative Supabase Project: julhldzkiqdeuuoqmvlo');
  console.log('================================================================================\n');

  if (!isAuthoritativeProductionDbConfigured()) {
    throw new Error('FATAL: Not connected to authoritative production Supabase project (julhldzkiqdeuuoqmvlo)');
  }

  // 1. Existing-credit transfer adoption
  console.log('Test 1: Existing-credit transfer adoption...');
  const { data: creditDep } = await supabase
    .from('deposits')
    .select('*')
    .eq('id', 'dep_654ad1a9')
    .single();

  assert.strictEqual(creditDep.id, 'dep_654ad1a9', 'Target deposit dep_654ad1a9 must exist');
  assert.strictEqual(creditDep.accounting_treatment, 'INTERNAL_TRANSFER', 'Treatment must be INTERNAL_TRANSFER');
  assert.strictEqual(creditDep.type, 'Internal Transfer', 'Type must be Internal Transfer');
  assert.strictEqual(creditDep.transfer_leg, 'CREDIT', 'Transfer leg must be CREDIT');
  assert.ok(creditDep.transfer_id, 'Must be linked to master transfer');
  console.log('✅ PASS 1: Existing-credit transfer adoption verified.');

  // 2. No duplicate destination credit
  console.log('Test 2: No duplicate destination credit...');
  const { data: stoutOctDeps } = await supabase
    .from('deposits')
    .select('*')
    .eq('investor_id', 'stout001')
    .eq('effective_accounting_date', '2026-10-01')
    .eq('status', 'confirmed');

  assert.strictEqual(stoutOctDeps.length, 1, 'Josh Stout must have exactly ONE confirmed October deposit');
  assert.strictEqual(stoutOctDeps[0].id, 'dep_654ad1a9', 'Only dep_654ad1a9 may exist as October deposit');
  console.log('✅ PASS 2: No duplicate destination credit verified.');

  // 3. Exactly one Jerry debit
  console.log('Test 3: Exactly one Jerry debit...');
  const { data: jerryOctWds } = await supabase
    .from('withdrawals')
    .select('*')
    .eq('investor_id', 'jerrys001')
    .eq('effective_accounting_date', '2026-10-01')
    .eq('status', 'Completed');

  assert.strictEqual(jerryOctWds.length, 1, 'Jerry must have exactly ONE October withdrawal');
  assert.strictEqual(Number(jerryOctWds[0].amount), 2500, 'Jerry withdrawal amount must be $2,500.00');
  assert.strictEqual(jerryOctWds[0].transfer_leg, 'DEBIT', 'Transfer leg must be DEBIT');
  assert.strictEqual(jerryOctWds[0].transfer_id, creditDep.transfer_id, 'Debit and credit must share the same transfer_id');
  console.log('✅ PASS 3: Exactly one Jerry debit verified.');

  // 4. External cash exclusion
  console.log('Test 4: External cash exclusion...');
  const joshDash = await buildInvestorDashboard('jstout', null, { mustBeAuthoritative: true });
  assert.strictEqual(joshDash.summary.totalExternalCashSent, 1606090, 'Total External Cash must equal certified $1,606,090.00');
  assert.strictEqual(joshDash.summary.externalDepositsLifetime, 1606090, 'External deposits lifetime must equal certified $1,606,090.00');
  console.log('✅ PASS 4: External cash exclusion verified ($1,606,090.00 certified restored).');

  // 5. Josh balance preservation
  console.log('Test 5: Josh balance preservation...');
  assert.strictEqual(Number(joshDash.summary.currentBalance.toFixed(2)), 3333453.52, 'Josh settled balance must remain $3,333,453.52');
  const { data: stoutOctHist } = await supabase
    .from('investor_monthly_history')
    .select('*')
    .eq('investor_id', 'stout001')
    .eq('year', 2026)
    .eq('month_number', 10)
    .single();
  assert.strictEqual(Number(stoutOctHist.ending_balance.toFixed(2)), 3333453.52, 'October history ending balance must be $3,333,453.52');
  console.log('✅ PASS 5: Josh balance preservation verified ($3,333,453.52).');

  // 6. Jerry balance adjustment
  console.log('Test 6: Jerry balance adjustment...');
  const jerryDash = await buildInvestorDashboard('jerrys001', null, { mustBeAuthoritative: true });
  assert.strictEqual(Number(jerryDash.summary.currentBalance.toFixed(2)), 567700.07, 'Jerry settled balance must be $567,700.07');
  const { data: jerryOctHist } = await supabase
    .from('investor_monthly_history')
    .select('*')
    .eq('investor_id', 'jerrys001')
    .eq('year', 2026)
    .eq('month_number', 10)
    .single();
  assert.strictEqual(Number(jerryOctHist.withdrawals), 2500, 'Jerry October history withdrawals must be $2,500.00');
  assert.strictEqual(Number(jerryOctHist.ending_balance.toFixed(2)), 567700.07, 'Jerry October history ending balance must be $567,700.07');
  console.log('✅ PASS 6: Jerry balance adjustment verified ($567,700.07).');

  // 7. $70,000 withdrawal preservation
  console.log('Test 7: $70,000 withdrawal preservation...');
  const { data: wd70k } = await supabase
    .from('withdrawals')
    .select('*')
    .eq('id', 'wd_josh_auth_stout001_20000')
    .single();
  assert.strictEqual(wd70k.id, 'wd_josh_auth_stout001_20000', 'Withdrawal ID must match');
  assert.strictEqual(Number(wd70k.amount), 70000, 'Withdrawal amount must be $70,000.00');
  assert.strictEqual(wd70k.status, 'Completed', 'Withdrawal status must be Completed');
  console.log('✅ PASS 7: $70,000 withdrawal preservation verified.');

  // 8. Lifetime withdrawal accounting
  console.log('Test 8: Lifetime withdrawal accounting...');
  assert.strictEqual(joshDash.summary.totalWithdrawals, 110000, 'Josh lifetime withdrawals must be $110,000.00 (20k + 20k + 70k)');
  assert.strictEqual(jerryDash.summary.totalWithdrawals, 15000, 'Jerry lifetime withdrawals must include October $2,500.00');
  console.log('✅ PASS 8: Lifetime withdrawal accounting verified.');

  // 9. Atomic rollback
  console.log('Test 9: Atomic rollback...');
  const testRollbackSql = `
    DO $$
    BEGIN
      INSERT INTO withdrawals (
        id, investor_id, account_id, amount, status, request_date, effective_accounting_date,
        year, month_number, month, notes, created_by
      ) VALUES (
        'wd_test_rollback_safety', 'jerrys001', 'jerrys001', 999999.00, 'Pending',
        '2026-10-01', '2026-10-01', 2026, 10, 'October', 'Test Rollback', 'Automated Test'
      );
      RAISE EXCEPTION 'PLPGSQL_TEST_ROLLBACK_CONFIRMED';
    END $$;
  `;
  const rollbackRes = await sql(testRollbackSql);
  assert.ok(JSON.stringify(rollbackRes).includes('PLPGSQL_TEST_ROLLBACK_CONFIRMED'), 'Transaction must roll back on exception');

  // Verify that row was rolled back and does NOT exist
  const { data: testWd } = await supabase
    .from('withdrawals')
    .select('id')
    .eq('id', 'wd_test_rollback_safety');
  assert.strictEqual(testWd.length, 0, 'Rolled-back transaction must leave ZERO persisted rows');
  console.log('✅ PASS 9: Atomic rollback verified.');

  // 10. Idempotent retry
  console.log('Test 10: Idempotent retry...');
  const retryRes = await sql(`
    SELECT public.adopt_legacy_internal_transfer_atomic(
      'dep_654ad1a9',
      'jerrys001',
      'stout001',
      2500.00,
      '2026-10-01'::DATE,
      'Monthly recurring Jerry -> Stout internal transfer (October 2026)',
      'Josh confirmed recurring monthly $2,500 Jerry''s Rogue Jets -> Stout internal transfer.',
      '${IDEMPOTENCY_KEY}',
      'Josh Stout (Authorized via User Request Oct 2026)'
    ) as result;
  `);
  const retryObj = retryRes.data[0]?.result;
  assert.strictEqual(retryObj.idempotent_replay, true, 'Retry must return idempotent_replay: true');
  assert.strictEqual(retryObj.transfer_id, creditDep.transfer_id, 'Retry transfer_id must match master transfer');
  console.log('✅ PASS 10: Idempotent retry verified.');

  // 11. Transfer master linkage
  console.log('Test 11: Transfer master linkage...');
  const { data: master } = await supabase
    .from('internal_transfers')
    .select('*')
    .eq('id', creditDep.transfer_id)
    .single();

  assert.strictEqual(master.id, creditDep.transfer_id, 'Master transfer ID must match deposit link');
  assert.strictEqual(master.id, jerryOctWds[0].transfer_id, 'Master transfer ID must match withdrawal link');
  assert.strictEqual(Number(master.amount), 2500, 'Master transfer amount must be $2,500.00');
  assert.strictEqual(master.status, 'confirmed', 'Master transfer status must be confirmed');
  assert.strictEqual(master.idempotency_key, IDEMPOTENCY_KEY, 'Idempotency key must match');
  console.log(`✅ PASS 11: Transfer master linkage verified (${master.transfer_number}).`);

  // 12. Unrelated account protection
  console.log('Test 12: Unrelated account protection...');
  const tedDash = await buildInvestorDashboard('tboardwalk', null, { mustBeAuthoritative: true });
  assert.strictEqual(Number(tedDash.summary.currentBalance.toFixed(2)), 1702.78, 'Ted Boardwalk balance must be $1,702.78');

  const dtownleyDash = await buildInvestorDashboard('dtownley', null, { mustBeAuthoritative: true });
  assert.strictEqual(Number(dtownleyDash.summary.currentBalance.toFixed(2)), 38223.16, 'David Townley balance must be $38,223.16');

  const ringerDash = await buildInvestorDashboard('rringer', null, { mustBeAuthoritative: true });
  assert.strictEqual(ringerDash.summary.totalExternalCashSent, 125000, 'Ryan Ringer outside cash must be $125,000.00');

  const { data: sepRet } = await supabase.from('monthly_returns').select('*').eq('year', 2026).eq('month_number', 9).single();
  assert.strictEqual(Number(sepRet.gross_return_pct), 3.07, 'September fund return must be 3.07%');
  assert.strictEqual(sepRet.locked, true, 'September return must remain locked');
  console.log('✅ PASS 12: Unrelated account protection verified.');

  console.log('\n================================================================================');
  console.log('ALL 12 REGRESSION TESTS PASSED CLEANLY (100% SUCCESS)');
  console.log('================================================================================\n');
}

runRegressionSuite().catch(err => {
  console.error('❌ TEST FAILED:', err);
  process.exit(1);
});
