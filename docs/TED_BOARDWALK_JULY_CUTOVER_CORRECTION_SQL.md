# Ted Boardwalk July 1 Cutover Account Reset Transaction

**Account:** Ted Boardwalk  
**Investor ID:** `inv_a79798ca`  
**Portal Username:** `tboardwalk`  
**Target Cutover Date:** `2026-07-01` (Year 2026, Month 7)  
**Authorized July 1 Opening Balance:** `$17.19`  
**Stored Pre-Cutover Roll-forward:** `-$2,041.68`  
**Historical June $5,000 Withdrawal (`wd_9a4f1219`):** `PRESERVED` (Untouched)  
**Accounting Classification:** `ACCOUNT_CUTOVER_ADJUSTMENT` (No fake deposits, no cashflow mutations)

---

## Step A: Read-Only CAS Preflight

```sql
SELECT 
  i.id AS investor_id,
  i.portal_username,
  i.split_pct,
  i.monthly_draw,
  a.open_date,
  a.starting_capital,
  (SELECT amount FROM withdrawals WHERE id = 'wd_9a4f1219') AS june_withdrawal_amount,
  (SELECT status FROM withdrawals WHERE id = 'wd_9a4f1219') AS june_withdrawal_status,
  (SELECT opening_balance FROM investor_monthly_history WHERE investor_id = 'inv_a79798ca' AND year = 2026 AND month_number = 7) AS stored_july_opening,
  (SELECT ending_balance FROM investor_monthly_history WHERE investor_id = 'inv_a79798ca' AND year = 2026 AND month_number = 7) AS stored_july_ending,
  (SELECT opening_balance FROM investor_monthly_history WHERE investor_id = 'inv_a79798ca' AND year = 2026 AND month_number = 8) AS stored_aug_opening,
  (SELECT ending_balance FROM investor_monthly_history WHERE investor_id = 'inv_a79798ca' AND year = 2026 AND month_number = 8) AS stored_aug_ending,
  (SELECT COUNT(*) FROM account_cutover_adjustments WHERE investor_id = 'inv_a79798ca' AND year = 2026 AND month_number = 7) AS existing_cutover_count
FROM investors i
JOIN investor_accounts a ON a.investor_id = i.id OR a.id = i.portal_username
WHERE i.id = 'inv_a79798ca';
```

---

## Step B: Mutating Atomic Transaction

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
  v_july_comm        NUMERIC(20, 2) := 0.00;
  v_july_open        NUMERIC(20, 10);
  v_july_gain        NUMERIC(20, 10);
  v_july_end         NUMERIC(20, 10);
  v_aug_open         NUMERIC(20, 10);
  v_aug_end          NUMERIC(20, 10);
  v_avail_eq_jul     NUMERIC(20, 2);
  v_avail_eq_aug     NUMERIC(20, 2);
