# 4XTrack — Audited Correction Preview: Duplicate September 2026 Deposits

**Document Version:** 1.0.0-AUDIT-PREVIEW  
**Timestamp:** 2026-10-09T01:30:00Z  
**Authoritative Supabase Project:** `julhldzkiqdeuuoqmvlo` (`Stone - Forex`)  
**Production URL:** `https://4xtrack.com`  
**Status:** **READY FOR JOSH STOUT AUTHORIZATION (READ-ONLY PREVIEW — ZERO MUTATIONS EXECUTED)**  

---

## 1. Executive Summary & Authorization Context

Josh Stout has confirmed:
1. **Kevin Rucker** deposited **$5,000 ONE TIME** in September 2026.
2. **Neal Waite** deposited **$12,600 ONE TIME** in September 2026.

In the authoritative production database, each account currently contains **two confirmed active deposit records** dated September 1, 2026, causing a duplicate principal recognition of **$17,600.00** and a false September trading gain of **$270.16**, for a combined settled balance overstatement of **$17,870.16**.

This document presents an independently verified forensic investigation, cent-accurate mathematical recalculation, internal transfer impact assessment, global control baseline, and an idempotent, atomic SQL correction proposal.

> [!IMPORTANT]
> **PRODUCTION SAFETY NOTICE:**
> In accordance with Phase 1 safety rules, **NO FINANCIAL MUTATIONS HAVE BEEN EXECUTED**.
> The database remains 100% untouched. Execution requires explicit written authorization from Josh Stout.

---

## 2. Authoritative Production Verification (Phase 1)

All forensic queries were executed directly against the live production Supabase instance:
- **Project Identity:** `julhldzkiqdeuuoqmvlo` (`https://julhldzkiqdeuuoqmvlo.supabase.co`)
- **Connection Guard:** `isAuthoritativeProductionDbConfigured() === true` (Passed)
- **External Dependency Isolation:** Zero calls to Myfxbook, zero Google Sheets reliance, zero local fixture substitutions.
- **Audit Mode:** 100% Read-Only.

---

## 3. Account Forensic Analysis: Kevin Rucker (`inv_7e7dcda2` / `krucker`)

### 3.1 Production Records Identified
- **Investor Record:** `inv_7e7dcda2` (Kandis Rucker / portal `krucker`)
- **Account Record:** `krucker` (Active, starting capital $182,376.62)
- **September 2026 Deposits Identified:**

| Field | Record 1 (`dep_29b84085`) | Record 2 (`dep_10f79b13`) |
|---|---|---|
| **Deposit ID** | `dep_29b84085` | `dep_10f79b13` |
| **Amount** | **$5,000.00** | **$5,000.00** |
| **Date** | `2026-09-01` | `2026-09-01` |
| **Type** | `Wire` | `Wire` |
| **Status** | `confirmed` | `confirmed` |
| **Accounting Treatment** | `UNVERIFIED_LEGACY` | `NEW_CASH` |
| **Idempotency Key** | `legacy_dep_29b84085` | `e2880eda-b3ce-423f-a921-9e1f5c650518` |
| **Created At** | `2026-09-02T01:46:51.941212Z` | `2026-09-18T02:47:44.347052Z` |
| **Created By** | `null` (Automated legacy import) | `admin_user` (Authenticated admin session) |
| **Updated At** | `2026-09-16T02:59:04.947152Z` | `2026-09-18T02:47:44.287000Z` |
| **Transfer ID / Leg** | `null` / `null` | `null` / `null` |

### 3.2 Evidence & Recommendation
- **Record to PRESERVE:** **`dep_10f79b13`**
  - **Rationale:** Canonical `NEW_CASH` wire transaction created by `admin_user` with standard UUID idempotency key (`e2880eda-b3ce-423f-a921-9e1f5c650518`), reflecting the verified inbound wire receipt.
- **Record Proposed for VOID:** **`dep_29b84085`**
  - **Rationale:** Unverified legacy placeholder imported on Sep 2. When `admin_user` entered the canonical deposit on Sep 18, this legacy row was left un-voided, doubling economic recognition.
