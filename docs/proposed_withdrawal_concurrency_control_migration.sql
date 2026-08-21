-- =============================================================================
-- STONE & COMPANY FOREX FUND — PACKAGE B: WITHDRAWAL CONCURRENCY CONTROL
-- Status: CANDIDATE / STAGING READY (ZERO PRODUCTION WRITES EXECUTED)
-- =============================================================================

-- 1. ADD IDEMPOTENCY KEY TO WITHDRAWALS TABLE
ALTER TABLE withdrawals 
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS created_by TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_withdrawals_idempotency_key 
  ON withdrawals (idempotency_key) 
  WHERE idempotency_key IS NOT NULL;

-- 2. HELPER FUNCTION: INTERNAL AVAILABLE EQUITY CALCULATION (TRANSACTION-SAFE)
CREATE OR REPLACE FUNCTION calculate_available_withdrawal_equity_sql(
  p_investor_id TEXT,
  p_account_id TEXT,
  p_effective_date DATE,
  p_exclude_withdrawal_id UUID DEFAULT NULL
)
RETURNS NUMERIC(20, 2)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_target_year INT;
  v_target_month INT;
  v_account_start_date DATE;
  v_starting_capital NUMERIC(20, 2) := 0.00;
  v_prior_ending_balance NUMERIC(20, 2) := 0.00;
  v_prior_commissions NUMERIC(20, 2) := 0.00;
  v_eligible_deposits NUMERIC(20, 2) := 0.00;
  v_other_withdrawals NUMERIC(20, 2) := 0.00;
  v_raw_equity NUMERIC(20, 2) := 0.00;
  v_prior_year INT;
  v_prior_month INT;
  v_hist_ending NUMERIC(20, 2);
  v_account_exists BOOLEAN := FALSE;
BEGIN
  -- Extract Year and Month
  v_target_year := EXTRACT(YEAR FROM p_effective_date)::INT;
  v_target_month := EXTRACT(MONTH FROM p_effective_date)::INT;

  -- Verify Account and Starting Capital
  SELECT 
    TRUE,
    COALESCE(starting_capital, 0.00),
    COALESCE(open_date, '2026-01-01'::DATE)
  INTO 
    v_account_exists,
    v_starting_capital,
    v_account_start_date
  FROM investor_accounts
  WHERE investor_id = p_investor_id 
    AND (id = p_account_id OR account_id = p_account_id)
  LIMIT 1;

  IF NOT v_account_exists THEN
    -- Fallback to first account of investor
    SELECT 
      TRUE,
      COALESCE(starting_capital, 0.00),
      COALESCE(open_date, '2026-01-01'::DATE)
    INTO 
      v_account_exists,
      v_starting_capital,
      v_account_start_date
    FROM investor_accounts
    WHERE investor_id = p_investor_id
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  -- If still no account, check investor start date
  IF NOT v_account_exists THEN
    SELECT COALESCE(start_date, '2026-01-01'::DATE)
    INTO v_account_start_date
    FROM investors
    WHERE id = p_investor_id;
  END IF;

  -- Start Date Validation
  IF p_effective_date < v_account_start_date THEN
    RETURN 0.00;
  END IF;

  -- Prior Month Definition
  IF v_target_month = 1 THEN
    v_prior_year := v_target_year - 1;
    v_prior_month := 12;
  ELSE
    v_prior_year := v_target_year;
    v_prior_month := v_target_month - 1;
  END IF;

  -- 1. Prior Month Ending Balance
  SELECT ending_balance INTO v_hist_ending
  FROM investor_monthly_history
  WHERE investor_id = p_investor_id
    AND year = v_prior_year
    AND month_number = v_prior_month
  LIMIT 1;

  IF v_hist_ending IS NOT NULL THEN
    v_prior_ending_balance := v_hist_ending;
  ELSE
    -- Check latest earlier history
    SELECT ending_balance INTO v_hist_ending
    FROM investor_monthly_history
    WHERE investor_id = p_investor_id
      AND (year < v_target_year OR (year = v_target_year AND month_number < v_target_month))
    ORDER BY year DESC, month_number DESC
    LIMIT 1;

    IF v_hist_ending IS NOT NULL THEN
      v_prior_ending_balance := v_hist_ending;
    ELSE
      v_prior_ending_balance := v_starting_capital;
    END IF;
  END IF;

  -- 2. Prior Month Capitalized Commissions (N -> N+1)
  SELECT COALESCE(SUM(amount), 0.00) INTO v_prior_commissions
  FROM commission_earnings
  WHERE recipient_id = p_investor_id
    AND year = v_prior_year
    AND month_number = v_prior_month;

  -- 3. Eligible Deposits in Target Month (excluding VOID)
  SELECT COALESCE(SUM(amount), 0.00) INTO v_eligible_deposits
  FROM deposits
  WHERE investor_id = p_investor_id
    AND (type IS NULL OR UPPER(TRIM(type)) != 'VOID')
    AND (
      (effective_accounting_date IS NOT NULL AND EXTRACT(YEAR FROM effective_accounting_date) = v_target_year AND EXTRACT(MONTH FROM effective_accounting_date) = v_target_month)
      OR
      (effective_accounting_date IS NULL AND date IS NOT NULL AND EXTRACT(YEAR FROM date) = v_target_year AND EXTRACT(MONTH FROM date) = v_target_month)
    );

  -- 4. Active Other Withdrawals in Target Month (Pending, Approved, Completed)
  SELECT COALESCE(SUM(amount), 0.00) INTO v_other_withdrawals
  FROM withdrawals
  WHERE investor_id = p_investor_id
    AND (p_exclude_withdrawal_id IS NULL OR id != p_exclude_withdrawal_id)
    AND LOWER(TRIM(status)) IN ('pending', 'approved', 'completed')
    AND (
      (year = v_target_year AND month_number = v_target_month)
      OR
      (effective_accounting_date IS NOT NULL AND EXTRACT(YEAR FROM effective_accounting_date) = v_target_year AND EXTRACT(MONTH FROM effective_accounting_date) = v_target_month)
      OR
      (effective_accounting_date IS NULL AND request_date IS NOT NULL AND EXTRACT(YEAR FROM request_date) = v_target_year AND EXTRACT(MONTH FROM request_date) = v_target_month)
    );

  -- Calculate Net Available Equity
  v_raw_equity := v_prior_ending_balance + v_eligible_deposits + v_prior_commissions - v_other_withdrawals;

  IF v_raw_equity < 0.00 THEN
    RETURN 0.00;
  END IF;

  RETURN ROUND(v_raw_equity, 2);
