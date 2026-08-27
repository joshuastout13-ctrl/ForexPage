-- ==============================================================================
-- READ-ONLY PREFLIGHT CAS AUDIT: MICHAEL LANDON & TED BOARDWALK
-- Database: julhldzkiqdeuuoqmvlo (Supabase Production - Stone Forex)
-- Target Investors: mlandon (inv_f4daff58), tboardwalk (inv_a79798ca)
-- Mode: STRICTLY READ-ONLY (0 mutations)
-- ==============================================================================

-- 1. INVESTOR & ACCOUNT PROFILES
SELECT 
  i.id AS investor_id,
  i.portal_username,
  i.start_date,
  i.split_pct,
  i.monthly_draw,
  i.active,
  a.id AS account_id,
  a.open_date,
  a.starting_capital,
  a.status AS account_status
FROM investors i
LEFT JOIN investor_accounts a ON a.investor_id = i.id OR a.id = i.portal_username
WHERE i.id IN ('inv_f4daff58', 'inv_a79798ca')
   OR i.portal_username IN ('mlandon', 'tboardwalk')
ORDER BY i.portal_username;

-- 2. MONTHLY HISTORY (2026)
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
WHERE i.id IN ('inv_f4daff58', 'inv_a79798ca')
   OR i.portal_username IN ('mlandon', 'tboardwalk')
ORDER BY i.portal_username, h.year, h.month_number;

-- 3. ALL DEPOSITS (MICHAEL LANDON & TED BOARDWALK)
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
WHERE i.id IN ('inv_f4daff58', 'inv_a79798ca')
   OR i.portal_username IN ('mlandon', 'tboardwalk')
ORDER BY i.portal_username, COALESCE(d.effective_accounting_date, d.date);

-- 4. ALL WITHDRAWALS (MICHAEL LANDON & TED BOARDWALK)
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
  w.notes,
  w.created_at
FROM withdrawals w
JOIN investors i ON i.id = w.investor_id
WHERE i.id IN ('inv_f4daff58', 'inv_a79798ca')
   OR i.portal_username IN ('mlandon', 'tboardwalk')
ORDER BY i.portal_username, w.year, w.month_number;

-- 5. COMMISSION EARNINGS INVOLVING TED BOARDWALK OR MICHAEL LANDON
SELECT 
  c.id AS commission_id,
  c.recipient_id,
  r.portal_username AS recipient_username,
  c.source_investor_id,
  s.portal_username AS source_username,
  c.year,
  c.month_number,
  c.amount,
  c.created_at
FROM commission_earnings c
LEFT JOIN investors r ON r.id = c.recipient_id
LEFT JOIN investors s ON s.id = c.source_investor_id
WHERE r.portal_username IN ('mlandon', 'tboardwalk')
   OR s.portal_username IN ('mlandon', 'tboardwalk')
   OR r.id IN ('inv_f4daff58', 'inv_a79798ca')
   OR s.id IN ('inv_f4daff58', 'inv_a79798ca')
ORDER BY c.year, c.month_number;

-- 6. EXISTING CUTOVER ADJUSTMENTS (IF ANY)
SELECT * FROM account_cutover_adjustments
WHERE investor_id IN ('inv_f4daff58', 'inv_a79798ca')
   OR investor_id IN (SELECT id FROM investors WHERE portal_username IN ('mlandon', 'tboardwalk'));
