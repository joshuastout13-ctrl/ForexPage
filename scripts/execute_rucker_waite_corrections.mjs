import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { supabase, isAuthoritativeProductionDbConfigured } from '../lib/supabase.js';
import { sql } from './inspect_internal_transfer_rpc.mjs';
import { buildInvestorDashboard } from '../lib/dashboard.js';
import Decimal from 'decimal.js';

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });
process.env.DATA_SOURCE = 'supabase';

const BATCH_ID = 'JOSH_AUTHORIZED_CORRECTION_RUCKER_WAITE_SEPT_2026_DUPLICATES';

export function getCorrectionSql(isDryRun = false) {
  return `
  DO $$
  DECLARE
    v_sep_return_pct numeric;
    v_sep_locked boolean;
    v_rucker_active_deps int;
    v_waite_active_deps int;
    v_rucker_sep_bal numeric;
    v_waite_sep_bal numeric;
  BEGIN
    -- 1. Advisory Lock
    PERFORM pg_advisory_xact_lock(hashtext('${BATCH_ID}'));

    -- 2. Precondition: September return is +3.07% and locked
    SELECT gross_return_pct, locked INTO v_sep_return_pct, v_sep_locked
    FROM monthly_returns
    WHERE year = 2026 AND month_number = 9;

    IF v_sep_return_pct <> 3.07 OR v_sep_locked <> true THEN
      RAISE EXCEPTION 'PRECONDITION FAILED: September return is % locked=%, expected 3.07%% locked=true', v_sep_return_pct, v_sep_locked;
    END IF;

    -- 3. Precondition: Kevin Rucker has exactly 2 confirmed September deposits and Sep ending is 210,911.04
    SELECT count(*) INTO v_rucker_active_deps
    FROM deposits
    WHERE investor_id = 'inv_7e7dcda2' AND date = '2026-09-01' AND status = 'confirmed';

    SELECT ending_balance INTO v_rucker_sep_bal
    FROM investor_monthly_history
    WHERE investor_id = 'inv_7e7dcda2' AND year = 2026 AND month_number = 9;

    IF v_rucker_active_deps <> 2 THEN
      RAISE EXCEPTION 'PRECONDITION FAILED: Expected 2 active Sep deposits for Kevin Rucker, found %', v_rucker_active_deps;
    END IF;

    IF ROUND(v_rucker_sep_bal, 2) <> 210911.04 THEN
      RAISE EXCEPTION 'PRECONDITION FAILED: Expected Kevin Rucker Sep balance 210911.04, found %', v_rucker_sep_bal;
    END IF;

    -- 4. Precondition: Neal Waite has exactly 2 confirmed September deposits and Sep ending is 560,959.66
    SELECT count(*) INTO v_waite_active_deps
    FROM deposits
    WHERE investor_id = 'inv_d8b5ab06' AND date = '2026-09-01' AND status = 'confirmed';

    SELECT ending_balance INTO v_waite_sep_bal
    FROM investor_monthly_history
    WHERE investor_id = 'inv_d8b5ab06' AND year = 2026 AND month_number = 9;

    IF v_waite_active_deps <> 2 THEN
      RAISE EXCEPTION 'PRECONDITION FAILED: Expected 2 active Sep deposits for Neal Waite, found %', v_waite_active_deps;
    END IF;

    IF ROUND(v_waite_sep_bal, 2) <> 560959.66 THEN
      RAISE EXCEPTION 'PRECONDITION FAILED: Expected Neal Waite Sep balance 560959.66, found %', v_waite_sep_bal;
    END IF;

    -- 5. Precondition: Canonical deposits exist and are confirmed
    IF NOT EXISTS (SELECT 1 FROM deposits WHERE id = 'dep_10f79b13' AND status = 'confirmed' AND amount = 5000.00) THEN
      RAISE EXCEPTION 'PRECONDITION FAILED: Canonical deposit dep_10f79b13 not found';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM deposits WHERE id = 'dep_576913ae' AND status = 'confirmed' AND amount = 12600.00) THEN
      RAISE EXCEPTION 'PRECONDITION FAILED: Canonical deposit dep_576913ae not found';
    END IF;

    -- 6. VOID Kevin Rucker duplicate deposit dep_29b84085
    UPDATE deposits
    SET status = 'void',
        type = 'VOID',
        voided_at = NOW(),
        voided_by = 'Josh Stout (Authorized via User Request)',
        void_reason = 'Voided duplicate unverified legacy record dep_29b84085 ($5,000.00); preserved canonical wire dep_10f79b13 per Josh Stout authorization.',
        updated_at = NOW()
    WHERE id = 'dep_29b84085' AND status = 'confirmed' AND amount = 5000.00;

    -- 7. VOID Neal Waite duplicate deposit dep_d75d7f29
    UPDATE deposits
    SET status = 'void',
        type = 'VOID',
        voided_at = NOW(),
        voided_by = 'Josh Stout (Authorized via User Request)',
        void_reason = 'Voided duplicate unverified legacy record dep_d75d7f29 ($12,600.00); preserved canonical wire dep_576913ae per Josh Stout authorization.',
        updated_at = NOW()
    WHERE id = 'dep_d75d7f29' AND status = 'confirmed' AND amount = 12600.00;

    -- 8. Audited Override: Kevin Rucker September 2026 History
    UPDATE investor_monthly_history
    SET deposits = 5000.00,
        ending_balance = 205834.29260923903,
        notes = 'Audited correction of duplicate deposit dep_29b84085 authorized by Josh Stout. Trading basis corrected from $207,722.50 to $202,722.50; gain corrected from $3,188.54 to $3,111.79.',
        updated_at = NOW()
    WHERE investor_id = 'inv_7e7dcda2' AND year = 2026 AND month_number = 9;

    -- Carryforward to October, November, December for Kevin Rucker
    UPDATE investor_monthly_history
    SET opening_balance = 205834.29260923903,
        ending_balance = 205834.29260923903,
        updated_at = NOW()
    WHERE investor_id = 'inv_7e7dcda2' AND year = 2026 AND month_number IN (10, 11, 12);

    -- 9. Audited Override: Neal Waite September 2026 History
    UPDATE investor_monthly_history
    SET deposits = 12600.00,
        ending_balance = 548166.2468041429,
        notes = 'Audited correction of duplicate deposit dep_d75d7f29 authorized by Josh Stout. Trading basis corrected from $552,479.10 to $539,879.10; gain corrected from $8,480.55 to $8,287.14.',
        updated_at = NOW()
    WHERE investor_id = 'inv_d8b5ab06' AND year = 2026 AND month_number = 9;

    -- Carryforward to October, November, December for Neal Waite
    UPDATE investor_monthly_history
    SET opening_balance = 548166.2468041429,
        ending_balance = 548166.2468041429,
        updated_at = NOW()
    WHERE investor_id = 'inv_d8b5ab06' AND year = 2026 AND month_number IN (10, 11, 12);

    -- 10. Invariant Assertions
    SELECT count(*) INTO v_rucker_active_deps
    FROM deposits
    WHERE investor_id = 'inv_7e7dcda2' AND date = '2026-09-01' AND status = 'confirmed';

    IF v_rucker_active_deps <> 1 THEN
      RAISE EXCEPTION 'POST-ASSERTION FAILED: Expected exactly 1 active Sep deposit for Kevin Rucker, found %', v_rucker_active_deps;
    END IF;

    SELECT count(*) INTO v_waite_active_deps
    FROM deposits
    WHERE investor_id = 'inv_d8b5ab06' AND date = '2026-09-01' AND status = 'confirmed';

    IF v_waite_active_deps <> 1 THEN
      RAISE EXCEPTION 'POST-ASSERTION FAILED: Expected exactly 1 active Sep deposit for Neal Waite, found %', v_waite_active_deps;
    END IF;

    SELECT ending_balance INTO v_rucker_sep_bal
    FROM investor_monthly_history
    WHERE investor_id = 'inv_7e7dcda2' AND year = 2026 AND month_number = 9;

    IF ROUND(v_rucker_sep_bal, 2) <> 205834.29 THEN
      RAISE EXCEPTION 'POST-ASSERTION FAILED: Expected Kevin Rucker Sep balance 205834.29, found %', v_rucker_sep_bal;
    END IF;

    SELECT ending_balance INTO v_waite_sep_bal
    FROM investor_monthly_history
    WHERE investor_id = 'inv_d8b5ab06' AND year = 2026 AND month_number = 9;

    IF ROUND(v_waite_sep_bal, 2) <> 548166.25 THEN
      RAISE EXCEPTION 'POST-ASSERTION FAILED: Expected Neal Waite Sep balance 548166.25, found %', v_waite_sep_bal;
    END IF;

    ${isDryRun ? `
    -- DRY RUN ROLLBACK TRIGGER
    RAISE EXCEPTION 'DRY_RUN_ROLLBACK_SUCCESS: All validations and assertions for Rucker and Waite passed!';
    ` : ''}

  END $$;
  `;
}

