# CASH PROVENANCE REVIEW & CAPITAL CONFIRMATION GUIDE

**Prepared For:** Josh Stout / Stone & Company Fund Leadership  
**Audited Population:** **88 Real Active Investor Portals** (System admin and 2 QA test accounts excluded)  
**Status:** `AWAITING_EXECUTIVE_CONFIRMATION`  
**Date:** September 5, 2026  

---

## Section 1: What We Need From You

To show accurate **Total Deposits** and **Total Performance %** on investor dashboards, we must know the **actual external cash** each investor sent into their account.

* **Total Deposits** = Initial cash wire sent at account opening + subsequent cash deposits.
* **Total Performance %** = (Current Settled Balance - Total Cash Sent) / Total Cash Sent × 100.
* **Why starting capital in the database is not enough:** In the portal database, "starting capital" represents an operating accounting basis (which often includes prior trading gains or portfolio cutovers). It proves accounting balance continuity, but does not prove how much actual cash was deposited.

---

## Section 2: Best Option — Provide Original Funding / Onboarding Source Document

Instead of answering questions for each individual account, the fastest and most reliable way to resolve these accounts is to provide **one** original master document:

* **What we are looking for:**
  1. An original **Bank Wire Log** or bank funding report showing incoming cash wires by investor name, date, and dollar amount.
  2. An original **Master Investor Onboarding Schedule** or spreadsheet where columns explicitly represent **Initial Cash Funded** (rather than beginning account balance).

* **Where the numbers currently came from:**
  * The current portal data came from the Google Sheet (`Investors` tab) and the comparison spreadsheet `Stone_and_Company_Accounting_Comparison_Jan-Jul_2026 (1).xlsx`.
  * That sheet tracked monthly trading performance and current balances, but did not have a dedicated column documenting original bank wire receipts.

> **If you can provide an incoming wire log or initial funding spreadsheet, we can automatically match all 88 accounts at once without any manual data entry.**

---

## Section 3: Priority Confirmations (Top 6 Items)

If a master document is not readily available, please confirm these 6 key accounts first:

### 1. Joshua Stout (`jstout` / `stout001`)
* **Current Settled Balance:** **$3,304,774.83** (Includes settled August earnings and August commission credited Sept 1; excludes open September trading return).
* **Candidate Initial Contribution:** **$2,487,789.63**
* **Known Subsequent Cash Deposits:** **$66,719.35** ($54,219.35 July + $10,000.00 pre-July + $2,500.00 August).
* **Conditional Total Cash Sent:** **$2,554,508.98**
* **Background:** The $2,487,789.63 figure was back-calculated from your August statement balance minus trading gains and deposits. It is not yet backed by a bank wire slip.
* **Question for Josh:**
  > **Was $2,487,789.63 actual external cash contributed to the account? If yes, what source or bank record confirms this initial funding?**
  *(If confirmed, your Total Deposits will be certified as $2,554,508.98 with +$750,265.85 / +29.37% total performance).*

### 2. David Valdes (`dvaldes` / `inv_df9fbf05`) — Duplicate Risk
* **Recorded Starting Basis (July 1, 2026):** **$647,352.90**
* **Recorded Deposit:** **$500,000.00**
* **Background:** If both are counted, his total deposits would become $1,147,352.90 against a current balance of $670,527.55, showing an artificial **-41% loss**.
* **Question:**
  > **Is the $500,000 deposit an additional new cash wire, or was it a duplicate entry of his initial funding?**

### 3. Gary Larson (`glarson` / `inv_2093cd23`) — Duplicate Risk
* **Recorded Starting Capital (August 1, 2026):** **$487,000.00**
* **Recorded Deposit:** **$120,000.00** (Dated 2026-09-01)
* **Question:**
  > **Was the $487,000 an actual incoming bank wire, and is the $120,000 September deposit new additional cash or part of the initial $487,000?**

### 4. Jerry's Rogue Jets (`jerrys` / `jerrys001`)
* **Operating Starting Capital:** **$514,124.14** (as of May 1, 2026).
* **Background:** An earlier draft mentioned a "$300k wire on Feb 5", but no bank record exists in the system to verify that claim.
* **Question:**
  > **What was the exact initial external cash wire sent to fund Jerry's account?**

### 5. Mary Jo Harris (`mharris` / `inv_4c5c0ee6`)
* **Operating Starting Capital:** **$931,765.13** (February 1, 2026 onboarding basis; grew to $1,022,877.59 by July 1).
* **Question:**
  > **What was the actual initial cash wire sent to open Mary Jo's account?**

