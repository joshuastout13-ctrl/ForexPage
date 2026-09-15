# September 2026 Withdrawal Batch Execution & Audit Manifest

**Document Version:** 1.0.0  
**Effective Accounting Date:** `2026-09-01`  
**Target Database:** `julhldzkiqdeuuoqmvlo` (Supabase Production — Stone Forex)  
**Stakeholder Authorization Reference:** Josh Stout (Managing Partner / Stone Forex)  
**Execution RPC:** `public.create_withdrawal_atomic` (Hardened Package B Canonical Workflow)  
**Execution Timestamp:** `2026-09-11`  

---

## 1. Executive Summary & Authorization Scope

Fund manager Josh Stout authorized the September 1, 2026 distribution batch for 12 investor accounts. Following complete preflight verification and the production deployment of the start-date conflict resolution migration (`scripts/migrations/20260911_fix_start_date_conflict_validation.sql` / OID 23321):

* **11 Accounts are APPROVED & EXECUTED:** All 11 accounts have verified positive settled equity far exceeding their requested distribution amounts.
* **1 Account is STRICTLY BLOCKED:** Ted Boardwalk (`tboardwalk` / `inv_a79798ca`) requested `$1,100.00`, but authoritative production available equity is `$384.56` (resulting from the July 1 cutover reset to `$17.19`, July net trading gain of `$0.36`, and July earned commissions of `$367.01` capitalized August 1). This request is blocked pending stakeholder confirmation under fail-closed overdraw protection.
* **Zero Capital Manipulation:** No synthetic balances, fake deposits, or cutover modifications were introduced.

---

## 2. Authorized Batch Execution Manifest (11 Executed Transactions)

| # | Investor Name | Portal Username | Investor ID | Account ID | Withdrawal ID | Authorized Amount | Effective Date | Status | Deterministic Idempotency Key |
|:---:|:---|:---|:---|:---|:---|:---:|:---:|:---:|:---|
| 1 | **Mark Richards** | `mrichards` | `inv_f797f3fe` | `mrichards` | `[...]-f9ae79326c8b` | $5,000.00 | `2026-09-01` | `Completed` | `sept-2026-withdrawal-inv_f797f3fe-500000-stakeholder-batch` |
| 2 | **Jeff Bennion** | `jbennion` | `inv_65b7fbd9` | `jbennion` | `[...]-b6e51f30acfb` | $21,500.00 | `2026-09-01` | `Completed` | `sept-2026-withdrawal-inv_65b7fbd9-2150000-stakeholder-batch` |
| 3 | **Mary Jo Harris** | `mharris` | `inv_4c5c0ee6` | `mharris` | `[...]-28135b47eeeb` | $21,000.00 | `2026-09-01` | `Completed` | `sept-2026-withdrawal-inv_4c5c0ee6-2100000-stakeholder-batch` |
| 4 | **Dale Waite** | `dwaite` | `inv_60ed0c32` | `dwaite` | `[...]-951fb17c2552` | $2,000.00 | `2026-09-01` | `Completed` | `sept-2026-withdrawal-inv_60ed0c32-200000-stakeholder-batch` |
| 5 | **Theresa Kruger** | `tkruger` | `inv_8cf28066` | `tkruger` | `[...]-84d7925c40ad` | $1,697.33 | `2026-09-01` | `Completed` | `sept-2026-withdrawal-inv_8cf28066-169733-stakeholder-batch` |
| 6 | **Adam Richards** | `arichards` | `inv_d3ec0cf8` | `arichards` | `[...]-fccd22583a93` | $3,000.00 | `2026-09-01` | `Completed` | `sept-2026-withdrawal-inv_d3ec0cf8-300000-stakeholder-batch` |
| 7 | **Doug Patterson** | `dpatterson` | `inv_d5761f42` | `dpatterson` | `[...]-32e3e141b1fb` | $150.00 | `2026-09-01` | `Completed` | `sept-2026-withdrawal-inv_d5761f42-15000-stakeholder-batch` |
| 8 | **Nancy Waite** | `nwaite` | `inv_d8b5ab06` | `nwaite` | `[...]-9057cf2977a9` | $7,000.00 | `2026-09-01` | `Completed` | `sept-2026-withdrawal-inv_d8b5ab06-700000-stakeholder-batch` |
| 9 | **Josh Stout** | `jstout` | `stout001` | `stout001` | `[...]-a92d5a3ee483` | $20,000.00 | `2026-09-01` | `Completed` | `sept-2026-withdrawal-stout001-2000000-stakeholder-batch` |
| 10 | **Blaine Ray** | `bray` | `inv_81b6661d` | `bray` | `[...]-e366c865db15` | $76,910.97 | `2026-09-01` | `Completed` | `sept-2026-withdrawal-inv_81b6661d-7691097-stakeholder-batch` |
| 11 | **Jeremy Evans** | `jevans` | `inv_6ba53bbe` | `jevans` | `[...]-2309831fd428` | $9,000.00 | `2026-09-01` | `Completed` | `sept-2026-withdrawal-inv_6ba53bbe-900000-stakeholder-batch` |

---

## 3. Total Cashflow Reconciliation

* **Expected Executed Total:** `$167,258.30`  
  $$\$5,000.00 + \$21,500.00 + \$21,000.00 + \$2,000.00 + \$1,697.33 + \$3,000.00 + \$150.00 + \$7,000.00 + \$20,000.00 + \$76,910.97 + \$9,000.00 = \$167,258.30$$
* **Actual Created Total:** `$167,258.30`
* **Net Variance:** **`$0.00`** (Cent-exact match)

---

## 4. Blocked Request Audit: Ted Boardwalk

* **Investor ID:** `inv_a79798ca`
* **Username:** `tboardwalk`
* **Requested Amount:** `$1,100.00`
* **August Ending Settled Balance:** `$384.56`
* **September 1 Available Withdrawal Equity:** `$384.56`
* **Overdraw Deficit:** `-$715.44`
* **Action:** **`BLOCKED_PENDING_STAKEHOLDER_CONFIRMATION`**
* **Invariants Preserved:**
  * Zero row created in `withdrawals` for Ted Boardwalk in September 2026.
  * Capital was not inflated or modified.
  * Fail-closed constraint prevented ledger insolvency.

---

## 5. Architectural & Ledger Invariant Protections

1. **Advisory Lock Concurrency Control:**  
   Every transaction acquired an exclusive transactional advisory lock via `financial_lock_key(p_investor_id)` before evaluating available equity or inserting rows.
2. **Economic Duplicate Prevention:**  
   The duplicate guard verified that no matching active transaction (`Pending`, `Approved`, `Completed`) with the same investor, effective date, and amount existed.
3. **Deterministic Idempotency:**  
   Re-running the execution script safely short-circuits via deterministic idempotency keys, guaranteeing that duplicate rows can never be generated on retry.
4. **Open-Month Cashflow Display Semantics:**  
   September withdrawals appear in the September ledger breakdown as completed cash deductions. Because September remains an open in-progress month, settled trading gain remains `$0.00 booked`.
5. **Historical Ledger Immutability:**  
   Zero rows in prior closed months (January through August 2026) were mutated.
6. **Isolated Boundary:**  
   No unrelated accounts (e.g., Scott Sire `ssire`, Jerry's Rogue Jets `jerrys`) or provenance records were modified.
