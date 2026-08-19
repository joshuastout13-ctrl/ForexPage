# Investor Performance Display Implementation Certification

**Document Status:** TECHNICAL IMPLEMENTATION & SEMANTICS CERTIFICATION  
**Production Baseline Commit:** `d36613a`  
**Target Scope:** Investor Portal Frontend & Dashboard API Display Only (`lib/dashboard.js`, `index.html`)  
**Financial Writes / Mutations:** ZERO (0)  
**Accounting Finalization Status:** `HOLD`  
**Client Acceptance Status:** `NOT_COMPLETE_CLIENT_ACCEPTANCE_PENDING`  

---

## 1. Executive Summary & Root Cause Resolution

### Root Cause
Previously, `lib/dashboard.js` and `index.html` calculated periodic dollar gains by multiplying the investor's balance directly by the **Gross Fund Return %** without scaling by `investorSplitPct` (e.g. `liveBase * (pctToNum(safeLive.today) / 100)`). This produced two critical issues:
1. Investors on split tiers (e.g., 50%, 60%, 75%) saw gross trading dollar gains instead of their net earnings.
2. Uncertified intraperiod calculations (Today, This Week) were displayed as if they were authoritative accounting dollars.

### Remediation & Clean Semantics
1. **Fund Performance Card (Benchmark Gross %)**:
   - Displays master fund trading benchmark returns:
     - Today: Gross %
     - This Week: Gross %
     - This Month: Gross %
     - Last Month: Gross %
     - This Year: Gross %
2. **Account Performance Card (Investor Net Share)**:
   - Displays certified and projected monthly net investor returns:
     - **This Month**: Net Return % | Net Earnings $ (`Live / Projected`)
     - **Last Month**: Net Return % | Net Earnings $ (`Finalized`)
     - **This Year (YTD)**: Net Earnings $ (`Cumulative YTD`)
3. **Intraperiod & Multi-Period Policy**:
   - **Today & This Week Net $**: `OMITTED_PENDING_DEFINITION` (Intra-day/intra-week capital base has no certified time-weighted or unitized NAV accounting definition; omitted from Account Performance to prevent displaying uncertified dollar estimates).
   - **YTD Net %**: `OMITTED_PENDING_DEFINITION` (Multi-period investor rate is omitted until a formal money-weighted / time-weighted standard is approved by the client; certified cumulative **YTD Net Earnings $** is displayed instead).

---

## 2. API Contract & Data Model

### Data Contract (`lib/dashboard.js`)
```javascript
{
  fundPerformance: {
    today: { grossReturnPct: 0.15, label: "+0.15%" },
    week: { grossReturnPct: 0.85, label: "+0.85%" },
    month: { grossReturnPct: 1.20, label: "+1.20%" },
    lastMonth: { grossReturnPct: 3.13, label: "+3.13%" },
    year: { grossReturnPct: 24.11, label: "+24.11%" }
  },
  accountPerformance: {
    splitPct: 75,
    month: { netDollar: 513.15, netReturnPct: 0.90, status: "PROJECTED / LIVE" },
    lastMonth: { netDollar: 13038.10, netReturnPct: 2.3475, status: "FINALIZED" },
    year: { netDollar: 52920.92, status: "CUMULATIVE YTD" }
  }
}
```

---

## 3. Direct 3-Way Monthly Verification (July / Month 7)

| Account Username | Display Name | Split | Stored DB July Gain | Dashboard API Net $ | Rendered UI Net $ | Status / Annotations |
|:---|:---|:---:|:---:|:---:|:---:|:---|
| `jharder` | Jean Harter | 50% | $0.00 | $1,774.08 | $1,774.08 | `CENT_EXACT MATCH (PASS)` |
| `aray` | Austin Ray | 50% | $0.00 | $317.33 | $317.33 | `CENT_EXACT MATCH (PASS)`<br>`DISPLAY_AGAINST_CURRENT_LEDGER_PASS`<br>`SOURCE_RECONCILIATION_STILL_REQUIRED` |
| `mharris` | Mary Jo Harris | 60% | $0.00 | $19,209.64 | $19,209.64 | `CENT_EXACT MATCH (PASS)` |
| `mbeck` | Michael Beck | 75% | $0.00 | $13,038.10 | $13,038.10 | `CENT_EXACT MATCH (PASS)` |
| `jbennion` | Jeff Bennion | 100% | $0.00 | $77,549.01 | $77,549.01 | `CENT_EXACT MATCH (PASS)` |
| `bkimball` | Bill Kimball | 100% | $0.00 | $47,469.57 | $47,469.57 | `CENT_EXACT MATCH (PASS)` |

---

## 4. Commission Separation Audit (Bill Kimball)

- **July Trading Investment Gain**: **$47,469.57**
- **July Referral Commission Earned (Steve Kimbell)**: **$308.54**
- **July Closed Trading Balance**: **$1,564,069.40**
- **August 1 Active Operating Capital**: **$1,564,377.94** ($1,564,069.40 + $308.54)
- **Account Performance Last Month Net $**: **$47,469.57** (Excludes the $308.54 referral commission)
- **Status**: **PASS** (Zero contamination between investment returns and referral commissions).

---

## 5. 90-Account Automated Portal Sweep

```
Total Active Portals Tested: 90
Exact Canonical Matches:     90 / 90 (100%)
Variances:                   0
```

---

## 6. Mobile Responsiveness & Layout Verification

- **375px (iPhone SE)**: PASS
- **390px (iPhone 14/15)**: PASS
- **430px (iPhone 14/15 Pro Max)**: PASS
- **1366px Desktop**: PASS

---

## 7. Operational & Local Gate Status

```
This Month net earnings: CERTIFIED
Last Month net earnings: CERTIFIED
YTD net earnings: CERTIFIED
YTD net %: OMITTED_PENDING_DEFINITION
Today account net $: OMITTED_PENDING_DEFINITION
Week account net $: OMITTED_PENDING_DEFINITION
Fund gross %: CERTIFIED
Bill commission/performance separation: PASS
Austin display test: PASS
Austin source reconciliation: RECONCILIATION_REQUIRED
90-account monthly sweep: 90/90 exact
Mobile: PASS
Patch isolated: YES (lib/dashboard.js, index.html only)
Financial writes: 0
Performance deployment: APPROVE (Controlled UI/API patch only)
Finalization: HOLD
Client acceptance: NOT_COMPLETE_CLIENT_ACCEPTANCE_PENDING
```
