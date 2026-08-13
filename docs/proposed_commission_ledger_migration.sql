-- =============================================================================
-- STONE & COMPANY FOREX FUND — PROPOSED COMMISSION LEDGER PROVENANCE MIGRATION
-- Status: PROPOSED / UNAPPLIED (SAFETY CERTIFICATION MODE)
-- =============================================================================

-- Add provenance and snapshot fields to commission_earnings table
ALTER TABLE commission_earnings
  ADD COLUMN IF NOT EXISTS source_account_id TEXT,
  ADD COLUMN IF NOT EXISTS commission_percent_snapshot NUMERIC(5, 2),
  ADD COLUMN IF NOT EXISTS commission_share_rule_id TEXT,
  ADD COLUMN IF NOT EXISTS calculation_version TEXT DEFAULT '2.0.0',
  ADD COLUMN IF NOT EXISTS period_id UUID;

-- Create composite unique constraint incorporating source_account_id fallback
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_commission_earnings_account_granularity'
  ) THEN
    ALTER TABLE commission_earnings 
      ADD CONSTRAINT uq_commission_earnings_account_granularity 
      UNIQUE (year, month_number, source_investor_id, recipient_id);
  END IF;
END $$;
