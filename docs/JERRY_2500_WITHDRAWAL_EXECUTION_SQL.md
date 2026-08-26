# Jerry's Rogue Jets — August 1 $2,500 Withdrawal Execution & Preflight Package

**Target Production Database:** `julhldzkiqdeuuoqmvlo` (Supabase Production)  
**Target Investor:** `jerrys001` (`jerrys`)  
**Authorized Scope:** Single $2,500.00 withdrawal with `effective_accounting_date = '2026-08-01'`  
**RPC Function:** `create_withdrawal_atomic` (Package B Production Certified)  
**Execution Guardrail:** READ-ONLY PREFLIGHT REQUIRED BEFORE FINANCIAL WRITE  

---

## Section A: Production Read-Only Preflight SQL

Run this script in the Supabase **SQL Editor** (`julhldzkiqdeuuoqmvlo`) to inspect Jerry's exact live database state:

```sql
-- ============================================================================
-- PREFLIGHT AUDIT: JERRY'S ROGUE JETS LIVE PRODUCTION STATE
-- ============================================================================

-- 1. Investor & Account Profile
SELECT 
  i.id AS investor_id,
  i.portal_username,
  i.start_date AS investor_start_date,
  i.split_pct AS investor_split_pct,
  i.status AS investor_status,
  a.id AS account_id,
  a.open_date AS account_open_date,
  a.starting_capital,
  a.status AS account_status
FROM investors i
LEFT JOIN investor_accounts a ON a.investor_id = i.id OR a.id = i.portal_username
WHERE i.id = 'jerrys001' OR i.portal_username = 'jerrys';

-- 2. Complete Withdrawal Census for Jerry
SELECT 
  id,
  investor_id,
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
WHERE investor_id = 'jerrys001' OR investor_id = 'jerrys'
ORDER BY effective_accounting_date ASC, created_at ASC;

-- 3. Monthly History Census for Jerry (2026)
SELECT 
  year,
  month_number,
  opening_balance,
  deposits,
  withdrawals,
  gain,
  commissions,
  ending_balance
FROM investor_monthly_history
WHERE investor_id = 'jerrys001' OR investor_id = 'jerrys'
ORDER BY year ASC, month_number ASC;

-- 4. Package B Read-Only Available Equity Evaluation
SELECT 
  '2026-08-01'::DATE AS evaluation_effective_date,
  calculate_available_withdrawal_equity_sql(
    'jerrys001',
    'jerrys001',
    '2026-08-01'::DATE,
    NULL
  ) AS package_b_available_equity;
```

---

## Section B: Guarded Package B Atomic Execution Script

> **DO NOT EXECUTE UNTIL PREFLIGHT IS REVIEWED AND EXPLICITLY AUTHORIZED.**

```sql
-- ============================================================================
-- ATOMIC TRANSACTION: JERRY'S ROGUE JETS $2,500 AUGUST WITHDRAWAL
-- RPC: create_withdrawal_atomic (Package B)
-- ============================================================================

DO $$
DECLARE
  v_inv_id          TEXT := 'jerrys001';
  v_acc_id          TEXT := 'jerrys001';
  v_amount          NUMERIC(20, 2) := 2500.00;
  v_eff_date        DATE := '2026-08-01';
  v_idempotency     TEXT := 'idemp_jerrys_20260801_' || gen_random_uuid()::TEXT;
  v_result          JSONB;
  v_dup_count       INTEGER;
  v_equity          NUMERIC(20, 2);
BEGIN
  -- 1. DUPLICATE CHECK: Verify no active August 2026 $2,500 withdrawal exists
  SELECT COUNT(*) INTO v_dup_count
  FROM withdrawals
  WHERE (investor_id = v_inv_id OR investor_id = 'jerrys')
    AND effective_accounting_date = v_eff_date
    AND amount = v_amount
    AND status IN ('Pending', 'Approved', 'Completed');

  IF v_dup_count > 0 THEN
    RAISE EXCEPTION 'CAS_ABORT: Equivalent August $2,500 withdrawal already exists.';
  END IF;

  -- 2. EQUITY PRE-CHECK
  v_equity := calculate_available_withdrawal_equity_sql(v_inv_id, v_acc_id, v_eff_date, NULL);
  IF v_equity < v_amount THEN
    RAISE EXCEPTION 'CAS_ABORT: Insufficient available equity ($% < $%)', v_equity, v_amount;
  END IF;

  -- 3. INVOKE PACKAGE B AUTHORITATIVE RPC
  v_result := create_withdrawal_atomic(
    p_investor_id        => v_inv_id,
    p_account_id         => v_acc_id,
    p_amount             => v_amount,
    p_effective_date     => v_eff_date,
    p_status             => 'Approved',
    p_notes              => 'Authorized historical August 1 distribution per client review (Cell T273)',
    p_idempotency_key    => v_idempotency,
    p_created_by         => 'admin_reconciliation'
  );

  RAISE NOTICE 'SUCCESS: Withdrawal created via Package B RPC: %', v_result;
END $$;
```

---

## Section C: Post-Write Verification Queries

```sql
-- Verify inserted withdrawal record and updated Package B available equity
SELECT 
  id,
  investor_id,
  account_id,
  amount,
  status,
  effective_accounting_date,
  idempotency_key,
  notes,
  created_at
FROM withdrawals
WHERE (investor_id = 'jerrys001' OR investor_id = 'jerrys')
  AND effective_accounting_date = '2026-08-01'::DATE;

-- Verify post-withdrawal available equity
SELECT 
  calculate_available_withdrawal_equity_sql(
    'jerrys001',
    'jerrys001',
    '2026-08-01'::DATE,
    NULL
  ) AS remaining_available_equity;
```

---

## Section D: Guarded Reversal / Rollback Procedure

If rollback is required, perform an auditable status transition to `'Void'` using Package B:

```sql
-- Guarded status reversal (Never physically DELETE financial records)
DO $$
DECLARE
  v_wd_id UUID;
  v_result JSONB;
BEGIN
  SELECT id INTO v_wd_id
  FROM withdrawals
  WHERE (investor_id = 'jerrys001' OR investor_id = 'jerrys')
    AND effective_accounting_date = '2026-08-01'::DATE
    AND amount = 2500.00
    AND status = 'Approved'
  LIMIT 1;

  IF v_wd_id IS NULL THEN
    RAISE EXCEPTION 'REVERSAL_ABORT: Target withdrawal record not found or not in Approved status.';
  END IF;

  v_result := update_withdrawal_atomic(
    p_withdrawal_id           => v_wd_id,
    p_new_status              => 'Void',
    p_reason                  => 'Administrative rollback of unverified Jerry correction',
    p_updated_by              => 'admin_reconciliation',
    p_expected_current_status => 'Approved'
  );

  RAISE NOTICE 'SUCCESS: Withdrawal % reversed to Void: %', v_wd_id, v_result;
END $$;
```
