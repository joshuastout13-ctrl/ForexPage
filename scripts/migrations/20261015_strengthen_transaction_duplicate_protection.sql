-- Migration: Strengthen Database-Level Duplicate Protection for Deposits and Withdrawals
-- Target Database: julhldzkiqdeuuoqmvlo (Authoritative Production Supabase)
-- Invariant: Prevents accidental duplicate inserts while strictly allowing legitimate separate deposits with distinct references/keys.

CREATE OR REPLACE FUNCTION fn_enforce_deposit_duplicate_protection()
RETURNS TRIGGER AS $$
DECLARE
  v_existing_id text;
  v_is_confirmed_addition boolean;
BEGIN
  -- 1. Ensure idempotency key is always non-null and deterministic if not provided
  IF NEW.idempotency_key IS NULL OR btrim(NEW.idempotency_key) = '' THEN
    NEW.idempotency_key := 'dep_auto_' || NEW.investor_id || '_' || 
      COALESCE(NEW.effective_accounting_date::text, NEW.date::text, 'nodate') || '_' || 
      round(NEW.amount * 100)::text || '_' || 
      COALESCE(NEW.accounting_treatment, 'NEW_CASH');
  END IF;

  -- 2. If transfer_id is present, enforce INTERNAL_TRANSFER treatment
  IF NEW.transfer_id IS NOT NULL AND NEW.accounting_treatment != 'INTERNAL_TRANSFER' THEN
    RAISE EXCEPTION 'INTERNAL_TRANSFER_MISCLASSIFIED: Deposit with transfer_id must have accounting_treatment = INTERNAL_TRANSFER';
  END IF;

  -- 3. Check for active confirmed duplicate economic deposit
  IF NEW.status = 'confirmed' AND (TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND (OLD.status IS NULL OR OLD.status != 'confirmed'))) THEN
    -- Check if caller provided explicit confirmation marker or distinct transaction reference (safely handle NULLs)
    v_is_confirmed_addition := (
      COALESCE(NEW.idempotency_key, '') LIKE '%confirmed_addition%' OR 
      COALESCE(NEW.idempotency_key, '') LIKE '%ref_%' OR
      COALESCE(NEW.notes, '') ILIKE '%legitimate separate deposit%' OR
      COALESCE(NEW.notes, '') ILIKE '%confirmed additional%'
    );

    IF v_is_confirmed_addition IS NOT TRUE THEN
      SELECT id INTO v_existing_id
      FROM deposits
      WHERE account_id = NEW.account_id
        AND amount = NEW.amount
        AND status = 'confirmed'
        AND accounting_treatment = NEW.accounting_treatment
        AND (
          (effective_accounting_date IS NOT NULL AND NEW.effective_accounting_date IS NOT NULL AND effective_accounting_date = NEW.effective_accounting_date)
          OR (date IS NOT NULL AND NEW.date IS NOT NULL AND date = NEW.date)
        )
        AND id != COALESCE(NEW.id, '')
      LIMIT 1;

      IF v_existing_id IS NOT NULL THEN
        RAISE EXCEPTION 'DUPLICATE_ECONOMIC_DEPOSIT: An active % deposit of $% on % already exists for this account (Existing ID: %). Legitimate separate deposits must provide a distinct idempotency key (e.g. ref_... or confirmed_addition_...) or confirmation reference in notes.',
          NEW.accounting_treatment, NEW.amount, COALESCE(NEW.effective_accounting_date::text, NEW.date::text), v_existing_id;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop trigger if exists and recreate
DROP TRIGGER IF EXISTS trg_enforce_deposit_duplicate_protection ON deposits;
CREATE TRIGGER trg_enforce_deposit_duplicate_protection
  BEFORE INSERT OR UPDATE ON deposits
  FOR EACH ROW
  EXECUTE FUNCTION fn_enforce_deposit_duplicate_protection();

-- Withdrawals duplicate protection
CREATE OR REPLACE FUNCTION fn_enforce_withdrawal_duplicate_protection()
RETURNS TRIGGER AS $$
DECLARE
  v_existing_id text;
  v_is_confirmed_addition boolean;
  v_is_active_status boolean;
BEGIN
  -- 1. Ensure idempotency key is always non-null and deterministic if not provided
  IF NEW.idempotency_key IS NULL OR btrim(NEW.idempotency_key) = '' THEN
    NEW.idempotency_key := 'wd_auto_' || NEW.investor_id || '_' || 
      COALESCE(NEW.effective_accounting_date::text, NEW.request_date::text, 'nodate') || '_' || 
      round(NEW.amount * 100)::text;
  END IF;

  -- 2. Check for active duplicate economic withdrawal
  v_is_active_status := (LOWER(COALESCE(NEW.status, '')) IN ('completed', 'approved', 'pending'));
  IF v_is_active_status AND (TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND LOWER(COALESCE(OLD.status, '')) NOT IN ('completed', 'approved', 'pending'))) THEN
    v_is_confirmed_addition := (
      COALESCE(NEW.idempotency_key, '') LIKE '%confirmed_addition%' OR 
      COALESCE(NEW.idempotency_key, '') LIKE '%ref_%' OR
      COALESCE(NEW.notes, '') ILIKE '%legitimate separate withdrawal%' OR
      COALESCE(NEW.notes, '') ILIKE '%confirmed additional%'
    );

    IF v_is_confirmed_addition IS NOT TRUE THEN
      SELECT id INTO v_existing_id
      FROM withdrawals
      WHERE account_id = NEW.account_id
        AND amount = NEW.amount
        AND LOWER(status) IN ('completed', 'approved', 'pending')
        AND (
          (effective_accounting_date IS NOT NULL AND NEW.effective_accounting_date IS NOT NULL AND effective_accounting_date = NEW.effective_accounting_date)
          OR (request_date IS NOT NULL AND NEW.request_date IS NOT NULL AND request_date = NEW.request_date)
        )
        AND id != COALESCE(NEW.id, '')
      LIMIT 1;

      IF v_existing_id IS NOT NULL THEN
        RAISE EXCEPTION 'DUPLICATE_ECONOMIC_WITHDRAWAL: An active withdrawal of $% on % already exists for this account (Existing ID: %). Legitimate separate withdrawals must provide a distinct idempotency key or confirmation reference in notes.',
          NEW.amount, COALESCE(NEW.effective_accounting_date::text, NEW.request_date::text), v_existing_id;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_withdrawal_duplicate_protection ON withdrawals;
CREATE TRIGGER trg_enforce_withdrawal_duplicate_protection
  BEFORE INSERT OR UPDATE ON withdrawals
  FOR EACH ROW
  EXECUTE FUNCTION fn_enforce_withdrawal_duplicate_protection();
