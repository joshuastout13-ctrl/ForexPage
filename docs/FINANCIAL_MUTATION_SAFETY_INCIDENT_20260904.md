# Financial Mutation Safety Incident Report: Jerry's Rogue Jets August 2026 Duplicate Withdrawal

**Date of Incident:** September 4, 2026  
**Incident Severity:** P0 (Financial Ledger Mutation Safety & Concurrency Control)  
**Target Entity:** Jerry / Jerry's Rogue Jets (`investor_id`: `jerrys001`)  
**Affected Table:** `public.withdrawals`  
**Authoritative Production Project ID:** `julhldzkiqdeuuoqmvlo`  
**Status:** Remediated (Production Ledger Restored & Certified Correct; Hardening Controls Implemented)

---

## 1. Executive Summary

During an authorized financial ledger reconciliation task for Jerry's Rogue Jets (`jerrys001`), an automated preflight audit incorrectly determined that Jerry's August 2026 ($2,500.00) withdrawal was absent from production. This conclusion was reached because the audit tooling executed without valid production Supabase credentials and silently fell back to reading a stale/secondary Google Sheets data source, which lacked the August withdrawal record.

In reality, authoritative production database `julhldzkiqdeuuoqmvlo` had already contained the August withdrawal (`wd_jerrys_20260801_d00164e8`, $2,500.00, Approved) continuously since August 27, 2026.

Operating under the false assumption of absence, the agent created a duplicate August withdrawal (`wd_feaa5056`, $2,500.00). Upon detecting that August withdrawals now totaled $5,000.00 rather than $2,500.00, the duplicate row was physically deleted via SQL `DELETE`.

Although the production database active ledger was promptly restored to its true, certified state (4 active monthly withdrawals of $2,500.00 each for May, June, July, August = $10,000.00 total; settled balance `$551,657.29`), the event exposed critical structural defects in mutation authorization, fallback semantics, duplicate prevention, and deletion auditability.

---

## 2. Chronological Timeline of Financial Records

| Timestamp | Record ID | Type / Month | Amount | Status | Description / Event |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Historical** | `wd_5614f2b2` | May 2026 (2026-05-01) | $2,500.00 | Approved | Normal monthly distribution. |
| **Historical** | `wd_2eeb5318` | Prototype (2026-05-01) | $7,500.00 | Cancelled | Prototype test record, excluded from ledger. |
| **Historical** | `wd_e380829e` | July 2026 (2026-07-01) | $2,500.00 | Approved | Normal monthly distribution. |
| **2026-08-27** | `wd_jerrys_20260801_d00164e8` | Aug 2026 (2026-08-01) | $2,500.00 | Approved | Inserted into production Supabase on August 27 (`commit 9189580`). Present continuously. |
| **2026-09-04 12:40 UTC** | N/A | Preflight Audit | N/A | Failure | Preflight ran without Supabase env keys; silently fell back to Google Sheets. Reported August withdrawal MISSING. |
| **2026-09-04 12:47 UTC** | `wd_a9234ba4` | June 2026 (2026-06-01) | $2,500.00 | Approved | Created via `create_withdrawal_atomic`. Legitimate missing withdrawal. |
| **2026-09-04 12:48 UTC** | `wd_feaa5056` | Aug 2026 (2026-08-01) | $2,500.00 | Approved | **DUPLICATE CREATED** via `create_withdrawal_atomic` with a generated non-deterministic key. |
| **2026-09-04 13:00 UTC** | `wd_feaa5056` | Aug 2026 (2026-08-01) | $2,500.00 | Deleted | **PHYSICALLY DELETED** via SQL `DELETE` to restore Jerry's August withdrawal sum to $2,500.00. |
| **2026-09-04 13:10 UTC** | Final State | Active Ledger | $10,000.00 | Certified | Exactly 4 rows: `wd_5614f2b2`, `wd_a9234ba4`, `wd_e380829e`, `wd_jerrys_20260801_d00164e8`. Settled balance: `$551,657.29`. |

---

## 3. Root Cause Analysis (RCA)

### 3.1. Process Defect: Fallback Data Received Mutation Authorization Authority
The core failure occurred in the data-layer fallback design. In `lib/dashboard.js` and standalone audit scripts, when `process.env.DATA_SOURCE !== "supabase"` or when Supabase credentials were not loaded into the local shell process, the system automatically fell back to Google Sheets. Because Google Sheets was maintained independently and lacked the August 27 Supabase insert, the absence of the withdrawal in Google Sheets was interpreted by tooling as proof of absence in production.

