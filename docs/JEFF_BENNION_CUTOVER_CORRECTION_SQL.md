# Jeff Bennion — August 1 Baseline Cutover ($2,673,903.44) Tier 3 Auditable Correction SQL

**Target Database:** `julhldzkiqdeuuoqmvlo` (Supabase Production — Stone Forex)  
**Target Investor:** `inv_65b7fbd9` (`jbennion`)  
**Target Account:** `jbennion`  
**Classification:** **`TIER_3_HISTORY_CUTOVER`**  
**Authorized Scope:** Insert auditable cutover record in `account_cutover_adjustments` with authorized August 1 starting operating capital of **$2,673,903.44**; preserve existing August $21,500.00 withdrawal (`wd_54f99320`); align August ending balance to **$2,652,403.44**; leave July history strictly unchanged; zero fake deposits.

---

## 1. Step A: Read-Only Live CAS Preflight

```sql
SELECT 
  i.id AS investor_id,
  i.portal_username,
  i.split_pct,
  i.monthly_draw,
  a.open_date,
  a.starting_capital,
  (SELECT amount FROM withdrawals WHERE id = 'wd_54f99320') AS wd_54f99320_amount,
  (SELECT status FROM withdrawals WHERE id = 'wd_54f99320') AS wd_54f99320_status,
  (SELECT ending_balance FROM investor_monthly_history WHERE investor_id = 'inv_65b7fbd9' AND year = 2026 AND month_number = 7) AS july_ending,
  (SELECT opening_balance FROM investor_monthly_history WHERE investor_id = 'inv_65b7fbd9' AND year = 2026 AND month_number = 8) AS aug_opening,
  (SELECT withdrawals FROM investor_monthly_history WHERE investor_id = 'inv_65b7fbd9' AND year = 2026 AND month_number = 8) AS aug_withdrawals,
  (SELECT ending_balance FROM investor_monthly_history WHERE investor_id = 'inv_65b7fbd9' AND year = 2026 AND month_number = 8) AS aug_ending
FROM investors i
JOIN investor_accounts a ON a.investor_id = i.id OR a.id = i.portal_username
WHERE i.id = 'inv_65b7fbd9';
```

---

## 2. Step B: Mutating Certified Tier 3 Auditable Transaction

```sql
DO $$
DECLARE
  v_lock_key         BIGINT;
  v_inv_record       RECORD;
  v_acc_record       RECORD;
  v_wd_record        RECORD;
  v_july_hist        RECORD;
  v_aug_hist         RECORD;
  v_cutover_record   RECORD;
  v_aug_open         NUMERIC(20, 10);
  v_aug_end          NUMERIC(20, 10);
  v_avail_eq         NUMERIC(20, 2);
BEGIN
  -- 1. ACQUIRE ADVISORY LOCK & EXCLUSIVE ROW LOCKS
  v_lock_key := financial_lock_key('inv_65b7fbd9');
  PERFORM pg_advisory_xact_lock(v_lock_key);

  SELECT * INTO v_inv_record FROM investors WHERE id = 'inv_65b7fbd9' FOR UPDATE;
  IF v_inv_record.id IS NULL THEN
    RAISE EXCEPTION 'CAS_FAILURE: Investor inv_65b7fbd9 not found.';
  END IF;

  SELECT * INTO v_acc_record FROM investor_accounts WHERE id = 'jbennion' OR investor_id = 'inv_65b7fbd9' FOR UPDATE;
  IF v_acc_record.id IS NULL THEN
    RAISE EXCEPTION 'CAS_FAILURE: Account jbennion not found.';
  END IF;

  SELECT * INTO v_wd_record FROM withdrawals WHERE id = 'wd_54f99320' FOR UPDATE;
  IF v_wd_record.id IS NULL THEN
    RAISE EXCEPTION 'CAS_FAILURE: Existing August withdrawal wd_54f99320 not found.';
  END IF;

  SELECT * INTO v_july_hist FROM investor_monthly_history WHERE investor_id = 'inv_65b7fbd9' AND year = 2026 AND month_number = 7 FOR UPDATE;
  IF v_july_hist.id IS NULL THEN
    RAISE EXCEPTION 'CAS_FAILURE: July 2026 history row missing.';
  END IF;

  SELECT * INTO v_aug_hist FROM investor_monthly_history WHERE investor_id = 'inv_65b7fbd9' AND year = 2026 AND month_number = 8 FOR UPDATE;
  IF v_aug_hist.id IS NULL THEN
    RAISE EXCEPTION 'CAS_FAILURE: August 2026 history row missing.';
  END IF;

  -- 2. CAS ASSERTIONS
  IF ROUND(v_july_hist.ending_balance, 2) IS DISTINCT FROM 2706307.62 THEN
    RAISE EXCEPTION 'CAS_FAILURE: July ending balance is % (expected 2706307.62)', v_july_hist.ending_balance;
  END IF;

  IF v_wd_record.amount IS DISTINCT FROM 21500.00 THEN
    RAISE EXCEPTION 'CAS_FAILURE: wd_54f99320 amount is % (expected 21500.00)', v_wd_record.amount;
  END IF;

  IF v_wd_record.status IS DISTINCT FROM 'Approved' THEN
    RAISE EXCEPTION 'CAS_FAILURE: wd_54f99320 status is % (expected Approved)', v_wd_record.status;
  END IF;

  -- 3. INSERT AUDITABLE CUTOVER ADJUSTMENT RECORD
  INSERT INTO account_cutover_adjustments (
    investor_id,
    account_id,
    year,
    month_number,
    effective_date,
    authorized_opening_balance,
    prior_rollforward_balance,
    reason,
    authorization_reference,
    created_by,
    idempotency_key
  )
  VALUES (
    'inv_65b7fbd9',
    v_acc_record.id,
    2026,
    8,
    DATE '2026-08-01',
    2673903.44,
    2706307.62,
    'August 1, 2026 cutover starting operating capital authorized by Josh Stout',
    'JOSH_AUTHORIZATION_AUGUST_1_CUTOVER',
    'system_reconciliation',
    'cutover_inv_65b7fbd9_2026_8'
  )
  ON CONFLICT (investor_id, year, month_number)
  DO UPDATE SET
    authorized_opening_balance = EXCLUDED.authorized_opening_balance,
    prior_rollforward_balance = EXCLUDED.prior_rollforward_balance,
    reason = EXCLUDED.reason,
    authorization_reference = EXCLUDED.authorization_reference,
    updated_at = NOW();

  -- 4. ALIGN AUGUST 2026 HISTORY TO AUTHORIZED CUTOVER
  v_aug_open := 2673903.44;
  v_aug_end := v_aug_open - 21500.00; -- 2,652,403.44

  UPDATE investor_monthly_history
  SET 
    opening_balance = v_aug_open,
    withdrawals = 21500.00,
    ending_balance = v_aug_end,
    updated_at = NOW()
  WHERE id = v_aug_hist.id;

  -- 5. POSTCHECK ASSERTIONS
  SELECT * INTO v_cutover_record 
  FROM account_cutover_adjustments 
  WHERE investor_id = 'inv_65b7fbd9' AND year = 2026 AND month_number = 8;

  IF v_cutover_record.id IS NULL OR v_cutover_record.authorized_opening_balance IS DISTINCT FROM 2673903.44 THEN
    RAISE EXCEPTION 'POSTCHECK_FAILURE: Cutover adjustment record not persisted correctly.';
  END IF;

  SELECT opening_balance, ending_balance INTO v_aug_hist FROM investor_monthly_history WHERE id = v_aug_hist.id;

  IF ROUND(v_aug_hist.opening_balance, 2) IS DISTINCT FROM 2673903.44 THEN
    RAISE EXCEPTION 'POSTCHECK_FAILURE: August opening is % (expected 2673903.44)', v_aug_hist.opening_balance;
  END IF;

  IF ROUND(v_aug_hist.ending_balance, 2) IS DISTINCT FROM 2652403.44 THEN
    RAISE EXCEPTION 'POSTCHECK_FAILURE: August ending is % (expected 2652403.44)', v_aug_hist.ending_balance;
  END IF;

  -- Verify Package B Available Equity
  v_avail_eq := calculate_available_withdrawal_equity_sql('inv_65b7fbd9', v_acc_record.id, DATE '2026-08-01', NULL);
  IF v_avail_eq IS DISTINCT FROM 2652403.44 THEN
    RAISE EXCEPTION 'POSTCHECK_FAILURE: Package B available equity is % (expected 2652403.44)', v_avail_eq;
  END IF;

  RAISE NOTICE 'SUCCESS: Jeff Bennion auditable cutover alignment completed and verified.';
END $$;
```