BEGIN
  -- 1. ACQUIRE ADVISORY LOCK & EXCLUSIVE ROW LOCKS
  v_lock_key := financial_lock_key('inv_a79798ca');
  PERFORM pg_advisory_xact_lock(v_lock_key);

  SELECT * INTO v_inv_record FROM investors WHERE id = 'inv_a79798ca' FOR UPDATE;
  IF v_inv_record.id IS NULL THEN
    RAISE EXCEPTION 'CAS_FAILURE: Investor inv_a79798ca not found.';
  END IF;

  SELECT * INTO v_acc_record FROM investor_accounts WHERE id = 'tboardwalk' OR investor_id = 'inv_a79798ca' FOR UPDATE;
  IF v_acc_record.id IS NULL THEN
    RAISE EXCEPTION 'CAS_FAILURE: Account tboardwalk not found.';
  END IF;

  SELECT * INTO v_wd_record FROM withdrawals WHERE id = 'wd_9a4f1219' FOR UPDATE;
  IF v_wd_record.id IS NULL THEN
    RAISE EXCEPTION 'CAS_FAILURE: June withdrawal wd_9a4f1219 not found.';
  END IF;

  SELECT * INTO v_july_hist FROM investor_monthly_history WHERE investor_id = 'inv_a79798ca' AND year = 2026 AND month_number = 7 FOR UPDATE;
  IF v_july_hist.id IS NULL THEN
    RAISE EXCEPTION 'CAS_FAILURE: July 2026 history row missing.';
  END IF;

  SELECT * INTO v_aug_hist FROM investor_monthly_history WHERE investor_id = 'inv_a79798ca' AND year = 2026 AND month_number = 8 FOR UPDATE;
  IF v_aug_hist.id IS NULL THEN
    RAISE EXCEPTION 'CAS_FAILURE: August 2026 history row missing.';
  END IF;

  -- 2. CAS ASSERTIONS
  IF v_wd_record.amount IS DISTINCT FROM 5000.00 THEN
    RAISE EXCEPTION 'CAS_FAILURE: wd_9a4f1219 amount is % (expected 5000.00)', v_wd_record.amount;
  END IF;

  IF v_wd_record.status IS DISTINCT FROM 'Completed' THEN
    RAISE EXCEPTION 'CAS_FAILURE: wd_9a4f1219 status is % (expected Completed)', v_wd_record.status;
  END IF;

  -- 3. INSERT AUDITABLE CUTOVER ADJUSTMENT RECORD FOR JULY 1, 2026
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
    'inv_a79798ca',
    v_acc_record.id,
    2026,
    7,
    DATE '2026-07-01',
    17.19,
    -2041.6805042133897,
    'July 1, 2026 account reset starting operating capital authorized by Josh Stout',
    'JOSH_AUTHORIZATION_RESET_JULY_1_17_19',
    'system_reconciliation',
    'cutover_inv_a79798ca_2026_7'
  )
  ON CONFLICT (investor_id, year, month_number)
  DO UPDATE SET
    authorized_opening_balance = EXCLUDED.authorized_opening_balance,
    prior_rollforward_balance = EXCLUDED.prior_rollforward_balance,
    reason = EXCLUDED.reason,
    authorization_reference = EXCLUDED.authorization_reference,
    updated_at = NOW();

  -- 4. RECALCULATE JULY 2026 FROM $17.19 BASIS
  v_july_open := 17.19;
  -- Gross return 3.13%, split 66.60% (0.666)
  v_july_gain := v_july_open * 0.0313 * 0.666; -- 0.358339302
  v_july_end := v_july_open + v_july_gain;      -- 17.548339302

  UPDATE investor_monthly_history
  SET 
    opening_balance = v_july_open,
    deposits = 0.00,
    withdrawals = 0.00,
    gross_return_pct = 3.13,
    ending_balance = v_july_end,
    updated_at = NOW()
  WHERE id = v_july_hist.id;

  -- 5. RECALCULATE AUGUST 2026 (ROLLFORWARD + JULY CAPITALIZED COMMISSIONS)
  SELECT COALESCE(SUM(amount), 0.00) INTO v_july_comm
  FROM commission_earnings
  WHERE recipient_id = 'inv_a79798ca' AND year = 2026 AND month_number = 7;

  v_aug_open := v_july_end + v_july_comm;
  v_aug_end := v_aug_open; -- 0.00% gross return in August

  UPDATE investor_monthly_history
  SET 
    opening_balance = v_aug_open,
    deposits = 0.00,
    withdrawals = 0.00,
    gross_return_pct = 0.00,
    ending_balance = v_aug_end,
    updated_at = NOW()
  WHERE id = v_aug_hist.id;

  -- 6. POSTCHECK ASSERTIONS
  SELECT * INTO v_cutover_record 
  FROM account_cutover_adjustments 
  WHERE investor_id = 'inv_a79798ca' AND year = 2026 AND month_number = 7;

  IF v_cutover_record.id IS NULL OR v_cutover_record.authorized_opening_balance IS DISTINCT FROM 17.19 THEN
    RAISE EXCEPTION 'POSTCHECK_FAILURE: Cutover adjustment record not persisted correctly.';
  END IF;

  SELECT opening_balance, ending_balance INTO v_july_hist FROM investor_monthly_history WHERE id = v_july_hist.id;
  IF ROUND(v_july_hist.opening_balance, 2) IS DISTINCT FROM 17.19 THEN
    RAISE EXCEPTION 'POSTCHECK_FAILURE: July opening is % (expected 17.19)', v_july_hist.opening_balance;
  END IF;

  IF ROUND(v_july_hist.ending_balance, 2) IS DISTINCT FROM 17.55 THEN
    RAISE EXCEPTION 'POSTCHECK_FAILURE: July ending is % (expected 17.55)', v_july_hist.ending_balance;
  END IF;

  SELECT opening_balance, ending_balance INTO v_aug_hist FROM investor_monthly_history WHERE id = v_aug_hist.id;
  IF ROUND(v_aug_hist.opening_balance, 2) IS DISTINCT FROM ROUND(v_aug_open, 2) THEN
    RAISE EXCEPTION 'POSTCHECK_FAILURE: August opening is % (expected %)', v_aug_hist.opening_balance, v_aug_open;
  END IF;

  -- Verify Package B Available Equity
  v_avail_eq_jul := calculate_available_withdrawal_equity_sql('inv_a79798ca', v_acc_record.id, DATE '2026-07-01', NULL);
  IF v_avail_eq_jul IS DISTINCT FROM 17.19 THEN
    RAISE EXCEPTION 'POSTCHECK_FAILURE: Package B July available equity is % (expected 17.19)', v_avail_eq_jul;
  END IF;

  v_avail_eq_aug := calculate_available_withdrawal_equity_sql('inv_a79798ca', v_acc_record.id, DATE '2026-08-01', NULL);
  IF v_avail_eq_aug IS DISTINCT FROM ROUND(v_aug_end, 2) THEN
    RAISE EXCEPTION 'POSTCHECK_FAILURE: Package B August available equity is % (expected %)', v_avail_eq_aug, ROUND(v_aug_end, 2);
  END IF;

  RAISE NOTICE 'SUCCESS: Ted Boardwalk July 1 cutover reset completed and verified.';
