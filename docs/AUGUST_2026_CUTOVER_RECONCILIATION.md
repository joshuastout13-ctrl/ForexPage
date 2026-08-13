# AUGUST 2026 AUTOMATION CUTOVER RECONCILIATION REPORT

**Generated:** 2026-08-13T12:24:58.878Z
**Cutover Boundary Date:** August 1, 2026
**Fund Accounting Timezone:** America/Los_Angeles (IANA)
**Myfxbook Reporting Timezone:** UTC (GMT+0)
**Database Storage Timezone:** UTC / TIMESTAMPTZ
**Engine Version:** 2.0.0
**Status:** READ-ONLY / PROPOSED CUTOVER BOUNDARY

---

## 1. Executive Summary & Cutover Policy

August 1, 2026 is designated as the **AUTOMATION CUTOVER BOUNDARY**.
- **Fund Accounting Timezone:** `America/Los_Angeles`. August 2026 accounting period extends from `2026-08-01 00:00:00 PDT` to `2026-08-31 23:59:59.999 PDT` (`2026-09-01 06:59:59.999 UTC`).
- **Trading Return Source Policy:** August investor accounting uses Myfxbook's official completed August monthly return % (`MYFXBOOK_COMPLETED_MONTH`). Timezone differences between Myfxbook's UTC month reset and Pacific month end do not modify Myfxbook's published monthly return.
- **Jan–Jul 2026 Accounting:** Legacy / manual historical data (`investor_monthly_history` with `is_manual: true`) remains untouched and permanently preserved.
- **August 2026 Onward:** Fully automated central accounting period calculations.
- **Opening Balance Policy:** August 1 opening balances are explicitly frozen from approved stored history rather than dynamically back-propagated across legacy months.

### Known Historical Rounding Discrepancy:
- **Investor:** Ashlee Ray (ARAY / `inv_0d036796`)
- **Stored July Ending Balance:** `$20,594.19`
- **Canonical Recalculated July Ending Balance:** `$20,594.20`
- **Difference:** `-$0.01`
- **Classification:** `LEGACY_ROUNDING_DIFFERENCE`
- **Action:** Preserved as stored ($20,594.19). Zero historical modifications made.

---

## 2. Investor-by-Investor Cutover Inventory