- **Action:** Transition `dep_29b84085` to `status = 'void'` and `type = 'VOID'` with full audit metadata. Never physically delete.

---

## 4. Account Forensic Analysis: Neal Waite (`inv_d8b5ab06` / `nwaite`)

### 4.1 Production Records Identified
- **Investor Record:** `inv_d8b5ab06` (Nancy Waite / portal `nwaite`)
- **Account Record:** `nwaite` (Active, starting capital $514,609.42)
- **September 2026 Deposits Identified:**

| Field | Record 1 (`dep_d75d7f29`) | Record 2 (`dep_576913ae`) |
|---|---|---|
| **Deposit ID** | `dep_d75d7f29` | `dep_576913ae` |
| **Amount** | **$12,600.00** | **$12,600.00** |
| **Date** | `2026-09-01` | `2026-09-01` |
| **Type** | `Internal Transfer` | `Wire` |
| **Status** | `confirmed` | `confirmed` |
| **Accounting Treatment** | `UNVERIFIED_LEGACY` | `NEW_CASH` |
| **Idempotency Key** | `legacy_dep_d75d7f29` | `df840d6b-8a3c-494e-9bb6-38fcc65f8562` |
| **Created At** | `2026-09-04T23:30:50.100791Z` | `2026-09-18T02:46:47.832319Z` |
| **Created By** | `null` (Automated legacy import) | `admin_user` (Authenticated admin session) |
| **Updated At** | `2026-09-16T02:59:04.947152Z` | `2026-09-18T02:46:47.751000Z` |
| **Transfer ID / Leg** | `null` / `null` | `null` / `null` |

### 4.2 Internal Transfer Impact Assessment (Critical Scrutiny)
The earlier audit noted `dep_d75d7f29` carried the label `Internal Transfer`. A deep production forensic sweep was conducted to determine if an internal transfer counterpart exists:
1. **Counterpart Withdrawal Search:** Queried all withdrawals across every investor in production for `amount = 12600.00`. Result: **ZERO rows found (`null`)**.
2. **Transfer Table Search:** Queried `internal_transfers` where `source_investor_id`, `target_investor_id`, `source_account_id`, or `target_account_id` equals `inv_d8b5ab06` / `nwaite`. Result: **ZERO rows found (`[]`)**.
3. **Record Metadata:** `transfer_id` is `null`, `transfer_leg` is `null`, `notes` is empty.
4. **Conclusion:** Row `dep_d75d7f29` was a mislabeled pre-entry from an unverified Google Sheets tab on Sep 4. On Sep 18, `admin_user` entered the canonical wire deposit `dep_576913ae` ($12,600.00) without voiding the legacy row. Josh Stout confirmed Neal Waite deposited external cash once.
5. **Counterparty Blast Radius:** Voiding `dep_d75d7f29` affects **ZERO other accounts**, removes **ZERO debits**, and creates **ZERO transfer imbalances**.

### 4.3 Evidence & Recommendation
- **Record to PRESERVE:** **`dep_576913ae`**
  - **Rationale:** Canonical `NEW_CASH` wire transaction created by `admin_user` with UUID idempotency key (`df840d6b-8a3c-494e-9bb6-38fcc65f8562`).
- **Record Proposed for VOID:** **`dep_d75d7f29`**
  - **Rationale:** Mislabeled legacy duplicate with no counterpart transfer leg.
- **Action:** Transition `dep_d75d7f29` to `status = 'void'` and `type = 'VOID'` with full audit metadata. Never physically delete.

---

## 5. Profit Split Verification & Accounting Rules

### 5.1 Authoritative Profit Split Resolution
Previous notes mentioned conflicting hypotheses regarding Neal Waite's profit split (50% vs 95%). Authoritative production tables conclusively prove:
- **Kevin Rucker (`inv_7e7dcda2`):**
  - `investors.split_pct`: **50.0%**
  - Commission shares configured: 5 recipients totaling **50.0%** (`inv_e1d4f2af` 11.6%, `inv_4d52f6a4` 5.0%, `inv_015f3774` 16.0%, `stout001` 1.4%, `inv_d3ec0cf8` 16.0%).
  - Total allocation: 50.0% investor + 50.0% commissions = **100.0%**.
