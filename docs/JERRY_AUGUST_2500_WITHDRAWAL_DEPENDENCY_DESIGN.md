# Jerry's Rogue Jets — August $2,500 Withdrawal Dependency Design Document

**Target Production Database:** `julhldzkiqdeuuoqmvlo` (Supabase Production — Stone Forex)  
**Target Investor:** `jerrys001` (`jerrys`)  
**Target Account:** `jerrys001`  
**Classification:** **`TIER_3_HISTORY_DEPENDENCY_CORRECTION`**  
**Authorized Scope:** Single $2,500.00 withdrawal with `effective_accounting_date = '2026-08-01'`  
**RPC Function:** `create_withdrawal_atomic` (Package B Production Certified)  
**Status:** **`DESIGN_ONLY / AWAITING_EXPLICIT_EXECUTION_AUTHORIZATION`**  
**Production Financial Writes:** **`0`**

---

## 1. Executive Summary & Architectural Classification

* **Why Tier 3 (History Dependency):**  
  An August 2026 history record already exists in `investor_monthly_history` in an `OPEN_MATERIALIZED` state (`opening_balance = $546,135.92`, `withdrawals = 0`, `ending_balance = $546,135.92`). In `lib/dashboard.js`, when a monthly history row exists for an investor, the calculation engine reads the stored `historyRow.withdrawals` and `historyRow.ending_balance`.  
  Therefore, inserting a source withdrawal record via Package B's `create_withdrawal_atomic` creates the authoritative audit record, while full investor-visible alignment requires either:
  1. Updating the August history row (`withdrawals = 2500.00`, `eligible_capital = 543635.92`), OR
  2. Automatic regeneration when the Central Accounting Engine finalizes August at month-close.
* **Package B Concurrency Safety:**  
  The transaction is guarded by `financial_lock_key('jerrys001')` and row-level locking on `investor_accounts`.
* **Historical Checkpoint Isolation:**  
  Josh's manual checkpoint ($534,486.05 vs reconstructed $534,426.63) has an unexplained variance of **+$59.42**. This remains strictly **`CHECKPOINT_RECONCILIATION_BLOCKED / NO_FABRICATED_ADJUSTMENT`** and is completely decoupled from the August $2,500 withdrawal.

---

## 2. Fresh Production CAS Baseline Assertions

Immediately prior to any future write, the following baseline must hold:

```sql
-- 1. Identity & Profile CAS
investors.id = 'jerrys001'
investors.portal_username = 'jerrys'
investors.start_date = DATE '2026-05-01'
investors.split_pct = 70.00

-- 2. Account Metadata CAS (Post-Metadata Correction)
investor_accounts.id = 'jerrys001'
investor_accounts.investor_id = 'jerrys001'
investor_accounts.open_date = DATE '2026-05-01'
investor_accounts.starting_capital = 514124.14
investor_accounts.status = 'Active'

-- 3. Package B Available Equity CAS
calculate_available_withdrawal_equity_sql('jerrys001', 'jerrys001', '2026-08-01', NULL) >= 2500.00
-- Expected Available Equity: $546,135.92

-- 4. Duplicate Check CAS
-- Zero active/reserving August 2026 withdrawals for jerrys001:
COUNT(*) WHERE investor_id = 'jerrys001' 
  AND year = 2026 AND month_number = 8 
  AND LOWER(TRIM(status)) IN ('pending', 'approved', 'completed') = 0
```

---

## 3. Package B Atomic Creation Payload

```json
{
  "rpc": "create_withdrawal_atomic",
  "parameters": {
    "p_investor_id": "jerrys001",
    "p_account_id": "jerrys001",
    "p_amount": 2500.00,
    "p_effective_date": "2026-08-01",
    "p_status": "Approved",
    "p_notes": "Client authorized recurring August withdrawal per Josh workbook instruction (Cell T273)",
    "p_idempotency_key": "idemp_jerrys_20260801_<FRESH_UUID>",
    "p_created_by": "system_admin_correction"
  }
}
```

* **Initial Status Choice (`Approved`):**  
  `Approved` represents a client-authorized recurring monthly withdrawal ready for ledger accounting.
* **Certified Reversal Path:**  
  If reversal is ever required, `update_withdrawal_atomic(withdrawal_id, NULL, 'Cancelled', 'Reversed per audit review', 'admin')` transitions the record from `Approved` $\to$ `Cancelled` atomically, restoring the $2,500 available equity without physical deletion.

---

## 4. August 2026 Period Financial Control Matrix

| Metric | Pre-Withdrawal State | Proposed Withdrawal Delta | Post-Withdrawal State |
| :--- | :--- | :--- | :--- |
| **July Ending Balance (Opening Basis)** | `$546,135.92` | `$0.00` | `$546,135.92` |
| **August Eligible Deposits** | `$0.00` | `$0.00` | `$0.00` |
| **July Capitalized Incoming Commissions** | `$0.00` | `$0.00` | `$0.00` |
| **August Active Withdrawals** | `$0.00` | `+$2,500.00` | **`$2,500.00`** |
| **August Eligible Trading Capital** | `$546,135.92` | `-$2,500.00` | **`$543,635.92`** |
| **Package B Available Equity Remaining** | `$546,135.92` | `-$2,500.00` | **`$543,635.92`** |
| **Accounting Residual** | — | — | **`$0.00`** |

---

## 5. Read-Only Production Verification Query (Post-Execution)

```sql
-- 1. Verify New Source Withdrawal Record
SELECT 
  id,
  investor_id,
  account_id,
  amount,
  status,
  request_date,
  effective_accounting_date,
  year,
  month_number,
  idempotency_key,
  notes,
  created_at
FROM withdrawals
WHERE investor_id = 'jerrys001'
  AND year = 2026 AND month_number = 8;

-- 2. Evaluate Post-Withdrawal Package B Available Equity
-- Expected Output: $543,635.92 ($546,135.92 - $2,500.00)
SELECT 
  'jerrys001' AS investor_id,
  '2026-08-01'::DATE AS evaluation_date,
  calculate_available_withdrawal_equity_sql(
    'jerrys001',
    'jerrys001',
    '2026-08-01'::DATE,
    NULL
  ) AS post_withdrawal_available_equity;
```
