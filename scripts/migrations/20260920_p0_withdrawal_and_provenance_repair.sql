-- =============================================================================
-- Migration: P0 Withdrawal Edit RPC Repair & External Cash Provenance Certification
-- Target: Supabase PostgreSQL (Production Project: julhldzkiqdeuuoqmvlo)
-- Date: 2026-09-20
--
-- Rationale:
-- 1. Adds updated_by column to withdrawals table so update_withdrawal_atomic
--    can persist the audit actor without throwing ERROR 42703 (undefined column).
-- 2. Canonicalizes update_withdrawal_atomic to safely update withdrawal records
--    and correctly persist updated_by and updated_at under investor advisory lock.
-- 3. Adds auditable external cash provenance columns to investor_accounts:
--    - external_cash_provenance_status (UNKNOWN | PARTIAL | COMPLETE)
--    - provenance_certified_at
--    - provenance_certified_by
--    - provenance_certification_notes
-- 4. Initial seed: Accounts with active verified deposits are marked 'PARTIAL'.
--    Accounts without verified deposits are marked 'UNKNOWN'.
--    NO ACCOUNT IS MARKED 'COMPLETE' AUTOMATICALLY.
-- 5. Adds atomic RPC certify_account_external_cash_provenance for explicit admin audit.
-- =============================================================================

-- 1. ADD updated_by COLUMN TO WITHDRAWALS
ALTER TABLE public.withdrawals ADD COLUMN IF NOT EXISTS updated_by TEXT;

-- 2. DROP OBSOLETE OVERLOADS TO PREVENT 42725 AMBIGUITY
DROP FUNCTION IF EXISTS public.update_withdrawal_atomic(TEXT, NUMERIC, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.update_withdrawal_atomic(UUID, NUMERIC, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.update_withdrawal_atomic(TEXT, NUMERIC, TEXT, TEXT, TEXT, DATE, INT, INT, TEXT);

-- 3. CREATE CANONICAL update_withdrawal_atomic (9 Parameters)
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

  -- 5. ATOMIC UPDATE (with updated_by and updated_at)
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

REVOKE ALL ON FUNCTION public.update_withdrawal_atomic(TEXT, NUMERIC, TEXT, TEXT, TEXT, DATE, INT, INT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_withdrawal_atomic(TEXT, NUMERIC, TEXT, TEXT, TEXT, DATE, INT, INT, TEXT) TO service_role;


-- 4. ADD PROVENANCE CERTIFICATION COLUMNS TO INVESTOR_ACCOUNTS
ALTER TABLE public.investor_accounts
  ADD COLUMN IF NOT EXISTS external_cash_provenance_status TEXT DEFAULT 'UNKNOWN',
  ADD COLUMN IF NOT EXISTS provenance_certified_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS provenance_certified_by TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS provenance_certification_notes TEXT DEFAULT NULL;

-- Ensure check constraint on provenance status
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_investor_accounts_provenance_status'
  ) THEN
    ALTER TABLE public.investor_accounts
      ADD CONSTRAINT chk_investor_accounts_provenance_status
      CHECK (external_cash_provenance_status IN ('UNKNOWN', 'PARTIAL', 'COMPLETE'));
  END IF;
END $$;

-- Seed existing accounts safely:
-- Accounts with confirmed external cash records become 'PARTIAL' (in verification).
-- Accounts with 0 confirmed records become 'UNKNOWN'.
-- NO ACCOUNT IS AUTOMATICALLY SET TO 'COMPLETE'.
UPDATE public.investor_accounts ia
SET external_cash_provenance_status = CASE
  WHEN EXISTS (
    SELECT 1 FROM public.deposits d
    WHERE d.account_id = ia.id
      AND d.status = 'confirmed'
      AND d.accounting_treatment IN ('NEW_CASH', 'HISTORICAL_PROVENANCE')
      AND d.amount > 0
  ) THEN 'PARTIAL'
  ELSE 'UNKNOWN'
END
WHERE external_cash_provenance_status IS NULL OR external_cash_provenance_status NOT IN ('PARTIAL', 'COMPLETE');


-- 5. RPC FOR AUDITABLE PROVENANCE CERTIFICATION
CREATE OR REPLACE FUNCTION public.certify_account_external_cash_provenance(
  p_account_id TEXT,
  p_status TEXT,
  p_notes TEXT DEFAULT NULL,
  p_certified_by TEXT DEFAULT 'admin'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_acc RECORD;
  v_target_status TEXT;
  v_updated_acc RECORD;
  v_confirmed_deposits_count INT;
  v_confirmed_cash_total NUMERIC(20, 2);
BEGIN
  -- 1. Fetch account with row lock
  SELECT * INTO v_acc
  FROM public.investor_accounts
  WHERE id::text = p_account_id::text
  FOR UPDATE;

  IF v_acc.id IS NULL THEN
    RAISE EXCEPTION 'ACCOUNT_NOT_FOUND: Investor account % does not exist.', p_account_id;
  END IF;

  v_target_status := UPPER(TRIM(COALESCE(p_status, '')));
  IF v_target_status NOT IN ('UNKNOWN', 'PARTIAL', 'COMPLETE') THEN
    RAISE EXCEPTION 'INVALID_PROVENANCE_STATUS: Status must be UNKNOWN, PARTIAL, or COMPLETE. Received: %', p_status;
  END IF;

  -- 2. Count verified deposits
  SELECT 
    COUNT(*), 
    COALESCE(SUM(amount), 0.00)
  INTO 
    v_confirmed_deposits_count, 
    v_confirmed_cash_total
  FROM public.deposits
  WHERE account_id = v_acc.id
    AND status = 'confirmed'
    AND accounting_treatment IN ('NEW_CASH', 'HISTORICAL_PROVENANCE')
    AND amount > 0;

  -- 3. If certifying as COMPLETE, require at least one confirmed external cash record
  IF v_target_status = 'COMPLETE' AND v_confirmed_deposits_count = 0 THEN
    RAISE EXCEPTION 'CANNOT_CERTIFY_EMPTY_PROVENANCE: Cannot certify account % as COMPLETE because zero confirmed external cash records exist.', p_account_id;
  END IF;

  -- 4. Update certification
  UPDATE public.investor_accounts
  SET
    external_cash_provenance_status = v_target_status,
    provenance_certified_at = CASE WHEN v_target_status = 'COMPLETE' THEN NOW() ELSE NULL END,
    provenance_certified_by = CASE WHEN v_target_status = 'COMPLETE' THEN COALESCE(p_certified_by, 'admin') ELSE NULL END,
    provenance_certification_notes = p_notes,
    updated_at = NOW()
  WHERE id = v_acc.id
  RETURNING * INTO v_updated_acc;

  RETURN jsonb_build_object(
    'status', 'SUCCESS',
    'account_id', v_updated_acc.id,
    'external_cash_provenance_status', v_updated_acc.external_cash_provenance_status,
    'provenance_certified_at', v_updated_acc.provenance_certified_at,
    'provenance_certified_by', v_updated_acc.provenance_certified_by,
    'provenance_certification_notes', v_updated_acc.provenance_certification_notes,
    'confirmed_deposits_count', v_confirmed_deposits_count,
    'confirmed_cash_total', v_confirmed_cash_total
  );
END;
$$;

REVOKE ALL ON FUNCTION public.certify_account_external_cash_provenance(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.certify_account_external_cash_provenance(TEXT, TEXT, TEXT, TEXT) TO service_role;

-- 6. RELOAD POSTGREST SCHEMA CACHE
NOTIFY pgrst, 'reload schema';
