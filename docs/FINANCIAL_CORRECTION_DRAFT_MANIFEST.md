# Controlled Financial Correction Draft Manifest

**Document Version:** 1.0.0  
**Production Baseline:** `ec19f5f`  
**Manifest Status:** STAGED DRAFT — ZERO MUTATIONS EXECUTED  
**Financial Writes Policy:** `NOT_AUTHORIZED`  
**Execution Gate:** `BLOCKED_PENDING_CLIENT_APPROVAL`  
**Accounting Finalization Policy:** `HOLD`  

> [!CAUTION]
> **READ-ONLY DRAFT ONLY:** DO NOT EXECUTE THIS MANIFEST. No database writes, transaction voids, balance alterations, or commission regenerations may be performed without explicit, written client approval.

---

## 1. Actionable Mutations Overview (READY_FOR_APPROVAL Only)

Only exceptions meeting the strict standard of **proven primary source evidence**, **exact reproducible dependency graphs**, and **$0.00 unexplained simulation variance** are staged as actionable mutations in this draft manifest.

```mermaid
graph TD
    subgraph Staged_Mutations["Actionable Staged Mutations (READY_FOR_APPROVAL)"]
        M1["Mutation 1: Void Jeannine Shaffar Bogus Deposit (dep_e10ccd56)"]
        M2["Mutation 2: Insert Jerrys Rogue Jets Aug 1 Withdrawal (wd_jerrys_20260801)"]
        M3["Mutation 3: Realign Gary Larson Start Date & Capital (inv_2093cd23 / glarson)"]
        M4["Mutation 4: Realign Kyle Landon Open Date (klandon)"]
    end

    subgraph Recalculation_Pipeline["Idempotent Recalculation Cascade"]
        M1 --> R1["Regenerate Jeannine Month 7 Snapshot ($1,482.82)"]
        M1 --> R2["Regenerate 3 Recipient Commission Earnings Rows ($3.40, $3.40, $0.28)"]
        M2 --> R3["Update Jerrys August Eligible Capital ($543,635.92)"]
        M3 --> R4["Incorporate Gary Larson into August Active Roster ($487,000.00)"]
        M4 --> R5["Suppress Kyle Landon Pre-Opening Ghost Views"]
    end
```

---

## 2. Detailed Staged Mutation Specifications

### Mutation 1: Void Jeannine Shaffar Bogus Deposit
* **Target Table:** `deposits`
* **Record ID:** `dep_e10ccd56`
* **Investor ID:** `inv_3e8224ee`
* **Account ID:** `jshaffar`
* **Existing Value:**
  ```json
  {
    "id": "dep_e10ccd56",
    "investor_id": "inv_3e8224ee",
    "account_id": "jshaffar",
    "date": "2026-07-01",
    "amount": 51719.41,
    "type": "Deposit",
    "notes": "This includes all of joshs commissions to date"
  }
  ```
* **Proposed Value:**
  ```json
  {
    "id": "dep_e10ccd56",
    "type": "VOID",
    "notes": "Client confirmed bogus deposit voided per Josh workbook comment (T253)"
  }
  ```
* **Effective Date:** `2026-07-01`
* **Evidence:** Client review Cell `T253` — `"Bogus Deposit. Will not let me void"`; database record `dep_e10ccd56`.
* **Downstream Recalculation Scope:**
  1. `investor_monthly_history` for `inv_3e8224ee` (Year: 2026, Month: 7):
     - `opening_balance`: `$1,453.25`
     - `deposits`: `$0.00`
     - `withdrawals`: `$0.00`
     - `adjusted_opening_balance`: `$1,453.25`
     - `gross_gain`: `$45.49`
     - `net_profit`: `$29.57`
     - `ending_balance`: `$1,482.82`
  2. `commission_earnings` (Year: 2026, Month: 7, Source: `inv_3e8224ee`):
     - Row `d6fe4b23-e95a-4051-b144-f56851b94025` (Recipient `inv_015f3774` @ 24%): `$124.27` $\to$ **`$3.40`**
     - Row `a1068ad8-bd04-4b4c-9c49-b3d874b6de88` (Recipient `inv_920b8af8` @ 24%): `$124.27` $\to$ **`$3.40`**
     - Row `714303b4-5de1-48f1-ab3b-b73c5df5491d` (Recipient `stout001` @ 2%): `$10.36` $\to$ **`$0.28`**
* **Expected Resulting Balance:**
  - July 31 Ending Balance: **$1,482.82** (down from $54,254.46)
  - August 1 Capitalization: **$1,482.82**
* **Idempotency Protection:**
  ```sql
  UPDATE deposits 
  SET type = 'VOID', notes = 'Client confirmed bogus deposit voided per Josh workbook comment' 
  WHERE id = 'dep_e10ccd56' AND type != 'VOID';
  ```
