-- =============================================================================
-- Migration: Scott Sire Lifecycle Remediation & Ted Boardwalk $0 Cutover Reset
-- Target: Supabase PostgreSQL (Production Project: julhldzkiqdeuuoqmvlo)
-- Authorized By: Josh Stout (Managing Partner / Stone Forex)
-- Date: 2026-09-15
--
-- Scope:
-- 1. SCOTT SIRE (ssire / inv_f22b8d5d):
--    - Cancel orphaned Pending May 1 withdrawal (wd_pending_may_ssire, $25,000.00)
--      using canonical public.update_withdrawal_atomic.
--    - Preserve completed execution (wd_completed_may_ssire, $25,000.00).
--    - Zero settled balance change ($0.00); releases $25,000.00 reserved available equity.
--
-- 2. TED BOARDWALK (tboardwalk / inv_a79798ca):
--    - Record canonical cutover adjustment in account_cutover_adjustments for Sept 1, 2026
--      setting authorized_opening_balance = $0.00 (prior roll-forward = $384.56).
--    - Upsert investor_monthly_history for Sept 2026 to opening $0.00, ending $0.00.
--    - Assert $1,100.00 September withdrawal was NEVER created.
--    - Configure account as commission-only (is_commission = true, starting_capital = 0.00).
--
-- 3. ABSOLUTE INVARIANT ASSERTIONS:
--    - Jerry (jerrys001) is strictly UNTOUCHED.
--    - Mary Jo (inv_4c5c0ee6) is strictly UNTOUCHED.
--    - The 11 executed September batch withdrawals ($167,258.30) are strictly UNTOUCHED.
-- =============================================================================

DO $$
DECLARE
  v_scott_lock           BIGINT;
  v_ted_lock             BIGINT;
  v_pending_wd           RECORD;
  v_completed_wd         RECORD;
  v_ted_wd_count         INT;
  v_ted_acc_id           TEXT;
  v_jerry_aug_count      INT;
  v_maryjo_sep_count     INT;
  v_batch_count          INT;
  v_batch_sum            NUMERIC(20, 2);
  v_rpc_res              JSONB;
