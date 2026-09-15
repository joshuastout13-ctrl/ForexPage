-- =============================================================================
-- Migration: Fix Start-Date Conflict Validation in calculate_available_withdrawal_equity_sql
-- Target: Supabase PostgreSQL (Production Project: julhldzkiqdeuuoqmvlo)
-- Date: 2026-09-11
--
-- Rationale:
-- 1. Replaces rigid period-equality gate (investor_accounts.open_date == investors.start_date)
--    with an authoritative accounting eligibility gate (effective_date >= authoritativeAccountingStart).
-- 2. Prevents blocking legitimate prospective withdrawals for mid-year onboarded investors (e.g. Mark Richards).
-- 3. Strictly preserves fail-closed boundary protection against genuinely pre-start withdrawals (returning $0.00).
-- 4. Emits a non-fatal diagnostic warning (RAISE WARNING) if metadata dates differ across accounting periods.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.calculate_available_withdrawal_equity_sql(
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
  v_cutover_balance NUMERIC(20, 2);
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

  -- C. Resolve Authoritative Accounting Start Date & Handle Boundary
  v_effective_start_date := COALESCE(v_inv_start_date, v_acc_open_date, '2026-01-01'::DATE);

  -- 1. Pre-start check: If effective date is before authoritative start date, available equity is strictly $0.00
  IF p_effective_date < v_effective_start_date THEN
    RETURN 0.00;
  END IF;

  -- 2. Non-fatal diagnostic audit warning if metadata dates disagree across accounting periods
  IF v_acc_open_date IS NOT NULL AND v_inv_start_date IS NOT NULL THEN
    IF EXTRACT(YEAR FROM v_acc_open_date) != EXTRACT(YEAR FROM v_inv_start_date)
       OR EXTRACT(MONTH FROM v_acc_open_date) != EXTRACT(MONTH FROM v_inv_start_date) THEN
      RAISE WARNING 'METADATA_START_DATE_DISCREPANCY: Account open period (%-%) differs from investor start period (%-%) for investor %.',
        EXTRACT(YEAR FROM v_acc_open_date)::INT, EXTRACT(MONTH FROM v_acc_open_date)::INT,
        EXTRACT(YEAR FROM v_inv_start_date)::INT, EXTRACT(MONTH FROM v_inv_start_date)::INT,
        p_investor_id;
    END IF;
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

  -- D. Check for Authorized Cutover Adjustment FIRST
  SELECT authorized_opening_balance INTO v_cutover_balance
  FROM account_cutover_adjustments
  WHERE investor_id = p_investor_id
    AND year = v_target_year
    AND month_number = v_target_month
  LIMIT 1;

  IF v_cutover_balance IS NOT NULL THEN
    -- Authoritative Cutover Replaces Prior Ending
    v_prior_ending_balance := ROUND(v_cutover_balance, 2);
  ELSIF v_is_first_period THEN
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

-- Notify PostgREST to reload schema cache
NOTIFY pgrst, 'reload schema';
