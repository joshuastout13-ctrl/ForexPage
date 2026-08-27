# Parallel Wave 1 Production Execution Package (Mary Jo Harris, Gary Larson, Jeannine Shaffar)

**Target Database:** `julhldzkiqdeuuoqmvlo` (Supabase Production — Stone Forex)  
**Execution Mode:** **`PARALLEL_INVESTIGATION / INDEPENDENT_TRANSACTION_EXECUTION`**  
**Precondition:** Step A read-only preflight must be executed and confirmed prior to executing Step B for any account.  
**Isolation Guarantee:** Each account is structured as an **independent transaction**. If one account fails its CAS check, other independent corrections are not blocked.

---

# SECTION 1: MARY JO HARRIS (`inv_4c5c0ee6`)

### Step A: Read-Only Preflight
```sql
SELECT 
  i.id AS investor_id,
  i.portal_username,
  i.split_pct,
  (SELECT amount FROM withdrawals WHERE id = 'wd_e4fc9d89') AS wd_e4fc9d89_amount,
  (SELECT month_number FROM withdrawals WHERE id = 'wd_e4fc9d89') AS wd_e4fc9d89_month,
  (SELECT amount FROM withdrawals WHERE id = 'wd_cd3c1dda') AS wd_cd3c1dda_amount,
  (SELECT ending_balance FROM investor_monthly_history WHERE investor_id = 'inv_4c5c0ee6' AND year = 2026 AND month_number = 7) AS july_ending,
  (SELECT withdrawals FROM investor_monthly_history WHERE investor_id = 'inv_4c5c0ee6' AND year = 2026 AND month_number = 8) AS aug_withdrawals,
  (SELECT amount FROM commission_earnings WHERE recipient_id = 'inv_d2ab6da4' AND source_investor_id = 'inv_4c5c0ee6' AND year = 2026 AND month_number = 7) AS mbeck_july_comm
FROM investors i
WHERE i.id = 'inv_4c5c0ee6';
```

