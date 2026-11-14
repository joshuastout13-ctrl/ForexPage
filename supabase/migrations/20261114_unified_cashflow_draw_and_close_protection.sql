-- =============================================================================
-- Migration: Unified Cashflow Protection, Draw Flag Support, Locked Period
--            Enforcement, Share Integrity Triggers & Atomic Period Close v2
-- Date: 2026-11-14
-- Target Database: PostgreSQL (Supabase julhldzkiqdeuuoqmvlo & Embedded PG)
-- Safety: Strictly idempotent DDL; does NOT mutate historical balances directly.
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. PREREQUISITE SCHEMA GUARANTEES (ADDITIVE / IDEMPOTENT)
-- =============================================================================
ALTER TABLE IF EXISTS public.withdrawals
  ADD COLUMN IF NOT EXISTS is_draw BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS updated_by TEXT,
  ADD COLUMN IF NOT EXISTS created_by TEXT,
  ADD COLUMN IF NOT EXISTS transfer_id UUID,
  ADD COLUMN IF NOT EXISTS transfer_leg TEXT;

ALTER TABLE IF EXISTS public.deposits
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'confirmed',
  ADD COLUMN IF NOT EXISTS accounting_treatment TEXT DEFAULT 'NEW_CASH',
  ADD COLUMN IF NOT EXISTS created_by TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS voided_by TEXT,
  ADD COLUMN IF NOT EXISTS void_reason TEXT,
  ADD COLUMN IF NOT EXISTS transfer_id UUID,
  ADD COLUMN IF NOT EXISTS transfer_leg TEXT;

ALTER TABLE IF EXISTS public.commission_earnings
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS ledger_key TEXT,
  ADD COLUMN IF NOT EXISTS source_account_id TEXT,
  ADD COLUMN IF NOT EXISTS commission_percent_snapshot NUMERIC,
  ADD COLUMN IF NOT EXISTS commission_share_rule_id TEXT,
  ADD COLUMN IF NOT EXISTS calculation_version TEXT,
  ADD COLUMN IF NOT EXISTS accounting_period_id INT,
  ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS superseded_by_audit_id TEXT,
  ADD COLUMN IF NOT EXISTS audit_notes TEXT;

CREATE TABLE IF NOT EXISTS public.payment_provider_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  payload JSONB,
  status TEXT NOT NULL DEFAULT 'processed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_payment_provider_event UNIQUE (provider, provider_event_id)
);

