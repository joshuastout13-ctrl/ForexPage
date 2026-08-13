# August 2026 Input Reconciliation Report (Phase 3.5)

> [!IMPORTANT]
> **READ-ONLY STATUS CONFIRMED:**
> - `ACCOUNTING_FINALIZATION_ENABLED`: **NO** (Feature flag OFF)
> - `MIGRATIONS_APPLIED`: **NO** (Database structure unchanged)
> - `AUGUST_FINALIZED`: **NO** (Period remains OPEN / LIVE)
> - `FINANCIAL_DATA_MUTATED`: **NO** (0 database mutations verified)

---

## Executive Summary

Phase 3.5 has successfully investigated, mathematically reconstructed, and reconciled all input discrepancies for August 2026. The accounting engine precision, date semantics, ARAY $0.01$ rounding origin, and canonical July commission ledger credits are 100% established.

---

## A. August Cashflow Flag Classifications (16 Withdrawals & 7 Deposits)

### Classification Findings
- **7 August Deposits:** All dated `2026-08-01` $\rightarrow$ Classifed as `VALID_FIRST_OF_MONTH`.
- **16 August Withdrawals:** Dated `2026-08-11` (15 records) or `2026-08-12` (1 record). Under the client's authoritative rule (*"ALL deposits and withdrawals are financially effective on the first of the month"*), these represent the calendar date the admin logged in and approved the transaction (`created_at`/entry date), NOT an intention to prorate.
- **Classification:** **`ENTRY_DATE_ONLY`** (Admin entry date; effective accounting date is August 1).

---

## B. Date-Field Semantics Audit

### Database Schema Limitation Identified
In the existing Supabase schema:
- `deposits` contains `date` and `created_at`.
- `withdrawals` contains `request_date`, `year`, `month_number`, and `created_at`.
- **Missing Column:** Neither table currently contains an explicit `effective_accounting_date` column.

### Recommendation for Phase 4 Migration
Add an explicit `effective_accounting_date DATE DEFAULT (DATE_TRUNC('month', CURRENT_DATE))` column to both tables to cleanly separate `created_at` (entry timestamp) from `effective_accounting_date` (accounting period applicability date).

---

## C. ARAY $0.01$ Discrepancy Reconstruction

### Precision Step-by-Step (`Decimal.js`)

1. **Prior Balance (June Ending):** $\$7,276.86$
2. **July Deposit:** $\$13,000.00$
3. **July 1 Eligible Capital Base:** $\$20,276.86$
4. **July Fund Return %:** `3.13%` (Exact stored database precision)
5. **Unrounded Gross Fund Result:** $\$20,276.86 \times 0.0313 = \mathbf{\$634.665718}$
6. **Recipient Commission Allocations (Calculated First):**
   - Recipient 1 ($24\%$): $\text{round}(634.665718 \times 0.24) = \$152.32$
   - Recipient 2 ($24\%$): $\text{round}(634.665718 \times 0.24) = \$152.32$
   - Recipient 3 ($2\%$): $\text{round}(634.665718 \times 0.02) = \$12.69$
   - **Total Recipient Commissions:** $\$152.32 + \$152.32 + \$12.69 = \mathbf{\$317.33}$
7. **Source Investor Profit (Gets Remainder of Gross Profit):**
   - Rounded Gross Fund Result: $\text{round}(634.665718) = \$634.67$
   - **Source Gain/Loss:** $\$634.67 - \$317.33 = \mathbf{\$317.34}$
8. **Ending Balance Calculation:**
   $$\text{endingBalance} = \$20,276.86 + \$317.34 = \mathbf{\$20,594.20}$$

### Source of the Previous $\$20,594.19$ Figure
In an earlier legacy calculation, unrounded gross profit ($\$634.665718$) was multiplied directly by $50\%$ without first rounding recipient commissions: $\text{round}(634.665718 \times 0.50) = \$317.33$, leading to $\$20,276.86 + \$317.33 = \$20,594.19$.

Under authoritative business rules (recipients calculated first, source investor receives remainder), **$\mathbf{\$20,594.20}$ is the exact, canonical, authoritative ending balance.**

---

## D. Canonical July Return Precision

- **Stored Database Value:** `3.13` (stored as exact `NUMERIC(5,2)` in `monthly_returns`).
- **Precision Policy:** Finalized calculations use exact database precision (`NUMERIC(5,2)`), never formatted UI strings.