**Principle Violated:** Proof of absence in a non-authoritative fallback data source must NEVER authorize a mutation to authoritative production data.

### 3.2. RPC Defect: Concurrency RPC Lacked Economic Duplicate Detection
`create_withdrawal_atomic` enforced:
1. Investor transactional advisory locks (`financial_lock_key`).
2. Exact idempotency key match (`idempotency_key = p_idempotency_key`).
3. Equity constraint validation (`amount <= available_equity`).

However, because the caller supplied a newly generated idempotency key and Jerry had over $500,000.00 in equity, the RPC had no logic to question why a second $2,500.00 withdrawal was being created for the exact same investor on the exact same effective date (`2026-08-01`).

**Principle Violated:** Database mutation functions must guard against economic duplicates, even when caller preflight fails or provides fresh idempotency tokens.

### 3.3. Recovery Defect: Physical Deletion of Financial Ledger Row
To rectify the duplicate, an operator executed a physical `DELETE FROM withdrawals WHERE id = 'wd_feaa5056'`. While this successfully restored the balance, physical deletion destroys transaction history, breaks cryptographic sequencing, and prevents forensic auditability.

**Principle Violated:** Financial ledger mutations must maintain an immutable audit trail using status transitions (`Cancelled`, `Void`, `Reversed`) rather than physical deletion.

---

## 4. Corrective and Preventive Actions (CAPA)

To ensure this vulnerability cannot recur, the following permanent controls have been engineered and deployed across the application and database architecture:

### 1. Fail-Closed Authoritative DB Precondition Guard (`lib/financial-mutation-guard.js`)
- `assertAuthoritativeProductionDb(context)`: Verifies that the active connection is explicitly pointing to authoritative production project `julhldzkiqdeuuoqmvlo` with a live ping before allowing any financial mutation.
- If credentials are missing, invalid, or point to a non-production instance, the mutation immediately aborts with `AUTHORITATIVE_PRODUCTION_DB_UNAVAILABLE`.
- Prohibits using Google Sheets, local fixtures, or cached snapshots as proof of absence for writes.

### 2. Authority Tagging in Calculation Engines (`lib/dashboard.js`)
- `buildInvestorDashboard` now tags every result with `dataSourceAuthority: 'AUTHORITATIVE_PRODUCTION_DB'` or `'NONAUTHORITATIVE_FALLBACK'`.
- Supports `{ mustBeAuthoritative: true }`, which throws if the data is not derived directly from verified production Supabase.

### 3. Economic Duplicate Guard in `create_withdrawal_atomic`
- Under the investor transactional advisory lock, `create_withdrawal_atomic` now scans for existing active withdrawals (`Pending`, `Approved`, `Completed`) with matching `investor_id`, `effective_accounting_date`, and `amount`.
- If an active duplicate exists and `p_allow_duplicate_amount` is not explicitly set to `TRUE`, the RPC returns `DUPLICATE_ECONOMIC_TRANSACTION` along with the existing row ID, without creating a second row.
- Legitimate multi-distribution cases are supported only by explicitly setting `p_allow_duplicate_amount := TRUE` with distinct business justification.

### 4. Deterministic Idempotency Key Architecture
- Corrections and administrative adjustments must use `buildDeterministicIdempotencyKey({ type, investorId, effectiveDate, amountCents, purpose })`.
- Random tokens (`randomBytes`, `uuid()`, `md5(random())`) are prohibited for historical adjustments, ensuring retries always resolve to the existing transaction.

### 5. Universal Prohibition of Physical Deletes on Financial Ledgers
- `DELETE` HTTP handlers on `/api/admin/withdrawals/[id]` and `/api/admin/deposits/[id]` return HTTP 405 Method Not Allowed.
- Deprecates physical deletion in favor of atomic status transitions to `Cancelled` or `Void`.

---

## 5. Certification of Current Production State

As certified in read-only post-mutation forensic inspection:
- Jerry's Rogue Jets active withdrawals count: **4** (`wd_5614f2b2`, `wd_a9234ba4`, `wd_e380829e`, `wd_jerrys_20260801_d00164e8`).
- Total active withdrawal sum: **$10,000.00** ($2,500.00/month for May, June, July, August 2026).
- Cancelled prototype row: `wd_2eeb5318` ($7,500.00) is strictly `Cancelled` and excluded from all balances.
- Duplicate row `wd_feaa5056` is non-existent.
- Authoritative settled balance (continuous Decimal precision): **$551,657.29**.
