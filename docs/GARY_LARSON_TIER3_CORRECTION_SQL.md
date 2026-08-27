# Gary Larson — August 1 Start Date & $487,000 Starting Capital Tier 3 Correction SQL

**Target Database:** `julhldzkiqdeuuoqmvlo` (Supabase Production — Stone Forex)  
**Target Investor:** `inv_2093cd23` (`glarson`)  
**Target Account:** `glarson`  
**Classification:** **`TIER_3_HISTORY_DEPENDENCY_CORRECTION`**  
**Authorized Scope:** Realign start date to August 1, 2026; set starting operating capital to $487,000.00; void scheduled September deposit `dep_94a0ffe1` ($120,000.00) to prevent double-counting.

---

## 1. Step A: Read-Only Live CAS Preflight

```sql
SELECT 
  i.id AS investor_id,
  i.portal_username,
  i.start_date AS investor_start_date,
  i.split_pct AS investor_split_pct,
  a.id AS account_id,
  a.open_date AS account_open_date,
  a.starting_capital,
  a.status AS account_status,
  (SELECT type FROM deposits WHERE id = 'dep_94a0ffe1') AS dep_94a0ffe1_type,
  (SELECT amount FROM deposits WHERE id = 'dep_94a0ffe1') AS dep_94a0ffe1_amount,
  (SELECT opening_balance FROM investor_monthly_history WHERE investor_id = 'inv_2093cd23' AND year = 2026 AND month_number = 8) AS aug_opening_balance,
  (SELECT ending_balance FROM investor_monthly_history WHERE investor_id = 'inv_2093cd23' AND year = 2026 AND month_number = 8) AS aug_ending_balance
FROM investors i
JOIN investor_accounts a ON a.investor_id = i.id OR a.id = i.portal_username
WHERE i.id = 'inv_2093cd23';
```

---

## 2. Step B: Mutating Certified Tier 3 Transaction

