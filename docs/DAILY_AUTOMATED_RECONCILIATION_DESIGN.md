# Daily Automated Financial Reconciliation System — Architecture & Technical Design

**Document ID:** `RFC-2026-RECON-DAILY`  
**Target Platform:** `4xtrack.com` / `joshuastout13-ctrl/ForexPage`  
**Authoritative Supabase Project:** `julhldzkiqdeuuoqmvlo` (`Stone - Forex`)  
**Status:** PROPOSED / READY FOR REVIEW (Execution strictly disabled per Read-Only Audit protocol)  
**Date:** 2026-10-08  

---

## 1. Executive Summary

This document specifies the technical architecture and implementation design for the **Daily Automated Financial Reconciliation System** on 4XTrack. 

Following the completion of the comprehensive production audit on October 8, 2026, this system will provide daily, automated, non-invasive surveillance of platform accounting integrity. The reconciliation engine operates under strict **read-only** constraints: it never mutates ledger records, never triggers Myfxbook scrapes, and never runs recalculation routines that persist changes. Instead, it acts as an immutable mathematical witness that flags ledger corruption, duplicate transactions, broken transfers, or unauthorized balance alterations before they impact investors.

---

## 2. Core Safety & Architectural Invariants

| Principle | Technical Enforcement |
|---|---|
| **100% Read-Only** | Only `SELECT` queries across PostgREST/Supabase; no `INSERT`, `UPDATE`, `DELETE`, `UPSERT`, `TRUNCATE`, or mutation RPCs are called on ledger tables. |
| **Strict Project Isolation** | Enforces project ref matching `julhldzkiqdeuuoqmvlo`; fails closed immediately if credentials point to local fixtures, sheets, or non-authoritative environments. |
| **No External API Triggers** | Never invokes the Myfxbook API, ZenRows, Scrape.do, or recalculation endpoints during daily surveillance. Uses persisted database records and read-only cache feeds. |
| **Fail-Closed Semantics** | If Supabase is unreachable, schema fails validation, or permissions are restricted, the run aborts with an explicit `FAIL_CLOSED` status rather than producing false `PASS` results. |
| **Cent-Accurate Decimal Arithmetic** | All calculations utilize `decimal.js` with 20-digit precision and `ROUND_HALF_UP` bankers rounding. |
| **Decoupled Execution** | Does not automatically remediate anomalies; exceptions generate alerts and immutable audit evidence for Josh Stout review. |

---

## 3. System Architecture & Component Diagram

```mermaid
flowchart TD
    subgraph Trigger [Trigger Layer (Scheduled or On-Demand)]
        A[GitHub Actions / Vercel Cron] -->|HMAC Bearer Token| B[api/cron/daily-reconciliation.js]
    end

    subgraph Guard [Pre-Flight & Authorization]
        B --> C{isAuthoritativeProductionDbConfigured?}
        C -->|No / Fallback| D[Abort: FAIL_CLOSED]
        C -->|Yes: julhldzkiqdeuuoqmvlo| E[Read-Only Data Ingestion]
    end

    subgraph Data [Authoritative Paginated Ingestion]
        E --> F[investors]
        E --> G[investor_accounts]
        E --> H[deposits]
        E --> I[withdrawals]
        E --> J[commission_earnings]
        E --> K[monthly_returns]
        E --> L[account_cutover_adjustments]
        E --> M[investor_monthly_history]
    end

    subgraph Engine [Reconciliation Engine Core]
        F & G & H & I & J & K & L & M --> N[lib/daily-reconciliation-engine.js]
        N --> O1[Duplicate Transaction Detector]
        N --> O2[Transfer Leg Symmetry Validator]
        N --> O3[Historical Lock & Immutability Guard]
        N --> O4[Mathematical Rollforward Engine]
        N --> O5[Cash Provenance Validator]
        N --> O6[Live Dashboard Discrepancy Analyzer]
    end

    subgraph Output [Reporting & Audit Trail]
        O1 & O2 & O3 & O4 & O5 & O6 --> P[Consolidated Reconciled Status: PASS / FAIL]
        P --> Q[Persist Audit Snapshot to audit_runs]
        P --> R[Dispatch Priority Alert via Resend / Webhook]
    end
```

---

## 4. Invariant Checks & Verification Rules

### Check 1: Duplicate Economic Transaction Detection (P0)
- **Deposits:** Scans all active rows in `deposits` (`status != 'VOID'` and `type != 'VOID'`). Flags any duplicate tuple `(investor_id, amount, date)`.
- **Withdrawals:** Scans all active rows in `withdrawals` (`status != 'Cancelled'`). Flags any duplicate tuple `(investor_id, amount, request_date)`.
- **Idempotency Keys:** Flags any conflicting rows sharing the same idempotency key.