- **Neal Waite (`inv_d8b5ab06`):**
  - `investors.split_pct`: **50.0%**
  - Commission shares configured: 5 recipients totaling **50.0%** (`inv_e1d4f2af` 11.6%, `inv_4d52f6a4` 5.0%, `inv_015f3774` 16.0%, `inv_920b8af8` 16.0%, `stout001` 1.4%).
  - Total allocation: 50.0% investor + 50.0% commissions = **100.0%**.
  - **Resolution:** The 95% figure was an unverified intake speculation. The true production split is **50.0%**. Stored historical gain ($8,480.55) precisely equals $552,479.10 basis × +3.07% gross × 50% split.

### 5.2 Accounting Rules Applied
- **Gross Fund Return:** +3.07% (0.0307) — **LOCKED**.
- **Effective Net Return:** 3.07% × 50% = **1.535%** (0.01535).
- **Trading Basis:** `August Ending Balance + September Deposits - September Withdrawals`.
- **Trading Gain:** `Trading Basis × 1.535%`.
- **Cent-Safe Arithmetic:** Executed using `Decimal.js` with 20 decimal places and standard half-up rounding.
- **Historical Commissions:** Commission earnings accrued in September are capitalized in October. As dictated by Phase 5 and commit `9e46f6a`, locked historical commissions are **PRESERVED** and **NOT REGENERATED**.
- **Open-Month Rule:** October 2026 is currently open (`CURRENT_OPEN`). October trading gains do not enter settled balances. October settled cashflows count immediately.

---

## 6. Independent Cent-Accurate Recalculation (Phase 4)

### 6.1 Kevin Rucker (`inv_7e7dcda2` / `krucker`)

```
August Ending Balance:         $197,722.5022
September Opening Balance:      $197,722.5022
September Withdrawals:                  $0.00
September Recurring Draw:               $0.00
Fund Gross Return:                     +3.07%
Investor Profit Split:                  50.0%
Net Monthly Return:                   +1.535%

METRIC                      BEFORE (DUPLICATE)     AFTER (CORRECTED)        VARIANCE
-----------------------------------------------------------------------------------------
September Deposits                 $10,000.00             $5,000.00       -$5,000.00
September Trading Basis           $207,722.5022          $202,722.5022     -$5,000.00
September Gain (+1.535%)            $3,188.5404            $3,111.7904         -$76.75
September Ending Balance          $210,911.0426          $205,834.2926     -$5,076.75
October Opening Balance           $210,911.0426          $205,834.2926     -$5,076.75
October Settled Cashflows               $0.00                  $0.00            $0.00
October Settled Balance           $210,911.0426          $205,834.2926     -$5,076.75

EXACT KEVIN RUCKER CORRECTION: -$5,076.75
(-$5,000.00 Principal Overstatement, -$76.75 Trading Gain Overstatement)
```

### 6.2 Neal Waite (`inv_d8b5ab06` / `nwaite`)

```
August Ending Balance:         $534,279.1026
September Opening Balance:      $534,279.1026
September Withdrawals:              $7,000.00 (Batch withdrawal completed 2026-09-01)
September Recurring Draw:               $0.00
Fund Gross Return:                     +3.07%
Investor Profit Split:                  50.0%
Net Monthly Return:                   +1.535%

METRIC                      BEFORE (DUPLICATE)     AFTER (CORRECTED)        VARIANCE
-----------------------------------------------------------------------------------------
September Deposits                 $25,200.00            $12,600.00      -$12,600.00
September Trading Basis           $552,479.1026          $539,879.1026    -$12,600.00
September Gain (+1.535%)            $8,480.5542            $8,287.1442        -$193.41
September Ending Balance          $560,959.6568          $548,166.2468    -$12,793.41
October Opening Balance           $560,959.6568          $548,166.2468    -$12,793.41
October Settled Cashflows               $0.00                  $0.00            $0.00
October Settled Balance           $560,959.6568          $548,166.2468    -$12,793.41

EXACT NEAL WAITE CORRECTION: -$12,793.41
(-$12,600.00 Principal Overstatement, -$193.41 Trading Gain Overstatement)
```