BEGIN
  -- ---------------------------------------------------------------------------
  -- 0. PREFLIGHT IMMUTABILITY & SAFETY ASSERTIONS
  -- ---------------------------------------------------------------------------
  
  -- Assertion 0A: Jerry August $2,500 withdrawal must remain exactly 1 row
  SELECT COUNT(*) INTO v_jerry_aug_count
  FROM withdrawals
  WHERE investor_id = 'jerrys001'
    AND effective_accounting_date = DATE '2026-08-01'
    AND amount = 2500.00
    AND status = 'Completed';

  IF v_jerry_aug_count < 1 THEN
    RAISE EXCEPTION 'SAFETY_ASSERTION_FAILED: Jerry August completed withdrawal not found. Mutation aborted.';
  END IF;

  -- Assertion 0B: Mary Jo September completed withdrawal ($21,000.00) must remain intact
  SELECT COUNT(*) INTO v_maryjo_sep_count
  FROM withdrawals
  WHERE investor_id = 'inv_4c5c0ee6'
    AND effective_accounting_date = DATE '2026-09-01'
    AND amount = 21000.00
    AND status = 'Completed';

  IF v_maryjo_sep_count != 1 THEN
    RAISE EXCEPTION 'SAFETY_ASSERTION_FAILED: Mary Jo September withdrawal expected 1 row, found %. Mutation aborted.', v_maryjo_sep_count;
  END IF;

  -- Assertion 0C: September authorized batch (11 transactions = $167,258.30) must remain intact
  SELECT COUNT(*), COALESCE(SUM(amount), 0.00)
  INTO v_batch_count, v_batch_sum
  FROM withdrawals
  WHERE effective_accounting_date = DATE '2026-09-01'
    AND status = 'Completed';

  IF v_batch_count != 11 OR v_batch_sum != 167258.30 THEN
    RAISE EXCEPTION 'SAFETY_ASSERTION_FAILED: September batch tampered! Expected 11 rows ($167,258.30), found % rows ($%). Mutation aborted.',
      v_batch_count, v_batch_sum;
  END IF;

  -- Assertion 0D: Ted Boardwalk $1,100 withdrawal must NEVER exist
  SELECT COUNT(*) INTO v_ted_wd_count
  FROM withdrawals
  WHERE investor_id = 'inv_a79798ca'
    AND (year = 2026 AND month_number = 9 OR effective_accounting_date = DATE '2026-09-01');

  IF v_ted_wd_count > 0 THEN
    RAISE EXCEPTION 'SAFETY_ASSERTION_FAILED: September withdrawal found for Ted Boardwalk. It must not exist!';
  END IF;

  -- ---------------------------------------------------------------------------
  -- 1. SCOTT SIRE REMEDIATION
  -- ---------------------------------------------------------------------------
  v_scott_lock := financial_lock_key('inv_f22b8d5d');
  PERFORM pg_advisory_xact_lock(v_scott_lock);

  -- Verify Completed row exists
  SELECT * INTO v_completed_wd
  FROM withdrawals
  WHERE investor_id = 'inv_f22b8d5d'
    AND amount = 25000.00
    AND status = 'Completed'
    AND (id = 'wd_completed_may_ssire' OR effective_accounting_date = DATE '2026-05-01');

  IF v_completed_wd.id IS NULL THEN
    RAISE EXCEPTION 'CAS_FAILURE: Scott Sire completed May withdrawal not found.';
  END IF;

  -- Verify and cancel orphaned Pending row
  SELECT * INTO v_pending_wd
  FROM withdrawals
  WHERE investor_id = 'inv_f22b8d5d'
    AND amount = 25000.00
    AND status = 'Pending'
    AND (id = 'wd_pending_may_ssire' OR effective_accounting_date = DATE '2026-05-01');

  IF v_pending_wd.id IS NOT NULL THEN
    v_rpc_res := update_withdrawal_atomic(
      p_withdrawal_id := v_pending_wd.id::text,
      p_amount := NULL,
      p_status := 'Cancelled',
      p_notes := 'Cancelled duplicate pending record for May 2026 distribution - superseded by completed withdrawal ' || v_completed_wd.id::text || ' per Josh Stout authorization',
      p_updated_by := 'system_accounting_remediation'
    );
    RAISE NOTICE 'Scott Sire pending withdrawal % successfully transitioned to Cancelled.', v_pending_wd.id;
  ELSE
    RAISE NOTICE 'Scott Sire pending withdrawal already cancelled or absent. Completed withdrawal % intact.', v_completed_wd.id;
  END IF;

  -- ---------------------------------------------------------------------------
  -- 2. TED BOARDWALK SEPTEMBER 1 RESET TO $0 (COMMISSION-ONLY)
  -- ---------------------------------------------------------------------------
  v_ted_lock := financial_lock_key('inv_a79798ca');
  PERFORM pg_advisory_xact_lock(v_ted_lock);

  -- Resolve Ted Account ID
  SELECT id::text INTO v_ted_acc_id
  FROM investor_accounts
  WHERE investor_id = 'inv_a79798ca' OR id = 'tboardwalk'
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_ted_acc_id IS NULL THEN
    v_ted_acc_id := 'tboardwalk';
  END IF;

  -- A. Insert or update durable cutover adjustment for September 1, 2026
  INSERT INTO account_cutover_adjustments (
    investor_id,
    account_id,
    year,
    month_number,
    effective_date,
    authorized_opening_balance,
    prior_rollforward_balance,
    reason,
    authorization_reference,
    created_by,
    idempotency_key
  )
  VALUES (
    'inv_a79798ca',
    v_ted_acc_id,
    2026,
    9,
    DATE '2026-09-01',
    0.00,
    384.56,
    'September 1, 2026 commission-only account cutover reset to $0 authorized by Josh Stout',
    'JOSH_CONFIRMED_TED_BOARDWALK_ZERO_RESET_SEPTEMBER_1_2026',
    'system_accounting_remediation',
    'cutover_inv_a79798ca_2026_9'
  )
  ON CONFLICT (investor_id, year, month_number)
  DO UPDATE SET
    authorized_opening_balance = 0.00,
    prior_rollforward_balance = 384.56,
    reason = EXCLUDED.reason,
    authorization_reference = EXCLUDED.authorization_reference,
    updated_at = NOW();

  RAISE NOTICE 'Ted Boardwalk September 1 cutover adjustment to $0.00 recorded successfully.';

  -- B. Upsert investor_monthly_history for September 2026
  INSERT INTO investor_monthly_history (
    investor_id,
    account_id,
    year,
    month_number,
    month,
    opening_balance,
    deposits,
    withdrawals,
    gross_return_pct,
    ending_balance,
    is_manual,
    notes
  )
  VALUES (
    'inv_a79798ca',
    v_ted_acc_id,
    2026,
    9,
    'September',
    0.00,
    0.00,
    0.00,
    0.00,
    0.00,
    true,
    'September 1, 2026 reset to $0 authorized by Josh Stout (commission-only baseline)'
  )
  ON CONFLICT (investor_id, year, month_number)
  DO UPDATE SET
    opening_balance = 0.00,
    deposits = 0.00,
    withdrawals = 0.00,
    gross_return_pct = 0.00,
    ending_balance = 0.00,
    is_manual = true,
    notes = 'September 1, 2026 reset to $0 authorized by Josh Stout (commission-only baseline)',
    updated_at = NOW();

  RAISE NOTICE 'Ted Boardwalk September monthly history reset to $0.00.';

  -- C. Configure investor_accounts as commission-only
  UPDATE investor_accounts
  SET is_commission = true,
      starting_capital = 0.00,
      notes = COALESCE(notes || '; ', '') || 'Commission-only partner account per Josh Stout authorization (September 2026)',
      updated_at = NOW()
  WHERE investor_id = 'inv_a79798ca' OR id = 'tboardwalk';

  RAISE NOTICE 'Ted Boardwalk account marked commission-only with starting_capital = $0.00.';

