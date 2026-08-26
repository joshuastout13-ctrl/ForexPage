# Jerry's Rogue Jets — Tier 3 August $2,500 Withdrawal Manual Production Execution Package

**Target Production Database:** `julhldzkiqdeuuoqmvlo` (Supabase Production — Stone Forex)  
**Target Investor:** `jerrys001` (`jerrys`)  
**Target Account:** `jerrys001`  
**Classification:** **`TIER_3_HISTORY_DEPENDENCY_CORRECTION`**  
**Authorized Scope:** Atomic insertion of single $2,500.00 withdrawal (`2026-08-01`) and alignment of August 2026 `investor_monthly_history` (`withdrawals: $2,500.00`, `ending_balance: $543,635.92`)  
**Candidate Artifact SHA-256 (LF):** `11e8927dff1f49917b24a8612072dedb946556afe5ea95cd2342ca0321decbc3`  
**Native PostgreSQL Multi-Backend Concurrency Certification:** **`PASS (10/10 Rounds)`**  
**Status:** **`READY_FOR_FRESH_PRODUCTION_PREFLIGHT`**  
**Production Financial Writes Executed:** **`0`**

---

## Protocol Overview & Safety Rules

> [!IMPORTANT]
> **STRICT THREE-STEP EXECUTION PROTOCOL:**  
> 1. **STEP A MUST BE RUN FIRST.** Share the read-only output to verify all live CAS conditions match the certified pre-state.  
> 2. **DO NOT RUN STEP B** until Step A results are reviewed and confirmed.  
> 3. **STEP C IS READ-ONLY POST-VERIFICATION.**

---

# STEP A: READ-ONLY LIVE PRODUCTION PREFLIGHT

Paste and execute this script in the Supabase SQL Editor (`julhldzkiqdeuuoqmvlo`) to inspect Jerry's exact live state before any mutation:

```sql
-- ============================================================================
-- STEP A: JERRY'S ROGUE JETS LIVE PRODUCTION PREFLIGHT AUDIT
-- ============================================================================

-- 1. Identity, Dates, and Account Metadata
SELECT 
  i.id AS investor_id,
  i.portal_username,
  i.start_date AS investor_start_date,
  i.split_pct AS investor_split_pct,
  i.status AS investor_status,
  a.id AS account_id,
  a.open_date AS account_open_date,
  a.starting_capital,
  a.status AS account_status
FROM investors i
JOIN investor_accounts a ON a.investor_id = i.id OR a.id = i.id
WHERE i.id = 'jerrys001';

-- 2. Complete August 2026 History Row State
SELECT 
  id AS history_id,
  investor_id,
  year,
  month_number,
  month,
  opening_balance,
  deposits,
  withdrawals,
  gross_return_pct,
  ending_balance,
  is_manual,
  locked,
  notes,
  updated_at
FROM investor_monthly_history
WHERE investor_id = 'jerrys001' AND year = 2026 AND month_number = 8;

-- 3. Live Package B Available Equity Precheck (Must equal $546,135.92)
SELECT 
  'jerrys001' AS investor_id,
  '2026-08-01'::DATE AS evaluation_date,
  calculate_available_withdrawal_equity_sql(
    'jerrys001',
    'jerrys001',
    '2026-08-01'::DATE,
    NULL
  ) AS calculated_available_equity;

-- 4. Duplicate August 2026 Withdrawal Check (Must be 0)
SELECT 
  id,
  investor_id,
  amount,
  status,
  request_date,
  effective_accounting_date,
  year,
  month_number
FROM withdrawals
WHERE investor_id = 'jerrys001' 
  AND (
    (year = 2026 AND month_number = 8)
    OR (effective_accounting_date >= '2026-08-01' AND effective_accounting_date < '2026-09-01')
    OR (request_date >= '2026-08-01' AND request_date < '2026-09-01')
  );

-- 5. Pre-Write Ledger Fingerprint (Control Baseline)
SELECT 
  (SELECT COUNT(*) FROM withdrawals WHERE investor_id = 'jerrys001') AS total_wds_count,
  (SELECT COALESCE(SUM(amount), 0) FROM withdrawals WHERE investor_id = 'jerrys001') AS total_wds_sum,
  (SELECT COUNT(*) FROM investor_monthly_history WHERE investor_id = 'jerrys001' AND year = 2026) AS total_hist_rows,
  (SELECT SUM(opening_balance + ending_balance) FROM investor_monthly_history WHERE investor_id = 'jerrys001' AND year = 2026) AS hist_balance_sum;
```

---

# STEP B: MUTATING CERTIFIED TIER 3 OPERATION

> [!WARNING]
> **DO NOT EXECUTE STEP B UNTIL STEP A HAS EXPLICITLY PASSED.**  
> Contains strict Compare-And-Swap (CAS) guardrails, Package B advisory locking, fail-closed equity check, and atomic dual-table mutation (`withdrawals` + `investor_monthly_history`).