```sql
DO $$
DECLARE
  v_lock_key         BIGINT;
  v_inv_record       RECORD;
  v_acc_record       RECORD;
  v_dep_record       RECORD;
  v_aug_hist         RECORD;
  v_rows_updated     INTEGER;
BEGIN
  -- 1. ACQUIRE ADVISORY LOCK & EXCLUSIVE ROW LOCKS
  v_lock_key := financial_lock_key('inv_2093cd23');
  PERFORM pg_advisory_xact_lock(v_lock_key);

  SELECT * INTO v_inv_record FROM investors WHERE id = 'inv_2093cd23' FOR UPDATE;
  IF v_inv_record.id IS NULL THEN
    RAISE EXCEPTION 'CAS_FAILURE: Investor inv_2093cd23 not found.';
  END IF;

  SELECT * INTO v_acc_record FROM investor_accounts WHERE id = 'glarson' OR investor_id = 'inv_2093cd23' FOR UPDATE;
  IF v_acc_record.id IS NULL THEN
    RAISE EXCEPTION 'CAS_FAILURE: Account glarson not found.';
  END IF;

  SELECT * INTO v_dep_record FROM deposits WHERE id = 'dep_94a0ffe1' FOR UPDATE;
  IF v_dep_record.id IS NULL THEN
    RAISE EXCEPTION 'CAS_FAILURE: Deposit dep_94a0ffe1 not found.';
  END IF;

  SELECT * INTO v_aug_hist FROM investor_monthly_history WHERE investor_id = 'inv_2093cd23' AND year = 2026 AND month_number = 8 FOR UPDATE;
  IF v_aug_hist.id IS NULL THEN
    RAISE EXCEPTION 'CAS_FAILURE: August 2026 history row missing.';
  END IF;

  -- 2. CAS ASSERTIONS
  IF v_acc_record.starting_capital IS DISTINCT FROM 487000.00 THEN
    RAISE EXCEPTION 'CAS_FAILURE: starting_capital is % (expected 487000.00)', v_acc_record.starting_capital;
  END IF;

  IF v_dep_record.amount IS DISTINCT FROM 120000.00 THEN
    RAISE EXCEPTION 'CAS_FAILURE: dep_94a0ffe1 amount is % (expected 120000.00)', v_dep_record.amount;
  END IF;

  IF v_dep_record.type IS DISTINCT FROM 'DEPOSIT' THEN
    RAISE EXCEPTION 'CAS_FAILURE: dep_94a0ffe1 type is % (expected DEPOSIT)', v_dep_record.type;
  END IF;

  -- 3. ENSURE METADATA ALIGNMENT
  UPDATE investors
  SET 
    start_date = DATE '2026-08-01',
    updated_at = NOW()
  WHERE id = 'inv_2093cd23' AND start_date IS DISTINCT FROM DATE '2026-08-01';

  UPDATE investor_accounts
  SET 
    open_date = DATE '2026-08-01',
    starting_capital = 487000.00,
    updated_at = NOW()
  WHERE id = v_acc_record.id AND (open_date IS DISTINCT FROM DATE '2026-08-01' OR starting_capital IS DISTINCT FROM 487000.00);

  -- 4. VOID SCHEDULED SEPTEMBER DEPOSIT dep_94a0ffe1
  UPDATE deposits
  SET 
    type = 'VOID',
    notes = 'Voided: Subsumed into $487,000.00 August 1 starting capital per Josh instruction (Cell T170)'
  WHERE id = 'dep_94a0ffe1';

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
  IF v_rows_updated != 1 THEN
    RAISE EXCEPTION 'MUTATION_FAILURE: Expected 1 deposit voided, got %', v_rows_updated;
  END IF;

  -- 5. ENSURE AUGUST MONTHLY HISTORY ALIGNMENT
  UPDATE investor_monthly_history
  SET 
    opening_balance = 487000.00,
    ending_balance = 487000.00,
    updated_at = NOW()
  WHERE id = v_aug_hist.id AND (opening_balance IS DISTINCT FROM 487000.00 OR ending_balance IS DISTINCT FROM 487000.00);

  -- 6. POSTCHECK ASSERTIONS
  SELECT starting_capital, open_date INTO v_acc_record FROM investor_accounts WHERE id = v_acc_record.id;
  IF v_acc_record.starting_capital IS DISTINCT FROM 487000.00 OR v_acc_record.open_date IS DISTINCT FROM DATE '2026-08-01' THEN
    RAISE EXCEPTION 'POSTCHECK_FAILURE: Account starting capital / open date not aligned.';
  END IF;

  RAISE NOTICE 'SUCCESS: Gary Larson Tier 3 correction completed and verified.';
END $$;
```

---

## 3. Step C: Read-Only Post-Write Verification

```sql
SELECT 
  -- 1. Updated Account Baseline
  (
    SELECT json_build_object('open_date', open_date, 'starting_capital', starting_capital, 'status', status)
    FROM investor_accounts WHERE id = 'glarson' OR investor_id = 'inv_2093cd23'
  ) AS updated_account,

  -- 2. Voided Deposit
  (
    SELECT json_build_object('id', id, 'amount', amount, 'type', type, 'notes', notes)
    FROM deposits WHERE id = 'dep_94a0ffe1'
  ) AS voided_deposit,

  -- 3. Aligned August History
  (
    SELECT json_build_object('opening', opening_balance, 'withdrawals', withdrawals, 'ending', ending_balance)
    FROM investor_monthly_history WHERE investor_id = 'inv_2093cd23' AND year = 2026 AND month_number = 8
  ) AS aligned_aug_history;
```

---

## 4. Guarded Atomic Reversal (Rollback)

```sql
DO $$
BEGIN
  PERFORM pg_advisory_xact_lock(financial_lock_key('inv_2093cd23'));

  UPDATE investors
  SET start_date = DATE '2026-09-01', updated_at = NOW()
  WHERE id = 'inv_2093cd23';

  UPDATE investor_accounts
  SET open_date = DATE '2026-09-01', starting_capital = 75000.00, updated_at = NOW()
  WHERE id = 'glarson' OR investor_id = 'inv_2093cd23';

  UPDATE deposits
  SET type = 'DEPOSIT', notes = NULL
  WHERE id = 'dep_94a0ffe1';

  UPDATE investor_monthly_history
  SET opening_balance = 75000.00, ending_balance = 75000.00, updated_at = NOW()
  WHERE investor_id = 'inv_2093cd23' AND year = 2026 AND month_number = 8;
END $$;
```
