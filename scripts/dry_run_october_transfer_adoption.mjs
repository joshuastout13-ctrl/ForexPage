import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { isAuthoritativeProductionDbConfigured } from '../lib/supabase.js';
import { sql } from './inspect_internal_transfer_rpc.mjs';

process.env.DATA_SOURCE = 'supabase';

const IDEMPOTENCY_KEY = 'JOSH_AUTHORIZED_JERRY_STOUT_OCTOBER_2026_TRANSFER_ADOPTION';

export function getAdoptionSql(isDryRun = false) {
  return `
  DO $$
  DECLARE
    v_res jsonb;
    v_transfer_id uuid;
    v_transfer_num text;
    v_debit_id text;
    v_sep_return_pct numeric;
    v_sep_locked boolean;
    v_wd70k_count int;
    v_wd70k_amount numeric;
    v_dep_count int;
    v_dep_amount numeric;
    v_jerry_oct_wds_count int;
  BEGIN
    -- 1. Advisory Lock
    PERFORM pg_advisory_xact_lock(hashtext('${IDEMPOTENCY_KEY}'));

    -- 2. Safety Precondition: Verify September 2026 return remains +3.07% and locked
    SELECT gross_return_pct, locked INTO v_sep_return_pct, v_sep_locked
    FROM monthly_returns
    WHERE year = 2026 AND month_number = 9;

    IF v_sep_return_pct <> 3.07 OR v_sep_locked <> true THEN
      RAISE EXCEPTION 'PRECONDITION FAILED: September return is % locked=%, expected 3.07%% locked=true', v_sep_return_pct, v_sep_locked;
    END IF;

    -- 3. Safety Precondition: Verify Josh's completed $70,000 withdrawal exists and is completed
    SELECT count(*), COALESCE(sum(amount), 0) INTO v_wd70k_count, v_wd70k_amount
    FROM withdrawals
    WHERE id = 'wd_josh_auth_stout001_20000'
      AND investor_id = 'stout001'
      AND status = 'Completed';

    IF v_wd70k_count <> 1 OR v_wd70k_amount <> 70000.00 THEN
      RAISE EXCEPTION 'PRECONDITION FAILED: Josh $70k withdrawal not verified (count=%, sum=%)', v_wd70k_count, v_wd70k_amount;
    END IF;

    -- 4. Safety Precondition: Verify Josh's October monthly history reflects $70k withdrawal and $2,500 deposit
    IF NOT EXISTS (
      SELECT 1 FROM investor_monthly_history
      WHERE investor_id = 'stout001' AND year = 2026 AND month_number = 10
        AND withdrawals = 70000.00 AND deposits = 2500.00
    ) THEN
      RAISE EXCEPTION 'PRECONDITION FAILED: Josh October monthly history does not reflect 70k withdrawal and 2500 deposit';
    END IF;

    -- 5. Safety Precondition: Verify existing deposit dep_654ad1a9 is intact, amount 2500, unlinked
    SELECT count(*), COALESCE(sum(amount), 0) INTO v_dep_count, v_dep_amount
    FROM deposits
    WHERE id = 'dep_654ad1a9'
      AND account_id = 'stout001'
      AND status = 'confirmed';

    IF v_dep_count <> 1 OR v_dep_amount <> 2500.00 THEN
      RAISE EXCEPTION 'PRECONDITION FAILED: dep_654ad1a9 not found or amount mismatch (count=%, sum=%)', v_dep_count, v_dep_amount;
    END IF;

    -- 6. Safety Precondition: Verify no existing October debit on Jerry
    SELECT count(*) INTO v_jerry_oct_wds_count
    FROM withdrawals
    WHERE account_id = 'jerrys001'
      AND effective_accounting_date = '2026-10-01'
      AND status IN ('Completed', 'Approved')
      AND transfer_leg = 'DEBIT';

    IF v_jerry_oct_wds_count > 0 THEN
      RAISE EXCEPTION 'PRECONDITION FAILED: Jerry October debit already exists (count=%)', v_jerry_oct_wds_count;
    END IF;

    -- 7. Call adopt_legacy_internal_transfer_atomic RPC
    v_res := public.adopt_legacy_internal_transfer_atomic(
      'dep_654ad1a9',
      'jerrys001',
      'stout001',
      2500.00,
      '2026-10-01'::DATE,
      'Monthly recurring Jerry -> Stout internal transfer (October 2026)',
      'Josh confirmed recurring monthly $2,500 Jerry''s Rogue Jets -> Stout internal transfer.',
      '${IDEMPOTENCY_KEY}',
      'Josh Stout (Authorized via User Request Oct 2026)'
    );

    IF (v_res->>'success')::boolean IS NOT TRUE THEN
      RAISE EXCEPTION 'RPC FAILED: adopt_legacy_internal_transfer_atomic returned %', v_res;
    END IF;

    v_transfer_id := (v_res->>'transfer_id')::uuid;
    v_transfer_num := v_res->>'transfer_number';
    v_debit_id := v_res->>'withdrawal_id';

    -- 8. Update Jerry's October monthly history (and November/December projections)
    UPDATE investor_monthly_history
    SET withdrawals = 2500.00,
        ending_balance = opening_balance + deposits - 2500.00,
        updated_at = NOW()
    WHERE investor_id = 'jerrys001' AND year = 2026 AND month_number = 10;

    UPDATE investor_monthly_history
    SET opening_balance = 567700.0747959085,
        ending_balance = 567700.0747959085,
        updated_at = NOW()
    WHERE investor_id = 'jerrys001' AND year = 2026 AND month_number IN (11, 12);

    -- 9. Invariant Assertions:
    -- Assert dep_654ad1a9 is now INTERNAL_TRANSFER
    IF NOT EXISTS (
      SELECT 1 FROM deposits
      WHERE id = 'dep_654ad1a9'
        AND accounting_treatment = 'INTERNAL_TRANSFER'
        AND transfer_id = v_transfer_id
        AND transfer_leg = 'CREDIT'
    ) THEN
      RAISE EXCEPTION 'ASSERTION FAILED: dep_654ad1a9 not properly updated';
    END IF;

    -- Assert Jerry debit withdrawal exists and is linked
    IF NOT EXISTS (
      SELECT 1 FROM withdrawals
      WHERE id = v_debit_id
        AND investor_id = 'jerrys001'
        AND amount = 2500.00
        AND status = 'Completed'
        AND transfer_id = v_transfer_id
        AND transfer_leg = 'DEBIT'
    ) THEN
      RAISE EXCEPTION 'ASSERTION FAILED: Jerry debit withdrawal % not properly created', v_debit_id;
    END IF;

    -- Assert Master transfer exists
    IF NOT EXISTS (
      SELECT 1 FROM internal_transfers
      WHERE id = v_transfer_id
        AND transfer_number = v_transfer_num
        AND status = 'confirmed'
        AND amount = 2500.00
    ) THEN
      RAISE EXCEPTION 'ASSERTION FAILED: Master transfer % not confirmed', v_transfer_id;
    END IF;

    -- Assert Jerry ending balance is exactly 567700.0747959085
    IF NOT EXISTS (
      SELECT 1 FROM investor_monthly_history
      WHERE investor_id = 'jerrys001' AND year = 2026 AND month_number = 10
        AND ending_balance = 567700.0747959085
    ) THEN
      RAISE EXCEPTION 'ASSERTION FAILED: Jerry October ending balance mismatch';
    END IF;

    -- Assert Josh ending balance is completely unchanged at 3333453.5208468474
    IF NOT EXISTS (
      SELECT 1 FROM investor_monthly_history
      WHERE investor_id = 'stout001' AND year = 2026 AND month_number = 10
        AND ending_balance = 3333453.5208468474
    ) THEN
      RAISE EXCEPTION 'ASSERTION FAILED: Josh October ending balance changed unexpectedly';
    END IF;

    ${isDryRun ? `
    -- DRY RUN ROLLBACK TRIGGER
    RAISE EXCEPTION 'DRY_RUN_ROLLBACK_SUCCESS: All validations, RPC call, and assertions passed! Transfer number allocated: %', v_transfer_num;
    ` : ''}

  END $$;
  `;
}

async function runDryRun() {
  console.log('================================================================================');
  console.log('DRY RUN: OCTOBER 2026 JERRY -> STOUT TRANSFER ADOPTION');
  console.log('Authoritative Supabase Project: julhldzkiqdeuuoqmvlo');
  console.log('================================================================================\n');

  if (!isAuthoritativeProductionDbConfigured()) {
    throw new Error('FATAL: Not connected to authoritative production Supabase project (julhldzkiqdeuuoqmvlo)');
  }

  const dryRunSql = getAdoptionSql(true);
  console.log('Executing Dry Run Transaction in PostgreSQL...\n');

  const res = await sql(dryRunSql);
  console.log('Dry Run HTTP Status:', res.status);
  console.log('Dry Run Response:', JSON.stringify(res, null, 2));

  const text = JSON.stringify(res);
  if (text.includes('DRY_RUN_ROLLBACK_SUCCESS')) {
    console.log('\n✅ DRY RUN 100% SUCCESSFUL! All preconditions, RPC logic, and assertions passed.');
  } else {
    console.error('\n❌ DRY RUN FAILED OR UNEXPECTED RESPONSE:', res);
  }
}

runDryRun().catch(console.error);
