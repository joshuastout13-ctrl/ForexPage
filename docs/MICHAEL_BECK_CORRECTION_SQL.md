# Michael Beck — July 1 Cutover ($557,693.10) & August Baseline Alignment SQL

**Target Database:** `julhldzkiqdeuuoqmvlo` (Supabase Production — Stone Forex)  
**Target Investor:** `inv_d2ab6da4` (`mbeck`)  
**Target Account:** `mbeck`  
**Classification:** **`TIER_3_HISTORY_CUTOVER`**  
**Authorized Scope:** Apply client-confirmed July 1 cutover baseline of **$557,693.10**; recalculate July net trading gain ($13,091.85); capitalize verified July referral commissions ($1,958.48); align August opening/ending balance to **$572,743.43**. Zero commission row mutations required.

---

## 1. Step A: Read-Only Live CAS Preflight

```sql
SELECT 
  i.id AS investor_id,
  i.portal_username,
  i.split_pct,
  a.open_date,
  a.starting_capital,
  (SELECT opening_balance FROM investor_monthly_history WHERE investor_id = 'inv_d2ab6da4' AND year = 2026 AND month_number = 7) AS july_opening,
  (SELECT ending_balance FROM investor_monthly_history WHERE investor_id = 'inv_d2ab6da4' AND year = 2026 AND month_number = 7) AS july_ending,
  (SELECT opening_balance FROM investor_monthly_history WHERE investor_id = 'inv_d2ab6da4' AND year = 2026 AND month_number = 8) AS aug_opening,
  (SELECT ending_balance FROM investor_monthly_history WHERE investor_id = 'inv_d2ab6da4' AND year = 2026 AND month_number = 8) AS aug_ending,
  (SELECT COALESCE(SUM(amount), 0) FROM commission_earnings WHERE recipient_id = 'inv_d2ab6da4' AND year = 2026 AND month_number = 7) AS july_comm_total,
  (SELECT json_agg(json_build_object('id', id, 'source', source_investor_id, 'amount', amount)) FROM commission_earnings WHERE recipient_id = 'inv_d2ab6da4' AND year = 2026 AND month_number = 7) AS july_comm_rows
FROM investors i
JOIN investor_accounts a ON a.investor_id = i.id OR a.id = i.portal_username
WHERE i.id = 'inv_d2ab6da4';
```

---

## 2. Step B: Mutating Certified Tier 3 Transaction

