# Forensic Root Cause Analysis: System-Wide Admin Action Failure

**Document Status:** Priority 0 Adversarial Forensic Audit & Evidence Verification Report  
**Investigation Timestamp:** 2026-08-16
**Classification Gate:** `ADMIN_UI_NOT_SAFE_FOR_CONTROLLED_USE`

---

## 1. Recipient(undefined): Proven Code Path

**Status:** REPRODUCED_DEFECT (DISPLAY_ONLY)

**Forensic Evidence:**
The fix for `Recipient(undefined)` is committed code.
*   **Commit:** `a20433e2abf73a0aed70364fbaaa5c157dc52c2d`
*   **Date:** `2026-08-15 07:31:23 +0100`
*   **Deployment Status:** NOT DEPLOYED to production. The production environment continues to run the older backend artifact, which is why Josh continues to see `Recipient(undefined)` on the live `https://4xtrack.com/admin` site. The "fixed in-memory" behavior exists locally but is waiting for a Vercel deployment.

**Trace of Commission Share Rule:**
*   **Raw DB Row (`commission_shares`):**
    ```json
    {
      "id": "ba416991-585a-4a39-a300-394382490109",
      "source_investor_id": "inv_16a045fa",
      "recipient_investor_id": "inv_57a1a49a",
      "commission_percent": 12.5
    }
    ```
*   **Transformation (`lib/accounting-period-engine.js` line 223+):**
    The code maps `s.recipient_investor_id` using `investorMap["inv_57a1a49a"]` to enrich the object with `recipientName = "Bill and Mary Kimball"` and `recipientUsername = "bkimball"`.
*   **Preview API JSON consumed by Admin:**
    The API now outputs the enriched recipient identity, maintaining the financial `recipientId` intact regardless of the display name mapping.

---

## 2. Admin Click Failure

**Status:** ADMIN_ACTION_FAILURE_UNDER_INVESTIGATION

**Investigation Notes:**
The `pointer-events: none` style remains a `LATENT_BUILD_DEFECT`. The exact production click failure remains under investigation because empirical evidence has not proven Josh was using a build containing the latent defect. 

---

## 3. Financial Writes

**Status:** FROZEN

---

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

================================================================================
FINAL AUDIT GATE: ADMIN_UI_NOT_SAFE_FOR_CONTROLLED_USE
================================================================================
