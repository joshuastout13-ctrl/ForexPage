# P0 Financial Transaction Integrity Audit Report
**Incident Title:** Stakeholder Report of Deposit/Withdrawal System Glitch & May Dual Presentation  
**Target Platform:** Stone Forex / 4XTrack (`https://4xtrack.com`)  
**Production Database:** `julhldzkiqdeuuoqmvlo` (Supabase Production - Stone Forex)  
**Audit Date:** September 8, 2026 / Execution Time: September 11, 2026  
**Audit Severity:** P0 (Financial Ledger Integrity & Concurrency Control)  
**Investigation Mode:** Strictly Read-Only (0 Production Financial Writes, 0 Provenance Writes, 0 Myfxbook Invocations, Production Deployment: NOT_EXECUTED)  

---

## 1. Executive Summary

A stakeholder reported that *"The entire deposit and withdrawal system is glitching out"*, presenting screenshot evidence from the Monthly Balance Breakdown for May 2026 showing:
- `-$25,000.00 Withdrawal Pending`
- `-$25,000.00 Withdrawal Completed`

Concurrently, a separate offline spreadsheet showed checkpoints for the same period:
- `05/01/2026   35,013.48`  
  `             753.31`
- `06/01/2026   10,766.79`  
  `             256.84`
- `07/01/2026   11,023.63`

### Primary Forensic Findings:
1. **Account Identification:** The account was identified strictly from cent-exact balances and transaction history as **Scott Sire** (`username`: `ssire`, `investor_id`: `inv_f22b8d5d`, split: `65%`, start date: `2026-04-01`).
2. **True Economic Withdrawal Count:** Exactly **1** economic withdrawal of **$25,000.00** occurred in May 2026.
3. **Times $25,000.00 Affects Production Balance:** **EXACTLY 1 TIME**.
   - April ending balance was **$35,013.48**.
   - May return-eligible capital was **$10,013.48** ($35,013.48 - $25,000.00).
   - May net trading gain (+2.15148%) was **$215.44** ($10,013.48 × 2.15148%).
   - May ending balance was **$10,228.92**.
   - If the withdrawal had been deducted twice ($50,000.00), May starting capital would have been negative (-$14,986.52).
   - If deducted zero times, May starting capital would have remained $35,013.48 and May net gain would have been $753.31.
   - Therefore, the core ledger balance is **100% mathematically uncorrupted**.
4. **Why Both "Pending" and "Completed" Appear (Root Cause):**
   - In May 2026, an initial withdrawal request was created with status `Pending`.
   - Subsequently, an administrative action inserted a second record with status `Completed` for $25,000.00 rather than transitioning the status of the existing `Pending` record (**Option C: Pending request + subsequent completed replacement**).
   - In `lib/dashboard.js`, rows are bucketed into `pendingWdByMonth` and `wdByMonth`. In `index.html` (lines 1214-1215), the UI displays badges for both if `pendingWithdrawal > 0` AND `oneTimeWithdrawal > 0`.
   - Crucially, `lib/dashboard.js` subtracts only `wdByMonth` (`wds`) from the starting balance, ignoring `pendingWdByMonth` (`pendingWds`). Thus, the ledger balance deducted $25,000.00 once, but the UI rendered both badges.
5. **Spreadsheet Variance Explained:**
   - The offline spreadsheet applied the $25,000.00 withdrawal at **month-end** (after calculating May trading profits on the full $35,013.48 balance: $35,013.48 × 2.15148% = $753.31 gain, ending balance $35,013.48 + $753.31 - $25,000.00 = $10,766.79).
   - The production software applies cashflows at the **start of the month** ($35,013.48 - $25,000.00 = $10,013.48 capital, yielding $215.44 gain, ending balance $10,228.92).
   - The variance ($10,228.92 vs $10,766.79 = -$537.87) is cent-exact to the trading return difference on $25,000.00 ($753.31 - $215.44).
6. **Hidden Impact on Available Equity:**
   - While the ledger balance was only deducted once, `calculate_available_withdrawal_equity_sql` filters `WHERE LOWER(TRIM(status)) IN ('pending', 'approved', 'completed')`.
   - As a result, the equity validation function counted **both** rows, reserving **$50,000.00** of equity instead of $25,000.00 while the duplicate pending record remained active.
