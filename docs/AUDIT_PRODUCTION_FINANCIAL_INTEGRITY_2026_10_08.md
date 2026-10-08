# 4XTrack — Complete Production Financial Integrity Audit Report

**Audit Execution Date:** 2026-10-08  
**Repository:** `joshuastout13-ctrl/ForexPage` (`4xtrack.com`)  
**Production Host:** `https://4xtrack.com`  
**Authoritative Supabase Project ID:** `julhldzkiqdeuuoqmvlo` (`Stone - Forex`)  
**Audit Scope:** 100% Full Population Read-Only Financial Audit across all 108 Investor Accounts  
**Audit Status:** **FAIL** (Triggered by 2 P0 duplicate active deposits and associated September ledger overstatements)  

---

## EXECUTIVE SUMMARY & AUDIT SCORECARD

| Metric | Certified Audit Result | Status / Evaluation |
|---|---|---|
| **Production Project Verified** | `julhldzkiqdeuuoqmvlo` | **VERIFIED & AUTHORITATIVE** |
| **Full Investor Population** | 109 records (108 Financial Accounts + 1 Admin) | **100% ENUMERATED** |
| **Financial Accounts Audited** | 108 accounts | **100% AUDITED** |
| **Accounts Reconciled Successfully** | 105 accounts | **97.2% CLEAN RECONCILIATION** |
| **Accounts with Financial Discrepancies** | 3 accounts (`krucker`, `nwaite`, `tboardwalk`) | **FLAGGED FOR REMEDIATION** |
| **Confirmed Financial Variance** | **$17,870.16** (Net ledger overstatement) | **CONFIRMED & ISOLATED** |
| **P0 Findings** (Critical Corruption / Duplication) | **2** | Duplicate active deposits in September 2026 |
| **P1 Findings** (Balance / Ledger Discrepancies) | **3** | Ledger balance overstatements & 1 unlocked active month |
| **P2 Findings** (Reporting / Metadata Inconsistencies) | **13** | Stale metadata columns, pre-start unlocked placeholders, unpaired legacy transfer credits |
| **P3 Findings** (Display / Documentation) | **0** | Display contracts verified |
| **Control Accounts Verified** | 7 out of 7 controls match | **100% PASS** |

---

## 1. CONTROL-ACCOUNT VERIFICATION RESULTS (PHASE 5)

All 7 production financial control targets specified by management were independently audited and verified against authoritative production Supabase records:

| Control Target | Account / Ref | Expected Value | Production Verified Value | Status |
|---|---|---|---|---|
| **Josh Stout — Settled Balance** | `stout001` (`jstout`) | $3,400,953.52 | $3,400,953.52 | **PASS (100% MATCH)** |
| **Josh Stout — Certified External Cash** | `stout001` | $1,606,090.00 | $1,606,090.00 (`dep_stout001_hist_prov_1606090`) | **PASS (100% MATCH)** |
| **Josh Stout — Provenance Status** | `stout001` | COMPLETE | COMPLETE | **PASS (100% MATCH)** |
| **Josh Stout — September Commission** | `stout001` | $11,487.85 | $11,487.85 (14 active recipient rows) | **PASS (100% MATCH)** |
| **Josh Stout — Lifetime Withdrawals** | `stout001` | $40,000.00 | $40,000.00 (2 settled withdrawals of $20k) | **PASS (100% MATCH)** |
| **Ted Boardwalk — Sep 1 Cutover** | `tboardwalk` | $0.00 | $0.00 (`cutover_inv_a79798ca_2026_9`) | **PASS (100% MATCH)** |
| **Ted Boardwalk — September History** | `tboardwalk` | Open=$0, Gain=$0, End=$0 | Open=$0.00, Gain=$0.00, End=$0.00 | **PASS (100% MATCH)** |
| **Ted Boardwalk — September Commission** | `tboardwalk` | $1,702.78 | $1,702.78 (7 active recipient rows) | **PASS (100% MATCH)** |
| **Ted Boardwalk — Current Settled Balance** | `tboardwalk` | $1,702.78 | $1,702.78 ($0 + $1,702.78 capitalized) | **PASS (100% MATCH)** |
| **Ted Boardwalk — June $5k Withdrawal** | `wd_9a4f1219` | Preserved ($5,000.00) | Preserved: `status='Completed'`, `amount=5000` | **PASS (100% MATCH)** |
| **David Townley — Settled Balance** | `dtownley` | $38,223.16 | $38,223.16 | **PASS (100% MATCH)** |
| **David Townley — September Commission** | `dtownley` | $2,270.21 | $2,270.21 (11 active recipient rows) | **PASS (100% MATCH)** |
| **Sheryl Ryan Dunnam — September Open** | `inv_7dc0fe9a` | $60,000.00 | $60,000.00 | **PASS (100% MATCH)** |
| **Sheryl Ryan Dunnam — September Gain** | `inv_7dc0fe9a` | $921.00 | $921.00 ($60,000 × 3.07% × 50%) | **PASS (100% MATCH)** |
| **Sheryl Ryan Dunnam — September End** | `inv_7dc0fe9a` | $60,921.00 | $60,921.00 | **PASS (100% MATCH)** |
| **Ryan Ringer — Certified External Cash** | `rringer` | $125,000.00 | $125,000.00 (`dep_inv_1f9ab366_hp_ae8b1878`) | **PASS (100% MATCH)** |
| **Ryan Ringer — Provenance Status** | `rringer` | COMPLETE | COMPLETE | **PASS (100% MATCH)** |
| **Jerry → Stout — September Transfer** | `XFER-2026-00005` | $2,500.00 | Debit=$2,500.00, Credit=$2,500.00 | **PASS (100% MATCH)** |
| **Jerry → Stout — External Cash Impact** | `XFER-2026-00005` | $0.00 | $0.00 (`INTERNAL_TRANSFER` treatment) | **PASS (100% MATCH)** |
| **Stout May Exception** | `dep_454fb0c9` | $7,500.00 active | Active=$7,500.00, Voided=$7,500.00 (`dep_stout001_1`) | **PASS (100% MATCH)** |

