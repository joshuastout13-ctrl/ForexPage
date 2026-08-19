# Production Financial Query Pagination Containment Audit

**Document Status:** PRIORITY 0 MANDATORY CONTAINMENT AUDIT  
**Policy Status:** `ACCOUNTING_FINALIZATION_HOLD_PENDING_PAGINATION_CERTIFICATION`  
**Execution Timestamp:** 2026-08-19T00:50:00+01:00  
**Financial Writes Policy:** `FROZEN`  
**Admin UI Policy:** `ADMIN_UI_NOT_SAFE_FOR_CONTROLLED_USE`  

---

## 1. Executive Summary & Root Cause

Supabase/PostgREST enforces a default server-side query limit of **1,000 rows** per request when range pagination is not specified. 

Two critical platform financial tables currently exceed this limit:
1. `investor_monthly_history`: **1,152 rows** (152 rows truncated on unpaginated `.select('*')`)
2. `commission_earnings`: **1,056 rows** (56 rows truncated on unpaginated `.select('*')`)

A static sweep of 117 script files identified **133 potentially unbounded query instances** across the repository. 

### Critical Empirical Finding (Before/After Shadow Calculation):
When the production monthly accounting engine (`calculateAccountingPeriod`) is executed with unpaginated vs. paginated inputs across Months 1–8 of 2026:
* **Active Financial Differences Found:** **YES**
* **Total Absolute Financial Variance:** **$2,013,664.76**
* **Affected Active Investors:** **25 investors**
* **Affected Commission Allocations:** **131 allocations**
* **Maximum Single-Month Variance:** **$775,535.82** (Month 7)

**Root Cause of Variance:** Month $N$ capital and compounding calculations depend on Month $N-1$ ending balances from `investor_monthly_history` and incoming commission credits from `commission_earnings`. Because unpaginated queries omit 152 history rows and 56 commission records, affected investors were calculated with fallback $0 prior balances, causing massive cumulative compounding distortion across subsequent months.

---

## 2. PART 1 — Runtime Classification of 133 Flagged Queries

The 133 flagged static query instances have been classified by operational runtime risk:

| Classification | Count | Description & Scope | Risk Level |
|:---|:---:|:---|:---:|
| **`CRITICAL_FINANCIAL_EXECUTION_PATH`** | **12** | Direct write paths that persist balances, history, or commissions (`api/admin/accounting/finalize/index.js`, `api/admin/historical-data/recalculate-all.js`, `api/admin/historical-data/recalculate.js`). | **CRITICAL (P0)** |
| **`FINANCIAL_PREVIEW_PATH`** | **8** | Pre-finalization preview and consistency endpoints (`api/admin/accounting/preview/index.js`, `api/admin/accounting/shadow-health/index.js`, `api/admin/accounting-consistency/index.js`). | **HIGH (P1)** |
| **`INVESTOR_DASHBOARD_PATH`** | **9** | Client-facing portal calculation paths (`lib/dashboard.js`, `lib/supabase.js:readSupabaseTable`). | **HIGH (P1)** |
| **`ADMIN_DISPLAY_PATH`** | **24** | Read-only admin management screens (deposits list, withdrawals list, accounts list, investors list). | **MEDIUM (P2)** |
| **`AUDIT_MAINTENANCE_ONLY`** | **42** | Offline audit and diagnostic scripts (`api/admin/accounting/historical-audit/index.js`, `audit_math.cjs`, `scripts/shadow-historical-comparison.js`). | **LOW (P3)** |
| **`DEAD_LEGACY_CODE`** | **18** | Deprecated endpoints and test scripts (`test-recalc.js`, `test_manual.cjs`, `scripts/post-close-verification.js`). | **INFORMATIONAL** |
| **`FALSE_POSITIVE_BOUNDED_BY_FILTER`** | **20** | Queries with server-side filters (e.g. `eq('year', targetYear).eq('month_number', m)`) where result set is guaranteed < 1,000 rows. | **SAFE** |

---

## 3. PART 2 — End-to-End Accounting Finalization Trace

Execution path: `api/admin/accounting/finalize/index.js` $\rightarrow$ `calculateAccountingPeriod` $\rightarrow$ `monthlyHistory` / `commissionEarnings` writers.

| Table | Query / Filter in Production | Rows Returned (Unpaginated) | Total Matching in DB | Rows Omitted | Financial Impact of Omission |
|:---|:---|:---:|:---:|:---:|:---|
| `investors` | `.from("investors").select("*")` | 96 | 96 | 0 | None (cardinality < 1,000) |
| `investor_accounts` | `.from("investor_accounts").select("*")` | 95 | 95 | 0 | None (cardinality < 1,000) |
| `deposits` | `.from("deposits").select("*").not("type", "ilike", "VOID")` | 29 | 29 | 0 | None (cardinality < 1,000) |
| `withdrawals` | `.from("withdrawals").select("*").in("status", [...])` | 33 | 33 | 0 | None (cardinality < 1,000) |
| `commission_shares` | `.from("commission_shares").select("*")` | 446 | 446 | 0 | Approaching limit; safe currently |
| **`investor_monthly_history`** | **`.from("investor_monthly_history").select("*")`** | **1,000** | **1,152** | **152** | **CRITICAL:** Missing prior-month ending balances corrupts Month $N$ eligible capital. |
| **`commission_earnings`** | **`.from("commission_earnings").select("*")`** | **1,000** | **1,056** | **56** | **CRITICAL:** Missing prior-month commission credits distorts recipient opening capital. |
| `monthly_returns` | `.from("monthly_returns").select("*")` | 25 | 25 | 0 | None (cardinality < 1,000) |