END;
$$;


-- 3. ATOMIC WITHDRAWAL CREATION RPC WITH INVESTOR-SCOPED ADVISORY LOCK
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
AS $$
DECLARE
  v_lock_key BIGINT;
  v_available_equity NUMERIC(20, 2);
  v_existing_id UUID;
  v_existing_amount NUMERIC(20, 2);
  v_existing_investor TEXT;
  v_normalized_status TEXT;
  v_target_year INT;
  v_target_month INT;
  v_new_withdrawal RECORD;
BEGIN
  -- Normalize & Validate Status
  v_normalized_status := INITCAP(TRIM(COALESCE(p_status, 'Pending')));
  IF v_normalized_status NOT IN ('Pending', 'Approved', 'Completed', 'Cancelled', 'Void') THEN
    RAISE EXCEPTION 'INVALID_WITHDRAWAL_STATUS: Status must be Pending, Approved, Completed, Cancelled, or Void. Received: %', p_status;
  END IF;

  -- Validate Amount
  IF p_amount IS NULL OR p_amount <= 0.00 THEN
    RAISE EXCEPTION 'INVALID_WITHDRAWAL_AMOUNT: Amount must be strictly greater than $0.00. Received: %', p_amount;
  END IF;

  -- Validate Effective Date
  IF p_effective_date IS NULL THEN
    RAISE EXCEPTION 'INVALID_EFFECTIVE_DATE: Effective date is required.';
  END IF;

  v_target_year := EXTRACT(YEAR FROM p_effective_date)::INT;
  v_target_month := EXTRACT(MONTH FROM p_effective_date)::INT;

  -- 1. ACQUIRE INVESTOR-SCOPED TRANSACTIONAL ADVISORY LOCK
  -- Scoped narrowly to investor_id hash so concurrent requests on other investors proceed in parallel
  v_lock_key := ('x' || substr(md5(p_investor_id), 1, 16))::bit(64)::bigint;
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- 2. IDEMPOTENCY CHECK
  IF p_idempotency_key IS NOT NULL AND TRIM(p_idempotency_key) != '' THEN
    SELECT id, amount, investor_id INTO v_existing_id, v_existing_amount, v_existing_investor
    FROM withdrawals
    WHERE idempotency_key = TRIM(p_idempotency_key)
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      -- If same parameters, return existing record (Idempotent Replay)
      IF v_existing_investor = p_investor_id AND v_existing_amount = p_amount THEN
        SELECT * INTO v_new_withdrawal FROM withdrawals WHERE id = v_existing_id;
        RETURN jsonb_build_object(
          'status', 'IDEMPOTENT_REPLAY',
          'withdrawal', to_jsonb(v_new_withdrawal),
          'message', 'Request already processed with identical idempotency key.'
        );
      ELSE
        -- Idempotency key reused with differing parameters -> Conflict
        RAISE EXCEPTION 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH: Key % was already used for investor % amount $%.', 
          p_idempotency_key, v_existing_investor, v_existing_amount;
      END IF;
    END IF;
  END IF;

  -- 3. CALCULATE AVAILABLE EQUITY INSIDE TRANSACTION
  v_available_equity := calculate_available_withdrawal_equity_sql(
    p_investor_id,
    p_account_id,
    p_effective_date,
    NULL
  );

  -- 4. EQUITY CONSTRAINT VALIDATION
  IF p_amount > v_available_equity THEN
    RAISE EXCEPTION 'WITHDRAWAL_EXCEEDS_AVAILABLE_EQUITY: Requested amount ($%) exceeds available account equity ($%) at effective date %.',
      TO_CHAR(p_amount, 'FM999,999,990.00'),
      TO_CHAR(v_available_equity, 'FM999,999,990.00'),
      p_effective_date;
  END IF;

  -- 5. ATOMIC INSERT
  INSERT INTO withdrawals (
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
    'availableEquityBefore', v_available_equity,
    'availableEquityAfter', v_available_equity - p_amount,
    'withdrawal', to_jsonb(v_new_withdrawal)
  );
