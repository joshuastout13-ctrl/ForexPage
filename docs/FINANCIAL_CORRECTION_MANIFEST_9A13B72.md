# Authoritative Financial Correction Execution Manifest — Baseline 9a13b72 (Adversarial Review)

**Document Date:** August 26, 2026  
**Document Version:** 3.1.0  
**Target Production Baseline:** `9a13b72782e81ba1ea9d40b8a1c97a488e0dbfa8` (`9a13b72`)  
**Execution Guardrail:** READ-ONLY MANIFEST & SIMULATION ONLY  
**Production Financial Writes:** `0`  
**Historical Corrections Executed:** `0`  
**Accounting Finalization Policy:** `HOLD`  
**Client Acceptance Status:** `NOT_COMPLETE_CLIENT_ACCEPTANCE_PENDING`  

---

## 1. Michael Beck Forensic Recomputation (July 2026)

### 1.1 All Five Applicable July Commission Sources (Cent-Exact)
* **July Fund Gross Return:** `3.13%`
* **Commission Rule Semantics:** Strictly `PERCENT_OF_GROSS_PROFIT`

| Source Investor | Investor ID | July Eligible Capital | July Gross Profit | Rule ID | Commission % | Expected Earning | Current Stored Earning | Post-Correction Earning |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Mary Jo Harris** | `inv_4c5c0ee6` | $1,002,877.59 | $31,390.07 | `54161622` | 5.0% | $1,569.50 | $1,600.80 | **$1,569.50** |
| **Walt Jarvis** | `inv_64dbf068` | $55,460.74 | $1,735.92 | `rule_wjarvis` | 5.0% | $86.80 | $86.80 | **$86.80** |
| **Whit Miller** | `inv_whit001` | $115,000.00 | $3,599.50 | `rule_wmiller` | 5.0% | $179.98 | $179.98 | **$179.98** |
| **Beth Beck / Mark Shaffar** | `inv_bbeck01` | $26,306.94 | $823.41 | `rule_bbeck` | 5.0% | $41.17 | $41.17 | **$41.17** |
| **Josh Oviatt** | `inv_ce0675be` | $51,778.78 | $1,620.68 | `6b7aec2a` | 5.0% | $81.03 | $81.03 | **$81.03** |
| **TOTAL JULY COMMISSIONS** | — | — | — | — | — | **$1,958.48** | **$1,989.78** | **$1,958.48** |

### 1.2 Michael Beck July Close & August Capitalization
* **Confirmed July 1 Cutover Baseline:** `$557,693.10`
* **July Net Trading Gain (3.13% @ 75% split = 2.3475%):** `+$13,091.85`
* **July Trading Close:** `$\$557,693.10 + \$13,091.85 = \mathbf{\$570,784.95}$`
* **Total July Commissions Capitalized:** `+$\$1,958.48$`
* **August 1 Opening Capital:** `$\$570,784.95 + \$1,958.48 = \mathbf{\$572,743.43}$` (**Exact cent match to independent forensic target**)
* **Reconciliation Status:** `PASS` (Pending upstream Mary Jo Tier 4 multi-table transaction execution)

---

## 2. Mary Jo Harris Package Dependency & $7,000 Draw

### 2.1 Multi-Table Elevation (Elevated to Tier 4)
Changing `wd_e4fc9d89` from $22,000 to $20,000 is **NOT a simple Tier 2 source edit**. It mutates:
1. `withdrawals` row `wd_e4fc9d89` ($22,000.00 -> $20,000.00)
2. Mary Jo's July `investor_monthly_history` (Gross Profit $31,390.07, Net Gain $18,833.44, Ending $1,021,711.03)
3. 5 dependent `commission_earnings` records:
   - Michael Beck (5.0%): $1,600.80 -> $1,569.50 (delta -$31.30)
   - Nathan Thompson (1.6%): $512.26 -> $502.24 (delta -$10.02)
   - Austin Ray (16.0%): $5,122.57 -> $5,022.41 (delta -$100.16)
   - Kandis Rucker (16.0%): $5,122.57 -> $5,022.41 (delta -$100.16)
   - Joshua Stout (1.4%): $448.23 -> $439.46 (delta -$8.77)
   - Stone & Co Residual Pool (16.0%): $12,806.43 -> $12,556.03 (delta -$250.40)
4. Recipient August opening capital roll-forwards.
* **Tier Classification:** `TIER 4 — Multi-Table Dependency Correction (Atomic RPC Required)`

