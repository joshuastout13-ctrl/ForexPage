# Mary Jo Harris — July $20,000 Withdrawal & Multi-Table Dependency Correction SQL

**Target Database:** `julhldzkiqdeuuoqmvlo` (Supabase Production — Stone Forex)  
**Target Investor:** `inv_4c5c0ee6` (`mharris`)  
**Target Account:** `mharris`  
**Classification:** **`TIER_4_MULTI_TABLE_DEPENDENCY_CORRECTION`**  
**Authorized Scope:** Realign July withdrawal from $22,000 $\to$ $20,000; align July/August history and dependent downline commission.

---

## 1. Step A: Read-Only Live CAS Preflight

```sql
SELECT 
  i.id AS investor_id,
  i.portal_username,
  i.start_date,
  i.split_pct,
  a.open_date,
  a.starting_capital,
  (SELECT amount FROM withdrawals WHERE id = 'wd_e4fc9d89') AS wd_e4fc9d89_amount,
  (SELECT month_number FROM withdrawals WHERE id = 'wd_e4fc9d89') AS wd_e4fc9d89_month,
  (SELECT amount FROM withdrawals WHERE id = 'wd_cd3c1dda') AS wd_cd3c1dda_amount,
  (SELECT ending_balance FROM investor_monthly_history WHERE investor_id = 'inv_4c5c0ee6' AND year = 2026 AND month_number = 7) AS july_ending_balance,
  (SELECT withdrawals FROM investor_monthly_history WHERE investor_id = 'inv_4c5c0ee6' AND year = 2026 AND month_number = 8) AS aug_withdrawals,
  (SELECT amount FROM commission_earnings WHERE recipient_id = 'inv_d2ab6da4' AND source_investor_id = 'inv_4c5c0ee6' AND year = 2026 AND month_number = 7) AS mbeck_july_comm
FROM investors i
JOIN investor_accounts a ON a.investor_id = i.id OR a.id = i.portal_username
WHERE i.id = 'inv_4c5c0ee6';
```

---

## 2. Step B: Mutating Certified Tier 4 Transaction

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
  -- 1. ACQUIRE ADVISORY LOCK & EXCLUSIVE ROW LOCKS
  v_lock_key := financial_lock_key('inv_4c5c0ee6');
  PERFORM pg_advisory_xact_lock(v_lock_key);

  SELECT * INTO v_inv_record FROM investors WHERE id = 'inv_4c5c0ee6' FOR UPDATE;
  IF v_inv_record.id IS NULL THEN
    RAISE EXCEPTION 'CAS_FAILURE: Investor inv_4c5c0ee6 not found.';
  END IF;

  SELECT * INTO v_acc_record FROM investor_accounts WHERE id = 'mharris' OR investor_id = 'inv_4c5c0ee6' FOR UPDATE;
  IF v_acc_record.id IS NULL THEN
    RAISE EXCEPTION 'CAS_FAILURE: Account mharris not found.';
  END IF;

  SELECT * INTO v_wd_record FROM withdrawals WHERE id = 'wd_e4fc9d89' FOR UPDATE;
  IF v_wd_record.id IS NULL THEN
    RAISE EXCEPTION 'CAS_FAILURE: Withdrawal wd_e4fc9d89 not found.';
  END IF;

  SELECT * INTO v_july_hist FROM investor_monthly_history WHERE investor_id = 'inv_4c5c0ee6' AND year = 2026 AND month_number = 7 FOR UPDATE;
  IF v_july_hist.id IS NULL THEN
    RAISE EXCEPTION 'CAS_FAILURE: July 2026 history row missing.';
  END IF;

  SELECT * INTO v_aug_hist FROM investor_monthly_history WHERE investor_id = 'inv_4c5c0ee6' AND year = 2026 AND month_number = 8 FOR UPDATE;
  IF v_aug_hist.id IS NULL THEN
    RAISE EXCEPTION 'CAS_FAILURE: August 2026 history row missing.';
  END IF;

  -- 2. CAS ASSERTIONS
  IF v_inv_record.split_pct IS DISTINCT FROM 60.00 THEN
    RAISE EXCEPTION 'CAS_FAILURE: Mary Jo split is % (expected 60.00)', v_inv_record.split_pct;
  END IF;

  IF v_wd_record.amount IS DISTINCT FROM 22000.00 THEN
    RAISE EXCEPTION 'CAS_FAILURE: wd_e4fc9d89 amount is % (expected 22000.00)', v_wd_record.amount;
  END IF;

  IF v_july_hist.opening_balance IS DISTINCT FROM 1022877.5935593522 THEN
    RAISE EXCEPTION 'CAS_FAILURE: July opening balance is % (expected 1022877.5935593522)', v_july_hist.opening_balance;
  END IF;

  -- 3. MUTATE WITHDRAWAL wd_e4fc9d89 (22k -> 20k, August -> July)
  UPDATE withdrawals
  SET 
    amount = 20000.00,
    month_number = 7,
    effective_accounting_date = DATE '2026-07-01',
    notes = 'Client authorized reduction to $20,000.00 effective July 1, 2026 per Josh workbook comment (Cell T386)',
    updated_at = NOW()
  WHERE id = 'wd_e4fc9d89';

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
  IF v_rows_updated != 1 THEN
    RAISE EXCEPTION 'MUTATION_FAILURE: Expected 1 withdrawal updated, got %', v_rows_updated;
  END IF;

  -- 4. RECALCULATE JULY 2026 HISTORY
  v_july_open := v_july_hist.opening_balance;
  v_july_eligible := v_july_open - 20000.00; -- 1,002,877.5935593522
  v_gross_profit := v_july_eligible * 0.0313; -- 31,390.068678
  v_net_gain := v_gross_profit * 0.60; -- 18,834.041207
  v_july_end := v_july_eligible + v_net_gain; -- 1,021,711.634766

  UPDATE investor_monthly_history
  SET 
    withdrawals = 20000.00,
    ending_balance = v_july_end,
    updated_at = NOW()
  WHERE id = v_july_hist.id;

  -- 5. ALIGN AUGUST 2026 HISTORY
  v_aug_end := v_july_end - 18700.00; -- 1,003,011.634766
  UPDATE investor_monthly_history
  SET 
    opening_balance = v_july_end,
    withdrawals = 18700.00,
    ending_balance = v_aug_end,
    updated_at = NOW()
  WHERE id = v_aug_hist.id;

  -- 6. ALIGN MICHAEL BECK JULY COMMISSION
  v_mbeck_comm := ROUND(v_gross_profit * 0.05, 2); -- 1,569.50
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

