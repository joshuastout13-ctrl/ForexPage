# Total Performance & Total Deposits Fix Certification

**Document:** `docs/TOTAL_PERFORMANCE_DEPOSITS_FIX_CERTIFICATION.md`  
**Date:** 2026-08-26  
**Classification:** `DISPLAY_PATCH_LOCALLY_CERTIFIED`  
**Client Authority:** Josh (Fund Management)  
**Production Baseline:** `87caf6e8979148d56b02a28b08da31349f7e53f0`  
**Deployment Status:** `NOT_YET_AUTHORIZED`  
**Source Data Reconciliation:** `OUT_OF_SCOPE_FOR_DISPLAY_PATCH`  
**Pending Financial Exceptions:** `TRACKED_SEPARATELY`  

---

## 1. Executive Summary & Release Scope

This patch is an isolated, presentation-layer display correction that implements Josh's authoritative client semantics for **Total Deposits** and **Total Performance ($ and %)** on the investor portal dashboard.

### Core Certified Principles:
1. **Total Deposits:** Represents qualifying **additional external cash deposits** only. Strictly excludes starting capital, cutovers, incoming commissions, internal adjustments, and out-of-scope deposits.
2. **Total Performance ($):** Represents canonical **current-ledger net trading gains** only (`totalGain`). Unaffected by deposits, withdrawals, or commissions.
3. **Total Performance (%) / Net Return (%):** Represents canonical **cashflow-neutral investor trading return** (Time-Weighted Return). Unaffected by deposits, withdrawals, or commissions.
4. **Current-Ledger Display Boundary:** Prior to the execution of authorized financial corrections, the display layer renders canonical trading returns directly from current database history (e.g. Michael Landon shows current-ledger +$1,717.57, updating naturally to ~$255.24 only when Package 9 is formally executed).
5. **Separation of Concerns:** Source-data reconciliation and historical financial adjustments are managed in a separate registry and are strictly out of scope for this display patch.

---

## 2. Call-Graph & Financial Safety Audit

A codebase-wide search across all application modules confirms:
* `calculateTotalDeposits` callers: **`lib/dashboard.js` only** (lines 413, 729).
* Financial consumers: **0** (No accounting engines, finalization scripts, commission engines, or withdrawal equity checks consume `calculateTotalDeposits`).
* Display-only boundary: **`PROVEN`**.

---

## 3. Michael Landon (`mlandon`) Current vs. Post-Correction State

| Metric | Current Stored Ledger (Active Display) | Post-Correction Expected (Package 9) | Status |
| :--- | :---: | :---: | :---: |
| **Starting Capital Basis** | $73,166.11 | $10,872.81 (Cutover) | Preserved / Unmutated |
| **Total Deposits (July)** | $0.00 | $0.00 | Excludes Starting Capital |
| **Total Deposits (Aug/YTD)** | $60,016.18 | $60,016.18 | External Cash Only |
| **Total Performance ($)** | **+$1,717.57** | **+$255.24** | Renders Current Ledger |
| **Total Performance (%)** | **+2.35%** | **+2.35%** | Cashflow-Neutral TWR |

* **Zero Hardcoded Overrides:** Display output updates organically through the dynamic accounting calculation without account-specific hardcoding.

---

## 4. Platform-Wide 90-Account Display Contract Sweep

A platform-wide validation across all 90 active investor portal accounts confirmed:
* **Display Calculation Contract:** **90/90 PASS**
  - Total Deposits excludes starting capital across 100% of accounts.
  - Total Performance $ correctly reflects canonical trading gains across 100% of accounts.
  - Net Return % is 100% cashflow-neutral and unaffected by deposits, withdrawals, or commissions.
* **Source Data Reconciliation:** **`OUT_OF_SCOPE_FOR_DISPLAY_PATCH`**
* **Pending Financial Exceptions:** **`TRACKED_SEPARATELY`**

---

## 5. Predeployment Checklist & Verification Matrix

| Verification Item | Result | Evidence |
| :--- | :---: | :--- |
| **Display Semantics** | `CERTIFIED` | Confirmed by Josh (Aug 26, 2026). |
| **Display Calculation Contract** | `90/90 PASS` | Verified via `scripts/sweep-total-performance-90-accounts.cjs`. |
| **Accounting Pipeline Tests** | `PASS` | 50/50 test scenarios passed in `scripts/test-accounting-pipeline.js`. |
| **Performance Graph Semantics** | `PASS` | Graph displays net trading performance bars only; unchanged. |
| **Package B Isolation** | `PASS` | Zero Package B files modified. |
| **Admin-Auth Isolation** | `PASS` | Zero admin-auth files modified. |
| **Financial Writes** | `0` | Zero database mutations or accounting finalizations. |
| **Deployment Authorization** | `NOT_YET_AUTHORIZED` | Local staging certified; deployment held for approval. |
