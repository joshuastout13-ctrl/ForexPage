# Jeannine Shaffar — Bogus Deposit Void & Tier 3 History Realignment SQL

**Target Database:** `julhldzkiqdeuuoqmvlo` (Supabase Production — Stone Forex)  
**Target Investor:** `inv_3e8224ee` (`jshaffar`)  
**Target Account:** `jshaffar`  
**Classification:** **`TIER_3_HISTORY_DEPENDENCY_CORRECTION`**  
**Authorized Scope:** Void bogus deposit `dep_e10ccd56` ($51,719.41) per Josh comment (Cell T253); realign July and August history from first principles ($1,453.25 legitimate eligible capital $\implies$ $29.57 gain $\implies$ $1,482.82 ending balance); align July downline commission earnings rows.

---

## 1. Step A: Read-Only Live CAS Preflight

```sql
SELECT 
  i.id AS investor_id,
  i.portal_username,
  i.start_date,
  i.split_pct,
  a.starting_capital,
  (SELECT type FROM deposits WHERE id = 'dep_e10ccd56') AS dep_e10ccd56_type,
  (SELECT amount FROM deposits WHERE id = 'dep_e10ccd56') AS dep_e10ccd56_amount,
  (SELECT deposits FROM investor_monthly_history WHERE investor_id = 'inv_3e8224ee' AND year = 2026 AND month_number = 7) AS july_deposits,
  (SELECT ending_balance FROM investor_monthly_history WHERE investor_id = 'inv_3e8224ee' AND year = 2026 AND month_number = 7) AS july_ending_balance,
  (SELECT opening_balance FROM investor_monthly_history WHERE investor_id = 'inv_3e8224ee' AND year = 2026 AND month_number = 8) AS aug_opening_balance,
  (SELECT COALESCE(SUM(amount), 0) FROM commission_earnings WHERE source_investor_id = 'inv_3e8224ee' AND year = 2026 AND month_number = 7) AS july_total_commissions
FROM investors i
JOIN investor_accounts a ON a.investor_id = i.id OR a.id = i.portal_username
WHERE i.id = 'inv_3e8224ee';
```

---

## 2. Step B: Mutating Certified Tier 3 Transaction

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
  -- 1. ACQUIRE ADVISORY LOCK & EXCLUSIVE ROW LOCKS
  v_lock_key := financial_lock_key('inv_3e8224ee');
  PERFORM pg_advisory_xact_lock(v_lock_key);

  SELECT * INTO v_inv_record FROM investors WHERE id = 'inv_3e8224ee' FOR UPDATE;
  IF v_inv_record.id IS NULL THEN
    RAISE EXCEPTION 'CAS_FAILURE: Investor inv_3e8224ee not found.';
  END IF;

  SELECT * INTO v_dep_record FROM deposits WHERE id = 'dep_e10ccd56' FOR UPDATE;
  IF v_dep_record.id IS NULL THEN
    RAISE EXCEPTION 'CAS_FAILURE: Deposit dep_e10ccd56 not found.';
  END IF;

  SELECT * INTO v_july_hist FROM investor_monthly_history WHERE investor_id = 'inv_3e8224ee' AND year = 2026 AND month_number = 7 FOR UPDATE;
  IF v_july_hist.id IS NULL THEN
    RAISE EXCEPTION 'CAS_FAILURE: July 2026 history row missing.';
  END IF;

  SELECT * INTO v_aug_hist FROM investor_monthly_history WHERE investor_id = 'inv_3e8224ee' AND year = 2026 AND month_number = 8 FOR UPDATE;
  IF v_aug_hist.id IS NULL THEN
    RAISE EXCEPTION 'CAS_FAILURE: August 2026 history row missing.';
  END IF;

  -- 2. CAS ASSERTIONS
  IF v_dep_record.amount IS DISTINCT FROM 51719.41 THEN
    RAISE EXCEPTION 'CAS_FAILURE: dep_e10ccd56 amount is % (expected 51719.41)', v_dep_record.amount;
  END IF;

  IF v_july_hist.opening_balance IS DISTINCT FROM 1453.25 THEN
    RAISE EXCEPTION 'CAS_FAILURE: July opening is % (expected 1453.25)', v_july_hist.opening_balance;
  END IF;

  -- 3. VOID BOGUS DEPOSIT dep_e10ccd56
  UPDATE deposits
  SET 
    type = 'VOID',
    notes = 'Voided: Confirmed bogus deposit per Josh workbook comment (Cell T253)'
  WHERE id = 'dep_e10ccd56';

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
  IF v_rows_updated != 1 THEN
    RAISE EXCEPTION 'MUTATION_FAILURE: Expected 1 deposit voided, got %', v_rows_updated;
  END IF;

  -- 4. RECALCULATE JULY HISTORY FROM FIRST PRINCIPLES
  -- Legitimate July Eligible Capital = $1,453.25 (opening) + $0.00 (deposits) - $0.00 (withdrawals)
  v_eligible := 1453.25;
  v_gross := v_eligible * 0.0313; -- 45.48671875
  v_gain := v_gross * 0.65; -- 29.5663671875
  v_end := v_eligible + v_gain; -- 1482.8163671875 (displays as $1,482.82)

  UPDATE investor_monthly_history
  SET 
    deposits = 0.00,
    ending_balance = v_end,
    updated_at = NOW()
  WHERE id = v_july_hist.id;

  -- 5. ALIGN AUGUST OPENING / HISTORY
  UPDATE investor_monthly_history
  SET 
    opening_balance = v_end,
    ending_balance = v_end,
    updated_at = NOW()
  WHERE id = v_aug_hist.id;

  -- 6. ALIGN JULY DOWNLINE COMMISSION EARNINGS ROWS (FIRST PRINCIPLES)
  -- 1. Stone & Co (inv_015f3774) @ 11.20% of gross profit ($45.48671875 * 0.1120 = $5.09)
  UPDATE commission_earnings SET amount = 5.09 WHERE id = 'c7fa50d1-3cb6-43df-a412-790643a48e16';
  -- 2. Rwamsley (inv_920b8af8) @ 11.10% of gross profit ($45.48671875 * 0.1110 = $5.05)
  UPDATE commission_earnings SET amount = 5.05 WHERE id = '3581a5c3-4b07-4ed4-a4a0-156ff9e07de4';
  -- 3. JStout (stout001) @ 12.70% of gross profit ($45.48671875 * 0.1270 = $5.78)
  UPDATE commission_earnings SET amount = 5.78 WHERE id = 'a579f12b-759f-4b53-85c8-6b0ca41d7161';

  -- 7. POSTCHECK ASSERTIONS
  SELECT ending_balance INTO v_end FROM investor_monthly_history WHERE id = v_july_hist.id;
  IF ROUND(v_end, 2) IS DISTINCT FROM 1482.82 THEN
    RAISE EXCEPTION 'POSTCHECK_FAILURE: July ending balance is % (expected 1482.82)', v_end;
  END IF;

  RAISE NOTICE 'SUCCESS: Jeannine Shaffar Tier 3 correction completed and verified.';
