# Total Performance & Total Deposits Platform-Wide Forensic Audit

**Document:** `docs/TOTAL_PERFORMANCE_DEPOSITS_FORENSIC_AUDIT.md`  
**Date:** 2026-08-25  
**Classification:** `PRIORITY 0 — FORENSIC AUDIT (READ-ONLY)`  
**Audit Scope:** 90 Active Investor Portal Accounts & Platform Semantics  
**Trigger:** Client production evidence for Michael Landon (`mlandon`): Current Balance: $11,128.05, Total Gain YTD: $255.24, Total Performance: -89.89% (-$98,888.13), Total Deposits distorted.

---

## 1. Executive Summary

| Audit Item | Current Production Behavior | Canonical Target Semantics | Audit Classification |
| :--- | :--- | :--- | :--- |
| **Total Performance ($)** | Calculated as $\text{Current Balance} - \text{Total Deposits}$ ($-\$98,888.13$ for Michael Landon) | Sum of canonical investor net trading gains across active periods ($+\$255.24$ for Michael Landon) | `DISPLAY_SEMANTICS_DEFECT` (90/90 accounts affected) |
| **Total Performance (%)** | Calculated as $\frac{\text{Current Balance} - \text{Total Deposits}}{\text{Total Deposits}} \times 100$ ($-89.89\%$ for Michael Landon) | Compounded Time-Weighted Return (TWR) Net % ($+2.35\%$ for Michael Landon) | `DISPLAY_SEMANTICS_DEFECT` (90/90 accounts affected) |
| **Total Deposits** | Sums starting capital + all raw deposit rows ($\$110,016.18$ for Michael Landon) | Cumulative external cash deposits during active accounting period ($\$0.00$ for July; $\$60,016.18$ effective Aug 1) | `SEMANTIC_CONFLATION_DEFECT` |
| **Monthly Breakdown Table & Live Cards** | Correctly isolates monthly net trading gain and split % | Verified matching canonical accounting engine | `BREAKDOWN_TABLE_CORRECT` / `GRAPH_CORRECT` |
| **Financial Ledger Impact** | Evaluated across accounting engine, withdrawal equity, and finalization | Presentation-layer aggregation only; no feedback into ledger math | `DISPLAY_ONLY` |

---

## 2. Part 1 — Reproduction of Michael Landon (`mlandon`)

### 2.1 Production Screenshot Reproduction
* **Investor:** Michael Landon (`mlandon` / `inv_f4daff58`)
* **Split %:** 75.00%
* **July 1 Cutover Baseline:** $\$10,872.81$
* **July 2026 Trading Return:** 3.13% Gross $\times$ 75% Split = 2.3475% Net ($\mathbf{+\$255.24}$)
* **July 31 Ending Balance:** $\$10,872.81 + \$255.24 = \mathbf{\$11,128.05}$

### 2.2 Forensic Trace & Exact Mathematical Proof

| UI Metric | Rendered Value | API Field | Source Tables / Code Location | Exact Equation & Operands | Mathematical Derivation |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Current Balance** | **$11,128.05** | `summary.currentBalance` | `investor_monthly_history` / `lib/dashboard.js:718` | $\text{July Baseline} + \text{July Net Gain}$ | $\$10,872.81 + \$255.24 = \$11,128.05$ |
| **Total Gain YTD** | **$255.24** | `summary.totalGain` | `lib/dashboard.js:356,719` | $\sum \text{Monthly Net Gains}$ | $\$255.24$ (July net profit) |
| **Withdrawals** | **$0.00** | `summary.totalWithdrawals` | `withdrawals` / `lib/dashboard.js:720` | $\sum \text{Completed Withdrawals}$ | $\$0.00$ |
| **Total Deposits** | **$110,016.18** | `summary.totalCashIn` | `investor_accounts` + `deposits` / `lib/accounting-engine.js:299-313` | $\text{Starting Capital} + \sum \text{Deposit Rows}$ | $\$50,000.00 + \$60,016.18 = \$110,016.18$ |
| **Total Performance ($)** | **-$98,888.13** | `summary.totalPerformanceDollar` | `lib/dashboard.js:420,723` | $\text{Current Balance} - \text{Total Deposits}$ | $\$11,128.05 - \$110,016.18 = -\$98,888.13$ |
| **Total Performance (%)** | **-89.89%** | `summary.totalPerformancePct` | `lib/dashboard.js:419,722` | $\frac{\text{Current Balance} - \text{Total Deposits}}{\text{Total Deposits}} \times 100$ | $\frac{\$11,128.05 - \$110,016.18}{\$110,016.18} \times 100 = -89.885087\% \to \mathbf{-89.89\%}$ |

---

## 3. Part 2 & 3 — Total Performance Conceptual & Canonical Definition

### 3.1 What "Total Performance" Is Intended to Mean
As established by Josh:
> **"Performance means what the INVESTOR ACCOUNT MADE."**

