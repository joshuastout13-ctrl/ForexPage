# Performance Display Semantics & Capital Basis Audit

**Date:** 2026-08-18 (Updated with QC Pass: 2026-08-19)  
**Status:** DUAL_DEFECT_CONFIRMED — SEMANTIC + CAPITAL BASIS  
**Reference Document:** [PLATFORM_COMMISSION_AUDIT_CERTIFICATION.md](file:///c:/Users/Shilley%20Pc/ForexPage/docs/PLATFORM_COMMISSION_AUDIT_CERTIFICATION.md)  
**Trigger:** Josh: "The percentage to the right can show GROSS but the dollar value should reflect what THE INVESTOR is actually earning which is NET"

---

## 1. Summary of Dual Defect

The Fund Performance sidebar displays 5 cards: Today, This Week, This Month, Last Month, This Year.

The defect in [dashboard.js:322-351](file:///c:/Users/Shilley%20Pc/ForexPage/lib/dashboard.js#L322-L351) has **TWO independent mathematical errors**:

1. **Semantic Error:** It applies the fund's Gross % directly to investor balance without multiplying by `investorSplit %`.
2. **Capital Basis Error:** It multiplies by `summaryBalance` (current ending balance) rather than `eligibleCapital` (`opening_balance + eligible_deposits - eligible_withdrawals`). Because current balance already includes accumulated gains or recent draws, multiplying by ending balance distorts the calculation for **100% of investors**, including 100% split investors.

---

## 2. Mathematical Proof Across 4 Investor Profiles (July Return = +3.13%)

$$\text{Frontend Displayed \$} = \text{Current Balance} \times \frac{\text{Gross Return \%}}{100}$$
$$\text{Naive Net \$} = \text{Current Balance} \times \frac{\text{Gross Return \%} \times \text{Split \%}}{10,000}$$
$$\text{Canonical Accounting Net \$} = \text{Eligible Capital} \times \frac{\text{Gross Return \%} \times \text{Split \%}}{10,000}$$

| Investor Profile | Current Balance | Eligible Capital | Gross % | Split % | Frontend Displayed $ | Naive Net $ | Canonical Accounting Net $ | Total Variance | Capital Basis Variance |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Jean Harter (50%)** | $115,134.04 | $113,359.96 | 3.13% | 50% | $3,603.70 | $1,801.85 | **$1,774.09** | **+$1,829.61** | **+$27.76** |
| **Mary Jo Harris (60%)** | $1,042,087.23 | $1,022,877.59 | 3.13% | 60% | $32,617.33 | $19,570.40 | **$19,209.64** | **+$13,407.69** | **+$360.76** |
| **Michael Beck (75%)** | $568,441.65 | $555,403.55 | 3.13% | 75% | $17,792.22 | $13,344.17 | **$13,038.10** | **+$4,754.12** | **+$306.07** |
| **Jeff Bennion (100%)** | $2,555,153.27 | $2,477,604.26 | 3.13% | 100% | $79,976.30 | $79,976.30 | **$77,549.01** | **+$2,427.29** | **+$2,427.29** |

---

## 3. UI & Data Contract Specification (Future Implementation)

The frontend should consume canonical accounting engine outputs from `investor_monthly_history` rather than attempting to calculate live approximations:

```
┌──────────────────────────────────────────────────────────┐
│ FUND PERFORMANCE                                         │
│ Fund Gross Return:                     +3.13% (Gross)    │
├──────────────────────────────────────────────────────────┤
│ ACCOUNT PERFORMANCE                                      │
│ Investor Net Return:                   +1.878% (Net)     │
│ Investor Net Earnings:                 $19,209.64        │
└──────────────────────────────────────────────────────────┘
```

* **Investor Net %:** $\text{Gross Return \%} \times \frac{\text{Investor Split \%}}{100}$
* **Investor Net Earnings ($):** $\text{Eligible Capital} \times \frac{\text{Gross Return \%} \times \text{Investor Split \%}}{10,000}$
