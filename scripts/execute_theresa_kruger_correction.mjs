import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { supabase, isAuthoritativeProductionDbConfigured } from '../lib/supabase.js';
import { sql } from './inspect_internal_transfer_rpc.mjs';
import { buildInvestorDashboard } from '../lib/dashboard.js';
import Decimal from 'decimal.js';

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });
process.env.DATA_SOURCE = 'supabase';

const IDEMPOTENCY_KEY = 'JOSH_AUTHORIZED_TKRUGER_SEPTEMBER_2026_WITHDRAWAL_1696_33';

export function getCorrectionSql(isDryRun = false) {
  return `
  DO $$
  DECLARE
    v_idempotency_key text := '${IDEMPOTENCY_KEY}';
    v_sep_return_pct numeric;
    v_sep_locked boolean;
    v_current_wd_amount numeric;
    v_current_wd_status text;
    v_current_wd_date date;
    v_m9_open numeric;
    v_m9_wd numeric;
    v_m9_end numeric;
    v_m9_locked boolean;
    v_m10_open numeric;
    v_m10_end numeric;
    v_new_trading_basis numeric;
    v_new_trading_gain numeric;
    v_new_sep_ending numeric;
  BEGIN
    -- 1. Advisory Lock
    PERFORM pg_advisory_xact_lock(hashtext(v_idempotency_key));

    -- 2. Verify September locked at +3.07%
    SELECT gross_return_pct, locked INTO v_sep_return_pct, v_sep_locked
    FROM monthly_returns
    WHERE year = 2026 AND month_number = 9;

    IF v_sep_return_pct <> 3.07 OR v_sep_locked <> true THEN
      RAISE EXCEPTION 'PRECONDITION FAILED: September return is % locked=%, expected 3.07%% locked=true', v_sep_return_pct, v_sep_locked;
    END IF;

    -- 3. Lock Theresa's affected records: withdrawal and monthly history
    SELECT amount, status, effective_accounting_date
    INTO v_current_wd_amount, v_current_wd_status, v_current_wd_date
    FROM withdrawals
    WHERE id = 'af879743-8a64-42b9-898a-84d7925c40ad'
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'PRECONDITION FAILED: Withdrawal af879743-8a64-42b9-898a-84d7925c40ad not found';
    END IF;

    SELECT opening_balance, withdrawals, ending_balance, locked
    INTO v_m9_open, v_m9_wd, v_m9_end, v_m9_locked
    FROM investor_monthly_history
    WHERE investor_id = 'inv_8cf28066' AND year = 2026 AND month_number = 9
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'PRECONDITION FAILED: September monthly history for Theresa Kruger not found';
    END IF;

    SELECT opening_balance, ending_balance
    INTO v_m10_open, v_m10_end
    FROM investor_monthly_history
    WHERE investor_id = 'inv_8cf28066' AND year = 2026 AND month_number = 10
    FOR UPDATE;

    -- 4. Idempotency & State Checks
    -- If already corrected:
    IF v_current_wd_amount = 1696.33 AND ROUND(v_m9_end, 2) = 111688.50 AND ROUND(v_m10_open, 2) = 111688.50 THEN
      RAISE NOTICE 'ALREADY_APPLIED: Theresa Kruger withdrawal and history already corrected to 1696.33 and 111688.50';
      RETURN;
    END IF;

    -- Partial state checks:
    IF v_current_wd_amount = 1696.33 AND ROUND(v_m9_end, 2) <> 111688.50 THEN
      RAISE EXCEPTION 'PARTIAL_CORRECTION_DETECTED: Withdrawal is 1696.33 but September ending balance is %, failing closed.', v_m9_end;
    END IF;

    IF v_current_wd_amount <> 1697.33 THEN
      RAISE EXCEPTION 'PRECONDITION FAILED: Expected current withdrawal amount to be 1697.33, found %', v_current_wd_amount;
    END IF;

    IF v_current_wd_status <> 'Completed' THEN
      RAISE EXCEPTION 'PRECONDITION FAILED: Expected withdrawal status Completed, found %', v_current_wd_status;
    END IF;

    IF v_current_wd_date <> '2026-09-01' THEN
      RAISE EXCEPTION 'PRECONDITION FAILED: Expected withdrawal effective date 2026-09-01, found %', v_current_wd_date;
    END IF;

    IF ROUND(v_m9_open, 5) <> ROUND(111696.32824817879, 5) THEN
      RAISE EXCEPTION 'PRECONDITION FAILED: Expected September opening balance 111696.32824817879, found %', v_m9_open;
    END IF;

    IF v_m9_wd <> 1697.33 THEN
      RAISE EXCEPTION 'PRECONDITION FAILED: Expected September history withdrawal 1697.33, found %', v_m9_wd;
    END IF;

    IF ROUND(v_m9_end, 2) <> 111687.48 THEN
      RAISE EXCEPTION 'PRECONDITION FAILED: Expected September history ending 111687.48, found %', v_m9_end;
    END IF;

    -- 5. Calculate new values in full numeric precision
    -- Trading basis: opening (111696.32824817879) - withdrawal (1696.33) = 109999.99824817879
    v_new_trading_basis := v_m9_open - 1696.33;
    -- Trading gain: trading_basis * 0.0307 * 0.50 = 1688.49997310954442650
    v_new_trading_gain := v_new_trading_basis * 0.0307 * 0.50;
    -- New September ending balance: trading_basis + trading_gain = 111688.49822128833442650
    v_new_sep_ending := v_new_trading_basis + v_new_trading_gain;

    -- 6. Update withdrawal record
    UPDATE withdrawals
    SET amount = 1696.33,
        notes = 'Stakeholder-authorized September 1, 2026 withdrawal batch. AUDIT_CORRECTION: Adjusted from $1,697.33 to $1,696.33 per Josh Stout explicit authorization (exact $1.00 reduction). Idempotency: ' || v_idempotency_key,
        updated_at = NOW()
    WHERE id = 'af879743-8a64-42b9-898a-84d7925c40ad'
      AND amount = 1697.33;

    -- 7. Update September monthly history
    UPDATE investor_monthly_history
    SET withdrawals = 1696.33,
        ending_balance = v_new_sep_ending,
        notes = 'Audited correction: September withdrawal af879743-8a64-42b9-898a-84d7925c40ad reduced from $1,697.33 to $1,696.33 per Josh Stout authorization. Trading basis corrected from $109,998.99824817879 to $109,999.99824817879; trading gain corrected from $1,688.48462310954 to $1,688.49997310954; ending balance corrected from $111,687.48287128835 to $111,688.49822128833. Idempotency: ' || v_idempotency_key,
        updated_at = NOW()
    WHERE investor_id = 'inv_8cf28066'
      AND year = 2026
      AND month_number = 9;

    -- 8. Carryforward to October, November, December
    UPDATE investor_monthly_history
    SET opening_balance = v_new_sep_ending,
        ending_balance = v_new_sep_ending,
        updated_at = NOW()
    WHERE investor_id = 'inv_8cf28066'
      AND year = 2026
      AND month_number IN (10, 11, 12);

    -- 9. Post-condition assertions
    IF NOT EXISTS (
      SELECT 1 FROM withdrawals
      WHERE id = 'af879743-8a64-42b9-898a-84d7925c40ad'
        AND amount = 1696.33
        AND status = 'Completed'
    ) THEN
      RAISE EXCEPTION 'POST-ASSERTION FAILED: Withdrawal record not updated to 1696.33 Completed';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM investor_monthly_history
      WHERE investor_id = 'inv_8cf28066'
        AND year = 2026
        AND month_number = 9
        AND withdrawals = 1696.33
        AND ROUND(ending_balance, 2) = 111688.50
    ) THEN
      RAISE EXCEPTION 'POST-ASSERTION FAILED: September history not updated to 111688.50';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM investor_monthly_history
      WHERE investor_id = 'inv_8cf28066'
        AND year = 2026
        AND month_number = 10
        AND ROUND(opening_balance, 2) = 111688.50
        AND ROUND(ending_balance, 2) = 111688.50
    ) THEN
      RAISE EXCEPTION 'POST-ASSERTION FAILED: October history carryforward not updated to 111688.50';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM investor_monthly_history
      WHERE investor_id = 'inv_8cf28066'
        AND year = 2026
        AND month_number = 11
        AND ROUND(opening_balance, 2) = 111688.50
    ) THEN
      RAISE EXCEPTION 'POST-ASSERTION FAILED: November history carryforward not updated to 111688.50';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM investor_monthly_history
      WHERE investor_id = 'inv_8cf28066'
        AND year = 2026
        AND month_number = 12
        AND ROUND(opening_balance, 2) = 111688.50
    ) THEN
      RAISE EXCEPTION 'POST-ASSERTION FAILED: December history carryforward not updated to 111688.50';
    END IF;

    ${isDryRun ? `
    -- DRY RUN ROLLBACK TRIGGER
    RAISE EXCEPTION 'DRY_RUN_ROLLBACK_SUCCESS: All validations, mutations, and assertions passed!';
    ` : ''}

  END $$;
  `;
}

