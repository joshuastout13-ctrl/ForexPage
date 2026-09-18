-- =============================================================================
-- Migration: Support Effective Date & Period Fields in update_withdrawal_atomic
-- Target: Supabase PostgreSQL (Production Project: julhldzkiqdeuuoqmvlo)
-- Date: 2026-09-18
--
-- Rationale:
-- 1. Allows updating/re-evaluating effective_accounting_date, year, month_number,
--    and month when editing a withdrawal.
-- 2. Strictly recalculates available equity at the target effective date while
--    self-excluding the withdrawal being edited (preventing double-counting).
-- 3. Drops legacy 5-param and UUID overloads to prevent PostgREST 42725 ambiguous
--    function call errors, while using DEFAULT NULL for all optional parameters.
-- 4. Guarantees fail-closed available equity validation against the exact target
--    accounting period.
-- =============================================================================

-- 1. Drop existing overloads to prevent ambiguity
DROP FUNCTION IF EXISTS public.update_withdrawal_atomic(TEXT, NUMERIC, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.update_withdrawal_atomic(UUID, NUMERIC, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.update_withdrawal_atomic(TEXT, NUMERIC, TEXT, TEXT, TEXT, DATE, INT, INT, TEXT);

-- 2. Create canonical update_withdrawal_atomic with period support
CREATE OR REPLACE FUNCTION public.update_withdrawal_atomic(
  p_withdrawal_id TEXT,
  p_amount NUMERIC DEFAULT NULL,
  p_status TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_updated_by TEXT DEFAULT NULL,
  p_effective_date DATE DEFAULT NULL,
  p_year INT DEFAULT NULL,
  p_month_number INT DEFAULT NULL,
  p_month TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_current_wd RECORD;
  v_lock_key BIGINT;
  v_target_amount NUMERIC(20, 2);
  v_target_status TEXT;
  v_target_effective_date DATE;
  v_available_equity NUMERIC(20, 2);
  v_updated_withdrawal RECORD;
BEGIN
  -- 1. Fetch current withdrawal with row lock
  SELECT * INTO v_current_wd
  FROM withdrawals
  WHERE id::text = p_withdrawal_id::text
  FOR UPDATE;

  IF v_current_wd.id IS NULL THEN
    RAISE EXCEPTION 'WITHDRAWAL_NOT_FOUND: Withdrawal % does not exist.', p_withdrawal_id;
  END IF;

  -- 2. ACQUIRE INVESTOR-SCOPED TRANSACTIONAL ADVISORY LOCK
  v_lock_key := financial_lock_key(v_current_wd.investor_id);
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- Also acquire row lock on investor_accounts
  PERFORM 1 FROM investor_accounts WHERE investor_id = v_current_wd.investor_id FOR UPDATE;

  -- Determine target amount & status
  v_target_amount := COALESCE(p_amount, v_current_wd.amount);
  v_target_status := INITCAP(TRIM(COALESCE(p_status, v_current_wd.status)));

  IF v_target_status NOT IN ('Pending', 'Approved', 'Completed', 'Cancelled', 'Void') THEN
    RAISE EXCEPTION 'INVALID_WITHDRAWAL_STATUS: Status must be Pending, Approved, Completed, Cancelled, or Void. Received: %', p_status;
  END IF;

  -- Validate Status Transition Policy
  IF v_target_status != v_current_wd.status THEN
    IF v_current_wd.status = 'Completed' THEN
      RAISE EXCEPTION 'INVALID_STATUS_TRANSITION: Completed withdrawals are financially immutable and cannot transition to %. Reversal requires an explicit correction deposit.', v_target_status;
    ELSIF v_current_wd.status IN ('Cancelled', 'Void') THEN
      RAISE EXCEPTION 'INVALID_STATUS_TRANSITION: Cannot transition terminal withdrawal status (%) to %.', v_current_wd.status, v_target_status;
    ELSIF v_current_wd.status = 'Approved' AND v_target_status NOT IN ('Completed', 'Cancelled', 'Void', 'Approved') THEN
      RAISE EXCEPTION 'INVALID_STATUS_TRANSITION: Approved withdrawals can only transition to Completed, Cancelled, or Void. Received: %', v_target_status;
    ELSIF v_current_wd.status = 'Pending' AND v_target_status NOT IN ('Approved', 'Cancelled', 'Void', 'Pending') THEN
      RAISE EXCEPTION 'INVALID_STATUS_TRANSITION: Pending withdrawals can only transition to Approved, Cancelled, or Void. Received: %', v_target_status;
    END IF;
  END IF;

  IF v_target_amount <= 0.00 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: Amount must be strictly greater than $0.00. Received: %', v_target_amount;
  END IF;

  -- Determine target effective date
  v_target_effective_date := COALESCE(p_effective_date, v_current_wd.effective_accounting_date, v_current_wd.request_date);
  IF v_target_effective_date IS NOT NULL AND EXTRACT(DAY FROM v_target_effective_date) != 1 THEN
    v_target_effective_date := DATE_TRUNC('month', v_target_effective_date)::DATE;
  END IF;

  -- 3. RECALCULATE AVAILABLE EQUITY (SELF-EXCLUDING CURRENT WITHDRAWAL)
  v_available_equity := calculate_available_withdrawal_equity_sql(
    v_current_wd.investor_id,
    v_current_wd.account_id,
    v_target_effective_date,
    p_withdrawal_id
  );

  -- 4. VALIDATE EQUITY IF ACTIVE STATUS
  IF v_target_status IN ('Pending', 'Approved', 'Completed') THEN
    IF v_target_amount > v_available_equity THEN
      RAISE EXCEPTION 'WITHDRAWAL_EXCEEDS_AVAILABLE_EQUITY: Updated amount ($%) exceeds available account equity ($%) at effective date %.',
        TO_CHAR(v_target_amount, 'FM999,999,990.00'),
        TO_CHAR(v_available_equity, 'FM999,999,990.00'),
        v_target_effective_date;
    END IF;
  END IF;

  -- 5. ATOMIC UPDATE
  UPDATE withdrawals
  SET
    amount = v_target_amount,
    status = v_target_status,
    notes = COALESCE(p_notes, notes),
    updated_by = COALESCE(p_updated_by, updated_by),
    effective_accounting_date = COALESCE(v_target_effective_date, effective_accounting_date),
    request_date = COALESCE(v_target_effective_date, request_date),
    year = COALESCE(p_year, EXTRACT(YEAR FROM v_target_effective_date)::INT, year),
    month_number = COALESCE(p_month_number, EXTRACT(MONTH FROM v_target_effective_date)::INT, month_number),
    month = COALESCE(p_month, month),
    updated_at = NOW()
  WHERE id::text = p_withdrawal_id::text
  RETURNING * INTO v_updated_withdrawal;

  RETURN jsonb_build_object(
    'status', 'SUCCESS',
    'withdrawal_id', v_updated_withdrawal.id,
    'available_equity_before', v_available_equity,
    'amount', v_target_amount,
    'available_equity_after', v_available_equity - v_target_amount,
    'effective_accounting_date', COALESCE(v_updated_withdrawal.effective_accounting_date, v_updated_withdrawal.request_date),
    'idempotency_replay', FALSE,
    'withdrawal', to_jsonb(v_updated_withdrawal)
  );
END;
$$;

-- 3. Permissions & Schema Reload
REVOKE EXECUTE ON FUNCTION public.update_withdrawal_atomic(TEXT, NUMERIC, TEXT, TEXT, TEXT, DATE, INT, INT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_withdrawal_atomic(TEXT, NUMERIC, TEXT, TEXT, TEXT, DATE, INT, INT, TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';
