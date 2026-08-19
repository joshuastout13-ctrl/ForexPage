# Global Control Total Dissection & Model Reconciliation

**Document Status:** OFFICIAL MATHEMATICAL RECONCILIATION & MODEL DISSECTION  
**Execution Timestamp:** 2026-08-19T02:20:00+01:00  
**Overall Client Status:** `NOT_COMPLETE_CLIENT_ACCEPTANCE_PENDING`  
**Pagination Deployment Gate:** `BLOCK_PENDING_GLOBAL_CONTROL_RECONCILIATION`  
**Financial Corrections Gate:** `NOT_AUTHORIZED`  

---

## 1. Precise Model Definitions

To prevent model conflation, three distinct financial totals are formally defined:

1. **`STORED_LEDGER`:** The exact sum of `ending_balance` across all Month 7 (July 2026) rows in the production `investor_monthly_history` table ($n = 96$ rows).
2. **`MODEL_A` (Global Roll-Forward of Stored Balances):**
   $$\text{Month 6 Stored Total} + \text{July External Deposits} - \text{July External Withdrawals} + \text{July Investor Net Profit} + \text{June Capitalized Commissions}$$
   Applies roll-forward logic across the full 96 database records without start-date zeroing or active-status pruning.
3. **`MODEL_B` (Dynamic Canonical Period Engine):**
   The output of `calculateAccountingPeriod({ year: 2026, month: 7 })`. Evaluates only active investors ($n = 91$), strictly enforces `start_date` boundaries (assigning $\$0.00$ eligible capital and $\$0.00$ ending balance to pre-start periods), and excludes inactive/deprecated identities ($n = 5$).

---

## 2. Programmatic Decimal Arithmetic & Headline Reconciliations

$$\begin{aligned}
\mathbf{\text{STORED\_LEDGER July Ending:}} &\quad \mathbf{\$23,408,842.82} \\
\mathbf{\text{MODEL\_A July Ending:}} &\quad \mathbf{\$23,417,005.74} \\
\mathbf{\text{MODEL\_B July Ending:}} &\quad \mathbf{\$21,121,166.24} \\
\hline
\text{STORED vs MODEL\_A Difference:} &\quad -\$8,162.92 \\
\text{STORED vs MODEL\_B Difference:} &\quad +\$2,287,676.58 \\
\text{MODEL\_A vs MODEL\_B Difference:} &\quad +\$2,295,839.50 \\
\hline
\mathbf{\text{Arithmetic Identity Verification:}} &\quad -\$8,162.92 + \$2,295,839.50 = \mathbf{+\$2,287,676.58} \quad (\text{Residual: } \mathbf{\$0.00})
\end{aligned}$$

---

## 3. Exact Component Bridge: MODEL_A vs MODEL_B ($+\$2,295,839.50$)

The multimillion-dollar variance between `MODEL_A` and `MODEL_B` is 100% accounted for by two structural accounting rules:

| Category | Component Description | Accounts Affected | Amount |
|:---|:---|:---:|:---:|
| **1. Future-Start Pre-Opening Seeds** | Investors with `start_date` $\ge$ August 1, 2026. `MODEL_A` rolls forward their July seed rows; `MODEL_B` enforces start-date boundaries and computes $\$0.00$ ending balance for July. | 4 accounts (`jevans` $\$947.59\text{k}$, `nkohlert` $\$650\text{k}$, `glarson` $\$75\text{k}$, `klandon` $\$75\text{k}$) | **+$1,747,592.99** |
| **2. Inactive / Deprecated Accounts** | Accounts with `active: false`. `MODEL_A` includes their historical seed carryforward; `MODEL_B` excludes inactive accounts from runtime accounting. | 5 accounts (`saccount` $\$543.65\text{k}$, 4 QA users $\$4.60\text{k}$) | **+$548,246.51** |
| **Total Bridge Sum** | $\mathbf{\$1,747,592.99 + \$548,246.51}$ | **9 accounts** | $\mathbf{+\$2,295,839.50}$ |
| **Unexplained Residual** | $\mathbf{\$2,295,839.50 - \$2,295,839.50}$ | — | $\mathbf{\$0.00}$ |

---

## 4. Exact Component Bridge: STORED_LEDGER vs MODEL_A ($-\$8,162.92$)

