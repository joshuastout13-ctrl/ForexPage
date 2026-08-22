# Authoritative Client Requirements Registry — August 20, 2026

**Document Version:** 2.0.0  
**Effective Date:** 2026-08-20T14:51:00+01:00  
**Client Authority:** Josh (Fund Management)  
**Execution Guardrail:** READ-ONLY REGISTRY & SIMULATION ONLY. Zero production financial mutations authorized.

---

## 1. Executive Summary & Policy Overview

On August 20, 2026, Josh provided authoritative client business instructions resolving historical accounting ambiguities, confirming cutover baselines, formalizing negative equity withdrawal policies, and introducing new UI visibility and performance display requirements.

### Core Operating Rules:
1. **Zero Financial Writes:** All financial changes are recorded in this registry as simulations and approval packages only. No production database mutations or accounting finalizations may occur without explicit written authorization.
2. **Strict Package Isolation:** UI features and validation logic must be packaged and deployed completely separately from financial correction scripts.
3. **Superseded Instruction Isolation:** Outdated or superseded client instructions are explicitly branded with `SUPERSEDED_CLIENT_INSTRUCTION` and barred from execution.
4. **Authoritative Calculation Proofs:** No performance formulas or numbers are to be guessed. All calculations must be proven to the exact cent using verified mathematical identities.

---

## 2. Client Directives & Financial Exception Registry

### 2.1 Mary Jo Harris (`inv_4c5c0ee6` / `mharris`)
* **Timestamp / Source:** 2026-08-20T14:51:00+01:00 | Josh Direct Client Instruction
* **Client Confirmation:**
  * July 1, 2026 Withdrawal: **-$20,000.00**
  * August 1, 2026 Withdrawal: **-$18,700.00**
* **Production Conflict Identified:**
  * Production currently contains record `wd_e4fc9d89` for **$22,000.00** (entered on 2026-08-11, labeled July).
  * Record `wd_cd3c1dda` contains **$18,700.00** (labeled August).
* **Classification:** `CLIENT_CONFIRMED` / `CORRECTION_SIMULATION_STAGED`
* **Resolution Plan:**
  * Prepare correction simulation modifying `wd_e4fc9d89` from $22,000.00 to $20,000.00.
  * Verify August $18,700.00 withdrawal `wd_cd3c1dda` independently.
  * Recalculate full July compounding cascade:
    * July 1 Opening Balance: $1,022,877.59
    * July 1 Withdrawal: -$20,000.00
    * July 1 Eligible Capital: **$1,002,877.59** (was $1,022,877.59 unadjusted in baseline)
    * July Gross Profit (3.13%): **$31,389.07** (was $32,016.07; delta -$627.00)
    * Mary Jo Net Profit (60% split): **$18,833.44** (was $19,209.64; delta -$376.20)
    * July 31 Ending Balance: **$1,021,711.03**
    * August 1 Eligible Capital (after -$18,700.00 wd): **$1,003,011.03**
  * Commission Pool Impact (40% total / 5 recipients):
    * Michael Beck (5.0%): $1,569.45 (delta -$31.35)
    * Nathan Thompson (1.6%): $502.23 (delta -$10.03)
    * Austin Ray (16.0%): $5,022.25 (delta -$100.32)
    * Kandis Rucker (16.0%): $5,022.25 (delta -$100.32)
    * Joshua Stout (1.4%): $439.45 (delta -$8.78)

---

### 2.2 Gary Larson (`inv_2093cd23` / `glarson`)
* **Timestamp / Source:** 2026-08-20T14:51:00+01:00 | Josh Direct Client Instruction
* **Client Confirmation:**
  * *"$487,000 is the ONLY deposit set to go Live starting August 1, 2026"*
* **Classification:** `CLIENT_CONFIRMED` / `LIVE_START_AUG_1_2026`
* **Interpretation & Audit Proof:**
  * Gary Larson's live starting capital effective August 1, 2026 is strictly **$487,000.00**.
  * Existing September 1 deposit record `dep_94a0ffe1` ($120,000.00) must **NOT** be counted as a separate contribution.
