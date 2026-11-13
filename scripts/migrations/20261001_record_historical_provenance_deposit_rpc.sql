-- =============================================================================
-- Migration: Canonical Atomic RPC for Recording Historical Provenance Deposits
-- Target: Supabase PostgreSQL (Production Project: julhldzkiqdeuuoqmvlo)
-- Date: 2026-10-01
--
-- Rationale:
-- 1. Provides a canonical, atomic, and audited RPC for establishing confirmed
--    historical external cash provenance without direct table manipulation.
-- 2. Strictly enforces accounting_treatment = 'HISTORICAL_PROVENANCE' (no balance mutation).
-- 3. Idempotent execution with mandatory idempotency key and advisory-locked duplicate guard.
-- 4. Fail-closed error handling with row locks on investor_accounts and investor advisory locks.
-- 5. Service-role only execution (REVOKE ALL FROM PUBLIC; GRANT TO service_role).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.record_historical_provenance_deposit_atomic(
  p_account_id TEXT,
  p_amount NUMERIC(20, 2),
  p_effective_date DATE DEFAULT NULL,
  p_date DATE DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_created_by TEXT DEFAULT 'admin',
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_acc RECORD;
  v_lock_key BIGINT;
  v_new_id TEXT;
  v_existing_dep RECORD;
  v_new_deposit RECORD;
  v_target_effective_date DATE;
  v_target_date DATE;
BEGIN
  -- 1. Validate Amount
  IF p_amount IS NULL OR p_amount <= 0.00 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: Amount must be strictly greater than $0.00. Received: %', p_amount;
  END IF;

  -- 2. Lookup target account and acquire row lock
  SELECT * INTO v_acc
  FROM public.investor_accounts
  WHERE id::text = p_account_id::text
  FOR UPDATE;

  IF v_acc.id IS NULL THEN
    RAISE EXCEPTION 'ACCOUNT_NOT_FOUND: Investor account % does not exist.', p_account_id;
  END IF;

  -- 3. Acquire investor advisory lock
  v_lock_key := public.financial_lock_key(v_acc.investor_id);
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- 4. Idempotency Key Validation & Check
  IF p_idempotency_key IS NULL OR TRIM(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'MISSING_IDEMPOTENCY_KEY: p_idempotency_key is mandatory for historical provenance creation.';
  END IF;

  SELECT * INTO v_existing_dep
  FROM public.deposits
  WHERE idempotency_key = TRIM(p_idempotency_key);

  IF v_existing_dep.id IS NOT NULL THEN
    -- Verify existing matches target account & amount (idempotent replay)
    IF v_existing_dep.account_id != v_acc.id OR v_existing_dep.amount != p_amount THEN
      RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT: Key % already exists with conflicting account % or amount %',
        p_idempotency_key, v_existing_dep.account_id, v_existing_dep.amount;
    END IF;

    RETURN jsonb_build_object(
      'status', 'SUCCESS',
      'idempotency_replay', TRUE,
      'deposit_id', v_existing_dep.id,
      'account_id', v_acc.id,
      'investor_id', v_acc.investor_id,
      'amount', v_existing_dep.amount,
      'accounting_treatment', v_existing_dep.accounting_treatment,
      'deposit', to_jsonb(v_existing_dep)
    );
  END IF;

  -- 5. Economic Duplicate Guard
  -- Check if confirmed HISTORICAL_PROVENANCE record already exists for this account & amount
  SELECT * INTO v_existing_dep
  FROM public.deposits
  WHERE account_id = v_acc.id
    AND status = 'confirmed'
    AND accounting_treatment = 'HISTORICAL_PROVENANCE'
    AND amount = p_amount;

  IF v_existing_dep.id IS NOT NULL THEN
    RAISE EXCEPTION 'DUPLICATE_HISTORICAL_PROVENANCE: Confirmed historical provenance of $% already exists on account % (id: %)',
      p_amount, v_acc.id, v_existing_dep.id;
  END IF;

  -- 6. Date Normalization (first-of-month if effective date provided)
  v_target_effective_date := p_effective_date;
  IF v_target_effective_date IS NOT NULL AND EXTRACT(DAY FROM v_target_effective_date) != 1 THEN
    v_target_effective_date := DATE_TRUNC('month', v_target_effective_date)::DATE;
  END IF;
  v_target_date := p_date;

  -- 7. Generate deterministic/safe ID
  v_new_id := 'dep_' || LOWER(SUBSTRING(v_acc.id FROM 1 FOR 12)) || '_hp_' || SUBSTRING(MD5(p_idempotency_key) FROM 1 FOR 8);

  -- 8. Atomic Insert (HISTORICAL_PROVENANCE only, confirmed, no balance mutation)
  INSERT INTO public.deposits (
    id,
    investor_id,
    account_id,
    amount,
    date,
    effective_accounting_date,
    status,
    accounting_treatment,
    type,
    notes,
    created_by,
    idempotency_key,
    created_at,
    updated_at
  ) VALUES (
    v_new_id,
    v_acc.investor_id,
    v_acc.id,
    p_amount,
    v_target_date,
    v_target_effective_date,
    'confirmed',
    'HISTORICAL_PROVENANCE',
    'Historical Outside Cash',
    COALESCE(p_notes, 'Confirmed historical external cash contribution'),
    COALESCE(p_created_by, 'admin'),
    TRIM(p_idempotency_key),
    NOW(),
    NOW()
  )
  RETURNING * INTO v_new_deposit;

  RETURN jsonb_build_object(
    'status', 'SUCCESS',
    'idempotency_replay', FALSE,
    'deposit_id', v_new_deposit.id,
    'account_id', v_acc.id,
    'investor_id', v_acc.investor_id,
    'amount', v_new_deposit.amount,
    'accounting_treatment', v_new_deposit.accounting_treatment,
    'deposit', to_jsonb(v_new_deposit)
  );
END;
$$;

-- Secure Execution Permissions:
REVOKE ALL ON FUNCTION public.record_historical_provenance_deposit_atomic(TEXT, NUMERIC, DATE, DATE, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_historical_provenance_deposit_atomic(TEXT, NUMERIC, DATE, DATE, TEXT, TEXT, TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';
