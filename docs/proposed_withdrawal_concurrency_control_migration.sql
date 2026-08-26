-- =============================================================================
-- STONE & COMPANY FOREX FUND — PACKAGE B: CONCURRENCY-SAFE WITHDRAWAL CONTROL
-- Status: CANDIDATE / STAGING READY (FAIL-CLOSED EQUITY & LOCK PROTOCOL)
-- Version: 2.1.0
-- =============================================================================

-- 1. ADD IDEMPOTENCY KEY, CREATED_BY, UPDATED_AT TO WITHDRAWALS TABLE
ALTER TABLE withdrawals 
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS created_by TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

CREATE UNIQUE INDEX IF NOT EXISTS idx_withdrawals_idempotency_key 
  ON withdrawals (idempotency_key) 
  WHERE idempotency_key IS NOT NULL;

-- 2. SHARED FINANCIAL ADVISORY LOCK KEY FUNCTION
CREATE OR REPLACE FUNCTION financial_lock_key(p_investor_id TEXT)
RETURNS BIGINT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT ('x' || substr(md5(p_investor_id), 1, 16))::bit(64)::bigint;
$$;

-- 3. HELPER FUNCTION: FAIL-CLOSED AUTHORITATIVE AVAILABLE EQUITY CALCULATION
CREATE OR REPLACE FUNCTION calculate_available_withdrawal_equity_sql(
  p_investor_id TEXT,
  p_account_id TEXT,
  p_effective_date DATE,
  p_exclude_withdrawal_id TEXT DEFAULT NULL
)
RETURNS NUMERIC(20, 2)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_target_year INT;
  v_target_month INT;
  v_inv_start_date DATE;
  v_acc_open_date DATE;
  v_effective_start_date DATE;
  v_starting_capital NUMERIC(20, 2) := 0.00;
  v_prior_ending_balance NUMERIC(20, 2) := 0.00;
  v_prior_commissions NUMERIC(20, 2) := 0.00;
  v_eligible_deposits NUMERIC(20, 2) := 0.00;
  v_other_withdrawals NUMERIC(20, 2) := 0.00;
  v_raw_equity NUMERIC(20, 2) := 0.00;
  v_prior_year INT;
  v_prior_month INT;
  v_hist_ending NUMERIC(20, 2);
  v_start_year INT;
  v_start_month INT;
  v_is_first_period BOOLEAN := FALSE;
  v_inv_id TEXT;
