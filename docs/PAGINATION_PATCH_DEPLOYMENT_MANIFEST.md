# Production Pagination Patch Deployment Manifest

**Document Status:** Deployment Manifest (PRE-DEPLOYMENT READY — CONTROLLED DEPLOYMENT RECOMMENDED)  
**Policy Status:** `ACCOUNTING_FINALIZATION_HOLD_PENDING_PAGINATION_CERTIFICATION`  
**Patch Recommendation:** `APPROVE_FOR_CONTROLLED_DEPLOYMENT`  
**Execution Timestamp:** 2026-08-19T01:36:00+01:00  
**Financial Writes:** `FROZEN`  
**Production Deployment:** `PENDING CLIENT AUTHORIZATION`  

---

## 1. Scope of the Patch

This patch contains only the minimal code changes necessary to eliminate Supabase/PostgREST 1,000-row query truncation across critical calculation, preview, audit, and dashboard paths.

### Files Included in Deployment Scope (7 Files):
1. `lib/supabase.js` — Added `paginatedRead` and updated `readSupabaseTable`.
2. `lib/paginated-read.js` — Canonical accounting data batch loader (`loadAccountingData`).
3. `api/admin/accounting/finalize/index.js` — Swapped unpaginated reads for `loadAccountingData()`.
4. `api/admin/accounting/preview/index.js` — Swapped unpaginated reads for `loadAccountingData()`.
5. `api/admin/accounting/historical-audit/index.js` — Swapped unpaginated reads for `loadAccountingData()`.
6. `api/admin/accounting/shadow-health/index.js` — Swapped unpaginated reads for `loadAccountingData()`.
7. `api/admin/historical-data/recalculate-all.js` — Added `paginatedRead()` on `commission_earnings` and `investor_monthly_history`.

### Files Explicitly EXCLUDED from Deployment:
* `admin.html` (Admin UI changes held pending separate action failure certification)
* `build-admin.js` (Held)
* `test-*.mjs` and `shadow-*.mjs` (Local test utilities only)
* All documentation files (`docs/*`)

---

## 2. File Hashes & Integrity Verification

| File Path | Component / Layer | Modification Type |
|:---|:---|:---|
| `lib/supabase.js` | Core DB Utility | Added `paginatedRead()`, updated `readSupabaseTable()` |
| `lib/paginated-read.js` | Accounting Loader | New canonical batch loader `loadAccountingData()` |
| `api/admin/accounting/finalize/index.js` | Finalization Engine | Swapped to `loadAccountingData()` |
| `api/admin/accounting/preview/index.js` | Preview Engine | Swapped to `loadAccountingData()` |
| `api/admin/accounting/historical-audit/index.js` | Audit Engine | Swapped to `loadAccountingData()` |
| `api/admin/accounting/shadow-health/index.js` | Health Check | Swapped to `loadAccountingData()` |
| `api/admin/historical-data/recalculate-all.js` | Recalculation Engine | Swapped to `paginatedRead()` |

---

## 3. Smoke Test & Verification Procedure (Pre/Post Deployment)

1. **Verify Utility Unit Tests:**
   ```bash
   node test-pagination-rigorous.mjs
   ```
   *Expected Output:* All boundary tests pass (0, 1, 999, 1000, 1001, >2000 rows).
2. **Verify Representative Accounts:**
   ```bash
   node regression-test-representative-accounts.mjs
   ```
   *Expected Output:* All 7 representative dashboards resolve valid balances and breakdown rows.
3. **Verify Preview Endpoint:**
   `POST /api/admin/accounting/preview` with `{ year: 2026, month: 7 }` returns complete 91-investor calculation without database errors.

---

## 4. Rollback Procedure

If unexpected behavior occurs post-deployment:
1. Revert the commit containing the 7 patched files:
   ```bash
   git revert <commit-hash> --no-edit
   git push origin main
   ```
2. Verify rollback via git log.
3. Database rows remain untouched (zero schema or data mutations were performed by this patch).

---

## 5. Mandatory Gates Required Before Lifting Finalization HOLD

Finalization must remain on **`HOLD`** until the following gates are certified:
- [ ] Production pagination patch deployed and verified via read-only preview smoke tests.
- [ ] Resolution of Mary Jo Harris $20,000 vs $22,000 withdrawal conflict (`RECONCILIATION_REQUIRED`).
- [ ] Admin UI click/action failure investigation resolved (`ADMIN_UI_NOT_SAFE_FOR_CONTROLLED_USE`).
- [ ] Formal client authorization to finalize August period.
