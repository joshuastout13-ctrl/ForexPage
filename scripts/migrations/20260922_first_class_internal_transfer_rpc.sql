-- =============================================================================
-- Migration: First-Class Internal Transfer Execution and Void RPCs (Canonical)
-- Target: Supabase PostgreSQL (Project: julhldzkiqdeuuoqmvlo)
-- Date: 2026-09-22
-- =============================================================================

-- 1. Create the transfer number sequence if not already present
CREATE SEQUENCE IF NOT EXISTS internal_transfer_seq START WITH 1;
GRANT USAGE, SELECT ON SEQUENCE internal_transfer_seq TO authenticated, service_role;

-- 2. Ensure deposits table check constraint permits 'INTERNAL_TRANSFER'
ALTER TABLE deposits DROP CONSTRAINT IF EXISTS deposits_accounting_treatment_check;
ALTER TABLE deposits ADD CONSTRAINT deposits_accounting_treatment_check 
  CHECK (accounting_treatment = ANY (ARRAY['NEW_CASH'::text, 'HISTORICAL_PROVENANCE'::text, 'UNVERIFIED_LEGACY'::text, 'INTERNAL_TRANSFER'::text]));

-- 3. Create or replace the canonical atomic transfer execution RPC
CREATE OR REPLACE FUNCTION public.execute_internal_transfer_atomic(
  p_source_account_id TEXT,
  p_target_account_id TEXT,
  p_amount NUMERIC,
  p_effective_date DATE,
  p_purpose TEXT,
  p_notes TEXT,
  p_idempotency_key TEXT,
  p_created_by TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_source_rec RECORD;
  v_target_rec RECORD;
  v_source_inv_id TEXT;
  v_target_inv_id TEXT;
  v_source_equity NUMERIC;
  v_transfer_id UUID;
  v_transfer_num TEXT;
  v_canonical_date DATE;
  v_year INT;
  v_month_num INT;
  v_month_name TEXT;
BEGIN
  -- Input validations
  IF p_source_account_id IS NULL OR TRIM(p_source_account_id) = '' THEN
    RAISE EXCEPTION 'MISSING_SOURCE_ACCOUNT: Source account ID is required.';
  END IF;

  IF p_target_account_id IS NULL OR TRIM(p_target_account_id) = '' THEN
    RAISE EXCEPTION 'MISSING_TARGET_ACCOUNT: Target account ID is required.';
  END IF;

  IF p_source_account_id = p_target_account_id THEN
    RAISE EXCEPTION 'SOURCE_TARGET_IDENTICAL: Source and target accounts cannot be the same.';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: Transfer amount must be greater than zero.';
  END IF;

  IF p_idempotency_key IS NULL OR TRIM(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'MISSING_IDEMPOTENCY_KEY: Idempotency key is required.';
  END IF;

  IF p_effective_date IS NULL THEN
    RAISE EXCEPTION 'MISSING_EFFECTIVE_DATE: Effective date is required.';
  END IF;

  -- Canonicalize effective date to first day of the effective month (YYYY-MM-01)
  v_canonical_date := DATE_TRUNC('month', p_effective_date)::DATE;
  v_year := EXTRACT(YEAR FROM v_canonical_date)::INT;
  v_month_num := EXTRACT(MONTH FROM v_canonical_date)::INT;
  v_month_name := TO_CHAR(v_canonical_date, 'Month');

  -- 1. Deterministic lock ordering to prevent deadlocks
  IF p_source_account_id < p_target_account_id THEN
    PERFORM pg_advisory_xact_lock(hashtext(p_source_account_id));
    PERFORM pg_advisory_xact_lock(hashtext(p_target_account_id));
  ELSE
    PERFORM pg_advisory_xact_lock(hashtext(p_target_account_id));
    PERFORM pg_advisory_xact_lock(hashtext(p_source_account_id));
  END IF;

  -- 2. Check Idempotency
  SELECT id, transfer_number INTO v_transfer_id, v_transfer_num 
  FROM internal_transfers 
  WHERE idempotency_key = p_idempotency_key;
  
  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', true, 
      'transfer_id', v_transfer_id, 
      'transfer_number', v_transfer_num, 
      'idempotent_replay', true
    );
  END IF;

  -- 3. Resolve and validate investor accounts server-side
  SELECT id, investor_id, status INTO v_source_rec FROM investor_accounts WHERE id = p_source_account_id;
  IF NOT FOUND OR v_source_rec.id IS NULL THEN
    RAISE EXCEPTION 'SOURCE_ACCOUNT_NOT_FOUND: Investor account % does not exist.', p_source_account_id;
  END IF;
  IF v_source_rec.status IS DISTINCT FROM 'Active' THEN
    RAISE EXCEPTION 'SOURCE_ACCOUNT_INACTIVE: Investor account % is not active (status: %).', p_source_account_id, v_source_rec.status;
  END IF;

  SELECT id, investor_id, status INTO v_target_rec FROM investor_accounts WHERE id = p_target_account_id;
  IF NOT FOUND OR v_target_rec.id IS NULL THEN
    RAISE EXCEPTION 'TARGET_ACCOUNT_NOT_FOUND: Investor account % does not exist.', p_target_account_id;
  END IF;
  IF v_target_rec.status IS DISTINCT FROM 'Active' THEN
    RAISE EXCEPTION 'TARGET_ACCOUNT_INACTIVE: Investor account % is not active (status: %).', p_target_account_id, v_target_rec.status;
  END IF;

  v_source_inv_id := v_source_rec.investor_id;
  v_target_inv_id := v_target_rec.investor_id;

  -- 4. Fail-closed equity validation on source account
  v_source_equity := calculate_available_withdrawal_equity_sql(
    v_source_inv_id,
    p_source_account_id,
    v_canonical_date,
    NULL
  );

  IF v_source_equity IS NULL OR p_amount > v_source_equity THEN
    RAISE EXCEPTION 'TRANSFER_EXCEEDS_SOURCE_EQUITY: Requested amount ($%) exceeds available equity ($%) on source account %',
      TO_CHAR(p_amount, 'FM999,999,990.00'),
      TO_CHAR(COALESCE(v_source_equity, 0), 'FM999,999,990.00'),
      p_source_account_id;
  END IF;

  -- 5. Derive transfer number
  v_transfer_num := 'XFER-' || v_year || '-' || LPAD(nextval('internal_transfer_seq')::TEXT, 5, '0');

  -- 6. Insert Master Transfer Record
  INSERT INTO internal_transfers (
    transfer_number, source_investor_id, source_account_id, target_investor_id, target_account_id,
    amount, effective_accounting_date, year, month_number, month, status, purpose, notes, idempotency_key, created_by
  ) VALUES (
    v_transfer_num, v_source_inv_id, p_source_account_id, v_target_inv_id, p_target_account_id,
    p_amount, v_canonical_date, v_year, v_month_num, TRIM(v_month_name), 'confirmed', p_purpose, p_notes, p_idempotency_key, p_created_by
  ) RETURNING id INTO v_transfer_id;

  -- 7. Insert Linked Source Debit Leg (Withdrawal)
  INSERT INTO withdrawals (
    id, investor_id, account_id, amount, status, request_date, effective_accounting_date,
    year, month_number, month, notes, transfer_id, transfer_leg, created_by
  ) VALUES (
    gen_random_uuid()::text, v_source_inv_id, p_source_account_id, p_amount, 'Completed', p_effective_date, v_canonical_date,
    v_year, v_month_num, TRIM(v_month_name), COALESCE(p_notes, 'Internal transfer to ' || p_target_account_id), v_transfer_id, 'DEBIT', p_created_by
  );

  -- 8. Insert Linked Target Credit Leg (Deposit)
  INSERT INTO deposits (
    id, investor_id, account_id, amount, status, date, effective_accounting_date,
    type, accounting_treatment, transfer_id, transfer_leg, notes, created_by
  ) VALUES (
    gen_random_uuid()::text, v_target_inv_id, p_target_account_id, p_amount, 'confirmed', p_effective_date, v_canonical_date,
    'Internal Transfer', 'INTERNAL_TRANSFER', v_transfer_id, 'CREDIT', COALESCE(p_notes, 'Internal transfer from ' || p_source_account_id), p_created_by
  );

  RETURN jsonb_build_object(
    'success', true, 
    'transfer_id', v_transfer_id, 
    'transfer_number', v_transfer_num
  );
END;
$$;

-- 4. Create or replace the complementary atomic void RPC
CREATE OR REPLACE FUNCTION public.void_internal_transfer_atomic(
  p_transfer_id UUID,
  p_void_reason TEXT,
  p_voided_by TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_transfer RECORD;
BEGIN
  IF p_transfer_id IS NULL THEN
    RAISE EXCEPTION 'MISSING_TRANSFER_ID: Transfer ID is required.';
  END IF;

  SELECT * INTO v_transfer FROM internal_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND OR v_transfer.id IS NULL THEN
    RAISE EXCEPTION 'TRANSFER_NOT_FOUND: Internal transfer % does not exist.', p_transfer_id;
  END IF;

  IF v_transfer.status = 'void' THEN
    RETURN jsonb_build_object(
      'success', true, 
      'transfer_id', p_transfer_id, 
      'already_void', true
    );
  END IF;

  -- 1. Void master transfer record
  UPDATE internal_transfers
  SET status = 'void',
      voided_at = NOW(),
      voided_by = p_voided_by,
      void_reason = p_void_reason,
      updated_at = NOW()
  WHERE id = p_transfer_id;

  -- 2. Revert linked withdrawal leg (releases reserved equity, preserves audit trail)
  UPDATE withdrawals
  SET status = 'Cancelled',
      notes = COALESCE(notes, '') || ' [Voided with transfer ' || v_transfer.transfer_number || ': ' || COALESCE(p_void_reason, 'No reason given') || ']',
      updated_at = NOW(),
      updated_by = p_voided_by
  WHERE transfer_id = p_transfer_id;

  -- 3. Revert linked deposit leg (removes balance addition, preserves audit trail)
  UPDATE deposits
  SET status = 'void',
      voided_at = NOW(),
      voided_by = p_voided_by,
      void_reason = p_void_reason,
      notes = COALESCE(notes, '') || ' [Voided with transfer ' || v_transfer.transfer_number || ': ' || COALESCE(p_void_reason, 'No reason given') || ']',
      updated_at = NOW()
  WHERE transfer_id = p_transfer_id;

  RETURN jsonb_build_object(
    'success', true, 
    'transfer_id', p_transfer_id, 
    'status', 'void'
  );
END;
$$;

-- 5. Revoke public/anon privileges and grant exclusively to authenticated and service_role
REVOKE ALL ON FUNCTION public.execute_internal_transfer_atomic(TEXT, TEXT, NUMERIC, DATE, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.execute_internal_transfer_atomic(TEXT, TEXT, NUMERIC, DATE, TEXT, TEXT, TEXT, TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.void_internal_transfer_atomic(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.void_internal_transfer_atomic(UUID, TEXT, TEXT) TO authenticated, service_role;

-- 6. Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