| Investor Name | Username | Stored Jul Ending | Stored Aug Opening | Jul Comm Credit | Aug Deposits | Aug Wd | Expected Aug Eligible Cap | Shadow Aug Eligible Cap | Diff | Status | Classification |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Adam Richards | `arichards` | $95206.96 | $96167.35 | $960.39 | $0.00 | $3000.00 | $93167.35 | $93167.35 | $0.00 | ✅ PASS | `READY` |
| admin_user | `admin` | $0.00 | $0.00 | $0.00 | $0.00 | $0.00 | $0.00 | $0.00 | $0.00 | ✅ PASS | `READY` |
| April Stone | `astone` | $3473.26 | $3473.26 | $0.00 | $0.00 | $0.00 | $3473.26 | $3473.26 | $0.00 | ✅ PASS | `READY` |
| Ashlee Ray | `aray` | $20594.19 | $20594.19 | $0.00 | $0.00 | $0.00 | $20594.19 | $20594.19 | $0.00 | ℹ️ LEGACY_ROUNDING | `LEGACY_ROUNDING` |
| Austin Ray | `austinray` | $0.00 | $0.00 | $0.00 | $7000.00 | $0.00 | $7000.00 | $11016.80 | $4016.80 | ⚠️ COMM_DIFF | `COMMISSION_CREDIT_DIFFERENCE` |
| Beth Beck | `bbeck` | $26721.17 | $26721.17 | $0.00 | $4000.00 | $0.00 | $30721.17 | $30721.17 | $0.00 | ✅ PASS | `READY` |
| Bill and Mary Kimball | `bkimball` | $0.00 | $0.00 | $308.54 | $0.00 | $0.00 | $308.54 | $1414505.94 | $1414197.40 | ⚠️ COMM_DIFF | `COMMISSION_CREDIT_DIFFERENCE` |
| Billy Guerrero | `bguerrero` | $45845.64 | $45845.64 | $0.00 | $0.00 | $0.00 | $45845.64 | $45845.64 | $0.00 | ✅ PASS | `READY` |
| Blaine Ray | `bray` | $922928.60 | $0.00 | $0.00 | $0.00 | $0.00 | $922928.60 | $922928.60 | $0.00 | ✅ PASS | `READY` |
| Brad Holly | `bholly` | $740958.98 | $740958.98 | $0.00 | $20000.00 | $0.00 | $760958.98 | $760958.98 | $0.00 | ✅ PASS | `READY` |
| Brandon Bell | `bbell` | $2709.96 | $2709.96 | $0.00 | $0.00 | $0.00 | $2709.96 | $2709.96 | $0.00 | ✅ PASS | `READY` |
| Brandon Eisenmann | `beisenman` | $47583.21 | $47583.21 | $0.00 | $0.00 | $0.00 | $47583.21 | $47583.21 | $0.00 | ✅ PASS | `READY` |
| Cathyann Jones | `cjones` | $0.00 | $0.00 | $0.00 | $0.00 | $0.00 | $0.00 | $43479.02 | $43479.02 | ⚠️ COMM_DIFF | `COMMISSION_CREDIT_DIFFERENCE` |
| CBS Mark Nelson  | `cnelson` | $110085.29 | $110085.29 | $0.00 | $0.00 | $0.00 | $110085.29 | $110085.29 | $0.00 | ✅ PASS | `READY` |
| Chad Holly | `cholly` | $107525.52 | $107525.52 | $0.00 | $0.00 | $0.00 | $107525.52 | $107525.52 | $0.00 | ✅ PASS | `READY` |
| Christina  Ray | `cray` | $213903.18 | $213903.18 | $0.00 | $50000.00 | $0.00 | $263903.18 | $263903.18 | $0.00 | ✅ PASS | `READY` |
| Dale  Waite | `dwaite` | $0.00 | $0.00 | $0.00 | $0.00 | $2000.00 | $-2000.00 | $225275.44 | $227275.44 | ⚠️ COMM_DIFF | `COMMISSION_CREDIT_DIFFERENCE` |
| David and Patty Valdes | `dandpvaldes` | $0.00 | $0.00 | $0.00 | $0.00 | $0.00 | $0.00 | $216153.98 | $216153.98 | ⚠️ COMM_DIFF | `COMMISSION_CREDIT_DIFFERENCE` |
| David Galvin | `dgalvin` | $24280.68 | $24280.68 | $0.00 | $0.00 | $0.00 | $24280.68 | $24280.68 | $0.00 | ✅ PASS | `READY` |
| David Townley | `dtownley` | $27990.75 | $29199.94 | $1209.19 | $0.00 | $0.00 | $29199.94 | $29199.94 | $0.00 | ✅ PASS | `READY` |
| David Valdes | `dvaldes` | $668457.61 | $670527.55 | $2069.94 | $0.00 | $0.00 | $670527.55 | $670527.55 | $0.00 | ✅ PASS | `READY` |
| Doug Patterson | `dpatterson` | $55949.29 | $55949.29 | $0.00 | $0.00 | $150.00 | $55799.29 | $55799.29 | $0.00 | ✅ PASS | `READY` |
| Eric strongin | `estrongin` | $196363.46 | $196363.46 | $0.00 | $0.00 | $0.00 | $196363.46 | $196363.46 | $0.00 | ✅ PASS | `READY` |
| Forrest and Tami  Clemensen | `fclemensen` | $826622.38 | $826622.38 | $0.00 | $0.00 | $0.00 | $826622.38 | $826622.38 | $0.00 | ✅ PASS | `READY` |
| Garth Hansen | `ghansen` | $31740.85 | $31740.85 | $0.00 | $0.00 | $0.00 | $31740.85 | $31740.85 | $0.00 | ✅ PASS | `READY` |
| Gary  Larson | `glarson` | $75000.00 | $75000.00 | $0.00 | $0.00 | $0.00 | $75000.00 | $0.00 | $-75000.00 | ⚠️ COMM_DIFF | `COMMISSION_CREDIT_DIFFERENCE` |
| Gary Malazian | `gmalazian` | $196457.38 | $196457.38 | $0.00 | $99975.00 | $0.00 | $296432.38 | $296432.38 | $0.00 | ✅ PASS | `READY` |
| Glenn Maddocks | `gmaddocks` | $144181.25 | $144181.25 | $0.00 | $0.00 | $0.00 | $144181.25 | $144181.25 | $0.00 | ✅ PASS | `READY` |
| Gonzalo Valdes | `gvaldes` | $11850.94 | $11850.94 | $0.00 | $0.00 | $0.00 | $11850.94 | $11850.94 | $0.00 | ✅ PASS | `READY` |
| Greg Oaks | `goaks` | $35680.57 | $35680.57 | $0.00 | $0.00 | $0.00 | $35680.57 | $35680.57 | $0.00 | ✅ PASS | `READY` |
| Greg Wright | `gwright` | $274119.70 | $274119.70 | $0.00 | $0.00 | $0.00 | $274119.70 | $274119.70 | $0.00 | ✅ PASS | `READY` |
| Isaac Richards | `irichards` | $6489.19 | $6489.19 | $0.00 | $0.00 | $0.00 | $6489.19 | $6489.19 | $0.00 | ✅ PASS | `READY` |
| James  Rucker | `jrucker` | $20455.50 | $20455.50 | $0.00 | $0.00 | $0.00 | $20455.50 | $20455.50 | $0.00 | ✅ PASS | `READY` |
| James Vreeken | `jvreeken` | $254.86 | $254.86 | $0.00 | $0.00 | $0.00 | $254.86 | $254.86 | $0.00 | ✅ PASS | `READY` |
| Janice Mosby | `jmosby` | $12743.19 | $12743.19 | $0.00 | $0.00 | $0.00 | $12743.19 | $12743.19 | $0.00 | ✅ PASS | `READY` |
| Jean Harter | `jharder` | $0.00 | $115134.04 | $0.00 | $0.00 | $1500.00 | $-1500.00 | $109186.24 | $110686.24 | ⚠️ COMM_DIFF | `COMMISSION_CREDIT_DIFFERENCE` |
| Jeannine Shaffar | `jshaffar` | $54254.46 | $54254.46 | $0.00 | $0.00 | $0.00 | $54254.46 | $54254.46 | $0.00 | ✅ PASS | `READY` |
| Jeff Bennion | `jbennion` | $2555153.27 | $2555153.27 | $0.00 | $21500.00 | $21500.00 | $2555153.27 | $2555153.27 | $0.00 | ✅ PASS | `READY` |
| Jeremy Evans | `jevans` | $947592.99 | $947592.99 | $0.00 | $0.00 | $0.00 | $947592.99 | $947592.99 | $0.00 | ✅ PASS | `READY` |
| Jerrys Rogue Jets | `jerrys` | $546135.92 | $546135.92 | $0.00 | $0.00 | $0.00 | $546135.92 | $546135.92 | $0.00 | ✅ PASS | `READY` |
| Jim Colby | `jcolby` | $240438.18 | $240600.56 | $162.38 | $0.00 | $0.00 | $240600.56 | $240600.56 | $0.00 | ✅ PASS | `READY` |
| Joe Wegner | `jwegner` | $3038.97 | $3038.97 | $0.00 | $0.00 | $0.00 | $3038.97 | $3038.97 | $0.00 | ✅ PASS | `READY` |
| Josh Isiaak | `jisiaak` | $37888.43 | $37888.43 | $0.00 | $0.00 | $0.00 | $37888.43 | $37888.43 | $0.00 | ✅ PASS | `READY` |
| Josh Oviatt | `joviatt` | $0.00 | $0.00 | $0.00 | $0.00 | $795.00 | $-795.00 | $50005.02 | $50800.02 | ⚠️ COMM_DIFF | `COMMISSION_CREDIT_DIFFERENCE` |
| josh richards | `jrichards` | $88542.11 | $102298.96 | $13756.85 | $0.00 | $0.00 | $102298.96 | $102298.96 | $-0.00 | ✅ PASS | `READY` |
| Joshua Stout | `jstout` | $3204903.50 | $3214484.21 | $9576.32 | $0.00 | $20000.00 | $3194479.82 | $3194479.82 | $0.00 | ✅ PASS | `READY` |
| Kandis Rucker | `krucker` | $194771.71 | $194771.71 | $0.00 | $0.00 | $0.00 | $194771.71 | $194771.71 | $0.00 | ✅ PASS | `READY` |
| Karma S Waite Family Trust | `ktrust` | $54731.40 | $54731.40 | $0.00 | $0.00 | $0.00 | $54731.40 | $54731.40 | $0.00 | ✅ PASS | `READY` |
| Kelci  Ray | `kray` | $56061.60 | $56061.60 | $0.00 | $0.00 | $0.00 | $56061.60 | $56061.60 | $0.00 | ✅ PASS | `READY` |
| Kim Clemenson | `kclemenson` | $256890.72 | $256890.72 | $0.00 | $0.00 | $0.00 | $256890.72 | $256890.72 | $0.00 | ✅ PASS | `READY` |
| Kyle Landon | `klandon` | $75000.00 | $75000.00 | $0.00 | $0.00 | $0.00 | $75000.00 | $75000.00 | $0.00 | ✅ PASS | `READY` |
| Kylie Stone | `kstone` | $27370.44 | $27370.44 | $0.00 | $0.00 | $0.00 | $27370.44 | $27370.44 | $0.00 | ✅ PASS | `READY` |
| Laurie  Lewis | `llewis` | $157952.37 | $157952.37 | $0.00 | $0.00 | $0.00 | $157952.37 | $157952.37 | $0.00 | ✅ PASS | `READY` |
| Mark Nelson | `mnelson` | $110085.29 | $110085.29 | $0.00 | $0.00 | $0.00 | $110085.29 | $110085.29 | $0.00 | ✅ PASS | `READY` |
| Mark Richards | `mrichards` | $0.00 | $0.00 | $0.00 | $0.00 | $42000.00 | $-42000.00 | $365638.43 | $407638.43 | ⚠️ COMM_DIFF | `COMMISSION_CREDIT_DIFFERENCE` |
| Mary Jo Harris | `mharris` | $1042087.23 | $0.00 | $0.00 | $0.00 | $40700.00 | $1001387.23 | $1001387.23 | $0.00 | ✅ PASS | `READY` |
| Merwin Rasmussen | `mrasmussen` | $23542.82 | $23542.82 | $0.00 | $0.00 | $0.00 | $23542.82 | $23542.82 | $0.00 | ✅ PASS | `READY` |
| Michael Beck | `mbeck` | $568441.65 | $570350.40 | $1908.75 | $0.00 | $0.00 | $570350.40 | $570350.40 | $0.00 | ✅ PASS | `READY` |
| Michael Landon | `mlandon` | $74883.68 | $74883.68 | $0.00 | $0.00 | $0.00 | $74883.68 | $74883.68 | $0.00 | ✅ PASS | `READY` |
| Nancy Kohlert | `nkohlert` | $650000.00 | $650000.00 | $0.00 | $0.00 | $0.00 | $650000.00 | $650000.00 | $0.00 | ✅ PASS | `READY` |
| Nancy Waite | `nwaite` | $533305.57 | $533305.57 | $0.00 | $0.00 | $7000.00 | $526305.57 | $526305.57 | $0.00 | ✅ PASS | `READY` |
| Nathan And Shelli Thompson | `nthompson` | $25857.18 | $25857.18 | $0.00 | $0.00 | $0.00 | $25857.18 | $25857.18 | $0.00 | ✅ PASS | `READY` |
| Nathan Richards | `nrichards` | $36945.94 | $36945.94 | $0.00 | $0.00 | $0.00 | $36945.94 | $36945.94 | $0.00 | ✅ PASS | `READY` |
| Nelson Guyer | `nguyer` | $108881.21 | $108946.40 | $65.19 | $0.00 | $20000.00 | $88946.40 | $88946.40 | $0.00 | ✅ PASS | `READY` |
| Nic Haddock | `nhaddock` | $43147.66 | $43147.66 | $0.00 | $0.00 | $0.00 | $43147.66 | $43147.66 | $0.00 | ✅ PASS | `READY` |
| QA User | `qauser_1786117072188` | $0.00 | $0.00 | $0.00 | $0.00 | $0.00 | $0.00 | $1000.00 | $1000.00 | ⚠️ COMM_DIFF | `COMMISSION_CREDIT_DIFFERENCE` |
| QA User | `qauser_1786118744896` | $1174.95 | $1174.95 | $0.00 | $0.00 | $0.00 | $1174.95 | $1174.95 | $0.00 | ✅ PASS | `READY` |
| Rinie Miya | `rmiya` | $70527.92 | $70527.92 | $0.00 | $0.00 | $0.00 | $70527.92 | $70527.92 | $0.00 | ✅ PASS | `READY` |
| Ross Wamsley | `rwamsley` | $1258515.03 | $0.00 | $51937.06 | $0.00 | $0.00 | $1310452.09 | $1310452.09 | $0.00 | ✅ PASS | `READY` |
| Ryan Ringer | `rringer` | $172277.61 | $172277.61 | $0.00 | $0.00 | $0.00 | $172277.61 | $172277.61 | $0.00 | ✅ PASS | `READY` |
| Samuel Kimball | `skimball` | $15902.17 | $15902.17 | $0.00 | $0.00 | $0.00 | $15902.17 | $15902.17 | $0.00 | ✅ PASS | `READY` |
| Scott Sire | `ssire` | $10686.00 | $10686.00 | $0.00 | $0.00 | $0.00 | $10686.00 | $10686.00 | $0.00 | ✅ PASS | `READY` |
| Scott Valdes | `svaldes` | $228948.23 | $228948.23 | $0.00 | $0.00 | $0.00 | $228948.23 | $228948.23 | $0.00 | ✅ PASS | `READY` |
| Sharon magnusson | `smagnusson` | $22203.28 | $22203.28 | $0.00 | $0.00 | $0.00 | $22203.28 | $22203.28 | $0.00 | ✅ PASS | `READY` |
| Sherri Davis | `sdavis` | $89609.73 | $89609.73 | $0.00 | $0.00 | $0.00 | $89609.73 | $89609.73 | $0.00 | ✅ PASS | `READY` |
| Sophie Simmons | `ssimmons` | $3721.22 | $3721.22 | $0.00 | $0.00 | $0.00 | $3721.22 | $3721.22 | $0.00 | ✅ PASS | `READY` |
| Steve Kimbell | `skimbell` | $80095.45 | $80095.45 | $0.00 | $0.00 | $0.00 | $80095.45 | $80095.45 | $0.00 | ✅ PASS | `READY` |
| Steven Roberts | `sroberts` | $0.00 | $0.00 | $0.00 | $0.00 | $0.00 | $0.00 | $131023.02 | $131023.02 | ⚠️ COMM_DIFF | `COMMISSION_CREDIT_DIFFERENCE` |
| Stone and Co Owners Account | `stoneandco` | $195657.88 | $249179.02 | $53468.56 | $0.00 | $0.00 | $249126.44 | $249126.44 | $0.00 | ✅ PASS | `READY` |
| Susan Richards | `srichards` | $166896.05 | $166896.05 | $0.00 | $0.00 | $0.00 | $166896.05 | $166896.05 | $0.00 | ✅ PASS | `READY` |
| Susie Oaks | `soaks` | $23787.05 | $23787.05 | $0.00 | $0.00 | $0.00 | $23787.05 | $23787.05 | $0.00 | ✅ PASS | `READY` |
| Suzanne Jorgensen | `sjorgensen` | $21644.11 | $21644.11 | $0.00 | $0.00 | $0.00 | $21644.11 | $21644.11 | $0.00 | ✅ PASS | `READY` |
| ted Boardwalk | `tboardwalk` | $-1508.02 | $-449.61 | $1058.41 | $0.00 | $0.00 | $-449.61 | $-449.61 | $-0.00 | ✅ PASS | `READY` |
| Teresa Horton | `thorton` | $227931.43 | $227931.43 | $0.00 | $10000.00 | $0.00 | $237931.43 | $237931.43 | $0.00 | ✅ PASS | `READY` |
| Theresa Kruger | `tkruger` | $113628.71 | $0.00 | $0.00 | $0.00 | $3599.33 | $110029.38 | $110029.38 | $0.00 | ✅ PASS | `READY` |
| Val  Taylor | `vtaylor` | $301857.08 | $302161.30 | $304.22 | $0.00 | $0.00 | $302161.30 | $302161.30 | $0.00 | ✅ PASS | `READY` |
| Vida Moss | `vmoss` | $47371.01 | $0.00 | $0.00 | $0.00 | $0.00 | $47371.01 | $47371.01 | $0.00 | ✅ PASS | `READY` |
| Von Ray | `vray` | $82925.77 | $82925.77 | $0.00 | $0.00 | $0.00 | $82925.77 | $82925.77 | $0.00 | ✅ PASS | `READY` |
| Walt Jarvis | `wjarvis` | $0.00 | $56328.71 | $0.00 | $0.00 | $0.00 | $0.00 | $50182.50 | $50182.50 | ⚠️ COMM_DIFF | `COMMISSION_CREDIT_DIFFERENCE` |
| Whit Miller | `wmiller` | $116799.75 | $116799.75 | $0.00 | $0.00 | $700.00 | $116099.75 | $116099.75 | $0.00 | ✅ PASS | `READY` |
| Zulma Iracheta | `ziracheta` | $36624.30 | $36624.30 | $0.00 | $0.00 | $0.00 | $36624.30 | $36624.30 | $0.00 | ✅ PASS | `READY` |