export async function executeTheresaCorrection() {
  console.log('================================================================================');
  console.log('ATOMIC EXECUTION: THERESA KRUGER SEPTEMBER 2026 WITHDRAWAL CORRECTION');
  console.log('Authoritative Supabase Project: julhldzkiqdeuuoqmvlo');
  console.log('Idempotency Key: ' + IDEMPOTENCY_KEY);
  console.log('================================================================================\n');

  if (!isAuthoritativeProductionDbConfigured()) {
    throw new Error('FATAL: Not connected to authoritative production Supabase project (julhldzkiqdeuuoqmvlo)');
  }

  // Pre-check if already applied
  const { data: currentWd } = await supabase.from('withdrawals').select('amount, status').eq('id', 'af879743-8a64-42b9-898a-84d7925c40ad').single();
  const { data: currentM9 } = await supabase.from('investor_monthly_history').select('ending_balance').eq('investor_id', 'inv_8cf28066').eq('year', 2026).eq('month_number', 9).single();
  
  if (currentWd && Number(currentWd.amount) === 1696.33 && currentM9 && Math.round(Number(currentM9.ending_balance) * 100) === 11168850) {
    console.log('✅ ALREADY_APPLIED: Theresa Kruger correction has already been executed cleanly.');
    const dash = await buildInvestorDashboard('tkruger', null, { mustBeAuthoritative: true });
    return { status: 'ALREADY_APPLIED', dash };
  }

  // 1. Executing Dry Run in PostgreSQL
  console.log('1. Executing Dry Run in PostgreSQL...');
  const dryRunSql = getCorrectionSql(true);
  const dryRunRes = await sql(dryRunSql);
  const dryRunStr = JSON.stringify(dryRunRes);
  if (!dryRunStr.includes('DRY_RUN_ROLLBACK_SUCCESS')) {
    throw new Error('DRY RUN FAILED: ' + dryRunStr);
  }
  console.log('✅ Dry Run Successful: All preconditions, formulas, updates, and assertions verified.\n');

  // 2. Production Atomic Execution
  console.log('2. Executing Real Production Transaction...');
  const prodSql = getCorrectionSql(false);
  const prodRes = await sql(prodSql);
  if (prodRes.status !== 200 && prodRes.status !== 201) {
    throw new Error('PRODUCTION EXECUTION FAILED: ' + JSON.stringify(prodRes));
  }
  console.log('✅ PRODUCTION TRANSACTION COMMITTED SUCCESSFULLY!\n');

  // 3. Post-execution Dashboard Verification
  const dash = await buildInvestorDashboard('tkruger', null, { mustBeAuthoritative: true });

  console.log('--- POST-CORRECTION DASHBOARD VERIFICATION ---');
  console.log('Current Settled Balance: $', dash.summary.currentBalance.toFixed(2), '(Expected: $111,688.50)');
  console.log('Lifetime Withdrawals:    $', dash.summary.totalWithdrawals.toFixed(2), '(Expected: $5,295.66)');
  return { status: 'SUCCESS', dash };
}

// If run directly
if (process.argv[1].endsWith('execute_theresa_kruger_correction.mjs')) {
  executeTheresaCorrection().catch(err => {
    console.error('Execution failed:', err);
    process.exit(1);
  });
}
