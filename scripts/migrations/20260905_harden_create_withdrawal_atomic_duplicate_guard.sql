-- =============================================================================
-- Migration: Harden create_withdrawal_atomic with Advisory-Locked Economic Duplicate Guard
-- Target: Supabase PostgreSQL (public schema)
-- Date: 2026-09-05
--
-- Safety Requirements:
-- 1. Fail-closed economic duplicate detection: Prevents inserting duplicate
--    active withdrawals (Pending, Approved, Completed) with equivalent
--    investor_id, effective_accounting_date, and amount under investor advisory lock.
-- 2. Returns status 'DUPLICATE_ECONOMIC_TRANSACTION' instead of inserting second row.
-- 3. Supports legitimate identical multi-distributions in the same month via explicit
--    p_allow_duplicate_amount := TRUE with distinguishing idempotency key/notes.
-- 4. Replaces 8-parameter overload cleanly to prevent PostgREST RPC ambiguity (42725).
-- 5. Transactional safety (BEGIN ... COMMIT) ensures all-or-nothing execution.
-- 6. Notifies PostgREST to reload schema cache immediately.
-- =============================================================================

BEGIN;

-- 1. Drop existing 8-parameter overload to maintain unambiguous PostgREST routing
DROP FUNCTION IF EXISTS public.create_withdrawal_atomic(TEXT, TEXT, NUMERIC, DATE, TEXT, TEXT, TEXT, TEXT);

