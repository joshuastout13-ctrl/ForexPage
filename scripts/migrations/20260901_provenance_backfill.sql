-- ============================================================================
-- PROVENANCE BACKFILL: AUTHORITATIVE PRIMARY-SOURCE CASH CONTRIBUTION & ORIGIN
-- ============================================================================
-- Purpose: Backfills ONLY primary-source verified external cash contributions.
-- Rule:    No heuristic assignment of EXTERNAL_CASH to unverified starting_capital.
-- Safety:  Auditable, non-destructive, zero changes to financial history rows.
-- ============================================================================

-- 1. Unverified Accounts (Default to UNKNOWN provenance and NULL initial cash)
UPDATE investor_accounts
SET initial_cash_contribution = NULL,
    capital_origin_type = 'UNKNOWN',
    provenance_evidence_source = 'UNPROVEN: Unverified starting capital integer without primary bank/wire receipt',
    provenance_notes = 'Awaiting administrative verification of primary external cash funding wire'
WHERE capital_origin_type IS NULL OR capital_origin_type = 'UNKNOWN';

-- 2. Certified Primary-Source External Cash Accounts (Explicit Wire Evidence)
UPDATE investor_accounts
SET initial_cash_contribution = 300000.00,
    capital_origin_type = 'EXTERNAL_CASH',
    provenance_evidence_source = 'docs/JERRY_FINAL_LIVE_PROVENANCE_SQL.md (Certified $300k Wire on 2026-02-05)',
    provenance_notes = 'Jerrys Rogue Jets certified initial cash wire'
WHERE id = 'jerrys';

UPDATE investor_accounts
SET initial_cash_contribution = 1022877.59,
    capital_origin_type = 'EXTERNAL_CASH',
    provenance_evidence_source = 'docs/MARY_JO_TIER4_CORRECTION_SQL.md (Certified $1.02M Onboarding Wire)',
    provenance_notes = 'Mary Jo Harris certified initial cash wire'
WHERE id = 'mharris';

UPDATE investor_accounts
SET initial_cash_contribution = 45486.72,
    capital_origin_type = 'EXTERNAL_CASH',
    provenance_evidence_source = 'docs/JEANNINE_ATOMIC_CORRECTION_DESIGN.md (Certified $45.4k Onboarding Wire)',
    provenance_notes = 'Jeannine Shaffar certified initial cash wire'
WHERE id = 'jshaffar';

UPDATE investor_accounts
SET initial_cash_contribution = 50000.00,
    capital_origin_type = 'EXTERNAL_CASH',
    provenance_evidence_source = 'docs/JOSH_CORRECTIONS_EXECUTION_MANIFEST.md (Cell T336 / dep_ca11829d)',
    provenance_notes = 'Kelci Ray certified $50,000 cash deposit'
WHERE id = 'kray';

-- 3. Certified Cutover Baselines (Portfolio Reset - Not Fresh External Cash)
UPDATE investor_accounts
SET initial_cash_contribution = 0.00,
    capital_origin_type = 'CUTOVER_BASELINE',
    provenance_evidence_source = 'docs/JEFF_BENNION_CUTOVER_CERTIFICATION.md (Aug 1 Baseline $2,673,903.44)',
    provenance_notes = 'Portfolio operating baseline reset authorized by fund leadership; not fresh external cash wire'
WHERE id = 'jbennion';

UPDATE investor_accounts
SET initial_cash_contribution = 0.00,
    capital_origin_type = 'CUTOVER_BASELINE',
    provenance_evidence_source = 'docs/TED_BOARDWALK_JULY_CUTOVER_CORRECTION_SQL.md (July 1 Baseline $17.19)',
    provenance_notes = 'Migration clean baseline reset; not fresh external cash wire'
WHERE id = 'tboardwalk';

UPDATE investor_accounts
SET initial_cash_contribution = 0.00,
    capital_origin_type = 'CUTOVER_BASELINE',
    provenance_evidence_source = 'docs/MICHAEL_LANDON_AND_TED_BOARDWALK_PREFLIGHT_CAS.sql (July 1 Baseline $10,872.81)',
    provenance_notes = 'July 1 operating baseline; not fresh external cash wire'
WHERE id = 'mlandon';

UPDATE investor_accounts
SET initial_cash_contribution = 0.00,
    capital_origin_type = 'CUTOVER_BASELINE',
    provenance_evidence_source = 'docs/MICHAEL_BECK_CORRECTION_CERTIFICATION.md (July 1 Baseline $557,693.10)',
    provenance_notes = 'Operating equity baseline for referral commission calculation; not fresh external cash wire'
WHERE id = 'mbeck';

UPDATE investor_accounts
SET initial_cash_contribution = 0.00,
    capital_origin_type = 'CUTOVER_BASELINE',
    provenance_evidence_source = 'docs/AUGUST_2026_CUTOVER_RECONCILIATION.md (Baseline $193,430.20)',
    provenance_notes = 'Gary Malazian operating baseline; $99,975 deposit recorded separately in deposits table'
WHERE id = 'gmalazian';

UPDATE investor_accounts
SET initial_cash_contribution = 0.00,
    capital_origin_type = 'CUTOVER_BASELINE',
    provenance_evidence_source = 'docs/GARY_LARSON_TIER3_CORRECTION_SQL.md (Aug 1 Baseline $487,000.00)',
    provenance_notes = 'Gary Larson Aug 1 operating baseline; pending primary wire receipt confirmation'
WHERE id = 'glarson';
