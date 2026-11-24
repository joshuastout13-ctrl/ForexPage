-- =============================================================================
-- Migration (DRAFT — NOT APPLIED): Add investors.show_fund_performance Column
-- Target: Supabase PostgreSQL (public.investors)
-- Order:  Prerequisite for 20261123220000_atomic_admin_investor_update_rpc.sql
--
-- SAFETY & DEPLOYMENT NOTES:
--   1. Additive display-only boolean column on public.investors.
--   2. Existing and newly inserted investors default to show_fund_performance = FALSE
--      with NOT NULL enforced.
--   3. Zero financial columns, financial records, accounting formulas, or policies
--      are modified.
--   4. Safe and idempotent to re-run; requires explicit owner authorization before
--      applying to Production.
-- =============================================================================

BEGIN;

-- 1. Add column if absent (PostgreSQL 11+ metadata-only default fill to FALSE)
ALTER TABLE public.investors
  ADD COLUMN IF NOT EXISTS show_fund_performance BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. Ensure default, backfill any pre-existing NULLs (if column existed as nullable),
--    and enforce NOT NULL
ALTER TABLE public.investors
  ALTER COLUMN show_fund_performance SET DEFAULT FALSE;

UPDATE public.investors
SET show_fund_performance = FALSE
WHERE show_fund_performance IS NULL;

ALTER TABLE public.investors
  ALTER COLUMN show_fund_performance SET NOT NULL;

COMMENT ON COLUMN public.investors.show_fund_performance IS
  'Controls visibility of the Fund Performance sidebar card on the investor dashboard. Default FALSE. Display-only setting.';

NOTIFY pgrst, 'reload schema';

COMMIT;
