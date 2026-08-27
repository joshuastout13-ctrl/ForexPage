-- ==============================================================================
-- PLATFORM-WIDE READ-ONLY POST-CORRECTION FINANCIAL AUDIT SWEEP
-- Database: julhldzkiqdeuuoqmvlo (Supabase Production - Stone Forex)
-- Mode: STRICTLY READ-ONLY (0 mutations)
-- Description: Validates cent-exact accounting continuity, commission capitalization,
--              cutover baselines, and cashflow integrity across ALL active accounts.
-- ==============================================================================

WITH active_investors AS (
  SELECT 
    i.id AS investor_id,
    i.portal_username,
    i.start_date,
    i.split_pct,
    COALESCE(a.starting_capital, 0.00) AS starting_capital,
    a.open_date
  FROM investors i
  LEFT JOIN investor_accounts a ON a.investor_id = i.id OR a.id = i.portal_username
  WHERE i.active = true
),
july_aug_history AS (
  SELECT 
    h.investor_id,
    h.year,
    h.month_number,
    h.opening_balance,
    h.deposits,
    h.withdrawals,
    h.gross_return_pct,
    h.ending_balance
  FROM investor_monthly_history h
  WHERE h.year = 2026 AND h.month_number IN (7, 8)
),
july_commissions AS (
  SELECT 
    c.recipient_id AS investor_id,
    COALESCE(SUM(c.amount), 0.00) AS july_comm_total
  FROM commission_earnings c
  WHERE c.year = 2026 AND c.month_number = 7
  GROUP BY c.recipient_id
),
cutovers AS (
  SELECT 
    investor_id,
    year,
    month_number,
    authorized_opening_balance
  FROM account_cutover_adjustments
  WHERE year = 2026 AND month_number = 8
),
continuity_eval AS (
  SELECT 
    ai.investor_id,
    ai.portal_username,
    jh.ending_balance AS july_ending,
    COALESCE(jc.july_comm_total, 0.00) AS july_comm,
    COALESCE(co.authorized_opening_balance, NULL) AS cutover_opening,
    ah.opening_balance AS aug_opening,
    ah.withdrawals AS aug_withdrawals,
    ah.ending_balance AS aug_ending,
    CASE 
      -- If cutover exists, expected August opening is the cutover opening
      WHEN co.authorized_opening_balance IS NOT NULL THEN
        ROUND(ABS(ah.opening_balance - co.authorized_opening_balance), 4)
      -- Otherwise expected August opening is July ending + July commissions
      ELSE
        ROUND(ABS(ah.opening_balance - (COALESCE(jh.ending_balance, 0.00) + COALESCE(jc.july_comm_total, 0.00))), 4)
    END AS aug_open_variance,
    -- August ending variance at 0% unfinalized return
    ROUND(ABS(ah.ending_balance - (ah.opening_balance - COALESCE(ah.withdrawals, 0.00))), 4) AS aug_end_variance
  FROM active_investors ai
  LEFT JOIN july_aug_history jh ON jh.investor_id = ai.investor_id AND jh.month_number = 7
  LEFT JOIN july_aug_history ah ON ah.investor_id = ai.investor_id AND ah.month_number = 8
  LEFT JOIN july_commissions jc ON jc.investor_id = ai.investor_id
  LEFT JOIN cutovers co ON co.investor_id = ai.investor_id
)
SELECT 
  -- 1. Population Overview
  (SELECT COUNT(*) FROM active_investors) AS total_active_investors,
  (SELECT COUNT(*) FROM account_cutover_adjustments) AS total_active_cutovers,
  
  -- 2. Continuity & Mathematical Variance Counts (Cent-Exact: > $0.005)
  (SELECT COUNT(*) FROM continuity_eval WHERE aug_open_variance > 0.005) AS accounts_with_open_variance,
  (SELECT COUNT(*) FROM continuity_eval WHERE aug_end_variance > 0.005) AS accounts_with_end_variance,
  
  -- 3. Detailed Nonzero Variance Rows (if any)
  (
    SELECT json_agg(json_build_object(
      'username', portal_username,
      'july_ending', july_ending,
      'july_comm', july_comm,
      'cutover_opening', cutover_opening,
      'aug_opening', aug_opening,
      'open_variance', aug_open_variance,
      'end_variance', aug_end_variance
    ))
    FROM continuity_eval
    WHERE aug_open_variance > 0.005 OR aug_end_variance > 0.005
  ) AS variance_details;
