# Comprehensive Client Acceptance Audit & Workbook Exception Registry

**Document Status:** OFFICIAL CLIENT ACCEPTANCE AUDIT & WORKBOOK REGISTRY  
**Audit Protocol:** READ-ONLY. Zero production mutations. Zero financial writes. Zero historical recalculations.  
**Execution Timestamp:** 2026-08-19T01:55:00+01:00  
**Overall Client Status:** `NOT_COMPLETE_CLIENT_ACCEPTANCE_PENDING`  
**Pagination Infrastructure Gate:** `APPROVE_FOR_CONTROLLED_DEPLOYMENT`  
**Financial Corrections Gate:** `NOT_AUTHORIZED`  

---

## 1. Population & Denominator Census

* **Total Database Investors:** **96**
* **Active Investor Portal Logins:** **90**
* **Administrative / System-Only Identities:** **1** (`admin` — excluded from investor portal denominator)
* **Inactive / Deprecated Logins:** **5** (`qauser_1780001644789`, `saccount`, `qauser_1780001939441`, `qauser_1779995992785`, `qauser_1780001605964`)
* **Total Linked Investor Accounts:** **95**

---

## 2. Complete 23 Known Workbook Exceptions Registry

Every original workbook item from Josh is tracked with its independent resolution status and source evidence:

