import { sql } from '../scripts/inspect_internal_transfer_rpc.mjs';

async function runTests() {
  console.log('================================================================================');
  console.log('DATABASE-LEVEL TRANSACTION DUPLICATE PROTECTION REGRESSION SUITE');
  console.log('Target Database: julhldzkiqdeuuoqmvlo');
  console.log('================================================================================');

  let passed = 0;
  let failed = 0;

  function assert(condition, testName) {
    if (condition) {
      console.log(`✅ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`❌ FAIL: ${testName}`);
      failed++;
    }
  }

  // 1. Verify triggers exist in information_schema
  const trgRes = await sql(`
    SELECT event_object_table, trigger_name
    FROM information_schema.triggers
    WHERE trigger_name IN ('trg_enforce_deposit_duplicate_protection', 'trg_enforce_withdrawal_duplicate_protection');
  `);
  const triggers = trgRes.data || [];
  assert(
    triggers.some(t => t.trigger_name === 'trg_enforce_deposit_duplicate_protection' && t.event_object_table === 'deposits'),
    '1. Database trigger trg_enforce_deposit_duplicate_protection is active on deposits'
  );
  assert(
    triggers.some(t => t.trigger_name === 'trg_enforce_withdrawal_duplicate_protection' && t.event_object_table === 'withdrawals'),
    '2. Database trigger trg_enforce_withdrawal_duplicate_protection is active on withdrawals'
  );

  // 2. Test duplicate deposit rejection
  const dupeRes = await sql(`
    DO $$
    DECLARE
      v_err text;
      v_blocked boolean := false;
    BEGIN
      BEGIN
        -- Attempt inserting duplicate of active confirmed deposit dep_bc8434ab ($2,500 on 2026-09-01)
        INSERT INTO deposits (id, investor_id, account_id, amount, date, effective_accounting_date, accounting_treatment, status)
        VALUES ('test_dupe_deposit', 'stout001', 'stout001', 2500.00, '2026-09-01', '2026-09-01', 'INTERNAL_TRANSFER', 'confirmed');
      EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
        IF v_err LIKE '%DUPLICATE_ECONOMIC_DEPOSIT%' OR v_err LIKE '%idx_deposits_idempotency_key%' THEN
          v_blocked := true;
        END IF;
      END;

      IF NOT v_blocked THEN
        RAISE EXCEPTION 'TEST_FAIL: Duplicate deposit was not blocked!';
      END IF;
    END $$;
  `);
  assert(dupeRes.status === 201 || dupeRes.status === 200, '3. Duplicate economic deposit without distinct confirmation is blocked by database trigger');

  // 3. Test internal transfer misclassification rejection
  const xferRes = await sql(`
    DO $$
    DECLARE
      v_err text;
      v_blocked boolean := false;
    BEGIN
      BEGIN
        -- Attempt inserting deposit with transfer_id but NEW_CASH treatment
        INSERT INTO deposits (id, investor_id, account_id, amount, date, effective_accounting_date, accounting_treatment, status, transfer_id)
        VALUES ('test_xfer_misclass', 'stout001', 'stout001', 100.00, '2026-10-01', '2026-10-01', 'NEW_CASH', 'confirmed', 'c5dc42e1-7ec9-48fe-8924-4f0f622f96e4');
      EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
        IF v_err LIKE '%INTERNAL_TRANSFER_MISCLASSIFIED%' THEN
          v_blocked := true;
        END IF;
      END;

      IF NOT v_blocked THEN
        RAISE EXCEPTION 'TEST_FAIL: Misclassified transfer deposit was not blocked!';
      END IF;
    END $$;
  `);
  assert(xferRes.status === 201 || xferRes.status === 200, '4. Internal transfer leg misclassified as NEW_CASH is blocked by database trigger');

  // 4. Test legitimate separate deposit preservation with distinct idempotency key
  const legitRes = await sql(`
    DO $$
    DECLARE
      v_err text;
    BEGIN
      -- Legitimate separate deposit carrying confirmed_addition in idempotency_key
      INSERT INTO deposits (id, investor_id, account_id, amount, date, effective_accounting_date, accounting_treatment, status, idempotency_key)
      VALUES ('test_legit_separate_dep', 'stout001', 'stout001', 2500.00, '2026-09-01', '2026-09-01', 'INTERNAL_TRANSFER', 'confirmed', 'dep_mut_stout001_2026-09-01_250000_confirmed_addition_test999');
      
      -- Verify row was inserted successfully
      IF NOT EXISTS (SELECT 1 FROM deposits WHERE id = 'test_legit_separate_dep') THEN
        RAISE EXCEPTION 'TEST_FAIL: Legitimate deposit was not inserted!';
      END IF;

      -- Immediately delete test row
      DELETE FROM deposits WHERE id = 'test_legit_separate_dep';
    END $$;
  `);
  assert(legitRes.status === 201 || legitRes.status === 200, '5. Legitimate separate deposit with distinct idempotency key is successfully permitted');

  console.log('================================================================================');
  console.log(`DATABASE DUPLICATE PROTECTION RESULTS: ${passed} PASSED / ${failed} FAILED`);
  console.log('================================================================================');

  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('Test suite execution error:', err);
  process.exit(1);
});
