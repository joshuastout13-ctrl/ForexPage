-- =============================================================================
-- STONE & COMPANY FOREX FUND — PROPOSED ACCOUNTING PERIODS LIFECYCLE MIGRATION
-- Status: PROPOSED / UNAPPLIED (SAFETY CERTIFICATION MODE)
-- =============================================================================

CREATE TABLE IF NOT EXISTS accounting_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  year INTEGER NOT NULL,
  month_number INTEGER NOT NULL CHECK (month_number BETWEEN 1 AND 12),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'PREVIEWED', 'VALIDATED', 'FINALIZED', 'REOPENED')),
  fund_return_pct NUMERIC(5, 2),
  return_source TEXT,
  return_status TEXT,
  return_captured_at TIMESTAMPTZ,
  preview_input_hash TEXT,
  preview_run_id TEXT,
  preview_generated_at TIMESTAMPTZ,
  validated_at TIMESTAMPTZ,
  finalized_at TIMESTAMPTZ,
  finalized_by TEXT,
  calculation_version TEXT NOT NULL DEFAULT '2.0.0',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_accounting_periods_year_month UNIQUE (year, month_number)
);

COMMENT ON TABLE accounting_periods IS 'Tracks official lifecycle states (OPEN, PREVIEWED, VALIDATED, FINALIZED) and lock metadata for monthly accounting periods.';
