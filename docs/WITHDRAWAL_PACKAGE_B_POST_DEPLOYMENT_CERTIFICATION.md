# Package B — Post-Deployment Production Certification Report

**Document Date:** August 26, 2026  
**Document Version:** 3.1.0  
**Status:** **`PRODUCTION_RESTORED_AND_VERIFIED`**  
**Production Supabase Project:** `julhldzkiqdeuuoqmvlo` (`https://4xtrack.com`)  
**Production Schema Mutations:** `PACKAGE_B_INSTALLATION_EXECUTED`  
**Production Financial-Data Mutations During Restoration:** `0`  
**Restoration Financial Delta:** `$0.00`  
**Certified Concurrency Boundary:** `WITHDRAWAL_VS_WITHDRAWAL_CONCURRENCY_SAFE`  
**Pre-Install Fingerprint:** `db1eb2afda4b313f4a2afe7744088e1e`  
**Post-Install Fingerprint:** `db1eb2afda4b313f4a2afe7744088e1e` (100% Cryptographic Match)  
**Kyle Landon Read-Only Control:** `$75,000.00` (Verified on live production database)

---

## 1. Audit Trail & Restoration History

1. **Initial Deployment Invalidation (August 26, 2026):**  
   Direct Supabase SQL inspection against project `julhldzkiqdeuuoqmvlo` revealed that while the Vercel application layer had been updated, the PostgreSQL DDL migration had not been executed in the live database (`calculate_available_withdrawal_equity_sql` threw `ERROR 42883: function does not exist`). Status was downgraded to `INVALIDATED_PENDING_RECONCILIATION`.
2. **Application Remediation & Deletion Disabling:**  
   Physical deletion of withdrawal records was disabled across all routes (`405 Method Not Allowed`). Application fallbacks were removed in favor of strict fail-closed responses (`503 PACKAGE_B_RPC_UNAVAILABLE`), and investor account deletion was protected against ledger cascade destruction (`409 Conflict`).
3. **Canonical Migration Restoration:**  
   The canonical migration script (`docs/proposed_withdrawal_concurrency_control_migration.sql`) was executed in the production Supabase SQL Editor. 
4. **Economic Fingerprint Verification:**  
   Cryptographic pre/post fingerprints across all 72 historical withdrawal rows verified a zero-byte financial delta (`$0.00` financial mutation).

---

## 2. Installed Database Objects

| Object Name | Type | Definition / Specification | Status | Role Permissions |
| :--- | :--- | :--- | :---: | :--- |
| `withdrawals.idempotency_key` | Column | `TEXT`, nullable | ✅ PRESENT | service_role |
| `withdrawals.created_by` | Column | `TEXT`, nullable | ✅ PRESENT | service_role |
| `withdrawals.updated_at` | Column | `TIMESTAMPTZ`, default `NOW()` | ✅ PRESENT | service_role |
| `idx_withdrawals_idempotency_key` | Partial Unique Index | `UNIQUE (idempotency_key) WHERE idempotency_key IS NOT NULL` | ✅ PRESENT | service_role |
| `financial_lock_key` | Function (IMMUTABLE SQL) | `(p_investor_id TEXT) RETURNS BIGINT` | ✅ PRESENT | Revoked `PUBLIC`, Granted `service_role` |
| `calculate_available_withdrawal_equity_sql` | Function (SECURITY DEFINER) | `(p_investor_id TEXT, p_account_id TEXT, p_effective_date DATE, p_exclude_withdrawal_id TEXT) RETURNS NUMERIC(20,2)` | ✅ PRESENT | Revoked `PUBLIC`, Granted `service_role` |
| `create_withdrawal_atomic` | Function (SECURITY DEFINER) | `(p_investor_id TEXT, p_account_id TEXT, p_amount NUMERIC, p_effective_date DATE, p_status TEXT, p_notes TEXT, p_idempotency_key TEXT, p_created_by TEXT) RETURNS JSONB` | ✅ PRESENT | Revoked `PUBLIC`, Granted `service_role` |
| `update_withdrawal_atomic` | Function (SECURITY DEFINER) | `(p_withdrawal_id TEXT, p_amount NUMERIC, p_status TEXT, p_notes TEXT, p_updated_by TEXT) RETURNS JSONB` | ✅ PRESENT | Revoked `PUBLIC`, Granted `service_role` |

---

## 3. Application Deployment & Control Status

| Control Layer | Evidence Level | Verification Status |
| :--- | :--- | :---: |
| **Withdrawal Physical DELETE Route** | Live Production Behavior | ✅ `PROVEN_DISABLED` (Returns `405 Method Not Allowed`) |
| **Missing-RPC POST Fail-Closed** | Repository & Test Suite | ✅ `PROVEN` (`scripts/test-withdrawal-delete-and-fallback.js` Case 2) |
| **Missing-RPC PATCH Fail-Closed** | Repository & Test Suite | ✅ `PROVEN` (`scripts/test-withdrawal-delete-and-fallback.js` Case 3) |
| **Missing-RPC Cancel Fail-Closed** | Repository & Test Suite | ✅ `PROVEN` (`scripts/test-withdrawal-delete-and-fallback.js` Case 4) |
| **Investor Ledger Cascade Protection** | Repository & Test Suite | ✅ `PROVEN` (`scripts/test-withdrawal-delete-and-fallback.js` Case 9) |
| **Exact Vercel Source Commit** | Deployment Metadata | `UNPROVEN` (Vercel deployment metadata API requires authorized token) |

---

## 4. Current Entity & Financial Control States

* **Package B Concurrency Controls:** `PRODUCTION_RESTORED_AND_VERIFIED`
* **Kyle Landon (`inv_835ffffd`):** `VERIFIED_COMPLETE` (Available Equity: `$75,000.00`, Zero Financial Mutations)
* **Jerry's Rogue Jets (`jerrys001`):** `READY_FOR_START_OPEN_PROVENANCE_REVIEW` (Withdrawal Execution: `NOT_AUTHORIZED`)
* **Accounting Finalization:** `HOLD`
* **Client Acceptance:** `NOT_COMPLETE_CLIENT_ACCEPTANCE_PENDING`
