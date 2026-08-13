# Production Accounting Migration & Deployment Plan

> [!IMPORTANT]
> **STATUS: PROPOSED & READY FOR STAGING TESTING.**
> Production finalization feature flag remains **`ACCOUNTING_FINALIZATION_ENABLED = false`**.

---

## 1. Ordered Deployment Steps

1. **Full Database Backup:** Take a complete point-in-time PostgreSQL backup of the production Supabase database.
2. **Deploy Additive Schema Migrations:**
   - Run [`docs/proposed_accounting_periods_migration.sql`](file:///c:/Users/Shilley%20Pc/ForexPage/docs/proposed_accounting_periods_migration.sql) (creates `accounting_periods`).
   - Run [`docs/proposed_preview_runs_migration.sql`](file:///c:/Users/Shilley%20Pc/ForexPage/docs/proposed_preview_runs_migration.sql) (creates `accounting_preview_runs`).
   - Run [`docs/proposed_commission_ledger_migration.sql`](file:///c:/Users/Shilley%20Pc/ForexPage/docs/proposed_commission_ledger_migration.sql) (adds `source_account_id`, `commission_percent_snapshot`, `calculation_version`, `effective_accounting_date`).
3. **Deploy Transaction RPC Function:**
   - Execute [`docs/proposed_transactional_finalization.sql`](file:///c:/Users/Shilley%20Pc/ForexPage/docs/proposed_transactional_finalization.sql) (creates `finalize_monthly_accounting_period` RPC function).
4. **Verify Additive Schema Integrity:**
   - Confirm all existing queries on `investors`, `investor_accounts`, `deposits`, `withdrawals`, `commission_earnings`, `monthly_history` function with 0 regression.
5. **Keep Production Feature Flag OFF:**
   - Confirm `ACCOUNTING_FINALIZATION_ENABLED="false"` in environment configuration.
6. **Deploy Compatible Application Code:**
   - Deploy engine and period calculator updates.
7. **Populate Effective Accounting Dates for Current Period:**
   - Review and approve effective dates according to [`docs/AUGUST_2026_CASHFLOW_EFFECTIVE_DATES.md`](file:///c:/Users/Shilley%20Pc/ForexPage/docs/AUGUST_2026_CASHFLOW_EFFECTIVE_DATES.md).
8. **Capture Frozen Monthly Return:**
   - Capture and freeze the final August return (`FINAL_RETURN_CAPTURED`).
9. **Generate Final Pre-Close Preview:**
   - Run `/api/admin/accounting/preview` for August 2026.
10. **Client & Admin Sign-Off:**
    - Admin reviews `canFinalize = true`, zero flags, exact cent reconciliation, and input fingerprint hash.
11. **Perform Controlled Month Close:**
    - Temporarily toggle `ACCOUNTING_FINALIZATION_ENABLED="true"` and execute `/api/admin/accounting/finalize` with `dryRun=false`.
12. **Post-Close Audit & Verification:**
    - Verify `accounting_periods` status is `FINALIZED`.
    - Verify `investor_monthly_history` and `commission_earnings` rows.
    - Toggle `ACCOUNTING_FINALIZATION_ENABLED="false"` after close.

---

## 2. Emergency Rollback Plan

If any anomaly or failure is detected prior to or during finalization:
1. **Atomic Transaction Safety:** The RPC function executes in a single PostgreSQL transaction. Any error automatically rolls back 100% of mutations.
2. **Feature Flag Kill Switch:** Instantly set `ACCOUNTING_FINALIZATION_ENABLED="false"` to block any finalization requests.
3. **Database Point-in-Time Restore:** If an unauthorized or corrupt state is detected, restore the pre-finalization PostgreSQL snapshot.
