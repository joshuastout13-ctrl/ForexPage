-- =============================================================================
-- Migration: First-Class Internal Transfer Execution and Void RPCs
-- Target: Supabase PostgreSQL (Project: julhldzkiqdeuuoqmvlo)
-- Date: 2026-09-22
-- =============================================================================

-- 1. Create the transfer number sequence
CREATE SEQUENCE IF NOT EXISTS internal_transfer_seq START WITH 1;
GRANT USAGE, SELECT ON SEQUENCE internal_transfer_seq TO authenticated, service_role;

-- 2. Create the atomic transfer execution RPC
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
  v_source_equity NUMERIC;
  v_transfer_id UUID;
  v_transfer_num TEXT;
  v_source_inv_id TEXT;
  v_target_inv_id TEXT;
  v_year INT;
  v_month_num INT;
  v_month_name TEXT;
BEGIN
  -- 1. Deterministic lock ordering to prevent deadlocks
  IF p_source_account_id < p_target_account_id THEN
    PERFORM pg_advisory_xact_lock(hashtext(p_source_account_id));
    PERFORM pg_advisory_xact_lock(hashtext(p_target_account_id));
  ELSE
    PERFORM pg_advisory_xact_lock(hashtext(p_target_account_id));
    PERFORM pg_advisory_xact_lock(hashtext(p_source_account_id));
  END IF;

  -- 2. Check Idempotency
  SELECT id INTO v_transfer_id FROM internal_transfers WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    RETURN jsonb_build_object('success', true, 'transfer_id', v_transfer_id, 'idempotent_replay', true);
  END IF;

  -- 3. Resolve investor IDs
  SELECT investor_id INTO v_source_inv_id FROM investor_accounts WHERE id = p_source_account_id;
  SELECT investor_id INTO v_target_inv_id FROM investor_accounts WHERE id = p_target_account_id;

  IF v_source_inv_id IS NULL THEN
    RAISE EXCEPTION 'SOURCE_ACCOUNT_NOT_FOUND: Investor account % does not exist.', p_source_account_id;
  END IF;
  IF v_target_inv_id IS NULL THEN
    RAISE EXCEPTION 'TARGET_ACCOUNT_NOT_FOUND: Investor account % does not exist.', p_target_account_id;
  END IF;

  -- 4. Fail-closed equity validation on source account
  v_source_equity := calculate_available_withdrawal_equity_sql(
    v_source_inv_id,
    p_source_account_id,
    p_effective_date,
    NULL
  );

  IF p_amount > v_source_equity THEN
    RAISE EXCEPTION 'TRANSFER_EXCEEDS_SOURCE_EQUITY: Requested amount ($%) exceeds available equity ($%) on source account %',
      TO_CHAR(p_amount, 'FM999,999,990.00'),
      TO_CHAR(v_source_equity, 'FM999,999,990.00'),
      p_source_account_id;
  END IF;

  -- 5. Derive dates & transfer number
  v_year := EXTRACT(YEAR FROM p_effective_date);
  v_month_num := EXTRACT(MONTH FROM p_effective_date);
  v_month_name := TO_CHAR(p_effective_date, 'Month');
  v_transfer_num := 'XFER-' || v_year || '-' || LPAD(nextval('internal_transfer_seq')::TEXT, 5, '0');

  -- 6. Insert Master Transfer Record
  INSERT INTO internal_transfers (
    transfer_number, source_investor_id, source_account_id, target_investor_id, target_account_id,
    amount, effective_accounting_date, year, month_number, month, purpose, notes, idempotency_key, created_by
  ) VALUES (
    v_transfer_num, v_source_inv_id, p_source_account_id, v_target_inv_id, p_target_account_id,
    p_amount, p_effective_date, v_year, v_month_num, TRIM(v_month_name), p_purpose, p_notes, p_idempotency_key, p_created_by
  ) RETURNING id INTO v_transfer_id;

  -- 7. Insert Linked Source Debit Leg (Withdrawal)
  INSERT INTO withdrawals (
    id, investor_id, account_id, amount, status, request_date, effective_accounting_date,
    year, month_number, month, notes, transfer_id, transfer_leg, created_by
  ) VALUES (
    gen_random_uuid()::text, v_source_inv_id, p_source_account_id, p_amount, 'Completed', p_effective_date, p_effective_date,
    v_year, v_month_num, TRIM(v_month_name), 'Internal transfer to ' || p_target_account_id, v_transfer_id, 'DEBIT', p_created_by
  );

  -- 8. Insert Linked Target Credit Leg (Deposit)
  INSERT INTO deposits (
    id, investor_id, account_id, amount, status, date, effective_accounting_date,
    type, accounting_treatment, transfer_id, transfer_leg, notes, created_by
  ) VALUES (
    gen_random_uuid()::text, v_target_inv_id, p_target_account_id, p_amount, 'confirmed', p_effective_date, p_effective_date,
    'Internal Transfer', 'INTERNAL_TRANSFER', v_transfer_id, 'CREDIT', 'Internal transfer from ' || p_source_account_id, p_created_by
  );

  RETURN jsonb_build_object('success', true, 'transfer_id', v_transfer_id, 'transfer_number', v_transfer_num);
END;
$$;

-- 3. Create the complementary atomic void RPC
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
  SELECT * INTO v_transfer FROM internal_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF v_transfer.id IS NULL THEN
    RAISE EXCEPTION 'TRANSFER_NOT_FOUND: Internal transfer % does not exist.', p_transfer_id;
  END IF;

  IF v_transfer.status = 'void' THEN
    RETURN jsonb_build_object('success', true, 'transfer_id', p_transfer_id, 'already_void', true);
  END IF;

  -- Void master transfer record
  UPDATE internal_transfers
  SET status = 'void',
      voided_at = NOW(),
      voided_by = p_voided_by,
      void_reason = p_void_reason,
      updated_at = NOW()
  WHERE id = p_transfer_id;

  -- Revert linked withdrawal leg (releases reserved equity)
  UPDATE withdrawals
  SET status = 'Cancelled',
      notes = COALESCE(notes, '') || ' [Voided with transfer ' || v_transfer.transfer_number || ']',
      updated_at = NOW()
  WHERE transfer_id = p_transfer_id;

  -- Revert linked deposit leg (removes balance addition)
  UPDATE deposits
  SET status = 'void',
      notes = COALESCE(notes, '') || ' [Voided with transfer ' || v_transfer.transfer_number || ']',
      updated_at = NOW()
  WHERE transfer_id = p_transfer_id;

  RETURN jsonb_build_object('success', true, 'transfer_id', p_transfer_id, 'status', 'void');
END;
$$;

-- 4. Grant execute permissions to API roles
GRANT EXECUTE ON FUNCTION public.execute_internal_transfer_atomic(TEXT, TEXT, NUMERIC, DATE, TEXT, TEXT, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.void_internal_transfer_atomic(UUID, TEXT, TEXT) TO authenticated, service_role;

-- 5. Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
