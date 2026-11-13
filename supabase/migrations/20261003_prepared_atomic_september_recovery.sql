-- =============================================================================
-- PREPARED ATOMIC RECOVERY MIGRATION / RPC
-- STATUS: NOT EXECUTION READY (BLOCKED PENDING CERTIFIED FINAL SEPTEMBER RETURN)
-- Target: Supabase PostgreSQL (Project julhldzkiqdeuuoqmvlo)
-- 
-- CRITICAL POLICY ENFORCEMENT:
-- 1. DO NOT EXECUTE ON PRODUCTION.
-- 2. Financial recovery remains BLOCKED until Josh Stout / authoritative source
--    provides the certified FINAL September 2026 gross return.
-- 3. All logic below must be transactionally tested against a local/clone rollback
--    transaction before any live execution is considered.
-- 4. Guessed/stale aliases (inv_c7d9e4a1, inv_3b6b3e39) have been permanently expunged.
--    Authoritative identities proven directly from production:
--    - Josh Stout: investors.id = 'stout001', investor_accounts.id = 'stout001', portal_username = 'jstout'
--    - Ryan Ringer: investors.id = 'inv_1f9ab366', investor_accounts.id = 'inv_1f9ab366', portal_username = 'rringer'
-- =============================================================================

CREATE OR REPLACE FUNCTION rpc_atomic_september_recovery(
  p_certified_september_return_pct NUMERIC,
  p_admin_id TEXT,
  p_audit_reason TEXT,
  p_dry_run BOOLEAN DEFAULT TRUE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  -- Authoritative identities
  v_josh_id CONSTANT TEXT := 'stout001';
  v_ryan_id CONSTANT TEXT := 'inv_1f9ab366';
  
  -- Pre-flight check variables
  v_current_sep_return NUMERIC;
  v_current_sep_locked BOOLEAN;
  v_current_aug_comm_sum NUMERIC;
  
  -- Invariant check variables
  v_josh_cash NUMERIC;
  v_ryan_cash NUMERIC;
  v_stout_may_dep NUMERIC;
  v_it_count INT;
  
  -- August restoration variables
  v_restored_aug_count INT := 0;
  v_restored_aug_sum NUMERIC := 0;

  -- September recovery loop variables
  rec_acc RECORD;
  v_opening NUMERIC;
  v_adj_start NUMERIC;
  v_net_return NUMERIC;
  v_net_gain NUMERIC;
  v_ending NUMERIC;
  v_sep_history_count INT := 0;
  v_sep_comm_count INT := 0;
  v_sep_comm_sum NUMERIC := 0;

  -- October correction loop variables
  rec_oct RECORD;
  v_oct_opening NUMERIC;
  v_oct_ending NUMERIC;
  v_oct_history_count INT := 0;
  v_future_stripped_count INT := 0;
  
  -- Result JSON
  v_result JSONB;
BEGIN
  -- ---------------------------------------------------------------------------
  -- 0. SAFETY GATES & INPUT VALIDATION
  -- ---------------------------------------------------------------------------
  IF p_certified_september_return_pct IS NULL THEN
    RAISE EXCEPTION 'CERTIFIED_SEPTEMBER_RETURN_REQUIRED: Recovery cannot execute without an explicitly certified September final return.';
  END IF;

  IF p_admin_id IS NULL OR TRIM(p_admin_id) = '' THEN
    RAISE EXCEPTION 'ADMIN_IDENTITY_REQUIRED: An authorized admin ID must be provided.';
  END IF;

  IF p_audit_reason IS NULL OR TRIM(p_audit_reason) = '' THEN
    RAISE EXCEPTION 'AUDIT_REASON_REQUIRED: An audited justification must be provided.';
  END IF;

  -- ---------------------------------------------------------------------------
  -- 1. ASSERT CURRENT CORRUPTED STATE
  -- ---------------------------------------------------------------------------
  SELECT gross_return_pct, locked 
  INTO v_current_sep_return, v_current_sep_locked
  FROM monthly_returns
  WHERE year = 2026 AND month_number = 9;

  IF v_current_sep_locked IS TRUE THEN
    RAISE EXCEPTION 'SEPTEMBER_ALREADY_LOCKED: September 2026 is already locked. Manual unlock required if intentional.';
  END IF;

  -- ---------------------------------------------------------------------------
  -- 2. ASSERT PRE-CONDITIONS & INVARIANTS BEFORE MODIFICATION
  -- ---------------------------------------------------------------------------
  -- Josh external cash invariant: exactly $1,606,090
  SELECT COALESCE(SUM(amount), 0) INTO v_josh_cash
  FROM deposits
  WHERE investor_id = v_josh_id
    AND accounting_treatment IN ('NEW_CASH', 'HISTORICAL_PROVENANCE')
    AND (status IS NULL OR status NOT ILIKE 'VOID');

  IF v_josh_cash != 1606090 THEN
    RAISE EXCEPTION 'INVARIANT_VIOLATION: Josh external cash (%) does not equal $1,606,090', v_josh_cash;
  END IF;

  -- Ryan external cash invariant: exactly $125,000
  SELECT COALESCE(SUM(amount), 0) INTO v_ryan_cash
  FROM deposits
  WHERE investor_id = v_ryan_id
    AND accounting_treatment IN ('NEW_CASH', 'HISTORICAL_PROVENANCE')
    AND (status IS NULL OR status NOT ILIKE 'VOID');

  IF v_ryan_cash != 125000 THEN
    RAISE EXCEPTION 'INVARIANT_VIOLATION: Ryan external cash (%) does not equal $125,000', v_ryan_cash;
  END IF;

  -- Stout May $7,500 deposit invariant
  SELECT COALESCE(SUM(amount), 0) INTO v_stout_may_dep
  FROM deposits
  WHERE investor_id = v_josh_id
    AND (COALESCE(effective_accounting_date, date::date) >= '2026-05-01' 
         AND COALESCE(effective_accounting_date, date::date) <= '2026-05-31')
    AND amount = 7500
    AND (status IS NULL OR status NOT ILIKE 'VOID');

  IF v_stout_may_dep < 7500 THEN
    RAISE EXCEPTION 'INVARIANT_VIOLATION: Stout May $7,500 deposit is missing or modified.';
  END IF;

  -- Jerry -> Stout internal transfers unchanged
  SELECT COUNT(*) INTO v_it_count
  FROM deposits
  WHERE notes ILIKE '%Jerry%' AND investor_id = v_josh_id;

  IF v_it_count < 1 THEN
    RAISE EXCEPTION 'INVARIANT_VIOLATION: Jerry internal transfers missing.';
  END IF;

  -- ---------------------------------------------------------------------------
  -- 3. RESTORE EXACT AUGUST COMMISSION LEDGER (75 ROWS, $11,153.73)
  -- ---------------------------------------------------------------------------
  -- Delete contaminated August recalculation commission rows for Josh
  DELETE FROM commission_earnings
  WHERE year = 2026 AND month_number = 8
    AND recipient_id = v_josh_id;

  -- Insert exact 75 recovered rows with authoritative recipient_id 'stout001'
  INSERT INTO commission_earnings (recipient_id, source_investor_id, source_account_id, year, month_number, amount, calculation_version)
  VALUES
    ('stout001', 'inv_bc1bcb0c', NULL, 2026, 8, 275.45, '2.0.0_recovered'),
    ('stout001', 'inv_f596c657', NULL, 2026, 8, 500.93, '2.0.0_recovered'),
    ('stout001', 'jerrys001', NULL, 2026, 8, 1796.74, '2.0.0_recovered'),
    ('stout001', 'inv_53aeb6cc', NULL, 2026, 8, 29.92, '2.0.0_recovered'),
    ('stout001', 'inv_68f7a3f9', NULL, 2026, 8, 38.01, '2.0.0_recovered'),
    ('stout001', 'inv_97762ca9', NULL, 2026, 8, 45.61, '2.0.0_recovered'),
    ('stout001', 'inv_7e7dcda2', NULL, 2026, 8, 82.62, '2.0.0_recovered'),
    ('stout001', 'inv_8115c9d3', NULL, 2026, 8, 33.97, '2.0.0_recovered'),
    ('stout001', 'inv_fdebd671', NULL, 2026, 8, 9.42, '2.0.0_recovered'),
    ('stout001', 'inv_ef3a1e9d', NULL, 2026, 8, 9.18, '2.0.0_recovered'),
    ('stout001', 'inv_a7e429ce', NULL, 2026, 8, 72.90, '2.0.0_recovered'),
    ('stout001', 'inv_5deeea21', NULL, 2026, 8, 157.16, '2.0.0_recovered'),
    ('stout001', 'jwegner001', NULL, 2026, 8, 11.69, '2.0.0_recovered'),
    ('stout001', 'inv_1f9ab366', NULL, 2026, 8, 563.76, '2.0.0_recovered'),
    ('stout001', 'inv_f22b8d5d', NULL, 2026, 8, 41.12, '2.0.0_recovered'),
    ('stout001', 'inv_3e8224ee', NULL, 2026, 8, 5.71, '2.0.0_recovered'),
    ('stout001', 'inv_0c8db3e7', NULL, 2026, 8, 35.40, '2.0.0_recovered'),
    ('stout001', 'inv_70b41b6c', NULL, 2026, 8, 8.04, '2.0.0_recovered'),
    ('stout001', 'inv_6a1b838a', NULL, 2026, 8, 183.11, '2.0.0_recovered'),
    ('stout001', 'inv_141417dc', NULL, 2026, 8, 43.12, '2.0.0_recovered'),
    ('stout001', 'inv_4007ec6c', NULL, 2026, 8, 83.48, '2.0.0_recovered'),
    ('stout001', 'inv_6173c725', NULL, 2026, 8, 29.10, '2.0.0_recovered'),
    ('stout001', 'inv_3c86fcfb', NULL, 2026, 8, 639.70, '2.0.0_recovered'),
    ('stout001', 'inv_4d2df1cb', NULL, 2026, 8, 393.90, '2.0.0_recovered'),
    ('stout001', 'inv_1bb229f6', NULL, 2026, 8, 1.15, '2.0.0_recovered'),
    ('stout001', 'inv_0d036796', NULL, 2026, 8, 12.48, '2.0.0_recovered'),
    ('stout001', 'inv_81b6661d', NULL, 2026, 8, 559.29, '2.0.0_recovered'),
    ('stout001', 'inv_41d6a94e', NULL, 2026, 8, 58.14, '2.0.0_recovered'),
    ('stout001', 'inv_81d519e5', NULL, 2026, 8, 155.68, '2.0.0_recovered'),
    ('stout001', 'inv_60cfabc0', NULL, 2026, 8, 83.30, '2.0.0_recovered'),
    ('stout001', 'inv_5a509c6a', NULL, 2026, 8, 471.82, '2.0.0_recovered'),
    ('stout001', 'inv_6df1643c', NULL, 2026, 8, 15.54, '2.0.0_recovered'),
    ('stout001', 'inv_d89e1f2a', NULL, 2026, 8, 102.92, '2.0.0_recovered'),
    ('stout001', 'inv_1531b890', NULL, 2026, 8, 6.80, '2.0.0_recovered'),
    ('stout001', 'inv_d1ef0a35', NULL, 2026, 8, 15.14, '2.0.0_recovered'),
    ('stout001', 'inv_a8b6b338', NULL, 2026, 8, 10.09, '2.0.0_recovered'),
    ('stout001', 'inv_9e04f7fe', NULL, 2026, 8, 607.82, '2.0.0_recovered'),
    ('stout001', 'inv_0b75a021', NULL, 2026, 8, 10.30, '2.0.0_recovered'),
    ('stout001', 'inv_83d2ce14', NULL, 2026, 8, 111.13, '2.0.0_recovered'),
    ('stout001', 'inv_d2ab6da4', NULL, 2026, 8, 691.32, '2.0.0_recovered'),
    ('stout001', 'inv_840ea55a', NULL, 2026, 8, 23.22, '2.0.0_recovered'),
    ('stout001', 'inv_6e00f8df', NULL, 2026, 8, 62.68, '2.0.0_recovered'),
    ('stout001', 'inv_03c9c631', NULL, 2026, 8, 5.03, '2.0.0_recovered'),
    ('stout001', 'inv_e24a4040', NULL, 2026, 8, 23.89, '2.0.0_recovered'),
    ('stout001', 'inv_54a72d26', NULL, 2026, 8, 100.93, '2.0.0_recovered'),
    ('stout001', 'inv_835ffffd', NULL, 2026, 8, 318.15, '2.0.0_recovered'),
    ('stout001', 'inv_e1797067', NULL, 2026, 8, 0.19, '2.0.0_recovered'),
    ('stout001', 'inv_5a9e32af', NULL, 2026, 8, 0.11, '2.0.0_recovered'),
    ('stout001', 'inv_d4157e18', NULL, 2026, 8, 6.72, '2.0.0_recovered'),
    ('stout001', 'inv_4c5c0ee6', NULL, 2026, 8, 424.61, '2.0.0_recovered'),
    ('stout001', 'inv_95d70784', NULL, 2026, 8, 8.68, '2.0.0_recovered'),
    ('stout001', 'inv_d8b5ab06', NULL, 2026, 8, 223.26, '2.0.0_recovered'),
    ('stout001', 'inv_cec324aa', NULL, 2026, 8, 266.85, '2.0.0_recovered'),
    ('stout001', 'inv_09af98b3', NULL, 2026, 8, 13.46, '2.0.0_recovered'),
    ('stout001', 'inv_6633b793', NULL, 2026, 8, 5.41, '2.0.0_recovered'),
    ('stout001', 'inv_09cfa456', NULL, 2026, 8, 60.60, '2.0.0_recovered'),
    ('stout001', 'inv_6ba53bbe', NULL, 2026, 8, 574.24, '2.0.0_recovered'),
    ('stout001', 'inv_4ff3e6b1', NULL, 2026, 8, 7.13, '2.0.0_recovered'),
    ('stout001', 'inv_a00b6024', NULL, 2026, 8, 115.34, '2.0.0_recovered'),
    ('stout001', 'inv_a429c227', NULL, 2026, 8, 20.09, '2.0.0_recovered'),
    ('stout001', 'inv_3dc85bea', NULL, 2026, 8, 74.47, '2.0.0_recovered'),
    ('stout001', 'inv_d3ec0cf8', NULL, 2026, 8, 19.76, '2.0.0_recovered'),
    ('stout001', 'inv_d5761f42', NULL, 2026, 8, 23.67, '2.0.0_recovered'),
    ('stout001', 'inv_a4bddac7', NULL, 2026, 8, 46.70, '2.0.0_recovered'),
    ('stout001', 'inv_1b6a693b', NULL, 2026, 8, 50.25, '2.0.0_recovered'),
    ('stout001', 'inv_ea8b4eba', NULL, 2026, 8, 49.25, '2.0.0_recovered'),
    ('stout001', 'inv_0298b899', NULL, 2026, 8, 125.75, '2.0.0_recovered'),
    ('stout001', 'inv_4d52f6a4', NULL, 2026, 8, 9.77, '2.0.0_recovered'),
    ('stout001', 'inv_60ed0c32', NULL, 2026, 8, 98.87, '2.0.0_recovered'),
    ('stout001', 'inv_8cf28066', NULL, 2026, 8, 46.67, '2.0.0_recovered'),
    ('stout001', 'inv_ce0675be', NULL, 2026, 8, 21.97, '2.0.0_recovered'),
    ('stout001', 'inv_f4daff58', NULL, 2026, 8, 2.36, '2.0.0_recovered'),
    ('stout001', 'inv_b3f5e17f', NULL, 2026, 8, 104.59, '2.0.0_recovered'),
    ('stout001', 'inv_2093cd23', NULL, 2026, 8, 191.83, '2.0.0_recovered'),
    ('stout001', 'inv_16a045fa', NULL, 2026, 8, 24.27, '2.0.0_recovered');

  -- Verify restored August rows
  SELECT COUNT(*), COALESCE(SUM(amount), 0)
  INTO v_restored_aug_count, v_restored_aug_sum
  FROM commission_earnings
  WHERE year = 2026 AND month_number = 8 AND recipient_id = v_josh_id;

  IF v_restored_aug_count != 75 OR v_restored_aug_sum != 11153.73 THEN
    RAISE EXCEPTION 'AUGUST_RESTORATION_FAILED: Restored % rows summing to % (expected 75 rows, $11,153.73)', 
      v_restored_aug_count, v_restored_aug_sum;
  END IF;

  -- ---------------------------------------------------------------------------
  -- 4. UPDATE & LOCK SEPTEMBER RETURN
  -- ---------------------------------------------------------------------------
  UPDATE monthly_returns
  SET gross_return_pct = p_certified_september_return_pct,
      locked = TRUE,
      source = 'Certified Final Close (' || p_admin_id || ')',
      last_updated = NOW()
  WHERE year = 2026 AND month_number = 9;

  -- ---------------------------------------------------------------------------
  -- 5. REBUILD SEPTEMBER INVESTOR GAINS & COMMISSIONS
  -- ---------------------------------------------------------------------------
  -- 5a. Clean any contaminated September commissions for 2026 month 9
  DELETE FROM commission_earnings
  WHERE year = 2026 AND month_number = 9;

  -- 5b. Rebuild September Investor Monthly History
  FOR rec_acc IN (
    SELECT 
      a.id AS account_id,
      a.investor_id,
      COALESCE(a.split_pct, i.split_pct, 100.0) AS split_pct,
      COALESCE(i.monthly_draw, 0) AS monthly_draw,
      COALESCE(h_aug.ending_balance, a.starting_capital) AS aug_ending_balance,
      COALESCE(comm_aug.aug_comm_sum, 0) AS aug_comm_to_credit,
      COALESCE(dep.dep_sum, 0) AS sep_deposits,
      COALESCE(wd.wd_sum, 0) AS sep_withdrawals
    FROM investor_accounts a
    JOIN investors i ON a.investor_id = i.id
    LEFT JOIN investor_monthly_history h_aug 
      ON h_aug.investor_id = i.id AND h_aug.year = 2026 AND h_aug.month_number = 8
    LEFT JOIN (
      SELECT recipient_id, SUM(amount) AS aug_comm_sum
      FROM commission_earnings
      WHERE year = 2026 AND month_number = 8
      GROUP BY recipient_id
    ) comm_aug ON comm_aug.recipient_id = i.id
    LEFT JOIN (
      SELECT investor_id, SUM(amount) AS dep_sum
      FROM deposits
      WHERE (status IS NULL OR status NOT ILIKE 'VOID')
        AND (COALESCE(effective_accounting_date, date::date) >= '2026-09-01' 
             AND COALESCE(effective_accounting_date, date::date) <= '2026-09-30')
      GROUP BY investor_id
    ) dep ON dep.investor_id = i.id
    LEFT JOIN (
      SELECT investor_id, SUM(amount) AS wd_sum
      FROM withdrawals
      WHERE status IN ('Approved', 'Completed')
        AND (COALESCE(effective_accounting_date, request_date::date) >= '2026-09-01' 
             AND COALESCE(effective_accounting_date, request_date::date) <= '2026-09-30')
      GROUP BY investor_id
    ) wd ON wd.investor_id = i.id
    WHERE a.status = 'Active'
  ) LOOP
    -- Opening balance = August ending balance + August commissions earned
    v_opening := rec_acc.aug_ending_balance + rec_acc.aug_comm_to_credit;
    v_adj_start := v_opening + rec_acc.sep_deposits - rec_acc.sep_withdrawals;
    
    IF v_adj_start > 0 THEN
      v_net_return := p_certified_september_return_pct * (rec_acc.split_pct / 100.0);
      v_net_gain := v_adj_start * (v_net_return / 100.0);
    ELSE
      v_net_return := 0.0;
      v_net_gain := 0.0;
    END IF;

    v_ending := v_adj_start + v_net_gain - rec_acc.monthly_draw;

    INSERT INTO investor_monthly_history (
      investor_id, year, month_number, month,
      opening_balance, deposits, withdrawals,
      gross_return_pct, manual_gain_amount, manual_return_pct,
      recurring_draw, ending_balance, is_manual, locked, updated_at
    ) VALUES (
      rec_acc.investor_id, 2026, 9, 'September',
      ROUND(v_opening, 2), ROUND(rec_acc.sep_deposits, 2), ROUND(rec_acc.sep_withdrawals, 2),
      p_certified_september_return_pct, NULL, NULL,
      ROUND(rec_acc.monthly_draw, 2), ROUND(v_ending, 2), FALSE, TRUE, NOW()
    )
    ON CONFLICT (investor_id, year, month_number) DO UPDATE SET
      opening_balance = EXCLUDED.opening_balance,
      deposits = EXCLUDED.deposits,
      withdrawals = EXCLUDED.withdrawals,
      gross_return_pct = EXCLUDED.gross_return_pct,
      ending_balance = EXCLUDED.ending_balance,
      locked = TRUE,
      updated_at = NOW();

    v_sep_history_count := v_sep_history_count + 1;
  END LOOP;

  -- 5c. Rebuild September Commissions based on September profit
  -- Using period-active commission shares and source accounts
  INSERT INTO commission_earnings (
    recipient_id, source_investor_id, source_account_id,
    year, month_number, amount, calculation_version, created_at
  )
  SELECT 
    cs.recipient_investor_id,
    h.investor_id,
    cs.source_account_id,
    2026,
    9,
    ROUND(((h.opening_balance + h.deposits - h.withdrawals) * (p_certified_september_return_pct / 100.0)) * (cs.commission_percent / 100.0), 2),
    '2.0.0_certified_sep',
    NOW()
  FROM commission_shares cs
  JOIN investor_monthly_history h 
    ON h.investor_id = cs.source_investor_id AND h.year = 2026 AND h.month_number = 9
  WHERE cs.status = 'active'
    AND (cs.effective_start_date IS NULL OR cs.effective_start_date <= '2026-09-30')
    AND (cs.effective_end_date IS NULL OR cs.effective_end_date >= '2026-09-01')
    AND (h.opening_balance + h.deposits - h.withdrawals) > 0
    AND p_certified_september_return_pct > 0;

  GET DIAGNOSTICS v_sep_comm_count = ROW_COUNT;
  SELECT COALESCE(SUM(amount), 0) INTO v_sep_comm_sum
  FROM commission_earnings
  WHERE year = 2026 AND month_number = 9;

  -- ---------------------------------------------------------------------------
  -- 6. CORRECT OCTOBER OPENING BALANCES & STRIP OPEN TRADING GAIN
  -- ---------------------------------------------------------------------------
  -- Update October opening balance from September ending balance + September commissions
  FOR rec_oct IN (
    SELECT 
      h_sep.investor_id,
      h_sep.ending_balance AS sep_ending,
      COALESCE(comm_sep.sep_comm_sum, 0) AS sep_comm_to_credit,
      COALESCE(dep.dep_sum, 0) AS oct_deposits,
      COALESCE(wd.wd_sum, 0) AS oct_withdrawals,
      COALESCE(i.monthly_draw, 0) AS monthly_draw
    FROM investor_monthly_history h_sep
    JOIN investors i ON h_sep.investor_id = i.id
    LEFT JOIN (
      SELECT recipient_id, SUM(amount) AS sep_comm_sum
      FROM commission_earnings
      WHERE year = 2026 AND month_number = 9
      GROUP BY recipient_id
    ) comm_sep ON comm_sep.recipient_id = i.id
    LEFT JOIN (
      SELECT investor_id, SUM(amount) AS dep_sum
      FROM deposits
      WHERE (status IS NULL OR status NOT ILIKE 'VOID')
        AND (COALESCE(effective_accounting_date, date::date) >= '2026-10-01' 
             AND COALESCE(effective_accounting_date, date::date) <= '2026-10-31')
      GROUP BY investor_id
    ) dep ON dep.investor_id = i.id
    LEFT JOIN (
      SELECT investor_id, SUM(amount) AS wd_sum
      FROM withdrawals
      WHERE status IN ('Approved', 'Completed')
        AND (COALESCE(effective_accounting_date, request_date::date) >= '2026-10-01' 
             AND COALESCE(effective_accounting_date, request_date::date) <= '2026-10-31')
      GROUP BY investor_id
    ) wd ON wd.investor_id = i.id
    WHERE h_sep.year = 2026 AND h_sep.month_number = 9
  ) LOOP
    v_oct_opening := rec_oct.sep_ending + rec_oct.sep_comm_to_credit;
    -- In CURRENT_OPEN period, settled net gain is strictly $0.00
    v_oct_ending := v_oct_opening + rec_oct.oct_deposits - rec_oct.oct_withdrawals - rec_oct.monthly_draw;

    INSERT INTO investor_monthly_history (
      investor_id, year, month_number, month,
      opening_balance, deposits, withdrawals,
      gross_return_pct, manual_gain_amount, manual_return_pct,
      recurring_draw, ending_balance, is_manual, locked, updated_at
    ) VALUES (
      rec_oct.investor_id, 2026, 10, 'October',
      ROUND(v_oct_opening, 2), ROUND(rec_oct.oct_deposits, 2), ROUND(rec_oct.oct_withdrawals, 2),
      0.00, NULL, NULL,
      ROUND(rec_oct.monthly_draw, 2), ROUND(v_oct_ending, 2), FALSE, FALSE, NOW()
    )
    ON CONFLICT (investor_id, year, month_number) DO UPDATE SET
      opening_balance = EXCLUDED.opening_balance,
      deposits = EXCLUDED.deposits,
      withdrawals = EXCLUDED.withdrawals,
      gross_return_pct = 0.00,
      ending_balance = EXCLUDED.ending_balance,
      locked = FALSE,
      updated_at = NOW();

    v_oct_history_count := v_oct_history_count + 1;
  END LOOP;

  -- Strip contaminated future projections (November and December 2026)
  DELETE FROM investor_monthly_history
  WHERE year = 2026 AND month_number > 10;
  GET DIAGNOSTICS v_future_stripped_count = ROW_COUNT;

  -- ---------------------------------------------------------------------------
  -- 7. POST-EXECUTION INVARIANT ASSERTIONS
  -- ---------------------------------------------------------------------------
  -- Re-assert cash totals
  SELECT COALESCE(SUM(amount), 0) INTO v_josh_cash
  FROM deposits
  WHERE investor_id = v_josh_id
    AND accounting_treatment IN ('NEW_CASH', 'HISTORICAL_PROVENANCE')
    AND (status IS NULL OR status NOT ILIKE 'VOID');

  SELECT COALESCE(SUM(amount), 0) INTO v_ryan_cash
  FROM deposits
  WHERE investor_id = v_ryan_id
    AND accounting_treatment IN ('NEW_CASH', 'HISTORICAL_PROVENANCE')
    AND (status IS NULL OR status NOT ILIKE 'VOID');

  IF v_josh_cash != 1606090 OR v_ryan_cash != 125000 THEN
    RAISE EXCEPTION 'POST_EXECUTION_INVARIANT_FAILED: Cash totals altered! Josh: %, Ryan: %', v_josh_cash, v_ryan_cash;
  END IF;

  v_result := jsonb_build_object(
    'status', 'NOT_EXECUTION_READY__AWAITING_CERTIFIED_RETURN_AND_CLONE_TEST',
    'dry_run', p_dry_run,
    'certified_september_return', p_certified_september_return_pct,
    'restored_august_rows', v_restored_aug_count,
    'restored_august_total', v_restored_aug_sum,
    'september_history_rebuilt_count', v_sep_history_count,
    'september_commissions_generated_count', v_sep_comm_count,
    'september_commissions_total', v_sep_comm_sum,
    'october_history_corrected_count', v_oct_history_count,
    'future_projections_stripped_count', v_future_stripped_count,
    'josh_external_cash_verified', v_josh_cash,
    'ryan_external_cash_verified', v_ryan_cash
  );

  -- ---------------------------------------------------------------------------
  -- 8. ENFORCE DRY-RUN SAFETY (ROLLBACK IF DRY RUN)
  -- ---------------------------------------------------------------------------
  IF p_dry_run IS TRUE THEN
    RAISE EXCEPTION 'DRY_RUN_ROLLBACK_ENFORCED: Validation and invariant checks passed completely. Transaction rolled back with ZERO mutations. %', v_result;
  END IF;

  RETURN v_result;
END;
$$;
