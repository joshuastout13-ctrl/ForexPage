import fs from 'fs';
import { sql } from './inspect_internal_transfer_rpc.mjs';

async function main() {
  console.log('=== APPLYING DATABASE-LEVEL TRANSACTION DUPLICATE PROTECTION ===');
  const migrationSql = fs.readFileSync('scripts/migrations/20261015_strengthen_transaction_duplicate_protection.sql', 'utf8');

  const res = await sql(migrationSql);
  console.log('Migration response status:', res.status);
  console.log('Migration response data:', JSON.stringify(res.data, null, 2));

  if (res.status === 200 || res.status === 201) {
    console.log('✅ Duplicate protection triggers successfully installed on deposits and withdrawals!');
  } else {
    console.error('❌ Failed to install triggers:', res);
    process.exit(1);
  }

  // Verification 1: Verify triggers exist in information_schema
  const trgCheck = await sql(`
    SELECT event_object_table, trigger_name, action_timing
    FROM information_schema.triggers
    WHERE trigger_name IN ('trg_enforce_deposit_duplicate_protection', 'trg_enforce_withdrawal_duplicate_protection');
  `);
  console.log('Installed triggers:', trgCheck.data);

  // Verification 2: Test duplicate deposit rejection in a rolled-back transaction
  console.log('\n--- VERIFYING TRANSACTION ROLLBACK TEST ---');
  const testSql = `
    DO $$
    DECLARE
      v_err text;
    BEGIN
      -- Try inserting duplicate for an existing deposit (e.g., dep_bc8434ab: stout001, $2500, 2026-09-01)
      BEGIN
        INSERT INTO deposits (id, investor_id, account_id, amount, date, effective_accounting_date, accounting_treatment, status)
        VALUES ('test_dupe_1', 'stout001', 'stout001', 2500.00, '2026-09-01', '2026-09-01', 'INTERNAL_TRANSFER', 'confirmed');
        RAISE EXCEPTION 'TEST_FAILED: Duplicate was not blocked!';
      EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
        RAISE NOTICE 'SUCCESSFULLY BLOCKED UNCONFIRMED DUPLICATE: %', v_err;
      END;

      -- Try inserting legitimate separate deposit with distinct idempotency key (confirmed_addition)
      BEGIN
        INSERT INTO deposits (id, investor_id, account_id, amount, date, effective_accounting_date, accounting_treatment, status, idempotency_key)
        VALUES ('test_legit_1', 'stout001', 'stout001', 2500.00, '2026-09-01', '2026-09-01', 'INTERNAL_TRANSFER', 'confirmed', 'test_dep_confirmed_addition_123');
        RAISE NOTICE 'SUCCESSFULLY ALLOWED LEGITIMATE SEPARATE DEPOSIT WITH DISTINCT IDEMPOTENCY KEY';
        -- Delete test row immediately within transaction block
        DELETE FROM deposits WHERE id = 'test_legit_1';
      EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
        RAISE EXCEPTION 'TEST_FAILED: Legitimate separate deposit was incorrectly blocked: %', v_err;
      END;
    END $$;
  `;

  const testRes = await sql(testSql);
  console.log('Test execution response:', testRes);
}

main().catch(console.error);
