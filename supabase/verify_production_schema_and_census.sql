-- ==============================================================================
-- 4XTRACK PRODUCTION DEPOSITS VERIFICATION & READ-ONLY CENSUS
-- Project: julhldzkiqdeuuoqmvlo (Stone - Forex)
-- Mode: STRICTLY READ-ONLY (SELECT only, 0 mutations)
-- ==============================================================================

-- 1. COLUMN INVENTORY
SELECT 
    column_name, 
    data_type, 
    is_nullable, 
    column_default
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'deposits'
ORDER BY ordinal_position;

-- 2. CONSTRAINTS & CHECK CLAUSES
SELECT
    tc.constraint_name, 
    tc.constraint_type,
    cc.check_clause
FROM information_schema.table_constraints tc
LEFT JOIN information_schema.check_constraints cc 
    ON tc.constraint_name = cc.constraint_name
WHERE tc.table_schema = 'public' 
  AND tc.table_name = 'deposits'
ORDER BY tc.constraint_type, tc.constraint_name;

-- 3. INDEXES
SELECT
    indexname,
    indexdef
FROM pg_indexes
WHERE schemaname = 'public' 
  AND tablename = 'deposits'
ORDER BY indexname;

-- 4. AGGREGATE DEPOSIT CENSUS BY STATUS & TREATMENT
SELECT 
    COALESCE(accounting_treatment, '<NULL>') AS accounting_treatment,
    COALESCE(status, '<NULL>') AS status,
    COALESCE(type, '<NULL>') AS legacy_type,
    COUNT(*) AS row_count,
    SUM(amount) AS total_amount
FROM deposits
GROUP BY accounting_treatment, status, type
ORDER BY accounting_treatment, status, type;

-- 5. IDEMPOTENCY KEY NULL CENSUS
SELECT 
    COUNT(*) AS total_rows,
    COUNT(idempotency_key) AS non_null_keys,
    COUNT(*) - COUNT(idempotency_key) AS null_keys
FROM deposits;

-- 6. INDIVIDUAL ROW INVENTORY (EVERY DEPOSIT IN PRODUCTION)
SELECT 
    d.id,
    d.investor_id,
    i.portal_username,
    COALESCE(i.first_name || ' ' || i.last_name, i.name, 'Unknown') AS investor_name,
    d.account_id,
    d.amount,
    d.date AS funding_date,
    d.effective_accounting_date,
    d.type AS legacy_type,
    d.status,
    d.accounting_treatment,
    d.idempotency_key,
    d.created_by,
    d.notes,
    d.created_at
FROM deposits d
LEFT JOIN investors i ON i.id = d.investor_id
ORDER BY COALESCE(d.effective_accounting_date, d.date), d.created_at;
