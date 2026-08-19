# Production Financial Query Pagination Remediation Plan

**Document Status:** Priority 0 Architectural Remediation Plan  
**Target Milestone:** Full Pagination Containment & Certification  
**Policy Status:** `ACCOUNTING_FINALIZATION_HOLD_PENDING_PAGINATION_CERTIFICATION`  
**Execution Timestamp:** 2026-08-19T00:52:00+01:00  

---

## 1. Objective & Scope

Eliminate all risks of silent query truncation across Supabase/PostgREST financial reads by enforcing deterministic, range-based pagination across all calculation, preview, dashboard, and persistence paths.

---

## 2. Architecture of the Canonical Pagination Solution

### Layer 1: Core Client Helper (`lib/supabase.js`)
* Implements `paginatedRead(table, options)` with:
  * Range-based cursor (`.range(from, from + pageSize - 1)`)
  * Deterministic ordering by primary key (`id`, `year`, `metric`)
  * Configurable `queryModifier` for server-side filtering
  * Infinite-loop protection guard (`maxRows = 50,000`)
* Updated `readSupabaseTable(tableName)` to automatically use `paginatedRead` for complete-table loading.

### Layer 2: Accounting Domain Batch Loader (`lib/paginated-read.js`)
* Implements `loadAccountingData(filters)`:
  * Parallel execution for fast I/O
  * Selectively paginates tables exceeding 1,000 rows (`investor_monthly_history`, `commission_earnings`)
  * Uses fast direct reads for small bounded tables (`investors`, `investor_accounts`, `deposits`, `withdrawals`, `monthly_returns`)
  * Serves as single source of truth for finalization, preview, audit, and health checks.

---

## 3. Implementation Phasing & Status

### Phase 1: Critical Financial Engine Paths (COMPLETED LOCALLY)
- [x] Create `paginatedRead` utility in `lib/supabase.js`
- [x] Create `loadAccountingData` batch helper in `lib/paginated-read.js`
- [x] Patch Finalization API (`api/admin/accounting/finalize/index.js`)
- [x] Patch Preview API (`api/admin/accounting/preview/index.js`)
- [x] Patch Historical Audit API (`api/admin/accounting/historical-audit/index.js`)
- [x] Patch Shadow Health API (`api/admin/accounting/shadow-health/index.js`)
- [x] Patch Recalculate-All Writer (`api/admin/historical-data/recalculate-all.js`)
- [x] Patch Investor Dashboard (`lib/dashboard.js` via `readSupabaseTable`)
- [x] Unit test pagination utility (`test-paginated-read.mjs`)
- [x] Execute Before/After Shadow Comparison (`shadow-pagination-compare.mjs`)

### Phase 2: Secondary Admin & Management Paths (PLANNED)
- [ ] Admin cashflows review endpoint (`api/admin/accounting/cashflows-review/index.js`)
- [ ] Admin consistency check endpoint (`api/admin/accounting-consistency/index.js`)
- [ ] Admin commission audit endpoint (`api/admin/commission-audit/index.js`)
- [ ] Admin deposits/withdrawals listing pages (`api/admin/deposits/index.js`, `api/admin/withdrawals/index.js`)
- [ ] Admin accounts and investors listings (`api/admin/accounts/index.js`, `api/admin/investors/index.js`)

### Phase 3: Deployment & Certification Gates
- [ ] Full regression test on non-production environment
- [ ] Dual-run verification of August dry-run finalization
- [ ] Formal sign-off on pagination containment
- [ ] Lift `ACCOUNTING_FINALIZATION_HOLD` upon verification

---

## 4. Verification & Testing Protocol

1. **Unit Test Verification:** `test-paginated-read.mjs` verifies exact row counts:
   * `investor_monthly_history`: exactly 1,152 rows
   * `commission_earnings`: exactly 1,056 rows
2. **Dashboard Verification:** `test-dashboard-paginated.mjs` verifies correct multi-account loading and balance resolution.
3. **Shadow Verification:** `shadow-pagination-compare.mjs` quantifies the $2,013,664.76 variance eliminated by pagination.