* **Rollback Procedure:**
  ```sql
  UPDATE deposits 
  SET type = 'Deposit', notes = 'This includes all of joshs commissions to date' 
  WHERE id = 'dep_e10ccd56';
  -- Then trigger deterministic historical recalculation for Month 7
  ```

---

### Mutation 2: Insert Jerrys Rogue Jets Authorized August 1 Withdrawal
* **Target Table:** `withdrawals`
* **Record ID:** `wd_jerrys_20260801` (deterministic UUID/ID)
* **Investor ID:** `jerrys001`
* **Account ID:** `jerrys001`
* **Existing Value:** No record present for August 1, 2026.
* **Proposed Value:**
  ```json
  {
    "id": "wd_jerrys_20260801",
    "investor_id": "jerrys001",
    "account_id": "jerrys001",
    "request_date": "2026-08-01",
    "year": 2026,
    "month_number": 8,
    "month": "August",
    "amount": 2500.00,
    "status": "Approved",
    "effective_accounting_date": "2026-08-01",
    "notes": "Client authorized recurring August withdrawal per Josh workbook comment (T273)"
  }
  ```
* **Effective Date:** `2026-08-01`
* **Evidence:** Client review Cell `T273` — `"Need to add a 2500 withdrawal for August 1 2026 then ok"`; recurring May 1 and July 1 withdrawals of $2,500.
* **Downstream Recalculation Scope:**
  - August 2026 accounting snapshot for `jerrys001`.
* **Expected Resulting Balance:**
  - August 1 Opening Balance: **$546,135.92** (Unchanged July 31 close)
  - August 1 Eligible Active Capital: **$543,635.92** ($\$546,135.92 - \$2,500.00$)
* **Idempotency Protection:**
  ```sql
  INSERT INTO withdrawals (
    id, investor_id, account_id, request_date, year, month_number, month, amount, status, effective_accounting_date, notes
  ) VALUES (
    'wd_jerrys_20260801', 'jerrys001', 'jerrys001', '2026-08-01', 2026, 8, 'August', 2500.00, 'Approved', '2026-08-01', 'Client authorized recurring August withdrawal per Josh workbook comment'
  ) ON CONFLICT (id) DO NOTHING;
  ```
* **Rollback Procedure:**
  ```sql
  DELETE FROM withdrawals WHERE id = 'wd_jerrys_20260801';
  ```

---

### Mutation 3: Realign Gary Larson Start Date & Starting Capital
* **Target Tables:** `investors`, `investor_accounts`
* **Record IDs:** `inv_2093cd23` (in `investors`) / `glarson` (in `investor_accounts`)
* **Investor ID:** `inv_2093cd23`
* **Account ID:** `glarson`
* **Existing Values:**
  - `investors.start_date`: `'2026-09-01'`
  - `investor_accounts.starting_capital`: `75000.00`, `open_date`: `'2026-09-01'`
* **Proposed Values:**
  - `investors.start_date`: `'2026-08-01'`
  - `investor_accounts.starting_capital`: `487000.00`, `open_date`: `'2026-08-01'`
* **Effective Date:** `2026-08-01`
* **Evidence:** Client review Cells `T170 & T176` — `"This is wrong. he started with 487,000 on August 1 2026. all these other dates are incorrect"`.
* **Downstream Recalculation Scope:**
  - August 2026 active investor roster and monthly return calculations.
  - *Note:* September 1 deposit `dep_94a0ffe1` ($120,000) is quarantined from August calculations and held for separate client verification during September close.
* **Expected Resulting Balance:**
  - Pre-August Active Capital: **$0.00**
  - August 1 Starting Capital: **$487,000.00**
* **Idempotency Protection:**
  ```sql
  UPDATE investors 
  SET start_date = '2026-08-01' 
  WHERE id = 'inv_2093cd23' AND start_date != '2026-08-01';

  UPDATE investor_accounts 
  SET starting_capital = 487000.00, open_date = '2026-08-01' 
  WHERE id = 'glarson' AND (starting_capital != 487000.00 OR open_date != '2026-08-01');
  ```
* **Rollback Procedure:**
  ```sql
  UPDATE investors SET start_date = '2026-09-01' WHERE id = 'inv_2093cd23';
  UPDATE investor_accounts SET starting_capital = 75000.00, open_date = '2026-09-01' WHERE id = 'glarson';
  ```

---