async function executeCorrection() {
  console.log('================================================================================');
  console.log('ATOMIC EXECUTION: KEVIN RUCKER & NEAL WAITE SEPTEMBER DUPLICATE DEPOSIT CORRECTION');
  console.log('Authoritative Supabase Project: julhldzkiqdeuuoqmvlo');
  console.log('================================================================================\n');

  if (!isAuthoritativeProductionDbConfigured()) {
    throw new Error('FATAL: Not connected to authoritative production Supabase project (julhldzkiqdeuuoqmvlo)');
  }

  // 1. Dry Run Test First
  console.log('1. Executing Dry Run in PostgreSQL...');
  const dryRunSql = getCorrectionSql(true);
  const dryRunRes = await sql(dryRunSql);
  if (!JSON.stringify(dryRunRes).includes('DRY_RUN_ROLLBACK_SUCCESS')) {
    throw new Error('DRY RUN FAILED: ' + JSON.stringify(dryRunRes));
  }
  console.log('✅ Dry Run 100% Successful: All preconditions, voiding, overrides, and assertions verified.\n');

  // 2. Production Atomic Execution
  console.log('2. Executing Real Production Transaction...');
  const prodSql = getCorrectionSql(false);
  const prodRes = await sql(prodSql);
  if (prodRes.status !== 200 && prodRes.status !== 201) {
    throw new Error('PRODUCTION EXECUTION FAILED: ' + JSON.stringify(prodRes));
  }
  console.log('✅ PRODUCTION EXECUTION COMMITTED!\n');

  // 3. Post-execution Dashboard Verification
  const ruckerDash = await buildInvestorDashboard('krucker', null, { mustBeAuthoritative: true });
  const waiteDash = await buildInvestorDashboard('nwaite', null, { mustBeAuthoritative: true });

  console.log('--- POST-CORRECTION DASHBOARD READINGS ---');
  console.log('Kevin Rucker Settled Balance: $', ruckerDash.summary.currentBalance.toFixed(2), '(Expected: $205,834.29)');
  console.log('Neal Waite Settled Balance:   $', waiteDash.summary.currentBalance.toFixed(2), '(Expected: $548,166.25)');
}

executeCorrection().catch(console.error);
