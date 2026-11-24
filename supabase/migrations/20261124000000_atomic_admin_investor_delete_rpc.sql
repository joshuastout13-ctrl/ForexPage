-- =============================================================================
-- Migration (DRAFT — NOT APPLIED): Atomic Fail-Closed Draft Investor Deletion
-- Target: Supabase PostgreSQL (public schema)
-- Scope:  DELETE /api/admin/investors/[id] ONLY
--
-- SAFETY & DEPLOYMENT PREREQUISITES:
--   1. Additive RPC function only (0 table ALTERs, 0 trigger alterations,
--      0 financial or audit record mutations, 0 changes to PATCH/PUT or other
--      routes).
--   2. Requires explicit owner authorization before applying to Supabase.
--   3. Must be applied and verified in Production BEFORE deploying the updated
--      api/admin/investors/[id].js DELETE path that invokes this RPC.
--   4. Strictly never deletes, cascade-deletes, or alters financial or audit
--      records (including deposits, withdrawals, investor_monthly_history,
--      commission_earnings, commission_shares, snapshots, audit_runs,
--      account_cutover_adjustments, internal_transfers, commission_rules, and
--      payment_provider_events).
--   5. Fails closed via pg_catalog inspection if any required table is missing,
--      any optional checked-in table has an unrecognized schema, any unverified
--      foreign key anywhere in the database references public.investors or
--      public.investor_accounts, or any non-internal DELETE trigger exists on
--      public.investors or public.investor_accounts.
-- =============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.delete_draft_investor_atomic(text);