END $$;
```

---

## Step C: Read-Only Post-Verification

```sql
SELECT 
  -- 1. Preserved June Withdrawal
  (
    SELECT json_build_object('id', id, 'amount', amount, 'status', status)
    FROM withdrawals WHERE id = 'wd_9a4f1219'
  ) AS preserved_june_withdrawal,

  -- 2. Persisted Cutover Record
  (
    SELECT json_build_object('id', id, 'authorized_opening', authorized_opening_balance, 'prior_rollforward', prior_rollforward_balance, 'reason', reason, 'auth_ref', authorization_reference)
    FROM account_cutover_adjustments WHERE investor_id = 'inv_a79798ca' AND year = 2026 AND month_number = 7
  ) AS persisted_cutover_record,

  -- 3. Corrected July History
  (
    SELECT json_build_object('opening', opening_balance, 'gain', ROUND(ending_balance - opening_balance, 2), 'ending', ending_balance)
    FROM investor_monthly_history WHERE investor_id = 'inv_a79798ca' AND year = 2026 AND month_number = 7
  ) AS corrected_july_history,

  -- 4. Corrected August History
  (
    SELECT json_build_object('opening', opening_balance, 'ending', ending_balance)
    FROM investor_monthly_history WHERE investor_id = 'inv_a79798ca' AND year = 2026 AND month_number = 8
  ) AS corrected_aug_history,

  -- 5. Package B Available Equity
  (
    SELECT json_build_object(
      'july_equity', calculate_available_withdrawal_equity_sql('inv_a79798ca', 'tboardwalk', DATE '2026-07-01', NULL),
      'aug_equity', calculate_available_withdrawal_equity_sql('inv_a79798ca', 'tboardwalk', DATE '2026-08-01', NULL)
    )
  ) AS package_b_equity;
```