BEGIN
  -- A. Validate Effective Date (Must be explicit first-of-month)
  IF p_effective_date IS NULL THEN
    RAISE EXCEPTION 'INVALID_EFFECTIVE_DATE: Effective date is required.';
  END IF;

  IF EXTRACT(DAY FROM p_effective_date) != 1 THEN
    RAISE EXCEPTION 'INVALID_EFFECTIVE_DATE: Effective date must be the first day of the month (YYYY-MM-01). Received: %', p_effective_date;
  END IF;

  v_target_year := EXTRACT(YEAR FROM p_effective_date)::INT;
  v_target_month := EXTRACT(MONTH FROM p_effective_date)::INT;

  -- B. Fetch Investor & Account Records
  SELECT id, start_date INTO v_inv_id, v_inv_start_date
  FROM investors
  WHERE id = p_investor_id;

  IF v_inv_id IS NULL THEN
    -- Try lookup by portal_username if ID lookup misses
    SELECT id, start_date INTO v_inv_id, v_inv_start_date
    FROM investors
    WHERE portal_username = p_investor_id
    LIMIT 1;
  END IF;

  IF v_inv_id IS NULL THEN
    RAISE EXCEPTION 'INVESTOR_NOT_FOUND: Investor % does not exist.', p_investor_id;
  END IF;

  p_investor_id := v_inv_id;

  -- Fetch Account
  IF p_account_id IS NOT NULL AND TRIM(p_account_id) != '' THEN
    SELECT
      COALESCE(starting_capital, 0.00),
      open_date
    INTO
      v_starting_capital,
      v_acc_open_date
    FROM investor_accounts
    WHERE investor_id = p_investor_id
      AND id::text = p_account_id
    LIMIT 1;
  ELSE
    SELECT
      COALESCE(starting_capital, 0.00),
      open_date
    INTO
      v_starting_capital,
      v_acc_open_date
    FROM investor_accounts
    WHERE investor_id = p_investor_id
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  v_starting_capital := COALESCE(v_starting_capital, 0.00);

  -- C. Resolve Start Date Precedence & Conflict Handling (Period Comparison)
  IF v_acc_open_date IS NOT NULL AND v_inv_start_date IS NOT NULL THEN
    IF EXTRACT(YEAR FROM v_acc_open_date) != EXTRACT(YEAR FROM v_inv_start_date)
       OR EXTRACT(MONTH FROM v_acc_open_date) != EXTRACT(MONTH FROM v_inv_start_date) THEN
      RAISE EXCEPTION 'ACCOUNT_START_DATE_CONFLICT: Account open period (%-%) conflicts with investor start period (%-%).',
        EXTRACT(YEAR FROM v_acc_open_date)::INT, EXTRACT(MONTH FROM v_acc_open_date)::INT,
        EXTRACT(YEAR FROM v_inv_start_date)::INT, EXTRACT(MONTH FROM v_inv_start_date)::INT;
    END IF;
    v_effective_start_date := v_acc_open_date;
  ELSE
    v_effective_start_date := COALESCE(v_acc_open_date, v_inv_start_date, '2026-01-01'::DATE);
  END IF;

  -- Pre-start check: If effective date is before start date, available equity is strictly $0.00
  IF p_effective_date < v_effective_start_date THEN
    RETURN 0.00;
  END IF;

  v_start_year := EXTRACT(YEAR FROM v_effective_start_date)::INT;
  v_start_month := EXTRACT(MONTH FROM v_effective_start_date)::INT;

  -- Determine if target period is the account's first active accounting period
  IF v_target_year = v_start_year AND v_target_month = v_start_month THEN
    v_is_first_period := TRUE;
  END IF;

  -- Prior Month Definition
  IF v_target_month = 1 THEN
    v_prior_year := v_target_year - 1;
    v_prior_month := 12;
  ELSE
    v_prior_year := v_target_year;
    v_prior_month := v_target_month - 1;
  END IF;

  -- D. Fail-Closed Prior Ending Balance Retrieval
  IF v_is_first_period THEN
    -- First period uses starting_capital as the canonical opening basis
    v_prior_ending_balance := v_starting_capital;
  ELSE
    -- Established account MUST have a recorded history row for immediately preceding month (N-1)
    SELECT ending_balance INTO v_hist_ending
    FROM investor_monthly_history
    WHERE investor_id = p_investor_id
      AND year = v_prior_year
      AND month_number = v_prior_month
    LIMIT 1;

    IF v_hist_ending IS NOT NULL THEN
      v_prior_ending_balance := v_hist_ending;
    ELSE
      -- Preceding month history missing on established account -> FAIL CLOSED
      RAISE EXCEPTION 'ACCOUNTING_HISTORY_INCOMPLETE: Required prior month history (%-%) is missing for established investor %.',
        v_prior_year, v_prior_month, p_investor_id;
    END IF;
  END IF;

  -- E. Prior Month Capitalized Incoming Commissions (N-1 -> N)
  SELECT COALESCE(SUM(amount), 0.00) INTO v_prior_commissions
  FROM commission_earnings
  WHERE recipient_id = p_investor_id
    AND year = v_prior_year
    AND month_number = v_prior_month;

  -- F. Eligible Deposits in Target Month (Excluding VOID)
  SELECT COALESCE(SUM(amount), 0.00) INTO v_eligible_deposits
  FROM deposits
  WHERE investor_id = p_investor_id
    AND (type IS NULL OR UPPER(TRIM(type)) != 'VOID')
    AND (
      (effective_accounting_date IS NOT NULL AND EXTRACT(YEAR FROM effective_accounting_date) = v_target_year AND EXTRACT(MONTH FROM effective_accounting_date) = v_target_month)
      OR
      (effective_accounting_date IS NULL AND date IS NOT NULL AND EXTRACT(YEAR FROM date) = v_target_year AND EXTRACT(MONTH FROM date) = v_target_month)
    );

  -- G. Other Active Withdrawals in Target Month (Pending, Approved, Completed)
  SELECT COALESCE(SUM(amount), 0.00) INTO v_other_withdrawals
  FROM withdrawals
  WHERE investor_id = p_investor_id
    AND (p_exclude_withdrawal_id IS NULL OR id::text != p_exclude_withdrawal_id::text)
    AND LOWER(TRIM(status)) IN ('pending', 'approved', 'completed')
    AND (
      (year = v_target_year AND month_number = v_target_month)
      OR
      (effective_accounting_date IS NOT NULL AND EXTRACT(YEAR FROM effective_accounting_date) = v_target_year AND EXTRACT(MONTH FROM effective_accounting_date) = v_target_month)
      OR
      (effective_accounting_date IS NULL AND request_date IS NOT NULL AND EXTRACT(YEAR FROM request_date) = v_target_year AND EXTRACT(MONTH FROM request_date) = v_target_month)
    );

  -- Net Available Equity Calculation
  v_raw_equity := v_prior_ending_balance + v_eligible_deposits + v_prior_commissions - v_other_withdrawals;

  IF v_raw_equity < 0.00 THEN
    RETURN 0.00;
  END IF;

  RETURN ROUND(v_raw_equity, 2);
