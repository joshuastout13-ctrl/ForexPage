-- ==============================================================================
-- SINGLE-ROW JSON PREFLIGHT CAS AUDIT: MICHAEL LANDON & TED BOARDWALK
-- Database: julhldzkiqdeuuoqmvlo (Supabase Production - Stone Forex)
-- ==============================================================================
SELECT json_build_object(
  'profiles', (
    SELECT json_agg(json_build_object(
      'id', i.id,
      'portal_username', i.portal_username,
      'start_date', i.start_date,
      'split_pct', i.split_pct,
      'monthly_draw', i.monthly_draw,
      'active', i.active,
      'account_id', a.id,
      'open_date', a.open_date,
      'starting_capital', a.starting_capital,
      'status', a.status
    ))
    FROM investors i
    LEFT JOIN investor_accounts a ON a.investor_id = i.id OR a.id = i.portal_username
    WHERE i.portal_username IN ('mlandon', 'tboardwalk')
  ),
  'history_2026', (
    SELECT json_agg(json_build_object(
      'portal_username', i.portal_username,
      'year', h.year,
      'month_number', h.month_number,
      'opening_balance', h.opening_balance,
      'deposits', h.deposits,
      'withdrawals', h.withdrawals,
      'gross_return_pct', h.gross_return_pct,
      'ending_balance', h.ending_balance,
      'locked', h.locked
    ) ORDER BY i.portal_username, h.year, h.month_number)
    FROM investor_monthly_history h
    JOIN investors i ON i.id = h.investor_id
    WHERE i.portal_username IN ('mlandon', 'tboardwalk')
  ),
  'deposits', (
    SELECT json_agg(json_build_object(
      'id', d.id,
      'portal_username', i.portal_username,
      'amount', d.amount,
      'date', d.date,
      'effective_accounting_date', d.effective_accounting_date,
      'type', d.type,
      'notes', d.notes
    ) ORDER BY i.portal_username, COALESCE(d.effective_accounting_date, d.date))
    FROM deposits d
    JOIN investors i ON i.id = d.investor_id
    WHERE i.portal_username IN ('mlandon', 'tboardwalk')
  ),
  'withdrawals', (
    SELECT json_agg(json_build_object(
      'id', w.id,
      'portal_username', i.portal_username,
      'amount', w.amount,
      'status', w.status,
      'request_date', w.request_date,
      'effective_accounting_date', w.effective_accounting_date,
      'year', w.year,
      'month_number', w.month_number
    ) ORDER BY i.portal_username, w.year, w.month_number)
    FROM withdrawals w
    JOIN investors i ON i.id = w.investor_id
    WHERE i.portal_username IN ('mlandon', 'tboardwalk')
  ),
  'ted_july_aug_commissions', (
    SELECT json_agg(json_build_object(
      'id', c.id,
      'recipient', r.portal_username,
      'source', s.portal_username,
      'year', c.year,
      'month_number', c.month_number,
      'amount', c.amount
    ))
    FROM commission_earnings c
    LEFT JOIN investors r ON r.id = c.recipient_id
    LEFT JOIN investors s ON s.id = c.source_investor_id
    WHERE (r.portal_username = 'tboardwalk' OR s.portal_username = 'tboardwalk')
      AND c.year = 2026 AND c.month_number IN (6, 7, 8)
  ),
  'existing_cutovers', (
    SELECT json_agg(row_to_json(c))
    FROM account_cutover_adjustments c
    WHERE c.investor_id IN (SELECT id FROM investors WHERE portal_username IN ('mlandon', 'tboardwalk'))
  )
) AS live_preflight_data;
