import assert from 'node:assert';
import { supabase } from '../lib/supabase.js';

async function testPostgrestGuards() {
  console.log('=== RUNTIME CERTIFICATION: DIRECT POSTGREST RPC INVOCATIONS ===\n');

  // Verify initial table row counts in production
  const { data: initTransfers, error: errT } = await supabase.from('internal_transfers').select('id');
  assert.ifError(errT);
  const initialTransferCount = initTransfers.length;
  console.log(`Initial internal_transfers count: ${initialTransferCount}`);

  const { data: initWds, error: errW } = await supabase.from('withdrawals').select('id');
  assert.ifError(errW);
  const initialWdCount = initWds.length;

  const { data: initDeps, error: errD } = await supabase.from('deposits').select('id');
  assert.ifError(errD);
  const initialDepCount = initDeps.length;

  // 1. Guard: source == target rejection
  console.log('\n[1] Testing guard: source == target rejection...');
  const res1 = await supabase.rpc('execute_internal_transfer_atomic', {
    p_source_account_id: 'stout001',
    p_target_account_id: 'stout001',
    p_amount: 100,
    p_effective_date: '2026-09-01',
    p_purpose: 'test',
    p_notes: 'self transfer probe',
    p_idempotency_key: 'qa-guard-self-' + Date.now(),
    p_created_by: 'qa_runner'
  });
  console.log('Result:', res1.error ? res1.error.message : res1.data);
  assert.strictEqual(res1.error?.code, 'P0001');
  assert.ok(res1.error?.message.includes('SOURCE_TARGET_IDENTICAL'), 'Must reject identical source and target accounts');
  console.log('✓ Passed: source == target rejected fail-closed');

  // 2. Guard: invalid source account
  console.log('\n[2] Testing guard: non-existent source account...');
  const res2 = await supabase.rpc('execute_internal_transfer_atomic', {
    p_source_account_id: 'non_existent_account_99999',
    p_target_account_id: 'stout001',
    p_amount: 100,
    p_effective_date: '2026-09-01',
    p_purpose: 'test',
    p_notes: 'invalid source probe',
    p_idempotency_key: 'qa-guard-invsrc-' + Date.now(),
    p_created_by: 'qa_runner'
  });
  console.log('Result:', res2.error ? res2.error.message : res2.data);
  assert.strictEqual(res2.error?.code, 'P0001');
  assert.ok(res2.error?.message.includes('SOURCE_ACCOUNT_NOT_FOUND'), 'Must reject non-existent source account');
  console.log('✓ Passed: non-existent source account rejected fail-closed');

  // 3. Guard: invalid target account
  console.log('\n[3] Testing guard: non-existent target account...');
  const res3 = await supabase.rpc('execute_internal_transfer_atomic', {
    p_source_account_id: 'stout001',
    p_target_account_id: 'non_existent_account_99999',
    p_amount: 100,
    p_effective_date: '2026-09-01',
    p_purpose: 'test',
    p_notes: 'invalid target probe',
    p_idempotency_key: 'qa-guard-invtgt-' + Date.now(),
    p_created_by: 'qa_runner'
  });
  console.log('Result:', res3.error ? res3.error.message : res3.data);
  assert.strictEqual(res3.error?.code, 'P0001');
  assert.ok(res3.error?.message.includes('TARGET_ACCOUNT_NOT_FOUND'), 'Must reject non-existent target account');
  console.log('✓ Passed: non-existent target account rejected fail-closed');

  // 4. Guard: amount <= 0
  console.log('\n[4] Testing guard: zero and negative amount...');
  const res4a = await supabase.rpc('execute_internal_transfer_atomic', {
    p_source_account_id: 'stout001',
    p_target_account_id: 'jerrys001',
    p_amount: 0,
    p_effective_date: '2026-09-01',
    p_purpose: 'test',
    p_notes: 'zero amount probe',
    p_idempotency_key: 'qa-guard-zero-' + Date.now(),
    p_created_by: 'qa_runner'
  });
  assert.strictEqual(res4a.error?.code, 'P0001');
  assert.ok(res4a.error?.message.includes('INVALID_AMOUNT'), 'Must reject zero amount');

  const res4b = await supabase.rpc('execute_internal_transfer_atomic', {
    p_source_account_id: 'stout001',
    p_target_account_id: 'jerrys001',
    p_amount: -500,
    p_effective_date: '2026-09-01',
    p_purpose: 'test',
    p_notes: 'negative amount probe',
    p_idempotency_key: 'qa-guard-neg-' + Date.now(),
    p_created_by: 'qa_runner'
  });
  assert.strictEqual(res4b.error?.code, 'P0001');
  assert.ok(res4b.error?.message.includes('INVALID_AMOUNT'), 'Must reject negative amount');
  console.log('✓ Passed: zero and negative amounts rejected fail-closed');

  // 5. Guard: missing idempotency key
  console.log('\n[5] Testing guard: missing idempotency key...');
  const res5 = await supabase.rpc('execute_internal_transfer_atomic', {
    p_source_account_id: 'stout001',
    p_target_account_id: 'jerrys001',
    p_amount: 100,
    p_effective_date: '2026-09-01',
    p_purpose: 'test',
    p_notes: 'missing idemp probe',
    p_idempotency_key: '',
    p_created_by: 'qa_runner'
  });
  assert.strictEqual(res5.error?.code, 'P0001');
  assert.ok(res5.error?.message.includes('MISSING_IDEMPOTENCY_KEY'), 'Must reject empty idempotency key');
  console.log('✓ Passed: missing idempotency key rejected fail-closed');

  // 6. Guard: transfer exceeds source equity
  console.log('\n[6] Testing guard: transfer exceeding available equity...');
  const res6 = await supabase.rpc('execute_internal_transfer_atomic', {
    p_source_account_id: 'stout001',
    p_target_account_id: 'jerrys001',
    p_amount: 999999999.00,
    p_effective_date: '2026-09-01',
    p_purpose: 'test',
    p_notes: 'excess equity probe',
    p_idempotency_key: 'qa-guard-equity-' + Date.now(),
    p_created_by: 'qa_runner'
  });
  console.log('Result:', res6.error ? res6.error.message : res6.data);
  assert.strictEqual(res6.error?.code, 'P0001');
  assert.ok(res6.error?.message.includes('TRANSFER_EXCEEDS_SOURCE_EQUITY'), 'Must reject transfer exceeding available equity');
  console.log('✓ Passed: excess equity transfer rejected fail-closed');

  // 7. Guard: void non-existent transfer
  console.log('\n[7] Testing void guard: non-existent transfer...');
  const res7 = await supabase.rpc('void_internal_transfer_atomic', {
    p_transfer_id: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
    p_void_reason: 'qa void probe',
    p_voided_by: 'qa_runner'
  });
  console.log('Result:', res7.error ? res7.error.message : res7.data);
  assert.strictEqual(res7.error?.code, 'P0001');
  assert.ok(res7.error?.message.includes('TRANSFER_NOT_FOUND'), 'Must reject non-existent transfer void');
  console.log('✓ Passed: non-existent transfer void rejected fail-closed');

  // Verify that zero rows were created in production across all 3 tables
  console.log('\n[8] Verifying zero row mutations in production tables...');
  const { data: finalTransfers } = await supabase.from('internal_transfers').select('id');
  assert.strictEqual(finalTransfers.length, initialTransferCount, 'internal_transfers table must have 0 new rows');

  const { data: finalWds } = await supabase.from('withdrawals').select('id');
  assert.strictEqual(finalWds.length, initialWdCount, 'withdrawals table must have 0 new rows');

  const { data: finalDeps } = await supabase.from('deposits').select('id');
  assert.strictEqual(finalDeps.length, initialDepCount, 'deposits table must have 0 new rows');

  console.log('✓ CONFIRMED: ZERO rows created in production database across all tables during guard tests.');
  console.log('\n✅ ALL DIRECT POSTGREST GUARD INVOCATION TESTS PASSED!');
}

testPostgrestGuards().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
