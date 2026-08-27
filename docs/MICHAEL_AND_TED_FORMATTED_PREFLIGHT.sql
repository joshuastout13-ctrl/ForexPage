-- ==============================================================================
-- FORMATTED AUDIT TABLES: MICHAEL LANDON & TED BOARDWALK
-- ==============================================================================

-- 1. HISTORY FOR JULY, AUGUST, SEPT
SELECT 
  i.portal_username,
  h.year,
  h.month_number,
  h.opening_balance,
  h.deposits,
  h.withdrawals,
  h.gross_return_pct,
  h.ending_balance
FROM investor_monthly_history h
JOIN investors i ON i.id = h.investor_id
WHERE i.portal_username IN ('mlandon', 'tboardwalk')
  AND h.year = 2026 AND h.month_number >= 5
ORDER BY i.portal_username, h.month_number;

-- 2. ALL DEPOSITS & WITHDRAWALS
SELECT 
  'DEPOSIT' AS type,
  d.id,
  i.portal_username,
  d.amount,
  d.date,
  d.effective_accounting_date,
  d.type AS dep_type,
  d.notes
FROM deposits d
JOIN investors i ON i.id = d.investor_id
WHERE i.portal_username IN ('mlandon', 'tboardwalk')

UNION ALL

SELECT 
  'WITHDRAWAL' AS type,
  w.id,
  i.portal_username,
  w.amount,
  w.request_date AS date,
  w.effective_accounting_date,
  w.status AS dep_type,
  w.notes
FROM withdrawals w
JOIN investors i ON i.id = w.investor_id
WHERE i.portal_username IN ('mlandon', 'tboardwalk')
ORDER BY portal_username, date;

-- 3. PROFILES
SELECT 
  i.id,
  i.portal_username,
  i.start_date,
  i.split_pct,
  a.starting_capital
FROM investors i
LEFT JOIN investor_accounts a ON a.investor_id = i.id OR a.id = i.portal_username
WHERE i.portal_username IN ('mlandon', 'tboardwalk');