---

## 3. Step C: Read-Only Post-Write Verification

```sql
SELECT 
  -- 1. Preserved Unchanged July History
  (
    SELECT json_build_object('opening', opening_balance, 'gain', ROUND(ending_balance - opening_balance, 2), 'ending', ending_balance)
    FROM investor_monthly_history WHERE investor_id = 'inv_65b7fbd9' AND year = 2026 AND month_number = 7
  ) AS preserved_july_history,

  -- 2. Auditable Cutover Record
  (
    SELECT json_build_object('id', id, 'authorized_opening', authorized_opening_balance, 'prior_rollforward', prior_rollforward_balance, 'reason', reason, 'auth_ref', authorization_reference)
    FROM account_cutover_adjustments WHERE investor_id = 'inv_65b7fbd9' AND year = 2026 AND month_number = 8
  ) AS persisted_cutover_record,

  -- 3. Aligned August History
  (
    SELECT json_build_object('opening', opening_balance, 'withdrawals', withdrawals, 'ending', ending_balance)
    FROM investor_monthly_history WHERE investor_id = 'inv_65b7fbd9' AND year = 2026 AND month_number = 8
  ) AS aligned_aug_history,

  -- 4. Preserved August Withdrawal
  (
    SELECT json_build_object('id', id, 'amount', amount, 'status', status)
    FROM withdrawals WHERE id = 'wd_54f99320'
  ) AS preserved_aug_withdrawal,

  -- 5. Package B Available Equity
  (
    SELECT calculate_available_withdrawal_equity_sql('inv_65b7fbd9', 'jbennion', DATE '2026-08-01', NULL)
  ) AS package_b_available_equity;
```

---

## 4. Guarded Atomic Reversal (Rollback)

```sql
DO $$
BEGIN
  PERFORM pg_advisory_xact_lock(financial_lock_key('inv_65b7fbd9'));

  DELETE FROM account_cutover_adjustments 
  WHERE investor_id = 'inv_65b7fbd9' AND year = 2026 AND month_number = 8;

  UPDATE investor_monthly_history
  SET 
    opening_balance = 2706307.62,
    withdrawals = 21500.00,
    ending_balance = 2684807.62,
    updated_at = NOW()
  WHERE investor_id = 'inv_65b7fbd9' AND year = 2026 AND month_number = 8;
END $$;
```