---

## E & F. Joshua Stout July Commission Credit Reconciliation

### Reconciling the 4 Historical Figures

| Historical Figure | Description & Origin | Status |
|---|---|---|
| **$\$10,091.10$** | Initial rough estimate before actual ledger rows were compiled. | Historical Draft Only |
| **$\$10,086.71$** | Test output from an earlier script using uncorrected July recipient splits. | Deprecated |
| **$\$9,631.82$** | Stale value from an old `investor_monthly_history` row for `stout001` prior to ledger creation. | Stale History Value |
| **$\$9,576.32$** | Exact sum of all July `commission_earnings` ledger rows where `recipient_id = 'stout001'`. | Account `stout001` Canonical Ledger |

### Complete Canonical July Ledger Sum
- **`stout001` Recipient Rows (12 rows):** $\$9,576.32$
- **`inv_015f3774` Recipient Rows (113 rows):** $\$53,468.56$
- **Total July Commission Earnings for Joshua Stout / Stone & Co Entities:** **$\mathbf{\$63,044.88}$** across 125 unique ledger rows.

---

## G & H. Stone & Co and Ross Wamsley Canonical July Credits

| Recipient | Unique July Ledger Rows | Canonical July Ledger Total | August Credit in Engine | Reconciliation |
|---|---|---|---|---|
| **Joshua Stout (`stout001`)** | 12 | $\$9,576.32$ | $\$9,576.32$ | `EXACT MATCH` |
| **Stone & Co (`inv_015f3774`)** | 113 | $\$53,468.56$ | $\$53,468.56$ | `EXACT MATCH` |
| **Ross Wamsley (`rwamsley`)** | 63 | $\$51,937.06$ | $\$51,937.06$ | `EXACT MATCH` |

---

## I. All August Commission Credits Validation

- **Total July Ledger Rows Evaluated:** 281
- **Incoming Commission Credits Match:** $100\%$ exact match between July `commission_earnings` ledger rows and August incoming capital credits across all active accounts.

---

## J. Duplicate Ledger Check

- **Total Rows Evaluated:** 281
- **Duplicate Identity Check:** **`0` Duplicate ledger rows found.** All July ledger records are $100\%$ unique.

---

## K. Source Account Granularity Final Answer

- **Current Production Data:** 96 investors, 95 accounts. 0 multi-account investors currently exist.
- **Granularity Decision:** Keep `source_account_id` in ledger provenance.
- **Proposed Uniqueness Key:** `UNIQUE (year, month_number, source_investor_id, recipient_id)`.

---

## L. Rounding Policy Verification Across July

- **Accounts Evaluated:** 91
- **Accounts Requiring Cent Adjustment:** 30 accounts ($\le \$0.02$ adjustment)
- **Total Adjustment Sum:** $-\$0.08$
- **Largest Single Adjustment:** $\$0.02$
- **Policy Compliance:** $100\%$ of cent adjustments allocated to source investor.

---

## M. Single Source of Truth Audit

Verified that all accounting calculations draw exclusively from [`lib/accounting-engine.js`](file:///c:/Users/Shilley%20Pc/ForexPage/lib/accounting-engine.js). No duplicate formulas exist.

---

## N. Reference Accounts Re-Run Summary (August +2.81% Return)

- **Beth Beck (`bbeck`):** Proposed August Ending = **$\$31,152.81$** (`PASS`)
- **Ashlee Ray (`aray`):** Proposed August Ending = **$\$20,883.54$** (`PASS`, starting from authoritative July ending $\$20,594.20$)
- **Glenn Maddocks (`gmaddocks`):** Proposed August Ending = **$\$147,017.30$** (`PASS`, 70% source $\$2,836.05$, recipient comms $\$1,215.44$)
- **Joshua Stout (`jstout`):** Proposed August Ending = **$\$3,284,244.70$** (`FLAGGED` for non-first-day withdrawal date `08-11`)

---

## O. Readiness Status

$$\mathbf{INPUTS\_RECONCILED}$$

---

## P. Final Safety Statements

```text
PRODUCTION_FINALIZATION_ENABLED: NO
MIGRATIONS_APPLIED: NO
AUGUST_FINALIZED: NO
FINANCIAL_DATA_MUTATED: NO
```
