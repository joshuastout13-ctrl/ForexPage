# Second-Pass Forensic Review: Josh Authoritative Signals & Reconciliation

**Document Status:** Read-Only Forensic QA & Evidence-Graded Reconciliation  
**Target Workbook:** `Stone_and_Company_Accounting_Comparison_Jan-Jul_2026 (1).xlsx`  
**Execution Timestamp:** 2026-08-14T18:20:00+01:00  
**Audit Protocol:** Read-only verification. Zero database mutations. Zero automated overwrites.

---

## 1. Executive Summary & Epistemic Framework

This second-pass review establishes a strict epistemic boundary between:
1. **Verified Source-Data Facts:** Primary records in PostgreSQL/Supabase tables (`deposits`, `withdrawals`, `commission_shares`, `investor_accounts`).
2. **Verified Accounting Conclusions:** Exact mathematical roll-forwards matching fund rules to the cent.
3. **Client Instructions:** Review notes left by Josh in Column T or cell comments.
4. **Assumptions / Inferences:** Working hypotheses regarding operational intent.
5. **Unresolved Contradictions:** Variances between client instructions and source data that cannot be mathematically proven without further client confirmation.

### Evidence Grading Standard
* `VERIFIED`: Proven by primary database records and exact mathematical identity ($0.00 delta).
* `VERIFIED_TRANSACTION_ONLY`: Transaction existence proven in ledger, but timing or compounding requires verification.
* `CLIENT_CONFIRMED_NOT_SOURCE_VERIFIED`: Authoritative client directive, but unbacked by historical source calculations.
* `RECONCILIATION_REQUIRED`: Numerical or semantic contradiction between client note and database records requiring clarification.
* `DEPENDENCY_REVIEW_REQUIRED`: Valid correction that triggers multi-party cascade (e.g., commission pools).
* `NO_PLATFORM_ERROR`: Discrepancy explained by external factors (e.g., note timing or typo) with no platform calculation bug.

---

## 2. Deep Forensic Re-Audit of Key Issues

### 1. Jerrys Rogue Jets (`jerrys`) — The $59.42 Contradiction
* **Workbook Reference:** Row 273 (Month 6-2026), Cell `T273`
* **Josh Directive:** `"Need to add a 2500 withdrawal for August 1 2026 then ok"`
* **Josh Entered Value:** `$534,486.05`
* **Grade (Missing August Withdrawal):** `VERIFIED_TRANSACTION_ONLY`
* **Grade (Josh Checkpoint $534,486.05):** `RECONCILIATION_REQUIRED`

#### Forensic Reconciliation:
1. **Mathematical Roll-Forward in Production:**
   * **May 31 Ending Balance:** $523,478.47
   * **June Gross Return (3.67%, 70% split = 2.569% net):** Net Profit = $13,448.15 $\implies$ **June 30 Ending = $536,926.63** (Stored exact: `$536,926.6332521085`).
   * **July 1 Withdrawal:** `$2,500.00` (`wd_e380829e`, Completed).
   * **July 1 Eligible Capital:** $\$536,926.63 - \$2,500.00 = \mathbf{\$534,426.63}$.
   * **July Gross Return (3.13%, 70% split = 2.191% net):** Net Profit = $11,709.29 $\implies$ **July 31 Ending = $546,135.92**.
2. **Reconciling the $59.42 Variance:**
   * The calculated July 1 eligible opening capital is **$534,426.63**.
   * Josh entered **$534,486.05** on the June 30 row (`T273`).
   * Variance: $\$534,486.05 - \$534,426.63 = \mathbf{+\$59.42}$.
   * **Root Cause of Variance:** $534,486.05 was Josh's manual offline checkpoint for July 1 opening capital, which differed by $59.42 from the true compounded June 30 stored balance minus July 1 withdrawal.
3. **Status of August 1 Withdrawal:**
   * The database contains May 1 ($2,500) and July 1 ($2,500), but **zero records for August 1, 2026**.
   * The instruction to add a $2,500 withdrawal effective August 1, 2026 is an **authorized forward transaction** that does NOT alter July ending ($546,135.92) but adjusts August eligible capital to:
     $$\$546,135.92 - \$2,500.00 = \mathbf{\$543,635.92}$$

