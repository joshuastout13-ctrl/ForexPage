# FOREXPAGE — Production Accounting & Ledger Remediation Walkthrough

## Summary of Accomplishments (September 15, 2026)

Josh confirmed the fundamental business rule for ForexPage accounting:
1. **Withdrawals represent the PREVIOUS month's return.**
2. **Month starting balance is:**
   $$\text{Month Starting Balance} = \text{Previous Month Ending Balance} + \text{New Deposits} + \text{Prior Month Capitalized Commissions} - \text{Withdrawals}$$
3. Therefore, a withdrawal effective May 1 belongs strictly in the May opening cashflow calculation and does **not** reduce April return-eligible capital. Returns for May are earned on this May opening capital base.

This task implemented this general rule across the entire accounting engine, dashboard, and validation layer, remediated the Scott Sire duplicate lifecycle state, established Ted Boardwalk's authorized $0.00 position effective September 1, 2026 as a commission-only account, and certified the entire platform with zero regressions.

---

## Key Changes Implemented

### 1. General Accounting Engine & Dashboard Unification
- **[lib/accounting-engine.js](file:///c:/Users/USER/.gemini/antigravity-ide/scratch/ForexPage/lib/accounting-engine.js):**
  - Updated `calculateInvestorMonth`:
    $$\text{decOpeningBalance} = \text{decPriorEnding} + \text{decIncomingCommissions}$$
    $$\text{decEligibleCapital} = \text{decOpeningBalance} + \text{decDeposits} - \text{decWithdrawals}$$
  - Exported both `openingBalance` (pre-cashflow base) and `startingBalance` (return-eligible capital base).
- **[lib/dashboard.js](file:///c:/Users/USER/.gemini/antigravity-ide/scratch/ForexPage/lib/dashboard.js):**
  - Integrated `account_cutover_adjustments` into the monthly compounding loop so that authorized cutovers supersede roll-forward balances as the authoritative opening baseline.
  - Aligned deposit and withdrawal resolution across Supabase (`investor_id`) and Sheets (`investorid`) schemas.
  - Supported snake_case and camelCase metadata keys (`split_pct`, `start_date`, `portal_username`).
- **[lib/withdrawal-validation.js](file:///c:/Users/USER/.gemini/antigravity-ide/scratch/ForexPage/lib/withdrawal-validation.js):**
  - Added cutover adjustment priority check to `calculateAvailableWithdrawalEquity`, establishing 100% parity with PostgreSQL function `calculate_available_withdrawal_equity_sql`.
  - Added null guards for Supabase connectivity when operating under in-memory test fixtures.

### 2. Scott Sire Lifecycle Remediation (`ssire` / `inv_f22b8d5d`)
- **Diagnosis:** Scott had one economic $25,000 May withdrawal recorded twice:
  - `wd_completed_may_ssire`: Completed, $25,000.00, effective 2026-05-01.
  - `wd_pending_may_ssire`: Pending, $25,000.00, effective 2026-05-01.
  Production deducted the completed transaction once from balance, but the orphaned pending row reserved an extra $25,000 of available equity and generated a duplicate Pending badge.
- **Remediation:**
  - Transitioned `wd_pending_may_ssire` from `Pending` to `Cancelled` using canonical audited RPC `update_withdrawal_atomic`.
  - **Zero physical deletion.**
  - Completed row `wd_completed_may_ssire` preserved.
  - Settled balance change: strictly **$0.00**.
  - Available equity released: **+$25,000.00** (restoring full September available equity to **$10,896.46**).
  - Scott's May return-eligible capital is strictly **$10,013.48** ($35,013.48 April ending - $25,000 May 1 withdrawal), generating **$215.44** net trading gain on May's return (+2.15148% net) and **$10,228.92** May close under Josh's confirmed general rule.

### 3. Ted Boardwalk September 1 Reset (`tboardwalk` / `inv_a79798ca`)
- **Diagnosis & Authorization:**
  - Ted has zero personal external cash deposits and zero starting capital.
  - The previously requested $1,100.00 September withdrawal was **never executed** (equity was $384.56). Josh explicitly superseded that request: Ted is reset to **$0.00 effective September 1, 2026** and the $1,100 withdrawal is NOT processed.
  - Future account balance will derive strictly from earned/capitalized commissions.
- **Audited Architectural Mechanism:**
  - Created a durable cutover record in `account_cutover_adjustments` for Year 2026, Month 9:
    - `authorized_opening_balance = 0.00`
    - `prior_rollforward_balance = 384.56`
    - `authorization_reference = 'JOSH_CONFIRMED_COMMISSION_ONLY_SEPT2026'`
    - `reason = 'Commission-only baseline reset effective Sept 1 authorized by Josh. Prior balance cleared, future balance to accrue solely from capitalized commissions.'`
  - Upserted `investor_monthly_history` for September 2026 with `opening_balance = 0.00` and `ending_balance = 0.00`.
  - Updated `investor_accounts`: `is_commission = true`, `starting_capital = 0.00`.
  - Asserted that zero September withdrawal records exist for Ted Boardwalk.

### 4. Absolute Protection of Production Invariants
- **Jerry (`jerrys001`):** August completed withdrawal ($2,500.00) remains strictly 1 row; 100% untouched.
- **Mary Jo (`inv_4c5c0ee6`):** September completed withdrawal ($21,000.00) and August correction remain 100% untouched.
- **September Authorized Batch:** The 11 executed September batch withdrawals ($167,258.30) remain 100% intact.
- **Advisory Locks:** All mutations execute under `financial_lock_key(investor_id)`.

---

## Verification & Test Results

All test suites were executed and certified:

| Suite | Tests | Result | Description |
|:---|:---:|:---:|:---|
| `tests/test_scott_and_ted_accounting_remediation.js` | 14 | ✅ **PASS** | In-memory accounting/dashboard verification and native PostgreSQL 18.4 migration execution |
| `tests/test_withdrawal_start_date_validation.js` | 6 | ✅ **PASS** | Start-date conflict validation & boundary equity rules |
| `tests/test_transaction_lifecycle_integrity.js` | 8 | ✅ **PASS** | Lifecycle immutability, zero physical deletions, reservation rules |
| `tests/test_financial_mutation_safety.js` | 16 | ✅ **PASS** | Fail-closed production DB guards, idempotency keys, duplicate guards |
| `tests/test_month_state.js` | 39 | ✅ **PASS** | America/Los_Angeles timezone, DST transitions, month-state engine |
| `tests/test_october_rollover_certification.js` | 18 | ✅ **PASS** | October 1 rollover simulation across all 90 accounts (90/90 pass) |
| `tests/test_open_month_settled_rules.js` | 8 | ✅ **PASS** | Open month gain isolation & commission capitalization N -> N+1 |
| `tests/test_commission_single_source_of_truth.js` | 4 | ✅ **PASS** | Displayed = DB = Capitalized invariant |
| `tests/test_mobile_responsive.js` | 7 | ✅ **PASS** | Compact 3-column mobile layout preserved across 375px, 390px, 430px |
| `tests/test_jstout_screenshot_reconciliation.js` | 1 | ✅ **PASS** | Exact cent-for-cent dashboard screenshot reconciliation |
| `tests/test_rollover_regression.js` | 2 | ✅ **PASS** | Historical chart bar persistence & open month bar masking |
| `scripts/verify-all-accounts-ledger-invariants.js` | 90 | ✅ **PASS** | Platform-wide 90/90 account ledger invariant verification |