* **Safe Treatment & Execution Manifest:**
  * Record `dep_94a0ffe1` is safely marked as `type = 'VOID'` with reason `"Superseded by August 1 $487,000 starting capital per Josh Aug 20, 2026 instruction"`. No history is deleted.
  * `investors.start_date` = `'2026-08-01'`
  * `investor_accounts.open_date` = `'2026-08-01'`
  * `investor_accounts.starting_capital` = `$487,000.00`
  * `investor_accounts.total_cash_in` = `$487,000.00`
  * August 1 Eligible Capital: **$487,000.00**

---

### 2.3 Jeff Bennion (`inv_65b7fbd9` / `jbennion`)
* **Timestamp / Source:** 2026-08-20T14:51:00+01:00 | Josh Direct Client Instruction
* **Status:** `SUPERSEDES_PREVIOUS_INSTRUCTION`
* **Marked Superseded:**
  * Previous instruction: July 1 Cutover of **$2,672,544.48** is marked **`SUPERSEDED_CLIENT_INSTRUCTION`** / **`DO_NOT_EXECUTE`**.
* **New Authoritative Client Instruction:**
  * August 1, 2026 Starting Baseline Balance: **$2,673,903.44**
  * August 1, 2026 Withdrawal: **-$21,500.00**
* **Classification:** `CLIENT_CONFIRMED_NEW_CUTOVER`
* **August Account Performance Simulation:**
  * Opening Cutover Balance (Aug 1): $2,673,903.44
  * August 1 Withdrawal: -$21,500.00
  * **Eligible Capital before August Performance:**
    $$\$2,673,903.44 - \$21,500.00 = \mathbf{\$2,652,403.44}$$
  * Investor Split: **100.00%** (Jeff retains 100% of profit, 0% commission pool).
  * The cutover difference is **NOT** treated as a deposit; it is an anchored master baseline cutover.

---

### 2.4 Michael Landon (`inv_f4daff58` / `mlandon`)
* **Timestamp / Source:** 2026-08-20T14:51:00+01:00 | Josh Direct Client Instruction
* **Client Confirmation:**
  * July 1, 2026 Starting Balance: **$10,872.81**
  * Additional Deposit Effective August 1, 2026: **+$60,016.18**
* **Ambiguity Resolution:**
  * Resolves workbook discrepancy between legacy compounding ($73,166.11 June ending) and manual entry ($10,872.81). Josh confirms July 1 cutover baseline is **$10,872.81**, and the $60,016.18 deposit (`dep_c291baf0`) takes effect August 1, 2026.
* **Classification:** `CLIENT_CONFIRMED`
* **Mathematical Roll-Forward:**
  * July 1 Eligible Capital: $10,872.81
  * July Gross Return (3.13% @ 75% split = 2.3475% net): +$255.24
  * July 31 Ending Balance: **$11,128.05**
  * August 1 Opening Balance: $11,128.05
  * August 1 Deposit: +$60,016.18
  * August 1 Eligible Capital: **$71,144.23**

---

### 2.5 Ted Boardwalk (`inv_a79798ca` / `tboardwalk`)
* **Timestamp / Source:** 2026-08-20T14:51:00+01:00 | Josh Direct Business Policy Rule
* **Client Business Rule:**
  * *A withdrawal exceeding available account equity must NOT be allowed under any circumstances.*