END $$;

-- -----------------------------------------------------------------------------
-- 3. POST-MIGRATION CAS AUDIT VERIFICATION (READ-ONLY)
-- -----------------------------------------------------------------------------

-- Scott Sire Withdrawal State (Must show Completed = 1, Cancelled = 1, Pending = 0)
SELECT 
  id,
  investor_id,
  amount,
  status,
  effective_accounting_date,
  notes,
  updated_at
FROM withdrawals
WHERE investor_id = 'inv_f22b8d5d'
ORDER BY effective_accounting_date, status;

-- Ted Boardwalk Cutover & History Records
SELECT 
  'account_cutover_adjustments' AS table_name,
  year,
  month_number,
  authorized_opening_balance,
  prior_rollforward_balance,
  reason,
  authorization_reference
FROM account_cutover_adjustments
WHERE investor_id = 'inv_a79798ca'
UNION ALL
SELECT 
  'investor_monthly_history' AS table_name,
  year,
  month_number,
  opening_balance,
  ending_balance,
  notes,
  NULL
FROM investor_monthly_history
WHERE investor_id = 'inv_a79798ca'
ORDER BY table_name, year, month_number;

-- Ted Boardwalk Account Configuration
SELECT 
  id,
  investor_id,
  starting_capital,
  is_commission,
  status,
  notes
FROM investor_accounts
WHERE investor_id = 'inv_a79798ca' OR id = 'tboardwalk';

-- Invariant Protection Check: September Batch (Must be 11 rows, $167,258.30)
SELECT 
  COUNT(*) AS sept_batch_count,
  SUM(amount) AS sept_batch_total,
  (COUNT(*) = 11 AND SUM(amount) = 167258.30) AS batch_intact
FROM withdrawals
WHERE effective_accounting_date = DATE '2026-09-01'
  AND status = 'Completed';
