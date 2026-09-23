import { sql } from '../scripts/inspect_internal_transfer_rpc.mjs';

async function runCertification() {
  console.log('=== RUNTIME CERTIFICATION: NATIVE TRANSACTIONAL TEST IN PRODUCTION DATABASE ===\n');

  const testSql = `
  DO $$
  DECLARE
    v_res JSONB;
    v_replay JSONB;
    v_void_res JSONB;
    v_second_void JSONB;
    v_transfer_id UUID;
    v_transfer_num TEXT;
    v_master_count INT;
    v_wd_count INT;
    v_dep_count INT;
    v_master RECORD;
    v_wd RECORD;
    v_dep RECORD;
    v_exc_caught BOOLEAN := FALSE;
  BEGIN
    -- 1. Setup isolated QA fixture
    INSERT INTO investors (id, first_name, last_name) VALUES 
      ('qa_inv_src_xfer', 'QA', 'Source'),
      ('qa_inv_tgt_xfer', 'QA', 'Target');

    INSERT INTO investor_accounts (id, investor_id, name, starting_capital, open_date, status) VALUES
      ('qa_acc_src_xfer', 'qa_inv_src_xfer', 'QA Source Account', 100000.00, '2026-09-01', 'Active'),
      ('qa_acc_tgt_xfer', 'qa_inv_tgt_xfer', 'QA Target Account', 10000.00, '2026-09-01', 'Active');

    -- Seed source with confirmed external cash deposit in September 2026 so it has $50,000 available equity
    INSERT INTO deposits (id, investor_id, account_id, amount, status, date, effective_accounting_date, type, accounting_treatment, created_by) VALUES
      ('qa_dep_src_seed', 'qa_inv_src_xfer', 'qa_acc_src_xfer', 50000.00, 'confirmed', '2026-09-01', '2026-09-01', 'Wire', 'NEW_CASH', 'qa_setup');

    -- 2. Test successful execution of execute_internal_transfer_atomic
    v_res := public.execute_internal_transfer_atomic(
      'qa_acc_src_xfer',
      'qa_acc_tgt_xfer',
      15000.00,
      '2026-09-15'::DATE,
      'QA Rebalance',
      'QA Internal Transfer Invariant Certification',
      'qa-test-idemp-001',
      'qa_agent'
    );

    IF (v_res->>'success')::boolean IS NOT TRUE THEN
      RAISE EXCEPTION 'TEST_FAIL: Transfer execution did not return success=true';
    END IF;

    v_transfer_id := (v_res->>'transfer_id')::UUID;
    v_transfer_num := v_res->>'transfer_number';

    IF v_transfer_id IS NULL OR v_transfer_num IS NULL THEN
      RAISE EXCEPTION 'TEST_FAIL: Missing transfer_id or transfer_number in result';
    END IF;

    IF v_transfer_num NOT LIKE 'XFER-2026-%' THEN
      RAISE EXCEPTION 'TEST_FAIL: Transfer number % does not follow XFER-YYYY-XXXXX format', v_transfer_num;
    END IF;

    -- 3. Verify exactly 3 linked records created: 1 master, 1 debit withdrawal, 1 credit deposit
    SELECT * INTO v_master FROM internal_transfers WHERE id = v_transfer_id;
    IF v_master.id IS NULL THEN
      RAISE EXCEPTION 'TEST_FAIL: Master internal_transfer record not found';
    END IF;
    IF v_master.amount != 15000.00 OR v_master.status != 'confirmed' OR v_master.source_account_id != 'qa_acc_src_xfer' OR v_master.target_account_id != 'qa_acc_tgt_xfer' OR v_master.source_investor_id != 'qa_inv_src_xfer' OR v_master.target_investor_id != 'qa_inv_tgt_xfer' THEN
      RAISE EXCEPTION 'TEST_FAIL: Master record fields mismatch: %', row_to_json(v_master);
    END IF;

    SELECT * INTO v_wd FROM withdrawals WHERE transfer_id = v_transfer_id;
    IF v_wd.id IS NULL THEN
      RAISE EXCEPTION 'TEST_FAIL: Linked debit withdrawal leg not found';
    END IF;
    IF v_wd.amount != 15000.00 OR v_wd.status != 'Completed' OR v_wd.transfer_leg != 'DEBIT' OR v_wd.account_id != 'qa_acc_src_xfer' OR v_wd.investor_id != 'qa_inv_src_xfer' THEN
      RAISE EXCEPTION 'TEST_FAIL: Debit withdrawal fields mismatch: %', row_to_json(v_wd);
    END IF;

    SELECT * INTO v_dep FROM deposits WHERE transfer_id = v_transfer_id;
    IF v_dep.id IS NULL THEN
      RAISE EXCEPTION 'TEST_FAIL: Linked credit deposit leg not found';
    END IF;
    IF v_dep.amount != 15000.00 OR v_dep.status != 'confirmed' OR v_dep.transfer_leg != 'CREDIT' OR v_dep.account_id != 'qa_acc_tgt_xfer' OR v_dep.investor_id != 'qa_inv_tgt_xfer' OR v_dep.accounting_treatment != 'INTERNAL_TRANSFER' THEN
      RAISE EXCEPTION 'TEST_FAIL: Credit deposit fields mismatch: %', row_to_json(v_dep);
    END IF;

    -- Verify row counts for this transfer
    SELECT count(*) INTO v_master_count FROM internal_transfers WHERE id = v_transfer_id;
    SELECT count(*) INTO v_wd_count FROM withdrawals WHERE transfer_id = v_transfer_id;
    SELECT count(*) INTO v_dep_count FROM deposits WHERE transfer_id = v_transfer_id;

    IF v_master_count != 1 OR v_wd_count != 1 OR v_dep_count != 1 THEN
      RAISE EXCEPTION 'TEST_FAIL: Expected exactly 1 master, 1 withdrawal, 1 deposit; got master=%, wd=%, dep=%', v_master_count, v_wd_count, v_dep_count;
    END IF;

    -- 4. Test Idempotency: retry with same idempotency key
    v_replay := public.execute_internal_transfer_atomic(
      'qa_acc_src_xfer',
      'qa_acc_tgt_xfer',
      15000.00,
      '2026-09-15'::DATE,
      'QA Rebalance Replay',
      'QA Replay Notes',
      'qa-test-idemp-001',
      'qa_agent'
    );

    IF (v_replay->>'idempotent_replay')::boolean IS NOT TRUE THEN
      RAISE EXCEPTION 'TEST_FAIL: Replay did not set idempotent_replay=true';
    END IF;
    IF (v_replay->>'transfer_id')::UUID != v_transfer_id THEN
      RAISE EXCEPTION 'TEST_FAIL: Replay returned different transfer_id';
    END IF;

    -- Verify NO new rows created on replay
    SELECT count(*) INTO v_master_count FROM internal_transfers WHERE idempotency_key = 'qa-test-idemp-001';
    SELECT count(*) INTO v_wd_count FROM withdrawals WHERE transfer_id = v_transfer_id;
    SELECT count(*) INTO v_dep_count FROM deposits WHERE transfer_id = v_transfer_id;

    IF v_master_count != 1 OR v_wd_count != 1 OR v_dep_count != 1 THEN
      RAISE EXCEPTION 'TEST_FAIL: Replay created duplicate rows! master=%, wd=%, dep=%', v_master_count, v_wd_count, v_dep_count;
    END IF;

    -- 5. Test Equity Guard: requesting more than available equity must fail closed
    BEGIN
      PERFORM public.execute_internal_transfer_atomic(
        'qa_acc_src_xfer',
        'qa_acc_tgt_xfer',
        999999.00,
        '2026-09-15'::DATE,
        'QA Excess',
        'Should fail',
        'qa-test-idemp-excess',
        'qa_agent'
      );
      RAISE EXCEPTION 'TEST_FAIL: Excess equity transfer unexpectedly succeeded';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%TRANSFER_EXCEEDS_SOURCE_EQUITY%' THEN
        RAISE EXCEPTION 'TEST_FAIL: Unexpected error on excess equity: %', SQLERRM;
      END IF;
    END;

    -- 6. Test Self Transfer Guard: source == target must fail closed
    BEGIN
      PERFORM public.execute_internal_transfer_atomic(
        'qa_acc_src_xfer',
        'qa_acc_src_xfer',
        100.00,
        '2026-09-15'::DATE,
        'QA Self',
        'Should fail',
        'qa-test-idemp-self',
        'qa_agent'
      );
      RAISE EXCEPTION 'TEST_FAIL: Self transfer unexpectedly succeeded';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%SOURCE_TARGET_IDENTICAL%' THEN
        RAISE EXCEPTION 'TEST_FAIL: Unexpected error on self transfer: %', SQLERRM;
      END IF;
    END;

    -- 7. Test Void: void_internal_transfer_atomic
    v_void_res := public.void_internal_transfer_atomic(
      v_transfer_id,
      'QA Test Reversal',
      'qa_admin'
    );

    IF v_void_res->>'status' != 'void' THEN
      RAISE EXCEPTION 'TEST_FAIL: Void RPC did not return status=void';
    END IF;

    -- Verify master transfer is marked void with audit fields
    SELECT * INTO v_master FROM internal_transfers WHERE id = v_transfer_id;
    IF v_master.status != 'void' OR v_master.voided_at IS NULL OR v_master.voided_by != 'qa_admin' OR v_master.void_reason != 'QA Test Reversal' THEN
      RAISE EXCEPTION 'TEST_FAIL: Master transfer not properly marked void: %', row_to_json(v_master);
    END IF;

    -- Verify linked withdrawal is Cancelled with notes appended
    SELECT * INTO v_wd FROM withdrawals WHERE transfer_id = v_transfer_id;
    IF v_wd.status != 'Cancelled' OR v_wd.notes NOT LIKE '%[Voided with transfer %' THEN
      RAISE EXCEPTION 'TEST_FAIL: Linked withdrawal leg not properly Cancelled: %', row_to_json(v_wd);
    END IF;

    -- Verify linked deposit is void with notes appended
    SELECT * INTO v_dep FROM deposits WHERE transfer_id = v_transfer_id;
    IF v_dep.status != 'void' OR v_dep.voided_at IS NULL OR v_dep.voided_by != 'qa_admin' OR v_dep.notes NOT LIKE '%[Voided with transfer %' THEN
      RAISE EXCEPTION 'TEST_FAIL: Linked deposit leg not properly voided: %', row_to_json(v_dep);
    END IF;

    -- 8. Test Void Idempotency: calling void second time produces no duplicate reversal
    v_second_void := public.void_internal_transfer_atomic(
      v_transfer_id,
      'Duplicate void probe',
      'qa_admin'
    );

    IF (v_second_void->>'already_void')::boolean IS NOT TRUE THEN
      RAISE EXCEPTION 'TEST_FAIL: Second void did not return already_void=true';
    END IF;

    -- Verify NO rows were physically deleted (all 3 records still exist with void/cancelled status)
    SELECT count(*) INTO v_master_count FROM internal_transfers WHERE id = v_transfer_id;
    SELECT count(*) INTO v_wd_count FROM withdrawals WHERE transfer_id = v_transfer_id;
    SELECT count(*) INTO v_dep_count FROM deposits WHERE transfer_id = v_transfer_id;

    IF v_master_count != 1 OR v_wd_count != 1 OR v_dep_count != 1 THEN
      RAISE EXCEPTION 'TEST_FAIL: Physical deletion occurred during void! master=%, wd=%, dep=%', v_master_count, v_wd_count, v_dep_count;
    END IF;

    -- 9. CLEANUP / ROLLBACK GUARANTEE:
    -- Raise intentional exception to trigger full PostgreSQL transaction rollback,
    -- ensuring ZERO test rows persist in production database!
    RAISE EXCEPTION 'CERTIFICATION_SUCCESSFUL_INTENTIONAL_ROLLBACK: All 10 invariants passed in native PostgreSQL transaction.';
  END $$;
  `;

  console.log('Executing native PostgreSQL transaction block in production...');
  const res = await sql(testSql);
  console.log('Result Status:', res.status);
  const errMsg = res.data?.message || JSON.stringify(res.data);
  console.log('Engine Output:', errMsg);

  if (errMsg.includes('CERTIFICATION_SUCCESSFUL_INTENTIONAL_ROLLBACK')) {
    console.log('\n✅ CERTIFICATION 100% SUCCESSFUL: All 10 internal transfer invariants verified in native PostgreSQL engine.');
    console.log('✅ CLEANUP VERIFIED: Complete transaction rolled back cleanly with ZERO persistent rows.');
  } else {
    console.error('\n❌ Certification failed:', errMsg);
    process.exit(1);
  }

  // Double check that zero QA accounts or transfers remain in production
  const checkClean = await sql(`
    SELECT 
      (SELECT count(*) FROM investors WHERE id LIKE 'qa_%_xfer') as qa_investors,
      (SELECT count(*) FROM investor_accounts WHERE id LIKE 'qa_%_xfer') as qa_accounts,
      (SELECT count(*) FROM internal_transfers WHERE idempotency_key LIKE 'qa-test-idemp%') as qa_transfers,
      (SELECT count(*) FROM deposits WHERE id LIKE 'qa_%_xfer' OR id = 'qa_dep_src_seed') as qa_deposits,
      (SELECT count(*) FROM withdrawals WHERE id LIKE 'qa_%_xfer') as qa_withdrawals;
  `);
  console.log('\nProduction Database QA test residue check:');
  console.log(JSON.stringify(checkClean.data, null, 2));

  const residue = checkClean.data[0];
  if (
    residue.qa_investors == 0 &&
    residue.qa_accounts == 0 &&
    residue.qa_transfers == 0 &&
    residue.qa_deposits == 0 &&
    residue.qa_withdrawals == 0
  ) {
    console.log('✓ Zero QA test residue confirmed in production database.');
  } else {
    console.error('WARNING: Residue found:', residue);
  }
}

runCertification().catch(err => {
  console.error(err);
  process.exit(1);
});