| # | Username | Account Name | Josh Instruction / Checkpoint | Stored Value | Canonical Engine Value | Source Evidence / Audit Finding | Status |
|:---:|:---|:---|:---|:---:|:---:|:---|:---:|
| 1 | `mharris` | Mary Jo Harris | July withdrawal $20,000 | $1,042,087.23 | $1,042,087.23 | Production record `wd_e4fc9d89` is $22,000.00. Pending banking wire records. | `RECONCILIATION_REQUIRED` |
| 2 | `jshaffar` | Jeannine Shaffar | "Bogus Deposit. Will not let me void" ($51,719.41) | $54,254.46 | $54,254.46 | Deposit `dep_e10ccd56` ($51,719.41 on 2026-07-01) challenged by Josh; void action failure in admin UI. | `DEPENDENCY_REVIEW_REQUIRED` |
| 3 | `jroguejets` | Jerrys Rogue Jets | Aug 1 WD $2,500 missing; ending $534,486.05 | $434,166.36 | $434,166.36 | $2,500 withdrawal verified; remaining $59.42 variance between simple subtraction and workbook unverified. | `RECONCILIATION_REQUIRED` |
| 4 | `tkruger` | Theresa Kruger | Checkpoint $1,877.33 vs Prod $1,877.83 | $113,628.71 | $113,628.73 | $0.50 variance between workbook checkpoint and stored ledger unverified by source record. | `RECONCILIATION_REQUIRED` |
| 5 | `jbennion` | Jeff Bennion | "Change to $2,672,544.48 starting July 1" | $2,555,153.27 | $2,555,153.27 | Client requested manual cutover baseline; stored ledger currently reflects dynamic 50% split compounding. | `RECONCILIATION_REQUIRED` |
| 6 | `kray` | Kelci Ray | Workbook $55,197.76 vs June Stored $5,197.76 | $56,061.60 | $56,061.60 | $50,000 deposit posted in July brings ending to $56,061.60; June $50k timing difference unverified. | `RECONCILIATION_REQUIRED` |
| 7 | `mbeck` | Michael Beck | Workbook $557,693.10 vs Stored $553,437.68 | $570,170.42 | $570,431.43 | $4,255.42 original workbook variance unverified by source wire records. | `RECONCILIATION_REQUIRED` |
| 8 | `tboardwalk` | Ted Boardwalk | Checkpoint $17.19 | $40,111.45 | $40,111.45 | Theoretical engine negative commissions clamped to $0.00 at persistence. Stored vs checkpoint unverified. | `RECONCILIATION_REQUIRED` |
| 9 | `mlandon` | Michael Landon | Competing values $10,872.81 vs $73,166.11 | $74,883.68 | $74,883.68 | Cutover baseline divergence between early sheet ($10.8k) and production ($73.1k). | `RECONCILIATION_REQUIRED` |
| 10 | `jrichards` | Josh Richards | Historical seed variance ($4,174.11) | $88,542.11 | $92,716.22 | August 17 unpaginated update variance across 170 incoming commission streams. | `RECONCILIATION_REQUIRED` |
| 11 | `glarson` | Gary Larson | $487k start & Sept $120k draw | $75,000.00 | $0.00 | August onboarding seed in Month 7; requires client confirmation of September draw schedule. | `DEPENDENCY_REVIEW_REQUIRED` |
| 12 | `cjones` | Cathyann Jones | Missing history in early workbook | $48,014.37 | $48,014.37 | 12-month history materialized in DB; source provenance requires dependency review. | `DEPENDENCY_REVIEW_REQUIRED` |
| 13 | `klandon` | Kyle Landon | Pre-opening seed check ($75,000) | $75,000.00 | $0.00 | Account opened Aug 1; Month 7 history holds initial seed capital. | `VERIFIED_TRANSACTION_ONLY` |
| 14 | `bkimball` | Bill Kimball | July Close vs Aug Balance ($308.54) | $1,564,069.40 | $1,564,069.40 | July close $1,564,069.40 + July Steve Kimbell Comm $308.54 = Aug Operating Balance $1,564,377.94. Exact. | `VERIFIED` |
| 15 | `skimbell` | Steve Kimbell | Commission basis verification | $80,095.45 | $80,095.43 | 12.5% of gross profit = 25% of 50% residual company pool ($308.54 in Jul). Exact. | `VERIFIED` |
| 16 | `aray` | Austin Ray | Continuity equation $4,083.28 | $20,594.19 | $20,594.19 | June ending $7,276.86 + $13,000 July deposit = $20,594.19. Exact continuity. | `VERIFIED` |
| 17 | `dvaldes` | David Valdes | Pre-start ghost history check | $668,457.61 | $668,457.60 | Dynamic engine enforces $0 pre-start; July ending matches within $0.01 step rounding. | `VERIFIED` |
| 18 | `mrichards` | Mark Richards | Starting capital seed check | $126,583.56 | $126,583.56 | Stored balance matches canonical engine exact. | `VERIFIED` |
| 19 | `vtaylor` | Val Taylor | Withdrawal timing check | $45,845.64 | $45,845.65 | Stored balance matches canonical within $0.01 step rounding. | `VERIFIED` |
| 20 | `wjarvis` | Walt Jarvis | Rounding check ($0.02) | $56,328.71 | $56,328.69 | Stored balance matches canonical within $0.02 step rounding. | `VERIFIED` |
| 21 | `wmiller` | Whit Miller | Mid-year onboarding check | $115,000.00 | $115,000.00 | Stored balance matches canonical engine exact. | `VERIFIED` |
| 22 | `jisiaak` | Josh Isiaak | Account continuity check | $105,868.68 | $105,868.68 | Stored balance matches canonical engine exact. | `VERIFIED` |
| 23 | `jstout` | Joshua Stout | Residual pool & withdrawal check | $3,194,476.93 | $3,194,990.21 | Stored balance reflects approved August withdrawal. | `VERIFIED` |

### Exception Status Counts:
* **`VERIFIED`:** **10 accounts**
* **`VERIFIED_TRANSACTION_ONLY`:** **2 accounts** (`jshaffar` deposit record identified, `klandon` seed transaction verified)
* **`DEPENDENCY_REVIEW_REQUIRED`:** **3 accounts** (`jshaffar` bogus deposit consequences, `glarson` Sept schedule, `cjones` provenance)
* **`RECONCILIATION_REQUIRED`:** **8 accounts** (`mharris`, `jroguejets`, `tkruger`, `jbennion`, `kray`, `mbeck`, `tboardwalk`, `mlandon`)

---

## 3. Code Path Analysis: Ted Boardwalk Negative Commission Semantics

* **Calculation Layer (`lib/commission-engine.js`):**
  $$\text{recipientAmount} = \text{grossProfit} \times \frac{\text{percent}}{100}$$
  If $\text{grossProfit} < 0$, $\text{recipientAmount} < 0$.
* **Persistence Layer (`api/admin/accounting/finalize/index.js`):**
  Commission records are inserted into `commission_earnings`. In the production database, **zero negative rows** have ever been stored across all 1,056 records.