### 6. Kelci Ray (`kray` / `inv_8115c9d3`)
* **Verified Cash Deposit:** **$50,000.00** (July 1, 2026 wire verified).
* **Balance Before Deposit:** **$5,197.76** (June ending balance from May 1 start).
* **Question:**
  > **What was Kelci Ray's initial cash wire when her account opened on May 1, 2026?**

---

## Section 4: Special Cutover & Portfolio Reset Cases

These 6 accounts hold authorized baseline resets that represent agreed portfolio equity, not fresh cash:

| Investor Name | Username | Operating Cutover Baseline | Known Additional Cash Deposits | Question for Leadership |
| :--- | :--- | :---: | :---: | :--- |
| **Jeff Bennion** | `jbennion` | $2,673,903.44 | $21,500.00 | What was Jeff's total lifetime cash wired into the fund prior to the Aug 1 reset? |
| **Ted Boardwalk** | `tboardwalk` | $17.19 | $0.00 | What was Ted's actual original cash contribution prior to the July 1 floor reset? |
| **Michael Landon** | `mlandon` | $10,872.81 | $60,016.18 | Is the $10,872.81 baseline derived from prior cash, or what was the original funding wire? |
| **Michael Beck** | `mbeck` | $557,693.10 | $0.00 | What was Michael Beck's actual cash contributed vs his referral equity baseline? |
| **Gary Malazian** | `gmalazian` | $193,430.20 | $99,975.00 | What was the initial cash contributed prior to the August 1 deposit of $99,975? |
| **Gary Larson** | `glarson` | $487,000.00 | $120,000.00 | Confirm if $487k was an actual wire and whether the $120k deposit is new or subsumed. |

---

## Section 5: Remaining Accounts Grouped by Onboarding Cohort

If an original wire log or master funding spreadsheet cannot be provided, the remaining 76 accounts are grouped below by onboarding batch. You only need to review these if no master source file exists:

### Onboarding Batch: January 1, 2026 (15 Accounts)

| Investor Name | Username | Investor ID | Starting Capital in Portal | Known Subsequent Deposits | Question |
| :--- | :--- | :--- | :---: | :---: | :--- |
| Stone and Co Owners Account | `stoneandco` | `inv_015f3774` | $195,271.76 | $0.00 | Confirm if $195,271.76 equals actual cash wired at opening. |
| Gonzalo Valdes | `gvaldes` | `inv_03c9c631` | $11,668.34 | $0.00 | Confirm if $11,668.34 equals actual cash wired at opening. |
| David Galvin | `dgalvin` | `inv_0b75a021` | $23,906.55 | $0.00 | Confirm if $23,906.55 equals actual cash wired at opening. |
| Steve Kimbell | `skimbell` | `inv_16a045fa` | $78,861.27 | $0.00 | Confirm if $78,861.27 equals actual cash wired at opening. |
| Brandon Bell | `bbell` | `inv_1bb229f6` | $2,668.21 | $0.00 | Confirm if $2,668.21 equals actual cash wired at opening. |
| Greg Wright | `gwright` | `inv_41d6a94e` | $267,832.34 | $35,000.00 | Confirm if $267,832.34 equals actual cash wired at opening. |
| Merwin Rasmussen | `mrasmussen` | `inv_4ff3e6b1` | $23,066.31 | $0.00 | Confirm if $23,066.31 equals actual cash wired at opening. |
| James Vreeken | `jvreeken` | `inv_5a9e32af` | $250.93 | $0.00 | Confirm if $250.93 equals actual cash wired at opening. |
| Janice Mosby | `jmosby` | `inv_6633b793` | $12,546.83 | $0.00 | Confirm if $12,546.83 equals actual cash wired at opening. |
| Brandon Eisenmann | `beisenman` | `inv_a00b6024` | $46,850.00 | $0.00 | Confirm if $46,850.00 equals actual cash wired at opening. |
| Susie Oaks | `soaks` | `inv_a8b6b338` | $23,420.52 | $0.00 | Confirm if $23,420.52 equals actual cash wired at opening. |
| Nic Haddock | `nhaddock` | `inv_b3f5e17f` | $42,482.80 | $0.00 | Confirm if $42,482.80 equals actual cash wired at opening. |
| Sophie Simmons | `ssimmons` | `inv_ce74c1bf` | $3,608.28 | $0.00 | Confirm if $3,608.28 equals actual cash wired at opening. |
| David and Patty Valdes | `dandpvaldes` | `inv_d89e1f2a` | $238,889.27 | $0.00 | Confirm if $238,889.27 equals actual cash wired at opening. |
| Walt Jarvis | `wjarvis` | `inv_e24a4040` | $55,460.74 | $0.00 | Confirm if $55,460.74 equals actual cash wired at opening. |

