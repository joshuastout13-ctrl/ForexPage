-- =============================================================================
-- PREPARED AUDITED IDEMPOTENT CORRECTION: TED BOARDWALK (inv_a79798ca)
-- DO NOT EXECUTE UNTIL EXPLICITLY AUTHORIZED BY EXECUTIVE LEADERSHIP
--
-- Authorization Reference: JOSH_CONFIRMED_TED_BOARDWALK_ZERO_RESET_SEPTEMBER_1_2026
-- Cutover Reference: cutover_inv_a79798ca_2026_9 ($0.00 authorized opening basis)
--
-- Scope:
-- 1. September 2026: Set opening = $0.00, gain = $0.00, ending = $0.00, locked = TRUE
-- 2. October 2026: Set opening = $1,702.78 (September commission), ending = $1,702.78
-- 3. Historical ledger (June $5,000 withdrawal wd_9a4f1219) remains strictly untouched.
-- =============================================================================

BEGIN;

-- 1. Correct September 2026 investor_monthly_history
INSERT INTO investor_monthly_history (
  investor_id,
  account_id,
  year,
  month_number,
  month,
  opening_balance,
  deposits,
  withdrawals,
  gross_return_pct,
  manual_gain_amount,
  manual_return_pct,
  recurring_draw,
  ending_balance,
  is_manual,
  locked,
  notes,
  updated_at
) VALUES (
  'inv_a79798ca',
  'tboardwalk',
  2026,
  9,
  'September',
  0.00,
  0.00,
  0.00,
  3.07,
  0.00,
  NULL,
  0.00,
  0.00,
  TRUE,
  TRUE,
  'Audited correction per authorized cutover cutover_inv_a79798ca_2026_9 ($0.00 September 1 reset)',
  NOW()
)
ON CONFLICT (investor_id, year, month_number) DO UPDATE SET
  opening_balance = 0.00,
  deposits = 0.00,
  withdrawals = 0.00,
  gross_return_pct = 3.07,
  manual_gain_amount = 0.00,
  manual_return_pct = NULL,
  recurring_draw = 0.00,
  ending_balance = 0.00,
  is_manual = TRUE,
  locked = TRUE,
  notes = 'Audited correction per authorized cutover cutover_inv_a79798ca_2026_9 ($0.00 September 1 reset)',
  updated_at = NOW();

-- 2. Correct October 2026 investor_monthly_history
-- September ending ($0.00) + September commission earned ($1,702.78) = $1,702.78
INSERT INTO investor_monthly_history (
  investor_id,
  account_id,
  year,
  month_number,
  month,
  opening_balance,
  deposits,
  withdrawals,
  gross_return_pct,
  manual_gain_amount,
  manual_return_pct,
  recurring_draw,
  ending_balance,
  is_manual,
  locked,
  notes,
  updated_at
) VALUES (
  'inv_a79798ca',
  'tboardwalk',
  2026,
  10,
  'October',
  1702.78,
  0.00,
  0.00,
  0.00,
  NULL,
  NULL,
  0.00,
  1702.78,
  FALSE,
  FALSE,
  'Rollforward from $0.00 September close + $1,702.78 September commission earned',
  NOW()
)
ON CONFLICT (investor_id, year, month_number) DO UPDATE SET
  opening_balance = 1702.78,
  deposits = 0.00,
  withdrawals = 0.00,
  gross_return_pct = 0.00,
  manual_gain_amount = NULL,
  manual_return_pct = NULL,
  recurring_draw = 0.00,
  ending_balance = 1702.78,
  is_manual = FALSE,
  locked = FALSE,
  notes = 'Rollforward from $0.00 September close + $1,702.78 September commission earned',
  updated_at = NOW();

COMMIT;
