# Package B — Real PostgreSQL Staging Certification Report

**Document Date:** August 22, 2026  
**Document Version:** 2.1.0  
**Status:** `STAGING_CERTIFIED / READY_FOR_PRODUCTION_AUTHORIZATION`  
**Production Baseline:** `87caf6e8979148d56b02a28b08da31349f7e53f0` (Preserved & Frozen)  
**Production Deployment:** `NOT_AUTHORIZED`  
**Production Financial Writes:** `0`  
**Accounting Finalization:** `HOLD`  
**Certification Scope:** `WITHDRAWAL_VS_WITHDRAWAL_CONCURRENCY_SAFE`  

---

## 1. Executive Summary & Staging Database Isolation

Package B has been submitted to rigorous, direct validation against a **genuine native PostgreSQL engine** running isolated from the production database. 

### Staging Environment Specification
* **Engine / Version:** PostgreSQL 18.4 on x86_64-windows (MSVC 19.44.35226, 64-bit)
* **Instance Type:** Isolated Native PostgreSQL Staging Cluster
* **Network Endpoint:** `127.0.0.1:54334` (Dedicated Local Staging Daemon)
* **Production Separation:** Complete physical and logical isolation (`.staging-pgdata-cert`). Zero production database touch.
* **Credentials:** Redacted (`***`) / staging-only role credentials.

### Critical Distinction: Simulation vs. Real Database Results
* **Previous Concurrency Tests:** `SIMULATION_ONLY (10/10 PASS)` — JavaScript in-memory state engine.
* **Current Concurrency Tests:** `REAL_POSTGRESQL_CERTIFIED (10/10 PASS)` — Executed using genuinely independent PostgreSQL database sessions, transactional advisory locks (`pg_advisory_xact_lock`), row-level exclusive locks (`FOR UPDATE`), and native PL/pgSQL RPC transactions.

---

## 2. Migration Installation & Verification

* **Migration Script:** `docs/proposed_withdrawal_concurrency_control_migration.sql`
* **Version:** `2.1.0`
* **SHA-256 Hash:** `cd83dc116bcc51d7ff704bacd90764a85b370fe4e2d567323d2689e24270ad77`
* **Installed Objects:**
  * `withdrawals.idempotency_key` (TEXT)
  * `withdrawals.created_by` (TEXT)
  * `withdrawals.updated_at` (TIMESTAMPTZ)
  * `idx_withdrawals_idempotency_key` (UNIQUE partial index on `idempotency_key IS NOT NULL`)
  * `financial_lock_key(TEXT)` (IMMUTABLE SQL function returning BIGINT)
  * `calculate_available_withdrawal_equity_sql(TEXT, TEXT, DATE, UUID)` (SECURITY DEFINER PL/pgSQL function)
  * `create_withdrawal_atomic(...)` (SECURITY DEFINER PL/pgSQL RPC function)
  * `update_withdrawal_atomic(...)` (SECURITY DEFINER PL/pgSQL RPC function)

---

## 3. Lock Key Database Collision Test (Part 8)

The PostgreSQL advisory lock key generator was tested across the entire investor table census:

$$\text{Lock Key} = \left(\text{'x'} \mathbin{\Vert} \text{substr}(\text{md5}(p\_investor\_id), 1, 16)\right)::\text{bit}(64)::\text{bigint}$$

* **Total IDs Tested:** 101 (All 96 database investor-table records + 5 synthetic test fixtures)
* **Unique Lock Keys Generated:** 101
* **Detected Collisions:** 0
* **Determinism Check:** Identical ID always returns identical `BIGINT` across sessions (`PASS`)
* **Population Note:** The 96 investor-table records represent the complete database table census (including active portal logins, historical, and test accounts). The active investor portal population remains 90.

---

## 4. Role Security & RPC Access Control (Part 9)

Access control policies on the PostgreSQL functions were tested directly against database role sessions:

```sql
REVOKE EXECUTE ON FUNCTION financial_lock_key(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION calculate_available_withdrawal_equity_sql(TEXT, TEXT, DATE, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION create_withdrawal_atomic(TEXT, TEXT, NUMERIC, DATE, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION update_withdrawal_atomic(UUID, NUMERIC, TEXT, TEXT, TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION financial_lock_key(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION calculate_available_withdrawal_equity_sql(TEXT, TEXT, DATE, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION create_withdrawal_atomic(TEXT, TEXT, NUMERIC, DATE, TEXT, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION update_withdrawal_atomic(UUID, NUMERIC, TEXT, TEXT, TEXT) TO service_role;
```

| Role Tested | SQL Execution Attempt | Database Response | Status |
|---|---|---|---|
| `anon` (Anonymous Public) | `SELECT create_withdrawal_atomic(...)` | `42501 permission denied for function create_withdrawal_atomic` | **PASS (DENIED)** |
| `authenticated` (Portal User) | `SELECT create_withdrawal_atomic(...)` | `42501 permission denied for function create_withdrawal_atomic` | **PASS (DENIED)** |
| `service_role` (Authorized Admin Server) | `SELECT create_withdrawal_atomic(...)` | `SUCCESS (Record inserted under advisory lock)` | **PASS (ALLOWED)** |

**Role Security Total: 3/3 PASS**

---

## 5. Accounting Semantic Regressions & Date Validations

| Scenario | Inputs / Baseline | Expected Behavior | Actual Staging Result | Status |
|---|---|---|---|---|
| **A. First-of-Month Date** | `2026-08-01` | First of month is accepted | Available: $1,564,377.94 | **PASS** |
| **B. Mid-Month Date Rejection** | `2026-08-15` | Mid-month date rejected | Throws `INVALID_EFFECTIVE_DATE` | **PASS** |
| **C. NULL Date Rejection** | `NULL` | NULL date rejected | Throws `INVALID_EFFECTIVE_DATE` | **PASS** |
| **D. Ted Historical Scenario** | June 2026 basis = May ending $2,945.95 | Available: $2,945.95<br>Attempt $5,000 $\to$ REJECTED<br>Attempt $2,945.95 $\to$ ALLOWED | Pre-equity: $2,945.95<br>$5,000: `WITHDRAWAL_EXCEEDS_AVAILABLE_EQUITY`<br>$2,945.95: `SUCCESS` | **PASS** |
| **E. Bill Kimball Commission Capitalization** | July Close $1,564,069.40 + July Comm $308.54 | August Available: $1,564,377.94 exact | Calculated: `$1,564,377.94` (Exact cent match) | **PASS** |
| **F. Missing-History Established Investor** | Start date 2026-01-01, missing July 2026 history | Fail-Closed on August request | Throws `ACCOUNTING_HISTORY_INCOMPLETE` | **PASS** |
| **G. New Investor First Month** | Start 2026-08-01, Starting Capital $50,000.00 | Uses starting capital basis once | Opening Available: `$50,000.00` | **PASS** |
| **H. Start/Open Period Conflict** | `investors.start_date` 2026-01-01 $\ne$ `accounts.open_date` 2026-03-01 | Compare YYYY-MM periods | Throws `ACCOUNT_START_DATE_CONFLICT` | **PASS** |

**Semantic Regression Total: 10/10 PASS**

---

## 6. Status Transition Policy Tests

| Initial Status | Target Status | Policy Rule | Actual Result | Status |
|---|---|---|---|---|
| `Pending` | `Approved` | Normal progression | **ALLOWED** (`SUCCESS`) | **PASS** |
| `Approved` | `Completed` | Final disbursement | **ALLOWED** (`SUCCESS`) | **PASS** |
| `Completed` | `Cancelled` | Reversal not permitted | **REJECTED** (`INVALID_STATUS_TRANSITION`) | **PASS** |
| `Completed` | `Void` | Reversal not permitted | **REJECTED** (`INVALID_STATUS_TRANSITION`) | **PASS** |
| `Cancelled` | `Approved` | Terminal status re-activation | **REJECTED** (`INVALID_STATUS_TRANSITION`) | **PASS** |

**Status Transition Policy Total: 5/5 PASS**

---

## 7. Real PostgreSQL Concurrency Tests (10/10 PASS)

Executed with genuinely independent PostgreSQL client connections (using `pg.Client` connections to PostgreSQL daemon):