### Step B: Mutating Certified Tier 4 Transaction
```sql
DO $$
DECLARE
  v_lock_key         BIGINT;
  v_inv_record       RECORD;
  v_acc_record       RECORD;
  v_wd_record        RECORD;
  v_july_hist        RECORD;
  v_aug_hist         RECORD;
  v_july_open        NUMERIC(20, 10);
  v_july_eligible    NUMERIC(20, 10);
  v_gross_profit     NUMERIC(20, 10);
  v_net_gain         NUMERIC(20, 10);
  v_july_end         NUMERIC(20, 10);
  v_aug_end          NUMERIC(20, 10);
  v_mbeck_comm       NUMERIC(15, 2);
  v_rows_updated     INTEGER;
BEGIN
  -- 1. ADVISORY & ROW LOCKS
  v_lock_key := financial_lock_key('inv_4c5c0ee6');
  PERFORM pg_advisory_xact_lock(v_lock_key);

  SELECT * INTO v_inv_record FROM investors WHERE id = 'inv_4c5c0ee6' FOR UPDATE;
  IF v_inv_record.id IS NULL THEN RAISE EXCEPTION 'CAS_FAILURE: Investor inv_4c5c0ee6 not found.'; END IF;

  SELECT * INTO v_acc_record FROM investor_accounts WHERE id = 'mharris' OR investor_id = 'inv_4c5c0ee6' FOR UPDATE;
  IF v_acc_record.id IS NULL THEN RAISE EXCEPTION 'CAS_FAILURE: Account mharris not found.'; END IF;

  SELECT * INTO v_wd_record FROM withdrawals WHERE id = 'wd_e4fc9d89' FOR UPDATE;
  IF v_wd_record.id IS NULL THEN RAISE EXCEPTION 'CAS_FAILURE: Withdrawal wd_e4fc9d89 not found.'; END IF;

  SELECT * INTO v_july_hist FROM investor_monthly_history WHERE investor_id = 'inv_4c5c0ee6' AND year = 2026 AND month_number = 7 FOR UPDATE;
  IF v_july_hist.id IS NULL THEN RAISE EXCEPTION 'CAS_FAILURE: July 2026 history row missing.'; END IF;

  SELECT * INTO v_aug_hist FROM investor_monthly_history WHERE investor_id = 'inv_4c5c0ee6' AND year = 2026 AND month_number = 8 FOR UPDATE;
  IF v_aug_hist.id IS NULL THEN RAISE EXCEPTION 'CAS_FAILURE: August 2026 history row missing.'; END IF;

  -- 2. CAS PRECONDITIONS
  IF v_inv_record.split_pct IS DISTINCT FROM 60.00 THEN
    RAISE EXCEPTION 'CAS_FAILURE: Mary Jo split is % (expected 60.00)', v_inv_record.split_pct;
  END IF;

  IF v_wd_record.amount IS DISTINCT FROM 22000.00 THEN
    RAISE EXCEPTION 'CAS_FAILURE: wd_e4fc9d89 amount is % (expected 22000.00)', v_wd_record.amount;
  END IF;

  IF v_july_hist.opening_balance IS DISTINCT FROM 1022877.5935593522 THEN
    RAISE EXCEPTION 'CAS_FAILURE: July opening balance is % (expected 1022877.5935593522)', v_july_hist.opening_balance;
  END IF;

  -- 3. MUTATION: WITHDRAWAL wd_e4fc9d89 (22k -> 20k, August -> July)
  UPDATE withdrawals
  SET 
    amount = 20000.00,
    month_number = 7,
    effective_accounting_date = DATE '2026-07-01',
    notes = 'Client authorized reduction to $20,000.00 effective July 1, 2026 per Josh workbook comment (Cell T386)',
    updated_at = NOW()
  WHERE id = 'wd_e4fc9d89';

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
  IF v_rows_updated != 1 THEN RAISE EXCEPTION 'MUTATION_FAILURE: Expected 1 withdrawal updated, got %', v_rows_updated; END IF;

  -- 4. RECALCULATE JULY 2026 HISTORY
  v_july_open := v_july_hist.opening_balance;
  v_july_eligible := v_july_open - 20000.00;
  v_gross_profit := v_july_eligible * 0.0313;
  v_net_gain := v_gross_profit * 0.60;
  v_july_end := v_july_eligible + v_net_gain;

  UPDATE investor_monthly_history
  SET 
    withdrawals = 20000.00,
    ending_balance = v_july_end,
    updated_at = NOW()
  WHERE id = v_july_hist.id;

  -- 5. ALIGN AUGUST 2026 HISTORY
  v_aug_end := v_july_end - 18700.00;
  UPDATE investor_monthly_history
  SET 
    opening_balance = v_july_end,
    withdrawals = 18700.00,
    ending_balance = v_aug_end,
    updated_at = NOW()
  WHERE id = v_aug_hist.id;

  -- 6. ALIGN MICHAEL BECK JULY COMMISSION
  v_mbeck_comm := ROUND(v_gross_profit * 0.05, 2);
  UPDATE commission_earnings
  SET amount = v_mbeck_comm
  WHERE recipient_id = 'inv_d2ab6da4' 
    AND source_investor_id = 'inv_4c5c0ee6' 
    AND year = 2026 AND month_number = 7;

  -- 7. POSTCHECK VERIFICATION
  SELECT ending_balance INTO v_july_end FROM investor_monthly_history WHERE id = v_july_hist.id;
  IF ROUND(v_july_end, 2) IS DISTINCT FROM 1021711.63 THEN
    RAISE EXCEPTION 'POSTCHECK_FAILURE: July ending balance is % (expected 1021711.63)', v_july_end;
  END IF;

  RAISE NOTICE 'SUCCESS: Mary Jo Harris Tier 4 correction completed and verified.';
END $$;
```

### Step C: Read-Only Verification
```sql
SELECT 
  (SELECT json_build_object('id', id, 'amount', amount, 'month_number', month_number, 'effective_date', effective_accounting_date) FROM withdrawals WHERE id = 'wd_e4fc9d89') AS updated_wd,
  (SELECT json_build_object('opening', opening_balance, 'withdrawals', withdrawals, 'ending', ending_balance) FROM investor_monthly_history WHERE investor_id = 'inv_4c5c0ee6' AND year = 2026 AND month_number = 7) AS aligned_july_hist,
  (SELECT json_build_object('opening', opening_balance, 'withdrawals', withdrawals, 'ending', ending_balance) FROM investor_monthly_history WHERE investor_id = 'inv_4c5c0ee6' AND year = 2026 AND month_number = 8) AS aligned_aug_hist,
  (SELECT json_build_object('amount', amount) FROM commission_earnings WHERE recipient_id = 'inv_d2ab6da4' AND source_investor_id = 'inv_4c5c0ee6' AND year = 2026 AND month_number = 7) AS mbeck_comm;
```