END;
$$;


-- 4. ATOMIC WITHDRAWAL UPDATE RPC (PATCH)
CREATE OR REPLACE FUNCTION update_withdrawal_atomic(
  p_withdrawal_id UUID,
  p_amount NUMERIC(20, 2) DEFAULT NULL,
  p_status TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_updated_by TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current_wd RECORD;
  v_lock_key BIGINT;
  v_target_amount NUMERIC(20, 2);
  v_target_status TEXT;
  v_available_equity NUMERIC(20, 2);
  v_updated_withdrawal RECORD;
BEGIN
  -- 1. Fetch current withdrawal
  SELECT * INTO v_current_wd
  FROM withdrawals
  WHERE id = p_withdrawal_id;

  IF v_current_wd.id IS NULL THEN
    RAISE EXCEPTION 'WITHDRAWAL_NOT_FOUND: Withdrawal % does not exist.', p_withdrawal_id;
  END IF;

  -- 2. ACQUIRE INVESTOR-SCOPED TRANSACTIONAL ADVISORY LOCK
  v_lock_key := ('x' || substr(md5(v_current_wd.investor_id), 1, 16))::bit(64)::bigint;
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- Determine target amount & status
  v_target_amount := COALESCE(p_amount, v_current_wd.amount);
  v_target_status := INITCAP(TRIM(COALESCE(p_status, v_current_wd.status)));

  IF v_target_status NOT IN ('Pending', 'Approved', 'Completed', 'Cancelled', 'Void') THEN
    RAISE EXCEPTION 'INVALID_WITHDRAWAL_STATUS: Status must be Pending, Approved, Completed, Cancelled, or Void. Received: %', p_status;
  END IF;

  IF v_target_amount <= 0.00 THEN
    RAISE EXCEPTION 'INVALID_WITHDRAWAL_AMOUNT: Amount must be strictly greater than $0.00. Received: %', v_target_amount;
  END IF;

  -- 3. RECALCULATE AVAILABLE EQUITY (EXCLUDING THIS WITHDRAWAL)
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
  WHERE id = p_withdrawal_id
  RETURNING * INTO v_updated_withdrawal;

  RETURN jsonb_build_object(
    'status', 'SUCCESS',
    'availableEquityBefore', v_available_equity,
    'availableEquityAfter', v_available_equity - v_target_amount,
    'withdrawal', to_jsonb(v_updated_withdrawal)
  );
END;
$$;
