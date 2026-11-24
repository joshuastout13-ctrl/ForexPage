-- =============================================================================
-- Migration (DRAFT — NOT APPLIED): Atomic Admin Investor Profile & Accounts Edit
-- Target: Supabase PostgreSQL (public schema)
-- Scope:  PATCH / PUT /api/admin/investors/[id] ONLY
--
-- SAFETY & DEPLOYMENT PREREQUISITES:
--   1. Additive RPC function only (0 table ALTERs, 0 financial data mutations,
--      0 changes to financial formulas or DELETE / other routes).
--   2. Requires explicit owner authorization before applying to Supabase.
--   3. Must be applied and verified in Production BEFORE deploying the updated
--      api/admin/investors/[id].js route that invokes this RPC.
--   4. Optional column dependency: public.investors.show_fund_performance is NOT
--      part of supabase/schema.sql (it lives in docs/proposed_show_fund_performance_migration.sql).
--      Because admin.html always sends showFundPerformance on investor edits,
--      verify via read-only catalog check whether public.investors.show_fund_performance
--      exists in Production before deploying. If absent and requested, this RPC
--      fails closed with SCHEMA_COLUMN_MISSING rather than silently discarding it.
-- =============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.update_investor_profile_and_accounts_atomic(
  text,
  jsonb,
  jsonb,
  text,
  boolean,
  jsonb
);

