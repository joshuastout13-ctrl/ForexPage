-- =============================================================================
-- Migration: Sync investor_accounts.open_date, align SQL equity start-date
--            resolution with JS validator, and harden atomic duplicate guards
-- Target: julhldzkiqdeuuoqmvlo (Stone - Forex)
-- =============================================================================

-- 1. Sync stale investor_accounts.open_date with authoritative investors.start_date
--    (verified across all 16 mismatched rows from 2026 monthly history)
UPDATE public.investor_accounts AS a
SET open_date = i.start_date,
    notes = CASE
      WHEN COALESCE(a.notes, '') = '' THEN '[2026-11-20] Synced open_date to authoritative investors.start_date (' || i.start_date::text || ')'
      WHEN a.notes NOT LIKE '%Synced open_date to authoritative%' THEN a.notes || E'\n[2026-11-20] Synced open_date from ' || COALESCE(a.open_date::text, 'NULL') || ' to ' || i.start_date::text
      ELSE a.notes
    END,
    updated_at = NOW()
FROM public.investors AS i
WHERE a.investor_id = i.id
  AND i.start_date IS NOT NULL
  AND a.open_date IS DISTINCT FROM i.start_date;

-- 2. Replace random UUID fallback in duplicate-protection triggers with
--    deterministic fallback keys so unkeyed direct inserts collide cleanly
CREATE OR REPLACE FUNCTION public.fn_enforce_withdrawal_duplicate_protection()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.idempotency_key IS NOT NULL AND btrim(NEW.idempotency_key) != '' THEN
    RETURN NEW;
  END IF;

  IF NEW.transfer_id IS NOT NULL THEN
    NEW.idempotency_key := 'xfer_' || LOWER(COALESCE(NULLIF(btrim(NEW.transfer_leg), ''), 'debit')) || '_' || NEW.transfer_id::text;
    RETURN NEW;
  END IF;

  NEW.idempotency_key := 'wd_auto_' || COALESCE(NEW.investor_id, 'unknown') || '_' ||
    COALESCE(NEW.effective_accounting_date::text, NEW.request_date::text, 'nodate') || '_' ||
    round(COALESCE(NEW.amount, 0) * 100)::text;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_enforce_deposit_duplicate_protection()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.transfer_id IS NOT NULL AND UPPER(COALESCE(NEW.accounting_treatment, '')) != 'INTERNAL_TRANSFER' THEN
    RAISE EXCEPTION 'INTERNAL_TRANSFER_MISCLASSIFIED: Deposit with transfer_id must have accounting_treatment = INTERNAL_TRANSFER';
  END IF;

  IF NEW.idempotency_key IS NOT NULL AND btrim(NEW.idempotency_key) != '' THEN
    RETURN NEW;
  END IF;

  IF NEW.transfer_id IS NOT NULL THEN
    NEW.idempotency_key := 'xfer_' || LOWER(COALESCE(NULLIF(btrim(NEW.transfer_leg), ''), 'credit')) || '_' || NEW.transfer_id::text;
    RETURN NEW;
  END IF;

  NEW.idempotency_key := 'dep_auto_' || COALESCE(NEW.investor_id, 'unknown') || '_' ||
    COALESCE(NEW.effective_accounting_date::text, NEW.date::text, 'nodate') || '_' ||
    round(COALESCE(NEW.amount, 0) * 100)::text || '_' ||
    UPPER(COALESCE(NEW.accounting_treatment, 'NEW_CASH'));
  RETURN NEW;
END;
$function$;

