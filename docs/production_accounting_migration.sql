-- =============================================================================
-- STONE & COMPANY FOREX FUND — PRODUCTION ACCOUNTING MIGRATION SQL
-- Status: PROPOSED / UNAPPLIED (ADDITIVE ONLY - ZERO BREAKING CHANGES)
-- =============================================================================

-- 1. ADD EFFECTIVE ACCOUNTING DATES TO CASHFLOW TABLES (ADDITIVE ONLY)
ALTER TABLE deposits ADD COLUMN IF NOT EXISTS effective_accounting_date DATE;
ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS effective_accounting_date DATE;

-- 2. CREATE ACCOUNTING PERIODS TABLE
CREATE TABLE IF NOT EXISTS accounting_periods (
  id SERIAL PRIMARY KEY,
  year INT NOT NULL,
  month_number INT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN',
  fund_return_pct NUMERIC(5,2),
  return_source TEXT,
  return_status TEXT,
  return_captured_at TIMESTAMPTZ,
  preview_input_hash TEXT,
  preview_run_id TEXT,
  finalized_at TIMESTAMPTZ,
  finalized_by TEXT,
  calculation_version TEXT DEFAULT '2.0.0',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(year, month_number)
);

-- 3. CREATE ACCOUNTING PREVIEW RUNS TABLE
CREATE TABLE IF NOT EXISTS accounting_preview_runs (
  id TEXT PRIMARY KEY,
  year INT NOT NULL,
  month_number INT NOT NULL,
  input_hash TEXT NOT NULL,
  calculation_version TEXT DEFAULT '2.0.0',
  created_by TEXT,
  expires_at TIMESTAMPTZ,
  summary_json JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. ADD PROVENANCE AND LEDGER KEY TO COMMISSION EARNINGS
ALTER TABLE commission_earnings ADD COLUMN IF NOT EXISTS ledger_key TEXT;
ALTER TABLE commission_earnings ADD COLUMN IF NOT EXISTS source_account_id TEXT;
ALTER TABLE commission_earnings ADD COLUMN IF NOT EXISTS commission_percent_snapshot NUMERIC;
ALTER TABLE commission_earnings ADD COLUMN IF NOT EXISTS commission_share_rule_id TEXT;
ALTER TABLE commission_earnings ADD COLUMN IF NOT EXISTS calculation_version TEXT DEFAULT '2.0.0';
ALTER TABLE commission_earnings ADD COLUMN IF NOT EXISTS accounting_period_id INT;

-- Populate ledger_key for existing legacy records if NULL
UPDATE commission_earnings
SET ledger_key = year::text || '_' || month_number::text || '_' || source_investor_id::text || '_' || COALESCE(source_account_id, 'DEFAULT') || '_' || recipient_id::text
WHERE ledger_key IS NULL;

-- Apply Unique Constraint to ledger_key
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'commission_earnings_ledger_key_key'
  ) THEN
    ALTER TABLE commission_earnings ADD CONSTRAINT commission_earnings_ledger_key_key UNIQUE (ledger_key);
  END IF;
END $$;