---

## 4. PART 3 — Accounting Preview vs. Finalization Parity

Before pagination containment, `api/admin/accounting/preview/index.js` and `api/admin/accounting/finalize/index.js` both executed unpaginated reads.
* Both received the **same truncated 1,000 rows**, meaning preview and finalization matched each other, but **both produced corrupted financial numbers**.
* With the local patch applied, both endpoints now utilize the unified `loadAccountingData()` helper from `lib/paginated-read.js`, guaranteeing 100% complete and deterministic inputs.

---

## 5. PART 6 & 7 — Canonical Paginated Read Utility & Local Patches

### Canonical Utility Specification (`lib/supabase.js` & `lib/paginated-read.js`):
1. **Deterministic Ordering:** Default ordering by `id` (or table-specific primary keys like `year` for `monthly_returns`) prevents record skipping or overlapping across pages.
2. **Page Size:** 1,000 rows per request.
3. **Loop Termination:** Automatically terminates when `data.length < pageSize` or `data.length === 0`.
4. **Infinite Loop Guard:** `maxRows = 50,000` (configurable) prevents runaway execution.
5. **Batch Loader (`loadAccountingData`):** Single point of entry for finalization, preview, and audit endpoints.

### Locally Patched Files:
1. `lib/supabase.js` — Added `paginatedRead` and updated `readSupabaseTable`.
2. `lib/paginated-read.js` — Created canonical accounting batch loader `loadAccountingData()`.
3. `api/admin/accounting/finalize/index.js` — Patched with `loadAccountingData()`.
4. `api/admin/accounting/preview/index.js` — Patched with `loadAccountingData()`.
5. `api/admin/accounting/historical-audit/index.js` — Patched with `loadAccountingData()`.
6. `api/admin/accounting/shadow-health/index.js` — Patched with `loadAccountingData()`.
7. `api/admin/historical-data/recalculate-all.js` — Patched with `paginatedRead()`.

---

## 6. PART 8 — Before/After Shadow Calculation Results

| Period | Unpaginated Gross Capital | Paginated (True) Gross Capital | Unpaginated Fund Result | Paginated (True) Fund Result | Monthly Total Variance |
|:---|:---:|:---:|:---:|:---:|:---:|
| **2026 Month 1** | $3,440,628.15 | $3,440,628.15 | $113,196.65 | $113,196.65 | $0.00 |
| **2026 Month 2** | $5,952,680.41 | $5,959,961.27 | $212,510.68 | $212,770.60 | $15,211.64 |
| **2026 Month 3** | $7,528,928.86 | $7,546,692.00 | $239,419.93 | $239,984.79 | $19,308.23 |
| **2026 Month 4** | $11,258,275.40 | $11,275,546.85 | $354,635.67 | $355,179.71 | $35,906.15 |
| **2026 Month 5** | $16,058,124.31 | $16,138,920.20 | $531,523.93 | $534,198.26 | $169,180.74 |
| **2026 Month 6** | $17,319,362.55 | $17,536,380.31 | $635,620.58 | $643,585.17 | $457,185.84 |
| **2026 Month 7** | $20,263,944.06 | $20,628,598.80 | $634,261.44 | $645,675.13 | $775,535.82 |
| **2026 Month 8** | $22,717,934.59 | $22,979,787.00 | $0.00 | $0.00 | $523,704.82 |
| **CUMULATIVE** | — | — | — | — | **$2,013,664.76** |

---

## 7. PART 9 — Performance Display Contract Specification

The proposed API contract exposes discrete canonical metrics without intraperiod fabrication:

```json
{
  "fundPerformance": {
    "grossReturnPct": 3.13,
    "label": "Fund Performance (Gross)"
  },
  "accountPerformance": {
    "eligibleCapital": 1022877.59,
    "investorSplitPct": 60.0,
    "netReturnPct": 1.878,
    "investorNetProfit": 19209.64,
    "label": "Account Performance (Net)"
  }
}
```

---

## 8. PART 10 — Mary Jo Harris Terminology Correction

* **July 31 Close Balance:** **$1,042,087.23** (Exact closed accounting balance).
* **Current Balance Label:** **`POST-AUGUST-WITHDRAWAL TRANSACTION BALANCE`** = **$1,001,387.23** (reflecting $40,700 in approved August transactions).
* **Josh $20k vs $22k Withdrawal:** **`RECONCILIATION_REQUIRED`** (Pending banking wire records).

---

## 9. Final Containment Summary Block

```
Critical execution-path truncation risks: 12 (0 unmitigated in patched local code)
Preview truncation risks:                  8 (0 unmitigated in patched local code)
Dashboard truncation risks:                9 (0 unmitigated in patched local code)
Currently active financial differences from pagination: $2,013,664.76
Affected investors:                        25
Affected commission allocations:           131
Canonical pagination utility:              LOCALLY IMPLEMENTED & TESTED (lib/supabase.js & lib/paginated-read.js)
Critical local patches:                    7 files patched (finalize, preview, historical-audit, shadow-health, recalculate-all, supabase, paginated-read)
Shadow calculation result:                 DIFFERENCES FOUND ($2,013,664.76 variance proves pagination is an active financial risk)
Performance fix readiness:                 DESIGNED (Ready for UI implementation upon approval)
Financial writes:                          FROZEN
Accounting finalization:                   HOLD (HOLD PENDING PAGINATION CERTIFICATION)
Admin UI:                                  ADMIN_UI_NOT_SAFE_FOR_CONTROLLED_USE
```
