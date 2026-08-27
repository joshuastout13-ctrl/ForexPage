-- ==============================================================================
-- TED BOARDWALK COMMISSION AUDIT (MONTHS 6, 7, 8)
-- ==============================================================================
SELECT 
  c.id AS commission_id,
  r.portal_username AS recipient,
  s.portal_username AS source,
  c.year,
  c.month_number,
  c.amount
FROM commission_earnings c
JOIN investors r ON r.id = c.recipient_id
LEFT JOIN investors s ON s.id = c.source_investor_id
WHERE r.portal_username = 'tboardwalk'
  AND c.year = 2026 AND c.month_number IN (6, 7, 8)
ORDER BY c.month_number, c.amount DESC;
