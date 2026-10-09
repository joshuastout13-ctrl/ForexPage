# 4XTrack — Reconciliation of Josh's New Deposit and Withdrawal Batch

**Document Version:** 1.0.0-RECONCILIATION  
**Audit Timestamp:** 2026-10-09T01:45:00Z  
**Authoritative Supabase Project:** `julhldzkiqdeuuoqmvlo` (`Stone - Forex`)  
**Production URL:** [https://4xtrack.com](https://4xtrack.com)  
**Status:** **READ-ONLY RECONCILIATION COMPLETE — ZERO FINANCIAL MUTATIONS EXECUTED**  

---

## 1. Executive Summary & Client Instruction

Josh Stout provided a screenshot from an internal tracking spreadsheet with 31 transaction entries (15 deposits and 16 withdrawals totaling $1,553,190.87) with the instruction:

> *"Want to log these in the system to make sure it works right? Some of these could be duplicates in the system. Our manual file doesn’t have them checked off but if you see it in the system just ignore it. Don’t duplicate it."*

In accordance with this explicit instruction and platform safety protocols, **every single transaction was independently queried and reconciled against authoritative production database records**.

### Key Findings:
1. **14 Transactions are ALREADY RECORDED** ($224,960.97 total) and must be **IGNORED** to avoid duplicate economic entries.
2. **6 Transactions NEED REVIEW** ($232,808.58 total):
   - **1 transaction** (Theresa Kruger $1,696.33 withdrawal) was already executed as **$1,697.33** in the September batch (an exact $1.00 discrepancy with the manual spreadsheet).
   - **5 deposits** ($231,112.25 total) match the account's initial **`starting_capital`** on their activation date (`open_date`). These funds are already driving opening equity in `investor_monthly_history`. Logging them as new cash deposits would duplicate investor principal.
3. **3 Transactions are FUTURE-DATED for November 1, 2026** ($219,749.32 total) and must not be applied to current October settled balances.
4. **5 Transactions are GENUINELY MISSING for October 2026** (3 deposits totaling +$852,777.00, 2 withdrawals totaling -$26,000.00; net impact: +$826,777.00).
5. **3 Transactions are MISSING for the Locked September 2026 Period** (3 withdrawals totaling -$2,995.00 principal; total carryforward balance impact: -$3,040.98).

> [!IMPORTANT]
> **PRODUCTION MUTATIONS EXECUTED: ZERO.**
> No transactions have been posted, updated, or deleted. All findings are presented for Josh Stout's explicit review and authorization.

---

## 2. Complete Reconciliation Table (31 Entries)

| Row | Investor | Investor ID | Account ID | Type | Amount | Effective Date | Classification | Matching Production Tx ID | Existing Status | Proposed Action | Expected Balance Impact | Notes |
|:---:|---|---|---|:---:|---:|:---:|---|---|---|---|---:|---|
| **1** | Brad Holly | `inv_5deeea21` | `bholly` | DEPOSIT | $278,000.00 | 2026-10-01 | **MISSING** | `null` | Not recorded | Post upon authorization (`NEW_CASH`) | +$278,000.00 | Genuine missing deposit effective Oct 1. Increases settled balance to $1,176,008.56. |
| **2** | Jeff Bennion | `inv_65b7fbd9` | `jbennion` | WITHDRAWAL | $21,500.00 | 2026-09-01 | **ALREADY RECORDED** | `8c7e45a8-4a86-45bc-bda4-b6e51f30acfb` | Completed | None (Ignore) | $0.00 | Stakeholder-authorized September 1 batch withdrawal already executed. |
| **3** | Steve Kimball | `inv_16a045fa` | `skimbell` | WITHDRAWAL | $6,000.00 | 2026-10-01 | **MISSING** | `null` | Not recorded | Post upon authorization | -$6,000.00 | Genuine missing withdrawal effective Oct 1. Reduces settled balance to $76,556.99. |
| **4** | Steve Kimball | `inv_16a045fa` | `skimbell` | DEPOSIT | $175,279.32 | 2026-11-01 | **FUTURE-DATED** | `null` | Not recorded | Hold for November cycle | $0.00 | Future-dated effective 2026-11-01. October settled balance impact is $0.00. |
| **5** | Mary Jo Harris | `inv_4c5c0ee6` | `mharris` | WITHDRAWAL | $21,000.00 | 2026-09-01 | **ALREADY RECORDED** | `7d624f01-a0b1-4dc9-b6ca-28135b47eeeb` | Completed | None (Ignore) | $0.00 | Stakeholder-authorized September 1 batch withdrawal already executed. |
| **6** | Dale Waite | `inv_60ed0c32` | `dwaite` | WITHDRAWAL | $2,000.00 | 2026-08-01 | **ALREADY RECORDED** | `wd_042e2363` | Approved | None (Ignore) | $0.00 | August 2026 withdrawal requested 2026-08-11; already deducted in August history. |
| **7** | Dale Waite | `inv_60ed0c32` | `dwaite` | WITHDRAWAL | $2,000.00 | 2026-09-01 | **ALREADY RECORDED** | `b4b7f2ad-d1b6-4b78-89b0-951fb17c2552` | Completed | None (Ignore) | $0.00 | Stakeholder-authorized September 1 batch withdrawal already executed. |
| **8** | Dale Waite | `inv_60ed0c32` | `dwaite` | DEPOSIT | $6,500.00 | 2026-10-01 | **MISSING** | `null` | Not recorded | Post upon authorization (`NEW_CASH`) | +$6,500.00 | Genuine missing deposit effective Oct 1. Increases settled balance to $244,700.15. |
| **9** | Theresa Kruger | `inv_8cf28066` | `tkruger` | WITHDRAWAL | $1,696.33 | 2026-09-01 | **NEEDS REVIEW** | `af879743-8a64-42b9-898a-84d7925c40ad` | Completed | Confirm $1.00 discrepancy with Josh | $0.00 | Recorded as $1,697.33 in production September batch. Difference is exactly $1.00. |
| **10** | Josh Oviatt | `inv_ce0675be` | `joviatt` | WITHDRAWAL | $795.00 | 2026-09-01 | **MISSING (LOCKED PERIOD)** | `null` | Not recorded | Audited override for September | -$807.20 | Missing September withdrawal. Basis -$795.00, gain -$12.20; carryforward -$807.20. |
| **11** | Beth Beck | `inv_3dc85bea` | `bbeck` | DEPOSIT | $1,000.00 | 2026-10-01 | **ALREADY RECORDED** | `dep_f8db13aa` | confirmed | None (Ignore) | $0.00 | Wire deposit already confirmed in production with `NEW_CASH` treatment. |
| **12** | Adam Richards | `inv_d3ec0cf8` | `arichards` | WITHDRAWAL | $3,000.00 | 2026-09-01 | **ALREADY RECORDED** | `d2fe523b-217f-4333-80eb-fccd22583a93` | Completed | None (Ignore) | $0.00 | Stakeholder-authorized September 1 batch withdrawal already executed. |
| **13** | Doug Patterson | `inv_d5761f42` | `dpatterson` | WITHDRAWAL | $150.00 | 2026-09-01 | **ALREADY RECORDED** | `0ea6e317-c4cc-4888-a1dc-32e3e141b1fb` | Completed | None (Ignore) | $0.00 | Stakeholder-authorized September 1 batch withdrawal already executed. |
| **14** | Doug Patterson | `inv_d5761f42` | `dpatterson` | DEPOSIT | $5,000.00 | 2026-11-01 | **FUTURE-DATED** | `null` | Not recorded | Hold for November cycle | $0.00 | Future-dated effective 2026-11-01. October settled balance impact is $0.00. |
| **15** | Whit Miller | `inv_ea8b4eba` | `wmiller` | WITHDRAWAL | $700.00 | 2026-09-01 | **MISSING (LOCKED PERIOD)** | `null` | Not recorded | Audited override for September | -$710.75 | Missing September withdrawal. Basis -$700.00, gain -$10.75; carryforward -$710.75. |
| **16** | Michele Jackson | `inv_3eae6871` | `mjackson` | DEPOSIT | $10,000.00 | 2026-09-01 | **NEEDS REVIEW (STARTING CAPITAL)**| `account:mjackson:starting_capital` | Active Starting Capital | Do not post as new deposit | $0.00 | Matches account starting_capital ($10,000) on 2026-09-01. Already in opening balance. |
| **17** | Jack Fuller | `inv_693b8042` | `jfuller` | DEPOSIT | $148,582.25 | 2026-10-01 | **NEEDS REVIEW (STARTING CAPITAL)**| `account:jfuller:starting_capital` | Active Starting Capital | Do not post as new deposit | $0.00 | Matches account starting_capital ($148,582.25) on 2026-10-01. Already in opening balance. |
| **18** | Tiffany Llewellyn | `inv_e1797067` | `tllewellyn` | DEPOSIT | $4,000.00 | 2026-10-01 | **ALREADY RECORDED** | `dep_9054d104` | confirmed | None (Ignore) | $0.00 | Deposit already confirmed in production with `NEW_CASH` treatment. |
| **19** | April Stone | `inv_5537a3f8` | `astone` | DEPOSIT | $1,800.00 | 2026-10-01 | **ALREADY RECORDED** | `dep_ce2d4edb` | confirmed | None (Ignore) | $0.00 | Wire deposit already confirmed in production with `NEW_CASH` treatment. |
| **20** | Reagan Ruddell | `inv_9a4326e7` | `rruddell` | DEPOSIT | $2,000.00 | 2026-09-01 | **NEEDS REVIEW (STARTING CAPITAL)**| `account:rruddell:starting_capital` | Active Starting Capital | Do not post as new deposit | $0.00 | Matches account starting_capital ($2,000) on 2026-09-01. Already in opening balance. |
| **21** | Josh Stout | `stout001` | `stout001` | WITHDRAWAL | $20,000.00 | 2026-10-01 | **MISSING** | `null` | Not recorded | Post upon authorization | -$20,000.00 | Genuine missing withdrawal effective Oct 1. Reduces settled balance to $3,380,953.52. |
| **22** | Glenn Maddocks | `inv_5a509c6a` | `gmaddocks` | DEPOSIT | $568,277.00 | 2026-10-01 | **MISSING** | `null` | Not recorded | Post upon authorization (`NEW_CASH`) | +$568,277.00 | Genuine missing deposit effective Oct 1. Increases settled balance to $718,680.50. |
| **23** | Blaine Ray | `inv_81b6661d` | `bray` | WITHDRAWAL | $76,910.97 | 2026-09-01 | **ALREADY RECORDED** | `9e0c864c-3bb1-448b-90eb-e366c865db15` | Completed | None (Ignore) | $0.00 | Stakeholder-authorized September 1 batch withdrawal already executed. |
| **24** | Tami Clemensen | `inv_f596c657` | `fclemensen` | DEPOSIT | $60,000.00 | 2026-10-01 | **ALREADY RECORDED** | `dep_1356358c` | confirmed | None (Ignore) | $0.00 | Wire deposit already confirmed in production with `NEW_CASH` treatment. |
| **25** | Jeremy Evans | `inv_6ba53bbe` | `jevans` | WITHDRAWAL | $9,000.00 | 2026-09-01 | **ALREADY RECORDED** | `acdcd90c-cdda-457d-95eb-2309831fd428` | Completed | None (Ignore) | $0.00 | Stakeholder-authorized September 1 batch withdrawal already executed. |
| **26** | Kathy Dodge | `inv_a829dff6` | `kdodge` | DEPOSIT | $10,530.00 | 2026-10-01 | **NEEDS REVIEW (STARTING CAPITAL)**| `account:kdodge:starting_capital` | Active Starting Capital | Do not post as new deposit | $0.00 | Matches account starting_capital ($10,530) on 2026-10-01. Already in opening balance. |
| **27** | Kathy Dodge | `inv_a829dff6` | `kdodge` | DEPOSIT | $39,470.00 | 2026-11-01 | **FUTURE-DATED** | `null` | Not recorded | Hold for November cycle | $0.00 | Future-dated effective 2026-11-01. October settled balance impact is $0.00. |
| **28** | Jean Harder | `inv_bc1bcb0c` | `jharder` | WITHDRAWAL | $1,500.00 | 2026-09-01 | **MISSING (LOCKED PERIOD)** | `null` | Not recorded | Audited override for September | -$1,523.03 | Missing September withdrawal. Basis -$1,500, gain -$23.03; carryforward -$1,523.03. |
| **29** | Jean Harder | `inv_bc1bcb0c` | `jharder` | WITHDRAWAL | $1,500.00 | 2026-08-01 | **ALREADY RECORDED** | `wd_9eb4d3a0` | Approved | None (Ignore) | $0.00 | August 2026 withdrawal requested 2026-08-12; already deducted in August history. |
| **30** | Nelson Guyer | `inv_141417dc` | `nguyer` | WITHDRAWAL | $15,000.00 | 2026-09-01 | **ALREADY RECORDED** | `95650681-5de5-4662-93c5-e2d2a1657996` | Approved | None (Ignore) | $0.00 | Withdrawal already recorded in production (effective 2026-09-01). |
| **31** | Sheryl Alvarado | `inv_7dc0fe9a` | `saverado` | DEPOSIT | $60,000.00 | 2026-09-01 | **NEEDS REVIEW (STARTING CAPITAL)**| `account:saverado:starting_capital` | Active Starting Capital | Do not post as new deposit | $0.00 | Matches account starting_capital ($60,000) on 2026-09-01. Already in opening balance. |

---

## 3. Reconciliation Totals & Summary Metrics

- **Total Screenshot Transactions:** 31 ($1,553,190.87)
  - Total Screenshot Deposits: 15 ($1,370,438.57)
  - Total Screenshot Withdrawals: 16 ($182,752.30)
- **Already Recorded Transactions:** 14 ($224,960.97)
  - Already Recorded Deposits: 4 ($66,800.00)
  - Already Recorded Withdrawals: 10 ($158,160.97)
- **Transactions Needing Review:** 6 ($232,808.58)
  - $1.00 discrepancy on previously executed withdrawal: 1 ($1,696.33 vs $1,697.33)
  - Deposits embedded in initial `starting_capital`: 5 ($231,112.25)
- **Future-Dated Transactions (November 2026):** 3 ($219,749.32)
- **Genuinely Missing Transactions (Eligible for Posting):** 8 ($881,772.00)
  - Current-Month Missing (October 2026): 5 (3 deposits: $852,777.00; 2 withdrawals: $26,000.00; Net: +$826,777.00)
  - Locked Historical Missing (September 2026): 3 withdrawals ($2,995.00 principal; -$3,040.98 carryforward balance)

---

## 4. Deep Forensic Analysis of Complex Cases

### 4.1 Case A: Deposits Matching Initial Starting Capital (Potential Duplicates)
Five deposits on Josh's spreadsheet represent funds deposited upon account creation that were originally entered into `investor_accounts.starting_capital` instead of `deposits`:
1. **Michele Jackson (`inv_3eae6871` / `mjackson`):** Start date `2026-09-01`. Starting capital = $10,000.00. September opening balance was established at $10,000.00, earning $153.50 in September (+3.07% gross × 50% split). Stored September ending balance is $10,153.50.
2. **Reagan Ruddell (`inv_9a4326e7` / `rruddell`):** Start date `2026-09-01`. Starting capital = $2,000.00. September opening balance was established at $2,000.00, earning $61.40 in September (+3.07% gross × 100% split). Stored September ending balance is $2,061.40.
3. **Sheryl Alvarado / Ryan Dunnam (`inv_7dc0fe9a` / `saverado`):** Start date `2026-09-01`. Starting capital = $60,000.00. September opening balance was established at $60,000.00, earning $921.00 in September (+3.07% gross × 50% split). Stored September ending balance is $60,921.00.
4. **Jack Fuller (`inv_693b8042` / `jfuller`):** Start date `2026-10-01`. Starting capital = $148,582.25. October opening balance is already established at $148,582.25.
5. **Kathy Dodge (`inv_a829dff6` / `kdodge`):** Start date `2026-10-01`. Starting capital = $10,530.00. October opening balance is already established at $10,530.00.

**Accounting Verdict:**  
If these 5 entries are posted as new rows in `deposits` with treatment `NEW_CASH`, the system will add them ON TOP OF their starting capital, doubling their balances!  
**Recommendation:** Do NOT post as new cash. If documentation of the deposit receipt is desired, record them with `accounting_treatment = 'HISTORICAL_PROVENANCE'` so that they do not alter equity balances.

### 4.2 Case B: Theresa Kruger $1.00 Discrepancy
- Spreadsheet entry: Theresa Kruger | WITHDRAWAL $1,696.33 | 2026-09-01.
- Production database record: `af879743-8a64-42b9-898a-84d7925c40ad` | Amount: **$1,697.33** | Status: `Completed` | Notes: *"Stakeholder-authorized September 1, 2026 withdrawal batch."*
- September history: `withdrawals = 1697.33`.

**Accounting Verdict:**  
The withdrawal was already executed and settled in the September stakeholder batch, but with a $1.00 difference. Posting a new withdrawal of $1,696.33 would be an economic duplicate. Confirm with Josh whether the spreadsheet's $1,696.33 is a transcription typo for the $1,697.33 already settled.

### 4.3 Case C: Locked September 2026 Missing Withdrawals
Three withdrawals dated September 1, 2026 were omitted from the September batch and are missing from production:
1. **Josh Oviatt (`inv_ce0675be` / `joviatt`):** Withdrawal $795.00.
   - September opening: $52,578.80
   - Correct trading basis: $52,578.80 - $795.00 = $51,783.80
   - September gain (50% split): $794.88 (was $807.08; variance: -$12.20)
   - September ending balance: $52,578.68 (was $53,385.88; total variance: -$807.20)
2. **Whit Miller (`inv_ea8b4eba` / `wmiller`):** Withdrawal $700.00.
   - September opening: $117,858.66
   - Correct trading basis: $117,858.66 - $700.00 = $117,158.66
   - September gain (50% split): $1,798.39 (was $1,809.13; variance: -$10.75)
   - September ending balance: $118,957.05 (was $119,667.79; total variance: -$710.75)
3. **Jean Harder (`inv_bc1bcb0c` / `jharder`):** Withdrawal $1,500.00.
   - September opening: $115,355.60
   - Correct trading basis: $115,355.60 - $1,500.00 = $113,855.60
   - September gain (50% split): $1,747.68 (was $1,770.71; variance: -$23.03)
   - September ending balance: $115,603.28 (was $117,126.31; total variance: -$1,523.03)

**Accounting Verdict:**  
Because September 2026 is finalized and locked, posting these withdrawals requires an explicit audited historical override to adjust September basis, gains, and carryforwards without running routine recalculations.

---

## 5. Global Control Baseline Verification

All authoritative platform control baselines were verified directly against production:
- **Josh Stout (`stout001`):** Current settled balance $3,400,953.52 | Certified outside cash $1,606,090.00 | September commission $11,487.85 (MATCH)
- **Ted Boardwalk (`tboardwalk`):** September opening $0.00 | September ending $0.00 | September commission $1,702.78 | Current settled balance $1,702.78 | June $5k withdrawal preserved (MATCH)
- **David Townley (`dtownley`):** Current settled balance $38,223.16 (MATCH)
- **Sheryl Ryan Dunnam (`inv_7dc0fe9a`):** September gain $921.00 | September ending $60,921.00 (MATCH)
- **Ryan Ringer (`rringer`):** Certified external cash $125,000.00 (MATCH)
- **Jerry → Stout (`XFER-2026-00005`):** September transfer $2,500.00 | External cash impact $0.00 (MATCH)
- **Stout May Exception (`dep_454fb0c9`):** May active deposit $7,500.00 unchanged (MATCH)
