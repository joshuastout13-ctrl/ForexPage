# Jerry's Rogue Jets — Open Date Metadata Correction SQL Package

**Target Production Database:** `julhldzkiqdeuuoqmvlo` (Supabase Production — Stone Forex)  
**Target Investor:** `jerrys001` (`jerrys`)  
**Target Account:** `jerrys001`  
**Classification:** `OPEN_DATE_METADATA_ERROR_ONLY`  
**Proposed Mutation:** Align `investor_accounts.open_date` from `'2026-03-01'` to `'2026-05-01'` (1 row update)  
**Financial Delta:** `$0.00` (Zero balance, history, deposit, withdrawal, or commission mutation)  
**Status:** **`DESIGN_ONLY / AWAITING_EXPLICIT_EXECUTION_AUTHORIZATION`**

---

## 1. Dependency & Impact Audit

1. **Package B Withdrawal Concurrency Controls:**  
   Resolves the metadata conflict (`ACCOUNT_START_DATE_CONFLICT: Account open period (2026-3) conflicts with investor start period (2026-5)`) and unlocks prospective withdrawal evaluation (`calculate_available_withdrawal_equity_sql`) for August 1, 2026.
2. **May–July Financial History:**  
   Zero impact. May ($514,124.14 opening $\to$ $523,478.47 ending), June ($523,478.47 opening $\to$ $536,926.63 ending), and July ($536,926.63 opening $\to$ $546,135.92 ending) calculations remain 100% cent-exact and intact.
3. **March–April Historical Rows:**  
   March and April materialized rows remain in place as `PREOPENING_MATERIALIZED_HISTORY_INERT` ($0 investor gain, static balance).
4. **Referral Commissions & Deposits:**  
   Zero impact. Jerry has zero recipient commission earnings and zero deposits in 2026.

---

## Section A: Preflight Inspection Query (Read-Only)

Run this in the Supabase SQL Editor before execution to inspect the current state:

```sql
-- Preflight: Current Jerry State
SELECT 
  i.id AS investor_id,
  i.portal_username,
  i.start_date AS investor_start_date,
  i.split_pct AS investor_split_pct,
  a.id AS account_id,
  a.open_date AS account_open_date,
  a.starting_capital,
  a.status AS account_status
FROM investors i
JOIN investor_accounts a ON a.investor_id = i.id OR a.id = i.id
WHERE i.id = 'jerrys001';
```

---

## Section B: Guarded Forward CAS Transaction Script

> [!IMPORTANT]
> **DO NOT EXECUTE UNTIL EXPLICITLY AUTHORIZED BY USER.**  
> Contains strict Compare-And-Swap (CAS) guardrails. Any unexpected condition will immediately abort the transaction.