---

## 3. Step C: Read-Only Post-Write Verification

```sql
SELECT 
  -- 1. Updated Withdrawal
  (
    SELECT json_build_object('id', id, 'amount', amount, 'month_number', month_number, 'effective_date', effective_accounting_date, 'notes', notes)
    FROM withdrawals WHERE id = 'wd_e4fc9d89'
  ) AS updated_withdrawal,

  -- 2. Aligned July History
  (
    SELECT json_build_object('opening', opening_balance, 'withdrawals', withdrawals, 'ending', ending_balance)
    FROM investor_monthly_history WHERE investor_id = 'inv_4c5c0ee6' AND year = 2026 AND month_number = 7
  ) AS aligned_july_history,

  -- 3. Aligned August History
  (
    SELECT json_build_object('opening', opening_balance, 'withdrawals', withdrawals, 'ending', ending_balance)
    FROM investor_monthly_history WHERE investor_id = 'inv_4c5c0ee6' AND year = 2026 AND month_number = 8
  ) AS aligned_aug_history,

  -- 4. Aligned Michael Beck Commission
  (
    SELECT json_build_object('amount', amount)
    FROM commission_earnings WHERE recipient_id = 'inv_d2ab6da4' AND source_investor_id = 'inv_4c5c0ee6' AND year = 2026 AND month_number = 7
  ) AS mbeck_july_comm;
```

---

## 4. Guarded Atomic Reversal (Rollback)

```sql
DO $$
BEGIN
  PERFORM pg_advisory_xact_lock(financial_lock_key('inv_4c5c0ee6'));

  UPDATE withdrawals
  SET 
    amount = 22000.00,
    month_number = 8,
    effective_accounting_date = NULL,
    notes = NULL,
    updated_at = NOW()
  WHERE id = 'wd_e4fc9d89';

  UPDATE investor_monthly_history
  SET 
    withdrawals = 0.00,
    ending_balance = 1042087.2347663968,
    updated_at = NOW()
  WHERE investor_id = 'inv_4c5c0ee6' AND year = 2026 AND month_number = 7;

  UPDATE investor_monthly_history
  SET 
    opening_balance = 1042087.2347663968,
    withdrawals = 40700.00,
    ending_balance = 1001387.2347663968,
    updated_at = NOW()
  WHERE investor_id = 'inv_4c5c0ee6' AND year = 2026 AND month_number = 8;

  UPDATE commission_earnings
  SET amount = 1600.80
  WHERE recipient_id = 'inv_d2ab6da4' 
    AND source_investor_id = 'inv_4c5c0ee6' 
    AND year = 2026 AND month_number = 7;
END $$;
```
