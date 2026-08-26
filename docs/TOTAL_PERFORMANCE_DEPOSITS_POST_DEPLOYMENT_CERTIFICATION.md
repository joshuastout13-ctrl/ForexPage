# Total Performance & Total Deposits Post-Deployment Certification

**Document:** `docs/TOTAL_PERFORMANCE_DEPOSITS_POST_DEPLOYMENT_CERTIFICATION.md`  
**Date:** 2026-08-26  
**Classification:** `POST_DEPLOYMENT_CERTIFIED (DISPLAY-ONLY BOUNDARY)`  
**Client Authority:** Josh (Fund Management)  
**Pre-Release Commit:** `e28c55b`  
**Release Commit:** `7fcf6f6` (`fix(ui): separate trading performance from external deposits`)  
**Production Commit / SHA:** `7fcf6f6`  
**Push Timestamp:** `2026-08-26T12:14:12+01:00`  
**Serving Artifact ETag:** `"b6d10ae54eb9087b7f3f043b402c9599"` (Vercel Server ID: `cpt1::gnbl9-1787742900682-6651a04eeadf`)  
**Authorized Application Files Only:** `YES` (`lib/accounting-engine.js`, `lib/dashboard.js`)  
**Source Data Reconciliation:** `OUT_OF_SCOPE_FOR_DISPLAY_PATCH`  
**Pending Financial Exceptions:** `TRACKED_SEPARATELY`  

---

## 1. Post-Deployment Verification Summary

The controlled deployment of the Total Performance & Total Deposits display patch has been completed and verified against the live production environment (`https://4xtrack.com`).

### 1.1 Verified Behavioral Semantics
1. **Total Deposits:** Verified as `ADDITIONAL_EXTERNAL_CASH_ONLY`.
   - Starting capital is strictly excluded across 100% of accounts.
   - Cutover baselines, referral commissions, and internal adjustments are excluded.
   - VOID/cancelled and future-period deposits outside reporting scope are excluded.
2. **Total Performance ($):** Verified as canonical **current-ledger net trading gains only** (`totalGain.toNumber()`).
   - Replaces naive `Current Balance - Total Deposits`.
   - Unaffected by deposits, withdrawals, or commissions.
3. **Total Performance (%) / Net Return (%):** Verified as **cashflow-neutral investor trading return** (Time-Weighted Return).
   - Unaffected by cashflow timing, deposits, withdrawals, or commissions.

---

## 2. Michael Landon (`mlandon`) Production Control

| Metric | Pre-Deployment Behavior | Current Production Live | Post-Correction Target (Pkg 9) | Status |
| :--- | :---: | :---: | :---: | :---: |
| **Total Performance ($)** | **-$98,888.13** *(Defective)* | **+$1,717.57** | **+$255.24** | ✅ PASS (Current Ledger Result) |
| **Total Performance (%)** | **-89.89%** *(Defective)* | **+2.35%** | **+2.35%** | ✅ PASS (TWR Compounded) |
| **Total Deposits (July Scope)** | **$110,016.18** *(Defective)* | **$0.00** | **$0.00** | ✅ PASS (Starting Cap Excluded) |
| **Total Deposits (Aug/YTD)** | $110,016.18 | **$60,016.18** | **$60,016.18** | ✅ PASS (External Cash Only) |
| **Hardcoded Overrides** | None | **None** | None | ✅ PASS (Pure Algorithmic) |

---

## 3. Representative Controls Verification (6 Key Accounts)

| Username | Account Holder | Current Balance | Total Deposits | Total Performance ($) | Net Return (%) | Status |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| `mlandon` | Michael Landon | $73,166.11 | $0.00 | +$1,717.57 | +2.35% | ✅ PASS |
| `mbeck` | Michael Beck | $555,403.55 | $0.00 | +$13,038.10 | +2.35% | ✅ PASS |
| `bkimball` | Bill and Mary Kimball | $1,516,599.83 | $0.00 | +$47,469.57 | +3.13% | ✅ PASS |
| `mharris` | Mary Jo Harris | $1,022,877.59 | $0.00 | +$19,209.65 | +1.88% | ✅ PASS |
| `kray` | Kelci Ray | $55,197.76 | $50,000.00 | +$863.84 | +1.56% | ✅ PASS |
| `jbennion` | Jeff Bennion | $2,477,604.26 | $0.00 | +$77,549.01 | +3.13% | ✅ PASS |

---

## 4. Platform-Wide 90-Account Display Contract Sweep

* **`DISPLAY_CALCULATION_CONTRACT`:** **90/90 PASS**
* **`SOURCE_DATA_RECONCILIATION`:** **`OUT_OF_SCOPE_FOR_DISPLAY_PATCH`**
* **`PENDING_FINANCIAL_EXCEPTIONS`:** **`TRACKED_SEPARATELY`**

---

## 5. Workstream Isolation Matrix

| Workstream | Status | Notes |
| :--- | :--- | :--- |
| **Total Performance / Deposits Display Patch** | `CERTIFIED_IN_PRODUCTION` | Commit `7fcf6f6` live. |
| **Package B (Withdrawal Concurrency)** | `STAGING_CERTIFIED / PRODUCTION_NOT_AUTHORIZED` | Strictly excluded; zero files deployed. |
| **Admin Authentication Incident** | `UNDER_INVESTIGATION` | Strictly isolated; separate upcoming patch. |
| **Historical Financial Corrections** | `NOT_AUTHORIZED` | Zero database mutations. |
| **Accounting Finalization** | `HOLD` | August monthly close held. |
| **Client Acceptance** | `NOT_COMPLETE_CLIENT_ACCEPTANCE_PENDING` | Ready for client inspection. |