```sql
DO $$
DECLARE
  v_inv_record      RECORD;
  v_acc_record      RECORD;
  v_mar_hist        RECORD;
  v_apr_hist        RECORD;
  v_may_hist        RECORD;
  v_mar_apr_deps    INTEGER;
  v_mar_apr_wds     INTEGER;
  v_mar_apr_comms   INTEGER;
  v_rows_updated    INTEGER;
BEGIN
  -- 1. ACQUIRE EXCLUSIVE ROW LOCKS
  SELECT * INTO v_inv_record
  FROM investors
  WHERE id = 'jerrys001'
  FOR UPDATE;

  IF v_inv_record.id IS NULL THEN
    RAISE EXCEPTION 'CAS_FAILURE: Investor jerrys001 not found.';
  END IF;

  SELECT * INTO v_acc_record
  FROM investor_accounts
  WHERE id = 'jerrys001' AND investor_id = 'jerrys001'
  FOR UPDATE;

  IF v_acc_record.id IS NULL THEN
    RAISE EXCEPTION 'CAS_FAILURE: Account jerrys001 not found.';
  END IF;

  -- 2. ASSERT INVESTOR & ACCOUNT BASELINE (CAS)
  IF v_inv_record.portal_username IS DISTINCT FROM 'jerrys' THEN
    RAISE EXCEPTION 'CAS_FAILURE: portal_username is % (expected jerrys)', v_inv_record.portal_username;
  END IF;

  IF v_inv_record.start_date IS DISTINCT FROM DATE '2026-05-01' THEN
    RAISE EXCEPTION 'CAS_FAILURE: investor start_date is % (expected 2026-05-01)', v_inv_record.start_date;
  END IF;

  IF v_inv_record.split_pct IS DISTINCT FROM 70.00 THEN
    RAISE EXCEPTION 'CAS_FAILURE: investor split_pct is % (expected 70.00)', v_inv_record.split_pct;
  END IF;

  IF v_acc_record.open_date IS DISTINCT FROM DATE '2026-03-01' THEN
    RAISE EXCEPTION 'CAS_FAILURE: account open_date is % (expected 2026-03-01)', v_acc_record.open_date;
  END IF;

  IF v_acc_record.starting_capital IS DISTINCT FROM 514124.14 THEN
    RAISE EXCEPTION 'CAS_FAILURE: starting_capital is % (expected 514124.14)', v_acc_record.starting_capital;
  END IF;

  IF v_acc_record.status IS DISTINCT FROM 'Active' THEN
    RAISE EXCEPTION 'CAS_FAILURE: account status is % (expected Active)', v_acc_record.status;
  END IF;

  -- 3. ASSERT MARCH & APRIL HISTORY ROWS ARE INERT
  SELECT * INTO v_mar_hist
  FROM investor_monthly_history
  WHERE investor_id = 'jerrys001' AND year = 2026 AND month_number = 3;

  IF v_mar_hist.id IS NOT NULL THEN
    IF v_mar_hist.opening_balance IS DISTINCT FROM 514124.14 
       OR v_mar_hist.ending_balance IS DISTINCT FROM 514124.14
       OR COALESCE(v_mar_hist.deposits, 0) != 0
       OR COALESCE(v_mar_hist.withdrawals, 0) != 0 THEN
      RAISE EXCEPTION 'CAS_FAILURE: March 2026 history row is not inert (% -> %)', 
        v_mar_hist.opening_balance, v_mar_hist.ending_balance;
    END IF;
  END IF;

  SELECT * INTO v_apr_hist
  FROM investor_monthly_history
  WHERE investor_id = 'jerrys001' AND year = 2026 AND month_number = 4;

  IF v_apr_hist.id IS NOT NULL THEN
    IF v_apr_hist.opening_balance IS DISTINCT FROM 514124.14 
       OR v_apr_hist.ending_balance IS DISTINCT FROM 514124.14
       OR COALESCE(v_apr_hist.deposits, 0) != 0
       OR COALESCE(v_apr_hist.withdrawals, 0) != 0 THEN
      RAISE EXCEPTION 'CAS_FAILURE: April 2026 history row is not inert (% -> %)', 
        v_apr_hist.opening_balance, v_apr_hist.ending_balance;
    END IF;
  END IF;

  -- 4. ASSERT MAY ECONOMIC HISTORY ROW EXISTS
  SELECT * INTO v_may_hist
  FROM investor_monthly_history
  WHERE investor_id = 'jerrys001' AND year = 2026 AND month_number = 5;

  IF v_may_hist.id IS NULL THEN
    RAISE EXCEPTION 'CAS_FAILURE: May 2026 history row missing for jerrys001.';
  END IF;

  IF v_may_hist.opening_balance IS DISTINCT FROM 514124.14 
     OR v_may_hist.withdrawals IS DISTINCT FROM 2500.00 THEN
    RAISE EXCEPTION 'CAS_FAILURE: May 2026 history row unexpected (opening=%, wds=%)', 
      v_may_hist.opening_balance, v_may_hist.withdrawals;
  END IF;

  -- 5. ASSERT NO UNEXPECTED TRANSACTIONS IN MARCH/APRIL
  SELECT COUNT(*) INTO v_mar_apr_deps
  FROM deposits
  WHERE investor_id = 'jerrys001' 
    AND (
      (date >= '2026-03-01' AND date < '2026-05-01')
      OR (effective_accounting_date >= '2026-03-01' AND effective_accounting_date < '2026-05-01')
    );

  IF v_mar_apr_deps > 0 THEN
    RAISE EXCEPTION 'CAS_FAILURE: Found % unexpected deposits in March/April 2026.', v_mar_apr_deps;
  END IF;

  SELECT COUNT(*) INTO v_mar_apr_wds
  FROM withdrawals
  WHERE investor_id = 'jerrys001' 
    AND (
      (year = 2026 AND month_number IN (3, 4))
      OR (request_date >= '2026-03-01' AND request_date < '2026-05-01')
      OR (effective_accounting_date >= '2026-03-01' AND effective_accounting_date < '2026-05-01')
    );

  IF v_mar_apr_wds > 0 THEN
    RAISE EXCEPTION 'CAS_FAILURE: Found % unexpected withdrawals in March/April 2026.', v_mar_apr_wds;
  END IF;

  SELECT COUNT(*) INTO v_mar_apr_comms
  FROM commission_earnings
  WHERE recipient_id = 'jerrys001' AND year = 2026 AND month_number IN (3, 4);

  IF v_mar_apr_comms > 0 THEN
    RAISE EXCEPTION 'CAS_FAILURE: Found % unexpected commissions in March/April 2026.', v_mar_apr_comms;
  END IF;

  -- 6. EXECUTE EXACT SINGLE-ROW UPDATE
  UPDATE investor_accounts
  SET 
    open_date = DATE '2026-05-01',
    updated_at = NOW()
  WHERE id = 'jerrys001' 
    AND investor_id = 'jerrys001' 
    AND open_date = DATE '2026-03-01';

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

  IF v_rows_updated != 1 THEN
    RAISE EXCEPTION 'CAS_FAILURE: Expected exactly 1 row updated, got %', v_rows_updated;
  END IF;

  -- 7. POST-MUTATION ASSERTION
  SELECT * INTO v_acc_record
  FROM investor_accounts
  WHERE id = 'jerrys001' AND investor_id = 'jerrys001';

  IF v_acc_record.open_date IS DISTINCT FROM DATE '2026-05-01' THEN
    RAISE EXCEPTION 'POSTCHECK_FAILURE: open_date is % (expected 2026-05-01)', v_acc_record.open_date;
  END IF;

  RAISE NOTICE 'SUCCESS: Jerry open_date successfully updated from 2026-03-01 to 2026-05-01.';
END $$;
```

