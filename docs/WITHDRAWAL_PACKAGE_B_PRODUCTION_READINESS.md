# Package B — Final Production-Readiness & Preflight Review

**Document Date:** August 22, 2026  
**Document Version:** 2.1.0  
**Status:** `READY_FOR_PRODUCTION_AUTHORIZATION`  
**Production Baseline:** `87caf6e8979148d56b02a28b08da31349f7e53f0` (Preserved & Frozen)  
**Production Deployment:** `NOT_AUTHORIZED (Awaiting Explicit User Command)`  
**Production Financial Writes:** `0`  
**Accounting Finalization:** `HOLD`  
**Certification Scope:** `WITHDRAWAL_VS_WITHDRAWAL_CONCURRENCY_SAFE`  

---

## 1. Certified Migration Specification

* **Migration File:** `docs/proposed_withdrawal_concurrency_control_migration.sql`
* **Version:** `2.1.0`
* **SHA-256 Hash:** `cd83dc116bcc51d7ff704bacd90764a85b370fe4e2d567323d2689e24270ad77`
* **Real PostgreSQL 18.4 Staging Test Results:**
  * Lock-Key Collision Test: `101/101 IDs tested -> 0 collisions (PASS)`
  * Security Access Control: `3/3 PASS (anon DENIED, authenticated DENIED, service_role ALLOWED)`
  * Effective Date Validation: `10/10 PASS (first-of-month accepted, mid-month rejected, NULL rejected)`
  * Accounting Semantics: `PASS (Bill Kimball $1,564,377.94 exact, Ted $2,945.95 basis / $5k rejected)`
  * Status Transition Policy: `5/5 PASS (Pending->Approved ALLOWED, Approved->Completed ALLOWED, Completed/Cancelled/Void reversal REJECTED)`
  * Real PostgreSQL Concurrency Suite: `10/10 PASS`
  * Global Overdraw: `$0.00`
  * Duplicate Economic Transactions: `0`
  * Partial Writes / Orphaned Rows: `0`
  * Migration Rollback Test: `PASS`

---

## 2. Exact Application File Scope

The following application files constitute the exact, frozen Package B release:

1. `docs/proposed_withdrawal_concurrency_control_migration.sql` (Authoritative database migration)
2. `api/admin/withdrawals/index.js` (POST handler invoking `create_withdrawal_atomic` RPC under lock)
3. `api/admin/withdrawals/[id].js` (PATCH handler invoking `update_withdrawal_atomic` RPC under lock)
4. `api/admin/withdrawals/equity.js` (Read-only GET advisory available equity preview endpoint)
5. `lib/withdrawal-validation.js` (Fail-closed equity calculation logic and date format validation)
6. `build-admin.js` (Admin dashboard generator with live equity feedback UX badge)
7. `admin.html` (Compiled dynamic admin interface)

*Unrelated Changes Excluded:* Zero changes to Package A UI, zero changes to financial history or figures, zero graph changes, zero Jeannine corrections, zero test scratch files in deployment scope.

---

## 3. Production Migration Preflight Checks (Phase A)

Before applying the migration in production, the following read-only preflight queries must be executed:

```sql
-- 1. Check existing withdrawals row count and status distribution
SELECT status, COUNT(*) as count, SUM(amount) as total_amount
FROM withdrawals
GROUP BY status;

-- 2. Verify if idempotency_key column already exists
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'withdrawals' AND column_name IN ('idempotency_key', 'created_by', 'updated_at');

-- 3. Check for any pre-existing duplicate or non-null idempotency keys
SELECT idempotency_key, COUNT(*)
FROM withdrawals
WHERE idempotency_key IS NOT NULL
GROUP BY idempotency_key
HAVING COUNT(*) > 1;

-- 4. Check for existing functions with colliding names
SELECT routine_name, routine_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN ('financial_lock_key', 'calculate_available_withdrawal_equity_sql', 'create_withdrawal_atomic', 'update_withdrawal_atomic');

-- 5. Check existing table grants on withdrawals
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_name = 'withdrawals';
```

---

## 4. Two-Phase Production Deployment Order

Deployment must follow a strict two-phase sequential order:

```mermaid
graph TD
    A[Start Deployment] --> B[Phase A: Apply SQL Migration to Supabase DB]
    B --> C{Verify Migration Preflight & Hash}
    C -- Failed --> D[STOP - Rollback DB Migration / Do Not Deploy App]
    C -- Succeeded --> E[Phase B: Deploy Application / API to Vercel]
    E --> F[Run Non-Mutating Production Health Check]
    F --> G[Production Package B Active]
```

