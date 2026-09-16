-- =============================================================================
-- Schema Update V5: Authoritative External Cash Provenance
-- Target: Supabase PostgreSQL (project julhldzkiqdeuuoqmvlo)
-- Purpose: Make deposits table the single authoritative source for
--          Total Deposits and Total Performance calculations.
--
-- CRITICAL DESIGN INTENT:
--   accounting_treatment = 'NEW_CASH'
--     -> External cash received that HAS NOT yet been reflected in the
--        accounting baseline. Adds to the monthly compounding balance.
--
--   accounting_treatment = 'HISTORICAL_PROVENANCE'
--     -> External cash Josh confirms was received historically but whose
--        economic effect is ALREADY present in the imported/cutover
--        accounting history. Establishes Total Deposits provenance WITHOUT
--        adding to the balance a second time.
--
-- SAFETY: All changes are additive (ADD COLUMN IF NOT EXISTS).
--         No existing financial data is modified.
--         No triggers. No stored procedures.
--         Rollback = drop new columns (data-safe, non-destructive).
-- =============================================================================

-- 1. STATUS COLUMN
--    Replaces the type='VOID' pattern with a proper status lifecycle.
--    Allowed values: 'confirmed', 'void', 'cancelled'
--    Default: 'confirmed' (existing rows treated as confirmed)
ALTER TABLE deposits ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'confirmed';

-- Apply CHECK constraint (safe IF NOT EXISTS equivalent via DO block)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'deposits_status_check'
  ) THEN
    ALTER TABLE deposits ADD CONSTRAINT deposits_status_check
      CHECK (status IN ('confirmed', 'void', 'cancelled'));
  END IF;
END $$;

-- 2. ACCOUNTING TREATMENT COLUMN
--    Distinguishes NEW_CASH (balance-affecting), HISTORICAL_PROVENANCE
--    (provenance-only), and UNVERIFIED_LEGACY (pre-v5 unverified rows).
--    Default: 'UNVERIFIED_LEGACY' (ensures unproven rows do not count as proven cash)
ALTER TABLE deposits ADD COLUMN IF NOT EXISTS accounting_treatment TEXT DEFAULT 'UNVERIFIED_LEGACY';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'deposits_accounting_treatment_check'
  ) THEN
    ALTER TABLE deposits ADD CONSTRAINT deposits_accounting_treatment_check
      CHECK (accounting_treatment IN ('NEW_CASH', 'HISTORICAL_PROVENANCE', 'UNVERIFIED_LEGACY'));
  END IF;
END $$;

-- 3. EFFECTIVE ACCOUNTING DATE
--    Formalizes the column the API handler already attempts to write.
--    Stores the first-of-month date for the accounting period this deposit affects.
--    Only meaningful for NEW_CASH records.
ALTER TABLE deposits ADD COLUMN IF NOT EXISTS effective_accounting_date DATE;

-- 4. AUDIT TRAIL — CREATION
--    Records which admin created this deposit (assertAuditActor value).
ALTER TABLE deposits ADD COLUMN IF NOT EXISTS created_by TEXT;

-- 5. AUDIT TRAIL — UPDATES
ALTER TABLE deposits ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- 6. AUDIT TRAIL — VOID
--    When and by whom a deposit was voided, and why.
ALTER TABLE deposits ADD COLUMN IF NOT EXISTS voided_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE deposits ADD COLUMN IF NOT EXISTS voided_by TEXT;
ALTER TABLE deposits ADD COLUMN IF NOT EXISTS void_reason TEXT;

-- 7. IDEMPOTENCY KEY
--    Enables atomic duplicate prevention for the same cash event.
--    Built deterministically: type:investor_id:effective_date:amount_cents:purpose
--    Partial unique index: only enforced when key is not NULL.
ALTER TABLE deposits ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_deposits_idempotency_key
  ON deposits(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- 8. PERFORMANCE INDEXES
CREATE INDEX IF NOT EXISTS idx_deposits_accounting_treatment
  ON deposits(accounting_treatment);

CREATE INDEX IF NOT EXISTS idx_deposits_status
  ON deposits(status);

CREATE INDEX IF NOT EXISTS idx_deposits_effective_accounting_date
  ON deposits(effective_accounting_date);

-- 9. BACKFILL: mark existing VOID-typed rows with status='void'
--    This is safe and non-destructive; does not change amounts or dates.
UPDATE deposits
SET status = 'void', updated_at = NOW()
WHERE type = 'VOID' AND status IS DISTINCT FROM 'void';

-- =============================================================================
-- VERIFICATION QUERY (run after migration to confirm)
-- SELECT
--   COUNT(*) AS total_deposits,
--   COUNT(*) FILTER (WHERE accounting_treatment = 'NEW_CASH') AS new_cash,
--   COUNT(*) FILTER (WHERE accounting_treatment = 'HISTORICAL_PROVENANCE') AS historical_provenance,
--   COUNT(*) FILTER (WHERE status = 'confirmed') AS confirmed,
--   COUNT(*) FILTER (WHERE status = 'void') AS voided,
--   COUNT(*) FILTER (WHERE idempotency_key IS NOT NULL) AS with_idempotency_key
-- FROM deposits;
-- =============================================================================