---

## Section C: Guarded Rollback Script

If rollback is ever required, execute this guarded script:

```sql
DO $$
DECLARE
  v_rows_updated INTEGER;
  v_acc_record   RECORD;
BEGIN
  -- 1. Lock account row
  SELECT * INTO v_acc_record
  FROM investor_accounts
  WHERE id = 'jerrys001' AND investor_id = 'jerrys001'
  FOR UPDATE;

  IF v_acc_record.id IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK_FAILURE: Account jerrys001 not found.';
  END IF;

  -- 2. CAS Assertions for Rollback
  IF v_acc_record.open_date IS DISTINCT FROM DATE '2026-05-01' THEN
    RAISE EXCEPTION 'ROLLBACK_FAILURE: Current open_date is % (expected 2026-05-01)', v_acc_record.open_date;
  END IF;

  IF v_acc_record.starting_capital IS DISTINCT FROM 514124.14 THEN
    RAISE EXCEPTION 'ROLLBACK_FAILURE: starting_capital has changed: %', v_acc_record.starting_capital;
  END IF;

  -- 3. Execute Guarded Rollback Update
  UPDATE investor_accounts
  SET 
    open_date = DATE '2026-03-01',
    updated_at = NOW()
  WHERE id = 'jerrys001' 
    AND investor_id = 'jerrys001' 
    AND open_date = DATE '2026-05-01';

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

  IF v_rows_updated != 1 THEN
    RAISE EXCEPTION 'ROLLBACK_FAILURE: Expected exactly 1 row updated, got %', v_rows_updated;
  END IF;

  RAISE NOTICE 'SUCCESS: Jerry open_date rolled back from 2026-05-01 to 2026-03-01.';
END $$;
```

---

## Section D: Post-Execution Verification Queries (Read-Only)

Run these queries after execution to verify state and evaluate Package B equity:

```sql
-- 1. Verify Jerry Account & Investor State
SELECT 
  i.id AS investor_id,
  i.portal_username,
  i.start_date AS investor_start_date,
  i.split_pct AS investor_split_pct,
  a.id AS account_id,
  a.open_date AS account_open_date,
  a.starting_capital,
  a.status AS account_status
FROM investors i
JOIN investor_accounts a ON a.investor_id = i.id OR a.id = i.id
WHERE i.id = 'jerrys001';

-- 2. Verify History Rows Remain Untouched
SELECT 
  year,
  month_number,
  month,
  opening_balance,
  deposits,
  withdrawals,
  gross_return_pct,
  ending_balance
FROM investor_monthly_history
WHERE investor_id = 'jerrys001' AND year = 2026
ORDER BY month_number ASC;

-- 3. Live Package B Equity Calculation (Must NOT throw ACCOUNT_START_DATE_CONFLICT)
-- Evaluates available equity for August 1, 2026 based on July ending balance ($546,135.92)
SELECT 
  'jerrys001' AS investor_id,
  '2026-08-01'::DATE AS evaluation_date,
  calculate_available_withdrawal_equity_sql(
    'jerrys001',
    'jerrys001',
    '2026-08-01'::DATE,
    NULL
  ) AS calculated_available_equity;
```