$$\begin{aligned}
\text{Stone \& Co Unpaginated Historical Omission (Month 7):} &\quad -\$5,711.48 \\
\text{Ross Wamsley Unpaginated Historical Omission (Month 7):} &\quad -\$5,711.47 \\
\text{Josh Richards Unpaginated Historical Omission (Month 7):} &\quad -\$4,174.11 \\
\text{David Townley Unpaginated Historical Omission (Month 7):} &\quad -\$1,174.72 \\
\text{Sample Account Stored Carryforward Difference:} &\quad +\$8,508.09 \\
\text{QA Users Stored Carryforward Difference (4 accounts):} &\quad +\$100.76 \\
\text{Step-Rounded Intermediate Decimal Precision (15 accounts):} &\quad +\$0.01 \\
\hline
\mathbf{\text{Exact Sum of Stored vs MODEL\_A Variance:}} &\quad \mathbf{-\$8,162.92} \quad (\text{Residual: } \mathbf{\$0.00})
\end{aligned}$$

---

## 5. Audit of Pre-Opening Seeds (Future Start Dates)

| Username | Account Name | Official Start Date | Stored Month 7 Row | Rendered in Portal? | MODEL_A Treatment | MODEL_B Treatment | Accounting Classification |
|:---|:---|:---:|:---:|:---:|:---:|:---:|:---|
| `jevans` | Jeremy Evans | `2026-08-01` | $947,592.99 | No (Pre-start) | Included ($947.59k) | $0.00 | `INTENTIONAL_PREOPENING_SEED` |
| `nkohlert` | Nancy Kohlert | `2026-08-01` | $650,000.00 | No (Pre-start) | Included ($650.00k) | $0.00 | `INTENTIONAL_PREOPENING_SEED` |
| `glarson` | Gary Larson | `2026-09-01` | $75,000.00 | No (Pre-start) | Included ($75.00k) | $0.00 | `INTENTIONAL_PREOPENING_SEED` |
| `klandon` | Kyle Landon | `2026-08-01` | $75,000.00 | No (Pre-start) | Included ($75.00k) | $0.00 | `INTENTIONAL_PREOPENING_SEED` |

---

## 6. Commission Capitalization & Transaction Date Semantics

* **June Commissions Capitalized in July:** Exact amount earned in Month 6 is **$141,536.98**.
  * `MODEL_A` includes $\$141,536.98$ via global roll-forward.
  * `MODEL_B` includes $\$141,536.98$ via per-investor `incomingCommissionCredit`.
  * Both models treat commission capitalization timing identically.
* **Transaction Date Semantics:**
  * External deposits: Filtered by `date` (format `YYYY-MM`), excluding `type = 'VOID'`.
  * External withdrawals: Filtered by `request_date` or `date`, excluding `status in ('cancelled', 'rejected')`.

---

## 7. Austin Ray & Ted Boardwalk Formal Findings

* **Austin Ray:**
  * `PRODUCTION_INTERNAL_CONTINUITY`: $7,029.40 starting capital $\rightarrow$ May ending $7,145.74 $\rightarrow$ June ending $7,276.86 $\rightarrow$ July ending $20,594.19 (internally verified).
  * `JOSH_HISTORICAL_CHECKPOINT`: $4,083.28 seed $\rightarrow$ $4,158.21 June ending (mathematically verified on hypothetical $4k baseline, but inconsistent with imported $7,029.40 seed).
  * **Status:** **`RECONCILIATION_REQUIRED`**.
* **Ted Boardwalk:**
  * **Technical Policy:** **`TECHNICAL_ZERO_FLOOR_VERIFIED`** (Code clamps loss-month allocations to $\$0.00$ in engine; writer strictly filters `if (rec.amount > 0)` before inserting into `commission_earnings`).
  * **Business Policy:** **`CLIENT_POLICY_CONFIRMATION_REQUIRED`**.

---

## 8. Pagination Deployment Gate Recommendation

* **Technical Patch Status:** **`CERTIFIED`** (All pagination code paths, boundaries, and deduplication verified).
* **Deployment Gate:** **`BLOCK_PENDING_GLOBAL_CONTROL_RECONCILIATION`** (Deployment temporarily held until client confirms acceptance of model boundaries between pre-opening seed rows and active operational capital).