### Mutation 4: Realign Kyle Landon Account Open Date
* **Target Table:** `investor_accounts`
* **Record ID:** `klandon`
* **Investor ID:** `inv_835ffffd`
* **Account ID:** `klandon`
* **Existing Values:** `open_date: '2026-01-01'` (or Month 7 legacy infrastructure seed row of $75k).
* **Proposed Values:** `open_date: '2026-08-01'`, `starting_capital: 75000.00`.
* **Effective Date:** `2026-08-01`
* **Evidence:** Client review Cells `T345` ("didnt exist") & `T350` ($75,000); `investors.start_date = '2026-08-01'`.
* **Downstream Recalculation Scope:**
  - August 2026 opening roster; pre-start comparison view suppression.
* **Expected Resulting Balance:**
  - Pre-August Active Balance: **$0.00** (Properly suppressed)
  - August 1 Starting Capital: **$75,000.00**
* **Idempotency Protection:**
  ```sql
  UPDATE investor_accounts 
  SET open_date = '2026-08-01', starting_capital = 75000.00 
  WHERE id = 'klandon' AND (open_date != '2026-08-01' OR starting_capital != 75000.00);
  ```
* **Rollback Procedure:**
  ```sql
  UPDATE investor_accounts SET open_date = '2026-01-01', starting_capital = 75000.00 WHERE id = 'klandon';
  ```

---

## 3. Global Correction Simulation (Certified In-Memory Model)

The following simulation executes all proven proposed corrections in memory against the certified production baseline dataset to verify complete mathematical integrity and confirm zero unexplained financial variance.

### 3.1 Simulation Equations & Mechanics
1. **Gross Deposit Correction:** Voiding `dep_e10ccd56` on Jeannine Shaffar removes **$51,719.41** from July external deposits.
2. **Gross Withdrawal Correction:** Jerrys Rogue Jets $2,500 withdrawal is effective August 1, 2026 (Month 8). Month 7 withdrawal delta is **$0.00**.
3. **Investor Net Profit Correction:** Jeannine Shaffar's July net profit reduces from $1,081.80 (on $53,172.66 capital) to $29.57 (on $1,453.25 capital), yielding a net profit delta of **-$1,052.23**.
4. **Commission Earnings Correction:** July commission allocations on Jeannine Shaffar reduce from $258.90 to $7.08, yielding a commission earnings delta of **-$251.82** across the 3 recipient rows.
5. **Ending Capital Correction:** Jeannine Shaffar July 31 ending capital reduces from $54,254.46 to $1,482.82, yielding an ending capital delta of **-$52,771.64**.

### 3.2 Global Control Totals Reconciliation (Month 7 Close)

| Global Accounting Category | Production Certified Baseline | Proposed Corrections Delta | Corrected Global Total | Reconciliation Equation Check |
| :--- | :---: | :---: | :---: | :---: |
| **Opening Capital Total** | $20,077,705.53 | $0.00 | $20,077,705.53 | Verified Stored |
| **Net External Deposits** | $1,283,429.94 | -$51,719.41 | $1,231,710.53 | $\Delta = -\$51,719.41$ |
| **Net External Withdrawals** | $342,039.33 | $0.00 | $342,039.33 | $\Delta = \$0.00$ |
| **Investor Net Profits** | $492,567.44 | -$1,052.23 | $491,515.21 | $\Delta = -\$1,052.23$ |
| **Commission Earnings** | $620,113.09 | -$251.82 | $619,861.27 | $\Delta = -\$251.82$ |
| **Ending Capital Total** | **$22,851,987.46** | **-$52,771.64** | **$22,799,215.82** | **Exact Identity** |

### 3.3 Verification of Unexplained Variance

$$\begin{aligned}
\text{Net Ending Capital Correction:} &\quad -\$52,771.64 \\
\text{- Net Deposit Correction:} &\quad -(-\$51,719.41) \\
\text{+ Net Withdrawal Correction:} &\quad +(\$0.00) \\
\text{- Net Investor-Profit Correction:} &\quad -(-\$1,052.23) \\
\hline
\mathbf{\text{Unexplained Financial Variance:}} &\quad \mathbf{\$0.00}
\end{aligned}$$

$$\mathbf{-\$52,771.64 - (-\$51,719.41 - \$0.00 - \$1,052.23) = \$0.00}$$

* **Conclusion:** The proposed correction set produces **$0.00 unexplained financial variance** and is certified mathematically sound.

---

## 4. Execution Guardrails & Authorization Policy

```text
================================================================================
CONTROLLED EXECUTION GATE: STAGED DRAFT ONLY — ZERO WRITES PERFORMED
================================================================================
1. All 4 staged mutations have proven source evidence and exact reversible SQL.
2. Contradictory items (Mary Jo $20k vs $22k, Jerrys $59.42, Michael Beck $4.2k,
   Jeff Bennion $194k, Ted Boardwalk $17.19) are strictly excluded from mutation.
3. Financial correction execution status: NOT_AUTHORIZED.
4. Accounting finalization status: HOLD.
================================================================================
```

---
*End of Financial Correction Draft Manifest.*
