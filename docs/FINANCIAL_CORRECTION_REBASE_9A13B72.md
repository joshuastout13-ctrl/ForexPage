# Financial Correction Rebase & Period-Specific Control Audit — Baseline 9a13b72

**Document Date:** August 26, 2026  
**Document Version:** 3.0.0  
**Target Production Baseline:** `9a13b72782e81ba1ea9d40b8a1c97a488e0dbfa8` (`9a13b72`)  
**Audit Scope:** READ ONLY / SIMULATION ONLY  
**Production Financial Writes:** `0`  
**Historical Corrections Executed:** `0`  
**Accounting Finalization Policy:** `HOLD`  
**Client Acceptance Status:** `NOT_COMPLETE_CLIENT_ACCEPTANCE_PENDING`  

---

## 1. Universal Period Control Accounting Equation

All controls enforce the universal accounting identity:

$$\mathbf{\text{Ending Capital Delta}} = \text{Opening Capital Delta} + \text{Deposit Delta} - \text{Withdrawal Delta} + \text{Investor Profit Delta} + \text{Capitalized Commission Delta} \pm \text{Cutover Effects}$$

---

## 2. Period-Specific Correction Controls

### 2.1 July 2026 Correction Control (`JULY_CORRECTION_CONTROL`)
* **Scope:** Mary Jo Harris ($22k -> $20k), Michael Landon ($10,872.81 baseline), Michael Beck ($557,693.10 cutover).
* **Control Totals:**
  - Opening / Cutover Delta: `-$62,293.30` (Michael Landon -$62,293.30)
  - Deposit Delta: `$0.00`
  - Withdrawal Bucket Delta: `-$2,000.00` (Capital Effect: `+$2,000.00`)
  - Investor Trading Profit Delta: `-$1,424.77` (Mary Jo +$37.56, Landon -$1,462.33)
  - Capitalized Commission Delta: `+$25.04` (Mary Jo recipient pool adjustment)
  - Documented Cutover Delta: `$0.00`
  - **Ending Capital Delta:** `-$61,693.03`
  - **Unexplained Residual:** `$\mathbf{\$0.00}$` (**PASS**)

---

### 2.2 August 2026 Correction Control (`AUGUST_CORRECTION_CONTROL`)
* **Scope:** Gary Larson (+$487,000 live start), Jerry's Rogue Jets ($2,500 wd), Michael Landon ($60k deposit roll-forward).
* **Control Totals:**
  - Opening / Cutover Delta: `-$61,693.03` (Roll-forward from July)
  - Starting Capital / Deposit Delta: `+$487,000.00` (Gary Larson live start)
  - Withdrawal Bucket Delta: `+$2,500.00` (Jerry's Rogue Jets; Capital Effect: `-$2,500.00`)
  - Investor Trading Profit Delta: `+$6,793.17` (Gary Larson +$6,842.35, Jerry's -$49.18)
  - Capitalized Commission Delta: `$0.00`
  - **Ending Capital Delta:** `+$429,599.14`
  - **Unexplained Residual:** `$\mathbf{\$0.00}$` (**PASS**)

---

### 2.3 September 2026 Correction Control (`SEPTEMBER_CORRECTION_CONTROL`)
* **Scope:** Gary Larson ($120k deposit VOID / elimination of double-counting).
* **Control Totals:**
  - Opening Delta: `+$429,599.14` (Roll-forward from August)
  - Deposit Delta: `-$120,000.00` (`dep_94a0ffe1` VOID to prevent duplicate addition)
  - Withdrawal Delta: `$0.00`
  - Trading Profit Delta: `$0.00`
  - **Ending Capital Delta:** `+$309,599.14`
  - **Unexplained Residual:** `$\mathbf{\$0.00}$` (**PASS**)

---

## 3. Downstream Capitalization & Cascade Modeling

When an upstream correction alters a month's closing equity or referral commissions, downstream periods compound the delta:

$$\Delta \text{Equity}_{t+1} = \Delta \text{Equity}_t \times (1 + r_{t+1} \times \text{split})$$

1. **Mary Jo Harris:** A $2,000 reduction in July withdrawal increases July eligible capital by $2,000.00 $\implies$ +$62.60 July gross profit $\implies$ +$37.56 Mary Jo profit, +$25.04 commissions $\implies$ +$2,037.56 August opening equity.
2. **Gary Larson:** Setting August 1 active capital to $487,000.00 generates +$6,842.35 net trading gain in August $\implies$ $493,842.35 September opening equity.
3. **Jeannine Shaffar:** Voiding the $51,719.41 bogus deposit reduces July ending capital by -$52,771.64 and reduces July commission credits to recipients by -$251.82 $\implies$ reduces August opening capital across all 4 accounts by -$53,023.46 total.

---

## 4. Execution Risk Tiers

| Risk Tier | Definition | Candidates | Execution Architecture |
| :--- | :--- | :--- | :--- |
| **Tier 1** | Metadata Only | Kyle Landon (`open_date`) | Single-row CAS SQL update |
| **Tier 2** | Simple Source Transaction | Mary Jo Harris (`wd_e4fc9d89`), Jerry's Rogue Jets ($2,500 wd) | Single-row CAS update / Package B `create_withdrawal_atomic` |
| **Tier 3** | Cutover / Baseline Realignment | Gary Larson ($487k), Michael Landon ($10.8k), Michael Beck ($557.7k) | Isolated investor table CAS updates |
| **Tier 4** | Multi-Table Dependency Cascade | Jeannine Shaffar (`dep_e10ccd56` void + commissions) | Real PostgreSQL Atomic RPC with complete transactional rollback |

---

## 5. Package B Interaction & Auditability

* **Certified Boundary:** Package B is `PRODUCTION_CERTIFIED` and active.
* **New Transactions:** Any withdrawal inserted as part of historical reconciliation (e.g. Jerry's Rogue Jets $2,500) must call `create_withdrawal_atomic` with a unique idempotency key.
* **Historical Immutability:** Existing historical withdrawal IDs (`wd_e4fc9d89`, `wd_9a4f1219`, `wd_01d8c2cb`, `wd_4cf7131b`) remain intact and are modified only via auditable CAS updates.