END;
$$;


-- 4. ATOMIC WITHDRAWAL CREATION RPC WITH INVESTOR-SCOPED ADVISORY LOCK
CREATE OR REPLACE FUNCTION create_withdrawal_atomic(
  p_investor_id TEXT,
  p_account_id TEXT,
  p_amount NUMERIC(20, 2),
  p_effective_date DATE,
  p_status TEXT DEFAULT 'Pending',
  p_notes TEXT DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL,
  p_created_by TEXT DEFAULT NULL
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
        -- Idempotency key conflict
        RAISE EXCEPTION 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH: Key % was already used for investor % amount $%.', 
          p_idempotency_key, v_existing_investor, v_existing_amount;
      END IF;
    END IF;
  END IF;

  -- 3. CALCULATE AVAILABLE EQUITY (FAIL-CLOSED)
  v_available_equity := calculate_available_withdrawal_equity_sql(
    p_investor_id,
    p_account_id,
    p_effective_date,
    NULL
  );

  -- 4. EQUITY CONSTRAINT VALIDATION
  IF v_normalized_status IN ('Pending', 'Approved', 'Completed') THEN
    IF p_amount > v_available_equity THEN
      RAISE EXCEPTION 'WITHDRAWAL_EXCEEDS_AVAILABLE_EQUITY: Requested amount ($%) exceeds available account equity ($%) at effective date %.',
        TO_CHAR(p_amount, 'FM999,999,990.00'),
        TO_CHAR(v_available_equity, 'FM999,999,990.00'),
        p_effective_date;
    END IF;
  END IF;

  v_new_id := gen_random_uuid()::text;

  -- 5. ATOMIC INSERT
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


-- 5. ATOMIC WITHDRAWAL UPDATE RPC (PATCH)
CREATE OR REPLACE FUNCTION update_withdrawal_atomic(
  p_withdrawal_id TEXT,
  p_amount NUMERIC(20, 2) DEFAULT NULL,
  p_status TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_updated_by TEXT DEFAULT NULL
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

  -- 3. RECALCULATE AVAILABLE EQUITY (SELF-EXCLUDING CURRENT WITHDRAWAL)
  v_available_equity := calculate_available_withdrawal_equity_sql(
    v_current_wd.investor_id,
    v_current_wd.account_id,
    COALESCE(v_current_wd.effective_accounting_date, v_current_wd.request_date),
    p_withdrawal_id
  );

  -- 4. VALIDATE EQUITY IF ACTIVE STATUS
  IF v_target_status IN ('Pending', 'Approved', 'Completed') THEN
    IF v_target_amount > v_available_equity THEN
      RAISE EXCEPTION 'WITHDRAWAL_EXCEEDS_AVAILABLE_EQUITY: Updated amount ($%) exceeds available account equity ($%) at effective date %.',
        TO_CHAR(v_target_amount, 'FM999,999,990.00'),
        TO_CHAR(v_available_equity, 'FM999,999,990.00'),
        COALESCE(v_current_wd.effective_accounting_date, v_current_wd.request_date);
    END IF;
  END IF;

  -- 5. ATOMIC UPDATE
  UPDATE withdrawals
  SET
    amount = v_target_amount,
    status = v_target_status,
    notes = COALESCE(p_notes, notes),
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


-- 6. SECURITY & PERMISSIONS
REVOKE EXECUTE ON FUNCTION financial_lock_key(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION calculate_available_withdrawal_equity_sql(TEXT, TEXT, DATE, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION create_withdrawal_atomic(TEXT, TEXT, NUMERIC, DATE, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION update_withdrawal_atomic(TEXT, NUMERIC, TEXT, TEXT, TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION financial_lock_key(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION calculate_available_withdrawal_equity_sql(TEXT, TEXT, DATE, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION create_withdrawal_atomic(TEXT, TEXT, NUMERIC, DATE, TEXT, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION update_withdrawal_atomic(TEXT, NUMERIC, TEXT, TEXT, TEXT) TO service_role;