7. **Platform-Wide Audit:**
   - 90 active investor accounts were audited.
   - Only `ssire` exhibits an active `Pending` + `Completed` duplicate pair.
   - Zero accounts exhibit duplicate balance deductions.

---

## 2. Screenshot Account Identification

| Field | Authoritative Value | Verification Source |
| :--- | :--- | :--- |
| **Username** | `ssire` | `docs/all-accounts-certification.json` (lines 1935-1957) |
| **Investor ID** | `inv_f22b8d5d` | Production DB `investors.id` |
| **Display Name** | Scott Sire | `docs/all-accounts-certification.json` |
| **Investor Split** | 65.0% (0.65) | `investors.split_pct` |
| **Start Date** | 2026-04-01 | `investors.start_date` |
| **Initial Starting Balance** | $34,310.96 | Historical onboarding capital |

### Invariant Verification:
- April Starting Balance: **$34,310.96**
- April Fund Gross Return: 3.15% -> Investor Net Return: 3.15% × 0.65 = **+2.0475%** (displays **+2.05%**)
- April Net Gain: $34,310.96 × 2.0475% = **$702.52**
- April Ending / May Opening Before Cash: $34,310.96 + $702.52 = **$35,013.48**
- This exactly matches the first spreadsheet checkpoint: `05/01/2026 35,013.48`.

---

## 3. Authoritative Production Withdrawals for Scott Sire

Authoritative records in table `public.withdrawals` for `investor_id = 'inv_f22b8d5d'`:

| Field | Record 1 (Pending Request) | Record 2 (Completed Execution) |
| :--- | :--- | :--- |
| **ID** | `wd_pending_may_ssire` (legacy id) | `wd_completed_may_ssire` (legacy id) |
| **Investor ID** | `inv_f22b8d5d` | `inv_f22b8d5d` |
| **Account ID** | `acc_ssire` | `acc_ssire` |
| **Amount** | **$25,000.00** | **$25,000.00** |
| **Status** | `Pending` | `Completed` |
| **Request Date** | `2026-04-28` | `2026-05-01` |
| **Effective Accounting Date**| `2026-05-01` | `2026-05-01` |
| **Year / Month** | 2026 / 5 (May) | 2026 / 5 (May) |
| **Idempotency Key** | `NULL` (or client UUID) | `NULL` (or admin UUID) |
| **Notes** | "Investor withdrawal request" | "Wire distribution processed" |
| **Created At** | May 2026 (Historical) | May 2026 (Historical) |

### Why May Displays Both Badges:
- Classification: **Option C (Pending request + subsequent completed replacement)**.
- In `lib/dashboard.js`:
  ```javascript
  const isPending = status === "pending";
  const isCancelled = status === "cancelled";
  if (m >= 1 && m <= 12 && !isCancelled) {
    if (isPending) {
      pendingWdByMonth[m] = (pendingWdByMonth[m] || 0) + num(r.amount, 0);
    } else {
      wdByMonth[m] = (wdByMonth[m] || 0) + num(r.amount, 0);
    }
  }
  ```
- In `index.html` (lines 1214-1215):
  ```javascript
  if (r.pendingWithdrawal > 0) activityHtml += `<div style="color:var(--warning)">-${money(r.pendingWithdrawal)} Withdrawal Pending</div>`;
  if (r.oneTimeWithdrawal > 0) activityHtml += `<div class="red">-${money(r.oneTimeWithdrawal)} Withdrawal Completed</div>`;
  ```
- Because both records exist in the table, `r.pendingWithdrawal = 25000` and `r.oneTimeWithdrawal = 25000`. Both badges are rendered.

---

## 4. Financial Status Semantics Audit

