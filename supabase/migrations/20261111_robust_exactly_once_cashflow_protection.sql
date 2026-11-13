-- =============================================================================
-- Migration: Robust Exactly-Once Protection for Cashflows & Accounting Application
-- Target Database: PostgreSQL (Authoritative Supabase julhldzkiqdeuuoqmvlo)
-- Purpose:
--   1. Enforce durable operation/idempotency keys across deposits, withdrawals,
--      transfers, and payment provider events.
--   2. Implement Idempotent Replay (same key + same payload -> return original)
--      and Payload Conflict Rejection (same key + different payload -> reject).
--   3. Allow legitimate multiple transactions with distinct operation keys
--      (no raw amount/date false-positive blocking).
--   4. Ensure internal transfers post debit + credit atomically under dual lock.
--   5. Deduplicate payment provider callbacks via payment_provider_events.
--   6. Enforce safe status transitions and permanently forbid physical deletions.
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. PAYMENT PROVIDER EVENTS DEDUPLICATION TABLE
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.payment_provider_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,                     -- e.g. 'stripe', 'plaid', 'wire_gateway', 'bank_feed'
  provider_event_id TEXT NOT NULL,            -- stable external event or transaction ID
  event_type TEXT NOT NULL,                   -- e.g. 'payment_intent.succeeded', 'transfer.paid'
  resource_type TEXT,                         -- 'deposit' | 'withdrawal'
  resource_id TEXT,                           -- internal deposit/withdrawal ID
  payload JSONB,                              -- raw webhook payload for auditability
  status TEXT NOT NULL DEFAULT 'processed',   -- 'processed' | 'ignored' | 'failed'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_payment_provider_event UNIQUE (provider, provider_event_id)
);

CREATE INDEX IF NOT EXISTS idx_payment_provider_events_lookup 
  ON public.payment_provider_events(provider, provider_event_id);