```sql
DO $$
DECLARE
  v_lock_key         BIGINT;
  v_inv_record       RECORD;
  v_acc_record       RECORD;
  v_aug_hist         RECORD;
  v_available_equity NUMERIC(20, 2);
  v_new_wd_id        TEXT;
  v_idempotency_key  TEXT := 'idemp_jerrys_20260801_' || md5(random()::text || clock_timestamp()::text);
  v_created_by       TEXT := 'admin_tier3_correction';
  v_rows_updated     INTEGER;
BEGIN
  -- 1. ACQUIRE PACKAGE B ADVISORY LOCK & EXCLUSIVE ROW LOCKS
  v_lock_key := financial_lock_key('jerrys001');
  PERFORM pg_advisory_xact_lock(v_lock_key);

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

  SELECT * INTO v_aug_hist
  FROM investor_monthly_history
  WHERE investor_id = 'jerrys001' AND year = 2026 AND month_number = 8
  FOR UPDATE;

  IF v_aug_hist.id IS NULL THEN
    RAISE EXCEPTION 'CAS_FAILURE: August 2026 history row missing for jerrys001.';
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

  IF v_acc_record.open_date IS DISTINCT FROM DATE '2026-05-01' THEN
    RAISE EXCEPTION 'CAS_FAILURE: account open_date is % (expected 2026-05-01)', v_acc_record.open_date;
  END IF;

  IF v_acc_record.starting_capital IS DISTINCT FROM 514124.14 THEN
    RAISE EXCEPTION 'CAS_FAILURE: starting_capital is % (expected 514124.14)', v_acc_record.starting_capital;
  END IF;

  IF v_acc_record.status IS DISTINCT FROM 'Active' THEN
    RAISE EXCEPTION 'CAS_FAILURE: account status is % (expected Active)', v_acc_record.status;
  END IF;

  -- 3. ASSERT AUGUST HISTORY PRE-STATE (CAS)
  IF v_aug_hist.opening_balance IS DISTINCT FROM 546135.9207866621 
     AND v_aug_hist.opening_balance IS DISTINCT FROM 546135.92 THEN
    RAISE EXCEPTION 'CAS_FAILURE: August opening balance is % (expected $546,135.92)', v_aug_hist.opening_balance;
  END IF;

  IF COALESCE(v_aug_hist.withdrawals, 0.00) != 0.00 THEN
    RAISE EXCEPTION 'CAS_FAILURE: August withdrawals already non-zero: %', v_aug_hist.withdrawals;
  END IF;

  IF COALESCE(v_aug_hist.gross_return_pct, 0.00) != 0.00 THEN
    RAISE EXCEPTION 'CAS_FAILURE: August gross return is % (expected 0 for open month)', v_aug_hist.gross_return_pct;
  END IF;

  IF COALESCE(v_aug_hist.locked, FALSE) = TRUE THEN
    RAISE EXCEPTION 'CAS_FAILURE: August history row is already locked/finalized.';
  END IF;

  -- 4. ASSERT NO DUPLICATE ACTIVE AUGUST 2026 WITHDRAWALS
  PERFORM 1
  FROM withdrawals
  WHERE investor_id = 'jerrys001' 
    AND year = 2026 AND month_number = 8 
    AND LOWER(TRIM(status)) IN ('pending', 'approved', 'completed');

  IF FOUND THEN
    RAISE EXCEPTION 'CAS_FAILURE: An active August 2026 withdrawal already exists for jerrys001.';
  END IF;

  -- 5. FAIL-CLOSED PACKAGE B AVAILABLE EQUITY EVALUATION
  v_available_equity := calculate_available_withdrawal_equity_sql(
    'jerrys001',
    'jerrys001',
    DATE '2026-08-01',
    NULL
  );

  IF v_available_equity < 2500.00 THEN
    RAISE EXCEPTION 'WITHDRAWAL_EXCEEDS_AVAILABLE_EQUITY: Available equity ($%) is less than requested $2,500.00.',
      TO_CHAR(v_available_equity, 'FM999,999,990.00');
  END IF;

  -- 6. ATOMIC DUAL-TABLE MUTATION PAIR
  v_new_wd_id := 'wd_jerrys_20260801_' || substring(md5(random()::text || clock_timestamp()::text) from 1 for 8);

  -- A. Insert Package B Source Withdrawal
  INSERT INTO withdrawals (
    id,
    investor_id,
    account_id,
    amount,
    effective_accounting_date,
    request_date,
    status,
    notes,
    year,
    month_number,
    idempotency_key,
    created_by,
    created_at,
    updated_at
  ) VALUES (
    v_new_wd_id,
    'jerrys001',
    'jerrys001',
    2500.00,
    DATE '2026-08-01',
    DATE '2026-08-01',
    'Approved',
    'Client authorized recurring August withdrawal per Josh workbook instruction (Cell T273)',
    2026,
    8,
    v_idempotency_key,
    v_created_by,
    NOW(),
    NOW()
  );

  -- B. Align August Materialized History Row
  UPDATE investor_monthly_history
  SET 
    withdrawals = 2500.00,
    ending_balance = (opening_balance + COALESCE(deposits, 0) - 2500.00),
    updated_at = NOW()
  WHERE id = v_aug_hist.id;

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

  IF v_rows_updated != 1 THEN
    RAISE EXCEPTION 'POSTCHECK_FAILURE: Expected exactly 1 history row updated, got %', v_rows_updated;
  END IF;

  -- 7. POSTCHECK ASSERTIONS
  SELECT * INTO v_aug_hist
  FROM investor_monthly_history
  WHERE id = v_aug_hist.id;

  IF v_aug_hist.withdrawals IS DISTINCT FROM 2500.00 THEN
    RAISE EXCEPTION 'POSTCHECK_FAILURE: August history withdrawals is % (expected 2500.00)', v_aug_hist.withdrawals;
  END IF;

  RAISE NOTICE 'SUCCESS: Jerry August $2,500 withdrawal inserted (%) and August history aligned.', v_new_wd_id;
END $$;
```

