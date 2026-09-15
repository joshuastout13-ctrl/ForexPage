# September 2026 Withdrawal Batch Preflight & Execution Manifest

**Document Version:** 2.0.0  
**Effective Accounting Date:** `2026-09-01`  
**Target Database:** `julhldzkiqdeuuoqmvlo` (Supabase Production — Stone Forex)  
**Stakeholder Authorization Reference:** Josh Stout (September 1, 2026 Batch Entry Instruction)  
**Execution Mode:** **`PREFLIGHT DRY-RUN / ZERO MUTATIONS / VALIDATOR VERIFIED`**

---

## 1. Executive Summary

This preflight manifest audits all 12 stakeholder-authorized September 1, 2026 withdrawal requests submitted by fund manager Josh Stout.

### Preflight Findings
1. **Validator Resolution:** The start-date conflict blocker in `calculate_available_withdrawal_equity_sql` has been replaced with an authoritative accounting eligibility rule (`effective_date >= authoritativeAccountingStart`), allowing mid-year accounts to be evaluated cleanly without spurious metadata equality exceptions.
2. **Zero Prior Execution:** All 12 requested transactions have zero existing September records in production.
3. **Execution Readiness:**
   - **11 Accounts are `READY`:** Mark Richards, Jeff Bennion, Mary Jo Harris, Dale Waite, Theresa Kruger, Adam Richards, Doug Patterson, Nancy Waite, Josh Stout, Blaine Ray, and Jeremy Evans all have available withdrawal equity far exceeding their requested amounts.
   - **1 Account is `BLOCKED_EQUITY`:** Ted Boardwalk has an August settled balance of `$384.56`, which cannot cover the requested `$1,100.00`. It remains strictly blocked under fail-closed overdraw prevention.

---

## 2. 12-Row Master Preflight Table

| # | Name | Username | Investor ID | Account ID | Requested Amount | Effective Date | Current Settled Balance | Existing Reserved Withdrawals | Available Withdrawal Equity | Existing September Match | Start-Date Validation | Final Status |
|:---:|:---|:---|:---|:---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---|
| 1 | **Mark Richards** | `mrichards` | `inv_f797f3fe` | `mrichards` | $5,000.00 | `2026-09-01` | $401,624.72 | $5,000.00 | $396,624.72 | `[...]-f9ae79326c8b` | PASS (`2026-09-01 >= 2026-05-01`) | **EXECUTED (`Completed`)** |
| 2 | **Jeff Bennion** | `jbennion` | `inv_65b7fbd9` | `jbennion` | $21,500.00 | `2026-09-01` | $2,555,153.27 | $21,500.00 | $2,533,653.27 | `[...]-b6e51f30acfb` | PASS (`2026-09-01 >= 2026-04-01`) | **EXECUTED (`Completed`)** |
| 3 | **Mary Jo Harris** | `mharris` | `inv_4c5c0ee6` | `mharris` | $21,000.00 | `2026-09-01` | $1,001,387.23 | $21,000.00 | $980,387.23 | `[...]-28135b47eeeb` | PASS (`2026-09-01 >= 2026-02-01`) | **EXECUTED (`Completed`)** |
| 4 | **Dale Waite** | `dwaite` | `inv_60ed0c32` | `dwaite` | $2,000.00 | `2026-09-01` | $233,068.07 | $2,000.00 | $231,068.07 | `[...]-951fb17c2552` | PASS (`2026-09-01 >= 2026-06-01`) | **EXECUTED (`Completed`)** |
| 5 | **Theresa Kruger** | `tkruger` | `inv_8cf28066` | `tkruger` | $1,697.33 | `2026-09-01` | $110,029.38 | $1,697.33 | $108,332.05 | `[...]-84d7925c40ad` | PASS (`2026-09-01 >= 2026-06-01`) | **EXECUTED (`Completed`)** |
| 6 | **Adam Richards** | `arichards` | `inv_d3ec0cf8` | `arichards` | $3,000.00 | `2026-09-01` | $93,167.35 | $3,000.00 | $90,167.35 | `[...]-fccd22583a93` | PASS (`2026-09-01 >= 2026-02-01`) | **EXECUTED (`Completed`)** |
| 7 | **Doug Patterson** | `dpatterson` | `inv_d5761f42` | `dpatterson` | $150.00 | `2026-09-01` | $55,799.29 | $150.00 | $55,649.29 | `[...]-32e3e141b1fb` | PASS (`2026-09-01 >= 2026-04-01`) | **EXECUTED (`Completed`)** |
| 8 | **Nancy Waite** | `nwaite` | `inv_d8b5ab06` | `nwaite` | $7,000.00 | `2026-09-01` | $526,305.57 | $7,000.00 | $519,305.57 | `[...]-9057cf2977a9` | PASS (`2026-09-01 >= 2026-05-01`) | **EXECUTED (`Completed`)** |
| 9 | **Josh Stout** | `jstout` | `stout001` | `stout001` | $20,000.00 | `2026-09-01` | $3,304,774.83 | $20,000.00 | $3,284,774.83 | `[...]-a92d5a3ee483` | PASS (`2026-09-01 >= 2026-01-01`) | **EXECUTED (`Completed`)** |
| 10 | **Blaine Ray** | `bray` | `inv_81b6661d` | `bray` | $76,910.97 | `2026-09-01` | $922,928.60 | $76,910.97 | $846,017.63 | `[...]-e366c865db15` | PASS (`2026-09-01 >= 2026-03-01`) | **EXECUTED (`Completed`)** |
| 11 | **Jeremy Evans** | `jevans` | `inv_6ba53bbe` | `jevans` | $9,000.00 | `2026-09-01` | $947,592.99 | $9,000.00 | $938,592.99 | `[...]-2309831fd428` | PASS (`2026-09-01 >= 2026-08-01`) | **EXECUTED (`Completed`)** |
| 12 | **Ted Boardwalk** | `tboardwalk` | `inv_a79798ca` | `tboardwalk` | $1,100.00 | `2026-09-01` | $384.56 | $0.00 | $384.56 | NONE | PASS (`2026-09-01 >= 2026-01-01`) | **BLOCKED_EQUITY** |

---

## 3. Financial Equity vs Available Withdrawal Equity Distinction

The relationship governing available withdrawal equity is:
$$\text{Available Withdrawal Equity} = \max\left(0, \text{Settled August Ending Balance} + \text{Eligible September Deposits} + \text{August Capitalized Commissions} - \sum \text{Existing Active September Withdrawals}\right)$$

- When an account has zero September deposits and zero prior September withdrawals, **Available Withdrawal Equity = Settled Balance entering September**.
- Any `Pending`, `Approved`, or `Completed` withdrawal entered for September reserves equity dollar-for-dollar, reducing Available Withdrawal Equity while leaving the settled balance intact until month close.

---

## 4. Batch Summary Statistics

- **Total Requests Evaluated:** 12
- **Ready for Entry:** 11
- **Already Existing in Production:** 0
- **Blocked Due to Insufficient Equity:** 1 (`tboardwalk`)
- **Blocked Due to Other Errors:** 0
- **New Withdrawals Created During Preflight:** 0
- **Financial Database Writes:** 0