---

# SECTION 2: GARY LARSON (`inv_2093cd23`)

### Step A: Read-Only Preflight
```sql
SELECT 
  i.id AS investor_id,
  i.start_date,
  a.open_date,
  a.starting_capital,
  (SELECT type FROM deposits WHERE id = 'dep_94a0ffe1') AS dep_type,
  (SELECT amount FROM deposits WHERE id = 'dep_94a0ffe1') AS dep_amount,
  (SELECT ending_balance FROM investor_monthly_history WHERE investor_id = 'inv_2093cd23' AND year = 2026 AND month_number = 8) AS aug_ending
FROM investors i
JOIN investor_accounts a ON a.investor_id = i.id OR a.id = i.portal_username
WHERE i.id = 'inv_2093cd23';
```

### Step B: Mutating Certified Tier 3 Transaction
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
  -- 1. ADVISORY & ROW LOCKS
  v_lock_key := financial_lock_key('inv_2093cd23');
  PERFORM pg_advisory_xact_lock(v_lock_key);

  SELECT * INTO v_inv_record FROM investors WHERE id = 'inv_2093cd23' FOR UPDATE;
  IF v_inv_record.id IS NULL THEN RAISE EXCEPTION 'CAS_FAILURE: Investor inv_2093cd23 not found.'; END IF;

  SELECT * INTO v_acc_record FROM investor_accounts WHERE id = 'glarson' OR investor_id = 'inv_2093cd23' FOR UPDATE;
  IF v_acc_record.id IS NULL THEN RAISE EXCEPTION 'CAS_FAILURE: Account glarson not found.'; END IF;

  SELECT * INTO v_dep_record FROM deposits WHERE id = 'dep_94a0ffe1' FOR UPDATE;
  IF v_dep_record.id IS NULL THEN RAISE EXCEPTION 'CAS_FAILURE: Deposit dep_94a0ffe1 not found.'; END IF;

  SELECT * INTO v_aug_hist FROM investor_monthly_history WHERE investor_id = 'inv_2093cd23' AND year = 2026 AND month_number = 8 FOR UPDATE;
  IF v_aug_hist.id IS NULL THEN RAISE EXCEPTION 'CAS_FAILURE: August 2026 history row missing.'; END IF;

  -- 2. CAS PRECONDITIONS
  IF v_acc_record.open_date IS DISTINCT FROM DATE '2026-08-01' THEN
    RAISE EXCEPTION 'CAS_FAILURE: account open_date is % (expected 2026-08-01)', v_acc_record.open_date;
  END IF;

  IF v_acc_record.starting_capital IS DISTINCT FROM 487000.00 THEN
    RAISE EXCEPTION 'CAS_FAILURE: starting_capital is % (expected 487000.00)', v_acc_record.starting_capital;
  END IF;

  IF v_dep_record.amount IS DISTINCT FROM 120000.00 THEN
    RAISE EXCEPTION 'CAS_FAILURE: dep_94a0ffe1 amount is % (expected 120000.00)', v_dep_record.amount;
  END IF;

  IF v_dep_record.type IS DISTINCT FROM 'DEPOSIT' THEN
    RAISE EXCEPTION 'CAS_FAILURE: dep_94a0ffe1 type is % (expected DEPOSIT)', v_dep_record.type;
  END IF;

  IF v_aug_hist.opening_balance IS DISTINCT FROM 487000.00 OR v_aug_hist.ending_balance IS DISTINCT FROM 487000.00 THEN
    RAISE EXCEPTION 'CAS_FAILURE: August history is not $487,000.00 baseline';
  END IF;

  -- 3. VOID SCHEDULED SEPTEMBER DEPOSIT dep_94a0ffe1 (ONLY MUTATION)
  UPDATE deposits
  SET 
    type = 'VOID',
    notes = 'Voided: Subsumed into $487,000.00 August 1 starting capital per Josh instruction (Cell T170)'
  WHERE id = 'dep_94a0ffe1';

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
  IF v_rows_updated != 1 THEN
    RAISE EXCEPTION 'MUTATION_FAILURE: Expected 1 deposit voided, got %', v_rows_updated;
  END IF;

  -- 4. POSTCHECK ASSERTIONS
  SELECT type INTO v_dep_record FROM deposits WHERE id = 'dep_94a0ffe1';
  IF v_dep_record.type IS DISTINCT FROM 'VOID' THEN
    RAISE EXCEPTION 'POSTCHECK_FAILURE: Deposit dep_94a0ffe1 not voided.';
  END IF;

  RAISE NOTICE 'SUCCESS: Gary Larson Tier 3 deposit void completed and verified.';
