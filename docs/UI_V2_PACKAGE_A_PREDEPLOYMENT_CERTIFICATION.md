# UI V2 Package A — Pre-Deployment Candidate Certification & Readiness Report

**Candidate Date:** August 20, 2026  
**Local Code Certification Status:** `PASS (100% AUDITED & VERIFIED LOCALLY)`  
**Production Deployment Status:** `DEPLOYMENT_NOT_YET_PERFORMED`  
**Production Schema Migration Status:** `NOT_YET_PERFORMED`  
**Package Scope:** `PACKAGE A — UI DISPLAY ONLY`  
**Financial Control Status:** `PACKAGE B (WITHDRAWAL VALIDATION) ISOLATED & BLOCKED`  
**Financial Writes Executed:** `0`  
**Accounting Finalization Status:** `HOLD (0 FINALIZED PERIODS)`  

> [!IMPORTANT]
> **PRODUCTION STATUS CLARIFICATION:**
> - Package A application code changes are currently **UNCOMMITTED / LOCALLY CERTIFIED**.
> - Production site (`https://4xtrack.com`) is currently serving the baseline artifact (Live/Projected badges present, `fundPerfCard` absent, commission period labels unapplied).
> - Production Supabase database (`julhldzkiqdeuuoqmvlo`) does NOT yet have the `show_fund_performance` column.
> - **Zero production deployments or migrations have occurred.**

---

## 1. Package Isolation & Deployment Scope

Package A has been strictly decoupled from Package B (Withdrawal Validation). All financial mutations, withdrawal validation controls, and unapproved ledger adjustments remain strictly blocked.

### Package A Candidate File Manifest
| File Path | Classification | Scope | Local Certification |
|---|---|---|---|
| `docs/proposed_show_fund_performance_migration.sql` | `SCHEMA` | DDL adding `show_fund_performance` column | `PASS` |
| `index.html` | `DISPLAY_ONLY` | Conditional `#fundPerfCard`, Account Net metrics, badge removal, commission basis labeling | `PASS` |
| `build-admin.js` | `ADMIN_UI` | Investor toggle checkbox; withdrawal validation UI excluded | `PASS` |
| `admin.html` | `GENERATED_ARTIFACT` | Compiled admin artifact from `build-admin.js` | `PASS` |
| `api/admin/investors/index.js` | `ADMIN_API` | Persists `show_fund_performance` on create | `PASS` |
| `api/admin/investors/[id].js` | `ADMIN_API` | Persists `show_fund_performance` on update | `PASS` |
| `lib/dashboard.js` | `DISPLAY_ONLY` | Exposes `showFundPerformance` & net metrics | `PASS` |

### Excluded Package B Files (0 in Package A)
* `api/admin/withdrawals/index.js` $\rightarrow$ **Excluded / Reverted** (0 validation code)
* `api/admin/withdrawals/[id].js` $\rightarrow$ **Excluded / Reverted** (0 validation code)
* `api/admin/withdrawals/equity.js` $\rightarrow$ **Excluded / Deleted**
* `lib/withdrawal-validation.js` $\rightarrow$ **Excluded / Deleted**
* `lib/sheets.js` $\rightarrow$ **Excluded / Reverted**

---

## 2. Schema Migration Design & Safety

* **Migration SQL:**
  ```sql
  ALTER TABLE investors ADD COLUMN IF NOT EXISTS show_fund_performance BOOLEAN NOT NULL DEFAULT FALSE;
  UPDATE investors SET show_fund_performance = FALSE WHERE show_fund_performance IS NULL;
  ```
* **Execution Method:** Must be applied directly via the Supabase Dashboard SQL Editor for project `julhldzkiqdeuuoqmvlo`.
* **Idempotency & Safety:** Certified additive-only (`ADD COLUMN IF NOT EXISTS`), defaults to `FALSE`, 0 accounts automatically opted in.

---

## 3. Local Account Performance & Commission Verification

* **Account Performance Metrics:** Today, This Week, This Month, This Year (YTD) net investor earnings calculated against certified month-opening active capital ($B_{\text{open}} + D - W$).
* **Badges Removed:** "Live / Projected", "Finalized", "Cumulative" tags removed.
* **Commission Basis Label:** Explicit `"July 2026 Commission Basis (Eligible Capital)"` and cell subtitle `"Eligible Capital Basis"` added.
* **Michael Beck 5 Sources:** Certified stored values preserved ($1,022,877.59 basis / $1,600.80 commission from Mary Jo Harris; 0 simulated values displayed).

---

## 4. Local Sweep & Regression Summary

* **90 Active Portal Sweep:** **90/90 PASS**
* **95 Investor Record Broad Regression:** **95/95 PASS**
* **Mobile Responsiveness (375, 390, 430, 1366px):** **PASS**
* **Pagination Completeness (`commission_earnings`, `investor_monthly_history`):** **PASS**
* **Unexpected Errors:** **0**
