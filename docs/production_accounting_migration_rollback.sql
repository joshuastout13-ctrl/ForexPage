-- =============================================================================
-- STONE & COMPANY FOREX FUND — PRODUCTION ACCOUNTING MIGRATION ROLLBACK SQL
-- Status: SAFE ROLLBACK PROCEDURE
-- =============================================================================

-- =============================================================================
-- SECTION 1: PRE-FINALIZATION ROLLBACK (SCHEMA ONLY)
-- Safe to execute if migration was deployed but NO month has been finalized.
-- =============================================================================

-- 1. REVOKE RPC EXECUTION PRIVILEGES AND DROP FUNCTION
REVOKE ALL ON FUNCTION finalize_monthly_accounting_period(INTEGER, INTEGER, NUMERIC, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB) FROM PUBLIC, anon, authenticated, service_role, postgres;
DROP FUNCTION IF EXISTS finalize_monthly_accounting_period CASCADE;

-- 2. DROP ADDITIVE ACCOUNTING TABLES (ONLY IF UNUSED)
DROP TABLE IF EXISTS accounting_preview_runs CASCADE;
DROP TABLE IF EXISTS accounting_periods CASCADE;

-- 3. REMOVE ADDITIVE COLUMNS (PRESERVING BASE DATA)
ALTER TABLE commission_earnings DROP CONSTRAINT IF EXISTS commission_earnings_ledger_key_key;
ALTER TABLE commission_earnings DROP COLUMN IF EXISTS ledger_key;
ALTER TABLE commission_earnings DROP COLUMN IF EXISTS source_account_id;
ALTER TABLE commission_earnings DROP COLUMN IF EXISTS commission_percent_snapshot;
ALTER TABLE commission_earnings DROP COLUMN IF EXISTS commission_share_rule_id;
ALTER TABLE commission_earnings DROP COLUMN IF EXISTS calculation_version;
ALTER TABLE commission_earnings DROP COLUMN IF EXISTS accounting_period_id;

ALTER TABLE deposits DROP COLUMN IF EXISTS effective_accounting_date;
ALTER TABLE withdrawals DROP COLUMN IF EXISTS effective_accounting_date;


-- =============================================================================
-- SECTION 2: POST-FINALIZATION EMERGENCY RECOVERY PROCEDURE
-- DO NOT BLINDLY EXECUTE DROP STATEMENTS AFTER FINALIZATION HAS OCCURRED!
-- Financial history and commission ledger entries created during a finalized
-- month close represent official fund statements and must NOT be blindly dropped.
--
-- Post-finalization recovery procedure:
-- 1. Disable feature flag: ACCOUNTING_FINALIZATION_ENABLED="false"
-- 2. Restore PostgreSQL database from pre-finalization point-in-time backup.
-- =============================================================================