---

## 2. DETAILED AUDIT FINDINGS (PHASE 7 CLASSIFICATION)

### P0 Findings: Critical Financial Corruption / Duplicate Transactions

#### Finding P0-01: Duplicate Active Economic Deposit — Kevin Rucker (`inv_7e7dcda2`)
- **Account ID:** `krucker` / `inv_7e7dcda2`
- **Investor Name:** Kevin Rucker
- **Affected Period:** September 2026
- **Expected Value:** Single economic deposit of $5,000.00
- **Actual Value:** Two active deposit rows for $5,000.00 each ($10,000.00 total)
- **Exact Principal Variance:** $5,000.00
- **Authoritative Supporting Records:**
  - Row 1: `dep_29b84085` (created 2026-09-02T01:46:51Z, amount $5,000.00, date 2026-09-01, type 'Wire', status 'confirmed', treatment 'UNVERIFIED_LEGACY', idempotency_key 'legacy_dep_29b84085').
  - Row 2: `dep_10f79b13` (created 2026-09-18T02:47:44Z by `admin_user`, amount $5,000.00, date 2026-09-01, type 'Wire', status 'confirmed', treatment 'NEW_CASH', idempotency_key 'e2880eda-b3ce-423f-a921-9e1f5c650518').
- **Root Cause:** When `admin_user` performed batch entries on September 18, 2026, the new row `dep_10f79b13` was entered without marking the pre-existing legacy row `dep_29b84085` as `VOID`.
- **Downstream Ledger Impact:** September 2026 history recorded `deposits = $10,000.00`. This overstated Kevin Rucker's September eligible capital by $5,000.00, generating $76.75 in false trading gain ($5,000 × 3.07% × 50% split). Kevin's September ending balance and current settled balance are overstated by **$5,076.75** ($210,911.04 actual vs $205,834.29 expected).
- **Recommended Correction:** Update row `dep_29b84085` in table `deposits` to `type = 'VOID'` and `status = 'void'` with audit notes. Re-settle September 2026 history ending balance to $205,834.29.
- **Requires Josh Stout Authorization:** **YES**.

