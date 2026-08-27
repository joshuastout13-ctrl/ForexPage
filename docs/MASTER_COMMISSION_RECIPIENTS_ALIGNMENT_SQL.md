# Master Commission Recipients August History Alignment Transaction

**Target Accounts:**
1. JStout (`stout001` / `jstout`) — Delta: `-$205.59`
2. Stone & Co (`inv_015f3774` / `stoneandco`) — Delta: `-$181.31`
3. Rwamsley (`inv_920b8af8` / `rwamsley`) — Delta: `-$179.69`

**Root Cause:** `HISTORY_CAPITALIZATION_STALE`  
Jeannine Shaffar's July downline referral commissions (`dep_e10ccd56` bogus deposit void) were updated in `commission_earnings` ($5.78, $5.09, $5.05), but the 3 recipient August 2026 opening balance history rows still retained the stale pre-correction commission totals ($211.37, $186.40, $184.74).

**Scope:** Update recipient August 2026 `opening_balance` and `ending_balance` in `investor_monthly_history` to reflect exact $N \to N+1$ capitalized July earnings. Zero changes to commission rows or client accounts.

---

## Step A: Read-Only CAS Preflight

```sql
SELECT 
  i.portal_username,
  h.year,
  h.month_number,
  h.opening_balance AS current_aug_opening,
  h.withdrawals AS current_aug_withdrawals,
  h.ending_balance AS current_aug_ending,
  (SELECT ending_balance FROM investor_monthly_history jh WHERE jh.investor_id = i.id AND jh.year = 2026 AND jh.month_number = 7) AS july_ending,
  (SELECT COALESCE(SUM(amount), 0.00) FROM commission_earnings c WHERE c.recipient_id = i.id AND c.year = 2026 AND c.month_number = 7) AS exact_july_commissions
FROM investors i
JOIN investor_monthly_history h ON h.investor_id = i.id AND h.year = 2026 AND h.month_number = 8
WHERE i.portal_username IN ('jstout', 'stoneandco', 'rwamsley')
ORDER BY i.portal_username;
```

---

## Step B: Mutating Atomic Transaction