### Check 2: Internal Transfer Symmetry & Cash Neutrality (P1)
- Identifies all records tagged with `transfer_id` or `type = 'Internal Transfer'`.
- Verifies that for every transfer ID, the sum of `DEBIT` legs in `withdrawals` exactly equals the sum of `CREDIT` legs in `deposits`.
- Verifies that transfer credit deposits carry `accounting_treatment = 'INTERNAL_TRANSFER'`, guaranteeing `$0.00` impact on external cash deposits.

### Check 3: Closed-Period Immutability & Lock Enforcement (P1)
- For every historical period where `evaluateMonthState(year, month) == HISTORICAL_SETTLED`:
  - Asserts `monthly_returns.locked == true`.
  - Asserts `investor_monthly_history.locked == true` for every active investor whose start date precedes the period close.
  - Compares current stored balances against the previous day's certified baseline to ensure zero silent retro-mutations.

### Check 4: Mathematical Rollforward & Commission Capitalization (P1)
- For every account, independently computes:
  $$\text{Opening}_N = \text{Ending}_{N-1} + \text{Commissions}_{N-1} + \text{Deposits}_N - \text{Withdrawals}_N$$
  *(Subject to authorized account cutover overrides at period boundaries)*.
- Asserts that commissions earned in month $N-1$ credit to month $N$ capital exactly once.
- Asserts that open-month trading gains contribute `$0.00` to settled balances.

### Check 5: Live Dashboard vs Authoritative Ledger Agreement (P1)
- Calls `buildInvestorDashboard(username, preloadedData, { mustBeAuthoritative: true })`.
- Compares:
  1. Dashboard `currentBalance` vs Stored Open-Month `ending_balance` (cent-for-cent).
  2. Dashboard `totalWithdrawals` vs Independent `calculateLifetimeSettledWithdrawals()`.
  3. Dashboard `totalCashIn` vs Independent `calculateTotalExternalCash()`.

### Check 6: Cash Provenance Integrity & Fail-Closed Guard (P2)
- Asserts that `starting_capital`, cutover baselines, internal transfers, and commissions contribute `$0.00` to certified external cash.
- Asserts that accounts with `provenanceCompletenessStatus != 'COMPLETE'` display `totalPerformanceDollar = null` and `totalPerformancePct = null`.
- Asserts that only accounts with explicit Josh Stout certification produce a lifetime performance percentage.

---

## 5. Daily Audit Run Schema (`audit_runs` Table)

When daily reconciliation runs, it records an immutable summary entry in the existing `audit_runs` table:

```sql
INSERT INTO audit_runs (
  admin_id,
  source_investor_id,
  year,
  month_number,
  report_json,
  created_at
) VALUES (
  'system_daily_reconciler',
  NULL,
  2026,
  10,
  '{
    "run_timestamp": "2026-10-09T07:00:00.000Z",
    "status": "PASS",
    "accounts_evaluated": 108,
    "accounts_reconciled": 108,
    "accounts_with_discrepancies": 0,
    "confirmed_variance_dollar": 0.00,
    "anomalies_count": { "P0": 0, "P1": 0, "P2": 0 },
    "control_accounts_passed": 7,
    "checksum": "sha256_hash_of_reconciliation_bundle"
  }'::jsonb,
  NOW()
);
```

---

## 6. Alerting & Escalation Matrix

| Severity | Condition | Action | Notification Channel |
|---|---|---|---|
| **P0** | Duplicate active deposit/withdrawal, unauthorized balance mutation in locked month, or transfer mismatch $> \$0.00$. | Immediate high-priority incident. Engine logs `FAIL`. System freezes manual recalculation tools. | Email to Josh Stout & Technical Lead via Resend API; Emergency webhook. |
| **P1** | Settled balance divergence $> \$0.05$, unlocked historical record in closed month, or commission capitalization discrepancy. | Logged as `FAIL`. Re-checks on subsequent run. Detailed variance breakdown attached. | Daily summary report flag; Technical review queue. |
| **P2** | Metadata inconsistency (e.g. stale `total_cash_in` column), pre-activation unlocked row, or display contract warning. | Logged as `WARNING`. Does not cause `FAIL` status if math matches. | Included in daily report. |

---

## 7. Implementation Roadmap & Guardrails

1. **Phase 1 (Complete):** Core engine module implemented in `lib/daily-reconciliation-engine.js`.
2. **Phase 2 (Pending User Authorization):** Deploy serverless handler `api/cron/daily-reconciliation.js` protected by `CRON_SECRET`.
3. **Phase 3 (Pending User Authorization):** Configure Vercel Cron trigger in `vercel.json` to execute daily at `06:00 AM America/Los_Angeles` (following midnight settlement).
4. **Current Status:** **DISABLED**. No cron job or scheduled execution is enabled as part of this read-only audit.