#### Finding P0-02: Duplicate Active Economic Deposit — Neal Waite (`inv_d8b5ab06`)
- **Account ID:** `nwaite` / `inv_d8b5ab06`
- **Investor Name:** Neal Waite
- **Affected Period:** September 2026
- **Expected Value:** Single economic deposit of $12,600.00
- **Actual Value:** Two active deposit rows for $12,600.00 each ($25,200.00 total)
- **Exact Principal Variance:** $12,600.00
- **Authoritative Supporting Records:**
  - Row 1: `dep_d75d7f29` (created 2026-09-04T23:30:50Z, amount $12,600.00, date 2026-09-01, type 'Internal Transfer', status 'confirmed', treatment 'UNVERIFIED_LEGACY', idempotency_key 'legacy_dep_d75d7f29').
  - Row 2: `dep_576913ae` (created 2026-09-18T02:46:47Z by `admin_user`, amount $12,600.00, date 2026-09-01, type 'Wire', status 'confirmed', treatment 'NEW_CASH', idempotency_key 'df840d6b-8a3c-494e-9bb6-38fcc65f8562').
- **Root Cause:** When `admin_user` entered wire deposit `dep_576913ae` on September 18, 2026, the pre-existing legacy record `dep_d75d7f29` was not voided.
- **Downstream Ledger Impact:** September 2026 history recorded `deposits = $25,200.00`. This overstated Neal Waite's September eligible capital by $12,600.00, generating $193.41 in false trading gain ($12,600 × 3.07% × 50% split). Neal's September ending balance and current settled balance are overstated by **$12,793.41** ($560,959.66 actual vs $548,166.25 expected).
- **Recommended Correction:** Update row `dep_d75d7f29` in table `deposits` to `type = 'VOID'` and `status = 'void'` with audit notes. Re-settle September 2026 history ending balance to $548,166.25.
- **Requires Josh Stout Authorization:** **YES**.

---

### P1 Findings: Incorrect Investor Balance & Period Locking Inconsistencies

#### Finding P1-01: Overstated Ending Balance — Kevin Rucker (`inv_7e7dcda2`)
- **Account ID:** `krucker`
- **Investor Name:** Kevin Rucker
- **Affected Month:** September 2026 & October 2026
- **Expected Settled Ending Balance:** $205,834.29
- **Actual Stored Ending Balance:** $210,911.04
- **Exact Difference:** +$5,076.75 (Overstated)
- **Supporting Records:** `investor_monthly_history` row `9db09d37-8854-4682-8406-8cba9fe9fce7` (September 2026).
- **Root Cause:** Compounding effect of duplicate deposit Finding P0-01.
- **Recommended Correction:** Adjust September ending balance and October opening balance to $205,834.29 upon Josh Stout authorization.
- **Requires Josh Stout Authorization:** **YES**.

#### Finding P1-02: Overstated Ending Balance — Neal Waite (`inv_d8b5ab06`)
- **Account ID:** `nwaite`
- **Investor Name:** Neal Waite
- **Affected Month:** September 2026 & October 2026
- **Expected Settled Ending Balance:** $548,166.25
- **Actual Stored Ending Balance:** $560,959.66
- **Exact Difference:** +$12,793.41 (Overstated)
- **Supporting Records:** `investor_monthly_history` row `20ca0998-8819-41f1-8e9c-112c48c54850` (September 2026).
- **Root Cause:** Compounding effect of duplicate deposit Finding P0-02.
- **Recommended Correction:** Adjust September ending balance and October opening balance to $548,166.25 upon Josh Stout authorization.
- **Requires Josh Stout Authorization:** **YES**.

#### Finding P1-03: Unlocked September History Record for Active Investor — Reagan Ruddell (`inv_9a4326e7`)
- **Account ID:** `rruddell` / `inv_9a4326e7`
- **Investor Name:** Reagan Ruddell
- **Affected Month:** September 2026
- **Expected Value:** `locked: true`
- **Actual Value:** `locked: false`
- **Exact Difference:** Status mismatch
- **Supporting Records:** `investor_monthly_history` row `996cf8bf-811c-4b53-bc20-94d7ee825227` (September 2026: Open=$2,000.00, Return=3.07%, End=$2,061.40).
- **Root Cause:** Account activated September 1, 2026 (`start_date = '2026-09-01'`). During platform-wide September lock deployment, this record was omitted from the locking update.
- **Recommended Correction:** Set `locked = true` on `investor_monthly_history` for `inv_9a4326e7` in September 2026.
- **Requires Josh Stout Authorization:** **NO** (Standard operational locking policy).

---

### P2 Findings: Reporting, Provenance & Metadata Inconsistencies