* **Classification:** `CLIENT_POLICY_CONFIRMED`
* **Enforcement Specifications:**
  1. **Flagging:** Highlight invalid amounts in admin UI with distinct error borders and explanatory warning text.
  2. **Admin Prevention:** Prevent admin modal submission / save when requested amount exceeds available equity.
  3. **Dual-Layer Validation:** Enforce server-side in API routes (`api/admin/withdrawals/index.js`, `api/admin/withdrawals/[id].js`) with HTTP 400 rejection and client-side in form handlers.
  4. **Available Equity Definition:**
     $$\text{Available Equity} = \text{Prior Month Ending Balance} + \sum \text{Deposits}_{\le \text{date}} - \sum \text{Withdrawals}_{\le \text{date}} + \text{Incoming Commission Credit}$$
  5. **Historical Remediation:** Ted's historical June $5,000 withdrawal (`wd_9a4f1219`) is quarantined; a formal remediation proposal is prepared separately.

---

### 2.6 Michael Beck (`inv_d2ab6da4` / `mbeck`)
* **Timestamp / Source:** 2026-08-20T14:51:00+01:00 | Josh Direct Client Response
* **Josh Confirmation:**
  * *"Starting balance as of July 1 - Confirmed"*
* **Message Binding:**
  * Bound to the prior inquiry asking if Michael Beck's July 1 cutover baseline is **$557,693.10** (incorporating pre-April commission credits).
  * Recorded parameter: `CLIENT_CONFIRMED_JULY_1_CUTOVER = $557,693.10`.
* **Classification:** `CLIENT_CONFIRMED_JULY_1_CUTOVER`
* **Downstream Simulation:**
  * July 1 Eligible Capital: $557,693.10
  * July Net Trading Gain (3.13% @ 75% split = 2.3475%): +$13,091.85
  * July Incoming Commissions:
    * Mary Jo Harris (5.0%): $1,569.45
    * Josh Oviatt (5.0%): $81.03
    * Total July Commissions: **$1,650.48**
  * July 31 Trading Balance: $570,784.95
  * August 1 Starting Capital (with commission capitalization): **$572,435.43**

---

### 2.7 Jerrys Rogue Jets (`jerrys001` / `jerrys`)
* **Timestamp / Source:** 2026-08-20T14:51:00+01:00 | Josh Direct Response
* **Josh Confirmation:**
  * *"Jerry’s data is accurate in our manual audit"* ($534,486.05 July 1 opening figure)
* **Classification:** `CLIENT_CONFIRMED_MANUAL_AUDIT`
* **Architectural Constraint:**
  * Do **NOT** invent a fictitious $59.42 transaction to bridge the difference.
  * Maintain status as `BLOCKED_DESIGN` until an explicit, auditable master baseline adjustment mechanism is formally authorized.
  * Forward August 1 $2,500.00 withdrawal remains a separate authorized transaction.

---

## 3. UI Requirements Registry

| Requirement ID | Component | Specification | Status |
|:---|:---|:---|:---|
| `UI-REQ-01` | Fund Performance Visibility | Add `show_fund_performance` boolean to investor config and Admin UI checkbox; hide card when `false`. | `DESIGN_READY` |
| `UI-REQ-02` | Account Performance Primary | Render Daily (Today), Weekly (This Week), Monthly (This Month), Annual (This Year) net earnings & rates. | `DESIGN_READY` |
| `UI-REQ-03` | Badge Removal | Remove badges "Live / Projected", "Finalized", "Cumulative" from investor portal. | `DESIGN_READY` |
| `UI-REQ-04` | FX Book Live Feed | Connect Today, Week, Month to verified Scrape.do / `live_performance` feed with exact net multiplier. | `CERTIFIED` |
| `UI-REQ-05` | Account Graph Semantics | Graph represents investor net trading performance ONLY ($ made / % on account). Bars strictly exclude referral commissions, deposits, and withdrawals. Bottom summary table itemizes all cashflows and commissions separately. | `CERTIFIED_BY_CLIENT (2026-08-22)` |
| `UI-REQ-06` | Withdrawal Validation | Client and server-side hard check preventing withdrawals exceeding available equity. | `STAGING_CERTIFIED (Package B)` |
| `UI-REQ-07` | Commission Detail Regression | Full audit verification of source names, accurate post-withdrawal source balances, and rates. | `REQUIRED_REGRESSION` |
