-- =============================================================================
-- STONE & COMPANY FOREX FUND — PROPOSED PREVIEW RUNS CACHE MIGRATION
-- Status: PROPOSED / UNAPPLIED (SAFETY CERTIFICATION MODE)
-- =============================================================================

CREATE TABLE IF NOT EXISTS accounting_preview_runs (
  id TEXT PRIMARY KEY,
  year INTEGER NOT NULL,
  month_number INTEGER NOT NULL CHECK (month_number BETWEEN 1 AND 12),
  input_hash TEXT NOT NULL,
  engine_version TEXT NOT NULL DEFAULT '2.0.0',
  summary_json JSONB NOT NULL,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '1 hour')
);

COMMENT ON TABLE accounting_preview_runs IS 'Ephemeral lightweight record of accounting preview runs for stale input hash verification and audit tracking.';