#### Finding P2-01: Stale `total_cash_in` Column in `investor_accounts` — Josh Stout (`stout001`)
- **Account ID:** `stout001`
- **Investor Name:** Josh Stout
- **Affected Column:** `investor_accounts.total_cash_in`
- **Expected Value:** $1,606,090.00 (Certified Outside Cash)
- **Actual Value:** $1,625,000.00
- **Exact Difference:** $18,910.00
- **Supporting Records:** `investor_accounts` row `stout001`, `deposits` row `dep_stout001_hist_prov_1606090`. Note: Live dashboard correctly displays $1,606,090.00 because `lib/dashboard.js` computes total external cash dynamically from the `deposits` table.
- **Root Cause:** When certified external cash of $1,606,090.00 was recorded in `deposits` on October 1, 2026, the static metadata column in `investor_accounts` was not updated.
- **Recommended Correction:** Update `investor_accounts.total_cash_in` to `1606090.00`.
- **Requires Josh Stout Authorization:** **YES**.

#### Finding P2-02: Dashboard Withdrawal Card Pre-Activation Filter — Ted Boardwalk (`tboardwalk`)
- **Account ID:** `tboardwalk` / `inv_a79798ca`
- **Investor Name:** Ted Boardwalk
- **Affected Card:** Dashboard Summary Card: Lifetime Withdrawals
- **Expected Value:** $5,000.00 (Preserving June 1, 2026 withdrawal `wd_9a4f1219`)
- **Actual Value:** $0.00
- **Exact Difference:** $5,000.00
- **Supporting Records:** `withdrawals` row `wd_9a4f1219` (status 'Completed', amount $5,000.00, date 2026-06-01), `investors` row `inv_a79798ca` (`start_date = '2026-07-01'`).
- **Root Cause:** In `lib/dashboard.js`, `calculateLifetimeSettledWithdrawals` receives `accountStartDate = investor.start_date`. Because Ted's `start_date` was set to `2026-07-01` during the July cutover configuration, the engine excludes the June 1 withdrawal as `PRE_ACTIVATION`.
- **Recommended Correction:** Update `investors.start_date` for `inv_a79798ca` to `2026-06-01` (or account inception `2026-01-01`), allowing the preserved June withdrawal to display on the card without altering his September 1 $0.00 cutover baseline.
- **Requires Josh Stout Authorization:** **YES**.

#### Findings P2-03 through P2-09: Unlocked Pre-Activation Placeholder Rows in September History (7 Accounts)
- **Affected Accounts:**
  1. `inv_f10e726b` (`krichards`, Kevin Richards: `start_date = '2026-10-01'`)
  2. `inv_693b8042` (`jfuller`, Jack Fuller: `start_date = '2026-10-01'`)
  3. `inv_a2c39aca` (`tharris`, Todd Harris: `start_date = '2026-10-01'`)
  4. `inv_a829dff6` (`kdodge`, Kathy Dodge: `start_date = '2026-10-01'`)
  5. `inv_319139cb` (`areid`, Ash Reid: `start_date = '2026-10-01'`)
  6. `inv_190ecb1d` (`dfields`, Donald Fields: `start_date = '2026-10-01'`)
  7. `inv_9a40740d` (`taceves`, Tommy Aceves: `start_date = '2026-11-01'`)
- **Observation:** Each account has a September 2026 history row with `locked = false`. Because their start dates are in October or November, their September eligible capital and gains were $0.00.
- **Recommended Correction:** Set `locked = true` on historical closed periods for all placeholder records to maintain locked-period immutability invariants.
- **Requires Josh Stout Authorization:** **NO**.

