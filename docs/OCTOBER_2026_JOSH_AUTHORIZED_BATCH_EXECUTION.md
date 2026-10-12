# 4XTrack — Execution Report: Authorized 8-Transaction Batch
**October 2026 Cashflows & September 2026 Historical Withdrawals**

**Document Version:** 1.0.0-EXECUTION  
**Execution Timestamp:** 2026-10-12T12:57:48.784Z  
**Authoritative Supabase Project:** `julhldzkiqdeuuoqmvlo` (`Stone - Forex`)  
**Production URL:** [https://4xtrack.com](https://4xtrack.com)  
**Batch Identity:** `JOSH_AUTHORIZED_2026_10_BATCH_8_TRANSACTIONS`  
**PostgreSQL Audit Run ID:** `0853ca1c-09f5-45ae-ad7f-a651a1dc353b`  
**Execution Status:** **SUCCESS (COMMITTED & VERIFIED)**  

---

## 1. Executive Summary & Authorization Context

Josh Stout authorized the execution of exactly 8 transactions identified during the production reconciliation of the manual tracking spreadsheet:
- **5 October 2026 Open-Month Cashflows** (Brad Holly, Steve Kimball, Dale Waite, Josh Stout, Glenn Maddocks)
- **3 September 2026 Locked-Period Historical Withdrawals** (Josh Oviatt, Whit Miller, Jean Harder)

All other 23 entries on the spreadsheet were excluded in accordance with the client's explicit mandate:
- 14 already-recorded entries were ignored to prevent economic duplicates.
- 5 deposits matching initial activation starting capital were preserved without duplication.
- 1 entry ($1.00 variance on Theresa Kruger's already-settled withdrawal) was withheld.
- 3 November 2026 future-dated deposits were withheld for the November accounting cycle.
- The Kevin Rucker and Neal Waite duplicate-deposit corrections were isolated as a separate task.

### Live Preflight Discovery:
During Phase 1 preflight revalidation against live production immediately prior to mutation:
- **Brad Holly's $278,000.00 deposit was found to be ALREADY APPLIED** in production on October 9 in three legs:
  - `dep_eab29dcb`: $3,000.00 (Wire, confirmed, 2026-10-01)
  - `dep_48332152`: $25,000.00 (Wire, confirmed, 2026-10-01)
  - `dep_a7168d6f`: $250,000.00 (Wire, confirmed, 2026-10-01)
  - Total: **$278,000.00**, already reflected in October history and live settled balance ($1,176,008.56).
  - In accordance with safety rules (*"If an equivalent transaction already exists and has been economically applied, SKIP it"*), Brad Holly was **safely skipped** to prevent creating a catastrophic duplicate.
- **Intervening Deposit for Josh Stout:** On 2026-10-12 02:45 UTC, an admin created `dep_654ad1a9` ($2,500.00 "From Jerry's"), establishing Josh's pre-mutation settled balance at $3,403,453.52 ($1,608,590.00 outside cash). His authorized $20,000.00 withdrawal was applied directly against this live baseline, reducing his settled balance by exactly -$20,000.00 to $3,383,453.52.

The remaining 7 transactions and historical adjustments were executed in **ONE atomic, serializable PostgreSQL transaction** under transaction advisory lock `hashtext('JOSH_AUTHORIZED_2026_10_BATCH_8_TRANSACTIONS')`.

---

## 2. Transaction Execution Detail (All 8 Records)

| Item | Investor Name | Investor ID | Account ID | Type | Amount | Effective Date | Status / Action | Transaction ID(s) | Idempotency Key | Settled Balance Before | Settled Balance After | Net Variance |
|:---:|---|---|---|:---:|---:|:---:|:---:|---|---|---:|---:|---:|
| **1** | Brad Holly | `inv_5deeea21` | `bholly` | DEPOSIT | $278,000.00 | 2026-10-01 | **SKIPPED (ALREADY APPLIED)** | `dep_a7168d6f`<br>`dep_48332152`<br>`dep_eab29dcb` | `08ba5881-64f3-4069-9f09-1eb939b16477`<br>`a151b72e-d4a6-44b4-82a0-410a08e1a182`<br>`76200b27-a041-41da-9d33-4ea93dd35bb3` | $1,176,008.56 | $1,176,008.56 | $0.00 |
| **2** | Steve Kimball | `inv_16a045fa` | `skimbell` | WITHDRAWAL | $6,000.00 | 2026-10-01 | **POSTED (Completed)** | `wd_josh_auth_skimbell_6000` | `JOSH_AUTH_2026_10_BATCH_skimbell_wd_6000` | $82,556.99 | $76,556.99 | -$6,000.00 |
| **3** | Dale Waite | `inv_60ed0c32` | `dwaite` | DEPOSIT | $6,500.00 | 2026-10-01 | **POSTED (confirmed / NEW_CASH)** | `dep_josh_auth_dwaite_6500` | `JOSH_AUTH_2026_10_BATCH_dwaite_dep_6500` | $238,200.15 | $244,700.15 | +$6,500.00 |
| **4** | Josh Stout | `stout001` | `stout001` | WITHDRAWAL | $20,000.00 | 2026-10-01 | **POSTED (Completed)** | `wd_josh_auth_stout001_20000` | `JOSH_AUTH_2026_10_BATCH_stout001_wd_20000` | $3,403,453.52 | $3,383,453.52 | -$20,000.00 |
| **5** | Glenn Maddocks | `inv_5a509c6a` | `inv_5a509c6a` | DEPOSIT | $568,277.00 | 2026-10-01 | **POSTED (confirmed / NEW_CASH)** | `dep_josh_auth_gmaddocks_568277` | `JOSH_AUTH_2026_10_BATCH_gmaddocks_dep_568277` | $150,403.50 | $718,680.50 | +$568,277.00 |
| **6** | Josh Oviatt | `inv_ce0675be` | `joviatt` | WITHDRAWAL | $795.00 | 2026-09-01 | **POSTED (Completed / Sep Override)** | `wd_josh_auth_joviatt_795` | `JOSH_AUTH_2026_10_BATCH_joviatt_wd_795` | $53,385.88 | $52,578.68 | -$807.20 |
| **7** | Whit Miller | `inv_ea8b4eba` | `wmiller` | WITHDRAWAL | $700.00 | 2026-09-01 | **POSTED (Completed / Sep Override)** | `wd_josh_auth_wmiller_700` | `JOSH_AUTH_2026_10_BATCH_wmiller_wd_700` | $119,667.79 | $118,957.05 | -$710.75 |
| **8** | Jean Harder | `inv_bc1bcb0c` | `jharder` | WITHDRAWAL | $1,500.00 | 2026-09-01 | **POSTED (Completed / Sep Override)** | `wd_josh_auth_jharder_1500` | `JOSH_AUTH_2026_10_BATCH_jharder_wd_1500` | $117,126.31 | $115,603.28 | -$1,523.03 |

---

## 3. September 2026 Locked-Period Historical Override Accounting

The September 2026 gross return remained locked at **+3.07%** (`locked = true`).  
Each investor's September trading basis, monthly gain, and ending balance were recalculated using authoritative profit splits (50.0% investor share) and Decimal-safe arithmetic:

### Calculation Formula:
1. $\text{Trading Basis} = \text{Opening Balance} + \text{Deposits} - \text{Withdrawals}$
2. $\text{Net Monthly Return} = 3.07\% \times 50.0\% = 1.535\%$
3. $\text{Trading Gain} = \text{Trading Basis} \times 1.535\%$
4. $\text{September Ending Balance} = \text{Trading Basis} + \text{Trading Gain}$
5. $\text{October Opening Balance} = \text{September Ending Balance}$

### Account Breakdown:
1. **Josh Oviatt (`inv_ce0675be`):**
   - September Opening: $52,578.80
   - Legitimate Withdrawal: $795.00
   - Corrected Trading Basis: $51,783.80
   - Corrected September Gain: $794.88 (was $807.08; variance: -$12.20)
   - Corrected September Ending: **$52,578.68** (was $53,385.88; total variance: **-$807.20**)
   - October Carryforward: **$52,578.68**
2. **Whit Miller (`inv_ea8b4eba`):**
   - September Opening: $117,858.66
   - Legitimate Withdrawal: $700.00
   - Corrected Trading Basis: $117,158.66
   - Corrected September Gain: $1,798.39 (was $1,809.13; variance: -$10.75)
   - Corrected September Ending: **$118,957.05** (was $119,667.79; total variance: **-$710.75**)
   - October Carryforward: **$118,957.05**
3. **Jean Harder (`inv_bc1bcb0c`):**
   - September Opening: $115,355.60
   - Legitimate Withdrawal: $1,500.00 (August $1,500 withdrawal preserved separately)
   - Corrected Trading Basis: $113,855.60
   - Corrected September Gain: $1,747.68 (was $1,770.71; variance: -$23.03)
   - Corrected September Ending: **$115,603.28** (was $117,126.31; total variance: **-$1,523.03**)
   - October Carryforward: **$115,603.28**

**September Summary:**
- Principal Withdrawn: $2,995.00
- Trading Gain Adjustment: -$45.97
- Total September/October Balance Reduction: **-$3,040.98**
- September Immutability: Row `locked = true` fully preserved.

---

## 4. October 2026 Open-Month Cashflow Accounting

October 2026 is an open accounting period (`CURRENT_OPEN`).
- **NEW_CASH Deposits:** Recognized immediately in settled balance.
- **Completed Withdrawals:** Deducted immediately from settled balance.
- **Unclosed Trading Gains:** Accrue intramonth and remain informational; unbooked from settled capital.
- **Open-Month Commissions:** Uncapitalized until November 1 close.

**October Summary:**
- Deposits Posted in this batch: +$574,777.00 (Dale Waite $6,500.00 + Glenn Maddocks $568,277.00; Brad Holly $278,000.00 was applied on Oct 9)
- Withdrawals Posted: -$26,000.00 (Steve Kimball $6,000.00 + Josh Stout $20,000.00)
- Net October Settled Impact from this batch execution: **+$548,777.00**
- Total Batch Volume (including Brad Holly & September adjustments): **+$823,736.02**

---

## 5. Global Financial Control Baseline Verification

All authoritative platform control baselines were captured BEFORE and AFTER execution directly against production Supabase:

| Control Target | Metric | Pre-Mutation Baseline | Post-Mutation State | Expected Baseline / Target | Verification Status |
|---|---|---:|---:|---:|:---:|
| **Josh Stout (`jstout`)** | Settled Balance | $3,403,453.52 | $3,383,453.52 | $3,383,453.52 | ✅ EXACT MATCH (-$20,000.00) |
| **Josh Stout (`jstout`)** | Outside Cash | $1,608,590.00 | $1,608,590.00 | $1,608,590.00 | ✅ PRESERVED |
| **Ted Boardwalk (`tboardwalk`)** | Current Settled Balance | $1,702.78 | $1,702.78 | $1,702.78 | ✅ PRESERVED |
| **Ted Boardwalk (`tboardwalk`)** | September Ending Balance | $0.00 | $0.00 | $0.00 | ✅ PRESERVED |
| **Ted Boardwalk (`tboardwalk`)** | June $5,000 Withdrawal | $5,000.00 | $5,000.00 | $5,000.00 | ✅ PRESERVED |
| **David Townley (`dtownley`)** | Settled Balance | $38,223.16 | $38,223.16 | $38,223.16 | ✅ PRESERVED |
| **Sheryl Ryan Dunnam (`inv_7dc0fe9a`)**| September Trading Gain | $921.00 | $921.00 | $921.00 | ✅ PRESERVED |
| **Sheryl Ryan Dunnam (`inv_7dc0fe9a`)**| September Ending Balance | $60,921.00 | $60,921.00 | $60,921.00 | ✅ PRESERVED |
| **Ryan Ringer (`rringer`)** | Certified Outside Cash | $125,000.00 | $125,000.00 | $125,000.00 | ✅ PRESERVED |
| **Jerry -> Stout Transfer** | Recurring Internal Transfer | $2,500.00 (`XFER-2026-00005`) | $2,500.00 | $2,500.00 | ✅ PRESERVED |
| **Stout May Exception** | Active Deposit | $7,500.00 (`dep_454fb0c9`) | $7,500.00 | $7,500.00 | ✅ PRESERVED |
| **Fund Return September 2026**| Gross Return % / Lock Status | +3.07% (locked=true) | +3.07% (locked=true) | +3.07% (locked=true) | ✅ PRESERVED |

---

## 6. Regression Testing Results

All 5 core regression test suites plus the newly added 12-test targeted batch regression suite passed with zero errors:

1. `tests/test_locked_history_immutability.js` — **4 PASS / 0 FAIL**
2. `tests/test_month_state.js` — **39 PASS / 0 FAIL**
3. `tests/test_financial_mutation_safety.js` — **16 PASS / 0 FAIL**
4. `tests/test_commission_single_source_of_truth.js` — **4 PASS / 0 FAIL**
5. `tests/test_audit_hardening_and_rollover_regression.js` — **9 PASS / 0 FAIL**
6. `tests/test_authorized_batch_regression.js` (Targeted Suite) — **12 PASS / 0 FAIL**:
   - `[PASS]` 1. October NEW_CASH immediate settlement
   - `[PASS]` 2. October Completed withdrawal settlement
   - `[PASS]` 3. September locked-period withdrawal override
   - `[PASS]` 4. September trading gain correction
   - `[PASS]` 5. October carryforward
   - `[PASS]` 6. Duplicate prevention via unique index
   - `[PASS]` 7. Idempotent retry safety
   - `[PASS]` 8. Atomic rollback under transaction exception
   - `[PASS]` 9. Preservation of unrelated investor history
   - `[PASS]` 10. Preservation of commissions and monthly_returns
   - `[PASS]` 11. November future-date exclusion
   - `[PASS]` 12. Correct Josh Stout withdrawal accounting

---

## 7. Audit Compliance & Production Safety Checklist

- [x] Authoritative production Supabase verified (`julhldzkiqdeuuoqmvlo`).
- [x] Zero Google Sheets / fixtures used for financial mutation authorization.
- [x] Preflight dry-run completed with simulated rollback prior to commit.
- [x] Concurrency-safe PostgreSQL transaction with advisory lock utilized.
- [x] Deterministic idempotency keys applied to all insertions.
- [x] Zero physical DELETE operations performed.
- [x] Zero economic duplicate transactions created.
- [x] September +3.07% gross return preserved and locked.
- [x] Historical commissions in `commission_earnings` untouched and un-regenerated.
- [x] All 8 investor dashboards verified live via `buildInvestorDashboard` with `DATA_SOURCE=supabase` and `mustBeAuthoritative=true`.
- [x] Durable audit log entry persisted in `audit_runs`.