-- 2. Create hardened atomic function with duplicate guard (9 parameters, 9th defaulted)
CREATE OR REPLACE FUNCTION public.create_withdrawal_atomic(
  p_investor_id TEXT,
  p_account_id TEXT,
  p_amount NUMERIC(20, 2),
  p_effective_date DATE,
  p_status TEXT DEFAULT 'Pending',
  p_notes TEXT DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL,
  p_created_by TEXT DEFAULT NULL,
  p_allow_duplicate_amount BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_lock_key BIGINT;
  v_available_equity NUMERIC(20, 2);
  v_existing_id TEXT;
  v_existing_amount NUMERIC(20, 2);
  v_existing_investor TEXT;
  v_existing_effective_date DATE;
  v_normalized_status TEXT;
  v_target_year INT;
  v_target_month INT;
  v_new_withdrawal RECORD;
  v_inv_id TEXT;
  v_new_id TEXT;
  v_duplicate_id TEXT;
  v_duplicate_status TEXT;
  v_duplicate_key TEXT;
BEGIN
  -- Normalize & Validate Status
  v_normalized_status := INITCAP(TRIM(COALESCE(p_status, 'Pending')));
  IF v_normalized_status NOT IN ('Pending', 'Approved', 'Completed', 'Cancelled', 'Void') THEN
    RAISE EXCEPTION 'INVALID_WITHDRAWAL_STATUS: Status must be Pending, Approved, Completed, Cancelled, or Void. Received: %', p_status;
  END IF;

  -- Validate Amount
  IF p_amount IS NULL OR p_amount <= 0.00 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: Amount must be strictly greater than $0.00. Received: %', p_amount;
  END IF;

  -- Validate Effective Date (Must be explicit first-of-month)
  IF p_effective_date IS NULL THEN
    RAISE EXCEPTION 'INVALID_EFFECTIVE_DATE: Effective date is required.';
  END IF;

  IF EXTRACT(DAY FROM p_effective_date) != 1 THEN
    RAISE EXCEPTION 'INVALID_EFFECTIVE_DATE: Effective date must be the first day of the month (YYYY-MM-01). Received: %', p_effective_date;
  END IF;

  v_target_year := EXTRACT(YEAR FROM p_effective_date)::INT;
  v_target_month := EXTRACT(MONTH FROM p_effective_date)::INT;

  -- Resolve Canonical Investor ID
  SELECT id INTO v_inv_id FROM investors WHERE id = p_investor_id;
  IF v_inv_id IS NULL THEN
    SELECT id INTO v_inv_id FROM investors WHERE portal_username = p_investor_id LIMIT 1;
  END IF;
  IF v_inv_id IS NOT NULL THEN
    p_investor_id := v_inv_id;
  END IF;

  -- 1. ACQUIRE INVESTOR-SCOPED TRANSACTIONAL ADVISORY LOCK
  v_lock_key := financial_lock_key(p_investor_id);
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- Also acquire row lock on investor_accounts
  PERFORM 1 FROM investor_accounts WHERE investor_id = p_investor_id FOR UPDATE;

  -- 2. IDEMPOTENCY KEY CHECK
  IF p_idempotency_key IS NOT NULL AND TRIM(p_idempotency_key) != '' THEN
    SELECT id, amount, investor_id, effective_accounting_date
    INTO v_existing_id, v_existing_amount, v_existing_investor, v_existing_effective_date
    FROM withdrawals
    WHERE idempotency_key = TRIM(p_idempotency_key)
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      -- If same parameters, return existing record (Idempotent Replay)
      IF v_existing_investor = p_investor_id AND v_existing_amount = p_amount AND v_existing_effective_date = p_effective_date THEN
        SELECT * INTO v_new_withdrawal FROM withdrawals WHERE id::text = v_existing_id::text;
        RETURN jsonb_build_object(
          'status', 'IDEMPOTENT_REPLAY',
          'withdrawal_id', v_new_withdrawal.id,
          'amount', v_new_withdrawal.amount,
          'effective_accounting_date', v_new_withdrawal.effective_accounting_date,
          'idempotency_replay', TRUE,
          'withdrawal', to_jsonb(v_new_withdrawal)
        );
      ELSE
        -- Idempotency key conflict with mismatched payload
        RAISE EXCEPTION 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH: Key % was already used for investor % amount $%.', 
          p_idempotency_key, v_existing_investor, v_existing_amount;
      END IF;
    END IF;
  END IF;

  -- 3. ECONOMIC DUPLICATE DETECTION (Under Investor Advisory Lock)
  -- If p_allow_duplicate_amount is FALSE, block creating duplicate active transaction
  -- Checks all economically active statuses: Pending, Approved, Completed (case-insensitive)
  IF NOT COALESCE(p_allow_duplicate_amount, FALSE) THEN
    SELECT id, status, idempotency_key
    INTO v_duplicate_id, v_duplicate_status, v_duplicate_key
    FROM withdrawals
    WHERE (investor_id = p_investor_id OR account_id = p_account_id)
      AND effective_accounting_date = p_effective_date
      AND amount = p_amount
      AND INITCAP(TRIM(status)) IN ('Pending', 'Approved', 'Completed')
    LIMIT 1;

    IF v_duplicate_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'status', 'DUPLICATE_ECONOMIC_TRANSACTION',
        'error', format('DUPLICATE_ECONOMIC_TRANSACTION: An active withdrawal of identical amount ($%s) already exists for this investor and effective date (ID: %s, Status: %s). If this is an authorized multiple distribution, set allow_duplicate_amount=true with distinguishing transaction identity.',
          TO_CHAR(p_amount, 'FM999,999,990.00'), v_duplicate_id, v_duplicate_status),
        'existing_withdrawal_id', v_duplicate_id,
        'existing_withdrawal_status', v_duplicate_status,
        'existing_idempotency_key', v_duplicate_key,
        'amount', p_amount,
        'effective_accounting_date', p_effective_date
      );
    END IF;
  END IF;

  -- 4. CALCULATE AVAILABLE EQUITY (FAIL-CLOSED)
  v_available_equity := calculate_available_withdrawal_equity_sql(
    p_investor_id,
    p_account_id,
    p_effective_date,
    NULL
  );

  -- 5. EQUITY CONSTRAINT VALIDATION
  IF v_normalized_status IN ('Pending', 'Approved', 'Completed') THEN
    IF p_amount > v_available_equity THEN
      RAISE EXCEPTION 'WITHDRAWAL_EXCEEDS_AVAILABLE_EQUITY: Requested amount ($%) exceeds available account equity ($%) at effective date %.',
        TO_CHAR(p_amount, 'FM999,999,990.00'),
        TO_CHAR(v_available_equity, 'FM999,999,990.00'),
        p_effective_date;
    END IF;
  END IF;

  v_new_id := gen_random_uuid()::text;

  -- 6. ATOMIC INSERT
  INSERT INTO withdrawals (
    id,
    investor_id,
    account_id,
    amount,
    effective_accounting_date,
    request_date,
    status,
    notes,
    year,
    month_number,
    idempotency_key,
    created_by,
    created_at,
    updated_at
  ) VALUES (
    v_new_id,
    p_investor_id,
    p_account_id,
    p_amount,
    p_effective_date,
    p_effective_date,
    v_normalized_status,
    p_notes,
    v_target_year,
    v_target_month,
    NULLIF(TRIM(p_idempotency_key), ''),
    p_created_by,
    NOW(),
    NOW()
  )
  RETURNING * INTO v_new_withdrawal;

  RETURN jsonb_build_object(
    'status', 'SUCCESS',
    'withdrawal_id', v_new_withdrawal.id,
    'available_equity_before', v_available_equity,
    'amount', p_amount,
    'available_equity_after', v_available_equity - p_amount,
    'effective_accounting_date', p_effective_date,
    'idempotency_replay', FALSE,
    'withdrawal', to_jsonb(v_new_withdrawal)
  );
END;
$$;

-- 3. Revoke public execute and grant strictly to service_role
REVOKE EXECUTE ON FUNCTION public.create_withdrawal_atomic(TEXT, TEXT, NUMERIC, DATE, TEXT, TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_withdrawal_atomic(TEXT, TEXT, NUMERIC, DATE, TEXT, TEXT, TEXT, TEXT, BOOLEAN) TO service_role;

-- 4. Reload PostgREST schema cache immediately so new signature is active without restart
NOTIFY pgrst, 'reload schema';

COMMIT;