END $$;
```

### Step C: Read-Only Verification
```sql
SELECT 
  (SELECT json_build_object('open_date', open_date, 'starting_capital', starting_capital) FROM investor_accounts WHERE id = 'glarson' OR investor_id = 'inv_2093cd23') AS verified_acc,
  (SELECT json_build_object('id', id, 'type', type, 'notes', notes) FROM deposits WHERE id = 'dep_94a0ffe1') AS voided_dep,
  (SELECT json_build_object('opening', opening_balance, 'ending', ending_balance) FROM investor_monthly_history WHERE investor_id = 'inv_2093cd23' AND year = 2026 AND month_number = 8) AS verified_aug_hist;
```

---

# SECTION 3: JEANNINE SHAFFAR (`inv_3e8224ee`)

### Step A: Read-Only Preflight
```sql
SELECT 
  i.id AS investor_id,
  i.split_pct,
  (SELECT type FROM deposits WHERE id = 'dep_e10ccd56') AS dep_type,
  (SELECT amount FROM deposits WHERE id = 'dep_e10ccd56') AS dep_amount,
  (SELECT deposits FROM investor_monthly_history WHERE investor_id = 'inv_3e8224ee' AND year = 2026 AND month_number = 7) AS july_deposits,
  (SELECT ending_balance FROM investor_monthly_history WHERE investor_id = 'inv_3e8224ee' AND year = 2026 AND month_number = 7) AS july_ending
FROM investors i
WHERE i.id = 'inv_3e8224ee';
```

### Step B: Mutating Certified Tier 3 Transaction
```sql
DO $$
DECLARE
  v_lock_key         BIGINT;
  v_inv_record       RECORD;
  v_dep_record       RECORD;
  v_july_hist        RECORD;
  v_aug_hist         RECORD;
  v_eligible         NUMERIC(20, 10);
  v_gross            NUMERIC(20, 10);
  v_gain             NUMERIC(20, 10);
  v_end              NUMERIC(20, 10);
  v_rows_updated     INTEGER;