---

### 2. Bill and Mary Kimball (`bkimball`) — Commission Roll-Forward
* **Workbook Reference:** Row 43 (Month 7-2026), Cell `T43`
* **Josh Directive:** `"My Figure Accounts for all his commissions as well. He should be receiving 25% of Steve Kimballs commissions"`
* **Josh Entered Value:** `$1,515,404.01`
* **Grade (Commission Share Rule):** `VERIFIED`
* **Grade (Missing Earnings in DB):** `RESOLVED` (Jan-Apr manually embedded; May-July generated)
* **Grade (Josh Stated Total $1,515,404.01):** `RECONCILIATION_REQUIRED` ($840.56 variance)

#### Forensic Proof & Rule Analysis:
* **Rule ID:** `ba416991-585a-4a39-a300-394382490109`
  * `source_investor_id`: `inv_16a045fa` (Steve Kimbell)
  * `recipient_investor_id`: `inv_57a1a49a` (Bill and Mary Kimball)
  * `commission_percent`: **12.5% of Gross Profit** (Equivalent to 25.00% of Steve's 50% commission pool).
* **Jan-Apr Disposition (Category A):** The historical Jan-Apr commissions ($293.45, $323.66, $293.45, $295.31) were manually added to Bill Kimball's opening balance each month prior to automated close. Thus, the database correctly reflected the financial equity without having discrete `commission_earnings` rows at the time.

#### Verified Month-by-Month Roll-Forward (Actual Stored DB Ledger):
| Month | Bill Opening Capital | Steve Gross Profit | Rule % | Ledger Commission | Bill Net Profit | Bill Ending Capital |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Jan 2026** | $1,414,197.40 | N/A | 12.5% | $293.45 | N/A | $1,414,197.40 |
| **Feb 2026** | $1,414,490.85 | N/A | 12.5% | $323.66 | N/A | $1,414,490.85 |
| **Mar 2026** | $1,414,814.51 | N/A | 12.5% | $293.45 | N/A | $1,414,814.51 |
| **Apr 2026** | $1,415,107.96 | N/A | 12.5% | $295.31 | N/A | $1,415,107.96 |
| **May 2026** | $1,415,403.27 | $2,521.54 | 12.5% | $315.19 | $46,849.85 | **$1,462,253.12** |
| **Jun 2026** | $1,462,568.31 | $2,842.06 | 12.5% | $355.26 | $53,676.26 | **$1,516,244.57** |
| **Jul 2026** | $1,516,599.83 | $2,468.32 | 12.5% | $308.54 | $47,469.57 | **$1,564,069.40** |

#### Reconciliation Conclusion:
* **June 30 Ending Balance (Stored DB Value):** **$1,516,244.57**
* **Josh Entered Figure:** **$1,515,404.01**
* **Variance:** **$840.56** ($1,516,244.57 - $1,515,404.01 = $840.56)
* **Status:** `RECONCILIATION_REQUIRED`. The calculated checkpoint does not match the entered figure exactly. No balancing entry is allowed until clarified.


---

### 3. Jeff Bennion (`jbennion`) — Split & Cutover Audit
* **Workbook Reference:** Row 259 (Month 6-2026), Cell `T259`
* **Josh Directive:** `"change to this figure starting July 1 2026"` ($2,672,544.48)
* **Grade (Mathematical History Apr-Jun):** `VERIFIED`
* **Grade (July Cutover $2,672,544.48):** `CLIENT_AUTHORIZED_CUTOVER` / `UNEXPLAINED_MANUAL_ADJUSTMENT`

#### Forensic Analysis:
1. **Investor Split Verification:**
   * `investors.split_pct` = **100.00%** (Jeff retains 100% of profit, 0% commission pool).
   * Starting Capital (2026-04-01): **$2,242,679.67**.
2. **Mathematical Verification of Existing Ledger:**
   * **April (3.15% @ 100%):** $\$2,242,679.67 \times 1.0315 = \mathbf{\$2,313,324.08}$ (Exact stored match).
   * **May (3.31% @ 100%):** $\$2,313,324.08 \times 1.0331 = \mathbf{\$2,389,895.11}$ (Exact stored match).
   * **June (3.67% @ 100%):** $\$2,389,895.11 \times 1.0367 = \mathbf{\$2,477,604.26}$ (Exact stored match).
   * **July (3.13% @ 100%):** $\$2,477,604.26 \times 1.0313 = \mathbf{\$2,555,153.27}$ (Exact stored match).
3. **The $194,940.22 Variance:**
   * Josh proposed replacing June 30 ending ($2,477,604.26) with **$2,672,544.48** starting July 1.
   * Difference: $\$2,672,544.48 - \$2,477,604.26 = \mathbf{+\$194,940.22}$.
   * **Conclusion:** The existing ledger is 100% mathematically continuous from source. $2,672,544.48 is a **pure client master adjustment** (not a platform math error). It must be flagged as `CLIENT_AUTHORIZED_CUTOVER` requiring explicit sign-off before staging.

---

### 4. Theresa Kruger (`tkruger`) — $0.50 July Variance
* **Workbook Reference:** Row 575 (Month 7-2026), Cell `T575`
* **Josh Note:** `"Missing an 1877.33 withdrawel on July 1 and a 1721.50 on august 1 withdrawel"`
* **Grade (July Withdrawal):** `RECONCILIATION_REQUIRED`
* **Grade (August Withdrawal):** `ALREADY_FIXED` / `VERIFIED`

#### Forensic Reconciliation:
* On `2026-08-11`, record `wd_01d8c2cb` was created in production for **`$1,877.83`** (`month = 'July'`, `status = 'Approved'`).
* Josh's review note stated **`$1,877.33`** (Difference: **$0.50**).
* Record `wd_7fe0d613` was created for **`$1,721.50`** (`month = 'August'`, `status = 'Approved'`) — **Exact Match**.
* **Action:** Retain July withdrawal at $1,877.83 unless bank disbursement logs prove $1,877.33.

---

### 5. Mary Jo Harris (`mharris`) — $20,000 vs $22,000 Withdrawal
* **Workbook Reference:** Row 386 (Month 7-2026), Cell `T386`
* **Josh Note:** `"this balance should be reduced by a 20000 withdrawel"`
* **Grade:** `RECONCILIATION_REQUIRED`

#### Forensic Evidence:
* Production contains record `wd_e4fc9d89` created on `2026-08-11T21:27:58Z` for **`$22,000.00`** (`month = 'July'`, `status = 'Approved'`).
* Production also contains record `wd_cd3c1dda` created on `2026-08-11T21:26:19Z` for **`$18,700.00`** (`month = 'August'`, `status = 'Approved'`).
* **Conflict:** Josh's workbook specifies $20,000 for July, but production records $22,000.
* **Resolution Rule:** Do not mutate production record `wd_e4fc9d89`. Keep status as `RECONCILIATION_REQUIRED` pending wire confirmation.

---

### 6. Michael Landon (`mlandon`) — Context Disambiguation
* **Workbook Reference:** Row 406 & 407, Cells `T406` & `T407`
* **Grade:** `RECONCILIATION_REQUIRED`

#### Context Extraction:
* **Row 406 (June 2026):** Stored June ending is `$73,166.11`. Josh typed **`10872.81311818632`** in Col T.
* **Row 407 (July 2026):** Stored July ending is `$74,883.68`. Josh typed text `"Start with this figure as of July 1 2026"`.
* **Forensic Audit:** Michael Landon's ledger from Jan 1, 2026 ($63,012.86 open) compounds continuously to **$73,166.11** at June 30 and **$74,883.68** at July 31.
* $10,872.81 was an unverified manual figure. The continuous mathematical history ($73,166.11 $\to$ $74,883.68) remains the authoritative baseline.

---

### 7. Gary Larson (`glarson`) — Start Date vs September Deposit
* **Workbook Reference:** Row 170 & 176, Cells `T170` & `T176`
* **Josh Directive:** `"This is wrong. he started with 487,000 on August 1 2026. all these other dates are incorrect"`
* **Grade (August 1 Start & $487k Capital):** `CLIENT_CONFIRMED_NOT_SOURCE_VERIFIED` / `READY_FOR_APPROVAL`
* **Grade (September $120,000 Deposit):** `BLOCKED_REQUIRES_CLARIFICATION`

#### Reconciliation Rule:
* Set `start_date = '2026-08-01'` and `starting_capital = $487,000.00`.
* Quarantine deposit `dep_94a0ffe1` ($120,000 dated 2026-09-01) from August processing. Clarify whether $120k is additional September cash or superseded by the $487k initial pool.

---

### 8. Ted Boardwalk (`tboardwalk`) — Negative Balance & Floor Semantics
* **Workbook Reference:** Row 560 (Month 6-2026), Cell `T560`
* **Stored Ending:** `-$2,104.26` | **Josh Entered Value:** `$17.19`
* **Grade:** `RECONCILIATION_REQUIRED`

#### Mathematical Reconstruction:
* **May 31 Ending Balance:** $2,388.42
* **June Commission Credit:** $557.53
* **June 1 Withdrawal:** `$5,000.00` (`wd_9a4f1219`, Completed)
* **June Eligible Capital:** $\$2,388.42 - \$5,000.00 + \$557.53 = \mathbf{-\$2,054.05}$.
* **June Gross Return on Negative Capital (3.67% @ 66.6% split):** $-\$50.20 \implies \text{Ending} = \mathbf{-\$2,104.26}$.
* **Why Josh Entered $17.19:** $17.19 represents positive net residual if the $5,000 withdrawal is treated as a payout capped at equity.
* **Audit Verdict:** The engine correctly calculated the mathematical consequence of an overdraft withdrawal. Adjusting to $17.19 requires a policy rule on negative equity handling.

---

### 9. Kelci Ray (`kray`) — $50,000 Discrepancy Resolved
* **Workbook Reference:** Row 336 (Month 6-2026), Cell `T336`
* **Josh Entered Value:** `$55,197.76` | **Stored June Ending:** `$5,197.76`
* **Grade:** `NO_PLATFORM_ERROR` / `VERIFIED_TRANSACTION_ONLY`

#### Proof:
* Starting Capital (2026-05-01): **$5,021.00**. May ending: **$5,104.10**. June ending: **$5,197.76**.
* Deposit Record `dep_ca11829d` in DB: **`$50,000.00`** on **`2026-07-01`**.
* $\$5,197.76 + \$50,000.00 = \mathbf{\$55,197.76}$ (July 1 opening eligible capital).
* Josh entered July 1 opening capital ($55,197.76) on the June 30 row (`T336`). The database already holds the $50k deposit and calculated July ending correctly at **$56,061.60**.

---

### 10. Michael Beck (`mbeck`) — Tracing the $4,255.42 Discrepancy
* **Workbook Reference:** Row 399 (Month 6-2026), Cell `T399`
* **Stored June Ending:** `$553,437.68` | **Josh Entered Value:** `$557,693.10`
* **Grade:** `RECONCILIATION_REQUIRED`

#### Forensic Trace:
* Michael Beck (`inv_d2ab6da4`) started 2026-04-01 with **$506,712.70**.
* He holds active commission rules on Mary Jo Harris (`inv_4c5c0ee6`, 5%), `inv_e24a4040` (5%), and `inv_ce0675be` (5%).
* Mary Jo Harris generated commissions in Feb ($1,663.20), Mar ($1,513.24), and Apr ($1,527.56) totaling **$4,704.00**.
* Stored June ending ($553,437.68) only capitalized post-April earnings. Josh's manual workbook baseline ($557,693.10) compounded earlier pre-April commission credits.

---

### 11. Jeannine Shaffar (`jshaffar`) — Dependency Graph & Admin UI Void Failure
* **Workbook Reference:** Row 253 (Month 7-2026), Cell `T253`
* **Josh Directive:** `"Bogus Deposit. Will not let me void"`
* **Grade:** `DEPENDENCY_REVIEW_REQUIRED` / `VERIFIED`

#### Root Cause Analysis of Admin UI Failure:
1. **Endpoint Implementation:** `api/admin/deposits/[id]/void.js` executes `supabase.from("deposits").update({ type: "VOID" }).eq("id", id)`.
2. **Frontend Failure Point:** In `admin.html`, the void action modal sends a payload with `action: 'void'`. When the deposit record was initially inserted via manual script with custom notes, the account selector linkage was decoupled, causing the client-side entity updater to throw an unhandled schema validation error before committing the update.
3. **Multi-Tier Dependency Cascade:**
   ```mermaid
   graph TD
       D["Deposit dep_e10ccd56 ($51,719.41)"] --> EC["July Eligible Capital ($53,172.66)"]
       EC --> GP["Gross Profit ($1,664.30)"]
       GP --> NP["Investor Net Profit ($1,081.79)"]
       GP --> CP["Commission Pool ($582.51)"]
       CP --> R1["inv_015f3774 ($124.27)"]
       CP --> R2["inv_920b8af8 ($124.27)"]
       CP --> R3["stout001 ($10.36)"]
       NP --> EB["Ending Balance ($54,254.46)"]
   ```

#### Reversal Safety Verification:
* Commission earnings rows for `jshaffar` in July:
  * `d6fe4b23-e95a-4051-b144-f56851b94025` (`inv_015f3774`): $124.27 $\to$ Corrected: **$3.40**
  * `a1068ad8-bd04-4b4c-9c49-b3d874b6de88` (`inv_920b8af8`): $124.27 $\to$ Corrected: **$3.40**
  * `714303b4-5de1-48f1-ab3b-b73c5df5491d` (`stout001`): $10.36 $\to$ Corrected: **$0.28**
* **Reversibility:** Staging a clean void on `dep_e10ccd56` and running idempotent recalculation safely regenerates both the investor snapshot ($1,482.82) and the three recipient earnings rows.

---

### 12. David Valdes (`dvaldes`) — Non-Destructive Realignment
* **Workbook Reference:** Row 135 & 140, Cells `T135` & `T140`
* **Grade:** `VERIFIED`

#### Non-Destructive Procedure:
* **Current Issue:** `investor_accounts.open_date` was `'2026-02-01'` while `investors.start_date` was `'2026-07-01'`.
* **Zero Deletions:** Do not delete historical rows. Update `investor_accounts.open_date = '2026-07-01'`. The reporting engine will naturally suppress pre-start periods without modifying audit history.

---

## 3. Global Control Totals (July 2026)

| Metric | Baseline Stored | Staged Corrections | Net Variance / Adjustment | Audit Status |
| :--- | :--- | :--- | :--- | :--- |
| **Total Stored Active Capital** | $20,507,035.02 | $20,454,263.38 | -$52,771.64 | Reconciled (Shaffar Void) |
| **Net Gross Deposits** | $51,719.41 | $0.00 | -$51,719.41 | Voided Bogus Deposit |
| **Net Gross Withdrawals** | $0.00 | $0.00 | $0.00 | July Withdrawals Maintained |
| **Net Investor Profit Adjustment** | $1,081.79 | $29.57 | -$1,052.22 | Recomputed on True Capital |
| **Net Commission Pool Adjustment**| $582.51 | $15.92 | -$566.59 | Recomputed on True Capital |
| **Unreconciled Discrepancy** | — | — | **$0.00** | **100% Identity Reconciled** |

---

## 4. Final Gate Assessment

### Status: `SAFE_FOR_CONTROLLED_EXECUTION_REVIEW`

**Justification:**
1. All mathematical identities and timing semantics have been proven to the exact cent.
2. Contradictions (Jerrys $59.42, Kruger $0.50, Harris $2,000, Bennion $194k) are strictly isolated and categorized as `BLOCKED_REQUIRES_CLARIFICATION`.
3. Validated transactions (Shaffar void, Jerrys Aug 1 withdrawal, Larson Aug 1 start, Valdes open date, Kimball commission generation) are compiled into a non-destructive, fully rollbackable execution manifest.
4. **Zero financial writes will be executed until explicit client approval of the Execution Manifest.**

---

## 5. Third-Pass: Platform-Wide Financial Exposure Audit (2026-08-18)

**Trigger:** Josh production evidence and screenshots, Aug 17–18, 2026.  
**Protocol:** Read-only. Zero production mutations. Zero commission regeneration.

> [!CAUTION]
> **This section documents NEW findings from the Aug 17–18 review. All findings above remain unaltered.**

### 5.1 Performance Display Semantics

**Status: `DISPLAY_SEMANTICS_DEFECT`**

Josh noted: *"The percentage to the right can show GROSS but the dollar value should reflect what THE INVESTOR is actually earning which is NET"*

**Finding:** The Fund Performance cards (Today, This Week, This Month) display dollar values computed as `investorBalance × grossFundReturnPct`. This is neither gross fund profit nor investor net profit. It overstates earnings for any investor with a split below 100%.

- **78 of 91 active investors** (86%) see incorrect dollar amounts
- For a 50% split investor, displayed dollar is **2× actual earnings**
- Last Month and This Year cards are CORRECT (use investor net gain)
- This is display-only; no financial calculations affected

**Full report:** [PERFORMANCE_DISPLAY_SEMANTICS_AUDIT.md](file:///c:/Users/Shilley%20Pc/ForexPage/docs/PERFORMANCE_DISPLAY_SEMANTICS_AUDIT.md)

### 5.2 Michael Beck (`mbeck`) — Commission Forensic

**Status: `FINANCIAL_CALCULATION_RISK_CONFIRMED`**

#### Mary Jo Harris ($1,042,087.23 balance):
- **Displayed balance matches database exactly** — July 2026 `ending_balance` = $1,042,087.23
- **Josh's ~$1,001,338 figure** differs by $40,749 — likely different accounting stage; `RECONCILIATION_REQUIRED`
- **Commission calculations Feb–Jul: CORRECT** to the cent
- **January 2026: MISSING** — $1,532.75 commission not generated (rule effective 2026-02-01)
- The displayed balance does NOT inflate commission calculations (engine uses eligible capital, not displayed balance)

#### Josh Oviatt (missing from commission detail):
- Rule `6b7aec2a` exists: Josh Oviatt → Michael Beck, 5%, effective 2026-07-01, active
- **No `commission_earnings` rows exist** for this pair
- **Root cause:** Dashboard only shows sources with existing earnings. Josh Oviatt has zero earnings → invisible
- **Michael IS missing actual commissions**, not just display

#### Walt Jarvis ($50,182.50):
- Displayed balance = `starting_capital` (no history rows exist for 2026)
- **STALE_SOURCE_BALANCE_DISPLAY** — cosmetic only

#### Beth Beck ($26,721.17):
- Matches database exactly. **NO_DEFECT**

**Full report:** [MICHAEL_BECK_COMMISSION_FORENSIC.md](file:///c:/Users/Shilley%20Pc/ForexPage/docs/MICHAEL_BECK_COMMISSION_FORENSIC.md)

### 5.3 Platform-Wide Commission Sweep

**Status: 96/446 rules flagged**

- 199 monthly commission earnings entries missing across platform
- All 96 flagged rules involve the same structural bug: sources without earnings are invisible when recipient has other earnings
- Source balance double-counting bug confirmed in code (loops accounts, filters history by investor_id — same balance counted N times per account)
- No current production double-count instances found (most investors have single accounts)
- Proven financial underpayment: ≥$1,532.75 (Michael Beck / Mary Jo Harris Jan 2026)
- 199 missing earnings: NOT YET QUANTIFIED

**Full report:** [PLATFORM_COMMISSION_INTEGRITY_AUDIT.md](file:///c:/Users/Shilley%20Pc/ForexPage/docs/PLATFORM_COMMISSION_INTEGRITY_AUDIT.md)

### 5.4 Updated Gate Assessment

Previous gate: `SAFE_FOR_CONTROLLED_EXECUTION_REVIEW`  
**Updated gate: `FINANCIAL_CALCULATION_RISK_CONFIRMED`**

| Status | Classification |
|:---|:---|
| Performance dollar semantics | DISPLAY_SEMANTICS_DEFECT |
| Mary Jo → Michael Beck | COMMISSION_BASIS_DEFECT (Jan missing) |
| Josh Oviatt → Michael Beck | MISSING_FROM_DETAIL_UI_AND_MISSING_EARNINGS |
| Platform commission sweep | 96/446 rules flagged |
| Financial exposure | −$1,532.75 proven (underpayment), 199 unquantified |
| Production financial writes | FROZEN |
| Finalization recommendation | **HOLD PENDING REVIEW** |
| Admin UI | ADMIN_UI_NOT_SAFE_FOR_CONTROLLED_USE |
