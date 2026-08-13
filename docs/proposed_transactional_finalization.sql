-- =============================================================================
-- STONE & COMPANY FOREX FUND — PROPOSED TRANSACTIONAL FINALIZATION RPC FUNCTION
-- Status: PROPOSED / UNAPPLIED (SAFETY CERTIFICATION MODE)
-- =============================================================================

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
AS $$
DECLARE
  v_period_status TEXT;
  v_existing_hash TEXT;
  v_history_count INTEGER := 0;
  v_earnings_count INTEGER := 0;
  v_audit_id UUID := gen_random_uuid();
  v_result JSONB;
BEGIN
  -- 1. Obtain transaction-level advisory lock for concurrency control
  PERFORM pg_advisory_xact_lock(hashtext('accounting_period_' || p_year::text || '_' || p_month_number::text));

  -- 2. Inspect existing accounting_periods state
  SELECT status, preview_input_hash 
  INTO v_period_status, v_existing_hash
  FROM accounting_periods
  WHERE year = p_year AND month_number = p_month_number;

  IF FOUND AND v_period_status = 'FINALIZED' THEN
    RAISE EXCEPTION 'PERIOD_ALREADY_FINALIZED: Period %-% is already finalized.', p_year, p_month_number;
  END IF;

  -- 2. Upsert Accounting Period State to FINALIZED
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
      updated_at = NOW();

  -- 3. Lock/Upsert Monthly Returns Row
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

  -- 4. Upsert Investor Monthly History Records
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

  -- 5. Upsert Commission Earnings Ledger Records
  INSERT INTO commission_earnings (
    recipient_id, source_investor_id, year, month_number, amount, created_at
  )
  SELECT 
    (elem->>'recipientId')::TEXT,
    (elem->>'sourceInvestorId')::TEXT,
    p_year,
    p_month_number,
    (elem->>'amount')::NUMERIC,
    NOW()
  FROM jsonb_array_elements(p_commission_earnings_json) AS elem
  WHERE (elem->>'amount')::NUMERIC > 0
  ON CONFLICT (year, month_number, source_investor_id, recipient_id) DO UPDATE
  SET amount = EXCLUDED.amount;

  GET DIAGNOSTICS v_earnings_count = ROW_COUNT;

  -- 6. Record Audit Run
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
