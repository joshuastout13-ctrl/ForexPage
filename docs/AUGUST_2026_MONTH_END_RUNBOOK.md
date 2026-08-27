# August 2026 Month-End Close Runbook

**Target System:** ForexPage Production (`https://4xtrack.com`)  
**Production Database:** `julhldzkiqdeuuoqmvlo` (Supabase Production — Stone Forex)  
**Target Accounting Month:** **August 2026 (`2026-08`)**  
**Execution Window:** End of Month (August 31, 2026 / September 1, 2026)  
**Current Operational Status:** **`NOT_DUE_YET (AUGUST REMAINS OPEN FOR NORMAL OPERATIONS)`**

---

## 1. Overview & Operational Preconditions

This runbook outlines the step-by-step procedure for executing the formal monthly accounting close for August 2026 when the calendar month concludes. 

> [!IMPORTANT]
> **DO NOT EXECUTE PRIOR TO END-OF-MONTH.** August 2026 is currently active and open for standard deposits, withdrawals under Package B 2.2.0, and live performance tracking.

---

## 2. End-of-Month Execution Workflow

### Phase 1: Preflight & Ledger Audit (Read-Only)
1. **`[ ]` A. End-of-Month Preflight Check:** Verify system health and ensure all scheduled August accounting activity is accounted for.
2. **`[ ]` B. Fresh 91-Account Reconciliation Sweep:** Run [`docs/PLATFORM_WIDE_READ_ONLY_SWEEP.sql`](file:///c:/Users/USER/.gemini/antigravity-ide/scratch/ForexPage/docs/PLATFORM_WIDE_READ_ONLY_SWEEP.sql) to confirm 0 open and 0 ending variances across all 91 active accounts.
3. **`[ ]` C. Verify August Cashflow Posting:** Confirm all legitimate August deposits and completed withdrawals are recorded with correct effective dates.
4. **`[ ]` D. Verify August Monthly Gross Return %:** Confirm the August trading return percentage (e.g. `fundReturnPct`) is finalized by fund management and entered into the database/payload with `status = 'FROZEN'`.
5. **`[ ]` E. Verify Downline Commission Pools:** Confirm downline referral commission calculations accurately reflect August gross returns and active sharing rules.
6. **`[ ]` F. Verify Durable Cutovers:** Confirm cutover records for Jeff Bennion ($2,673,903.44) and Ted Boardwalk ($17.19) remain active in `account_cutover_adjustments`.
7. **`[ ]` G. Verify Package B Concurrency Controls:** Confirm `calculate_available_withdrawal_equity_sql` is functioning normally.

---

### Phase 2: Feature Flag & Dry-Run Certification
8. **`[ ]` H. Enable Finalization Feature Flag:**  
   * Follow [`docs/FINALIZATION_FLAG_ENABLEMENT_PACKAGE.md`](file:///c:/Users/USER/.gemini/antigravity-ide/scratch/ForexPage/docs/FINALIZATION_FLAG_ENABLEMENT_PACKAGE.md) to set `ACCOUNTING_FINALIZATION_ENABLED="true"` in Vercel Environment Variables and redeploy.
9. **`[ ]` I. Execute Finalization Dry-Run:**  
   * Submit `POST /api/admin/accounting/finalize` with `{ "year": 2026, "month": 8, "dryRun": true }`.
10. **`[ ]` J. Review Dry-Run Manifest:**  
    * Confirm `status: "SUCCESS_DRY_RUN"`.
    * Confirm `controlCheck: "RECONCILED"` (`Math.abs(grossResult - (sourceGain + recipientComm)) < 0.05`).
    * Confirm `totalDatabaseWritesPerformed: 0`.
    * Capture the generated `inputHash`.

---

### Phase 3: Mutating Execution & Final Closeout
11. **`[ ]` K. Obtain Explicit Admin Close Authorization:** Obtain final sign-off from fund administrator (Josh Stout) before submitting the mutating write.
12. **`[ ]` L. Execute Mutating Finalization (Single Atomic Pass):**  
    * Submit `POST /api/admin/accounting/finalize` with `{ "year": 2026, "month": 8, "dryRun": false, "inputHash": "<CAPTURED_HASH>" }`.
13. **`[ ]` M. Verify August Locked/Finalized:** Confirm August accounting period status transitions from `OPEN` $\to$ `FINALIZED`.
14. **`[ ]` N. Verify August Ending $\to$ September Opening Roll-Forward:** Confirm September 2026 opening balances match August 2026 finalized ending balances.
15. **`[ ]` O. Verify August Commissions $\to$ September Capitalization:** Confirm August earned referral commissions capitalize cent-exact into September 1 opening operating capital ($N \to N+1$).
16. **`[ ]` P. Post-Close Feature Flag Policy:** Disable feature flag (`ACCOUNTING_FINALIZATION_ENABLED="false"`) if operational policy requires locking the endpoint between close cycles.
