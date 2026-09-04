-- ============================================================================
-- MIGRATION: ADD CASH CONTRIBUTION PROVENANCE TO INVESTOR_ACCOUNTS
-- ============================================================================
-- Purpose: Adds explicit provenance columns to distinguish genuine external
--          investor cash contributions from migration / cutover baselines.
-- Safety: Non-destructive schema addition (NULL defaults, zero ledger changes).
-- ============================================================================

ALTER TABLE investor_accounts 
ADD COLUMN IF NOT EXISTS initial_cash_contribution NUMERIC(20,2) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS capital_origin_type VARCHAR(50) DEFAULT 'UNKNOWN',
ADD COLUMN IF NOT EXISTS provenance_notes TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS provenance_evidence_source TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS last_provenance_audit TIMESTAMPTZ DEFAULT NOW();

COMMENT ON COLUMN investor_accounts.initial_cash_contribution IS 'Proven genuine external cash wire/funding contributed by the investor at onboarding';
COMMENT ON COLUMN investor_accounts.capital_origin_type IS 'EXTERNAL_CASH, MIGRATION_BASELINE, CUTOVER_BASELINE, UNKNOWN';
COMMENT ON COLUMN investor_accounts.provenance_evidence_source IS 'Authoritative provenance reference (e.g. Onboarding Wire, Certified Cutover)';
