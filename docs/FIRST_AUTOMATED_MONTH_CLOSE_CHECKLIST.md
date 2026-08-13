# FIRST AUTOMATED MONTH CLOSE CHECKLIST — AUGUST 2026

**System Engine Version:** 2.0.0  
**Target Accounting Period:** August 2026 (`2026-08`)  
**Fund Accounting Timezone:** `America/Los_Angeles` (IANA Timezone)  
**Myfxbook Reporting Timezone:** `UTC` (GMT+0)  
**Database Storage Timezone:** `UTC / TIMESTAMPTZ`  
**August Accounting Month Window:** `2026-08-01 00:00:00 PDT` to `2026-08-31 23:59:59.999 PDT` (`2026-09-01 06:59:59.999 UTC`)  
**Status:** DRAFT / PRE-CLOSE CHECKLIST (READ-ONLY PREPARATION)

---

## Pre-Finalization Gate Requirements

Before changing `ACCOUNTING_FINALIZATION_ENABLED` to `true` or invoking `POST /api/admin/accounting/finalize`, every item below MUST be verified and signed off by the System Administrator.

| Item | Requirement Condition | Verification Method | Status | Notes / Sign-Off |
| :--- | :--- | :--- | :---: | :--- |
| **01** | **Calendar Month Close** | Confirm calendar month has ended (e.g. September 1, 2026 or later). | `[ ]` | August must be closed before finalization. |
| **02** | **Final Return Captured** | Final August Myfxbook return percentage is retrieved and verified. | `[ ]` | Verify gross fund return % against Myfxbook statements. |
| **03** | **Return Marked Frozen** | Monthly return record in `monthly_returns` set to `locked = TRUE`. | `[ ]` | Lock return to prevent automated live sync overwrites. |
| **04** | **Effective Dates Approved** | All August cashflows have `effective_accounting_date` set to `2026-08-01`. | `[ ]` | Verify via `/api/admin/accounting/cashflows-review`. |
| **05** | **Cutover Openings Approved** | August 1 cutover opening balances confirmed in `docs/AUGUST_2026_CUTOVER_RECONCILIATION.md`. | `[ ]` | Verify legacy cutover boundary. |
| **06** | **Rule Overlaps Audited** | No overlapping active rules exist for any source account. | `[ ]` | Audited in `/api/admin/accounting/shadow-health`. |
| **07** | **Rule Allocations Audited** | Source + Recipient percentages equal 100% (or expected pool sum). | `[ ]` | Zero unallocated or overallocated commission pools. |
| **08** | **No Duplicate Inputs** | No duplicate deposits, withdrawals, or history rows exist for August. | `[ ]` | Input hash audit clean. |
| **09** | **No Balance Discontinuities** | Zero material balance discontinuities or missing accounts detected. | `[ ]` | Control total reconciled (`Gross Result = Source + Recipient`). |
| **10** | **Final `inputHash` Recorded** | Capture the exact server-side `inputHash` from the final preview run. | `[ ]` | Hash match prevents stale execution. |
| **11** | **All Accounts PASS** | Shadow preview run reports `canFinalize: true` and `flaggedCount: 0`. | `[ ]` | Zero FLAGGED accounts in calculation manifest. |
| **12** | **Josh Summary Review** | Final month-close preview summary reviewed and approved by Josh Stout. | `[ ]` | Formal administrator sign-off. |
| **13** | **Database Backup Checkpoint** | Full Supabase production database backup created and archived. | `[ ]` | Backup created before enabling feature flag. |

---

## Finalization Execution Steps

Once ALL 13 pre-finalization conditions above are `PASS`:

1. `[ ]` **Enable Feature Flag:** Set `ACCOUNTING_FINALIZATION_ENABLED="true"` in environment variables.
2. `[ ]` **Execute Finalization Endpoint:** Trigger `POST /api/admin/accounting/finalize` with `{ "year": 2026, "month": 8, "dryRun": false, "inputHash": "<RECORDED_HASH>" }`.
3. `[ ]` **Verify Atomic Response:** Confirm HTTP status `200 SUCCESS` with `auditId` and transaction completion manifest.
4. `[ ]` **Run Post-Close Verification Script:** Execute `node scripts/post-close-verification.js` to verify database state.
5. `[ ]` **Feature Flag Safety Lock:** Review environment configuration after post-close verification.

---

## Post-Finalization Verification Checklist

| Item | Verification Target | Expected Result | Status |
| :--- | :--- | :--- | :---: |
| **A1** | `accounting_periods` state | Status = `FINALIZED`, `finalized_at` populated | `[ ]` |
| **A2** | `monthly_returns` state | `locked = TRUE`, notes = "Finalized via Central Accounting Engine" | `[ ]` |
| **A3** | `investor_monthly_history` written | 91+ rows upserted with `calculation_version = '2.0.0'`, `locked = TRUE` | `[ ]` |
| **A4** | `commission_earnings` written | Commission ledger written with unique `ledger_key` and provenance columns | `[ ]` |
| **A5** | Control Equation | `SUM(ending_balance) - SUM(opening_balance) = Net Cashflow + Net Return` | `[ ]` |
| **A6** | Negative Earnings Prevention | Zero rows in `commission_earnings` with `amount < 0` | `[ ]` |
| **A7** | Audit Run Logged | Row inserted into `audit_runs` with `audit_id` matching finalization output | `[ ]` |
| **A8** | Reference Accounts | BBECK, ARAY, Glenn Maddocks, Joshua Stout ending balances match manifest | `[ ]` |

---

**Document Control:** Central Accounting Infrastructure Team — Stone & Company Forex Fund  
**Engine Build:** `2.0.0`