### 6.3 Combined Financial Variance vs Previous Audit Estimates

| Account | Previous Audit Estimate | Independent Recalculation | Variance / Explanation |
|---|---:|---:|---|
| **Kevin Rucker** | $5,076.75 | **$5,076.75** | Exact penny-level match. |
| **Neal Waite** | $12,793.41 | **$12,793.41** | Exact penny-level match. |
| **Combined Total** | **$17,870.16** | **$17,870.16** | **Exact penny-level match.** |

- **Total Duplicate Principal Eliminated:** **$17,600.00** ($5,000.00 + $12,600.00)
- **Total Duplicate Trading Gain Eliminated:** **$270.16** ($76.75 + $193.41)
- **Total Combined Balance Correction:** **-$17,870.16**

---

## 7. Locked-Period Safety & Mutation Protections (Phase 5)

Commits `9e46f6a` and `afee6f1` deployed strict guards in `api/admin/historical-data/recalculate-all.js` and `recalculate.js`:
1. **Locked Month Immutability (`afee6f1`):** Recalculation routines skip upserting `investor_monthly_history` records where `locked === true` or where the period is `HISTORICAL_SETTLED`, preventing accidental historical corruption.
2. **Settled Commission Protection (`9e46f6a`):** Routine recalculations cannot regenerate settled commissions in `commission_earnings` without explicit bypass flags (`allowHistoricalCommissionCorrection = true`) and an audit reason.

### How the Proposed Correction Preserves These Protections:
1. **Zero Global Recalculation:** We do **NOT** invoke `recalculate-all` or call automated endpoints.
2. **Locked Month Preserved:** September 2026 remains `locked = true` across the database.
3. **Fund Return Preserved:** September's gross return (+3.07%) is strictly untouched.
4. **Commissions Frozen:** Settled commissions are preserved 100% as-is without regeneration.
5. **Surgical Scope:** Only the 2 duplicate deposit records and the 4 affected monthly history records are touched.

---

## 8. Global Control Account Baseline (Phase 7)

The following baseline was captured directly from production during this audit. Every control value matches the required integrity baseline and must remain unchanged after correction:

| Control Account | Production Field / Metric | Baseline Value | Integrity Status |
|---|---|---:|:---:|
| **Josh Stout (`stout001`)** | Current Settled Balance | **$3,400,953.52** | MATCH |
| | Certified External Cash | **$1,606,090.00** | MATCH |
| | September Commission Earnings | **$11,487.85** | MATCH |
| | Lifetime Settled Withdrawals | **$40,000.00** | MATCH |
| **Ted Boardwalk (`tboardwalk`)** | September Opening Balance | **$0.00** | MATCH |
| | September Ending Balance | **$0.00** | MATCH |
| | September Commission Earnings | **$1,702.78** | MATCH |
| | Current Settled Balance | **$1,702.78** | MATCH |
| | Preserved June $5,000 Withdrawal | `wd_9a4f1219` (Completed) | MATCH |
| **David Townley (`dtownley`)** | Current Settled Balance | **$38,223.16** | MATCH |
| | September Commission Earnings | **$2,270.21** | MATCH |
| **Sheryl Ryan Dunnam (`inv_7dc0fe9a`)**| September Trading Gain | **$921.00** | MATCH |
| | September Ending Balance | **$60,921.00** | MATCH |
| **Ryan Ringer (`rringer`)** | Certified External Cash | **$125,000.00** | MATCH |
| **Jerry → Stout (`XFER-2026-00005`)** | September Internal Transfer | **$2,500.00** | MATCH |
| | External Cash Impact | **$0.00** | MATCH |
| **Stout May Exception (`dep_454fb0c9`)**| May Active Deposit | **$7,500.00** | MATCH |

---

## 9. Records To Be Modified vs. Records Remaining Untouched

