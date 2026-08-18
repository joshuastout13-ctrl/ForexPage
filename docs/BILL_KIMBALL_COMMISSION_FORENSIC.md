# Bill Kimball Commission Forensic Investigation

## 1. Jan-Apr 2026 Commission Disposition

**Status:** PROVEN: Jan-Apr commissions were intentionally embedded in Bill's manual baseline opening balances.

**Evidence:**
Steve Kimbell (`inv_16a045fa`) to Bill Kimball (`inv_57a1a49a`) at 12.5%, effective `2026-01-01`.
The `commission_earnings` table correctly contains the calculated records for Jan-Apr, but they were missing from earlier queries because they were bulk-generated on `2026-08-15` during an accounting script pass.

However, the financial value was already captured in Bill's historical records. Tracing `investor_monthly_history`:

*   **Jan 2026:** Steve's commission generated = **$293.45**. 
    Bill's Jan Opening Balance: `$1,414,197.40`. 
    Bill's Feb Opening Balance: `$1,414,490.85`.
    Difference: `$1,414,490.85 - $1,414,197.40 = $293.45` (Exact match).

*   **Feb 2026:** Steve's commission generated = **$323.66**.
    Bill's Feb Opening Balance: `$1,414,490.85`.
    Bill's Mar Opening Balance: `$1,414,814.51`.
    Difference: `$1,414,814.51 - $1,414,490.85 = $323.66` (Exact match).

*   **Mar 2026:** Steve's commission generated = **$293.45**.
    Bill's Mar Opening Balance: `$1,414,814.51`.
    Bill's Apr Opening Balance: `$1,415,107.96`.
    Difference: `$1,415,107.96 - $1,414,814.51 = $293.45` (Exact match).

*   **Apr 2026:** Steve's commission generated = **$295.31**.
    Bill's Apr Opening Balance: `$1,415,107.96`.
    Bill's May Opening Balance: `$1,415,403.27`.
    Difference: `$1,415,403.27 - $1,415,107.96 = $295.31` (Exact match).

**Conclusion:** Category A. Jan-Apr commissions were intentionally embedded in Bill's historical baseline. The exact commission amounts were manually added to his opening balance each month prior to automated close.

## 2. Explanation of May-July Differences

Actual ledger amounts for Steve's commission to Bill:
*   May: $315.19
*   June: $355.26 (Previously calculated: $361.78. Difference = $6.52)
*   July: $308.54 (Previously calculated: $313.41. Difference = $4.87)

**Causal Source of Difference:**
The actual ledger (`commission_earnings`) calculates the 12.5% commission strictly based on the stored `investor_gross_profit` (or ending balance difference) in `investor_monthly_history` for Steve.
*   **June 2026:** Steve's opening = $77,440.24, ending = $78,861.27. Net profit = $1,421.03. With a 50% split, Steve's Gross Profit = $2,842.06. 12.5% of $2,842.06 = **$355.26**.
*   The earlier calculation of $361.78 applied a blanket gross return percentage against eligible capital without accounting for compounding mid-month adjustments or rounding discrepancies stored in the authoritative historical row. The ledger number ($355.26) is the correct derived value from the historical database.

## 3. Reproduction of Josh's Bill Checkpoint

Josh Checkpoint Target: **$1,515,404.01**

Using evidenced `investor_monthly_history` data for Bill Kimball:
*   June 2026 Opening Balance: `$1,462,568.31`
*   June 2026 Ending Balance (stored in DB): `$1,516,244.57`

**Variance Analysis:**
$1,516,244.57 (Stored June Ending) - $1,515,404.01 (Josh Checkpoint) = **$840.56**.

No balancing entry is allowed. The checkpoint does not reconcile exactly with the automated history traversal.

**Status: RECONCILIATION_REQUIRED.**

## 4. $25 Audit Tolerance Investigation

An uncommitted modification exists in `lib/historical-audit-engine.js`:
```javascript
} else if (diff <= HISTORICAL_COMPARISON_TOLERANCE) { // $25.00
  classification = "ACCEPTABLE_HISTORICAL_DIFFERENCE";
```
*   **Old Tolerance:** None. Any difference > $0 was flagged as `LEGACY_MANUAL` (if < Aug 2026) or `UNKNOWN`.
*   **Why Changed:** Code comment cites "Per fund administrator guidance...".
*   **Suppressed Discrepancies:** It suppresses any historical mathematical variance of $25 or less, reclassifying it as a passing `ACCEPTABLE_HISTORICAL_DIFFERENCE` rather than requiring manual review.
*   **Financial Impact:** It only affects the audit report classification. The engine explicitly notes "Accounting calculations themselves remain cent-accurate." It does not alter stored balances or commissions.

**Recommendation:** Financial reconciliation must preserve a separate `CENT_EXACT` variance. A $25 reporting tolerance should not reclassify a mathematical discrepancy as "reconciled". This change should be reverted unless explicitly authorized by Josh.