### Onboarding Batch: February 1, 2026 (13 Accounts)

| Investor Name | Username | Investor ID | Starting Capital in Portal | Known Subsequent Deposits | Question |
| :--- | :--- | :--- | :---: | :---: | :--- |
| April Stone | `astone` | `inv_5537a3f8` | $3,367.84 | $0.00 | Confirm if $3,367.84 equals actual cash wired at opening. |
| Eric strongin | `estrongin` | `inv_60cfabc0` | $193,337.73 | $0.00 | Confirm if $193,337.73 equals actual cash wired at opening. |
| Cathyann Jones | `cjones` | `inv_6173c725` | $47,274.52 | $0.00 | Confirm if $47,274.52 equals actual cash wired at opening. |
| Zulma Iracheta | `ziracheta` | `inv_6df1643c` | $36,059.96 | $0.00 | Confirm if $36,059.96 equals actual cash wired at opening. |
| Billy Guerrero | `bguerrero` | `inv_83d2ce14` | $45,139.21 | $0.00 | Confirm if $45,139.21 equals actual cash wired at opening. |
| Vida Moss | `vmoss` | `inv_a429c227` | $46,641.08 | $0.00 | Confirm if $46,641.08 equals actual cash wired at opening. |
| Jim Colby | `jcolby` | `inv_a7e429ce` | $234,923.35 | $0.00 | Confirm if $234,923.35 equals actual cash wired at opening. |
| Samuel Kimball | `skimball` | `inv_a889f86c` | $15,419.54 | $0.00 | Confirm if $15,419.54 equals actual cash wired at opening. |
| Greg Oaks | `goaks` | `inv_d1ef0a35` | $35,130.77 | $0.00 | Confirm if $35,130.77 equals actual cash wired at opening. |
| Adam Richards | `arichards` | `inv_d3ec0cf8` | $93,023.24 | $0.00 | Confirm if $93,023.24 equals actual cash wired at opening. |
| Nathan Richards | `nrichards` | `inv_d4157e18` | $36,098.53 | $0.00 | Confirm if $36,098.53 equals actual cash wired at opening. |
| Forrest and Tami Clemensen | `fclemensen` | `inv_f596c657` | $813,885.08 | $113,000.00 | Confirm if $813,885.08 equals actual cash wired at opening. |
| Sharon magnusson | `smagnusson` | `inv_fdebd671` | $21,861.15 | $0.00 | Confirm if $21,861.15 equals actual cash wired at opening. |

### Onboarding Batch: March 1, 2026 (8 Accounts)

| Investor Name | Username | Investor ID | Starting Capital in Portal | Known Subsequent Deposits | Question |
| :--- | :--- | :--- | :---: | :---: | :--- |
| Ryan Ringer | `rringer` | `inv_1f9ab366` | $168,583.94 | $0.00 | Confirm if $168,583.94 equals actual cash wired at opening. |
| Beth Beck | `bbeck` | `inv_3dc85bea` | $26,309.42 | $14,000.00 | Confirm if $26,309.42 equals actual cash wired at opening. |
| Glenn Maddocks | `gmaddocks` | `inv_5a509c6a` | $141,089.97 | $0.00 | Confirm if $141,089.97 equals actual cash wired at opening. |
| Blaine Ray | `bray` | `inv_81b6661d` | $908,707.33 | $0.00 | Confirm if $908,707.33 equals actual cash wired at opening. |
| Karma S Waite Family Trust | `ktrust` | `inv_840ea55a` | $53,888.05 | $0.00 | Confirm if $53,888.05 equals actual cash wired at opening. |
| Mark Nelson | `mnelson` | `inv_a4bddac7` | $108,389.00 | $0.00 | Confirm if $108,389.00 equals actual cash wired at opening. |
| CBS Mark Nelson | `cnelson` | `inv_cec324aa` | $108,389.00 | $0.00 | Confirm if $108,389.00 equals actual cash wired at opening. |
| Joe Wegner | `jwegner` | `jwegner001` | $2,978.37 | $0.00 | Confirm if $2,978.37 equals actual cash wired at opening. |