BEGIN
  -- 1. ADVISORY & ROW LOCKS
  v_lock_key := financial_lock_key('inv_3e8224ee');
  PERFORM pg_advisory_xact_lock(v_lock_key);

  SELECT * INTO v_inv_record FROM investors WHERE id = 'inv_3e8224ee' FOR UPDATE;
  IF v_inv_record.id IS NULL THEN RAISE EXCEPTION 'CAS_FAILURE: Investor inv_3e8224ee not found.'; END IF;

  SELECT * INTO v_dep_record FROM deposits WHERE id = 'dep_e10ccd56' FOR UPDATE;
  IF v_dep_record.id IS NULL THEN RAISE EXCEPTION 'CAS_FAILURE: Deposit dep_e10ccd56 not found.'; END IF;

  SELECT * INTO v_july_hist FROM investor_monthly_history WHERE investor_id = 'inv_3e8224ee' AND year = 2026 AND month_number = 7 FOR UPDATE;
  IF v_july_hist.id IS NULL THEN RAISE EXCEPTION 'CAS_FAILURE: July 2026 history row missing.'; END IF;

  SELECT * INTO v_aug_hist FROM investor_monthly_history WHERE investor_id = 'inv_3e8224ee' AND year = 2026 AND month_number = 8 FOR UPDATE;
  IF v_aug_hist.id IS NULL THEN RAISE EXCEPTION 'CAS_FAILURE: August 2026 history row missing.'; END IF;

  -- 2. CAS PRECONDITIONS
  IF v_dep_record.amount IS DISTINCT FROM 51719.41 THEN
    RAISE EXCEPTION 'CAS_FAILURE: dep_e10ccd56 amount is % (expected 51719.41)', v_dep_record.amount;
  END IF;

  IF v_july_hist.opening_balance IS DISTINCT FROM 1453.25 THEN
    RAISE EXCEPTION 'CAS_FAILURE: July opening is % (expected 1453.25)', v_july_hist.opening_balance;
  END IF;

  -- 3. VOID BOGUS DEPOSIT
  UPDATE deposits SET type = 'VOID', notes = 'Voided: Confirmed bogus deposit per Josh workbook comment (Cell T253)' WHERE id = 'dep_e10ccd56';
  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
  IF v_rows_updated != 1 THEN RAISE EXCEPTION 'MUTATION_FAILURE: Expected 1 deposit voided, got %', v_rows_updated; END IF;

  -- 4. RECALCULATE JULY HISTORY FROM FIRST PRINCIPLES
  v_eligible := 1453.25;
  v_gross := v_eligible * 0.0313;
  v_gain := v_gross * 0.65;
  v_end := v_eligible + v_gain;

  UPDATE investor_monthly_history SET deposits = 0.00, ending_balance = v_end, updated_at = NOW() WHERE id = v_july_hist.id;

  -- 5. ALIGN AUGUST OPENING & HISTORY
  UPDATE investor_monthly_history SET opening_balance = v_end, ending_balance = v_end, updated_at = NOW() WHERE id = v_aug_hist.id;

  -- 6. ALIGN JULY DOWNLINE COMMISSION EARNINGS ROWS (FIRST PRINCIPLES)
  -- 1. Stone & Co (inv_015f3774) @ 11.20% ($5.09)
  UPDATE commission_earnings SET amount = 5.09 WHERE id = 'c7fa50d1-3cb6-43df-a412-790643a48e16';
  -- 2. Rwamsley (inv_920b8af8) @ 11.10% ($5.05)
  UPDATE commission_earnings SET amount = 5.05 WHERE id = '3581a5c3-4b07-4ed4-a4a0-156ff9e07de4';
  -- 3. JStout (stout001) @ 12.70% ($5.78)
  UPDATE commission_earnings SET amount = 5.78 WHERE id = 'a579f12b-759f-4b53-85c8-6b0ca41d7161';

  -- 7. POSTCHECK ASSERTIONS
  SELECT ending_balance INTO v_end FROM investor_monthly_history WHERE id = v_july_hist.id;
  IF ROUND(v_end, 2) IS DISTINCT FROM 1482.82 THEN
    RAISE EXCEPTION 'POSTCHECK_FAILURE: July ending balance is % (expected 1482.82)', v_end;
  END IF;

  RAISE NOTICE 'SUCCESS: Jeannine Shaffar Tier 3 correction completed and verified.';
END $$;
```

### Step C: Read-Only Verification
```sql
SELECT 
  (SELECT json_build_object('id', id, 'type', type, 'notes', notes) FROM deposits WHERE id = 'dep_e10ccd56') AS voided_dep,
  (SELECT json_build_object('opening', opening_balance, 'deposits', deposits, 'ending', ending_balance) FROM investor_monthly_history WHERE investor_id = 'inv_3e8224ee' AND year = 2026 AND month_number = 7) AS aligned_july_hist,
  (SELECT json_build_object('opening', opening_balance, 'ending', ending_balance) FROM investor_monthly_history WHERE investor_id = 'inv_3e8224ee' AND year = 2026 AND month_number = 8) AS aligned_aug_hist,
  (SELECT json_agg(json_build_object('id', id, 'amount', amount)) FROM commission_earnings WHERE source_investor_id = 'inv_3e8224ee' AND year = 2026 AND month_number = 7) AS aligned_commissions;
```