### Phase A: Database Migration Installation
1. Execute `docs/proposed_withdrawal_concurrency_control_migration.sql` against the production Supabase PostgreSQL instance using the Supabase SQL Editor or CLI migration runner.
2. Verify that functions `create_withdrawal_atomic`, `update_withdrawal_atomic`, `calculate_available_withdrawal_equity_sql`, and `financial_lock_key` exist and are owned by `postgres`.
3. Verify that index `idx_withdrawals_idempotency_key` is created.
4. Verify that execution permissions are strictly revoked from `PUBLIC`, `anon`, and `authenticated`, and granted to `service_role`.
5. Verify that all pre-existing rows in `withdrawals` remain intact.

### Phase B: Application & Admin Release
1. Deploy the tested application code (`api/admin/withdrawals/*`, `lib/withdrawal-validation.js`, `build-admin.js`, `admin.html`) to Vercel production.
2. Perform non-mutating smoke checks:
   - Verify `GET /api/admin/withdrawals` returns existing records.
   - Verify `GET /api/admin/withdrawals/equity?investorId=inv_57a1a49a` returns correct available equity preview.
3. *Strict Constraint:* Do not create synthetic financial mutations against real investor accounts to test deployment.

---

## 5. HTTP Error Contract & Status Code Mapping

| Database Exception / Condition | HTTP Status | Response Payload | Description |
|---|---|---|---|
| `WITHDRAWAL_EXCEEDS_AVAILABLE_EQUITY` | `400 Bad Request` | `{"error": "WITHDRAWAL_EXCEEDS_AVAILABLE_EQUITY: ..."}` | Requested amount exceeds available equity |
| `INVALID_EFFECTIVE_DATE` | `400 Bad Request` | `{"error": "INVALID_EFFECTIVE_DATE: ..."}` | Date is not formatted as first-of-month (`YYYY-MM-01`) |
| `INVALID_AMOUNT` | `400 Bad Request` | `{"error": "INVALID_AMOUNT: ..."}` | Amount $\le 0.00$ or non-numeric |
| `INVALID_WITHDRAWAL_STATUS` | `400 Bad Request` | `{"error": "INVALID_WITHDRAWAL_STATUS: ..."}` | Unrecognized status string |
| `INVALID_STATUS_TRANSITION` | `400 Bad Request` | `{"error": "INVALID_STATUS_TRANSITION: ..."}` | Illegal status progression (e.g. Completed $\to$ Cancelled) |
| `ACCOUNTING_HISTORY_INCOMPLETE` | `409 Conflict` | `{"error": "ACCOUNTING_HISTORY_INCOMPLETE: ..."}` | Established investor missing prior month history |
| `ACCOUNT_START_DATE_CONFLICT` | `409 Conflict` | `{"error": "ACCOUNT_START_DATE_CONFLICT: ..."}` | Mismatch between investor start and account open periods |
| `IDEMPOTENCY_KEY_PAYLOAD_MISMATCH` | `409 Conflict` | `{"error": "IDEMPOTENCY_KEY_PAYLOAD_MISMATCH: ..."}` | Reused idempotency key with different financial parameters |
| `INVESTOR_NOT_FOUND` | `404 Not Found` | `{"error": "INVESTOR_NOT_FOUND: ..."}` | Investor ID does not exist |
| `WITHDRAWAL_NOT_FOUND` | `404 Not Found` | `{"error": "WITHDRAWAL_NOT_FOUND: ..."}` | Target withdrawal ID does not exist |
| Idempotent Replay | `200 OK` | `{"status": "IDEMPOTENT_REPLAY", "idempotency_replay": true, ...}` | Safe replay of identical request |
| Successful Creation | `201 Created` | `{"status": "SUCCESS", "idempotency_replay": false, ...}` | Record created under lock |

---

## 6. Rollback Plan

### Application Rollback
- Revert the production deployment in Vercel to commit `87caf6e8979148d56b02a28b08da31349f7e53f0`.

### Database Rollback
- In the event of an RPC defect, disable RPC execution by executing:
  ```sql
  REVOKE EXECUTE ON FUNCTION create_withdrawal_atomic(TEXT, TEXT, NUMERIC, DATE, TEXT, TEXT, TEXT, TEXT) FROM service_role;
  REVOKE EXECUTE ON FUNCTION update_withdrawal_atomic(UUID, NUMERIC, TEXT, TEXT, TEXT) FROM service_role;
  ```
- **Data Protection Guarantee:** Do NOT drop columns (`idempotency_key`, `created_by`, `updated_at`) or delete withdrawal records created during active operation.

---

## 7. Known Architectural Scope Boundary

> [!IMPORTANT]
> **Scope Certification Notice:**  
> Package B is strictly certified as `WITHDRAWAL_VS_WITHDRAWAL_CONCURRENCY_SAFE`.  
> It guarantees that concurrent withdrawal creates and updates cannot overdraw available equity or create duplicate transactions.  
> Cross-mutation concurrency locking (e.g. concurrent Deposits vs. Withdrawals, concurrent Monthly Accounting Finalization vs. Withdrawals) utilizes the same `financial_lock_key(investor_id)` contract but will be certified in future packages when those subsystems are migrated to in-database RPC boundaries.