#### Findings P2-10 through P2-13: Unpaired Legacy Internal Transfer Credit Rows (4 Deposits)
- **Affected Deposits:**
  1. `dep_100584c0` — David Valdes (`inv_df9fbf05`), $270,070.41 on 2026-08-01 (type 'Internal Transfer', `transfer_id: null`).
  2. `dep_92fecb56` — Josh Stout (`stout001`), $2,500.00 on 2026-08-01 (type 'Internal Transfer', unlinked to Jerry's August withdrawal `wd_jerrys_20260801_d00164e8`).
  3. `dep_d75d7f29` — Neal Waite (`inv_d8b5ab06`), $12,600.00 on 2026-09-01 (type 'Internal Transfer', also flagged under P0-02).
  4. `dep_ec135490` — Austin Ray (`inv_1531b890`), $7,000.00 on 2026-08-01 (type 'Internal Transfer', `transfer_id: null`).
- **Observation:** Legacy deposits imported with label "Internal Transfer" lack formal counterpart debit withdrawal records or `transfer_id` linkage.
- **Recommended Correction:** Audit and link counterpart debit legs with Josh Stout, or update labels to reflect direct outside capital contributions where appropriate.
- **Requires Josh Stout Authorization:** **YES**.

---

## 3. LOCKED-PERIOD INTEGRITY ASSESSMENT (PHASE 4)

### September 2026 Closed Period Audit
1. **Fund Gross Return:** Persisted in `monthly_returns` at **+3.07%**, source `"Certified Final Close (Josh Stout Authorized)"`, with `locked: true`.
2. **Investor Historical Protection:** 100 out of 109 investor monthly history records are protected with `locked: true`. Only 1 active account (`rruddell`, Finding P1-03) and 7 post-September pre-activation accounts (Finding P2-03) were unlocked.
3. **Commission Ledger Preservation:** All September commission earnings (1,985 total rows across platform) are preserved. September commission earnings totaled **$42,047.37** across all affiliate recipients.
4. **October Capitalization:** October opening balances incorporate September earned commissions exactly once. For example:
   - Ted Boardwalk: September close $0.00 + September commissions $1,702.78 = October opening $1,702.78.
   - David Townley: September close $35,952.95 + September commissions $2,270.21 = October opening $38,223.16.

### October 2026 Current Open Month Audit
1. **Live Feed Informational Status:** October gross return in `monthly_returns` is **0.95%** (auto-synced from Myfxbook), with `locked: false`.
2. **Settled Balance Protection:** Open October trading gains contribute strictly **$0.00** to settled balances. Live dashboard `currentBalance` reflects settled cashflows only.
3. **Commission Capitalization Prohibition:** October commissions are accruing intramonth and have contributed **$0.00** to settled balances. Capitalization will occur in November following October final close.

### October 1 Rollover Incident Post-Mortem & Vulnerability Review
- **Incident Summary:** On October 1, 2026 at 05:42:26 UTC (September 30, 22:42 PDT), upstream Myfxbook rolled over its monthly gain counter to 0.00% before fund accounting in `America/Los_Angeles` had crossed midnight.
- **Vulnerability Inspection:** Codebase audit confirms that layered defenses deployed in commit `9e46f6a` prevent recurrence:
  1. `utcPeriod > ptPeriod` comparison in `syncOpenMonthlyReturn` (`lib/supabase.js`) detects timezone rollover races and blocks premature overwrite.
  2. `evaluateMonthState() === HISTORICAL_SETTLED` blocks overwriting settled months.
  3. `locked === true` blocks overwriting finalized rows.
  4. Unit test suite `tests/test_audit_hardening_and_rollover_regression.js` validates 324 adversarial combinations; all 9 test suites pass.

---

## 4. DASHBOARD-VERSUS-LEDGER COMPARISON (PHASE 6)

Every investor account was evaluated by calling:
```javascript
buildInvestorDashboard(account, preloadedData, { mustBeAuthoritative: true });
```
With `DATA_SOURCE=supabase` and `isAuthoritativeProductionDbConfigured() === true`.

- **Settled Current Balance Agreement:** **108 out of 108 accounts (100.0%)** show exact cent-for-cent agreement between the live dashboard `currentBalance` and the stored October ending balance (`investor_monthly_history.ending_balance`).
- **Current-Month Cashflow Immediate Effect:** In accordance with accounting rules, October settled cashflows take effect immediately:
  - 10 accounts with October external deposits (`rconrad`, `aray`, `austinray`, `vray`, `bbeck`, `thorton`, `astone`, `cholly`, `tllewellyn`, `fclemensen`) reflect their new deposits in their live balance.
  - 1 account with an October recurring draw (`jbennion`, $21,500.00) reflects the draw deduction in his live balance ($2,730,048.78).
- **Format vs Ledger Verification:** No display formatting truncation defects or floating-point rounding errors were detected in the mobile dashboard payloads.

---

## 5. CASH PROVENANCE ASSESSMENT (PHASE 3)

The audit verified strict adherence to Josh Stout's external cash provenance rules:
1. `starting_capital` is treated strictly as an accounting baseline, never as external cash.
2. Cutover balances are never counted as external deposits.
3. Internal transfers contribute $0.00 to external cash.
4. Accounts with `UNKNOWN` or `PARTIAL` provenance display `totalPerformanceDollar = null` and `totalPerformancePct = null`.
5. Only accounts with explicit Josh Stout certification produce a Total Performance metric:
   - **Josh Stout (`stout001`):** Certified COMPLETE basis = $1,606,090.00. Current settled balance = $3,400,953.52. Total Performance = **+$1,794,863.52 (+111.75%)**.
   - **Ryan Ringer (`rringer`):** Certified COMPLETE basis = $125,000.00. Current settled balance = $153,751.29. Total Performance = **+$28,751.29 (+23.00%)**.

---

## 6. PROPOSED REMEDIATION ACTIONS FOR JOSH STOUT AUTHORIZATION

To bring the platform to **100% RECONCILED (PASS)**, the following read-only audit recommendations require explicit client authorization:

```
[ACTION 1] Void Duplicate Kevin Rucker Deposit
- Target Record: deposits row dep_29b84085 ($5,000.00)
- Action: UPDATE deposits SET status = 'void', type = 'VOID', notes = 'Voided duplicate of dep_10f79b13 per Audit 2026-10-08' WHERE id = 'dep_29b84085';
- Effect: Eliminates $5,000 duplicate deposit; resettle September balance from $210,911.04 to $205,834.29 (-$5,076.75).

[ACTION 2] Void Duplicate Neal Waite Deposit
- Target Record: deposits row dep_d75d7f29 ($12,600.00)
- Action: UPDATE deposits SET status = 'void', type = 'VOID', notes = 'Voided duplicate of dep_576913ae per Audit 2026-10-08' WHERE id = 'dep_d75d7f29';
- Effect: Eliminates $12,600 duplicate deposit; resettle September balance from $560,959.66 to $548,166.25 (-$12,793.41).

[ACTION 3] Lock Reagan Ruddell September History Record
- Target Record: investor_monthly_history row 996cf8bf-811c-4b53-bc20-94d7ee825227
- Action: UPDATE investor_monthly_history SET locked = true WHERE id = '996cf8bf-811c-4b53-bc20-94d7ee825227';
- Effect: Restores 100% locked protection across all active September investor records.

[ACTION 4] Align Josh Stout Account Table Metadata
- Target Record: investor_accounts row stout001
- Action: UPDATE investor_accounts SET total_cash_in = 1606090.00 WHERE id = 'stout001';
- Effect: Resolves P2 metadata inconsistency with certified outside cash basis.

[ACTION 5] Restore Ted Boardwalk Dashboard Withdrawal Display
- Target Record: investors row inv_a79798ca
- Action: UPDATE investors SET start_date = '2026-06-01' WHERE id = 'inv_a79798ca';
- Effect: Allows preserved June $5,000 withdrawal wd_9a4f1219 to display on the mobile dashboard card without altering the September 1 $0.00 cutover.
```

---

## 7. AUDIT ARTIFACTS IN REPOSITORY

1. **Audit Engine Script:** [`scripts/audit_production_financial_integrity.mjs`](file:///c:/Users/USER/.gemini/antigravity-ide/scratch/ForexPage/scripts/audit_production_financial_integrity.mjs)
2. **Daily Reconciliation Engine:** [`lib/daily-reconciliation-engine.js`](file:///c:/Users/USER/.gemini/antigravity-ide/scratch/ForexPage/lib/daily-reconciliation-engine.js)
3. **Daily System Architecture Specification:** [`docs/DAILY_AUTOMATED_RECONCILIATION_DESIGN.md`](file:///c:/Users/USER/.gemini/antigravity-ide/scratch/ForexPage/docs/DAILY_AUTOMATED_RECONCILIATION_DESIGN.md)
4. **Full JSON Audit Evidence File:** [`docs/financial-integrity-audit-report-2026-10-08.json`](file:///c:/Users/USER/.gemini/antigravity-ide/scratch/ForexPage/docs/financial-integrity-audit-report-2026-10-08.json)
5. **Duplicate Transaction Scanner:** [`scripts/scan_duplicates.mjs`](file:///c:/Users/USER/.gemini/antigravity-ide/scratch/ForexPage/scripts/scan_duplicates.mjs)