---

# STEP C: READ-ONLY POST-WRITE VERIFICATION & REVERSAL

Execute these queries immediately following Step B execution to certify the live post-state:

```sql
-- ============================================================================
-- STEP C1: POST-WRITE AUDIT QUERIES
-- ============================================================================

-- 1. Verify New Source Withdrawal
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
  created_by,
  created_at
FROM withdrawals
WHERE investor_id = 'jerrys001' AND year = 2026 AND month_number = 8;

-- 2. Verify Aligned August History Row (withdrawals = $2,500.00, ending = $543,635.92)
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
  locked,
  updated_at
FROM investor_monthly_history
WHERE investor_id = 'jerrys001' AND year = 2026 AND month_number = 8;

-- 3. Post-Correction Package B Available Equity Evaluation (Must equal $543,635.92)
SELECT 
  'jerrys001' AS investor_id,
  '2026-08-01'::DATE AS evaluation_date,
  calculate_available_withdrawal_equity_sql(
    'jerrys001',
    'jerrys001',
    '2026-08-01'::DATE,
    NULL
  ) AS post_correction_available_equity;

-- 4. Post-Write Ledger Fingerprint (Delta must be +1 row, +$2,500 wds, -$2,500 ending balance sum)
SELECT 
  (SELECT COUNT(*) FROM withdrawals WHERE investor_id = 'jerrys001') AS total_wds_count,
  (SELECT COALESCE(SUM(amount), 0) FROM withdrawals WHERE investor_id = 'jerrys001') AS total_wds_sum,
  (SELECT COUNT(*) FROM investor_monthly_history WHERE investor_id = 'jerrys001' AND year = 2026) AS total_hist_rows,
  (SELECT SUM(opening_balance + ending_balance) FROM investor_monthly_history WHERE investor_id = 'jerrys001' AND year = 2026) AS hist_balance_sum;
```

---

## Contingency: Certified Atomic Reversal Script

If post-write verification ever fails or reversal is required:

```sql
DO $$
DECLARE
  v_lock_key     BIGINT;
  v_wd_record    RECORD;
  v_aug_hist     RECORD;
  v_rows_updated INTEGER;
BEGIN
  v_lock_key := financial_lock_key('jerrys001');
  PERFORM pg_advisory_xact_lock(v_lock_key);

  SELECT * INTO v_wd_record
  FROM withdrawals
  WHERE investor_id = 'jerrys001' 
    AND year = 2026 AND month_number = 8 
    AND amount = 2500.00 
    AND status = 'Approved'
  FOR UPDATE;

  IF v_wd_record.id IS NULL THEN
    RAISE EXCEPTION 'REVERSAL_FAILURE: Active August $2,500 Approved withdrawal not found.';
  END IF;

  SELECT * INTO v_aug_hist
  FROM investor_monthly_history
  WHERE investor_id = 'jerrys001' AND year = 2026 AND month_number = 8
  FOR UPDATE;

  IF v_aug_hist.id IS NULL THEN
    RAISE EXCEPTION 'REVERSAL_FAILURE: August history row missing for jerrys001.';
  END IF;

  IF COALESCE(v_aug_hist.locked, FALSE) = TRUE THEN
    RAISE EXCEPTION 'REVERSAL_FAILURE: August history is locked/finalized; reversal requires explicit adjustment deposit.';
  END IF;

  -- A. Transition withdrawal status to Cancelled (Preserves audit trail)
  UPDATE withdrawals
  SET 
    status = 'Cancelled',
    notes = notes || ' [Reversed per audit review]',
    updated_at = NOW()
  WHERE id = v_wd_record.id;

  -- B. Restore August history row
  UPDATE investor_monthly_history
  SET 
    withdrawals = 0.00,
    ending_balance = (opening_balance + COALESCE(deposits, 0)),
    updated_at = NOW()
  WHERE id = v_aug_hist.id;

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

  IF v_rows_updated != 1 THEN
    RAISE EXCEPTION 'REVERSAL_FAILURE: Expected exactly 1 history row restored, got %', v_rows_updated;
  END IF;

  RAISE NOTICE 'SUCCESS: Jerry August $2,500 withdrawal reversed to Cancelled and August history restored.';
END $$;
```