### Onboarding Batch: April 1, 2026 (8 Accounts)

| Investor Name | Username | Investor ID | Starting Capital in Portal | Known Subsequent Deposits | Question |
| :--- | :--- | :--- | :---: | :---: | :--- |
| Scott Valdes | `svaldes` | `inv_764c2992` | $225,420.40 | $0.00 | Confirm if $225,420.40 equals actual cash wired at opening. |
| Kandis Rucker | `krucker` | `inv_7e7dcda2` | $191,770.50 | $0.00 | Confirm if $191,770.50 equals actual cash wired at opening. |
| James Rucker | `jrucker` | `inv_95d70784` | $20,140.30 | $0.00 | Confirm if $20,140.30 equals actual cash wired at opening. |
| Laurie Lewis | `llewis` | `inv_9e04f7fe` | $154,802.91 | $0.00 | Confirm if $154,802.91 equals actual cash wired at opening. |
| Jean Harter | `jharder` | `inv_bc1bcb0c` | $113,359.96 | $0.00 | Confirm if $113,359.96 equals actual cash wired at opening. |
| Doug Patterson | `dpatterson` | `inv_d5761f42` | $55,087.17 | $2,000.00 | Confirm if $55,087.17 equals actual cash wired at opening. |
| Suzanne Jorgensen | `sjorgensen` | `inv_ef3a1e9d` | $21,310.60 | $0.00 | Confirm if $21,310.60 equals actual cash wired at opening. |
| Scott Sire | `ssire` | `inv_f22b8d5d` | $10,472.93 | $0.00 | Confirm if $10,472.93 equals actual cash wired at opening. |

### Onboarding Batch: May 1, 2026 (14 Accounts)

| Investor Name | Username | Investor ID | Starting Capital in Portal | Known Subsequent Deposits | Question |
| :--- | :--- | :--- | :---: | :---: | :--- |
| Garth Hansen | `ghansen` | `inv_09af98b3` | $31,251.76 | $0.00 | Confirm if $31,251.76 equals actual cash wired at opening. |
| Susan Richards | `srichards` | `inv_0c8db3e7` | $163,068.03 | $0.00 | Confirm if $163,068.03 equals actual cash wired at opening. |
| Ashlee Ray | `aray` | `inv_0d036796` | $20,276.86 | $13,000.00 | Confirm if $20,276.86 equals actual cash wired at opening. |
| Nelson Guyer | `nguyer` | `inv_141417dc` | $106,831.44 | $0.00 | Confirm if $106,831.44 equals actual cash wired at opening. |
| Austin Ray | `austinray` | `inv_1531b890` | $4,158.21 | $8,000.00 | Confirm if $4,158.21 equals actual cash wired at opening. |
| Christina Ray | `cray` | `inv_3c86fcfb` | $210,607.17 | $100,000.00 | Confirm if $210,607.17 equals actual cash wired at opening. |
| Steven Roberts | `sroberts` | `inv_4007ec6c` | $135,635.51 | $0.00 | Confirm if $135,635.51 equals actual cash wired at opening. |
| Rinie Miya | `rmiya` | `inv_53aeb6cc` | $69,441.16 | $0.00 | Confirm if $69,441.16 equals actual cash wired at opening. |
| Bill and Mary Kimball | `bkimball` | `inv_57a1a49a` | $1,516,599.83 | $0.00 | Confirm if $1,516,599.83 equals actual cash wired at opening. |
| Sherri Davis | `sdavis` | `inv_68f7a3f9` | $88,228.95 | $0.00 | Confirm if $88,228.95 equals actual cash wired at opening. |
| Ross Wamsley | `rwamsley` | `inv_920b8af8` | $1,225,862.69 | $0.00 | Confirm if $1,225,862.69 equals actual cash wired at opening. |
| Josh Oviatt | `joviatt` | `inv_ce0675be` | $51,778.78 | $0.00 | Confirm if $51,778.78 equals actual cash wired at opening. |
| Nancy Waite | `nwaite` | `inv_d8b5ab06` | $525,087.95 | $0.00 | Confirm if $525,087.95 equals actual cash wired at opening. |
| Mark Richards | `mrichards` | `inv_f797f3fe` | $430,160.69 | $0.00 | Confirm if $430,160.69 equals actual cash wired at opening. |

