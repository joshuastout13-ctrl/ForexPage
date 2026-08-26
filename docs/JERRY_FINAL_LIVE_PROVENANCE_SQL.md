# Jerry's Rogue Jets — Final Live Production Provenance SQL Package

**Target Database:** `julhldzkiqdeuuoqmvlo` (Supabase Production — Stone Forex)  
**Target Investor:** `jerrys001` (`jerrys`)  
**Mode:** STRICTLY READ-ONLY (SELECT queries only, 0 mutations)  
**Purpose:** Verify live identity metadata, March–May historical economic participation, transaction history, Package B conflict behavior, and August duplicate status.

---

## 1. Identity & Account Metadata

```sql
-- 1. Identity and Profile Metadata
SELECT 
  i.id AS investor_id,
  i.portal_username,
  i.start_date AS investor_start_date,
  i.split_pct AS investor_split_pct,
  i.status AS investor_status,
  a.id AS account_id,
  a.open_date AS account_open_date,
  a.starting_capital,
  a.split_pct AS account_split_pct,
  a.status AS account_status
FROM investors i
LEFT JOIN investor_accounts a ON a.investor_id = i.id OR a.id = i.portal_username
WHERE i.id = 'jerrys001' OR i.portal_username = 'jerrys';
```

---

## 2. March through May 2026 Historical Ledger Audit

```sql
-- 2. Monthly History for March (3), April (4), and May (5) 2026
SELECT 
  year,
  month_number,
  month,
  opening_balance,
  deposits,
  withdrawals,
  gross_return_pct,
  ending_balance,
  is_manual,
  notes,
  updated_at
FROM investor_monthly_history
WHERE (investor_id = 'jerrys001' OR investor_id = 'jerrys')
  AND year = 2026
  AND month_number IN (3, 4, 5)
ORDER BY month_number ASC;
```

---

## 3. March through May 2026 Transaction Census

```sql
-- 3A. Deposits in March–May 2026
SELECT 
  id,
  investor_id,
  account_id,
  amount,
  date,
  effective_accounting_date,
  type,
  notes
FROM deposits
WHERE (investor_id = 'jerrys001' OR investor_id = 'jerrys')
  AND (
    (date >= '2026-03-01' AND date < '2026-06-01')
    OR (effective_accounting_date >= '2026-03-01' AND effective_accounting_date < '2026-06-01')
  )
ORDER BY COALESCE(effective_accounting_date, date) ASC;

-- 3B. Withdrawals in March–May 2026
SELECT 
  id,
  investor_id,
  account_id,
  amount,
  status,
  request_date,
  effective_accounting_date,
  year,
  month_number,
  idempotency_key,
  notes
FROM withdrawals
WHERE (investor_id = 'jerrys001' OR investor_id = 'jerrys')
  AND (
    (year = 2026 AND month_number IN (3, 4, 5))
    OR (request_date >= '2026-03-01' AND request_date < '2026-06-01')
    OR (effective_accounting_date >= '2026-03-01' AND effective_accounting_date < '2026-06-01')
  )
ORDER BY COALESCE(effective_accounting_date, request_date) ASC;

-- 3C. Commission Earnings in March–May 2026
SELECT 
  id,
  recipient_id,
  source_investor_id,
  year,
  month_number,
  amount,
  rate_pct
FROM commission_earnings
WHERE recipient_id = 'jerrys001' OR recipient_id = 'jerrys'
ORDER BY year ASC, month_number ASC;
```

---

## 4. Live Package B Equity Calculation (Read-Only Evaluation)

```sql
-- 4. Execute calculate_available_withdrawal_equity_sql for Jerry at 2026-08-01
SELECT 
  'jerrys001' AS target_investor_id,
  'jerrys001' AS target_account_id,
  '2026-08-01'::DATE AS evaluation_effective_date,
  calculate_available_withdrawal_equity_sql(
    'jerrys001',
    'jerrys001',
    '2026-08-01'::DATE,
    NULL
  ) AS calculated_available_equity;
```

---

## 5. August 2026 History & Duplicate Census

```sql
-- 5A. Current August 2026 History Row State
SELECT 
  year,
  month_number,
  month,
  opening_balance,
  deposits,
  withdrawals,
  gross_return_pct,
  ending_balance,
  is_manual,
  notes,
  updated_at
FROM investor_monthly_history
WHERE (investor_id = 'jerrys001' OR investor_id = 'jerrys')
  AND year = 2026
  AND month_number = 8;

-- 5B. August 2026 $2,500 Duplicate Census
SELECT 
  id,
  investor_id,
  account_id,
  amount,
  status,
  request_date,
  effective_accounting_date,
  year,
  month_number,
  notes
FROM withdrawals
WHERE (investor_id = 'jerrys001' OR investor_id = 'jerrys')
  AND (
    (year = 2026 AND month_number = 8)
    OR (effective_accounting_date >= '2026-08-01' AND effective_accounting_date < '2026-09-01')
    OR (request_date >= '2026-08-01' AND request_date < '2026-09-01')
  );
```