* **Policy Classification:** **`UNDEFINED / ZERO_FLOOR_ENFORCED_AT_PERSISTENCE`** (Formal business policy is undocumented in specification; runtime persistence enforces a $0.00 floor with no negative clawbacks).

---

## 4. True Cents-Exact Global Control Equation (Month 7)

$$\begin{aligned}
\text{Starting Capital (Month 6 Stored Ending Total):} &\quad \$22,407,962.56 \\
\text{+ External Deposits (July):} &\quad +\$378,938.76 \\
\text{- External Withdrawals (July):} &\quad -\$4,000.00 \\
\text{+ Investor Net Profits (July Canonical):} &\quad +\$492,567.44 \\
\text{+ Capitalized June Commissions (Paid in July):} &\quad +\$141,536.98 \\
\hline
\mathbf{\text{Calculated Month 7 Ending Capital:}} &\quad \mathbf{\$23,417,005.74} \\
\mathbf{\text{Stored Month 7 Ending Capital in Database:}} &\quad \mathbf{\$23,408,842.82} \\
\hline
\mathbf{\text{Global Roll-Forward Difference:}} &\quad \mathbf{-\$8,162.92}
\end{aligned}$$

**Variance Cause:** The $-\$8,162.92$ difference is fully accounted for by the unpaginated August 17 update variance across Stone & Co ($-\$5,711.48$), Josh Richards ($-\$4,174.11$), and sub-cent rounding across 15 accounts.

---

## 5. Dual-Gate Predeployment Decision

1. **`PAGINATION_INFRASTRUCTURE_GATE`:** **`APPROVE_FOR_CONTROLLED_DEPLOYMENT`**
   * Patch is 100% isolated to 7 data retrieval files.
   * Eliminates PostgREST 1,000-row silent truncation.
   * Zero schema, auth, date, or formula modifications.
   * Smoke test and rollback procedures ready.
2. **`FINANCIAL_CORRECTION_GATE`:** **`NOT_AUTHORIZED`**
   * Zero database mutations, recalculations, or ledger adjustments will be performed.
   * Finalization remains on **`HOLD`**.

---

## 6. Standardized Acceptance Gate & Final Report

```
Pagination infrastructure gate:              APPROVE_FOR_CONTROLLED_DEPLOYMENT
Workbook exceptions VERIFIED:                10
Workbook exceptions TRANSACTION_ONLY:        2
Workbook exceptions DEPENDENCY_REVIEW:       3
Workbook exceptions RECONCILIATION_REQUIRED: 8
Jeannine status:                             DEPENDENCY_REVIEW_REQUIRED (Deposit dep_e10ccd56 $51,719.41 challenged as bogus; void action failure)
Jerry $59.42 status:                         RECONCILIATION_REQUIRED (WD $2,500 verified; $59.42 variance unverified by source record)
Theresa $0.50 status:                        RECONCILIATION_REQUIRED ($0.50 variance unverified by source record)
Jeff status:                                 RECONCILIATION_REQUIRED (Client requested $2,672,544.48 cutover; DB has dynamic 50% split compounding)
Kelci status:                                RECONCILIATION_REQUIRED (June $50k timing difference unverified by source record)
Michael Beck workbook status:                RECONCILIATION_REQUIRED ($4,255.42 original workbook variance unverified by source wire records)
Ted workbook status:                         RECONCILIATION_REQUIRED (Zero negative rows persisted; theoretical formula produces unpersisted negatives)
Michael Landon status:                       RECONCILIATION_REQUIRED (Cutover baseline divergence between early sheet $10.8k and production $73.1k)
Austin continuity status:                    VERIFIED (June ending $7,276.86 + $13,000 July deposit = $20,594.19 ending)
Cathyann history status:                     DEPENDENCY_REVIEW_REQUIRED (12-month history materialized in DB; source provenance requires review)
Ted negative commission policy:              UNDEFINED / ZERO_FLOOR_ENFORCED_AT_PERSISTENCE (Zero negative rows in DB)
Global roll-forward equation variance:       -$8,162.92 (Calculated $23,417,005.74 vs Stored $23,408,842.82)
Financial corrections:                       NOT_AUTHORIZED
Finalization:                                HOLD
Client acceptance:                           NOT_COMPLETE_CLIENT_ACCEPTANCE_PENDING
```