-- 5. TRANSACTIONAL FINALIZATION RPC FUNCTION
CREATE OR REPLACE FUNCTION finalize_monthly_accounting_period(
  p_year INTEGER,
  p_month_number INTEGER,
  p_gross_return_pct NUMERIC(5, 2),
  p_return_source TEXT,
  p_return_status TEXT,
  p_input_hash TEXT,
  p_preview_run_id TEXT,
  p_calculation_version TEXT,
  p_admin_id TEXT,
  p_investor_history_json JSONB,
  p_commission_earnings_json JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_period_status TEXT;
  v_history_count INTEGER := 0;
  v_earnings_count INTEGER := 0;
  v_audit_id UUID := gen_random_uuid();
  v_period_id INT;
  v_result JSONB;
BEGIN
  -- Obtain transaction-level advisory lock for atomic concurrency control
  PERFORM pg_advisory_xact_lock(hashtext('accounting_period_' || p_year::text || '_' || p_month_number::text));

  -- Inspect existing state
  SELECT id, status INTO v_period_id, v_period_status
  FROM accounting_periods
  WHERE year = p_year AND month_number = p_month_number;

  IF FOUND AND v_period_status = 'FINALIZED' THEN
    RAISE EXCEPTION 'PERIOD_ALREADY_FINALIZED: Period %-% is already finalized.', p_year, p_month_number;
  END IF;

  -- Upsert Accounting Period State
  INSERT INTO accounting_periods (
    year, month_number, status, fund_return_pct, return_source, return_status,
    return_captured_at, preview_input_hash, preview_run_id, finalized_at, finalized_by, calculation_version
  )
  VALUES (
    p_year, p_month_number, 'FINALIZED', p_gross_return_pct, p_return_source, p_return_status,
    NOW(), p_input_hash, p_preview_run_id, NOW(), p_admin_id, COALESCE(p_calculation_version, '2.0.0')
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

  -- Upsert Monthly Returns Row
  INSERT INTO monthly_returns (year, month_number, month, gross_return_pct, source, notes, locked, last_updated, created_at)
  VALUES (
    p_year, p_month_number, TO_CHAR(TO_DATE(p_month_number::TEXT, 'MM'), 'Month'),
    p_gross_return_pct, p_return_source, 'Finalized via Central Accounting Engine', TRUE, NOW(), NOW()
  )
  ON CONFLICT (year, month_number) DO UPDATE
  SET gross_return_pct = EXCLUDED.gross_return_pct,
      source = EXCLUDED.source,
      locked = TRUE,
      last_updated = NOW();

  -- Upsert Investor Monthly History Records
  INSERT INTO investor_monthly_history (
    investor_id, account_id, year, month_number, month, opening_balance,
    deposits, withdrawals, gross_return_pct, recurring_draw, ending_balance, is_manual, locked, updated_at
  )
  SELECT 
    (elem->>'investorId')::TEXT,
    (elem->>'accountId')::TEXT,
    p_year,
    p_month_number,
    TO_CHAR(TO_DATE(p_month_number::TEXT, 'MM'), 'Month'),
    (elem->>'openingBalance')::NUMERIC,
    (elem->>'deposits')::NUMERIC,
    (elem->>'withdrawals')::NUMERIC,
    p_gross_return_pct,
    (elem->>'recurringDraw')::NUMERIC,
    (elem->>'endingBalance')::NUMERIC,
    FALSE,
    TRUE,
    NOW()
  FROM jsonb_array_elements(p_investor_history_json) AS elem
  ON CONFLICT (investor_id, year, month_number) DO UPDATE
  SET opening_balance = EXCLUDED.opening_balance,
      deposits = EXCLUDED.deposits,
      withdrawals = EXCLUDED.withdrawals,
      gross_return_pct = EXCLUDED.gross_return_pct,
      recurring_draw = EXCLUDED.recurring_draw,
      ending_balance = EXCLUDED.ending_balance,
      is_manual = FALSE,
      locked = TRUE,
      updated_at = NOW();

  GET DIAGNOSTICS v_history_count = ROW_COUNT;

  -- Upsert Commission Earnings Ledger Records
  INSERT INTO commission_earnings (
    ledger_key, recipient_id, source_investor_id, source_account_id,
    commission_percent_snapshot, commission_share_rule_id, calculation_version, accounting_period_id,
    year, month_number, amount, created_at
  )
  SELECT 
    p_year::text || '_' || p_month_number::text || '_' || (elem->>'sourceInvestorId')::text || '_' || COALESCE((elem->>'sourceAccountId')::text, 'DEFAULT') || '_' || (elem->>'recipientId')::text,
    (elem->>'recipientId')::TEXT,
    (elem->>'sourceInvestorId')::TEXT,
    (elem->>'sourceAccountId')::TEXT,
    (elem->>'commissionPercentSnapshot')::NUMERIC,
    (elem->>'commissionShareRuleId')::TEXT,
    COALESCE(p_calculation_version, '2.0.0'),
    v_period_id,
    p_year,
    p_month_number,
    (elem->>'amount')::NUMERIC,
    NOW()
  FROM jsonb_array_elements(p_commission_earnings_json) AS elem
  WHERE (elem->>'amount')::NUMERIC > 0
  ON CONFLICT (ledger_key) DO UPDATE
  SET amount = EXCLUDED.amount,
      commission_percent_snapshot = EXCLUDED.commission_percent_snapshot,
      accounting_period_id = EXCLUDED.accounting_period_id;

  GET DIAGNOSTICS v_earnings_count = ROW_COUNT;

  -- Record Audit Run
  INSERT INTO audit_runs (
    id, admin_id, year, month_number, report_json, created_at
  )
  VALUES (
    v_audit_id, p_admin_id, p_year, p_month_number,
    jsonb_build_object(
      'finalized_at', NOW(),
      'calculation_version', COALESCE(p_calculation_version, '2.0.0'),
      'input_hash', p_input_hash,
      'preview_run_id', p_preview_run_id,
      'history_records_written', v_history_count,
      'earnings_records_written', v_earnings_count,
      'gross_return_pct', p_gross_return_pct
    ),
    NOW()
  );

  v_result := jsonb_build_object(
    'status', 'SUCCESS',
    'auditId', v_audit_id,
    'year', p_year,
    'month', p_month_number,
    'historyCount', v_history_count,
    'earningsCount', v_earnings_count,
    'inputHash', p_input_hash
  );

  RETURN v_result;
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'FINALIZATION_TRANSACTION_FAILED: %', SQLERRM;
END;
$$;

-- 6. SECURITY & PRIVILEGE REVOCATIONS
REVOKE EXECUTE ON FUNCTION finalize_monthly_accounting_period(INTEGER, INTEGER, NUMERIC, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION finalize_monthly_accounting_period(INTEGER, INTEGER, NUMERIC, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB) TO service_role, postgres;

-- 7. ROW LEVEL SECURITY (RLS) POLICIES
ALTER TABLE accounting_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_preview_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE investor_monthly_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE commission_earnings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'admin_periods_policy') THEN
    CREATE POLICY admin_periods_policy ON accounting_periods FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'admin_previews_policy') THEN
    CREATE POLICY admin_previews_policy ON accounting_preview_runs FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'investor_history_select') THEN
    CREATE POLICY investor_history_select ON investor_monthly_history FOR SELECT TO authenticated
      USING (investor_id = current_setting('request.jwt.claim.sub', true) OR investor_id = current_setting('request.jwt.claim.user_id', true));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'admin_history_all') THEN
    CREATE POLICY admin_history_all ON investor_monthly_history FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'investor_commissions_select') THEN
    CREATE POLICY investor_commissions_select ON commission_earnings FOR SELECT TO authenticated
      USING (recipient_id = current_setting('request.jwt.claim.sub', true) OR recipient_id = current_setting('request.jwt.claim.user_id', true));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'admin_commissions_all') THEN
    CREATE POLICY admin_commissions_all ON commission_earnings FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;