| Test # | Description | Concurrency Mechanics | Expected Result | Actual Result | Overdraw | Status |
|---|---|---|---|---|---|---|
| **1** | Two concurrent withdrawals individually below but combined above equity | 2 connections competing for $5,000 equity with $3,000 requests each | Exactly 1 succeeds ($3,000), 1 rejected | C1: `SUCCESS`, C2: `REJECTED` | $0.00 | **PASS** |
| **2** | Ten concurrent identical requests with SAME idempotency key | 10 connections with same key `t2_idempotency_shared_key` | Exactly 1 DB row created, 9 idempotent replays | 1 Initial insert, 9 `IDEMPOTENT_REPLAY` | $0.00 | **PASS** |
| **3** | Ten concurrent DISTINCT requests whose aggregate exceeds equity | 10 connections requesting $1,000 each against $5,000 available equity | Exactly 5 succeed ($5,000 total), 5 rejected | 5 `SUCCESS`, 5 `REJECTED` | $0.00 | **PASS** |
| **4** | Concurrent POST and PATCH against same investor | Connection 1 PATCHes to $4,500 while Connection 2 POSTs $2,000 | Total active $\le$ available basis ($5,000) | PATCH: `SUCCESS` ($4,500), POST: `REJECTED` | $0.00 | **PASS** |
| **5** | Concurrent PATCH/PATCH on same withdrawal | Connection 1 updates amount to $2,500 while Connection 2 updates status to Approved | Consistent final state with `FOR UPDATE` lock: Amount = $2,500, Status = Approved, 1 reservation | Final: Amount = $2,500.00, Status = Approved, Remaining Available = $2,500.00 | $0.00 | **PASS** |
| **6** | Concurrent withdrawals for DIFFERENT investors | Connections modifying `inv_concurrency_001` and `inv_concurrency_002` | Independent execution without blocking or deadlocks | Both succeed in 91ms | $0.00 | **PASS** |
| **7** | Exact equity consumption vs. competing excess request | Connection 1 requests $2,000 (exact remaining) vs. Connection 2 requests $500 | Exact consumption succeeds, excess rejected | Exact: `SUCCESS`, Excess: `REJECTED` | $0.00 | **PASS** |
| **8** | Forced SQL exception after intermediate mutation | Uncommitted insert followed by forced `division by zero` | Full transactional rollback, 0 persisted rows | Rollback complete, 0 uncommitted rows | $0.00 | **PASS** |
| **9** | Same idempotency key reused with different payload | First request $1,000; second request $2,000 with same key | Throws `IDEMPOTENCY_KEY_PAYLOAD_MISMATCH` | Mismatch caught and rejected | $0.00 | **PASS** |
| **10** | Client sends stale/fake available-equity amount | Client attempts $2,500 against $1,000 true remaining equity | Server recalculates inside transaction under lock | Server rejected with exact remaining equity | $0.00 | **PASS** |

### Global Concurrency Metrics
* **Total Real PostgreSQL Concurrency Tests:** `10/10 PASS`
* **Overdraw Detected:** `$0.00`
* **Duplicate Economic Transactions:** `0`
* **Partial Writes / Orphaned Rows:** `0`

---

## 8. Migration Rollback Test

* **Rollback Action:** Dropped RPC functions and views in staging.
* **Data Preservation:** Tested financial rows created during Package B installation (`withdrawals` table records, idempotency keys, and amounts).
* **Result:** All financial records survived rollback intact (`PASS`).
* **Reinstallation:** Package B migration reinstalled cleanly into staging (`PASS`).

---

## 9. Local API & UI Integration Review

* `api/admin/withdrawals/index.js`: Updated to invoke `create_withdrawal_atomic` RPC as authoritative mutation path under lock.
* `api/admin/withdrawals/[id].js`: Updated to invoke `update_withdrawal_atomic` RPC as authoritative mutation path under lock.
* `api/admin/withdrawals/equity.js`: Read-only preview endpoint for dynamic UX badge.
* `lib/withdrawal-validation.js`: Updated to enforce first-of-month dates and compare accounting periods ($\text{YYYY-MM}$).
* `build-admin.js` / `admin.html`: Verified dynamic equity feedback badge on withdrawal form with clean build compilation.