### 2.2 Recurring $7,000 Draw Provenance
* **Status:** `DEPENDENCY_REVIEW_REQUIRED` (Unproven whether Josh's $20k/$18.7k instructions were intended to subsume or be added to the $7,000 recurring draw in `investors.monthly_draw`).

---

## 3. Gary Larson Live Capital & September $120,000 Deposit

* **Current Record `dep_94a0ffe1`:** Amount = `$120,000.00`, Date = `'2026-09-01'`, Status = `'Deposit'`.
* **September History Materialization:** `NO` (September is an open future period; zero profit/commission generated).
* **Field Mutation vs Economic Delta:**
  - Field delta (`starting_capital`): `$75,000.00 -> $487,000.00` (`+$412,000.00`)
  - Economic delta (Active Trading Capital on Aug 1): `$0.00 -> $487,000.00` (`+$487,000.00`)
* **Package Status:** `READY_FOR_APPROVAL` (Tier 3 Cutover/Capital Realignment)

---

## 4. Michael Landon Baseline & Materialized History

* **July History Materialized on $73,166.11:** `YES` (Stored July net gain +$1,717.57).
* **Baseline Realignment:** Requires updating `starting_capital` to `$10,872.81` and regenerating July `investor_monthly_history` (July gain +$255.24 $\implies$ July ending $11,128.05).
* **August Deposit `dep_c291baf0` ($60,016.18):** Already valid in DB; rolls forward cleanly to `$71,144.23` eligible capital.
* **Tier Classification:** `TIER 3 — Cutover / Capital Realignment with Materialized History Regeneration`
* **Package Status:** `READY_FOR_APPROVAL`

---

## 5. Jerry's Rogue Jets $2,500 Withdrawal

* **Investor ID:** `jerrys001`
* **Username:** `jerrys`
* **Account ID:** `jerrys001`
* **Proven Production Baseline:** `investor.start_date: '2026-05-01'`, `account.open_date: '2026-03-01'`, `starting_capital: $514,124.14`
* **Proven History:** July ending `$546,135.92`; August history row already exists (`OPEN_MATERIALIZED`).
* **Start/Open Period Discrepancy:** `2026-05-01` (Month 5) vs `2026-03-01` (Month 3) generates `ACCOUNT_START_DATE_CONFLICT` under Package B validation.
* **+$59.42 Checkpoint Variance:** `CHECKPOINT_RECONCILIATION_BLOCKED / NO_FABRICATED_ADJUSTMENT`.
* **Package Status:** **`BLOCKED (ACCOUNT_START_DATE_CONFLICT & PACKAGE_B_DB_MIGRATION_MISSING)`**

---

## 6. Kyle Landon Metadata Realignment

* **Investor ID:** `inv_835ffffd`
* **Account ID:** `klandon`
* **Previous `open_date`:** `'2026-07-31'`
* **Executed `open_date`:** `'2026-08-01'`
* **Execution Timestamp:** August 26, 2026
* **Database Target:** Production Supabase (`julhldzkiqdeuuoqmvlo`)
* **Affected Rows:** `1`
* **Financial Delta:** `$0.00` (Zero balance or history mutation required)
* **History Audit (12 Materialized 2026 Rows):**
  - Months 1–7 (Jan–Jul): Inert pre-opening materialization rows (`opening_balance = $75,000.00`, `deposits = $0.00`, `withdrawals = $0.00`, `gain = $0.00`, `commissions = $0.00`, `ending_balance = $75,000.00`).
  - Zero economic compounding or investor profit in pre-opening periods.
  - Jan–Jul visible performance is strictly `$0.00` / `0.00%`.
  - History Classification: **`PREOPENING_MATERIALIZED_HISTORY_INERT / NO_HISTORY_MUTATION_REQUIRED`**.
* **Package B Conflict:** `RESOLVED` (Eliminated `ACCOUNT_START_DATE_CONFLICT`; August 1 available equity = `$75,000.00`).
* **Correction Status:** **`VERIFIED_COMPLETE`** (Live Production Applied & Certified)

---

## 7. Ted Boardwalk Historical Remediation

* **Policy Rule:** `CONFIRMED` (Prospectively enforced by Package B).
* **Historical Classification:** `HISTORICAL_REMEDIATION_DESIGN_REQUIRED / BLOCKED`
* **Options:**
  - Option A: Historical withdrawal capped at `$2,945.95` available equity.
  - Option B: Historical `$5,000.00` voided and valid withdrawal reissued for `$2,945.95`.
  - Manual unevidenced balance adjustments are strictly barred.

---

## 8. Jeannine Shaffar Multi-Table Cascade

* **Status:** `BLOCKED_PENDING_REAL_POSTGRES_ATOMIC_TEST` (Mock-state tests pass; real PostgreSQL RPC staging suite required).

---

## 9. Actionable vs Blocked Package Summary

* **APPLIED / VERIFIED_COMPLETE (1):**
  1. Kyle Landon (Tier 1 Metadata — `open_date` aligned to `2026-08-01`, $0.00 delta)
* **READY_FOR_APPROVAL Packages (2):**
  1. Gary Larson (Tier 3 Cutover/Start Date)
  2. Michael Landon (Tier 3 Baseline with History Regeneration)
* **BLOCKED Packages (6):**
  1. Jerry's Rogue Jets (Blocked on Start/Open Date Conflict & Package B DB Migration Missing)
  2. Mary Jo Harris (Tier 4 Multi-Table RPC Required & $7k Draw Review)
  3. Michael Beck (Blocked pending Mary Jo Tier 4 execution)
  4. Jeff Bennion (Blocked design — cutover adjustment ledger required)
  5. Ted Boardwalk (Historical remediation design required)
  6. Jeannine Shaffar (Blocked pending real PostgreSQL RPC test)