-- 3. Align calculate_available_withdrawal_equity_sql with JS validator:
--    authoritative start_date first, diagnostic warning on metadata drift
CREATE OR REPLACE FUNCTION public.calculate_available_withdrawal_equity_sql(
  p_investor_id text,
  p_account_id text,
  p_effective_date date,
  p_exclude_withdrawal_id text DEFAULT NULL::text
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
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
  v_effective_start_date := COALESCE(v_inv_start_date, v_acc_open_date, '2026-01-01'::DATE);

  IF v_acc_open_date IS NOT NULL AND v_inv_start_date IS NOT NULL THEN
    IF EXTRACT(YEAR FROM v_acc_open_date) != EXTRACT(YEAR FROM v_inv_start_date)
       OR EXTRACT(MONTH FROM v_acc_open_date) != EXTRACT(MONTH FROM v_inv_start_date) THEN
      RAISE WARNING 'METADATA_START_DATE_DISCREPANCY: Account open period (%-%) differs from investor start period (%-%) for investor %.',
        EXTRACT(YEAR FROM v_acc_open_date)::INT, EXTRACT(MONTH FROM v_acc_open_date)::INT,
        EXTRACT(YEAR FROM v_inv_start_date)::INT, EXTRACT(MONTH FROM v_inv_start_date)::INT,
        p_investor_id;
    END IF;
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
$function$;

-- 4. Harden create_withdrawal_atomic: require idempotency key AND enforce
--    p_allow_duplicate_amount duplicate detection under advisory lock
CREATE OR REPLACE FUNCTION public.create_withdrawal_atomic(
  p_investor_id text,
  p_account_id text,
  p_amount numeric,
  p_effective_date date,
  p_status text DEFAULT 'Pending'::text,
  p_notes text DEFAULT NULL::text,
  p_idempotency_key text DEFAULT NULL::text,
  p_created_by text DEFAULT NULL::text,
  p_allow_duplicate_amount boolean DEFAULT false,
  p_is_draw boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
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
  v_duplicate_id TEXT;
  v_duplicate_status TEXT;
  v_duplicate_key TEXT;
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

  IF p_idempotency_key IS NULL OR TRIM(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'MISSING_IDEMPOTENCY_KEY: p_idempotency_key is strictly required for create_withdrawal_atomic.';
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

  IF NOT COALESCE(p_allow_duplicate_amount, FALSE)
     AND v_normalized_status IN ('Pending', 'Approved', 'Completed') THEN
    SELECT id, status, idempotency_key
    INTO v_duplicate_id, v_duplicate_status, v_duplicate_key
    FROM public.withdrawals
    WHERE investor_id = p_investor_id
      AND COALESCE(account_id, '') = COALESCE(p_account_id, '')
      AND COALESCE(effective_accounting_date, DATE_TRUNC('month', request_date)::DATE) = p_effective_date
      AND amount = p_amount
      AND LOWER(TRIM(COALESCE(status, ''))) IN ('pending', 'approved', 'completed')
    LIMIT 1;

    IF v_duplicate_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'status', 'DUPLICATE_ECONOMIC_TRANSACTION',
        'error', format('DUPLICATE_ECONOMIC_TRANSACTION: An active withdrawal of identical amount ($%s) already exists for this account and period (ID: %s, Status: %s). If this is a separate legitimate distribution, pass allow_duplicate_amount=true.',
          TO_CHAR(p_amount, 'FM999,999,990.00'), v_duplicate_id, v_duplicate_status),
        'existing_withdrawal_id', v_duplicate_id,
        'existing_withdrawal_status', v_duplicate_status,
        'existing_idempotency_key', v_duplicate_key,
        'amount', p_amount,
        'effective_accounting_date', p_effective_date
      );
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
    TRIM(p_idempotency_key),
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
$function$;

-- 5. Harden create_deposit_atomic: require idempotency key and compare
--    effective_accounting_date & status on idempotent replay
CREATE OR REPLACE FUNCTION public.create_deposit_atomic(
  p_investor_id text,
  p_account_id text,
  p_amount numeric,
  p_date date,
  p_effective_date date,
  p_accounting_treatment text DEFAULT 'NEW_CASH'::text,
  p_status text DEFAULT 'confirmed'::text,
  p_type text DEFAULT 'Wire'::text,
  p_notes text DEFAULT NULL::text,
  p_idempotency_key text DEFAULT NULL::text,
  p_created_by text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
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

  IF p_idempotency_key IS NULL OR TRIM(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'MISSING_IDEMPOTENCY_KEY: p_idempotency_key is strictly required for create_deposit_atomic.';
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

  SELECT * INTO v_existing
  FROM public.deposits
  WHERE idempotency_key = TRIM(p_idempotency_key)
  LIMIT 1;

  IF v_existing.id IS NOT NULL THEN
    IF v_existing.investor_id = p_investor_id
       AND COALESCE(v_existing.account_id, '') = COALESCE(p_account_id, '')
       AND v_existing.amount = p_amount
       AND v_existing.accounting_treatment = v_normalized_treatment
       AND v_existing.effective_accounting_date IS NOT DISTINCT FROM v_eff_date
       AND LOWER(COALESCE(v_existing.status, '')) = v_normalized_status THEN
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
    TRIM(p_idempotency_key),
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
$function$;

NOTIFY pgrst, 'reload schema';