CREATE INDEX IF NOT EXISTS idx_payment_provider_events_lookup
  ON public.payment_provider_events(provider, provider_event_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_deposits_idempotency_key
  ON public.deposits(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_withdrawals_idempotency_key
  ON public.withdrawals(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- =============================================================================
-- 2. PHYSICAL DELETE PROHIBITION ACROSS ALL FINANCIAL LEDGERS
-- =============================================================================
CREATE OR REPLACE FUNCTION public.fn_prevent_financial_physical_delete()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'PHYSICAL_DELETION_PROHIBITED: Financial and audit records in table % cannot be physically deleted. Use audited status transitions (Cancelled/Void/SUPERSEDED) or an explicit reversal entry.', TG_TABLE_NAME;
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

DO $$
BEGIN
  IF to_regclass('public.internal_transfers') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_prevent_delete_transfers ON public.internal_transfers;
    CREATE TRIGGER trg_prevent_delete_transfers
      BEFORE DELETE ON public.internal_transfers
      FOR EACH ROW EXECUTE FUNCTION public.fn_prevent_financial_physical_delete();
  END IF;

  IF to_regclass('public.investor_monthly_history') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_prevent_delete_history ON public.investor_monthly_history;
    CREATE TRIGGER trg_prevent_delete_history
      BEFORE DELETE ON public.investor_monthly_history
      FOR EACH ROW EXECUTE FUNCTION public.fn_prevent_financial_physical_delete();
  END IF;

  IF to_regclass('public.commission_earnings') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_prevent_delete_commission_earnings ON public.commission_earnings;
    CREATE TRIGGER trg_prevent_delete_commission_earnings
      BEFORE DELETE ON public.commission_earnings
      FOR EACH ROW EXECUTE FUNCTION public.fn_prevent_financial_physical_delete();
  END IF;

  IF to_regclass('public.accounting_periods') IS NOT NULL THEN
    -- Remove legacy synthetic 2099-1 TEST seed before installing permanent physical-delete guard
    EXECUTE $q$ DELETE FROM public.accounting_periods WHERE year = 2099 AND month_number = 1 AND finalized_by = 'TEST' $q$;
    DROP TRIGGER IF EXISTS trg_prevent_delete_accounting_periods ON public.accounting_periods;
    CREATE TRIGGER trg_prevent_delete_accounting_periods
      BEFORE DELETE ON public.accounting_periods
      FOR EACH ROW EXECUTE FUNCTION public.fn_prevent_financial_physical_delete();
  END IF;

  IF to_regclass('public.monthly_returns') IS NOT NULL THEN
    EXECUTE $q$ DELETE FROM public.monthly_returns WHERE year = 2099 AND month_number = 1 AND source = 'TEST' $q$;
  END IF;
END $$;

-- =============================================================================
-- 3. LOCKED / FINALIZED PERIOD HELPER & PROTECTION TRIGGERS
-- =============================================================================
CREATE OR REPLACE FUNCTION public.is_accounting_period_locked(
  p_year INT,
  p_month INT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_locked BOOLEAN := FALSE;
BEGIN
  IF p_year IS NULL OR p_month IS NULL THEN
    RETURN FALSE;
  END IF;

  IF to_regclass('public.accounting_periods') IS NOT NULL THEN
    EXECUTE $q$
      SELECT EXISTS(
        SELECT 1 FROM public.accounting_periods
        WHERE year = $1 AND month_number = $2
          AND UPPER(COALESCE(status, '')) = 'FINALIZED'
      )
    $q$ INTO v_locked USING p_year, p_month;
    IF COALESCE(v_locked, FALSE) THEN
      RETURN TRUE;
    END IF;
  END IF;

  IF to_regclass('public.monthly_returns') IS NOT NULL THEN
    EXECUTE $q$
      SELECT EXISTS(
        SELECT 1 FROM public.monthly_returns
        WHERE year = $1 AND month_number = $2
          AND locked = TRUE
      )
    $q$ INTO v_locked USING p_year, p_month;
    IF COALESCE(v_locked, FALSE) THEN
      RETURN TRUE;
    END IF;
  END IF;

  RETURN FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_protect_locked_period_cashflows()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_ctx TEXT;
  v_eff_date DATE;
  v_old_date DATE;
  v_year INT;
  v_month INT;
  v_old_year INT;
  v_old_month INT;
  v_treatment TEXT;
BEGIN
  v_ctx := COALESCE(current_setting('app.accounting_engine_context', true), '');
  IF v_ctx IN ('FINALIZING', 'AUTHORIZED_REMEDIATION') THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'deposits' THEN
    v_treatment := UPPER(TRIM(COALESCE(NEW.accounting_treatment, 'NEW_CASH')));
    IF v_treatment IN ('HISTORICAL_PROVENANCE', 'UNVERIFIED_LEGACY') THEN
      RETURN NEW;
    END IF;

    IF TG_OP = 'UPDATE' THEN
      -- Allow voiding non-economic $0 placeholder records
      IF OLD.amount <= 0 AND NEW.amount <= 0 AND LOWER(COALESCE(NEW.status, '')) IN ('void', 'cancelled') THEN
        RETURN NEW;
      END IF;
      -- Allow backfilling NULL effective_accounting_date to canonical first-of-month(date)
      IF OLD.effective_accounting_date IS NULL
         AND OLD.date IS NOT NULL
         AND NEW.effective_accounting_date = DATE_TRUNC('month', OLD.date)::DATE
         AND NEW.amount IS NOT DISTINCT FROM OLD.amount
         AND LOWER(COALESCE(NEW.status, '')) IS NOT DISTINCT FROM LOWER(COALESCE(OLD.status, '')) THEN
        RETURN NEW;
      END IF;
      IF NEW.amount IS NOT DISTINCT FROM OLD.amount
         AND LOWER(COALESCE(NEW.status, '')) IS NOT DISTINCT FROM LOWER(COALESCE(OLD.status, ''))
         AND UPPER(COALESCE(NEW.type, '')) IS NOT DISTINCT FROM UPPER(COALESCE(OLD.type, ''))
         AND UPPER(COALESCE(NEW.accounting_treatment, '')) IS NOT DISTINCT FROM UPPER(COALESCE(OLD.accounting_treatment, ''))
         AND NEW.effective_accounting_date IS NOT DISTINCT FROM OLD.effective_accounting_date
         AND NEW.date IS NOT DISTINCT FROM OLD.date THEN
        -- Non-financial metadata backfill (e.g. idempotency_key / notes) allowed
        RETURN NEW;
      END IF;
      v_old_date := COALESCE(OLD.effective_accounting_date, OLD.date);
      IF v_old_date IS NOT NULL THEN
        v_old_year := EXTRACT(YEAR FROM v_old_date)::INT;
        v_old_month := EXTRACT(MONTH FROM v_old_date)::INT;
        IF public.is_accounting_period_locked(v_old_year, v_old_month) THEN
          RAISE EXCEPTION 'PERIOD_LOCKED: Cannot modify deposit in finalized/locked period %-%', v_old_year, v_old_month;
        END IF;
      END IF;
    END IF;

    v_eff_date := COALESCE(NEW.effective_accounting_date, NEW.date);
    IF v_eff_date IS NOT NULL THEN
      v_year := EXTRACT(YEAR FROM v_eff_date)::INT;
      v_month := EXTRACT(MONTH FROM v_eff_date)::INT;
      IF public.is_accounting_period_locked(v_year, v_month) THEN
        RAISE EXCEPTION 'PERIOD_LOCKED: Cannot post deposit into finalized/locked period %-%', v_year, v_month;
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'withdrawals' THEN
    IF TG_OP = 'UPDATE' THEN
      -- Allow voiding non-economic $0 placeholder records
      IF OLD.amount <= 0 AND NEW.amount <= 0 AND LOWER(COALESCE(NEW.status, '')) IN ('void', 'cancelled') THEN
        RETURN NEW;
      END IF;
      -- Allow backfilling NULL effective_accounting_date to canonical first-of-month(request_date)
      IF OLD.effective_accounting_date IS NULL
         AND OLD.request_date IS NOT NULL
         AND NEW.effective_accounting_date = DATE_TRUNC('month', OLD.request_date)::DATE
         AND NEW.amount IS NOT DISTINCT FROM OLD.amount
         AND LOWER(COALESCE(NEW.status, '')) IS NOT DISTINCT FROM LOWER(COALESCE(OLD.status, '')) THEN
        RETURN NEW;
      END IF;
      IF NEW.amount IS NOT DISTINCT FROM OLD.amount
         AND LOWER(COALESCE(NEW.status, '')) IS NOT DISTINCT FROM LOWER(COALESCE(OLD.status, ''))
         AND NEW.effective_accounting_date IS NOT DISTINCT FROM OLD.effective_accounting_date
         AND COALESCE(NEW.year, EXTRACT(YEAR FROM COALESCE(NEW.effective_accounting_date, NEW.request_date))::INT)
             IS NOT DISTINCT FROM COALESCE(OLD.year, EXTRACT(YEAR FROM COALESCE(OLD.effective_accounting_date, OLD.request_date))::INT)
         AND COALESCE(NEW.month_number, EXTRACT(MONTH FROM COALESCE(NEW.effective_accounting_date, NEW.request_date))::INT)
             IS NOT DISTINCT FROM COALESCE(OLD.month_number, EXTRACT(MONTH FROM COALESCE(OLD.effective_accounting_date, OLD.request_date))::INT)
         AND COALESCE(NEW.is_draw, FALSE) IS NOT DISTINCT FROM COALESCE(OLD.is_draw, FALSE) THEN
        -- Non-financial metadata backfill (e.g. idempotency_key / notes) allowed
        RETURN NEW;
      END IF;

      v_old_year := COALESCE(OLD.year, EXTRACT(YEAR FROM COALESCE(OLD.effective_accounting_date, OLD.request_date))::INT);
      v_old_month := COALESCE(OLD.month_number, EXTRACT(MONTH FROM COALESCE(OLD.effective_accounting_date, OLD.request_date))::INT);
      IF public.is_accounting_period_locked(v_old_year, v_old_month) THEN
        RAISE EXCEPTION 'PERIOD_LOCKED: Cannot modify withdrawal in finalized/locked period %-%', v_old_year, v_old_month;
      END IF;
    END IF;

    v_year := COALESCE(NEW.year, EXTRACT(YEAR FROM COALESCE(NEW.effective_accounting_date, NEW.request_date))::INT);
    v_month := COALESCE(NEW.month_number, EXTRACT(MONTH FROM COALESCE(NEW.effective_accounting_date, NEW.request_date))::INT);
    IF public.is_accounting_period_locked(v_year, v_month) THEN
      RAISE EXCEPTION 'PERIOD_LOCKED: Cannot post withdrawal into finalized/locked period %-%', v_year, v_month;
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_locked_deposits ON public.deposits;
CREATE TRIGGER trg_protect_locked_deposits
  BEFORE INSERT OR UPDATE ON public.deposits
  FOR EACH ROW EXECUTE FUNCTION public.fn_protect_locked_period_cashflows();

DROP TRIGGER IF EXISTS trg_protect_locked_withdrawals ON public.withdrawals;
CREATE TRIGGER trg_protect_locked_withdrawals
  BEFORE INSERT OR UPDATE ON public.withdrawals
  FOR EACH ROW EXECUTE FUNCTION public.fn_protect_locked_period_cashflows();

CREATE OR REPLACE FUNCTION public.fn_protect_locked_accounting_ledgers()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_ctx TEXT;
BEGIN
  v_ctx := COALESCE(current_setting('app.accounting_engine_context', true), '');
  IF v_ctx IN ('FINALIZING', 'AUTHORIZED_REMEDIATION') THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'monthly_returns' THEN
    IF TG_OP = 'UPDATE' AND (OLD.locked = TRUE OR public.is_accounting_period_locked(OLD.year, OLD.month_number)) THEN
      RAISE EXCEPTION 'PERIOD_LOCKED: Monthly return %-% is locked/finalized and cannot be edited directly.', OLD.year, OLD.month_number;
    END IF;
  ELSIF TG_TABLE_NAME = 'investor_monthly_history' THEN
    IF TG_OP = 'UPDATE' AND COALESCE(OLD.locked, FALSE) = FALSE AND NEW.locked = TRUE
       AND NEW.opening_balance IS NOT DISTINCT FROM OLD.opening_balance
       AND NEW.deposits IS NOT DISTINCT FROM OLD.deposits
       AND NEW.withdrawals IS NOT DISTINCT FROM OLD.withdrawals
       AND NEW.ending_balance IS NOT DISTINCT FROM OLD.ending_balance THEN
      -- Allow idempotent locking of an unlocked matching row without altering figures
      RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' AND (OLD.locked = TRUE OR public.is_accounting_period_locked(OLD.year, OLD.month_number)) THEN
      RAISE EXCEPTION 'PERIOD_LOCKED: History row for investor % period %-% is locked/finalized and immutable.', OLD.investor_id, OLD.year, OLD.month_number;
    END IF;
    IF TG_OP = 'INSERT' AND public.is_accounting_period_locked(NEW.year, NEW.month_number) THEN
      RAISE EXCEPTION 'PERIOD_LOCKED: Cannot insert history row directly into finalized/locked period %-%', NEW.year, NEW.month_number;
    END IF;
  ELSIF TG_TABLE_NAME = 'commission_earnings' THEN
    IF public.is_accounting_period_locked(
      COALESCE(OLD.year, NEW.year),
      COALESCE(OLD.month_number, NEW.month_number)
    ) THEN
      RAISE EXCEPTION 'PERIOD_LOCKED: Commission ledger for finalized/locked period %-% is immutable outside atomic close.',
        COALESCE(OLD.year, NEW.year), COALESCE(OLD.month_number, NEW.month_number);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.monthly_returns') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_protect_locked_monthly_returns ON public.monthly_returns;
    CREATE TRIGGER trg_protect_locked_monthly_returns
      BEFORE INSERT OR UPDATE ON public.monthly_returns
      FOR EACH ROW EXECUTE FUNCTION public.fn_protect_locked_accounting_ledgers();
  END IF;

  IF to_regclass('public.investor_monthly_history') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_protect_locked_history ON public.investor_monthly_history;
    CREATE TRIGGER trg_protect_locked_history
      BEFORE INSERT OR UPDATE ON public.investor_monthly_history
      FOR EACH ROW EXECUTE FUNCTION public.fn_protect_locked_accounting_ledgers();
  END IF;

  IF to_regclass('public.commission_earnings') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_protect_locked_commission_earnings ON public.commission_earnings;
    CREATE TRIGGER trg_protect_locked_commission_earnings
      BEFORE INSERT OR UPDATE ON public.commission_earnings
      FOR EACH ROW EXECUTE FUNCTION public.fn_protect_locked_accounting_ledgers();
  END IF;
END $$;

-- =============================================================================
-- 4. COMMISSION SHARES OVERLAP & 100% POOL ALLOCATION TRIGGER
-- =============================================================================
CREATE OR REPLACE FUNCTION public.fn_validate_commission_share_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_ctx TEXT;
  v_status TEXT;
  v_start DATE;
  v_end DATE;
  v_overlap_id TEXT;
  v_split_pct NUMERIC := 0;
  v_other_sum NUMERIC := 0;
BEGIN
  v_ctx := COALESCE(current_setting('app.accounting_engine_context', true), '');
  IF v_ctx = 'AUTHORIZED_REMEDIATION' THEN
    RETURN NEW;
  END IF;

  v_status := LOWER(TRIM(COALESCE(NEW.status, 'active')));
  IF v_status NOT IN ('active', 'ended', 'cancelled') THEN
    RAISE EXCEPTION 'INVALID_SHARE_STATUS: Share status must be active, ended, or cancelled. Received: %', NEW.status;
  END IF;

  IF NEW.commission_percent IS NULL OR NEW.commission_percent <= 0 OR NEW.commission_percent > 100 THEN
    RAISE EXCEPTION 'INVALID_COMMISSION_PERCENT: Percentage must be > 0 and <= 100. Received: %', NEW.commission_percent;
  END IF;

  IF NEW.effective_end_date IS NOT NULL AND NEW.effective_start_date IS NOT NULL
     AND NEW.effective_end_date < NEW.effective_start_date THEN
    RAISE EXCEPTION 'INVALID_DATE_RANGE: effective_end_date (%) cannot precede effective_start_date (%).',
      NEW.effective_end_date, NEW.effective_start_date;
  END IF;

  IF v_status = 'cancelled' THEN
    RETURN NEW;
  END IF;

  v_start := COALESCE(NEW.effective_start_date, '1900-01-01'::DATE);
  v_end := COALESCE(NEW.effective_end_date, '9999-12-31'::DATE);

  -- 1. Reject overlapping active/ended windows for same (source, account, recipient)
  SELECT cs.id INTO v_overlap_id
  FROM public.commission_shares cs
  WHERE cs.id::text != COALESCE(NEW.id::text, '')
    AND cs.source_investor_id = NEW.source_investor_id
    AND cs.recipient_investor_id = NEW.recipient_investor_id
    AND COALESCE(cs.source_account_id, '') = COALESCE(NEW.source_account_id, '')
    AND LOWER(COALESCE(cs.status, 'active')) != 'cancelled'
    AND COALESCE(cs.effective_start_date, '1900-01-01'::DATE) <= v_end
    AND v_start <= COALESCE(cs.effective_end_date, '9999-12-31'::DATE)
  LIMIT 1;

  IF v_overlap_id IS NOT NULL THEN
    RAISE EXCEPTION 'OVERLAPPING_COMMISSION_SHARE: Date range %..% overlaps existing rule % for source % and recipient %.',
      v_start, v_end, v_overlap_id, NEW.source_investor_id, NEW.recipient_investor_id;
  END IF;

  -- 2. For active rules, enforce source split_pct + overlapping shares <= 100%
  IF v_status = 'active' THEN
    SELECT COALESCE(split_pct, 0) INTO v_split_pct
    FROM public.investors
    WHERE id = NEW.source_investor_id
    LIMIT 1;

    SELECT COALESCE(SUM(cs.commission_percent), 0) INTO v_other_sum
    FROM public.commission_shares cs
    WHERE cs.id::text != COALESCE(NEW.id::text, '')
      AND cs.source_investor_id = NEW.source_investor_id
      AND COALESCE(cs.source_account_id, '') = COALESCE(NEW.source_account_id, '')
      AND LOWER(COALESCE(cs.status, 'active')) = 'active'
      AND COALESCE(cs.effective_start_date, '1900-01-01'::DATE) <= v_end
      AND v_start <= COALESCE(cs.effective_end_date, '9999-12-31'::DATE);

    IF (COALESCE(v_split_pct, 0) + v_other_sum + NEW.commission_percent) > 100.01 THEN
      RAISE EXCEPTION 'COMMISSION_ALLOCATION_EXCEEDS_100_PCT: Source investor % split (%) + active shares (% + %) = % exceeds 100 pct.',
        NEW.source_investor_id,
        v_split_pct, v_other_sum, NEW.commission_percent,
        (v_split_pct + v_other_sum + NEW.commission_percent);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.commission_shares') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_validate_commission_share_integrity ON public.commission_shares;
    CREATE TRIGGER trg_validate_commission_share_integrity
      BEFORE INSERT OR UPDATE ON public.commission_shares
      FOR EACH ROW EXECUTE FUNCTION public.fn_validate_commission_share_integrity();
  END IF;
END $$;

-- =============================================================================
-- 5. DUPLICATE-PROTECTION TRIGGERS ON DEPOSITS & WITHDRAWALS
-- =============================================================================
CREATE OR REPLACE FUNCTION public.fn_enforce_withdrawal_duplicate_protection()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.idempotency_key IS NOT NULL AND btrim(NEW.idempotency_key) != '' THEN
    RETURN NEW;
  END IF;

  NEW.idempotency_key := 'wd_auto_' || NEW.investor_id || '_' ||
    COALESCE(NEW.effective_accounting_date::text, NEW.request_date::text, 'nodate') || '_' ||
    round(NEW.amount * 100)::text || '_' || gen_random_uuid()::text;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.fn_enforce_deposit_duplicate_protection()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.transfer_id IS NOT NULL AND UPPER(COALESCE(NEW.accounting_treatment, '')) != 'INTERNAL_TRANSFER' THEN
    RAISE EXCEPTION 'INTERNAL_TRANSFER_MISCLASSIFIED: Deposit with transfer_id must have accounting_treatment = INTERNAL_TRANSFER';
  END IF;

  IF NEW.idempotency_key IS NOT NULL AND btrim(NEW.idempotency_key) != '' THEN
    RETURN NEW;
  END IF;

  NEW.idempotency_key := 'dep_auto_' || NEW.investor_id || '_' ||
    COALESCE(NEW.effective_accounting_date::text, NEW.date::text, 'nodate') || '_' ||
    round(NEW.amount * 100)::text || '_' || gen_random_uuid()::text;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_withdrawal_duplicate_protection ON public.withdrawals;
CREATE TRIGGER trg_enforce_withdrawal_duplicate_protection
  BEFORE INSERT ON public.withdrawals
  FOR EACH ROW EXECUTE FUNCTION public.fn_enforce_withdrawal_duplicate_protection();

DROP TRIGGER IF EXISTS trg_enforce_deposit_duplicate_protection ON public.deposits;
CREATE TRIGGER trg_enforce_deposit_duplicate_protection
  BEFORE INSERT ON public.deposits
  FOR EACH ROW EXECUTE FUNCTION public.fn_enforce_deposit_duplicate_protection();

-- =============================================================================
-- 6. FIXED AVAILABLE WITHDRAWAL EQUITY FUNCTION (CUTOVER & LEDGER STATUS AWARE)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.financial_lock_key(p_investor_id TEXT)
RETURNS BIGINT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT ('x' || substr(md5(COALESCE(p_investor_id, '')), 1, 16))::bit(64)::bigint;
$$;

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
  v_start_year INT;
  v_start_month INT;
  v_is_first_period BOOLEAN := FALSE;
  v_inv_id TEXT;
  v_cutover_balance NUMERIC(20, 10);
BEGIN
  IF p_effective_date IS NULL THEN
    RAISE EXCEPTION 'INVALID_EFFECTIVE_DATE: Effective date is required.';
  END IF;

  IF EXTRACT(DAY FROM p_effective_date) != 1 THEN
    RAISE EXCEPTION 'INVALID_EFFECTIVE_DATE: Effective date must be the first day of the month (YYYY-MM-01). Received: %', p_effective_date;
  END IF;

  v_target_year := EXTRACT(YEAR FROM p_effective_date)::INT;
  v_target_month := EXTRACT(MONTH FROM p_effective_date)::INT;

  SELECT id, start_date::DATE INTO v_inv_id, v_inv_start_date
  FROM public.investors
  WHERE id = p_investor_id
  LIMIT 1;

  IF v_inv_id IS NULL THEN
    SELECT id, start_date::DATE INTO v_inv_id, v_inv_start_date
    FROM public.investors
    WHERE portal_username = p_investor_id
    LIMIT 1;
  END IF;

  IF v_inv_id IS NULL THEN
    RAISE EXCEPTION 'INVESTOR_NOT_FOUND: Investor % does not exist.', p_investor_id;
  END IF;

  p_investor_id := v_inv_id;

  IF p_account_id IS NOT NULL AND TRIM(p_account_id) != '' THEN
    SELECT COALESCE(starting_capital, 0.00), open_date::DATE
    INTO v_starting_capital, v_acc_open_date
    FROM public.investor_accounts
    WHERE investor_id = p_investor_id AND id::text = p_account_id
    LIMIT 1;
  ELSE
    SELECT COALESCE(starting_capital, 0.00), open_date::DATE
    INTO v_starting_capital, v_acc_open_date
    FROM public.investor_accounts
    WHERE investor_id = p_investor_id
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  v_starting_capital := COALESCE(v_starting_capital, 0.00);

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

  IF v_target_month = 1 THEN
    v_prior_year := v_target_year - 1;
    v_prior_month := 12;
  ELSE
    v_prior_year := v_target_year;
    v_prior_month := v_target_month - 1;
  END IF;

  -- Check Authorized Cutover Adjustment FIRST
  IF to_regclass('public.account_cutover_adjustments') IS NOT NULL THEN
    EXECUTE $q$
      SELECT authorized_opening_balance
      FROM public.account_cutover_adjustments
      WHERE investor_id = $1 AND year = $2 AND month_number = $3
      LIMIT 1
    $q$ INTO v_cutover_balance USING p_investor_id, v_target_year, v_target_month;
  END IF;

  IF v_cutover_balance IS NOT NULL THEN
    v_prior_ending_balance := ROUND(v_cutover_balance, 2);
  ELSIF v_is_first_period THEN
    v_prior_ending_balance := v_starting_capital;
  ELSE
    SELECT ending_balance INTO v_hist_ending
    FROM public.investor_monthly_history
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

  -- Only ACTIVE prior-month commissions (never SUPERSEDED or VOID) count toward available equity
  IF v_cutover_balance IS NULL AND to_regclass('public.commission_earnings') IS NOT NULL THEN
    EXECUTE $q$
      SELECT COALESCE(SUM(amount), 0.00)
      FROM public.commission_earnings
      WHERE recipient_id = $1
        AND year = $2
        AND month_number = $3
        AND UPPER(TRIM(COALESCE(status, 'ACTIVE'))) = 'ACTIVE'
    $q$ INTO v_prior_commissions USING p_investor_id, v_prior_year, v_prior_month;
  ELSE
    v_prior_commissions := 0.00;
  END IF;

  -- Eligible confirmed cash deposits only (exclude VOID/CANCELLED and HISTORICAL_PROVENANCE/UNVERIFIED_LEGACY)
  SELECT COALESCE(SUM(amount), 0.00) INTO v_eligible_deposits
  FROM public.deposits
  WHERE investor_id = p_investor_id
    AND (type IS NULL OR UPPER(TRIM(type)) != 'VOID')
    AND LOWER(TRIM(COALESCE(status, 'confirmed'))) = 'confirmed'
    AND UPPER(TRIM(COALESCE(accounting_treatment, 'NEW_CASH'))) NOT IN ('HISTORICAL_PROVENANCE', 'UNVERIFIED_LEGACY')
    AND (
      (effective_accounting_date IS NOT NULL AND EXTRACT(YEAR FROM effective_accounting_date) = v_target_year AND EXTRACT(MONTH FROM effective_accounting_date) = v_target_month)
      OR
      (effective_accounting_date IS NULL AND date IS NOT NULL AND EXTRACT(YEAR FROM date) = v_target_year AND EXTRACT(MONTH FROM date) = v_target_month)
    );

  -- Active withdrawals in target period
  SELECT COALESCE(SUM(amount), 0.00) INTO v_other_withdrawals
  FROM public.withdrawals
  WHERE investor_id = p_investor_id
    AND (p_exclude_withdrawal_id IS NULL OR id::text != p_exclude_withdrawal_id::text)
    AND LOWER(TRIM(COALESCE(status, ''))) IN ('pending', 'approved', 'completed')
    AND (
      (year = v_target_year AND month_number = v_target_month)
      OR
      (effective_accounting_date IS NOT NULL AND EXTRACT(YEAR FROM effective_accounting_date) = v_target_year AND EXTRACT(MONTH FROM effective_accounting_date) = v_target_month)
      OR
      (effective_accounting_date IS NULL AND request_date IS NOT NULL AND EXTRACT(YEAR FROM request_date) = v_target_year AND EXTRACT(MONTH FROM request_date) = v_target_month)
    );

  v_raw_equity := COALESCE(v_prior_ending_balance, 0) + COALESCE(v_eligible_deposits, 0) + COALESCE(v_prior_commissions, 0) - COALESCE(v_other_withdrawals, 0);
  IF v_raw_equity < 0.00 THEN
    RETURN 0.00;
  END IF;

  RETURN ROUND(v_raw_equity, 2);
END;
$$;

-- =============================================================================
-- 7. WITHDRAWAL CREATION & UPDATE RPCS WITH p_is_draw + PERIOD LOCK CHECKS
-- =============================================================================
DROP FUNCTION IF EXISTS public.create_withdrawal_atomic(text, text, numeric, date, text, text, text, text);
DROP FUNCTION IF EXISTS public.create_withdrawal_atomic(text, text, numeric, date, text, text, text, text, boolean);
DROP FUNCTION IF EXISTS public.create_withdrawal_atomic(text, text, numeric, date, text, text, text, text, boolean, boolean);

CREATE OR REPLACE FUNCTION public.create_withdrawal_atomic(
  p_investor_id TEXT,
  p_account_id TEXT,
  p_amount NUMERIC(20, 2),
  p_effective_date DATE,
  p_status TEXT DEFAULT 'Pending',
  p_notes TEXT DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL,
  p_created_by TEXT DEFAULT NULL,
  p_allow_duplicate_amount BOOLEAN DEFAULT FALSE,
  p_is_draw BOOLEAN DEFAULT FALSE
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
  v_target_month_name TEXT;
  v_new_withdrawal RECORD;
  v_inv_id TEXT;
  v_new_id TEXT;
  v_is_draw BOOLEAN := COALESCE(p_is_draw, FALSE);
BEGIN
  v_normalized_status := INITCAP(TRIM(COALESCE(p_status, 'Pending')));
  IF v_normalized_status NOT IN ('Pending', 'Approved', 'Completed', 'Cancelled', 'Void') THEN
    RAISE EXCEPTION 'INVALID_WITHDRAWAL_STATUS: Status must be Pending, Approved, Completed, Cancelled, or Void. Received: %', p_status;
  END IF;

  IF p_amount IS NULL OR p_amount <= 0.00 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: Amount must be strictly greater than $0.00. Received: %', p_amount;
  END IF;

  IF p_effective_date IS NULL OR EXTRACT(DAY FROM p_effective_date) != 1 THEN
    RAISE EXCEPTION 'INVALID_EFFECTIVE_DATE: Effective date must be the first day of the month (YYYY-MM-01). Received: %', p_effective_date;
  END IF;

  v_target_year := EXTRACT(YEAR FROM p_effective_date)::INT;
  v_target_month := EXTRACT(MONTH FROM p_effective_date)::INT;
  v_target_month_name := TRIM(TO_CHAR(p_effective_date, 'FMMonth'));

  IF public.is_accounting_period_locked(v_target_year, v_target_month) THEN
    RAISE EXCEPTION 'PERIOD_LOCKED: Period %-% is finalized/locked and cannot accept new withdrawals.', v_target_year, v_target_month;
  END IF;

  SELECT id INTO v_inv_id FROM public.investors WHERE id = p_investor_id;
  IF v_inv_id IS NULL THEN
    SELECT id INTO v_inv_id FROM public.investors WHERE portal_username = p_investor_id LIMIT 1;
  END IF;
  IF v_inv_id IS NOT NULL THEN
    p_investor_id := v_inv_id;
  END IF;

  v_lock_key := public.financial_lock_key(p_investor_id);
  PERFORM pg_advisory_xact_lock(v_lock_key);
  PERFORM 1 FROM public.investor_accounts WHERE investor_id = p_investor_id FOR UPDATE;

  IF p_idempotency_key IS NOT NULL AND TRIM(p_idempotency_key) != '' THEN
    SELECT * INTO v_existing
    FROM public.withdrawals
    WHERE idempotency_key = TRIM(p_idempotency_key)
    LIMIT 1;

    IF v_existing.id IS NOT NULL THEN
      IF v_existing.investor_id = p_investor_id
         AND COALESCE(v_existing.account_id, '') = COALESCE(p_account_id, '')
         AND v_existing.amount = p_amount
         AND v_existing.effective_accounting_date = p_effective_date
         AND COALESCE(v_existing.is_draw, FALSE) = v_is_draw THEN
        RETURN jsonb_build_object(
          'status', 'IDEMPOTENT_REPLAY',
          'withdrawal_id', v_existing.id,
          'amount', v_existing.amount,
          'effective_accounting_date', v_existing.effective_accounting_date,
          'is_draw', COALESCE(v_existing.is_draw, FALSE),
          'idempotency_replay', TRUE,
          'withdrawal', to_jsonb(v_existing)
        );
      ELSE
        RAISE EXCEPTION 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH: Key % was already used for investor % account % amount $%.',
          p_idempotency_key, v_existing.investor_id, v_existing.account_id, v_existing.amount;
      END IF;
    END IF;
  END IF;

  v_available_equity := public.calculate_available_withdrawal_equity_sql(
    p_investor_id,
    p_account_id,
    p_effective_date,
    NULL
  );

  IF v_normalized_status IN ('Pending', 'Approved', 'Completed') THEN
    IF p_amount > v_available_equity THEN
      RAISE EXCEPTION 'WITHDRAWAL_EXCEEDS_AVAILABLE_EQUITY: Requested amount ($%) exceeds available account equity ($%) at effective date %.',
        TO_CHAR(p_amount, 'FM999,999,990.00'),
        TO_CHAR(v_available_equity, 'FM999,999,990.00'),
        p_effective_date;
    END IF;
  END IF;

  v_new_id := gen_random_uuid()::text;

  INSERT INTO public.withdrawals (
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
    month,
    is_draw,
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
    v_target_month_name,
    v_is_draw,
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
    'is_draw', v_is_draw,
    'idempotency_replay', FALSE,
    'withdrawal', to_jsonb(v_new_withdrawal)
  );
END;
$$;

DROP FUNCTION IF EXISTS public.update_withdrawal_atomic(text, numeric, text, text, text);
DROP FUNCTION IF EXISTS public.update_withdrawal_atomic(uuid, numeric, text, text, text);
DROP FUNCTION IF EXISTS public.update_withdrawal_atomic(text, numeric, text, text, text, date, int, int, text);
DROP FUNCTION IF EXISTS public.update_withdrawal_atomic(text, numeric, text, text, text, date, int, int, text, boolean);

CREATE OR REPLACE FUNCTION public.update_withdrawal_atomic(
  p_withdrawal_id TEXT,
  p_amount NUMERIC DEFAULT NULL,
  p_status TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_updated_by TEXT DEFAULT NULL,
  p_effective_date DATE DEFAULT NULL,
  p_year INT DEFAULT NULL,
  p_month_number INT DEFAULT NULL,
  p_month TEXT DEFAULT NULL,
  p_is_draw BOOLEAN DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_current RECORD;
  v_lock_key BIGINT;
  v_target_amount NUMERIC(20, 2);
  v_target_status TEXT;
  v_current_status TEXT;
  v_target_eff_date DATE;
  v_target_year INT;
  v_target_month INT;
  v_target_month_name TEXT;
  v_target_is_draw BOOLEAN;
  v_old_year INT;
  v_old_month INT;
  v_available_equity NUMERIC(20, 2);
  v_updated RECORD;
BEGIN
  SELECT * INTO v_current
  FROM public.withdrawals
  WHERE id::text = p_withdrawal_id::text
  FOR UPDATE;

  IF v_current.id IS NULL THEN
    RAISE EXCEPTION 'WITHDRAWAL_NOT_FOUND: Withdrawal % does not exist.', p_withdrawal_id;
  END IF;

  v_lock_key := public.financial_lock_key(v_current.investor_id);
  PERFORM pg_advisory_xact_lock(v_lock_key);
  PERFORM 1 FROM public.investor_accounts WHERE investor_id = v_current.investor_id FOR UPDATE;

  v_current_status := INITCAP(TRIM(COALESCE(v_current.status, 'Pending')));
  v_target_status := INITCAP(TRIM(COALESCE(p_status, v_current_status)));
  v_target_amount := COALESCE(p_amount, v_current.amount);
  v_target_is_draw := COALESCE(p_is_draw, v_current.is_draw, FALSE);

  IF v_target_status NOT IN ('Pending', 'Approved', 'Completed', 'Cancelled', 'Void') THEN
    RAISE EXCEPTION 'INVALID_WITHDRAWAL_STATUS: Status must be Pending, Approved, Completed, Cancelled, or Void. Received: %', p_status;
  END IF;

  IF v_target_status != v_current_status THEN
    IF v_current_status = 'Completed' THEN
      RAISE EXCEPTION 'INVALID_STATUS_TRANSITION: Completed withdrawals are financially immutable and cannot transition to %.', v_target_status;
    ELSIF v_current_status IN ('Cancelled', 'Void') THEN
      RAISE EXCEPTION 'INVALID_STATUS_TRANSITION: Cannot transition terminal withdrawal status (%) to %.', v_current_status, v_target_status;
    ELSIF v_current_status = 'Approved' AND v_target_status NOT IN ('Completed', 'Cancelled', 'Void', 'Approved') THEN
      RAISE EXCEPTION 'INVALID_STATUS_TRANSITION: Approved withdrawals can only transition to Completed, Cancelled, or Void. Received: %', v_target_status;
    ELSIF v_current_status = 'Pending' AND v_target_status NOT IN ('Approved', 'Completed', 'Cancelled', 'Void', 'Pending') THEN
      RAISE EXCEPTION 'INVALID_STATUS_TRANSITION: Pending withdrawals can only transition to Approved, Completed, Cancelled, or Void. Received: %', v_target_status;
    END IF;
  END IF;

  IF v_target_amount <= 0.00 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: Amount must be strictly greater than $0.00. Received: %', v_target_amount;
  END IF;

  IF p_effective_date IS NOT NULL THEN
    IF EXTRACT(DAY FROM p_effective_date) != 1 THEN
      RAISE EXCEPTION 'INVALID_EFFECTIVE_DATE: Effective date must be the first day of the month (YYYY-MM-01). Received: %', p_effective_date;
    END IF;
    v_target_eff_date := p_effective_date;
  ELSE
    v_target_eff_date := DATE_TRUNC('month', COALESCE(v_current.effective_accounting_date, v_current.request_date, CURRENT_DATE))::DATE;
  END IF;

  v_target_year := COALESCE(p_year, EXTRACT(YEAR FROM v_target_eff_date)::INT);
  v_target_month := COALESCE(p_month_number, EXTRACT(MONTH FROM v_target_eff_date)::INT);
  v_target_month_name := COALESCE(p_month, TRIM(TO_CHAR(v_target_eff_date, 'FMMonth')));

  v_old_year := COALESCE(v_current.year, EXTRACT(YEAR FROM COALESCE(v_current.effective_accounting_date, v_current.request_date))::INT);
  v_old_month := COALESCE(v_current.month_number, EXTRACT(MONTH FROM COALESCE(v_current.effective_accounting_date, v_current.request_date))::INT);

  IF v_target_amount IS DISTINCT FROM v_current.amount
     OR v_target_status IS DISTINCT FROM v_current_status
     OR v_target_eff_date IS DISTINCT FROM v_current.effective_accounting_date
     OR v_target_is_draw IS DISTINCT FROM COALESCE(v_current.is_draw, FALSE) THEN
    IF public.is_accounting_period_locked(v_old_year, v_old_month) THEN
      RAISE EXCEPTION 'PERIOD_LOCKED: Cannot modify withdrawal in finalized/locked period %-%', v_old_year, v_old_month;
    END IF;
    IF public.is_accounting_period_locked(v_target_year, v_target_month) THEN
      RAISE EXCEPTION 'PERIOD_LOCKED: Cannot move withdrawal into finalized/locked period %-%', v_target_year, v_target_month;
    END IF;
  END IF;

  v_available_equity := public.calculate_available_withdrawal_equity_sql(
    v_current.investor_id,
    v_current.account_id,
    v_target_eff_date,
    p_withdrawal_id
  );

  IF v_target_status IN ('Pending', 'Approved', 'Completed') AND v_target_amount > v_available_equity THEN
    RAISE EXCEPTION 'WITHDRAWAL_EXCEEDS_AVAILABLE_EQUITY: Updated amount ($%) exceeds available account equity ($%) at effective date %.',
      TO_CHAR(v_target_amount, 'FM999,999,990.00'),
      TO_CHAR(v_available_equity, 'FM999,999,990.00'),
      v_target_eff_date;
  END IF;

  UPDATE public.withdrawals
  SET amount = v_target_amount,
      status = v_target_status,
      notes = COALESCE(p_notes, notes),
      effective_accounting_date = v_target_eff_date,
      year = v_target_year,
      month_number = v_target_month,
      month = v_target_month_name,
      is_draw = v_target_is_draw,
      updated_by = COALESCE(p_updated_by, updated_by),
      updated_at = NOW()
  WHERE id::text = p_withdrawal_id::text
  RETURNING * INTO v_updated;

  RETURN jsonb_build_object(
    'success', TRUE,
    'status', 'SUCCESS',
    'withdrawal_id', p_withdrawal_id,
    'withdrawal_status', v_target_status,
    'is_draw', v_target_is_draw,
    'available_equity_before', v_available_equity,
    'available_equity_after', CASE WHEN v_target_status IN ('Pending', 'Approved', 'Completed') THEN v_available_equity - v_target_amount ELSE v_available_equity END,
    'withdrawal', to_jsonb(v_updated)
  );
END;
$$;

-- =============================================================================
-- 8. HARDENED DEPOSIT CREATION RPC (LOCKED-PERIOD CHECK)
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
  v_eff_date DATE;
BEGIN
  v_normalized_treatment := UPPER(TRIM(COALESCE(p_accounting_treatment, 'NEW_CASH')));
  IF v_normalized_treatment NOT IN ('NEW_CASH', 'HISTORICAL_PROVENANCE', 'UNVERIFIED_LEGACY', 'INTERNAL_TRANSFER') THEN
    RAISE EXCEPTION 'INVALID_ACCOUNTING_TREATMENT: % is not allowed.', p_accounting_treatment;
  END IF;

  v_normalized_status := LOWER(TRIM(COALESCE(p_status, 'confirmed')));
  IF v_normalized_status NOT IN ('confirmed', 'void', 'cancelled') THEN
    RAISE EXCEPTION 'INVALID_DEPOSIT_STATUS: Status must be confirmed, void, or cancelled. Received: %', p_status;
  END IF;

  IF p_amount IS NULL OR p_amount <= 0.00 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: Amount must be strictly greater than $0.00. Received: %', p_amount;
  END IF;

  v_eff_date := COALESCE(p_effective_date, DATE_TRUNC('month', COALESCE(p_date, CURRENT_DATE))::DATE);

  IF v_normalized_treatment NOT IN ('HISTORICAL_PROVENANCE', 'UNVERIFIED_LEGACY') THEN
    IF public.is_accounting_period_locked(EXTRACT(YEAR FROM v_eff_date)::INT, EXTRACT(MONTH FROM v_eff_date)::INT) THEN
      RAISE EXCEPTION 'PERIOD_LOCKED: Period %-% is finalized/locked and cannot accept new deposits.',
        EXTRACT(YEAR FROM v_eff_date)::INT, EXTRACT(MONTH FROM v_eff_date)::INT;
    END IF;
  END IF;

  SELECT id INTO v_inv_id FROM public.investors WHERE id = p_investor_id;
  IF v_inv_id IS NULL THEN
    SELECT id INTO v_inv_id FROM public.investors WHERE portal_username = p_investor_id LIMIT 1;
  END IF;
  IF v_inv_id IS NOT NULL THEN
    p_investor_id := v_inv_id;
  END IF;

  v_lock_key := public.financial_lock_key(p_investor_id);
  PERFORM pg_advisory_xact_lock(v_lock_key);

  IF p_idempotency_key IS NOT NULL AND TRIM(p_idempotency_key) != '' THEN
    SELECT * INTO v_existing
    FROM public.deposits
    WHERE idempotency_key = TRIM(p_idempotency_key)
    LIMIT 1;

    IF v_existing.id IS NOT NULL THEN
      IF v_existing.investor_id = p_investor_id
         AND COALESCE(v_existing.account_id, '') = COALESCE(p_account_id, '')
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
        RAISE EXCEPTION 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH: Key % was already used for investor % account % amount $%.',
          p_idempotency_key, v_existing.investor_id, v_existing.account_id, v_existing.amount;
      END IF;
    END IF;
  END IF;

  v_new_id := gen_random_uuid()::text;

  INSERT INTO public.deposits (
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
    v_eff_date,
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
-- 9. PAYMENT PROVIDER EVENT WEBHOOK RPC (DROP OLD 6-ARG, INSTALL CLEAN 11-ARG)
-- =============================================================================
DROP FUNCTION IF EXISTS public.process_payment_provider_event_atomic(text, text, text, text, text, jsonb);
DROP FUNCTION IF EXISTS public.process_payment_provider_event_atomic(text, text, text, text, text, numeric, date, text, jsonb, text);
DROP FUNCTION IF EXISTS public.process_payment_provider_event_atomic(text, text, text, text, text, numeric, date, text, jsonb, text, boolean);

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
  p_notes TEXT DEFAULT NULL,
  p_is_draw BOOLEAN DEFAULT FALSE
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
  v_lock_key := hashtext(p_provider || ':' || p_provider_event_id);
  PERFORM pg_advisory_xact_lock(v_lock_key);

  SELECT * INTO v_existing_event
  FROM public.payment_provider_events
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

  IF p_resource_type = 'deposit' THEN
    v_result := public.create_deposit_atomic(
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
    v_result := public.create_withdrawal_atomic(
      p_investor_id,
      p_account_id,
      p_amount,
      p_effective_date,
      'Completed',
      p_notes,
      v_idempotency_key,
      'webhook:' || p_provider,
      TRUE,
      COALESCE(p_is_draw, FALSE)
    );
  ELSE
    RAISE EXCEPTION 'UNSUPPORTED_RESOURCE_TYPE: %', p_resource_type;
  END IF;

  INSERT INTO public.payment_provider_events (
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
-- 10. ATOMIC PERIOD CLOSE, COMMISSION SUPERSESSION & M+1 ROLLOVER RPC v2
-- =============================================================================
DROP FUNCTION IF EXISTS public.finalize_monthly_accounting_v2(int, int, numeric, text, text, text, text, text, text, jsonb, jsonb, jsonb, text);

CREATE OR REPLACE FUNCTION public.finalize_monthly_accounting_v2(
  p_year INT,
  p_month_number INT,
  p_gross_return_pct NUMERIC(8, 4),
  p_return_source TEXT,
  p_return_status TEXT,
  p_input_hash TEXT,
  p_preview_run_id TEXT,
  p_calculation_version TEXT,
  p_admin_id TEXT,
  p_period_history_json JSONB,
  p_rollover_history_json JSONB,
  p_commission_earnings_json JSONB,
  p_supersede_reason TEXT DEFAULT 'Replaced by authoritative month close'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_period_id INT;
  v_period_status TEXT;
  v_ret_locked BOOLEAN := FALSE;
  v_audit_uuid UUID := gen_random_uuid();
  v_audit_id TEXT := v_audit_uuid::text;
  v_month_name TEXT;
  v_elem JSONB;
  v_hist_count INT := 0;
  v_rollover_count INT := 0;
  v_superseded_count INT := 0;
  v_earnings_count INT := 0;
  v_inv_id TEXT;
  v_yr INT;
  v_mo INT;
  v_manual_conflict INT := 0;
  v_ledger_key TEXT;
  v_calc_version TEXT := COALESCE(NULLIF(TRIM(p_calculation_version), ''), '3.0.0_atomic_v2');
BEGIN
  IF p_year IS NULL OR p_month_number IS NULL OR p_month_number < 1 OR p_month_number > 12 THEN
    RAISE EXCEPTION 'INVALID_PERIOD: Invalid year/month (%-%)', p_year, p_month_number;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('accounting_period_' || p_year::text || '_' || p_month_number::text));
  PERFORM set_config('app.accounting_engine_context', 'FINALIZING', TRUE);

  SELECT id, status INTO v_period_id, v_period_status
  FROM public.accounting_periods
  WHERE year = p_year AND month_number = p_month_number
  FOR UPDATE;

  IF FOUND AND UPPER(COALESCE(v_period_status, '')) = 'FINALIZED' THEN
    RAISE EXCEPTION 'PERIOD_ALREADY_FINALIZED: Period %-% is already finalized.', p_year, p_month_number;
  END IF;

  -- Row-lock monthly_returns row (freeze step sets locked=TRUE prior to finalization)
  SELECT locked INTO v_ret_locked
  FROM public.monthly_returns
  WHERE year = p_year AND month_number = p_month_number
  FOR UPDATE;

  -- Check no manual history collision exists for target period
  SELECT COUNT(*) INTO v_manual_conflict
  FROM public.investor_monthly_history
  WHERE year = p_year AND month_number = p_month_number AND is_manual = TRUE;

  IF v_manual_conflict > 0 THEN
    RAISE EXCEPTION 'MANUAL_HISTORY_COLLISION: % manual history record(s) exist for %-% and cannot be overwritten automatically.', v_manual_conflict, p_year, p_month_number;
  END IF;

  v_month_name := TRIM(TO_CHAR(MAKE_DATE(p_year, p_month_number, 1), 'FMMonth'));

  -- 1. Upsert accounting_periods -> FINALIZED
  INSERT INTO public.accounting_periods (
    year, month_number, status, fund_return_pct, return_source, return_status,
    return_captured_at, preview_input_hash, preview_run_id, finalized_at, finalized_by, calculation_version, updated_at
  ) VALUES (
    p_year, p_month_number, 'FINALIZED', p_gross_return_pct, p_return_source, p_return_status,
    NOW(), p_input_hash, p_preview_run_id, NOW(), p_admin_id, v_calc_version, NOW()
  )
  ON CONFLICT (year, month_number) DO UPDATE
  SET status = 'FINALIZED',
      fund_return_pct = EXCLUDED.fund_return_pct,
      return_source = EXCLUDED.return_source,
      return_status = EXCLUDED.return_status,
      return_captured_at = NOW(),
      preview_input_hash = EXCLUDED.preview_input_hash,
      preview_run_id = EXCLUDED.preview_run_id,
      finalized_at = NOW(),
      finalized_by = EXCLUDED.finalized_by,
      calculation_version = EXCLUDED.calculation_version,
      updated_at = NOW()
  RETURNING id INTO v_period_id;

  -- 2. Lock monthly_returns
  INSERT INTO public.monthly_returns (year, month_number, month, gross_return_pct, source, notes, locked, last_updated, created_at)
  VALUES (
    p_year, p_month_number, v_month_name, p_gross_return_pct, p_return_source,
    'Finalized via Atomic Accounting RPC v2', TRUE, NOW()::text, NOW()
  )
  ON CONFLICT (year, month_number) DO UPDATE
  SET month = COALESCE(EXCLUDED.month, public.monthly_returns.month),
      gross_return_pct = EXCLUDED.gross_return_pct,
      source = EXCLUDED.source,
      notes = EXCLUDED.notes,
      locked = TRUE,
      last_updated = NOW()::text;

  -- 3. Supersede any stale pre-existing ACTIVE commission_earnings for this period
  UPDATE public.commission_earnings
  SET status = 'SUPERSEDED',
      superseded_at = NOW(),
      superseded_by_audit_id = v_audit_id,
      audit_notes = COALESCE(NULLIF(TRIM(p_supersede_reason), ''), 'Replaced by authoritative month close')
  WHERE year = p_year
    AND month_number = p_month_number
    AND UPPER(TRIM(COALESCE(status, 'ACTIVE'))) = 'ACTIVE';
  GET DIAGNOSTICS v_superseded_count = ROW_COUNT;

  -- 4. Write Period M locked history rows
  IF p_period_history_json IS NOT NULL THEN
    FOR v_elem IN SELECT * FROM jsonb_array_elements(p_period_history_json) LOOP
      v_inv_id := v_elem->>'investor_id';
      IF v_inv_id IS NULL THEN
        v_inv_id := v_elem->>'investorId';
      END IF;
      IF v_inv_id IS NULL THEN
        CONTINUE;
      END IF;

      UPDATE public.investor_monthly_history
      SET opening_balance = COALESCE((v_elem->>'opening_balance')::NUMERIC, (v_elem->>'openingBalance')::NUMERIC, 0),
          deposits = COALESCE((v_elem->>'deposits')::NUMERIC, 0),
          withdrawals = COALESCE((v_elem->>'withdrawals')::NUMERIC, 0),
          gross_return_pct = COALESCE((v_elem->>'gross_return_pct')::NUMERIC, p_gross_return_pct),
          recurring_draw = COALESCE((v_elem->>'recurring_draw')::NUMERIC, (v_elem->>'recurringDraw')::NUMERIC, 0),
          ending_balance = COALESCE((v_elem->>'ending_balance')::NUMERIC, (v_elem->>'endingBalance')::NUMERIC, 0),
          is_manual = FALSE,
          locked = TRUE,
          notes = v_elem->>'notes',
          updated_at = NOW()
      WHERE investor_id = v_inv_id
        AND year = p_year
        AND month_number = p_month_number;

      IF NOT FOUND THEN
        INSERT INTO public.investor_monthly_history (
          id, investor_id, account_id, year, month_number, month,
          opening_balance, deposits, withdrawals, gross_return_pct,
          manual_gain_amount, manual_return_pct, recurring_draw, ending_balance,
          is_manual, locked, notes, created_at, updated_at
        ) VALUES (
          gen_random_uuid(),
          v_inv_id,
          v_elem->>'account_id',
          p_year,
          p_month_number,
          COALESCE(v_elem->>'month', v_month_name),
          COALESCE((v_elem->>'opening_balance')::NUMERIC, (v_elem->>'openingBalance')::NUMERIC, 0),
          COALESCE((v_elem->>'deposits')::NUMERIC, 0),
          COALESCE((v_elem->>'withdrawals')::NUMERIC, 0),
          COALESCE((v_elem->>'gross_return_pct')::NUMERIC, p_gross_return_pct),
          NULL,
          NULL,
          COALESCE((v_elem->>'recurring_draw')::NUMERIC, (v_elem->>'recurringDraw')::NUMERIC, 0),
          COALESCE((v_elem->>'ending_balance')::NUMERIC, (v_elem->>'endingBalance')::NUMERIC, 0),
          FALSE,
          TRUE,
          v_elem->>'notes',
          NOW(),
          NOW()
        );
      END IF;
      v_hist_count := v_hist_count + 1;
    END LOOP;
  END IF;

  -- 5. Write NEW ACTIVE commission_earnings rows (always use versioned unique ledger_key when superseding old ones)
  IF p_commission_earnings_json IS NOT NULL THEN
    FOR v_elem IN SELECT * FROM jsonb_array_elements(p_commission_earnings_json) LOOP
      IF COALESCE((v_elem->>'amount')::NUMERIC, 0) <= 0 THEN
        CONTINUE;
      END IF;

      v_ledger_key := COALESCE(
        NULLIF(TRIM(v_elem->>'ledger_key'), ''),
        p_year::text || '_' || p_month_number::text || '_' ||
        COALESCE(v_elem->>'source_investor_id', v_elem->>'sourceInvestorId', 'SRC') || '_' ||
        COALESCE(v_elem->>'source_account_id', v_elem->>'sourceAccountId', 'DEFAULT') || '_' ||
        COALESCE(v_elem->>'recipient_id', v_elem->>'recipientId', 'REC')
      );

      IF EXISTS (SELECT 1 FROM public.commission_earnings WHERE ledger_key = v_ledger_key) THEN
        v_ledger_key := v_ledger_key || '_' || substr(v_audit_id, 1, 8);
      END IF;

      INSERT INTO public.commission_earnings (
        id, recipient_id, source_investor_id, source_account_id,
        year, month_number, amount, commission_percent_snapshot,
        commission_share_rule_id, calculation_version, accounting_period_id,
        status, ledger_key, created_at
      ) VALUES (
        gen_random_uuid(),
        COALESCE(v_elem->>'recipient_id', v_elem->>'recipientId'),
        COALESCE(v_elem->>'source_investor_id', v_elem->>'sourceInvestorId'),
        COALESCE(v_elem->>'source_account_id', v_elem->>'sourceAccountId'),
        p_year,
        p_month_number,
        (v_elem->>'amount')::NUMERIC,
        COALESCE((v_elem->>'commission_percent_snapshot')::NUMERIC, (v_elem->>'commissionPercentSnapshot')::NUMERIC),
        COALESCE(v_elem->>'commission_share_rule_id', v_elem->>'commissionShareRuleId'),
        COALESCE(v_elem->>'calculation_version', v_calc_version),
        v_period_id,
        'ACTIVE',
        v_ledger_key,
        NOW()
      );
      v_earnings_count := v_earnings_count + 1;
    END LOOP;
  END IF;

  -- 6. Roll forward unlocked open placeholder rows (M+1 / M+2)
  IF p_rollover_history_json IS NOT NULL THEN
    FOR v_elem IN SELECT * FROM jsonb_array_elements(p_rollover_history_json) LOOP
      v_inv_id := COALESCE(v_elem->>'investor_id', v_elem->>'investorId');
      v_yr := (v_elem->>'year')::INT;
      v_mo := COALESCE((v_elem->>'month_number')::INT, (v_elem->>'monthNumber')::INT);
      IF v_inv_id IS NULL OR v_yr IS NULL OR v_mo IS NULL THEN
        CONTINUE;
      END IF;

      UPDATE public.investor_monthly_history
      SET opening_balance = COALESCE((v_elem->>'opening_balance')::NUMERIC, (v_elem->>'openingBalance')::NUMERIC, 0),
          deposits = COALESCE((v_elem->>'deposits')::NUMERIC, 0),
          withdrawals = COALESCE((v_elem->>'withdrawals')::NUMERIC, 0),
          gross_return_pct = COALESCE((v_elem->>'gross_return_pct')::NUMERIC, 0),
          recurring_draw = COALESCE((v_elem->>'recurring_draw')::NUMERIC, (v_elem->>'recurringDraw')::NUMERIC, 0),
          ending_balance = COALESCE((v_elem->>'ending_balance')::NUMERIC, (v_elem->>'endingBalance')::NUMERIC, 0),
          notes = v_elem->>'notes',
          updated_at = NOW()
      WHERE investor_id = v_inv_id
        AND year = v_yr
        AND month_number = v_mo
        AND COALESCE(locked, FALSE) = FALSE
        AND COALESCE(is_manual, FALSE) = FALSE;

      IF NOT FOUND AND NOT EXISTS (
        SELECT 1 FROM public.investor_monthly_history
        WHERE investor_id = v_inv_id AND year = v_yr AND month_number = v_mo
      ) THEN
        INSERT INTO public.investor_monthly_history (
          id, investor_id, account_id, year, month_number, month,
          opening_balance, deposits, withdrawals, gross_return_pct,
          manual_gain_amount, manual_return_pct, recurring_draw, ending_balance,
          is_manual, locked, notes, created_at, updated_at
        ) VALUES (
          gen_random_uuid(),
          v_inv_id,
          v_elem->>'account_id',
          v_yr,
          v_mo,
          COALESCE(v_elem->>'month', TRIM(TO_CHAR(MAKE_DATE(v_yr, v_mo, 1), 'FMMonth'))),
          COALESCE((v_elem->>'opening_balance')::NUMERIC, (v_elem->>'openingBalance')::NUMERIC, 0),
          COALESCE((v_elem->>'deposits')::NUMERIC, 0),
          COALESCE((v_elem->>'withdrawals')::NUMERIC, 0),
          COALESCE((v_elem->>'gross_return_pct')::NUMERIC, 0),
          NULL,
          NULL,
          COALESCE((v_elem->>'recurring_draw')::NUMERIC, (v_elem->>'recurringDraw')::NUMERIC, 0),
          COALESCE((v_elem->>'ending_balance')::NUMERIC, (v_elem->>'endingBalance')::NUMERIC, 0),
          FALSE,
          FALSE,
          v_elem->>'notes',
          NOW(),
          NOW()
        );
      END IF;
      v_rollover_count := v_rollover_count + 1;
    END LOOP;
  END IF;

  -- 7. Record Audit Run
  INSERT INTO public.audit_runs (
    id, admin_id, source_investor_id, year, month_number, report_json, created_at
  ) VALUES (
    v_audit_uuid,
    p_admin_id,
    NULL,
    p_year,
    p_month_number,
    jsonb_build_object(
      'finalized_at', NOW(),
      'calculation_version', v_calc_version,
      'input_hash', p_input_hash,
      'preview_run_id', p_preview_run_id,
      'gross_return_pct', p_gross_return_pct,
      'history_records_written', v_hist_count,
      'rollover_records_written', v_rollover_count,
      'superseded_commissions_count', v_superseded_count,
      'earnings_records_written', v_earnings_count
    ),
    NOW()
  );

  RETURN jsonb_build_object(
    'status', 'SUCCESS',
    'auditId', v_audit_id,
    'periodId', v_period_id,
    'year', p_year,
    'month', p_month_number,
    'historyCount', v_hist_count,
    'rolloverCount', v_rollover_count,
    'supersededCount', v_superseded_count,
    'earningsCount', v_earnings_count,
    'inputHash', p_input_hash
  );
END;
$$;

-- =============================================================================
-- 11. STRICT PERMISSIONS GRANTS & REVOCATIONS
-- =============================================================================
REVOKE ALL ON FUNCTION public.create_withdrawal_atomic(text, text, numeric, date, text, text, text, text, boolean, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_withdrawal_atomic(text, numeric, text, text, text, date, int, int, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_deposit_atomic(text, text, numeric, date, date, text, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_payment_provider_event_atomic(text, text, text, text, text, numeric, date, text, jsonb, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finalize_monthly_accounting_v2(int, int, numeric, text, text, text, text, text, text, jsonb, jsonb, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.calculate_available_withdrawal_equity_sql(text, text, date, text) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.create_withdrawal_atomic(text, text, numeric, date, text, text, text, text, boolean, boolean) FROM anon;
    REVOKE ALL ON FUNCTION public.update_withdrawal_atomic(text, numeric, text, text, text, date, int, int, text, boolean) FROM anon;
    REVOKE ALL ON FUNCTION public.create_deposit_atomic(text, text, numeric, date, date, text, text, text, text, text, text) FROM anon;
    REVOKE ALL ON FUNCTION public.process_payment_provider_event_atomic(text, text, text, text, text, numeric, date, text, jsonb, text, boolean) FROM anon;
    REVOKE ALL ON FUNCTION public.finalize_monthly_accounting_v2(int, int, numeric, text, text, text, text, text, text, jsonb, jsonb, jsonb, text) FROM anon;
    REVOKE ALL ON FUNCTION public.calculate_available_withdrawal_equity_sql(text, text, date, text) FROM anon;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.process_payment_provider_event_atomic(text, text, text, text, text, numeric, date, text, jsonb, text, boolean) FROM authenticated;
    REVOKE ALL ON FUNCTION public.finalize_monthly_accounting_v2(int, int, numeric, text, text, text, text, text, text, jsonb, jsonb, jsonb, text) FROM authenticated;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.create_withdrawal_atomic(text, text, numeric, date, text, text, text, text, boolean, boolean) TO service_role;
    GRANT EXECUTE ON FUNCTION public.update_withdrawal_atomic(text, numeric, text, text, text, date, int, int, text, boolean) TO service_role;
    GRANT EXECUTE ON FUNCTION public.create_deposit_atomic(text, text, numeric, date, date, text, text, text, text, text, text) TO service_role;
    GRANT EXECUTE ON FUNCTION public.process_payment_provider_event_atomic(text, text, text, text, text, numeric, date, text, jsonb, text, boolean) TO service_role;
    GRANT EXECUTE ON FUNCTION public.finalize_monthly_accounting_v2(int, int, numeric, text, text, text, text, text, text, jsonb, jsonb, jsonb, text) TO service_role;
    GRANT EXECUTE ON FUNCTION public.calculate_available_withdrawal_equity_sql(text, text, date, text) TO service_role;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
