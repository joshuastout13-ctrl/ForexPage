-- ============================================================================
-- CONSOLIDATED READ-ONLY PRODUCTION AUDIT FOR 7 REMAINING ACCOUNTS
-- Target Database: julhldzkiqdeuuoqmvlo (Supabase Production - Stone Forex)
-- Target Investors: mharris, mbeck, glarson, mlandon, jbennion, tboardwalk, jshaffar
-- Mode: STRICTLY READ-ONLY (SELECT queries only, 0 mutations)
-- ============================================================================

-- 1. PROFILES & ACCOUNT METADATA
SELECT 
  i.id AS investor_id,
  i.portal_username,
  i.start_date AS investor_start_date,
  i.split_pct AS investor_split_pct,
  i.monthly_draw AS investor_monthly_draw,
  i.active AS investor_active,
  a.id AS account_id,
  a.open_date AS account_open_date,
  a.starting_capital,
  a.status AS account_status
FROM investors i
LEFT JOIN investor_accounts a ON a.investor_id = i.id OR a.id = i.portal_username
WHERE i.portal_username IN ('mharris', 'mbeck', 'glarson', 'mlandon', 'jbennion', 'tboardwalk', 'jshaffar')
   OR i.id IN ('inv_4c5c0ee6', 'inv_2093cd23', 'inv_f4daff58', 'inv_1311b51e', 'inv_65b7fbd9', 'inv_a79798ca', 'inv_3e8224ee')
ORDER BY i.portal_username;

-- 2. MONTHLY HISTORY (2026) FOR ALL 7 ACCOUNTS
SELECT 
  h.investor_id,
  i.portal_username,
  h.year,
  h.month_number,
  h.month,
  h.opening_balance,
  h.deposits,
  h.withdrawals,
  h.gross_return_pct,
  h.ending_balance,
  h.is_manual,
  h.locked,
  h.notes
FROM investor_monthly_history h
JOIN investors i ON i.id = h.investor_id
WHERE (i.portal_username IN ('mharris', 'mbeck', 'glarson', 'mlandon', 'jbennion', 'tboardwalk', 'jshaffar')
   OR i.id IN ('inv_4c5c0ee6', 'inv_2093cd23', 'inv_f4daff58', 'inv_1311b51e', 'inv_65b7fbd9', 'inv_a79798ca', 'inv_3e8224ee'))
  AND h.year = 2026
ORDER BY i.portal_username, h.month_number;

-- 3. ALL DEPOSITS FOR ALL 7 ACCOUNTS
SELECT 
  d.id AS deposit_id,
  d.investor_id,
  i.portal_username,
  d.account_id,
  d.amount,
  d.date,
  d.effective_accounting_date,
  d.type,
  d.notes,
  d.created_at
FROM deposits d
JOIN investors i ON i.id = d.investor_id
WHERE i.portal_username IN ('mharris', 'mbeck', 'glarson', 'mlandon', 'jbennion', 'tboardwalk', 'jshaffar')
   OR i.id IN ('inv_4c5c0ee6', 'inv_2093cd23', 'inv_f4daff58', 'inv_1311b51e', 'inv_65b7fbd9', 'inv_a79798ca', 'inv_3e8224ee')
ORDER BY i.portal_username, COALESCE(d.effective_accounting_date, d.date);

-- 4. ALL WITHDRAWALS FOR ALL 7 ACCOUNTS
SELECT 
  w.id AS withdrawal_id,
  w.investor_id,
  i.portal_username,
  w.account_id,
  w.amount,
  w.status,
  w.request_date,
  w.effective_accounting_date,
  w.year,
  w.month_number,
  w.idempotency_key,
  w.notes,
  w.created_at
FROM withdrawals w
JOIN investors i ON i.id = w.investor_id
WHERE i.portal_username IN ('mharris', 'mbeck', 'glarson', 'mlandon', 'jbennion', 'tboardwalk', 'jshaffar')
   OR i.id IN ('inv_4c5c0ee6', 'inv_2093cd23', 'inv_f4daff58', 'inv_1311b51e', 'inv_65b7fbd9', 'inv_a79798ca', 'inv_3e8224ee')
ORDER BY i.portal_username, w.year, w.month_number, w.created_at;

-- 5. COMMISSION EARNINGS INVOLVING ANY OF THE 7 ACCOUNTS (RECIPIENT OR SOURCE)
SELECT 
  c.id AS commission_id,
  c.recipient_id,
  r.portal_username AS recipient_username,
  c.source_investor_id,
  s.portal_username AS source_username,
  c.year,
  c.month_number,
  c.amount,
  c.rate_pct,
  c.created_at
FROM commission_earnings c
LEFT JOIN investors r ON r.id = c.recipient_id
LEFT JOIN investors s ON s.id = c.source_investor_id
WHERE r.portal_username IN ('mharris', 'mbeck', 'glarson', 'mlandon', 'jbennion', 'tboardwalk', 'jshaffar')
   OR s.portal_username IN ('mharris', 'mbeck', 'glarson', 'mlandon', 'jbennion', 'tboardwalk', 'jshaffar')
ORDER BY c.year, c.month_number, r.portal_username;