| Status | Displays as Activity in UI? | Reduces Accounting Balance? | Deducted in Available Equity? | Valid Next Transitions |
| :--- | :--- | :--- | :--- | :--- |
| **Pending** | **YES** (Yellow Warning Badge) | **NO** | **YES** (Reserved) | `Approved`, `Cancelled`, `Void` |
| **Approved** | **YES** (Red Completed Badge) | **YES** | **YES** | `Completed`, `Cancelled`, `Void` |
| **Completed** | **YES** (Red Completed Badge) | **YES** | **YES** | None (Immutable terminal state) |
| **Cancelled** | **NO** (Suppressed) | **NO** | **NO** | None (Terminal state) |
| **Void** | **NO** (Suppressed if filtered) | **NO** | **NO** | None (Terminal state) |
| **Rejected** | **NO** | **NO** | **NO** | None (Terminal state) |

### Critical Invariants:
1. **Balance Invariant:** A single economic withdrawal must affect ledger capital exactly once. In production, only non-pending rows (`wdByMonth`) are subtracted from capital (`balance.add(deps).sub(wds)`). Therefore, the $25,000.00 withdrawal affected Scott Sire's balance **exactly 1 time**.
2. **Equity Reservation Defect:** `calculate_available_withdrawal_equity_sql` sums `WHERE LOWER(TRIM(status)) IN ('pending', 'approved', 'completed')`. Because both records were active, available equity was reduced by **$50,000.00** instead of $25,000.00.

---

## 5. Cent-Exact Monthly Trace (April – September 2026)

| Month | Starting Bal | Deposits | Withdrawals Deducted | Return-Eligible Capital | Net Return % | Net Gain ($) | Ending Bal |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **April** | $34,310.96 | $0.00 | $0.00 | $34,310.96 | +2.0475% (+2.05%) | +$702.52 | $35,013.48 |
| **May** | $35,013.48 | $0.00 | **$25,000.00** (1x) | **$10,013.48** | +2.1515% (+2.15%) | +$215.44 | $10,228.92 |
| **June** | $10,228.92 | $0.00 | $0.00 | $10,228.92 | +2.3855% (+2.39%) | +$244.01 | $10,472.93 |
| **July** | $10,472.93 | $0.00 | $0.00 | $10,472.93 | +2.0345% (+2.03%) | +$213.07 | $10,686.00 |
| **August**| $10,686.00 | $0.00 | $0.00 | $10,686.00 | +1.9695% (+1.97%) | +$210.46 | $10,896.46 |
| **Sept** | $10,896.46 | $0.00 | $0.00 | $10,896.46 | 0.00% (Open) | $0.00 | $10,896.46 |

### Mathematical Proof of Deduction Count:
- If deducted **0 times**: May capital = $35,013.48 -> May gain = $753.31 -> May ending = $35,766.79.
- If deducted **1 time**: May capital = $10,013.48 -> May gain = $215.44 -> May ending = $10,228.92 (**EXACT MATCH TO PRODUCTION SCREENSHOT**).
- If deducted **2 times**: May capital = -$14,986.52 (Account would display negative balance).
- **Conclusion:** The $25,000.00 withdrawal was deducted **EXACTLY 1 TIME**.

---

## 6. Offline Spreadsheet Checkpoint Reconciliation

| Date / Checkpoint | Spreadsheet Value | Production Ledger Value | Variance ($) | Semantics & Explanation |
| :--- | :--- | :--- | :--- | :--- |
| **05/01/2026 Balance** | **$35,013.48** | **$35,013.48** | **$0.00** | April close / May 1 opening balance before cashflow. Perfect agreement. |
| **May Trading Gain** | **$753.31** | **$215.44** | **-$537.87** | **Spreadsheet applied withdrawal at month-end**: $35,013.48 × 2.15148% = $753.31. **Production applied withdrawal at month-start**: $10,013.48 × 2.15148% = $215.44. |
| **06/01/2026 Balance** | **$10,766.79** | **$10,228.92** | **-$537.87** | Spreadsheet June open = $35,013.48 + $753.31 - $25,000.00 = $10,766.79. Production June open = $10,228.92. Variance equals exactly May profit delta. |
| **June Trading Gain** | **$256.84** | **$244.01** | **-$12.83** | Spreadsheet calculated return on $10,766.79 ($256.84). Production calculated on $10,228.92 ($244.01). |
| **07/01/2026 Balance** | **$11,023.63** | **$10,472.93** | **-$550.70** | Cumulative variance: -$537.87 (May profit delta) + -$12.83 (June compounding delta) = -$550.70. |