END $$;
```

---

## 3. Step C: Read-Only Post-Write Verification

```sql
SELECT 
  -- 1. Voided Deposit
  (
    SELECT json_build_object('id', id, 'amount', amount, 'type', type, 'notes', notes)
    FROM deposits WHERE id = 'dep_e10ccd56'
  ) AS voided_deposit,

  -- 2. Aligned July History
  (
    SELECT json_build_object('opening', opening_balance, 'deposits', deposits, 'ending', ending_balance)
    FROM investor_monthly_history WHERE investor_id = 'inv_3e8224ee' AND year = 2026 AND month_number = 7
  ) AS aligned_july_history,

  -- 3. Aligned August History
  (
    SELECT json_build_object('opening', opening_balance, 'deposits', deposits, 'ending', ending_balance)
    FROM investor_monthly_history WHERE investor_id = 'inv_3e8224ee' AND year = 2026 AND month_number = 8
  ) AS aligned_aug_history,

  -- 4. Aligned July Commissions
  (
    SELECT json_agg(json_build_object('id', id, 'recipient', recipient_id, 'amount', amount))
    FROM commission_earnings WHERE source_investor_id = 'inv_3e8224ee' AND year = 2026 AND month_number = 7
  ) AS aligned_commissions;
```

---

## 4. Guarded Atomic Reversal (Rollback)

```sql
DO $$
BEGIN
  PERFORM pg_advisory_xact_lock(financial_lock_key('inv_3e8224ee'));

  UPDATE deposits
  SET type = 'Deposit', notes = 'This includes all of joshs comm'
  WHERE id = 'dep_e10ccd56';

  UPDATE investor_monthly_history
  SET 
    deposits = 51719.41,
    ending_balance = 54254.4577677,
    updated_at = NOW()
  WHERE investor_id = 'inv_3e8224ee' AND year = 2026 AND month_number = 7;

  UPDATE investor_monthly_history
  SET 
    opening_balance = 54254.4577677,
    ending_balance = 54254.4577677,
    updated_at = NOW()
  WHERE investor_id = 'inv_3e8224ee' AND year = 2026 AND month_number = 8;

  UPDATE commission_earnings SET amount = 186.40 WHERE id = 'c7fa50d1-3cb6-43df-a412-790643a48e16';
  UPDATE commission_earnings SET amount = 184.74 WHERE id = '3581a5c3-4b07-4ed4-a4a0-156ff9e07de4';
  UPDATE commission_earnings SET amount = 211.37 WHERE id = 'a579f12b-759f-4b53-85c8-6b0ca41d7161';
END $$;
```
