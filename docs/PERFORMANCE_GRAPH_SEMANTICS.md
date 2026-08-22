# Certified Performance Graph Semantics

**Document Date:** August 22, 2026  
**Status:** `CERTIFIED_BY_CLIENT / FULLY_IMPLEMENTED`  
**Client Statement (Josh Stout, August 22, 2026):**  
> *"The graph that has the bars should only show what the investors made on their account only.*  
> *Commissions and deposits and withdrawals are all additions or subtractions that take place on the month summary at the very bottom.*  
> *The bar chart is only for their account performance."*

---

## 1. Authoritative Graph Specification

* **Certified Semantics:** `INVESTOR_NET_TRADING_PERFORMANCE_ONLY`

### Bar Chart Rules
1. **Trading Performance Only:** Each bar on the monthly performance chart represents strictly the investor's net trading gain/return for that specific calendar month.
2. **Exclusion of Cashflows:**
   * Regular Deposits: **EXCLUDED**
   * Commission Deposits: **EXCLUDED**
   * One-Time Withdrawals: **EXCLUDED**
   * Recurring Monthly Draws: **EXCLUDED**
3. **Exclusion of Downline Referral Commissions:**
   * Referral commissions (e.g. from downline investors) must **NEVER** increase or inflate the bar chart height.
   * Example (Bill Kimball): Steve Kimbell referral commission ($308.54/mo) is excluded from Bill's bar chart and appears only in the bottom summary table.
   * Example (Michael Beck): Downline referral commissions from Mary Jo, Walt, Whit, Beth, and Josh Oviatt are excluded from Michael's bar chart and appear only in the bottom summary table.
4. **Data Binding:**
   * Bar Height (Y-Axis): `r.effectiveReturnPct` (Investor Net Trading Return %)
   * Tooltip Dollar Gain: `r.gain` (Investor Net Trading Profit in USD)

---

## 2. Monthly Summary Table Semantics

The table at the bottom of the investor portal maintains the complete, itemized reconciliation:

| Column | Content | Included in Bar Chart? |
|---|---|---|
| **Month** | Calendar Month Label | Yes (X-Axis Label) |
| **Starting Balance** | Account balance at opening of month | No |
| **Deposits** | Regular capital additions | No |
| **Withdrawals** | Disbursed withdrawals & monthly draws | No |
| **Trading Gain ($)** | Net trading profit for the month | **YES (Bar Tooltip)** |
| **Net Return (%)** | Net trading return % for the month | **YES (Bar Height)** |
| **Commissions ($)** | Referral commissions credited | No |
| **Ending Balance** | Reconciled month-end capital balance | No |

---

## 3. Implementation Verification

* In [`lib/dashboard.js`](file:///c:/Users/Shilley%20Pc/ForexPage/lib/dashboard.js#L300-L317):
  * `gain` is computed as $\text{Adjusted Starting Capital} \times \frac{\text{Net Return \%}}{100}$.
  * `effectiveReturnPct` is computed as $\text{Gross Fund Return} \times \frac{\text{Investor Split \%}}{100}$ (or manual override).
  * `commissionsEarned` is computed independently.
* In [`index.html`](file:///c:/Users/Shilley%20Pc/ForexPage/index.html#L1145-L1190):
  * `pctData = fullBreakdown.map(r => r.effectiveReturnPct)`
  * `dollarGains = fullBreakdown.map(r => r.gain)`
  * The chart renders strictly `pctData` and `dollarGains`.

**Result:** The production application is 100% compliant with Josh's certified graph specification. Zero graph changes or deployments are required.