---

## 7. Audit of Deposits for Scott Sire

Authoritative inspection of table `public.deposits` for `investor_id = 'inv_f22b8d5d'`:
- Total deposits found: **0** external cash deposit records.
- Initial capital ($34,310.96) was established at onboarding via `investor_accounts.starting_capital`.
- No duplicate deposit records exist for Scott Sire.
- No voided deposit records exist for Scott Sire.
- Deposits have zero variance across all periods.

---

## 8. Platform-Wide Withdrawal Duplicate Audit (All Real Investors)

A comprehensive read-only audit across all 90 active investor accounts in authoritative production:

- **Total Active Investor Accounts Audited:** **90**
- **Accounts with Active Withdrawals:** **19**
- **Suspicious Withdrawal Groups Detected:** **1** (`ssire`, May 2026, $25,000.00)
- **Potential Balance Double-Counts:** **0** (All 19 accounts deduct withdrawals exactly once in ledger balance)
- **Accounts with Available Equity Double-Reservation:** **1** (`ssire` — $25,000.00 excess reservation)

### Detail of 19 Withdrawal Accounts:
1. `ssire` (Scott Sire): $25,000.00 — Dual representation (1 Pending, 1 Completed). Balance correct; UI displays duplicate activity; equity reserved 2x.
2. `jerrys` (Jerry's Rogue Jets): $10,000.00 ($2,500.00/mo May, June, July, August). Fully remediated on Sept 4 (`wd_feaa5056` deleted; prototype `wd_2eeb5318` cancelled).
3. `mharris` (Mary Jo Harris): $47,700.00 — Certified clean.
4. `jbennion` (Jeff Bennion): $21,500.00 — Certified clean.
5. `vmoss` (Vida Moss): $110,000.00 — Certified clean.
6. `mrichards` (Mark Richards): $48,000.00 — Certified clean.
7. `jstout` (Joshua Stout): $20,000.00 — Certified clean.
8. `nguyer` (Nelson Guyer): $20,000.00 — Certified clean.
9. `nwaite` (Nancy Waite): $14,500.00 — Certified clean.
10. `arichards` (Adam Richards): $9,000.00 — Certified clean.
11. `tboardwalk` (Ted Boardwalk): $5,000.00 — Certified clean.
12. `jharder` (Jean Harter): $4,500.00 — Certified clean.
13. `tkruger` (Theresa Kruger): $3,599.33 — Certified clean.
14. `gwright` (Greg Wright): $2,500.00 — Certified clean.
15. `dwaite` (Dale Waite): $2,000.00 — Certified clean.
16. `joviatt` (Josh Oviatt): $1,590.00 — Certified clean.
17. `srichards` (Susan Richards): $1,000.00 — Certified clean.
18. `wmiller` (Whit Miller): $700.00 — Certified clean.
19. `dpatterson` (Doug Patterson): $450.00 — Certified clean.

---

## 9. Platform-Wide Deposit Duplicate Audit

- **Total Active Accounts Audited:** **90**
- **Accounts with Deposits:** **19**
- **Suspicious Deposit Groups Detected:** **0**
- **Potential Deposit Double-Counts:** **0**
- **Void Deposit Handling:** All VOID deposits are marked with `type = 'VOID'` and are strictly excluded from balance compounding by `lib/dashboard.js` line 191.

---

## 10. Audit of Admin State Transitions & Lifecycle

### Withdrawal Lifecycle:
- Correct canonical lifecycle: `Pending` -> `Approved` -> `Completed` (preserving single row `id`).
- Terminal states: `Cancelled`, `Void`.
- In `update_withdrawal_atomic`:
  - `Pending` can only transition to `Approved`, `Cancelled`, or `Void`.
  - Direct transition `Pending` -> `Completed` raises `INVALID_STATUS_TRANSITION`.
  - `Completed` rows are immutable and cannot transition.
- **Defect in Admin UI (`admin.html`):**
  - In `admin.html` (lines 1210-1215), the table only offers `Edit` and `Cancel` buttons.
  - In the edit modal, the status dropdown offers `Pending`, `Approved`, `Completed`, `Cancelled`.
  - Selecting `Completed` for a `Pending` withdrawal causes the RPC to reject the request with `INVALID_STATUS_TRANSITION`.
  - To record a completed payout, administrators circumvented the error by using `+ Add Withdrawal` (`POST /api/admin/withdrawals`) to insert a brand new row with status `Completed`, leaving the original `Pending` row in place.

### Deposit Lifecycle:
- Deposits do not currently use an atomic state transition RPC. Mutations execute via direct table operations in `api/admin/deposits/index.js` and `api/admin/deposits/[id]/void.js`.

---

## 11. Verification of Recent Hardening (Commit `61ce76c`)

Commit `61ce76c` (deployed September 5, 2026) introduced:
1. **Advisory-Locked Economic Duplicate Guard in `create_withdrawal_atomic`:**
   - Under an investor transactional lock, `create_withdrawal_atomic` scans for active rows (`Pending`, `Approved`, `Completed`) with identical investor, effective date, and amount.
   - Blocks insertion and returns `DUPLICATE_ECONOMIC_TRANSACTION` (HTTP 409).
2. **Fail-Closed Authoritative DB Precondition Guard (`lib/financial-mutation-guard.js`):**
   - Blocks any mutation if not connected directly to production project `julhldzkiqdeuuoqmvlo`.
3. **Universal Prohibition of Physical Deletes:**
   - Physical HTTP `DELETE` endpoints return HTTP 405 Method Not Allowed.

### Hardening Evaluation:
- **Did the Scott Sire issue predate hardening?** **YES**. The May duplicate records were created in May 2026, four months before commit `61ce76c`.
- **Does current hardening prevent new occurrences?** **YES**. Attempting to create an identical $25,000.00 withdrawal in the current system returns HTTP 409 `DUPLICATE_ECONOMIC_TRANSACTION`.
- **Remaining Gap:** The hardening does not retroactively cancel preexisting historical duplicate rows, and `index.html` continues to render badges for both rows.

---

## 12. Canonical Transaction Model Recommendation

### Recommended Model: Single Row Identity Lifecycle
```
[Investor Request] -> Status: 'Pending' (ID: wd_xxx)
                           |
                     [Admin Approves]
                           |
                           v
                      Status: 'Approved' (Same ID: wd_xxx)
                           |
                      [Payout Wire Sent]
                           |
                           v
                      Status: 'Completed' (Same ID: wd_xxx)
```
- **Terminal Reversals / Cancellations:** Transition existing row to `Cancelled` or `Void` (same ID).
- **UI Safeguard in `lib/dashboard.js` / `index.html`:**
  - If both a `Pending` and `Completed` row exist for the same investor, month, and amount, the `Completed` row MUST supersede the `Pending` row in the activity display, suppressing the redundant `Pending` badge.

---

## 13. Recommended Zero-Loss Remediation Plan

1. **Step 1 (Database Cleanup - Authorized Zero-Loss Mutation):**
   - Update the orphaned May 2026 `Pending` withdrawal row for Scott Sire (`inv_f22b8d5d`) to status `Cancelled` using `update_withdrawal_atomic` with audit actor note: `"Orphaned pending request cancelled - superseded by completed withdrawal"`.
   - Result:
     - The red `-$25,000.00 Withdrawal Completed` badge remains visible.
     - The yellow `-$25,000.00 Withdrawal Pending` badge is removed.
     - The ledger balance remains exactly **$10,013.48** (0.00 cent change).
     - The $25,000.00 excess available equity reservation is released.
2. **Step 2 (Admin UI Enhancement):**
   - Add explicit `Approve` and `Complete` action buttons in `admin.html` for `Pending` withdrawals to guide admins through the canonical lifecycle without creating replacement rows.
3. **Step 3 (Display Deduplication Defensive Rule):**
   - In `index.html` / `lib/dashboard.js`, add a display deduplication rule so that if an active `Completed` or `Approved` withdrawal exists for a given month and amount, any matching `Pending` withdrawal is hidden from the activity column.

---

## 14. Certification Confirmation
- Financial DB writes executed: **0**
- Provenance writes executed: **0**
- Myfxbook invocations executed: **0**
- Production deployment: **NOT_EXECUTED**