### Onboarding Batch: June 1, 2026 (8 Accounts)

| Investor Name | Username | Investor ID | Starting Capital in Portal | Known Subsequent Deposits | Question |
| :--- | :--- | :--- | :---: | :---: | :--- |
| Kylie Stone | `kstone` | `inv_197ae8e8` | $26,539.75 | $0.00 | Confirm if $26,539.75 equals actual cash wired at opening. |
| Teresa Horton | `thorton` | `inv_54a72d26` | $224,419.27 | $10,000.00 | Confirm if $224,419.27 equals actual cash wired at opening. |
| Dale Waite | `dwaite` | `inv_60ed0c32` | $231,445.94 | $0.00 | Confirm if $231,445.94 equals actual cash wired at opening. |
| Nathan And Shelli Thompson | `nthompson` | `inv_6e00f8df` | $25,458.75 | $0.00 | Confirm if $25,458.75 equals actual cash wired at opening. |
| Josh Isiaak | `jisiaak` | `inv_70b41b6c` | $37,019.40 | $0.00 | Confirm if $37,019.40 equals actual cash wired at opening. |
| Kim Clemenson | `kclemenson` | `inv_81d519e5` | $252,932.32 | $0.00 | Confirm if $252,932.32 equals actual cash wired at opening. |
| Theresa Kruger | `tkruger` | `inv_8cf28066` | $111,877.83 | $0.00 | Confirm if $111,877.83 equals actual cash wired at opening. |
| Isaac Richards | `irichards` | `inv_8efc0122` | $6,292.24 | $0.00 | Confirm if $6,292.24 equals actual cash wired at opening. |

### Onboarding Batch: July 1, 2026 (7 Accounts)

| Investor Name | Username | Investor ID | Starting Capital in Portal | Known Subsequent Deposits | Question |
| :--- | :--- | :--- | :---: | :---: | :--- |
| Von Ray | `vray` | `inv_1b6a693b` | $81,647.98 | $0.00 | Confirm if $81,647.98 equals actual cash wired at opening. |
| David Townley | `dtownley` | `inv_4d52f6a4` | $28,496.51 | $0.00 | Confirm if $28,496.51 equals actual cash wired at opening. |
| Brad Holly | `bholly` | `inv_5deeea21` | $723,963.93 | $20,000.00 | Confirm if $723,963.93 equals actual cash wired at opening. |
| Val Taylor | `vtaylor` | `inv_6a1b838a` | $297,205.81 | $0.00 | Confirm if $297,205.81 equals actual cash wired at opening. |
| Chad Holly | `cholly` | `inv_97762ca9` | $105,868.68 | $0.00 | Confirm if $105,868.68 equals actual cash wired at opening. |
| josh richards | `jrichards` | `inv_e1d4f2af` | $89,902.28 | $0.00 | Confirm if $89,902.28 equals actual cash wired at opening. |
| Whit Miller | `wmiller` | `inv_ea8b4eba` | $115,000.00 | $0.00 | Confirm if $115,000.00 equals actual cash wired at opening. |

### Onboarding Batch: August 1, 2026 (3 Accounts)

| Investor Name | Username | Investor ID | Starting Capital in Portal | Known Subsequent Deposits | Question |
| :--- | :--- | :--- | :---: | :---: | :--- |
| Nancy Kohlert | `nkohlert` | `inv_4d2df1cb` | $650,000.00 | $0.00 | Confirm if $650,000.00 equals actual cash wired at opening. |
| Jeremy Evans | `jevans` | `inv_6ba53bbe` | $947,592.99 | $0.00 | Confirm if $947,592.99 equals actual cash wired at opening. |
| Kyle Landon | `klandon` | `inv_835ffffd` | $75,000.00 | $0.00 | Confirm if $75,000.00 equals actual cash wired at opening. |


---

## Summary of Changes Made to Clean the Data

1. **Excluded Test Entities:** `qauser_1786117072188` and `qauser_1786118744896` were integration test accounts created during software testing. They have been permanently removed from investor calculations, reducing the active portal denominator from 90 to **88 real investors**.
2. **Corrected Investor Display Names:** Cleaned double spacing and verified names from primary records (including Kelci Ray, Gary Larson, Christina Ray, Dale Waite, Val Taylor, and Forrest & Tami Clemensen).
3. **Protected Dashboard Cards:** UNKNOWN starting capital is strictly prevented from masquerading as cash in the portal until confirmed.
