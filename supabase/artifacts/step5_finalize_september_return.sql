-- =============================================================================
-- STEP 5: FINALIZE AND LOCK SEPTEMBER 2026 RETURN AT +3.07%
-- =============================================================================
UPDATE monthly_returns
SET gross_return_pct = 3.07,
    locked = TRUE,
    source = 'Certified Final Close (Josh Stout Authorized)',
    last_updated = NOW()
WHERE year = 2026 AND month_number = 9;