CREATE OR REPLACE FUNCTION public.update_investor_profile_and_accounts_atomic(
  p_investor_id TEXT,
  p_investor_updates JSONB DEFAULT '{}'::jsonb,
  p_account_updates JSONB DEFAULT '{}'::jsonb,
  p_target_portal_username TEXT DEFAULT NULL,
  p_create_account_if_missing BOOLEAN DEFAULT FALSE,
  p_create_account_payload JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_investor_updates JSONB := COALESCE(p_investor_updates, '{}'::jsonb);
  v_account_updates JSONB := COALESCE(p_account_updates, '{}'::jsonb);
  v_create_if_missing BOOLEAN := COALESCE(p_create_account_if_missing, FALSE);
  v_unknown_key TEXT;
  v_split_check NUMERIC;
  v_has_show_fund_perf_update BOOLEAN := FALSE;
  v_has_show_fund_perf_col BOOLEAN := FALSE;
  v_has_base_investor_updates BOOLEAN := FALSE;
  v_lock_key BIGINT;
  v_investor RECORD;
  v_updated_investor RECORD;
  v_updated_investor_json JSONB;
  v_target_portal_username TEXT := '';
  v_acc_rec RECORD;
  v_matched_account_ids TEXT[] := ARRAY[]::TEXT[];
  v_accounts_updated INT := 0;
  v_account_created BOOLEAN := FALSE;
BEGIN
  -- 1. Validate inputs and enforce strict field whitelists before acquiring locks or writing
  IF NULLIF(TRIM(COALESCE(p_investor_id, '')), '') IS NULL THEN
    RAISE EXCEPTION 'INVALID_INVESTOR_ID: Investor ID is required.';
  END IF;

  IF jsonb_typeof(v_investor_updates) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_INVESTOR_UPDATES: p_investor_updates must be a JSON object.';
  END IF;

  IF jsonb_typeof(v_account_updates) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_ACCOUNT_UPDATES: p_account_updates must be a JSON object.';
  END IF;

  SELECT k INTO v_unknown_key
  FROM jsonb_object_keys(v_investor_updates) AS k
  WHERE k NOT IN (
    'first_name',
    'last_name',
    'email',
    'portal_username',
    'temp_password',
    'split_pct',
    'monthly_draw',
    'start_date',
    'role',
    'show_fund_performance',
    'notes'
  )
  LIMIT 1;

  IF v_unknown_key IS NOT NULL THEN
    RAISE EXCEPTION 'UNSUPPORTED_INVESTOR_FIELD: Field "%" is not allowed in update_investor_profile_and_accounts_atomic.', v_unknown_key;
  END IF;

  SELECT k INTO v_unknown_key
  FROM jsonb_object_keys(v_account_updates) AS k
  WHERE k NOT IN (
    'name',
    'starting_capital',
    'total_cash_in',
    'is_commission',
    'split_pct',
    'open_date'
  )
  LIMIT 1;

  IF v_unknown_key IS NOT NULL THEN
    RAISE EXCEPTION 'UNSUPPORTED_ACCOUNT_FIELD: Field "%" is not allowed in update_investor_profile_and_accounts_atomic.', v_unknown_key;
  END IF;

  -- Keep upfront JSON shape & key-whitelisting security check whenever payload is provided,
  -- while deferring insert-only required-field/value checks until step 7 (0 matched accounts).
  IF p_create_account_payload IS NOT NULL THEN
    IF jsonb_typeof(p_create_account_payload) <> 'object' THEN
      RAISE EXCEPTION 'INVALID_CREATE_ACCOUNT_PAYLOAD: p_create_account_payload must be a JSON object.';
    END IF;

    SELECT k INTO v_unknown_key
    FROM jsonb_object_keys(p_create_account_payload) AS k
    WHERE k NOT IN (
      'id',
      'investor_id',
      'name',
      'starting_capital',
      'total_cash_in',
      'open_date',
      'status',
      'is_commission',
      'split_pct',
      'notes'
    )
    LIMIT 1;

    IF v_unknown_key IS NOT NULL THEN
      RAISE EXCEPTION 'UNSUPPORTED_CREATE_ACCOUNT_FIELD: Field "%" is not allowed in update_investor_profile_and_accounts_atomic.', v_unknown_key;
    END IF;
  END IF;

  -- Defense-in-depth split_pct bounds matching route validation [0, 100]
  IF v_investor_updates ? 'split_pct' AND v_investor_updates->>'split_pct' IS NOT NULL THEN
    v_split_check := (v_investor_updates->>'split_pct')::numeric;
    IF v_split_check < 0 OR v_split_check > 100 THEN
      RAISE EXCEPTION 'Invalid split percentage: must be between 0 and 100';
    END IF;
  END IF;

  IF v_account_updates ? 'split_pct' AND v_account_updates->>'split_pct' IS NOT NULL THEN
    v_split_check := (v_account_updates->>'split_pct')::numeric;
    IF v_split_check < 0 OR v_split_check > 100 THEN
      RAISE EXCEPTION 'Invalid split percentage: must be between 0 and 100';
    END IF;
  END IF;

  -- Optional schema column guard: fail closed instead of silently discarding requested show_fund_performance
  v_has_show_fund_perf_update := (v_investor_updates ? 'show_fund_performance');
  IF v_has_show_fund_perf_update THEN
    IF jsonb_typeof(v_investor_updates->'show_fund_performance') <> 'boolean' THEN
      RAISE EXCEPTION 'INVALID_SHOW_FUND_PERFORMANCE: show_fund_performance must be a boolean.';
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_attribute
      WHERE attrelid = 'public.investors'::regclass
        AND attname = 'show_fund_performance'
        AND attnum > 0
        AND NOT attisdropped
    ) INTO v_has_show_fund_perf_col;

    IF NOT v_has_show_fund_perf_col THEN
      RAISE EXCEPTION 'SCHEMA_COLUMN_MISSING: Column public.investors.show_fund_performance does not exist. Apply docs/proposed_show_fund_performance_migration.sql before updating show_fund_performance.';
    END IF;
  END IF;

  -- 2. Serialize per-investor mutations using checked-in repository advisory lock helper
  v_lock_key := public.financial_lock_key(p_investor_id);
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- 3. Lock target investor row using exact case-sensitive id equality (matching .eq("id", id))
  SELECT * INTO v_investor
  FROM public.investors
  WHERE id = p_investor_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVESTOR_NOT_FOUND: Investor % does not exist.', p_investor_id;
  END IF;

  -- 4. Update base checked-in investors columns atomically
  v_has_base_investor_updates := ((v_investor_updates - 'show_fund_performance') <> '{}'::jsonb);

  IF v_has_base_investor_updates THEN
    UPDATE public.investors
    SET
      first_name      = CASE WHEN v_investor_updates ? 'first_name'      THEN v_investor_updates->>'first_name'               ELSE first_name END,
      last_name       = CASE WHEN v_investor_updates ? 'last_name'       THEN v_investor_updates->>'last_name'                ELSE last_name END,
      email           = CASE WHEN v_investor_updates ? 'email'           THEN v_investor_updates->>'email'                    ELSE email END,
      portal_username = CASE WHEN v_investor_updates ? 'portal_username' THEN v_investor_updates->>'portal_username'          ELSE portal_username END,
      temp_password   = CASE WHEN v_investor_updates ? 'temp_password'   THEN v_investor_updates->>'temp_password'            ELSE temp_password END,
      split_pct       = CASE WHEN v_investor_updates ? 'split_pct'       THEN (v_investor_updates->>'split_pct')::numeric     ELSE split_pct END,
      monthly_draw    = CASE WHEN v_investor_updates ? 'monthly_draw'    THEN (v_investor_updates->>'monthly_draw')::numeric  ELSE monthly_draw END,
      start_date      = CASE WHEN v_investor_updates ? 'start_date'      THEN (v_investor_updates->>'start_date')::date       ELSE start_date END,
      role            = CASE WHEN v_investor_updates ? 'role'            THEN v_investor_updates->>'role'                     ELSE role END,
      notes           = CASE WHEN v_investor_updates ? 'notes'           THEN v_investor_updates->>'notes'                    ELSE notes END,
      updated_at      = NOW()
    WHERE id = p_investor_id
    RETURNING * INTO v_updated_investor;
  ELSE
    v_updated_investor := v_investor;
  END IF;

  v_updated_investor_json := to_jsonb(v_updated_investor);

  -- Update optional show_fund_performance in the same transaction via fixed literal SQL (no dynamic identifiers)
  IF v_has_show_fund_perf_update THEN
    EXECUTE 'UPDATE public.investors AS i SET show_fund_performance = $1, updated_at = NOW() WHERE i.id = $2 RETURNING to_jsonb(i)'
      INTO v_updated_investor_json
      USING (v_investor_updates->>'show_fund_performance')::boolean, p_investor_id;
  END IF;

  -- 5. Resolve targetPortalUsername with exact legacy semantics:
  --    body.portalUsername || (data && data[0] ? data[0].portal_username : "")
  --    (No invented old-username fallback.)
  v_target_portal_username := COALESCE(
    NULLIF(p_target_portal_username, ''),
    NULLIF(v_updated_investor_json->>'portal_username', ''),
    ''
  );

  -- 6. Lock all matching investor_accounts rows in deterministic ORDER BY id ASC
  --    reproducing the exact 3-clause account-matching predicate from api/admin/investors/[id].js
  FOR v_acc_rec IN
    SELECT a.id
    FROM public.investor_accounts a
    WHERE LOWER(COALESCE(a.investor_id, '')) = LOWER(COALESCE(p_investor_id, ''))
       OR (
         v_target_portal_username <> ''
         AND (
           LOWER(COALESCE(a.investor_id, '')) = LOWER(v_target_portal_username)
           OR LOWER(COALESCE(a.id, '')) = LOWER(v_target_portal_username)
         )
       )
    ORDER BY a.id ASC
    FOR UPDATE
  LOOP
    v_matched_account_ids := array_append(v_matched_account_ids, v_acc_rec.id);
  END LOOP;

  -- 7. Update all matched accounts, or insert one account when 0 matched and startingCapital trigger is active
  IF cardinality(v_matched_account_ids) > 0 THEN
    IF v_account_updates <> '{}'::jsonb THEN
      UPDATE public.investor_accounts
      SET
        name             = CASE WHEN v_account_updates ? 'name'             THEN v_account_updates->>'name'                        ELSE name END,
        starting_capital = CASE WHEN v_account_updates ? 'starting_capital' THEN (v_account_updates->>'starting_capital')::numeric ELSE starting_capital END,
        total_cash_in    = CASE WHEN v_account_updates ? 'total_cash_in'    THEN (v_account_updates->>'total_cash_in')::numeric    ELSE total_cash_in END,
        is_commission    = CASE WHEN v_account_updates ? 'is_commission'    THEN (v_account_updates->>'is_commission')::boolean    ELSE is_commission END,
        split_pct        = CASE WHEN v_account_updates ? 'split_pct'        THEN (v_account_updates->>'split_pct')::numeric        ELSE split_pct END,
        open_date        = CASE WHEN v_account_updates ? 'open_date'        THEN (v_account_updates->>'open_date')::date           ELSE open_date END,
        updated_at       = NOW()
      WHERE id = ANY(v_matched_account_ids);

      GET DIAGNOSTICS v_accounts_updated = ROW_COUNT;
    END IF;
  ELSIF v_create_if_missing THEN
    -- Insert-only required-field and format checks run only when 0 existing accounts matched
    IF p_create_account_payload IS NULL THEN
      RAISE EXCEPTION 'INVALID_CREATE_ACCOUNT_PAYLOAD: p_create_account_payload must be a JSON object when creating a missing account.';
    END IF;

    IF NULLIF(TRIM(COALESCE(p_create_account_payload->>'id', '')), '') IS NULL THEN
      RAISE EXCEPTION 'INVALID_ACCOUNT_ID: Created account payload requires a non-empty id.';
    END IF;

    IF COALESCE(p_create_account_payload->>'investor_id', p_investor_id) <> p_investor_id THEN
      RAISE EXCEPTION 'INVESTOR_ID_MISMATCH: Created account investor_id must match p_investor_id.';
    END IF;

    IF p_create_account_payload ? 'split_pct' AND p_create_account_payload->>'split_pct' IS NOT NULL THEN
      v_split_check := (p_create_account_payload->>'split_pct')::numeric;
      IF v_split_check < 0 OR v_split_check > 100 THEN
        RAISE EXCEPTION 'Invalid split percentage: must be between 0 and 100';
      END IF;
    END IF;

    INSERT INTO public.investor_accounts (
      id,
      investor_id,
      name,
      starting_capital,
      total_cash_in,
      open_date,
      status,
      is_commission,
      split_pct,
      notes,
      created_at,
      updated_at
    ) VALUES (
      p_create_account_payload->>'id',
      p_investor_id,
      p_create_account_payload->>'name',
      (p_create_account_payload->>'starting_capital')::numeric,
      (p_create_account_payload->>'total_cash_in')::numeric,
      (p_create_account_payload->>'open_date')::date,
      COALESCE(p_create_account_payload->>'status', 'Active'),
      COALESCE((p_create_account_payload->>'is_commission')::boolean, FALSE),
      COALESCE((p_create_account_payload->>'split_pct')::numeric, 100),
      COALESCE(p_create_account_payload->>'notes', 'Created via Admin Dashboard update'),
      NOW(),
      NOW()
    );

    v_account_created := TRUE;
  END IF;

  RETURN jsonb_build_object(
    'status', 'SUCCESS',
    'investor', v_updated_investor_json,
    'accounts_updated', v_accounts_updated,
    'account_created', v_account_created
  );
END;
$$;

-- =============================================================================
-- STRICT LEAST-PRIVILEGE EXECUTE GRANTS (service_role ONLY)
-- =============================================================================
REVOKE ALL ON FUNCTION public.update_investor_profile_and_accounts_atomic(
  text,
  jsonb,
  jsonb,
  text,
  boolean,
  jsonb
) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.update_investor_profile_and_accounts_atomic(
      text,
      jsonb,
      jsonb,
      text,
      boolean,
      jsonb
    ) FROM anon;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.update_investor_profile_and_accounts_atomic(
      text,
      jsonb,
      jsonb,
      text,
      boolean,
      jsonb
    ) FROM authenticated;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.update_investor_profile_and_accounts_atomic(
      text,
      jsonb,
      jsonb,
      text,
      boolean,
      jsonb
    ) TO service_role;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