### 9.1 Records to be Modified (Strictly 6 Rows)
1. `deposits`: `dep_29b84085` (Kevin Rucker duplicate legacy deposit, $5,000.00) → Transition to `status = 'void'`, `type = 'VOID'`.
2. `deposits`: `dep_d75d7f29` (Neal Waite duplicate legacy deposit, $12,600.00) → Transition to `status = 'void'`, `type = 'VOID'`.
3. `investor_monthly_history`: `4d160bac-1d91-486c-8bed-f8524ce33986` (Kevin Rucker September 2026) → Update `deposits = 5000.00`, `ending_balance = 205834.29260923903`.
4. `investor_monthly_history`: `064de334-ae59-4c8f-b9c1-84cfa2dba250` (Kevin Rucker October 2026) → Update `opening_balance = 205834.29260923903`, `ending_balance = 205834.29260923903`.
5. `investor_monthly_history`: `20ca0998-8819-41f1-8e9c-112c48c54850` (Neal Waite September 2026) → Update `deposits = 12600.00`, `ending_balance = 548166.2468041429`.
6. `investor_monthly_history`: `17b1427b-283a-480b-9d90-1c9ebbeced0f` (Neal Waite October 2026) → Update `opening_balance = 548166.2468041429`, `ending_balance = 548166.2468041429`.

### 9.2 Records That Must Remain 100% Untouched
- Canonical deposit `dep_10f79b13` ($5,000.00 Wire, Kevin Rucker)
- Canonical deposit `dep_576913ae` ($12,600.00 Wire, Neal Waite)
- Neal Waite batch withdrawal `2be6832c-049b-4b20-859e-9057cf2977a9` ($7,000.00)
- All historical records for August 2026 and prior for all investors
- All commission shares and rules in `commission_shares` and `commission_rules`
- All settled commission earnings in `commission_earnings`
- All monthly returns in `monthly_returns` (September +3.07% remains locked)
- All records for the other 106 investor accounts on the platform.

---

## 10. Proposed Audited Correction SQL (Phase 6)

The following atomic SQL migration is prepared for execution upon Josh Stout's authorization. It includes strict precondition verification that aborts the transaction if any record state deviates:

```sql
-- ============================================================================
-- 4XTRACK AUDITED CORRECTION: DUPLICATE SEPTEMBER 2026 DEPOSITS
-- Target: julhldzkiqdeuuoqmvlo (Stone - Forex)
-- Preconditions: Kevin Rucker ($5,000 single deposit), Neal Waite ($12,600 single deposit)
-- Mode: Transactionally Atomic, Idempotent, Zero Physical Deletes
-- ============================================================================

BEGIN;

-- 1. PRECONDITION ASSERTION: Kevin Rucker Pre-State
DO $$
DECLARE
  v_rucker_dep_count INT;
  v_rucker_sep_bal NUMERIC;
BEGIN
  SELECT count(*) INTO v_rucker_dep_count
  FROM deposits
  WHERE investor_id = 'inv_7e7dcda2' AND date = '2026-09-01' AND status = 'confirmed';

  SELECT ending_balance INTO v_rucker_sep_bal
  FROM investor_monthly_history
  WHERE id = '4d160bac-1d91-486c-8bed-f8524ce33986';

  IF v_rucker_dep_count != 2 THEN
    RAISE EXCEPTION 'PRECONDITION FAILED: Expected 2 active September deposits for Kevin Rucker, found %', v_rucker_dep_count;
  END IF;

  IF ROUND(v_rucker_sep_bal, 2) != 210911.04 THEN
    RAISE EXCEPTION 'PRECONDITION FAILED: Expected Kevin Rucker Sep balance 210911.04, found %', v_rucker_sep_bal;
  END IF;
END $$;

-- 2. PRECONDITION ASSERTION: Neal Waite Pre-State
DO $$
DECLARE
  v_waite_dep_count INT;
  v_waite_sep_bal NUMERIC;
BEGIN
  SELECT count(*) INTO v_waite_dep_count
  FROM deposits
  WHERE investor_id = 'inv_d8b5ab06' AND date = '2026-09-01' AND status = 'confirmed';

  SELECT ending_balance INTO v_waite_sep_bal
  FROM investor_monthly_history
  WHERE id = '20ca0998-8819-41f1-8e9c-112c48c54850';

  IF v_waite_dep_count != 2 THEN
    RAISE EXCEPTION 'PRECONDITION FAILED: Expected 2 active September deposits for Neal Waite, found %', v_waite_dep_count;
  END IF;

  IF ROUND(v_waite_sep_bal, 2) != 560959.66 THEN
    RAISE EXCEPTION 'PRECONDITION FAILED: Expected Neal Waite Sep balance 560959.66, found %', v_waite_sep_bal;
  END IF;
END $$;

-- 3. VOID DUPLICATE DEPOSIT: Kevin Rucker (dep_29b84085)
UPDATE deposits
SET
  status = 'void',
  type = 'VOID',
  voided_at = NOW(),
  voided_by = 'admin_audit',
  void_reason = 'Voided duplicate unverified legacy record dep_29b84085 ($5,000.00); preserved canonical wire dep_10f79b13 per Josh Stout authorization.',
  updated_at = NOW()
WHERE id = 'dep_29b84085'
  AND status = 'confirmed'
  AND amount = 5000.00;

-- 4. VOID DUPLICATE DEPOSIT: Neal Waite (dep_d75d7f29)
UPDATE deposits
SET
  status = 'void',
  type = 'VOID',
  voided_at = NOW(),
  voided_by = 'admin_audit',
  void_reason = 'Voided duplicate unverified legacy record dep_d75d7f29 ($12,600.00); preserved canonical wire dep_576913ae per Josh Stout authorization.',
  updated_at = NOW()
WHERE id = 'dep_d75d7f29'
  AND status = 'confirmed'
  AND amount = 12600.00;

-- 5. AUDITED OVERRIDE: Kevin Rucker September 2026 History
UPDATE investor_monthly_history
SET
  deposits = 5000.00,
  ending_balance = 205834.29260923903,
  notes = 'Audited correction of duplicate deposit dep_29b84085 authorized by Josh Stout. Trading basis corrected from $207,722.50 to $202,722.50; gain corrected from $3,188.54 to $3,111.79.',
  updated_at = NOW()
WHERE id = '4d160bac-1d91-486c-8bed-f8524ce33986'
  AND year = 2026
  AND month_number = 9;

-- 6. CARRYFORWARD UPDATE: Kevin Rucker October 2026 History
UPDATE investor_monthly_history
SET
  opening_balance = 205834.29260923903,
  ending_balance = 205834.29260923903,
  notes = 'Carryforward from corrected September 2026 ending balance ($205,834.29).',
  updated_at = NOW()
WHERE id = '064de334-ae59-4c8f-b9c1-84cfa2dba250'
  AND year = 2026
  AND month_number = 10;

-- 7. AUDITED OVERRIDE: Neal Waite September 2026 History
UPDATE investor_monthly_history
SET
  deposits = 12600.00,
  ending_balance = 548166.2468041429,
  notes = 'Audited correction of duplicate deposit dep_d75d7f29 authorized by Josh Stout. Trading basis corrected from $552,479.10 to $539,879.10; gain corrected from $8,480.55 to $8,287.14.',
  updated_at = NOW()
WHERE id = '20ca0998-8819-41f1-8e9c-112c48c54850'
  AND year = 2026
  AND month_number = 9;

-- 8. CARRYFORWARD UPDATE: Neal Waite October 2026 History
UPDATE investor_monthly_history
SET
  opening_balance = 548166.2468041429,
  ending_balance = 548166.2468041429,
  notes = 'Carryforward from corrected September 2026 ending balance ($548,166.25).',
  updated_at = NOW()
WHERE id = '17b1427b-283a-480b-9d90-1c9ebbeced0f'
  AND year = 2026
  AND month_number = 10;

-- 9. POST-CONDITION VERIFICATION
DO $$
DECLARE
  v_rucker_active_deps INT;
  v_waite_active_deps INT;
  v_rucker_new_sep NUMERIC;
  v_waite_new_sep NUMERIC;
BEGIN
  SELECT count(*) INTO v_rucker_active_deps
  FROM deposits
  WHERE investor_id = 'inv_7e7dcda2' AND date = '2026-09-01' AND status = 'confirmed';

  SELECT count(*) INTO v_waite_active_deps
  FROM deposits
  WHERE investor_id = 'inv_d8b5ab06' AND date = '2026-09-01' AND status = 'confirmed';

  SELECT ending_balance INTO v_rucker_new_sep
  FROM investor_monthly_history
  WHERE id = '4d160bac-1d91-486c-8bed-f8524ce33986';

  SELECT ending_balance INTO v_waite_new_sep
  FROM investor_monthly_history
  WHERE id = '20ca0998-8819-41f1-8e9c-112c48c54850';

  IF v_rucker_active_deps != 1 THEN
    RAISE EXCEPTION 'POST-CONDITION FAILED: Kevin Rucker active deposits expected 1, got %', v_rucker_active_deps;
  END IF;

  IF v_waite_active_deps != 1 THEN
    RAISE EXCEPTION 'POST-CONDITION FAILED: Neal Waite active deposits expected 1, got %', v_waite_active_deps;
  END IF;

  IF ROUND(v_rucker_new_sep, 2) != 205834.29 THEN
    RAISE EXCEPTION 'POST-CONDITION FAILED: Kevin Rucker Sep balance expected 205834.29, got %', v_rucker_new_sep;
  END IF;

  IF ROUND(v_waite_new_sep, 2) != 548166.25 THEN
    RAISE EXCEPTION 'POST-CONDITION FAILED: Neal Waite Sep balance expected 548166.25, got %', v_waite_new_sep;
  END IF;
END $$;

COMMIT;
```

