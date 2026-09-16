-- =============================================================================
-- Schema Update V5.1: Legacy Deposit Isolation & Full Idempotency Hardening
-- Target: Supabase PostgreSQL (project julhldzkiqdeuuoqmvlo)
-- Mode: Safe Additive Hardening (0 financial amounts mutated)
-- =============================================================================

-- 1. EXPAND ACCOUNTING TREATMENT CHECK CONSTRAINT
--    Allows UNVERIFIED_LEGACY in addition to NEW_CASH and HISTORICAL_PROVENANCE.
ALTER TABLE deposits DROP CONSTRAINT IF EXISTS deposits_accounting_treatment_check;
ALTER TABLE deposits ADD CONSTRAINT deposits_accounting_treatment_check
  CHECK (accounting_treatment IN ('NEW_CASH', 'HISTORICAL_PROVENANCE', 'UNVERIFIED_LEGACY'));

-- 2. ISOLATE PRE-EXISTING LEGACY DEPOSITS FROM PROVEN EXTERNAL CASH
--    Pre-existing rows that were created prior to v5 (or with null created_by)
--    received NEW_CASH by default. Reclassify them to UNVERIFIED_LEGACY so they
--    do NOT falsely imply proven external cash for Total Deposits / Performance,
--    while preserving their participation in historical monthly ledger compounding.
UPDATE deposits
SET accounting_treatment = 'UNVERIFIED_LEGACY',
    updated_at = NOW()
WHERE accounting_treatment = 'NEW_CASH'
  AND (created_by IS NULL OR created_by = 'migration_default');

-- 3. CHANGE DEFAULT FOR FUTURE INSERTS TO UNVERIFIED_LEGACY
--    Ensures no newly created unverified row can accidentally become NEW_CASH.
ALTER TABLE deposits ALTER COLUMN accounting_treatment SET DEFAULT 'UNVERIFIED_LEGACY';

-- 4. HARDEN IDEMPOTENCY KEY COVERAGE ACROSS ALL ROWS
--    Assign deterministic, non-null keys for any legacy rows that have NULL idempotency_key.
--    This guarantees 100% non-null coverage under idx_deposits_idempotency_key.
UPDATE deposits
SET idempotency_key = 'legacy_' || id,
    updated_at = NOW()
WHERE idempotency_key IS NULL;