-- =============================================================================
-- 2. DURABLE IDEMPOTENCY KEYS AND UNIQUE INDEXES
-- =============================================================================
ALTER TABLE public.deposits ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE public.withdrawals ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE public.internal_transfers ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_deposits_idempotency_key
  ON public.deposits(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_withdrawals_idempotency_key
  ON public.withdrawals(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_internal_transfers_idempotency_key
  ON public.internal_transfers(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- =============================================================================
-- 3. PERMANENT PHYSICAL DELETION PROHIBITION
-- =============================================================================
CREATE OR REPLACE FUNCTION public.fn_prevent_financial_physical_delete()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'PHYSICAL_DELETION_PROHIBITED: Financial and audit records in table % cannot be physically deleted. Use audited status transitions (Cancelled/Void) or an explicit reversal transaction.', TG_TABLE_NAME;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_delete_deposits ON public.deposits;
CREATE TRIGGER trg_prevent_delete_deposits
  BEFORE DELETE ON public.deposits
  FOR EACH ROW EXECUTE FUNCTION public.fn_prevent_financial_physical_delete();

DROP TRIGGER IF EXISTS trg_prevent_delete_withdrawals ON public.withdrawals;
CREATE TRIGGER trg_prevent_delete_withdrawals
  BEFORE DELETE ON public.withdrawals
  FOR EACH ROW EXECUTE FUNCTION public.fn_prevent_financial_physical_delete();

DROP TRIGGER IF EXISTS trg_prevent_delete_transfers ON public.internal_transfers;
CREATE TRIGGER trg_prevent_delete_transfers
  BEFORE DELETE ON public.internal_transfers
  FOR EACH ROW EXECUTE FUNCTION public.fn_prevent_financial_physical_delete();

DROP TRIGGER IF EXISTS trg_prevent_delete_history ON public.investor_monthly_history;
CREATE TRIGGER trg_prevent_delete_history
  BEFORE DELETE ON public.investor_monthly_history
  FOR EACH ROW EXECUTE FUNCTION public.fn_prevent_financial_physical_delete();

-- =============================================================================
-- 4. HARDENED ATOMIC WITHDRAWAL CREATION RPC
-- =============================================================================
DROP FUNCTION IF EXISTS public.create_withdrawal_atomic(text, text, numeric, date, text, text, text, text, boolean);

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
  v_existing RECORD;
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

  -- 2. EXACTLY-ONCE IDEMPOTENCY KEY CHECK
  IF p_idempotency_key IS NOT NULL AND TRIM(p_idempotency_key) != '' THEN
    SELECT * INTO v_existing
    FROM withdrawals
    WHERE idempotency_key = TRIM(p_idempotency_key)
    LIMIT 1;

    IF v_existing.id IS NOT NULL THEN
      -- If same parameters, return existing record (Idempotent Replay)
      IF v_existing.investor_id = p_investor_id 
         AND v_existing.account_id = p_account_id
         AND v_existing.amount = p_amount 
         AND v_existing.effective_accounting_date = p_effective_date THEN
        RETURN jsonb_build_object(
          'status', 'IDEMPOTENT_REPLAY',
          'withdrawal_id', v_existing.id,
          'amount', v_existing.amount,
          'effective_accounting_date', v_existing.effective_accounting_date,
          'idempotency_replay', TRUE,
          'withdrawal', to_jsonb(v_existing)
        );
      ELSE
        -- Same key with mismatched payload MUST be rejected
        RAISE EXCEPTION 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH: Key % was already used for investor % account % amount $%.', 
          p_idempotency_key, v_existing.investor_id, v_existing.account_id, v_existing.amount;
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

-- =============================================================================
-- 5. HARDENED ATOMIC DEPOSIT CREATION RPC
-- =============================================================================
DROP FUNCTION IF EXISTS public.create_deposit_atomic(text, text, numeric, date, date, text, text, text, text, text, text);

CREATE OR REPLACE FUNCTION public.create_deposit_atomic(
  p_investor_id TEXT,
  p_account_id TEXT,
  p_amount NUMERIC(20, 2),
  p_date DATE,
  p_effective_date DATE,
  p_accounting_treatment TEXT DEFAULT 'NEW_CASH',
  p_status TEXT DEFAULT 'confirmed',
  p_type TEXT DEFAULT 'Wire',
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
  v_existing RECORD;
  v_normalized_status TEXT;
  v_normalized_treatment TEXT;
  v_new_deposit RECORD;
  v_inv_id TEXT;
  v_new_id TEXT;
BEGIN
  -- Normalize & Validate Treatment
  v_normalized_treatment := UPPER(TRIM(COALESCE(p_accounting_treatment, 'NEW_CASH')));
  IF v_normalized_treatment NOT IN ('NEW_CASH', 'HISTORICAL_PROVENANCE', 'UNVERIFIED_LEGACY', 'INTERNAL_TRANSFER') THEN
    RAISE EXCEPTION 'INVALID_ACCOUNTING_TREATMENT: % is not allowed.', p_accounting_treatment;
  END IF;

  -- Normalize & Validate Status
  v_normalized_status := LOWER(TRIM(COALESCE(p_status, 'confirmed')));
  IF v_normalized_status NOT IN ('confirmed', 'void', 'cancelled') THEN
    RAISE EXCEPTION 'INVALID_DEPOSIT_STATUS: Status must be confirmed, void, or cancelled. Received: %', p_status;
  END IF;

  -- Validate Amount
  IF p_amount IS NULL OR p_amount <= 0.00 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: Amount must be strictly greater than $0.00. Received: %', p_amount;
  END IF;

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

  -- 2. EXACTLY-ONCE IDEMPOTENCY KEY CHECK
  IF p_idempotency_key IS NOT NULL AND TRIM(p_idempotency_key) != '' THEN
    SELECT * INTO v_existing
    FROM deposits
    WHERE idempotency_key = TRIM(p_idempotency_key)
    LIMIT 1;

    IF v_existing.id IS NOT NULL THEN
      -- If same parameters, return existing record (Idempotent Replay)
      IF v_existing.investor_id = p_investor_id 
         AND v_existing.account_id = p_account_id
         AND v_existing.amount = p_amount 
         AND v_existing.accounting_treatment = v_normalized_treatment THEN
        RETURN jsonb_build_object(
          'status', 'IDEMPOTENT_REPLAY',
          'deposit_id', v_existing.id,
          'amount', v_existing.amount,
          'effective_accounting_date', v_existing.effective_accounting_date,
          'idempotency_replay', TRUE,
          'deposit', to_jsonb(v_existing)
        );
      ELSE
        -- Idempotency key conflict with mismatched payload
        RAISE EXCEPTION 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH: Key % was already used for investor % account % amount $%.', 
          p_idempotency_key, v_existing.investor_id, v_existing.account_id, v_existing.amount;
      END IF;
    END IF;
  END IF;

  v_new_id := gen_random_uuid()::text;

  -- 3. ATOMIC INSERT
  INSERT INTO deposits (
    id,
    investor_id,
    account_id,
    amount,
    date,
    effective_accounting_date,
    type,
    accounting_treatment,
    status,
    notes,
    idempotency_key,
    created_by,
    created_at,
    updated_at
  ) VALUES (
    v_new_id,
    p_investor_id,
    p_account_id,
    p_amount,
    COALESCE(p_date, CURRENT_DATE),
    COALESCE(p_effective_date, DATE_TRUNC('month', COALESCE(p_date, CURRENT_DATE))::DATE),
    COALESCE(p_type, 'Wire'),
    v_normalized_treatment,
    v_normalized_status,
    p_notes,
    NULLIF(TRIM(p_idempotency_key), ''),
    p_created_by,
    NOW(),
    NOW()
  )
  RETURNING * INTO v_new_deposit;

  RETURN jsonb_build_object(
    'status', 'SUCCESS',
    'deposit_id', v_new_deposit.id,
    'amount', p_amount,
    'effective_accounting_date', v_new_deposit.effective_accounting_date,
    'idempotency_replay', FALSE,
    'deposit', to_jsonb(v_new_deposit)
  );
END;
$$;

-- =============================================================================
-- 6. HARDENED PAYMENT PROVIDER EVENT PROCESSING RPC
-- =============================================================================
DROP FUNCTION IF EXISTS public.process_payment_provider_event_atomic(text, text, text, text, text, numeric, date, text, jsonb, text);

CREATE OR REPLACE FUNCTION public.process_payment_provider_event_atomic(
  p_provider TEXT,
  p_provider_event_id TEXT,
  p_event_type TEXT,
  p_investor_id TEXT,
  p_account_id TEXT,
  p_amount NUMERIC(20, 2),
  p_effective_date DATE,
  p_resource_type TEXT, -- 'deposit' | 'withdrawal'
  p_payload JSONB DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_lock_key BIGINT;
  v_existing_event RECORD;
  v_result JSONB;
  v_idempotency_key TEXT;
BEGIN
  -- Advisory lock scoped to provider + event_id
  v_lock_key := hashtext(p_provider || ':' || p_provider_event_id);
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- 1. Check if event has already been recorded
  SELECT * INTO v_existing_event
  FROM payment_provider_events
  WHERE provider = p_provider AND provider_event_id = p_provider_event_id;

  IF v_existing_event.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'status', 'ALREADY_PROCESSED',
      'provider_event_id', p_provider_event_id,
      'resource_type', v_existing_event.resource_type,
      'resource_id', v_existing_event.resource_id,
      'idempotency_replay', TRUE
    );
  END IF;

  v_idempotency_key := 'webhook_' || p_provider || '_' || p_provider_event_id;

  -- 2. Dispatch based on resource type
  IF p_resource_type = 'deposit' THEN
    v_result := create_deposit_atomic(
      p_investor_id,
      p_account_id,
      p_amount,
      p_effective_date,
      p_effective_date,
      'NEW_CASH',
      'confirmed',
      p_provider,
      p_notes,
      v_idempotency_key,
      'webhook:' || p_provider
    );
  ELSIF p_resource_type = 'withdrawal' THEN
    v_result := create_withdrawal_atomic(
      p_investor_id,
      p_account_id,
      p_amount,
      p_effective_date,
      'Completed',
      p_notes,
      v_idempotency_key,
      'webhook:' || p_provider,
      TRUE -- allow duplicate amounts if distinct event IDs
    );
  ELSE
    RAISE EXCEPTION 'UNSUPPORTED_RESOURCE_TYPE: %', p_resource_type;
  END IF;

  -- 3. Record provider event
  INSERT INTO payment_provider_events (
    provider,
    provider_event_id,
    event_type,
    resource_type,
    resource_id,
    payload,
    status
  ) VALUES (
    p_provider,
    p_provider_event_id,
    p_event_type,
    p_resource_type,
    COALESCE(v_result->>'deposit_id', v_result->>'withdrawal_id'),
    p_payload,
    'processed'
  );

  RETURN jsonb_build_object(
    'status', 'SUCCESS',
    'provider_event_id', p_provider_event_id,
    'resource_type', p_resource_type,
    'resource_id', COALESCE(v_result->>'deposit_id', v_result->>'withdrawal_id'),
    'idempotency_replay', FALSE,
    'result', v_result
  );
END;
$$;

-- =============================================================================
-- 7. REVISE LEGACY DUPLICATE TRIGGERS TO ALLOW DISTINCT OPERATION KEYS
-- =============================================================================
-- Update fn_enforce_withdrawal_duplicate_protection to strictly respect explicit idempotency keys
CREATE OR REPLACE FUNCTION fn_enforce_withdrawal_duplicate_protection()
RETURNS TRIGGER AS $$
BEGIN
  -- If caller provided an explicit non-empty idempotency_key, unique index handles duplicate protection!
  -- No false-positive blocking on same amount + same date for distinct operations.
  IF NEW.idempotency_key IS NOT NULL AND btrim(NEW.idempotency_key) != '' THEN
    RETURN NEW;
  END IF;

  -- Only if key is NULL/blank, assign a fallback deterministic key
  NEW.idempotency_key := 'wd_auto_' || NEW.investor_id || '_' || 
    COALESCE(NEW.effective_accounting_date::text, NEW.request_date::text, 'nodate') || '_' || 
    round(NEW.amount * 100)::text || '_' || gen_random_uuid()::text;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_enforce_deposit_duplicate_protection()
RETURNS TRIGGER AS $$
BEGIN
  -- If transfer_id is present, enforce INTERNAL_TRANSFER treatment
  IF NEW.transfer_id IS NOT NULL AND NEW.accounting_treatment != 'INTERNAL_TRANSFER' THEN
    RAISE EXCEPTION 'INTERNAL_TRANSFER_MISCLASSIFIED: Deposit with transfer_id must have accounting_treatment = INTERNAL_TRANSFER';
  END IF;

  -- If caller provided an explicit non-empty idempotency_key, unique index handles duplicate protection!
  IF NEW.idempotency_key IS NOT NULL AND btrim(NEW.idempotency_key) != '' THEN
    RETURN NEW;
  END IF;

  -- Fallback deterministic key
  NEW.idempotency_key := 'dep_auto_' || NEW.investor_id || '_' || 
    COALESCE(NEW.effective_accounting_date::text, NEW.date::text, 'nodate') || '_' || 
    round(NEW.amount * 100)::text || '_' || gen_random_uuid()::text;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- 8. HARDENED ATOMIC INTERNAL TRANSFER RPC
-- =============================================================================
DROP FUNCTION IF EXISTS public.execute_internal_transfer_atomic(text, text, numeric, date, text, text, text, text);

CREATE OR REPLACE FUNCTION public.execute_internal_transfer_atomic(
  p_source_account_id TEXT,
  p_target_account_id TEXT,
  p_amount NUMERIC(20, 2),
  p_effective_date DATE,
  p_purpose TEXT,
  p_notes TEXT,
  p_idempotency_key TEXT,
  p_created_by TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_source_investor_id TEXT;
  v_target_investor_id TEXT;
  v_transfer_id UUID;
  v_year INT;
  v_month_number INT;
  v_month_name TEXT;
  v_existing_xfer RECORD;
  v_source_equity NUMERIC;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: Internal transfer amount must be greater than zero.';
  END IF;

  IF p_source_account_id = p_target_account_id THEN
    RAISE EXCEPTION 'INVALID_ACCOUNTS: Source and target accounts cannot be identical.';
  END IF;

  -- 1. Idempotency Check
  IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) != '' THEN
    SELECT * INTO v_existing_xfer
    FROM internal_transfers
    WHERE idempotency_key = p_idempotency_key;

    IF v_existing_xfer.id IS NOT NULL THEN
      IF v_existing_xfer.source_account_id = p_source_account_id
         AND v_existing_xfer.target_account_id = p_target_account_id
         AND v_existing_xfer.amount = p_amount THEN
        RETURN jsonb_build_object(
          'success', TRUE,
          'status', 'IDEMPOTENT_REPLAY',
          'transfer_id', v_existing_xfer.id,
          'amount', v_existing_xfer.amount,
          'idempotency_replay', TRUE
        );
      ELSE
        RAISE EXCEPTION 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH: Key % was already used with different transfer parameters.', p_idempotency_key;
      END IF;
    END IF;
  END IF;

  -- 2. Lookup source & target investors
  SELECT investor_id INTO v_source_investor_id FROM investor_accounts WHERE id = p_source_account_id;
  IF v_source_investor_id IS NULL THEN
    RAISE EXCEPTION 'ACCOUNT_NOT_FOUND: Source account % does not exist.', p_source_account_id;
  END IF;

  SELECT investor_id INTO v_target_investor_id FROM investor_accounts WHERE id = p_target_account_id;
  IF v_target_investor_id IS NULL THEN
    RAISE EXCEPTION 'ACCOUNT_NOT_FOUND: Target account % does not exist.', p_target_account_id;
  END IF;

  -- 3. Check equity
  v_source_equity := calculate_available_withdrawal_equity_sql(v_source_investor_id, p_source_account_id, p_effective_date);
  IF v_source_equity < p_amount THEN
    RAISE EXCEPTION 'INSUFFICIENT_FUNDS: Available equity % is less than transfer amount %.', v_source_equity, p_amount;
  END IF;

  v_transfer_id := gen_random_uuid();
  v_year := EXTRACT(YEAR FROM p_effective_date)::INT;
  v_month_number := EXTRACT(MONTH FROM p_effective_date)::INT;
  v_month_name := TO_CHAR(p_effective_date, 'FMMonth');

  -- 4. Record internal transfer
  INSERT INTO internal_transfers (
    id,
    source_investor_id,
    source_account_id,
    target_investor_id,
    target_account_id,
    amount,
    effective_accounting_date,
    year,
    month_number,
    month,
    status,
    purpose,
    notes,
    idempotency_key,
    created_by
  ) VALUES (
    v_transfer_id,
    v_source_investor_id,
    p_source_account_id,
    v_target_investor_id,
    p_target_account_id,
    p_amount,
    p_effective_date,
    v_year,
    v_month_number,
    v_month_name,
    'confirmed',
    p_purpose,
    p_notes,
    p_idempotency_key,
    p_created_by
  );

  -- 5. Record debit leg (withdrawal)
  INSERT INTO withdrawals (
    id,
    investor_id,
    account_id,
    amount,
    status,
    notes,
    effective_accounting_date,
    request_date,
    year,
    month_number,
    month,
    transfer_id,
    transfer_leg,
    idempotency_key,
    created_by
  ) VALUES (
    'wd_' || substr(v_transfer_id::text, 1, 8),
    v_source_investor_id,
    p_source_account_id,
    p_amount,
    'Completed',
    'Internal transfer debit to account ' || p_target_account_id || ': ' || COALESCE(p_notes, ''),
    p_effective_date,
    p_effective_date,
    v_year,
    v_month_number,
    v_month_name,
    v_transfer_id,
    'DEBIT',
    'xfer_debit_' || v_transfer_id::text,
    p_created_by
  );

  -- 6. Record credit leg (deposit with INTERNAL_TRANSFER treatment, zero outside cash)
  INSERT INTO deposits (
    id,
    investor_id,
    account_id,
    amount,
    date,
    effective_accounting_date,
    type,
    accounting_treatment,
    status,
    notes,
    transfer_id,
    transfer_leg,
    idempotency_key,
    created_by
  ) VALUES (
    'dep_' || substr(v_transfer_id::text, 1, 8),
    v_target_investor_id,
    p_target_account_id,
    p_amount,
    p_effective_date,
    p_effective_date,
    'Internal Transfer',
    'INTERNAL_TRANSFER',
    'confirmed',
    'Internal transfer credit from account ' || p_source_account_id || ': ' || COALESCE(p_notes, ''),
    v_transfer_id,
    'CREDIT',
    'xfer_credit_' || v_transfer_id::text,
    p_created_by
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'status', 'SUCCESS',
    'transfer_id', v_transfer_id,
    'amount', p_amount,
    'idempotency_replay', FALSE
  );
END;
$$;

-- =============================================================================
-- 9. HARDENED WITHDRAWAL UPDATE RPC (STATUS TRANSITION SAFETY)
-- =============================================================================
DROP FUNCTION IF EXISTS public.update_withdrawal_atomic(text, numeric, text, text, text);

CREATE OR REPLACE FUNCTION public.update_withdrawal_atomic(
  p_withdrawal_id TEXT,
  p_amount NUMERIC(20, 2),
  p_status TEXT,
  p_notes TEXT,
  p_updated_by TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_current RECORD;
BEGIN
  SELECT * INTO v_current FROM withdrawals WHERE id = p_withdrawal_id;
  IF v_current.id IS NULL THEN
    RAISE EXCEPTION 'WITHDRAWAL_NOT_FOUND: Withdrawal % does not exist.', p_withdrawal_id;
  END IF;

  -- Completed transactions are financially immutable
  IF v_current.status = 'Completed' AND p_status != 'Completed' THEN
    RAISE EXCEPTION 'STATUS_TRANSITION_INVALID: Completed withdrawals are financially immutable and cannot be flipped to %.', p_status;
  END IF;

  UPDATE withdrawals
  SET amount = COALESCE(p_amount, amount),
      status = COALESCE(p_status, status),
      notes = COALESCE(p_notes, notes),
      updated_by = p_updated_by,
      updated_at = NOW()
  WHERE id = p_withdrawal_id;

  RETURN jsonb_build_object(
    'success', TRUE,
    'withdrawal_id', p_withdrawal_id,
    'status', COALESCE(p_status, v_current.status)
  );
END;
$$;

COMMIT;

