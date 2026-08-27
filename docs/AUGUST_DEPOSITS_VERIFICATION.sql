-- ==============================================================================
-- AUGUST CASH DEPOSITS VERIFICATION FOR 8 ACCOUNTS
-- ==============================================================================
SELECT 
  d.id AS deposit_id,
  i.portal_username,
  d.amount,
  d.date,
  d.effective_accounting_date,
  d.type
FROM deposits d
JOIN investors i ON i.id = d.investor_id
WHERE i.portal_username IN ('valdes', 'gmalazian', 'bkimball', 'cray', 'bholly', 'thorton', 'austinray', 'bbeck')
  AND (
    (d.effective_accounting_date IS NOT NULL AND EXTRACT(YEAR FROM d.effective_accounting_date) = 2026 AND EXTRACT(MONTH FROM d.effective_accounting_date) = 8)
    OR
    (d.effective_accounting_date IS NULL AND d.date IS NOT NULL AND EXTRACT(YEAR FROM d.date) = 2026 AND EXTRACT(MONTH FROM d.date) = 8)
  )
ORDER BY i.portal_username, d.amount DESC;
