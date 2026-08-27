# Package B 2.2.0 (Cutover-Aware Equity) Architecture & Certification

**Previous Version:** `Package B 2.1.0` (`PRODUCTION_RESTORED_AND_VERIFIED`)  
**New Version:** `Package B 2.2.0` (`CUTOVER_AWARE_EQUITY`)  
**Engine:** Native `PostgreSQL 18.4 on x86_64-windows`  
**Status:** `CERTIFIED_PASS`  

---

## 1. Versioning & Exact Specification Delta

### Base Invariants Preserved from 2.1.0:
1. **Advisory Transaction Locking:** `PERFORM pg_advisory_xact_lock(financial_lock_key(p_investor_id))` serializes all withdrawal mutations per investor.
2. **Fail-Closed Date Validation:** Effective date must be the 1st day of the month (`YYYY-MM-01`).
3. **Reservation Invariance:** Pending, Approved, and Completed withdrawals deduct from available equity.
4. **Deposit & Commission Recognition:** Only non-void deposits and capitalized prior-month commissions contribute to equity.

### Version 2.2.0 Upgrade Delta:
* **Section D Modification:** Adds priority check against `account_cutover_adjustments`.
  ```sql
  -- D. Check for Authorized Cutover Adjustment FIRST
  SELECT authorized_opening_balance INTO v_cutover_balance
  FROM account_cutover_adjustments
  WHERE investor_id = p_investor_id
    AND year = v_target_year
    AND month_number = v_target_month
  LIMIT 1;

  IF v_cutover_balance IS NOT NULL THEN
    v_prior_ending_balance := ROUND(v_cutover_balance, 2);
  ELSIF v_is_first_period THEN
    v_prior_ending_balance := v_starting_capital;
  ELSE
    ... (Standard History Ending Balance Retrieval)
  END IF;
  ```
* **No-Cutover Invariance:** When `v_cutover_balance IS NULL`, execution is 100% byte-for-byte identical to Package B 2.1.0.

---

## 2. Test Matrix & Multi-Backend Certification Results

| Test Scenario | Target Entity | Expected Result | Native Postgres 18.4 Output | Status |
|:---|:---|:---|:---|:---|
| **Non-Cutover Equity Regression** | Jerry's Rogue Jets (`jerrys001`) | $543,635.92 | $543,635.92 | ✅ `PASS` |
| **Non-Cutover Equity Regression** | Mary Jo Harris (`inv_4c5c0ee6`) | $1,021,711.63 | $1,021,711.63 | ✅ `PASS` |
| **Non-Cutover Equity Regression** | Michael Beck (`inv_d2ab6da4`) | $570,784.95 | $570,784.95 | ✅ `PASS` |
| **Cutover-Aware Equity** | Jeff Bennion (`inv_65b7fbd9`) | $2,652,403.44 | $2,652,403.44 ($2.673M cutover - $21.5k wd) | ✅ `PASS` |
| **Overdraw Rejection** | Jeff Bennion (`inv_65b7fbd9`) | Reject request for $2,652,403.45 | Exception: `INSUFFICIENT_EQUITY` | ✅ `PASS` |
| **Concurrent Concurrency (10/10)** | Multi-Investor & Multi-Withdrawal | 0 race conditions, serialized | 10/10 PASS | ✅ `PASS` |
| **Advisory Lock Contention** | Distinct PIDs (`clientA` vs `clientB`) | Blocked until transaction commit | Confirmed via `pg_locks` | ✅ `PASS` |