---

## 11. Idempotency & Rollback / Compensating Strategy

1. **Idempotency:**
   The updates filter on `status = 'confirmed'` for the deposits and specify the exact row IDs and year/month numbers for history. Running the script a second time will cleanly encounter precondition failures without causing duplicate mutations or partial overwrites.
2. **Rollback Script (In Case of Reversion):**
   ```sql
   BEGIN;
   -- Revert Kevin Rucker
   UPDATE deposits SET status = 'confirmed', type = 'Wire', voided_at = null, voided_by = null, void_reason = null WHERE id = 'dep_29b84085';
   UPDATE investor_monthly_history SET deposits = 10000.00, ending_balance = 210911.04260923903 WHERE id = '4d160bac-1d91-486c-8bed-f8524ce33986';
   UPDATE investor_monthly_history SET opening_balance = 210911.04260923903, ending_balance = 210911.04260923903 WHERE id = '064de334-ae59-4c8f-b9c1-84cfa2dba250';

   -- Revert Neal Waite
   UPDATE deposits SET status = 'confirmed', type = 'Internal Transfer', voided_at = null, voided_by = null, void_reason = null WHERE id = 'dep_d75d7f29';
   UPDATE investor_monthly_history SET deposits = 25200.00, ending_balance = 560959.6568041429 WHERE id = '20ca0998-8819-41f1-8e9c-112c48c54850';
   UPDATE investor_monthly_history SET opening_balance = 560959.6568041429, ending_balance = 560959.6568041429 WHERE id = '17b1427b-283a-480b-9d90-1c9ebbeced0f';
   COMMIT;
   ```

---

## 12. Verification & Next Steps

1. **Josh Stout Authorization:** Review this preview document and provide explicit authorization to execute.
2. **Execution:** Apply the atomic SQL transaction to `julhldzkiqdeuuoqmvlo`.
3. **Post-Deployment Verification:** Run `scripts/verify_controls_and_calcs.mjs` and build live dashboards for `krucker` and `nwaite` to verify:
   - `krucker`: Settled Current Balance = **$205,834.29**
   - `nwaite`: Settled Current Balance = **$548,166.25**
   - All Global Controls remain identical.
