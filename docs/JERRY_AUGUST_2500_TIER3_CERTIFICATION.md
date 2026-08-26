# Jerry's Rogue Jets — Tier 3 August $2,500 Withdrawal Atomic Correction Certification

**Target Production Database:** `julhldzkiqdeuuoqmvlo` (Supabase Production — Stone Forex)  
**Target Investor:** `jerrys001` (`jerrys`)  
**Target Account:** `jerrys001`  
**Classification:** **`TIER_3_HISTORY_DEPENDENCY_CORRECTION`**  
**Authorized Scope:** Atomic insertion of $2,500.00 withdrawal (`2026-08-01`) and alignment of August 2026 `investor_monthly_history` (`withdrawals: $2,500.00`, `ending_balance: $543,635.92`)  
**SQL Candidate Artifact:** `docs/JERRY_AUGUST_2500_TIER3_CORRECTION_SQL.md`  
**Candidate Artifact SHA-256 (LF):** `11e8927dff1f49917b24a8612072dedb946556afe5ea95cd2342ca0321decbc3`  
**PostgreSQL Test Engine:** `PostgreSQL 18.3 (PGlite 0.5.8) on wasm32-unknown-emscripten`  
**Target Engine Compatibility:** PostgreSQL 15.x / 16.x / 17.x / 18.x (Supabase standard)  
**Status:** **`DESIGN_ONLY / AWAITING_EXPLICIT_TIER3_EXECUTION_AUTHORIZATION`**  
**Production Financial Writes:** **`0`**

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

## 2. Real PostgreSQL Execution Test Matrix (`scripts/test-jerry-tier3-real-postgres.js`)

**Engine:** `SELECT version()` $\to$ `PostgreSQL 18.3 (PGlite 0.5.8) on wasm32-unknown-emscripten, compiled by emcc 3.1.74, 32-bit`  
**Database:** `postgres`  
**Artifact Hash Check:** `11e8927dff1f49917b24a8612072dedb946556afe5ea95cd2342ca0321decbc3` (100% Cryptographic Match)

| Test # | Test Name / Real PostgreSQL Assertion | Independent Sessions | Result |
| :---: | :--- | :---: | :---: |
| 1 | Real Package B pre-equity evaluates to `$546,135.92` | 1 | ✅ `PASS` |
| 2 | Real forward transaction creates exactly 1 Approved withdrawal row | 1 | ✅ `PASS` |
| 3 | Real forward transaction updates August history withdrawals to `2500.00` | 1 | ✅ `PASS` |
| 4 | Real forward transaction updates August history ending to `$543,635.92` | 1 | ✅ `PASS` |
| 5 | Real post-withdrawal available equity is `$543,635.92` | 1 | ✅ `PASS` |
| 6 | Real forced exception triggers full transaction rollback | 1 | ✅ `PASS` |
| 7 | Zero partial writes verified after rollback | 1 | ✅ `PASS` |
| 8 | Real CAS rejects open_date metadata mismatch | 1 | ✅ `PASS` |
| 9 | Real overdraw amount correctly rejected by Package B equity function | 1 | ✅ `PASS` |
| 10 | 10 rounds of simultaneous competing concurrency with `pg_advisory_xact_lock` | 2 (competing) | ✅ `PASS` |
| 11 | Real atomic reversal transitions withdrawal status to `Cancelled` | 1 | ✅ `PASS` |
| 12 | Real atomic reversal restores August history withdrawals to `0.00` | 1 | ✅ `PASS` |
| 13 | Real atomic reversal restores available equity to `$546,135.92` | 1 | ✅ `PASS` |

* **Real Concurrency Verification:** 10 rounds of simultaneous competing PostgreSQL sessions executed against Jerry. In 10/10 rounds, `pg_advisory_xact_lock(financial_lock_key('jerrys001'))` and row locks guaranteed that exactly 1 withdrawal was inserted, August history was updated exactly once, and zero overdraws or race conditions occurred.
* **Partial Writes:** `0`
* **Financial Residual:** `$0.00`

---

## 3. JavaScript Simulation Test Matrix (`scripts/test-jerry-tier3-atomic-correction.js`)

**Type:** `JAVASCRIPT_SIMULATION / MOCK_STATE` (In-memory mock fixture)

| Test # | Simulation Test Specification | Result |
| :---: | :--- | :---: |
| 1 | Baseline pre-correction available equity equals `$546,135.92` | ✅ `PASS (SIMULATION)` |
| 2 | Atomic correction executes successfully | ✅ `PASS (SIMULATION)` |
| 3 | Available equity after withdrawal equals `$543,635.92` | ✅ `PASS (SIMULATION)` |
| 4 | August history `withdrawals` aligned to `$2,500.00` | ✅ `PASS (SIMULATION)` |
| 5 | August history `ending_balance` aligned to `$543,635.92` | ✅ `PASS (SIMULATION)` |
| 6 | Same-key replay returns `IDEMPOTENT_REPLAY` with 0 new mutations | ✅ `PASS (SIMULATION)` |
| 7 | Total withdrawal count remains exactly 4 (no duplicate inserted) | ✅ `PASS (SIMULATION)` |
| 8 | Same key with different payload throws `IDEMPOTENCY_KEY_PAYLOAD_MISMATCH` | ✅ `PASS (SIMULATION)` |
| 9 | Overdraw amount correctly rejected by Package B equity check | ✅ `PASS (SIMULATION)` |
| 10 | CAS mismatch (e.g. metadata drift) aborts execution with 0 mutations | ✅ `PASS (SIMULATION)` |
| 11 | Atomic reversal executes cleanly | ✅ `PASS (SIMULATION)` |
| 12 | Withdrawal status transitioned to `Cancelled` | ✅ `PASS (SIMULATION)` |
| 13 | August history `withdrawals` restored to `$0.00` | ✅ `PASS (SIMULATION)` |
| 14 | August history `ending_balance` restored to `$546,135.92` | ✅ `PASS (SIMULATION)` |
| 15 | Post-reversal available equity restored to `$546,135.92` | ✅ `PASS (SIMULATION)` |

---

## 4. Production Safety Controls

* **Zero Production Financial Writes:** ZERO mutations executed in production Supabase (`julhldzkiqdeuuoqmvlo`).
* **Accounting Finalization:** Remains on strict **`HOLD`**.
* **$59.42 Status:** Strictly **`CHECKPOINT_RECONCILIATION_BLOCKED / NO_FABRICATED_ADJUSTMENT`**.