CREATE OR REPLACE FUNCTION public.delete_draft_investor_atomic(
  p_investor_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_investor_id TEXT;
  v_lock_key BIGINT;
  v_investor RECORD;
  v_portal_username TEXT := '';
  v_prelock_acc_id TEXT;
  v_advisory_locked_acc_ids TEXT[] := ARRAY[]::TEXT[];
  v_acc_rec RECORD;
  v_owned_account_ids TEXT[] := ARRAY[]::TEXT[];
  v_all_ids TEXT[] := ARRAY[]::TEXT[];
  v_norm_acc_id TEXT;
  v_missing_table TEXT;
  v_unverified_fk RECORD;
  v_unverified_trigger RECORD;
  v_funded_accounts_count BIGINT := 0;
  v_provenance_accounts_count BIGINT := 0;
  v_extra_prov_count BIGINT := 0;
  v_deposits_count BIGINT := 0;
  v_withdrawals_count BIGINT := 0;
  v_history_count BIGINT := 0;
  v_commission_earnings_count BIGINT := 0;
  v_commission_shares_count BIGINT := 0;
  v_snapshots_count BIGINT := 0;
  v_audit_runs_count BIGINT := 0;
  v_cutover_count BIGINT := 0;
  v_transfers_count BIGINT := 0;
  v_commission_rules_count BIGINT := 0;
  v_payment_events_count BIGINT := 0;
  v_total_protected_records BIGINT := 0;
  v_has_col BOOLEAN := FALSE;
  v_has_col2 BOOLEAN := FALSE;
  v_has_col3 BOOLEAN := FALSE;
  v_has_col4 BOOLEAN := FALSE;
  v_rules_clauses TEXT[] := ARRAY[]::TEXT[];
  v_deleted_accounts INT := 0;
  v_deleted_investors INT := 0;
BEGIN
  -- 1. Validate investor ID before acquiring locks or reading tables
  v_investor_id := NULLIF(BTRIM(COALESCE(p_investor_id, '')), '');
  IF v_investor_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_INVESTOR_ID: Investor ID is required.';
  END IF;

  -- 2. Fail closed if any required core financial/audit table is absent
  FOREACH v_missing_table IN ARRAY ARRAY[
    'investors',
    'investor_accounts',
    'deposits',
    'withdrawals',
    'investor_monthly_history',
    'commission_earnings',
    'commission_shares',
    'snapshots',
    'audit_runs',
    'internal_transfers'
  ] LOOP
    IF to_regclass('public.' || v_missing_table) IS NULL THEN
      RAISE EXCEPTION 'REQUIRED_TABLE_MISSING: Required table public.% does not exist; refusing investor deletion.', v_missing_table;
    END IF;
  END LOOP;

  -- 3. Serialize per-investor mutations using checked-in repository advisory lock helper
  v_lock_key := public.financial_lock_key(v_investor_id);
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- 3b. Pre-acquire account-scoped advisory locks in ascending id order BEFORE row locks
  --     to preserve strict deadlock-free lock ordering with internal transfer RPCs
  SELECT COALESCE(NULLIF(BTRIM(portal_username), ''), '') INTO v_portal_username
  FROM public.investors
  WHERE id = v_investor_id;

  IF FOUND THEN
    FOR v_prelock_acc_id IN
      SELECT a.id
      FROM public.investor_accounts a
      WHERE a.investor_id = v_investor_id
         OR LOWER(BTRIM(COALESCE(a.investor_id, ''))) = LOWER(v_investor_id)
         OR (
           v_portal_username <> ''
           AND (
             LOWER(BTRIM(COALESCE(a.investor_id, ''))) = LOWER(v_portal_username)
             OR LOWER(BTRIM(COALESCE(a.id, ''))) = LOWER(v_portal_username)
           )
         )
      ORDER BY a.id ASC
    LOOP
      PERFORM pg_advisory_xact_lock(hashtext(v_prelock_acc_id));
      v_advisory_locked_acc_ids := array_append(v_advisory_locked_acc_ids, v_prelock_acc_id);
    END LOOP;
  END IF;

  -- 4. Lock target investor row by exact case-sensitive id equality
  SELECT * INTO v_investor
  FROM public.investors
  WHERE id = v_investor_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVESTOR_NOT_FOUND: Investor % does not exist.', v_investor_id;
  END IF;

  v_portal_username := COALESCE(NULLIF(BTRIM(v_investor.portal_username), ''), '');

  -- 5. Lock all potentially linked investor_accounts rows in deterministic ORDER BY id ASC
  --    (exact id, case-insensitive id, or portal_username alias matches)
  FOR v_acc_rec IN
    SELECT a.*
    FROM public.investor_accounts a
    WHERE a.investor_id = v_investor_id
       OR LOWER(BTRIM(COALESCE(a.investor_id, ''))) = LOWER(v_investor_id)
       OR (
         v_portal_username <> ''
         AND (
           LOWER(BTRIM(COALESCE(a.investor_id, ''))) = LOWER(v_portal_username)
           OR LOWER(BTRIM(COALESCE(a.id, ''))) = LOWER(v_portal_username)
         )
       )
    ORDER BY a.id ASC
    FOR UPDATE
  LOOP
    -- Never delete or orphan an account whose investor_id does not unambiguously equal v_investor_id
    IF v_acc_rec.investor_id IS DISTINCT FROM v_investor_id THEN
      RAISE EXCEPTION 'AMBIGUOUS_ACCOUNT_LINKAGE: Account % references investor_id % instead of exact owner %. Refusing deletion; set investor status to ''Inactive'' instead.',
        v_acc_rec.id, COALESCE(v_acc_rec.investor_id, '<NULL>'), v_investor_id;
    END IF;

    -- If an account appeared concurrently after step 3b, attempt non-blocking advisory lock (fail closed on contention)
    IF NOT (v_acc_rec.id = ANY(v_advisory_locked_acc_ids)) THEN
      IF NOT pg_try_advisory_xact_lock(hashtext(v_acc_rec.id)) THEN
        RAISE EXCEPTION 'CONCURRENT_ACCOUNT_ACTIVITY: Concurrent operation detected on account % for investor %; retry after activity settles.',
          v_acc_rec.id, v_investor_id;
      END IF;
      v_advisory_locked_acc_ids := array_append(v_advisory_locked_acc_ids, v_acc_rec.id);
    END IF;

    v_owned_account_ids := array_append(v_owned_account_ids, v_acc_rec.id);

    -- Non-zero starting_capital or total_cash_in represents funded capital basis, not an empty draft
    IF COALESCE(v_acc_rec.starting_capital, 0) <> 0
       OR COALESCE(v_acc_rec.total_cash_in, 0) <> 0 THEN
      v_funded_accounts_count := v_funded_accounts_count + 1;
    END IF;
  END LOOP;

  -- Check optional cash-provenance columns on owned investor_accounts if present in schema
  IF cardinality(v_owned_account_ids) > 0 THEN
    SELECT EXISTS (
      SELECT 1 FROM pg_catalog.pg_attribute
      WHERE attrelid = 'public.investor_accounts'::regclass
        AND attname = 'initial_cash_contribution'
        AND attnum > 0 AND NOT attisdropped
    ) INTO v_has_col;
    IF v_has_col THEN
      EXECUTE 'SELECT COUNT(*) FROM public.investor_accounts WHERE id = ANY($1) AND COALESCE(initial_cash_contribution, 0) <> 0'
        INTO v_extra_prov_count
        USING v_owned_account_ids;
      v_provenance_accounts_count := v_provenance_accounts_count + v_extra_prov_count;
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM pg_catalog.pg_attribute
      WHERE attrelid = 'public.investor_accounts'::regclass
        AND attname = 'capital_origin_type'
        AND attnum > 0 AND NOT attisdropped
    ) INTO v_has_col;
    IF v_has_col THEN
      EXECUTE 'SELECT COUNT(*) FROM public.investor_accounts WHERE id = ANY($1) AND UPPER(BTRIM(COALESCE(capital_origin_type, ''UNKNOWN''))) NOT IN ('''', ''UNKNOWN'')'
        INTO v_extra_prov_count
        USING v_owned_account_ids;
      v_provenance_accounts_count := v_provenance_accounts_count + v_extra_prov_count;
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM pg_catalog.pg_attribute
      WHERE attrelid = 'public.investor_accounts'::regclass
        AND attname = 'external_cash_provenance_status'
        AND attnum > 0 AND NOT attisdropped
    ) INTO v_has_col;
    IF v_has_col THEN
      EXECUTE 'SELECT COUNT(*) FROM public.investor_accounts WHERE id = ANY($1) AND UPPER(BTRIM(COALESCE(external_cash_provenance_status, ''UNKNOWN''))) NOT IN ('''', ''UNKNOWN'')'
        INTO v_extra_prov_count
        USING v_owned_account_ids;
      v_provenance_accounts_count := v_provenance_accounts_count + v_extra_prov_count;
    END IF;
  END IF;

  -- 6. Build deduplicated normalized identity set covering investor id, portal_username, and owned account ids
  v_all_ids := ARRAY[LOWER(v_investor_id)];
  IF v_portal_username <> '' AND NOT (LOWER(v_portal_username) = ANY(v_all_ids)) THEN
    v_all_ids := array_append(v_all_ids, LOWER(v_portal_username));
  END IF;
  FOREACH v_norm_acc_id IN ARRAY v_owned_account_ids LOOP
    v_norm_acc_id := NULLIF(LOWER(BTRIM(COALESCE(v_norm_acc_id, ''))), '');
    IF v_norm_acc_id IS NOT NULL AND NOT (v_norm_acc_id = ANY(v_all_ids)) THEN
      v_all_ids := array_append(v_all_ids, v_norm_acc_id);
    END IF;
  END LOOP;

  -- 7. Fail closed on ANY unverified foreign key referencing public.investors or public.investor_accounts
  --    anywhere in the database (guarantees zero silent ON DELETE CASCADE / SET NULL on unlisted tables or columns)
  SELECT
    n.nspname || '.' || c.relname AS referencing_table,
    a.attname AS referencing_column,
    con.conname AS constraint_name,
    con.confdeltype AS delete_action
  INTO v_unverified_fk
  FROM pg_catalog.pg_constraint con
  JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  JOIN LATERAL unnest(con.conkey) AS ck(attnum) ON TRUE
  JOIN pg_catalog.pg_attribute a
    ON a.attrelid = con.conrelid
   AND a.attnum = ck.attnum
   AND NOT a.attisdropped
  WHERE con.contype = 'f'
    AND con.confrelid IN ('public.investors'::regclass, 'public.investor_accounts'::regclass)
    AND NOT (
      n.nspname = 'public'
      AND (
        (c.relname = 'investor_accounts' AND a.attname = 'investor_id')
        OR (c.relname = 'deposits' AND a.attname IN ('investor_id', 'account_id'))
        OR (c.relname = 'withdrawals' AND a.attname IN ('investor_id', 'account_id'))
        OR (c.relname = 'investor_monthly_history' AND a.attname IN ('investor_id', 'account_id'))
        OR (c.relname = 'commission_earnings' AND a.attname IN ('recipient_id', 'source_investor_id', 'source_account_id'))
        OR (c.relname = 'commission_shares' AND a.attname IN ('source_investor_id', 'source_account_id', 'recipient_investor_id'))
        OR (c.relname = 'snapshots' AND a.attname IN ('investor_id', 'account_id'))
        OR (c.relname = 'audit_runs' AND a.attname IN ('source_investor_id', 'admin_id'))
        OR (c.relname = 'account_cutover_adjustments' AND a.attname IN ('investor_id', 'account_id'))
        OR (c.relname = 'internal_transfers' AND a.attname IN ('source_investor_id', 'source_account_id', 'target_investor_id', 'target_account_id'))
        OR (c.relname = 'commission_rules' AND a.attname IN ('investor_id', 'recipient_id', 'source_investor_id', 'recipient_investor_id', 'account_id', 'source_account_id'))
        OR (c.relname = 'payment_provider_events' AND a.attname = 'resource_id')
      )
    )
  ORDER BY n.nspname, c.relname, con.conname, a.attname
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'UNVERIFIED_FOREIGN_KEY_DEPENDENCY: Cannot safely delete investor % because table % column % has unverified foreign key % (delete_action=%) referencing investors/investor_accounts.',
      v_investor_id,
      v_unverified_fk.referencing_table,
      v_unverified_fk.referencing_column,
      v_unverified_fk.constraint_name,
      v_unverified_fk.delete_action;
  END IF;

  -- 8. Fail closed if any non-internal DELETE trigger exists on public.investors or public.investor_accounts
  SELECT
    n.nspname || '.' || c.relname AS trigger_table,
    t.tgname AS trigger_name
  INTO v_unverified_trigger
  FROM pg_catalog.pg_trigger t
  JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE t.tgrelid IN ('public.investors'::regclass, 'public.investor_accounts'::regclass)
    AND NOT t.tgisinternal
    AND (t.tgtype & 8) <> 0
  ORDER BY n.nspname, c.relname, t.tgname
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'UNVERIFIED_DELETE_TRIGGER: Cannot safely delete investor % because table % has unverified DELETE trigger %.',
      v_investor_id,
      v_unverified_trigger.trigger_table,
      v_unverified_trigger.trigger_name;
  END IF;

  -- 9. Exhaustive financial, commission, and audit dependency checks (all statuses included; zero rows ever deleted)

  -- 9a. Deposits (all statuses/treatments)
  SELECT COUNT(*) INTO v_deposits_count
  FROM public.deposits
  WHERE LOWER(BTRIM(COALESCE(investor_id, ''))) = ANY(v_all_ids)
     OR LOWER(BTRIM(COALESCE(account_id, ''))) = ANY(v_all_ids);

  -- 9b. Withdrawals (all statuses)
  SELECT COUNT(*) INTO v_withdrawals_count
  FROM public.withdrawals
  WHERE LOWER(BTRIM(COALESCE(investor_id, ''))) = ANY(v_all_ids)
     OR LOWER(BTRIM(COALESCE(account_id, ''))) = ANY(v_all_ids);

  -- 9c. Investor monthly history (all periods, manual/locked/open)
  SELECT COUNT(*) INTO v_history_count
  FROM public.investor_monthly_history
  WHERE LOWER(BTRIM(COALESCE(investor_id, ''))) = ANY(v_all_ids)
     OR LOWER(BTRIM(COALESCE(account_id, ''))) = ANY(v_all_ids);

  -- 9d. Commission earnings (all statuses; includes optional source_account_id if column exists)
  SELECT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.commission_earnings'::regclass
      AND attname = 'source_account_id'
      AND attnum > 0 AND NOT attisdropped
  ) INTO v_has_col;

  IF v_has_col THEN
    EXECUTE 'SELECT COUNT(*) FROM public.commission_earnings WHERE LOWER(BTRIM(COALESCE(recipient_id, ''''))) = ANY($1) OR LOWER(BTRIM(COALESCE(source_investor_id, ''''))) = ANY($1) OR LOWER(BTRIM(COALESCE(source_account_id, ''''))) = ANY($1)'
      INTO v_commission_earnings_count
      USING v_all_ids;
  ELSE
    SELECT COUNT(*) INTO v_commission_earnings_count
    FROM public.commission_earnings
    WHERE LOWER(BTRIM(COALESCE(recipient_id, ''))) = ANY(v_all_ids)
       OR LOWER(BTRIM(COALESCE(source_investor_id, ''))) = ANY(v_all_ids);
  END IF;

  -- 9e. Commission shares (has ON DELETE CASCADE and no BEFORE DELETE trigger — MUST block if any row exists)
  SELECT COUNT(*) INTO v_commission_shares_count
  FROM public.commission_shares
  WHERE LOWER(BTRIM(COALESCE(source_investor_id, ''))) = ANY(v_all_ids)
     OR LOWER(BTRIM(COALESCE(source_account_id, ''))) = ANY(v_all_ids)
     OR LOWER(BTRIM(COALESCE(recipient_investor_id, ''))) = ANY(v_all_ids);

  -- 9f. Snapshots (read-only historical audit log — NEVER physically deleted)
  SELECT COUNT(*) INTO v_snapshots_count
  FROM public.snapshots
  WHERE LOWER(BTRIM(COALESCE(investor_id, ''))) = ANY(v_all_ids)
     OR LOWER(BTRIM(COALESCE(account_id, ''))) = ANY(v_all_ids);

  -- 9g. Audit runs (source_investor_id has ON DELETE SET NULL — MUST block to prevent altering audit records)
  SELECT COUNT(*) INTO v_audit_runs_count
  FROM public.audit_runs
  WHERE LOWER(BTRIM(COALESCE(source_investor_id, ''))) = ANY(v_all_ids)
     OR LOWER(BTRIM(COALESCE(admin_id, ''))) = ANY(v_all_ids);

  -- 9h. Account cutover adjustments (if table exists; has ON DELETE CASCADE and no BEFORE DELETE trigger)
  IF to_regclass('public.account_cutover_adjustments') IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM pg_catalog.pg_attribute
      WHERE attrelid = 'public.account_cutover_adjustments'::regclass
        AND attname = 'investor_id' AND attnum > 0 AND NOT attisdropped
    ) INTO v_has_col;
    SELECT EXISTS (
      SELECT 1 FROM pg_catalog.pg_attribute
      WHERE attrelid = 'public.account_cutover_adjustments'::regclass
        AND attname = 'account_id' AND attnum > 0 AND NOT attisdropped
    ) INTO v_has_col2;

    IF NOT (v_has_col AND v_has_col2) THEN
      RAISE EXCEPTION 'SCHEMA_VERIFICATION_FAILED: Table public.account_cutover_adjustments exists without expected investor_id/account_id columns; refusing investor deletion.';
    END IF;

    EXECUTE 'SELECT COUNT(*) FROM public.account_cutover_adjustments WHERE LOWER(BTRIM(COALESCE(investor_id, ''''))) = ANY($1) OR LOWER(BTRIM(COALESCE(account_id, ''''))) = ANY($1)'
      INTO v_cutover_count
      USING v_all_ids;
  END IF;

  -- 9i. Internal transfers (REQUIRED; fail closed if absent or missing any expected source/target investor/account column)
  IF to_regclass('public.internal_transfers') IS NULL THEN
    RAISE EXCEPTION 'REQUIRED_TABLE_MISSING: Required table public.internal_transfers does not exist; refusing investor deletion.';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.internal_transfers'::regclass
      AND attname = 'source_investor_id' AND attnum > 0 AND NOT attisdropped
  ) INTO v_has_col;
  SELECT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.internal_transfers'::regclass
      AND attname = 'source_account_id' AND attnum > 0 AND NOT attisdropped
  ) INTO v_has_col2;
  SELECT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.internal_transfers'::regclass
      AND attname = 'target_investor_id' AND attnum > 0 AND NOT attisdropped
  ) INTO v_has_col3;
  SELECT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.internal_transfers'::regclass
      AND attname = 'target_account_id' AND attnum > 0 AND NOT attisdropped
  ) INTO v_has_col4;

  IF NOT (v_has_col AND v_has_col2 AND v_has_col3 AND v_has_col4) THEN
    RAISE EXCEPTION 'SCHEMA_VERIFICATION_FAILED: Table public.internal_transfers exists without expected source/target investor/account columns; refusing investor deletion.';
  END IF;

  EXECUTE 'SELECT COUNT(*) FROM public.internal_transfers WHERE LOWER(BTRIM(COALESCE(source_investor_id, ''''))) = ANY($1) OR LOWER(BTRIM(COALESCE(source_account_id, ''''))) = ANY($1) OR LOWER(BTRIM(COALESCE(target_investor_id, ''''))) = ANY($1) OR LOWER(BTRIM(COALESCE(target_account_id, ''''))) = ANY($1)'
    INTO v_transfers_count
    USING v_all_ids;

  -- 9j. Legacy commission rules (if table exists; still read as fallback — NEVER physically deleted)
  IF to_regclass('public.commission_rules') IS NOT NULL THEN
    v_rules_clauses := ARRAY[]::TEXT[];

    SELECT EXISTS (
      SELECT 1 FROM pg_catalog.pg_attribute
      WHERE attrelid = 'public.commission_rules'::regclass
        AND attname = 'investor_id' AND attnum > 0 AND NOT attisdropped
    ) INTO v_has_col;
    IF v_has_col THEN
      v_rules_clauses := array_append(v_rules_clauses, 'LOWER(BTRIM(COALESCE(investor_id, ''''))) = ANY($1)');
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM pg_catalog.pg_attribute
      WHERE attrelid = 'public.commission_rules'::regclass
        AND attname = 'recipient_id' AND attnum > 0 AND NOT attisdropped
    ) INTO v_has_col;
    IF v_has_col THEN
      v_rules_clauses := array_append(v_rules_clauses, 'LOWER(BTRIM(COALESCE(recipient_id, ''''))) = ANY($1)');
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM pg_catalog.pg_attribute
      WHERE attrelid = 'public.commission_rules'::regclass
        AND attname = 'source_investor_id' AND attnum > 0 AND NOT attisdropped
    ) INTO v_has_col;
    IF v_has_col THEN
      v_rules_clauses := array_append(v_rules_clauses, 'LOWER(BTRIM(COALESCE(source_investor_id, ''''))) = ANY($1)');
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM pg_catalog.pg_attribute
      WHERE attrelid = 'public.commission_rules'::regclass
        AND attname = 'recipient_investor_id' AND attnum > 0 AND NOT attisdropped
    ) INTO v_has_col;
    IF v_has_col THEN
      v_rules_clauses := array_append(v_rules_clauses, 'LOWER(BTRIM(COALESCE(recipient_investor_id, ''''))) = ANY($1)');
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM pg_catalog.pg_attribute
      WHERE attrelid = 'public.commission_rules'::regclass
        AND attname = 'account_id' AND attnum > 0 AND NOT attisdropped
    ) INTO v_has_col;
    IF v_has_col THEN
      v_rules_clauses := array_append(v_rules_clauses, 'LOWER(BTRIM(COALESCE(account_id, ''''))) = ANY($1)');
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM pg_catalog.pg_attribute
      WHERE attrelid = 'public.commission_rules'::regclass
        AND attname = 'source_account_id' AND attnum > 0 AND NOT attisdropped
    ) INTO v_has_col;
    IF v_has_col THEN
      v_rules_clauses := array_append(v_rules_clauses, 'LOWER(BTRIM(COALESCE(source_account_id, ''''))) = ANY($1)');
    END IF;

    IF cardinality(v_rules_clauses) = 0 THEN
      RAISE EXCEPTION 'SCHEMA_VERIFICATION_FAILED: Table public.commission_rules exists without recognized investor/account reference columns; refusing investor deletion.';
    END IF;

    EXECUTE 'SELECT COUNT(*) FROM public.commission_rules WHERE ' || array_to_string(v_rules_clauses, ' OR ')
      INTO v_commission_rules_count
      USING v_all_ids;
  END IF;

  -- 9k. Payment provider events (if table exists; blocks if resource_id or JSONB payload references this investor/account)
  IF to_regclass('public.payment_provider_events') IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM pg_catalog.pg_attribute
      WHERE attrelid = 'public.payment_provider_events'::regclass
        AND attname = 'resource_id' AND attnum > 0 AND NOT attisdropped
    ) INTO v_has_col;
    SELECT EXISTS (
      SELECT 1 FROM pg_catalog.pg_attribute
      WHERE attrelid = 'public.payment_provider_events'::regclass
        AND attname = 'payload' AND attnum > 0 AND NOT attisdropped
    ) INTO v_has_col2;

    IF NOT (v_has_col AND v_has_col2) THEN
      RAISE EXCEPTION 'SCHEMA_VERIFICATION_FAILED: Table public.payment_provider_events exists without expected resource_id/payload columns; refusing investor deletion.';
    END IF;

    EXECUTE 'SELECT COUNT(*) FROM public.payment_provider_events WHERE LOWER(BTRIM(COALESCE(resource_id, ''''))) = ANY($1) OR (CASE WHEN payload IS NOT NULL AND jsonb_typeof(payload) = ''object'' THEN (LOWER(BTRIM(COALESCE(payload->>''investor_id'', ''''))) = ANY($1) OR LOWER(BTRIM(COALESCE(payload->>''investorId'', ''''))) = ANY($1) OR LOWER(BTRIM(COALESCE(payload->>''account_id'', ''''))) = ANY($1) OR LOWER(BTRIM(COALESCE(payload->>''accountId'', ''''))) = ANY($1)) ELSE FALSE END)'
      INTO v_payment_events_count
      USING v_all_ids;
  END IF;

  -- 10. Fail-closed immutability gate
  v_total_protected_records :=
    v_deposits_count
    + v_withdrawals_count
    + v_history_count
    + v_commission_earnings_count
    + v_commission_shares_count
    + v_snapshots_count
    + v_audit_runs_count
    + v_cutover_count
    + v_transfers_count
    + v_commission_rules_count
    + v_payment_events_count
    + v_funded_accounts_count
    + v_provenance_accounts_count;

  IF v_total_protected_records IS NULL OR v_total_protected_records > 0 THEN
    RAISE EXCEPTION 'FINANCIAL_HISTORY_IMMUTABLE: Cannot delete investor % because % associated financial/audit dependencies exist (% deposits, % withdrawals, % monthly balance history rows, % commission earnings, % commission shares, % snapshots, % audit runs, % cutover adjustments, % internal transfers, % legacy commission rules, % payment events, % funded accounts, % provenance-certified accounts). To remove access, set investor status to ''Inactive'' instead.',
      v_investor_id,
      COALESCE(v_total_protected_records, -1),
      v_deposits_count,
      v_withdrawals_count,
      v_history_count,
      v_commission_earnings_count,
      v_commission_shares_count,
      v_snapshots_count,
      v_audit_runs_count,
      v_cutover_count,
      v_transfers_count,
      v_commission_rules_count,
      v_payment_events_count,
      v_funded_accounts_count,
      v_provenance_accounts_count;
  END IF;

  -- 11. Atomically delete ONLY zero-history draft account row(s) and draft investor profile
  IF cardinality(v_owned_account_ids) > 0 THEN
    DELETE FROM public.investor_accounts
    WHERE id = ANY(v_owned_account_ids)
      AND investor_id = v_investor_id;

    GET DIAGNOSTICS v_deleted_accounts = ROW_COUNT;
    IF v_deleted_accounts <> cardinality(v_owned_account_ids) THEN
      RAISE EXCEPTION 'DELETE_COUNT_MISMATCH: Expected to delete % draft investor_accounts row(s) for investor %, deleted %.',
        cardinality(v_owned_account_ids), v_investor_id, v_deleted_accounts;
    END IF;
  END IF;

  DELETE FROM public.investors
  WHERE id = v_investor_id;

  GET DIAGNOSTICS v_deleted_investors = ROW_COUNT;
  IF v_deleted_investors <> 1 THEN
    RAISE EXCEPTION 'DELETE_COUNT_MISMATCH: Expected to delete 1 draft investor row for %, deleted %.',
      v_investor_id, v_deleted_investors;
  END IF;

  RETURN jsonb_build_object(
    'status', 'DELETED',
    'deleted_investor_id', v_investor_id,
    'deleted_account_ids', to_jsonb(v_owned_account_ids),
    'deleted_accounts_count', v_deleted_accounts
  );
END;
$$;

-- =============================================================================
-- STRICT LEAST-PRIVILEGE EXECUTE GRANTS (service_role ONLY)
-- =============================================================================
REVOKE ALL ON FUNCTION public.delete_draft_investor_atomic(text) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.delete_draft_investor_atomic(text) FROM anon;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.delete_draft_investor_atomic(text) FROM authenticated;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.delete_draft_investor_atomic(text) TO service_role;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
