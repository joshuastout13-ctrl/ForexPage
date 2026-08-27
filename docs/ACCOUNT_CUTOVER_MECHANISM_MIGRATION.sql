-- ==============================================================================
-- ACCOUNT CUTOVER MECHANISM SCHEMA MIGRATION
-- ==============================================================================
-- Target Database: julhldzkiqdeuuoqmvlo (Supabase Production — Stone Forex)
-- Purpose: Introduces durable, auditable cutover adjustment records and integrates
--          with Package B withdrawal equity validation.
-- ==============================================================================

BEGIN;

-- 1. CREATE ACCOUNT CUTOVER ADJUSTMENTS TABLE
CREATE TABLE IF NOT EXISTS account_cutover_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  investor_id TEXT NOT NULL REFERENCES investors(id) ON DELETE CASCADE,
  account_id TEXT REFERENCES investor_accounts(id) ON DELETE CASCADE,
  year INTEGER NOT NULL,
  month_number INTEGER NOT NULL CHECK (month_number BETWEEN 1 AND 12),
  effective_date DATE NOT NULL,
  authorized_opening_balance NUMERIC(20, 10) NOT NULL,
  prior_rollforward_balance NUMERIC(20, 10) NOT NULL,
  reason TEXT NOT NULL,
  authorization_reference TEXT NOT NULL,
  created_by TEXT DEFAULT 'system',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  idempotency_key TEXT UNIQUE,
  CONSTRAINT uq_account_cutover_period UNIQUE (investor_id, year, month_number)
);

CREATE INDEX IF NOT EXISTS idx_cutover_investor_period 
  ON account_cutover_adjustments(investor_id, year, month_number);

-- 2. ENABLE ROW LEVEL SECURITY & SERVICE POLICIES
ALTER TABLE account_cutover_adjustments ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies WHERE tablename = 'account_cutover_adjustments' AND policyname = 'service_role_all_cutover'
    ) THEN
      CREATE POLICY service_role_all_cutover 
        ON account_cutover_adjustments 
        FOR ALL 
        TO service_role 
        USING (true) 
        WITH CHECK (true);
    END IF;
  END IF;
END $$;

-- 3. UPGRADE calculate_available_withdrawal_equity_sql TO BE CUTOVER-AWARE
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
  v_cutover_balance NUMERIC(20, 10);
BEGIN
  -- A. Validate Effective Date
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
    SELECT COALESCE(starting_capital, 0.00), open_date
    INTO v_starting_capital, v_acc_open_date
    FROM investor_accounts
    WHERE investor_id = p_investor_id AND id::text = p_account_id
    LIMIT 1;
  ELSE
    SELECT COALESCE(starting_capital, 0.00), open_date
    INTO v_starting_capital, v_acc_open_date
    FROM investor_accounts
    WHERE investor_id = p_investor_id
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  v_starting_capital := COALESCE(v_starting_capital, 0.00);

  -- C. Resolve Start Date Precedence
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

  IF p_effective_date < v_effective_start_date THEN
    RETURN 0.00;
  END IF;

  v_start_year := EXTRACT(YEAR FROM v_effective_start_date)::INT;
  v_start_month := EXTRACT(MONTH FROM v_effective_start_date)::INT;

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
    v_prior_ending_balance := v_starting_capital;
  ELSE
    SELECT ending_balance INTO v_hist_ending
    FROM investor_monthly_history
    WHERE investor_id = p_investor_id
      AND year = v_prior_year
      AND month_number = v_prior_month
    LIMIT 1;

    IF v_hist_ending IS NOT NULL THEN
      v_prior_ending_balance := v_hist_ending;
    ELSE
      RAISE EXCEPTION 'ACCOUNTING_HISTORY_INCOMPLETE: Required prior month history (%-%) is missing for established investor %.',
        v_prior_year, v_prior_month, p_investor_id;
    END IF;
  END IF;

  -- E. Prior Month Capitalized Incoming Commissions (Only if not overridden by cutover)
  IF v_cutover_balance IS NULL THEN
    SELECT COALESCE(SUM(amount), 0.00) INTO v_prior_commissions
    FROM commission_earnings
    WHERE recipient_id = p_investor_id
      AND year = v_prior_year
      AND month_number = v_prior_month;
  ELSE
    v_prior_commissions := 0.00;
  END IF;

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

  -- G. Other Active Withdrawals in Target Month
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

COMMIT;