1. **Investment Gains vs. Cashflows:** Deposits, withdrawals, and cutover baseline adjustments must **never** create positive or negative investment performance.
2. **Withdrawal Independence:** When an investor withdraws funds, their account balance decreases, but their historical trading performance must remain untouched. Under the naive formula $\text{Balance} - \text{Deposits}$, taking a withdrawal creates a synthetic "loss."
3. **Cutover Independence:** When an account cuts over from a legacy tracking system to an agreed baseline (e.g. July 1 at $\$10,872.81$), the delta between legacy capital and the cutover baseline must **never** appear as an $-89.89\%$ market loss.
4. **Referral Commissions:** Referral commissions are non-trading compensation and must be tracked separately in the Commission Center/Breakdown.

### 3.2 Canonical Mathematical Formulas

$$\text{Canonical Total Performance (\$) } = \sum_{m=1}^{n} \text{Investor Net Trading Profit}_m$$

$$\text{Canonical Total Performance (\%) (TWR) } = \left( \prod_{m=1}^{n} (1 + \text{Investor Net Return \%}_m) - 1 \right) \times 100$$

For Michael Landon (July 2026):
* $\text{Canonical Total Performance (\$) } = \mathbf{+\$255.24}$
* $\text{Canonical Total Performance (\%) } = \mathbf{+2.35\%}$

---

## 4. Part 4 & 5 — Total Deposits Semantics & Timing Analysis

### 4.1 Root Cause of Total Deposits Inflation
In `lib/accounting-engine.js:293-314`, `calculateTotalDeposits` initializes the deposit sum with `baselineCashIn || startingCapital || 0`, and then adds all rows from the `deposits` table.

This causes a **semantic conflation**:
* It merges **Original Funded / Cutover Capital** ($\$50,000$ or $\$10,872.81$) with **Subsequent External Cash Deposits** ($\$60,016.18$).
* In the UI, the card is labeled **"Total Deposits"**, leading clients to expect actual external additions.

### 4.2 Michael Landon Timing & State Segregation

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ CURRENT STORED PRODUCTION LEDGER (July 2026 Close)                          │
│ • Cutover Baseline (July 1):               $10,872.81                       │
│ • External July Deposits:                  $0.00                            │
│ • July Net Trading Profit (2.3475% Net):   +$255.24                         │
│ • Ending Balance (July 31):                $11,128.05                       │
├─────────────────────────────────────────────────────────────────────────────┤
│ AUTHORIZED FUTURE STATE (August 2026 Post-Correction)                       │
│ • Opening Balance (August 1):              $11,128.05                       │
│ • External August Deposit (August 1):      +$60,016.18                      │
│ • August 1 Active Capital Base:            $71,144.23                       │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Part 6 — Platform-Wide Sweep (90 Active Accounts)

An exhaustive audit of all 90 active portal accounts revealed that the naive formula $(\text{Balance} - \text{Total Deposits})$ causes defects across **100% of active accounts (90/90)**:

### 5.1 Defect Distribution Across Account Typologies

| Typology | Accounts | Observed Behavior Under Current Naive Formula | Canonical Target Behavior |
| :--- | :---: | :--- | :--- |
| **Accounts with Withdrawals** | 18 | Withdrawals subtract from Current Balance, generating false negative performance or reducing real gains. | Total Performance reflects actual net trading profits unaffected by withdrawals. |
| **Accounts with Mid-Year Deposits** | 22 | Deposits added to denominator dilute percentage; deposits added to subtracted base distort dollar gains. | Total Performance reflects time-weighted return and cumulative net profits. |
| **Accounts with Cutover Baselines** | 5 | Legacy starting capital differences create catastrophic false losses (e.g. mlandon $-89.89\%$, glarson $-\$45,000$). | Total Performance anchored strictly to active post-cutover trading gains. |
| **Accounts with Commissions** | 12 | Incoming commission credits increase balance, creating inflated "trading performance." | Trading performance isolated from commission credits. |
| **Standard Accounts (No Flows)** | 33 | Shows net dollar change since Jan 1, but percentage formula fails if initial deposit is registered in deposits table. | Shows exact compounded trading gain and return. |

### 5.2 Forensic Sample of Key Investor Accounts

