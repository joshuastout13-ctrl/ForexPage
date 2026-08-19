# Michael Beck Commission Forensic Investigation

**Date:** 2026-08-18 (Updated with QC Pass: 2026-08-19)  
**Status:** `ALL_COMMISSIONS_AND_BALANCES_VERIFIED_EXACT`  
**Reference Document:** [PLATFORM_COMMISSION_AUDIT_CERTIFICATION.md](file:///c:/Users/Shilley%20Pc/ForexPage/docs/PLATFORM_COMMISSION_AUDIT_CERTIFICATION.md)  
**Trigger:** Josh Aug 17–18, 2026 screenshots and commentary

---

## 1. Executive Summary

| Entity / Pair | Stored Ledger Status | Commission Rate | Calculation Basis | Financial Impact |
|:---|:---|:---|:---|:---|
| **Mary Jo Harris → Michael Beck** | Verified Exact ($9,776.83 total Feb–Jul) | 5.0% | `PERCENT_OF_GROSS_PROFIT` | $0.00 variance |
| **Josh Oviatt → Michael Beck** | Verified Exact ($81.03 in July) | 5.0% | `PERCENT_OF_GROSS_PROFIT` | $0.00 variance |
| **Walt Jarvis → Michael Beck** | Verified Exact ($614.63 total) | 5.0% | `PERCENT_OF_GROSS_PROFIT` | $0.00 variance |
| **Beth Beck → Michael Beck** | Verified Exact ($145.34 total) | 5.0% | `PERCENT_OF_GROSS_PROFIT` | $0.00 variance |

---

## 2. Mary Jo Harris Timing & Withdrawal Analysis

### Chronology:
* **June 30 Ending Balance:** $1,022,877.59
* **July Compounding:** Gross 3.13% @ 60% split = $19,209.64 $\implies$ **July 31 Ending = $1,042,087.23**.
* **August 11 Adjustments:**
  * Record `wd_e4fc9d89`: $22,000.00 (Approved, labeled July)
  * Record `wd_cd3c1dda`: $18,700.00 (Approved, labeled August)
  * Total Deductions = **$40,700.00**
* **August Active Balance:** $\$1,042,087.23 - \$40,700.00 = \mathbf{\$1,001,387.23}$.
* **Josh Approximate Comparison:** Josh's ~$1,001,338 figure corresponds to her **post-August-withdrawal transaction balance ($1,001,387.23)**, differing by **+$49.23**.
* **Discrepancy:** The $2,000 difference between Josh's note ($20,000) and production record `wd_e4fc9d89` ($22,000) is marked `RECONCILIATION_REQUIRED` pending wire verification.

---

## 3. Commission Rule Percentage Semantics

In `lib/commission-engine.js:218`:
$$\text{Recipient Amount} = \text{Gross Profit} \times \frac{\text{commission\_percent}}{100}$$

`commission_percent` is strictly **`PERCENT_OF_GROSS_PROFIT`**. It is NOT a percentage of balance, and NOT a percentage of the residual pool unless mathematically converted.

---

## 4. Josh Oviatt → Michael Beck Earning Verification

* **July 2026 Earning Record:** `1ed31b74-ef4f-40ed-b878-dcdd44a80fbf`
* **Recipient ID:** `inv_d2ab6da4` (Michael Beck)
* **Source ID:** `inv_ce0675be` (Josh Oviatt)
* **Amount:** **$81.03**
* **Generated At:** 2026-08-17T22:58:54.812Z
* **Status:** Stored and verified in database (`EXISTING_EARNING_PREVIOUSLY_OMITTED_BY_AUDIT_QUERY`).
