# Jerry's Rogue Jets — Tier 3 August $2,500 Withdrawal Atomic Correction Certification

**Target Database:** `julhldzkiqdeuuoqmvlo` (Supabase Production — Stone Forex)  
**Target Investor:** `jerrys001` (`jerrys`)  
**Target Account:** `jerrys001`  
**Classification:** **`TIER_3_HISTORY_DEPENDENCY_CORRECTION`**  
**Authorized Scope:** Atomic insertion of $2,500.00 withdrawal (`2026-08-01`) and alignment of August 2026 `investor_monthly_history` (`withdrawals: $2,500.00`, `ending_balance: $543,635.92`)  
**SQL Artifact:** `docs/JERRY_AUGUST_2500_TIER3_CORRECTION_SQL.md`  
**Artifact SHA-256 (LF):** `11e8927dff1f49917b24a8612072dedb946556afe5ea95cd2342ca0321decbc3`  
**PostgreSQL Version Compatibility:** PostgreSQL 15.x / 16.x (Supabase standard)  
**Test Suite:** `scripts/test-jerry-tier3-atomic-correction.js` (15/15 PASS)  
**Status:** **`DESIGN_ONLY / AWAITING_EXPLICIT_TIER3_EXECUTION_AUTHORIZATION`**

---

## 1. Executive Summary & Period Control Matrix

| Period Metric | Pre-Correction State | Proposed Delta | Post-Correction State |
| :--- | :--- | :--- | :--- |
| **August Opening Balance** | `$546,135.9207866621` | `$0.00` | `$546,135.9207866621` |
| **August Eligible Deposits** | `$0.00` | `$0.00` | `$0.00` |
| **July Capitalized Incoming Commissions** | `$0.00` | `$0.00` | `$0.00` |
| **August Withdrawals** | `$0.00` | `+$2,500.00` | **`$2,500.00`** |
| **August Gross Return %** | `0.00%` (Open) | `0.00%` | `0.00%` (Open) |
| **August Net Trading Gain** | `$0.00` | `$0.00` | `$0.00` |
| **August Ending Balance** | `$546,135.9207866621` | `-$2,500.00` | **`$543,635.9207866621`** |
| **Package B Available Equity** | `$546,135.92` | `-$2,500.00` | **`$543,635.92`** |
| **Accounting Residual** | — | — | **`$0.00`** |

---

## 2. Test Suite Results (`scripts/test-jerry-tier3-atomic-correction.js`)

| Test # | Test Name / Specification | Result |
| :---: | :--- | :---: |
| 1 | Baseline pre-correction available equity equals `$546,135.92` | ✅ `PASS` |
| 2 | Atomic correction executes successfully | ✅ `PASS` |
| 3 | Available equity after withdrawal equals `$543,635.92` | ✅ `PASS` |
| 4 | August history `withdrawals` aligned to `$2,500.00` | ✅ `PASS` |
| 5 | August history `ending_balance` aligned to `$543,635.92` | ✅ `PASS` |
| 6 | Same-key replay returns `IDEMPOTENT_REPLAY` with 0 new mutations | ✅ `PASS` |
| 7 | Total withdrawal count remains exactly 4 (no duplicate inserted) | ✅ `PASS` |
| 8 | Same key with different payload throws `IDEMPOTENCY_KEY_PAYLOAD_MISMATCH` | ✅ `PASS` |
| 9 | Overdraw amount correctly rejected by Package B equity check | ✅ `PASS` |
| 10 | CAS mismatch (e.g. metadata drift) aborts execution with 0 mutations | ✅ `PASS` |
| 11 | Atomic reversal executes cleanly | ✅ `PASS` |
| 12 | Withdrawal status transitioned to `Cancelled` | ✅ `PASS` |
| 13 | August history `withdrawals` restored to `$0.00` | ✅ `PASS` |
| 14 | August history `ending_balance` restored to `$546,135.92` | ✅ `PASS` |
| 15 | Post-reversal available equity restored to `$546,135.92` | ✅ `PASS` |

---

## 3. Concurrency & Reversal Architecture

* **Mutual Exclusion:**  
  Enforced via `pg_advisory_xact_lock(financial_lock_key('jerrys001'))` and row-level locks on `investors`, `investor_accounts`, and `investor_monthly_history`.
* **Zero Partial Writes:**  
  The dual-table mutation (`withdrawals` INSERT and `investor_monthly_history` UPDATE) is wrapped in a single transactional DO block. Any constraint or CAS failure triggers an immediate abort.
* **Auditable Reversal:**  
  Physical deletion is disabled. The atomic reversal script transitions the withdrawal to `Cancelled` while restoring the August history row (`withdrawals = 0.00`, `ending_balance = $546,135.92`).