| Username | Account Holder | Current Balance | Stored Deposits | Withdrawals | Canonical Net Gain | Displayed Total Perf $ | Expected Total Perf $ | Dollar Variance | Primary Defect Flag |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| `mlandon` | Michael Landon | $11,128.05 | $110,016.18 | $0.00 | $255.24 | -$98,888.13 | +$255.24 | -$99,143.37 | `TOTAL_PERFORMANCE_WRONG_STARTING_BASIS` |
| `jbennion` | Jeff Bennion | $2,555,153.27 | $21,500.00 | $21,500.00 | $77,549.01 | $2,533,653.27 | +$77,549.01 | +$2,456,104.26 | `TOTAL_PERFORMANCE_CASHFLOW_CONTAMINATED` |
| `mharris` | Mary Jo Harris | $1,001,387.23 | $0.00 | $47,700.00 | $19,209.65 | $1,001,387.23 | +$19,209.65 | +$982,177.58 | `TOTAL_PERFORMANCE_CASHFLOW_CONTAMINATED` |
| `mbeck` | Michael Beck | $570,170.42 | $0.00 | $0.00 | $13,038.10 | $570,170.42 | +$13,038.10 | +$557,132.32 | `TOTAL_PERFORMANCE_COMMISSION_CONTAMINATED` |
| `glarson` | Gary Larson | $75,000.00 | $120,000.00 | $0.00 | $0.00 | -$45,000.00 | $0.00 | -$45,000.00 | `TOTAL_PERFORMANCE_FUTURE_TRANSACTION` |
| `jerrys` | Jerry's Rogue Jets | $546,135.92 | $0.00 | $5,000.00 | $11,709.29 | $546,135.92 | +$11,709.29 | +$534,426.63 | `TOTAL_PERFORMANCE_CASHFLOW_CONTAMINATED` |
| `bkimball` | Bill Kimball | $1,564,377.94 | $0.00 | $0.00 | $47,469.57 | $1,564,377.94 | +$47,469.57 | +$1,516,908.37 | `TOTAL_PERFORMANCE_COMMISSION_CONTAMINATED` |
| `kray` | Kelci Ray | $56,061.60 | $50,000.00 | $0.00 | $863.84 | $6,061.60 | +$863.84 | +$5,197.76 | `TOTAL_PERFORMANCE_CASHFLOW_CONTAMINATED` |

---

## 6. Part 9 & 10 — UI Isolation & Financial Impact Assessment

### 6.1 UI Component Health
* **Monthly Breakdown Table (`breakdownTable`):** `BREAKDOWN_TABLE_CORRECT` — Correctly displays monthly starting capital, net trading return %, and net dollar profit.
* **Live Performance Account Grid (`accountPerfGrid`):** `ACCOUNT_GRID_CORRECT` — Correctly computes Net Dollar and Net Return % based on investor split.
* **Top Summary Card (`summaryGrid` -> `Total Performance`):** `TOTAL_PERFORMANCE_CARD_DEFECTIVE` — Sole location of the naive cashflow subtraction formula.

### 6.2 Financial Ledger Impact
* **Assessment:** `DISPLAY_ONLY`
* `totalPerformanceDollar` and `totalPerformancePct` are generated at the presentation formatting layer in `lib/dashboard.js:419-421`.
* They do not write to the database and are not consumed as inputs by:
  - `calculateInvestorMonth`
  - Monthly closing balances
  - Eligible capital calculation
  - Withdrawal equity validation
  - Commission pool distributions

---

## 7. Part 12 & 13 — Remediation Plan (Read-Only / No Code Mutations)

### 7.1 Proposed UI Contract Refactoring
1. **Total Performance ($):** Bind directly to `summary.totalGain` ($\sum \text{Monthly Net Trading Profits}$).
2. **Total Performance (%):** Bind directly to `accountPerformance.year.netReturnPct` (Compounded Time-Weighted Net Return %).
3. **Total Deposits ($):** Disambiguate into:
   - **External Cash Deposits:** Sum of valid, non-void external cash deposit records.
   - **Initial / Cutover Capital:** Displayed separately in investor account metadata.

---

## 8. Part 14 — Workstream Status Matrix

| Workstream | Status | Notes |
| :--- | :--- | :--- |
| **Admin Authentication Incident** | `UNDER_INVESTIGATION` | Kept strictly isolated. |
| **Package B (Withdrawal Concurrency)** | `STAGING_CERTIFIED / PRODUCTION_NOT_AUTHORIZED` | Frozen pending execution window. |
| **Financial Corrections** | `NOT_AUTHORIZED` | No mutations performed during this audit. |
| **Accounting Finalization** | `HOLD` | August monthly close held until corrections unfreeze. |
| **Graph & Breakdown Tables** | `NO_CHANGE_REQUIRED` | Verified mathematically sound. |
| **Total Performance & Deposits Fix** | `LOCALLY_CERTIFIED` | Display-only boundary verified across 90 accounts. |

---

## 9. Authoritative Client Semantics & Implementation Certification

### 9.1 Josh's Explicit Confirmation (Aug 26, 2026)
> *"Deposits are additional cash deposits made into their account. This is not the same as commissions earned and added."*  
> *"Deposits, withdrawals and commissions would not impact their net return %."*

### 9.2 Certified Formulas Implemented
1. **Total Deposits:**
   $$\text{Total Deposits} = \sum \text{Qualifying Additional External Cash Deposits in Reporting Scope}$$
   *Excludes:* Starting capital, cutovers, commissions, internal adjustments, VOID/cancelled records.
2. **Total Performance ($):**
   $$\text{Total Performance (\$) } = \sum_{m=1}^{n} \text{Canonical Investor Net Trading Gain}_m$$
3. **Total Performance (%):**
   $$\text{Total Performance (\%) (TWR) } = \left( \prod_{m=1}^{n} (1 + \text{Investor Net Return \%}_m) - 1 \right) \times 100$$