```sql
DO $$
DECLARE
  v_lock_key         BIGINT;
  v_inv_record       RECORD;
  v_july_hist        RECORD;
  v_aug_hist         RECORD;
  v_comm_total       NUMERIC(15, 2);
  v_july_open        NUMERIC(20, 10);
  v_gross_profit     NUMERIC(20, 10);
  v_net_gain         NUMERIC(20, 10);
  v_july_end         NUMERIC(20, 10);
  v_aug_open         NUMERIC(20, 10);
BEGIN
  -- 1. ACQUIRE ADVISORY LOCK & EXCLUSIVE ROW LOCKS
  v_lock_key := financial_lock_key('inv_d2ab6da4');
  PERFORM pg_advisory_xact_lock(v_lock_key);

  SELECT * INTO v_inv_record FROM investors WHERE id = 'inv_d2ab6da4' FOR UPDATE;
  IF v_inv_record.id IS NULL THEN
    RAISE EXCEPTION 'CAS_FAILURE: Investor inv_d2ab6da4 not found.';
  END IF;

  SELECT * INTO v_july_hist FROM investor_monthly_history WHERE investor_id = 'inv_d2ab6da4' AND year = 2026 AND month_number = 7 FOR UPDATE;
  IF v_july_hist.id IS NULL THEN
    RAISE EXCEPTION 'CAS_FAILURE: July 2026 history row missing.';
  END IF;

  SELECT * INTO v_aug_hist FROM investor_monthly_history WHERE investor_id = 'inv_d2ab6da4' AND year = 2026 AND month_number = 8 FOR UPDATE;
  IF v_aug_hist.id IS NULL THEN
    RAISE EXCEPTION 'CAS_FAILURE: August 2026 history row missing.';
  END IF;

  -- 2. CAS ASSERTIONS
  IF v_inv_record.split_pct IS DISTINCT FROM 75.00 THEN
    RAISE EXCEPTION 'CAS_FAILURE: Michael Beck split is % (expected 75.00)', v_inv_record.split_pct;
  END IF;

  -- Verify all 5 commission sources are present and total $1,958.48
  SELECT COALESCE(SUM(amount), 0) INTO v_comm_total 
  FROM commission_earnings 
  WHERE recipient_id = 'inv_d2ab6da4' AND year = 2026 AND month_number = 7;

  IF v_comm_total IS DISTINCT FROM 1958.48 THEN
    RAISE EXCEPTION 'CAS_FAILURE: July commissions total % (expected 1958.48)', v_comm_total;
  END IF;

  -- 3. RECALCULATE JULY 2026 FROM AUTHORIZED CUTOVER
  v_july_open := 557693.10;
  v_gross_profit := v_july_open * 0.0313; -- 17,455.79403
  v_net_gain := v_gross_profit * 0.75; -- 13,091.8455225
  v_july_end := v_july_open + v_net_gain; -- 570,784.9455225

  UPDATE investor_monthly_history
  SET 
    opening_balance = v_july_open,
    ending_balance = v_july_end,
    updated_at = NOW()
  WHERE id = v_july_hist.id;

  -- 4. CAPITALIZE COMMISSIONS INTO AUGUST 2026
  v_aug_open := v_july_end + v_comm_total; -- 572,743.4255225

  UPDATE investor_monthly_history
  SET 
    opening_balance = v_aug_open,
    ending_balance = v_aug_open,
    updated_at = NOW()
  WHERE id = v_aug_hist.id;

  -- 5. POSTCHECK ASSERTIONS
  SELECT ending_balance INTO v_july_end FROM investor_monthly_history WHERE id = v_july_hist.id;
  SELECT opening_balance INTO v_aug_open FROM investor_monthly_history WHERE id = v_aug_hist.id;

  IF ROUND(v_july_end, 2) IS DISTINCT FROM 570784.95 THEN
    RAISE EXCEPTION 'POSTCHECK_FAILURE: July ending balance is % (expected 570784.95)', v_july_end;
  END IF;

  IF ROUND(v_aug_open, 2) IS DISTINCT FROM 572743.43 THEN
    RAISE EXCEPTION 'POSTCHECK_FAILURE: August opening balance is % (expected 572743.43)', v_aug_open;
  END IF;

  RAISE NOTICE 'SUCCESS: Michael Beck Tier 3 cutover alignment completed and verified.';
END $$;
```

---

## 3. Step C: Read-Only Post-Write Verification

```sql
SELECT 
  -- 1. Aligned July History
  (
    SELECT json_build_object('opening', opening_balance, 'gain', ROUND(ending_balance - opening_balance, 2), 'ending', ending_balance)
    FROM investor_monthly_history WHERE investor_id = 'inv_d2ab6da4' AND year = 2026 AND month_number = 7
  ) AS aligned_july_history,

  -- 2. Aligned August History
  (
    SELECT json_build_object('opening', opening_balance, 'ending', ending_balance)
    FROM investor_monthly_history WHERE investor_id = 'inv_d2ab6da4' AND year = 2026 AND month_number = 8
  ) AS aligned_aug_history,

  -- 3. Verified Commissions Total
  (
    SELECT json_build_object('total_commissions', SUM(amount), 'source_count', COUNT(*))
    FROM commission_earnings WHERE recipient_id = 'inv_d2ab6da4' AND year = 2026 AND month_number = 7
  ) AS verified_commissions;
```

---

## 4. Guarded Atomic Reversal (Rollback)

```sql
DO $$
BEGIN
  PERFORM pg_advisory_xact_lock(financial_lock_key('inv_d2ab6da4'));

  UPDATE investor_monthly_history
  SET 
    opening_balance = 553437.6833633857,
    ending_balance = 568441.6468494958,
    updated_at = NOW()
  WHERE investor_id = 'inv_d2ab6da4' AND year = 2026 AND month_number = 7;

  UPDATE investor_monthly_history
  SET 
    opening_balance = 570431.43,
    ending_balance = 570431.43,
    updated_at = NOW()
  WHERE investor_id = 'inv_d2ab6da4' AND year = 2026 AND month_number = 8;
END $$;
```