---

## 3. Reconciliation Totals

- **Total Investors Evaluated:** 91
- **Classified READY:** 78
- **Classified LEGACY_ROUNDING:** 1 (ARAY $0.01 cent variance)
- **Classified COMMISSION_CREDIT_DIFFERENCE:** 12
- **Total Eligible Capital (Shadow Engine):** $22719123.92

---

## 4. Reference Accounts Inspection

### Beth Beck (`bbeck`)
- **Stored July Ending Balance:** $26721.17
- **July Incoming Commission Credit:** $0.00
- **August Deposits:** $4000.00
- **August Withdrawals:** $0.00
- **August Eligible Capital:** $30721.17
- **Current Live Return:** 2.81%
- **Source Gain/Loss:** $431.64
- **Total Recipient Commissions:** $431.62
- **Proposed August Ending Balance:** $31152.81
- **Status:** PASS

### Ashlee Ray (`aray`)
- **Stored July Ending Balance:** $20594.19
- **July Incoming Commission Credit:** $0.00
- **August Deposits:** $0.00
- **August Withdrawals:** $0.00
- **August Eligible Capital:** $20594.19
- **Current Live Return:** 2.81%
- **Source Gain/Loss:** $289.35
- **Total Recipient Commissions:** $289.35
- **Proposed August Ending Balance:** $20883.54
- **Status:** PASS

### Glenn Maddocks (`gmaddocks`)
- **Stored July Ending Balance:** $144181.25
- **July Incoming Commission Credit:** $0.00
- **August Deposits:** $0.00
- **August Withdrawals:** $0.00
- **August Eligible Capital:** $144181.25
- **Current Live Return:** 2.81%
- **Source Gain/Loss:** $2836.05
- **Total Recipient Commissions:** $1215.44
- **Proposed August Ending Balance:** $147017.30
- **Status:** PASS

### Joshua Stout (`jstout`)
- **Stored July Ending Balance:** $3204903.50
- **July Incoming Commission Credit:** $9576.32
- **August Deposits:** $0.00
- **August Withdrawals:** $20000.00
- **August Eligible Capital:** $3194479.82
- **Current Live Return:** 2.81%
- **Source Gain/Loss:** $89764.88
- **Total Recipient Commissions:** $0.00
- **Proposed August Ending Balance:** $3284244.70
- **Status:** FLAGGED
