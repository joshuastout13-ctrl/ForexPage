-- =============================================================================
-- Migration: Legacy / Existing-Leg Internal Transfer Adoption RPC
-- Target: Supabase PostgreSQL (Project: julhldzkiqdeuuoqmvlo)
-- Date: 2026-09-23
-- =============================================================================

CREATE OR REPLACE FUNCTION public.adopt_legacy_internal_transfer_atomic(
  p_deposit_id TEXT,
  p_source_account_id TEXT,
  p_target_account_id TEXT,
  p_amount NUMERIC,
  p_effective_date DATE,
  p_purpose TEXT,
  p_notes TEXT,
  p_idempotency_key TEXT,
  p_authorized_by TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_source_rec RECORD;
  v_target_rec RECORD;
  v_dep RECORD;
  v_source_inv_id TEXT;
  v_target_inv_id TEXT;
  v_transfer_id UUID;
  v_transfer_num TEXT;
  v_debit_id TEXT;
  v_canonical_date DATE;
  v_year INT;
  v_month_num INT;
  v_month_name TEXT;
  v_remaining_cash INT;
  v_source_equity NUMERIC;
BEGIN
  -- 1. Input validations
  IF p_deposit_id IS NULL OR TRIM(p_deposit_id) = '' THEN
    RAISE EXCEPTION 'MISSING_DEPOSIT_ID: Existing deposit ID is required.';
  END IF;

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

  -- 2. Deterministic advisory locking on account IDs
  IF p_source_account_id < p_target_account_id THEN
    PERFORM pg_advisory_xact_lock(hashtext(p_source_account_id));
    PERFORM pg_advisory_xact_lock(hashtext(p_target_account_id));
  ELSE
    PERFORM pg_advisory_xact_lock(hashtext(p_target_account_id));
    PERFORM pg_advisory_xact_lock(hashtext(p_source_account_id));
  END IF;

  -- 3. Idempotency Check on Master Transfer
  SELECT id, transfer_number INTO v_transfer_id, v_transfer_num 
  FROM internal_transfers 
  WHERE idempotency_key = p_idempotency_key;

  IF FOUND THEN
    SELECT id INTO v_debit_id FROM withdrawals WHERE transfer_id = v_transfer_id AND transfer_leg = 'DEBIT';
    RETURN jsonb_build_object(
      'success', true,
      'transfer_id', v_transfer_id,
      'transfer_number', v_transfer_num,
      'deposit_id', p_deposit_id,
      'withdrawal_id', v_debit_id,
      'idempotent_replay', true
    );
  END IF;

  -- 4. Validate accounts exist and are active
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

  -- 5. Lock and validate the existing deposit row
  SELECT * INTO v_dep FROM deposits WHERE id = p_deposit_id FOR UPDATE;
  IF NOT FOUND OR v_dep.id IS NULL THEN
    RAISE EXCEPTION 'DEPOSIT_NOT_FOUND: Target deposit % does not exist.', p_deposit_id;
  END IF;

  IF v_dep.account_id != p_target_account_id THEN
    RAISE EXCEPTION 'DEPOSIT_ACCOUNT_MISMATCH: Deposit % belongs to account %, not target account %.',
      p_deposit_id, v_dep.account_id, p_target_account_id;
  END IF;

  IF v_dep.amount != p_amount THEN
    RAISE EXCEPTION 'DEPOSIT_AMOUNT_MISMATCH: Deposit % amount ($%) does not match adoption amount ($%).',
      p_deposit_id, v_dep.amount, p_amount;
  END IF;

  IF v_dep.transfer_id IS NOT NULL THEN
    RAISE EXCEPTION 'DEPOSIT_ALREADY_LINKED: Deposit % is already linked to transfer %.',
      p_deposit_id, v_dep.transfer_id;
  END IF;

  -- 6. Check if a debit already exists for this transfer/period on the source account to prevent duplicate debits
  SELECT id INTO v_debit_id FROM withdrawals 
  WHERE account_id = p_source_account_id 
    AND effective_accounting_date = v_canonical_date
    AND amount = p_amount
    AND status IN ('Completed', 'Approved')
    AND transfer_leg = 'DEBIT';

  IF FOUND THEN
    RAISE EXCEPTION 'SOURCE_DEBIT_ALREADY_EXISTS: A debit of $% for period % already exists on account % (withdrawal_id: %).',
      p_amount, v_canonical_date, p_source_account_id, v_debit_id;
  END IF;

  -- 7. Validate source equity at effective date
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

  -- 8. Generate master transfer number
  v_transfer_num := 'XFER-' || v_year || '-' || LPAD(nextval('internal_transfer_seq')::TEXT, 5, '0');

  -- 9. Insert Master Transfer Record
  INSERT INTO internal_transfers (
    transfer_number, source_investor_id, source_account_id, target_investor_id, target_account_id,
    amount, effective_accounting_date, year, month_number, month, status, purpose, notes, idempotency_key, created_by
  ) VALUES (
    v_transfer_num, v_source_inv_id, p_source_account_id, v_target_inv_id, p_target_account_id,
    p_amount, v_canonical_date, v_year, v_month_num, TRIM(v_month_name), 'confirmed', p_purpose,
    COALESCE(p_notes, 'Adoption of existing credit ' || p_deposit_id),
    p_idempotency_key, p_authorized_by
  ) RETURNING id INTO v_transfer_id;

  -- 10. Link and reclassify the existing target deposit (dep_bc8434ab)
  UPDATE deposits
  SET transfer_id = v_transfer_id,
      transfer_leg = 'CREDIT',
      accounting_treatment = 'INTERNAL_TRANSFER',
      type = 'Internal Transfer',
      notes = COALESCE(notes, '') || ' [Adopted into transfer ' || v_transfer_num || ' per authorization by ' || p_authorized_by || ']',
      updated_at = NOW()
  WHERE id = p_deposit_id;

  -- 11. Create exactly ONE missing source debit leg (withdrawal) for Jerry
  v_debit_id := 'wd_' || LOWER(p_source_account_id) || '_' || TO_CHAR(v_canonical_date, 'YYYYMMDD') || '_' || SUBSTRING(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 8);
  INSERT INTO withdrawals (
    id, investor_id, account_id, amount, status, request_date, effective_accounting_date,
    year, month_number, month, notes, transfer_id, transfer_leg, created_by
  ) VALUES (
    v_debit_id, v_source_inv_id, p_source_account_id, p_amount, 'Completed', v_canonical_date, v_canonical_date,
    v_year, v_month_num, TRIM(v_month_name),
    'Authorized monthly internal transfer to ' || p_target_account_id || ' [' || v_transfer_num || ']: ' || COALESCE(p_notes, ''),
    v_transfer_id, 'DEBIT', p_authorized_by
  );

  -- 12. Evaluate cash provenance on target account:
  -- If target account has zero remaining verified external-cash records (NEW_CASH or HISTORICAL_PROVENANCE),
  -- provenance completeness status transitions PARTIAL -> UNKNOWN.
  SELECT count(*) INTO v_remaining_cash
  FROM deposits
  WHERE account_id = p_target_account_id
    AND status = 'confirmed'
    AND accounting_treatment IN ('NEW_CASH', 'HISTORICAL_PROVENANCE');

  IF v_remaining_cash = 0 THEN
    UPDATE investor_accounts
    SET external_cash_provenance_status = 'UNKNOWN',
        updated_at = NOW()
    WHERE id = p_target_account_id
      AND external_cash_provenance_status = 'PARTIAL';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'transfer_id', v_transfer_id,
    'transfer_number', v_transfer_num,
    'deposit_id', p_deposit_id,
    'withdrawal_id', v_debit_id,
    'source_account_id', p_source_account_id,
    'target_account_id', p_target_account_id,
    'amount', p_amount,
    'effective_accounting_date', v_canonical_date,
    'provenance_status_updated_to_unknown', (v_remaining_cash = 0)
  );
END;
$$;

-- Revoke public/anon privileges and grant exclusively to authenticated and service_role
REVOKE ALL ON FUNCTION public.adopt_legacy_internal_transfer_atomic(TEXT, TEXT, TEXT, NUMERIC, DATE, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adopt_legacy_internal_transfer_atomic(TEXT, TEXT, TEXT, NUMERIC, DATE, TEXT, TEXT, TEXT, TEXT) TO authenticated, service_role;

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