```sql
DO $$
DECLARE
  v_jstout_hist      RECORD;
  v_stone_hist       RECORD;
  v_rwamsley_hist    RECORD;
  v_jstout_comm      NUMERIC(20, 2);
  v_stone_comm       NUMERIC(20, 2);
  v_rwamsley_comm    NUMERIC(20, 2);
  v_jstout_jul_end   NUMERIC(20, 10);
  v_stone_jul_end    NUMERIC(20, 10);
  v_rwamsley_jul_end NUMERIC(20, 10);
  v_new_open         NUMERIC(20, 10);
  v_new_end          NUMERIC(20, 10);
BEGIN
  -- 1. ACQUIRE EXCLUSIVE ROW LOCKS
  SELECT * INTO v_jstout_hist FROM investor_monthly_history 
  WHERE investor_id IN (SELECT id FROM investors WHERE portal_username = 'jstout') 
    AND year = 2026 AND month_number = 8 FOR UPDATE;
  IF v_jstout_hist.id IS NULL THEN RAISE EXCEPTION 'CAS_FAILURE: jstout August history missing.'; END IF;

  SELECT * INTO v_stone_hist FROM investor_monthly_history 
  WHERE investor_id IN (SELECT id FROM investors WHERE portal_username = 'stoneandco') 
    AND year = 2026 AND month_number = 8 FOR UPDATE;
  IF v_stone_hist.id IS NULL THEN RAISE EXCEPTION 'CAS_FAILURE: stoneandco August history missing.'; END IF;

  SELECT * INTO v_rwamsley_hist FROM investor_monthly_history 
  WHERE investor_id IN (SELECT id FROM investors WHERE portal_username = 'rwamsley') 
    AND year = 2026 AND month_number = 8 FOR UPDATE;
  IF v_rwamsley_hist.id IS NULL THEN RAISE EXCEPTION 'CAS_FAILURE: rwamsley August history missing.'; END IF;

  -- 2. CAS ASSERTIONS (VERIFY CURRENT PRE-CORRECTION STATE)
  IF ROUND(v_jstout_hist.opening_balance, 2) IS DISTINCT FROM 3214444.67 THEN
    RAISE EXCEPTION 'CAS_FAILURE: jstout August opening is % (expected 3214444.67)', v_jstout_hist.opening_balance;
  END IF;

  IF ROUND(v_stone_hist.opening_balance, 2) IS DISTINCT FROM 244507.59 THEN
    RAISE EXCEPTION 'CAS_FAILURE: stoneandco August opening is % (expected 244507.59)', v_stone_hist.opening_balance;
  END IF;

  IF ROUND(v_rwamsley_hist.opening_balance, 2) IS DISTINCT FROM 1306673.61 THEN
    RAISE EXCEPTION 'CAS_FAILURE: rwamsley August opening is % (expected 1306673.61)', v_rwamsley_hist.opening_balance;
  END IF;

  -- 3. FETCH JULY ENDING AND JULY COMMISSIONS FOR EACH
  -- A. jstout
  SELECT ending_balance INTO v_jstout_jul_end FROM investor_monthly_history 
  WHERE investor_id = v_jstout_hist.investor_id AND year = 2026 AND month_number = 7;
  SELECT COALESCE(SUM(amount), 0.00) INTO v_jstout_comm FROM commission_earnings 
  WHERE recipient_id = v_jstout_hist.investor_id AND year = 2026 AND month_number = 7;

  v_new_open := v_jstout_jul_end + v_jstout_comm; -- 3,214,239.0763258696
  v_new_end := v_new_open - COALESCE(v_jstout_hist.withdrawals, 0.00); -- 3,194,239.0763258696

  UPDATE investor_monthly_history 
  SET opening_balance = v_new_open, ending_balance = v_new_end, updated_at = NOW() 
  WHERE id = v_jstout_hist.id;

  -- B. stoneandco
  SELECT ending_balance INTO v_stone_jul_end FROM investor_monthly_history 
  WHERE investor_id = v_stone_hist.investor_id AND year = 2026 AND month_number = 7;
  SELECT COALESCE(SUM(amount), 0.00) INTO v_stone_comm FROM commission_earnings 
  WHERE recipient_id = v_stone_hist.investor_id AND year = 2026 AND month_number = 7;

  v_new_open := v_stone_jul_end + v_stone_comm; -- 244,326.27838464354
  v_new_end := v_new_open - COALESCE(v_stone_hist.withdrawals, 0.00);

  UPDATE investor_monthly_history 
  SET opening_balance = v_new_open, ending_balance = v_new_end, updated_at = NOW() 
  WHERE id = v_stone_hist.id;

  -- C. rwamsley
  SELECT ending_balance INTO v_rwamsley_jul_end FROM investor_monthly_history 
  WHERE investor_id = v_rwamsley_hist.investor_id AND year = 2026 AND month_number = 7;
  SELECT COALESCE(SUM(amount), 0.00) INTO v_rwamsley_comm FROM commission_earnings 
  WHERE recipient_id = v_rwamsley_hist.investor_id AND year = 2026 AND month_number = 7;

  v_new_open := v_rwamsley_jul_end + v_rwamsley_comm; -- 1,306,493.9224479952
  v_new_end := v_new_open - COALESCE(v_rwamsley_hist.withdrawals, 0.00);

  UPDATE investor_monthly_history 
  SET opening_balance = v_new_open, ending_balance = v_new_end, updated_at = NOW() 
  WHERE id = v_rwamsley_hist.id;

  -- 4. POSTCHECKS
  SELECT opening_balance INTO v_new_open FROM investor_monthly_history WHERE id = v_jstout_hist.id;
  IF ROUND(v_new_open, 2) IS DISTINCT FROM 3214239.08 THEN
    RAISE EXCEPTION 'POSTCHECK_FAILURE: jstout August opening is % (expected 3214239.08)', v_new_open;
  END IF;

  SELECT opening_balance INTO v_new_open FROM investor_monthly_history WHERE id = v_stone_hist.id;
  IF ROUND(v_new_open, 2) IS DISTINCT FROM 244326.28 THEN
    RAISE EXCEPTION 'POSTCHECK_FAILURE: stoneandco August opening is % (expected 244326.28)', v_new_open;
  END IF;

  SELECT opening_balance INTO v_new_open FROM investor_monthly_history WHERE id = v_rwamsley_hist.id;
  IF ROUND(v_new_open, 2) IS DISTINCT FROM 1306493.92 THEN
    RAISE EXCEPTION 'POSTCHECK_FAILURE: rwamsley August opening is % (expected 1306493.92)', v_new_open;
  END IF;

  RAISE NOTICE 'SUCCESS: Master commission recipient histories aligned cent-exact.';
END $$;
```

---

## Step C: Read-Only Post-Verification

```sql
SELECT 
  i.portal_username,
  h.year,
  h.month_number,
  h.opening_balance,
  h.withdrawals,
  h.ending_balance
FROM investors i
JOIN investor_monthly_history h ON h.investor_id = i.id AND h.year = 2026 AND h.month_number = 8
WHERE i.portal_username IN ('jstout', 'stoneandco', 'rwamsley')
ORDER BY i.portal_username;
```
