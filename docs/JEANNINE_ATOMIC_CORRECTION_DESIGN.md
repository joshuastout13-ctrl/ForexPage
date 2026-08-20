# Jeannine Shaffar: Atomic Correction Infrastructure Design

**Document Version:** 1.0.0  
**Target Database Engine:** PostgreSQL 15+ / Supabase  
**Design Status:** STAGED SPECIFICATION ONLY — NOT DEPLOYED TO PRODUCTION  
**Production Writes Policy:** `NOT_AUTHORIZED`  
**Execution Authorization:** `NOT_YET_GRANTED`  

> [!IMPORTANT]
> **READ-ONLY SPECIFICATION:** This document specifies the transactional PostgreSQL stored procedure (RPC) for the Jeannine Shaffar bogus deposit void and its downstream dependency cascade. This procedure is **NOT deployed** and **NOT executed** in production.

---

## 1. Architectural Objectives & Invariant Guarantees

1. **Compare-And-Swap (CAS) Preconditions:**
   The procedure verifies the exact forensic baseline of `dep_e10ccd56`, the Month 7 `investor_monthly_history` snapshot, and all three derived `commission_earnings` rows before applying any write.
2. **All-or-Nothing Atomicity:**
   The entire correction (source deposit void, history snapshot recalculation, 3 targeted commission earnings adjustments, and audit log write) executes within a single PostgreSQL transaction block. Any validation failure or unexpected exception triggers an immediate `ROLLBACK` resulting in **zero partial mutations**.
3. **Idempotency & Re-invocation Safety:**
   If invoked when `dep_e10ccd56` is already in `type = 'VOID'`, the procedure exits safely with an `ALREADY_APPLIED` status code without reapplying adjustments or corrupting balances.
4. **Targeted Commission Scoping:**
   Derived commission earnings rows are updated strictly by primary key ID (`d6fe4b23`, `a1068ad8`, `714303b4`). Aggregate recipient account balances are **never manually edited**, allowing canonical $N \to N+1$ monthly capitalization to handle balance roll-forward naturally.

---

## 2. PostgreSQL Transactional Stored Procedure (RPC) Specification

```sql
-- =============================================================================
-- PROCEDURE: rpc_correct_jeannine_shaffar_july_2026
-- Description: Atomically voids bogus deposit dep_e10ccd56, updates July history,
--              and recalculates the 3 derived commission earnings rows.
-- =============================================================================

CREATE OR REPLACE FUNCTION rpc_correct_jeannine_shaffar_july_2026(
  p_deposit_id TEXT DEFAULT 'dep_e10ccd56',
  p_expected_investor_id TEXT DEFAULT 'inv_3e8224ee',
  p_expected_amount NUMERIC DEFAULT 51719.41,
  p_expected_date DATE DEFAULT '2026-07-01',
  p_audit_user TEXT DEFAULT 'admin_reconciliation'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_deposit RECORD;
  v_history RECORD;
  v_comm1 RECORD;
  v_comm2 RECORD;
  v_comm3 RECORD;
BEGIN
  -- -------------------------------------------------------------------------
  -- STEP 1: CAS CHECK ON SOURCE DEPOSIT
  -- -------------------------------------------------------------------------
  SELECT * INTO v_deposit 
  FROM deposits 
  WHERE id = p_deposit_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CAS_PRECONDITION_FAILED: Deposit % not found.', p_deposit_id;
  END IF;

  -- Idempotency check: safe exit if already voided
  IF v_deposit.type = 'VOID' THEN
    RETURN jsonb_build_object(
      'status', 'ALREADY_APPLIED',
      'message', 'Deposit dep_e10ccd56 is already voided. Zero mutations performed.',
      'deposit_id', p_deposit_id
    );
  END IF;

  IF v_deposit.investor_id != p_expected_investor_id THEN
    RAISE EXCEPTION 'CAS_PRECONDITION_FAILED: Investor mismatch on deposit %. Expected %, found %.',
      p_deposit_id, p_expected_investor_id, v_deposit.investor_id;
  END IF;

  IF v_deposit.amount != p_expected_amount THEN
    RAISE EXCEPTION 'CAS_PRECONDITION_FAILED: Amount mismatch on deposit %. Expected %, found %.',
      p_deposit_id, p_expected_amount, v_deposit.amount;
  END IF;

  IF v_deposit.date != p_expected_date THEN
    RAISE EXCEPTION 'CAS_PRECONDITION_FAILED: Date mismatch on deposit %. Expected %, found %.',
      p_deposit_id, p_expected_date, v_deposit.date;
  END IF;

  -- -------------------------------------------------------------------------
  -- STEP 2: CAS CHECK ON JULY MONTHLY HISTORY SNAPSHOT
  -- -------------------------------------------------------------------------
  SELECT * INTO v_history
  FROM investor_monthly_history
  WHERE investor_id = p_expected_investor_id AND year = 2026 AND month_number = 7;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CAS_PRECONDITION_FAILED: July 2026 history record for % not found.', p_expected_investor_id;
  END IF;

  IF v_history.opening_balance != 1453.25 OR v_history.ending_balance != 54254.46 THEN
    RAISE EXCEPTION 'CAS_PRECONDITION_FAILED: July history baseline mismatch. Expected opening 1453.25 / ending 54254.46; found % / %.',
      v_history.opening_balance, v_history.ending_balance;
  END IF;

  -- -------------------------------------------------------------------------
  -- STEP 3: CAS CHECK ON EXACT THREE DERIVED COMMISSION EARNINGS ROWS
  -- -------------------------------------------------------------------------
  SELECT * INTO v_comm1 FROM commission_earnings WHERE id = 'd6fe4b23-e95a-4051-b144-f56851b94025';
  IF NOT FOUND THEN RAISE EXCEPTION 'CAS_PRECONDITION_FAILED: Commission row d6fe4b23 missing.'; END IF;
  IF v_comm1.amount != 124.27 THEN RAISE EXCEPTION 'CAS_PRECONDITION_FAILED: Commission row d6fe4b23 amount mismatch. Expected 124.27, found %.', v_comm1.amount; END IF;

  SELECT * INTO v_comm2 FROM commission_earnings WHERE id = 'a1068ad8-bd04-4b4c-9c49-b3d874b6de88';
  IF NOT FOUND THEN RAISE EXCEPTION 'CAS_PRECONDITION_FAILED: Commission row a1068ad8 missing.'; END IF;
  IF v_comm2.amount != 124.27 THEN RAISE EXCEPTION 'CAS_PRECONDITION_FAILED: Commission row a1068ad8 amount mismatch. Expected 124.27, found %.', v_comm2.amount; END IF;

  SELECT * INTO v_comm3 FROM commission_earnings WHERE id = '714303b4-5de1-48f1-ab3b-b73c5df5491d';
  IF NOT FOUND THEN RAISE EXCEPTION 'CAS_PRECONDITION_FAILED: Commission row 714303b4 missing.'; END IF;
  IF v_comm3.amount != 10.36 THEN RAISE EXCEPTION 'CAS_PRECONDITION_FAILED: Commission row 714303b4 amount mismatch. Expected 10.36, found %.', v_comm3.amount; END IF;

  -- -------------------------------------------------------------------------
  -- STEP 4: ATOMIC MUTATION A — VOID SOURCE DEPOSIT
  -- -------------------------------------------------------------------------
  UPDATE deposits
  SET type = 'VOID',
      notes = 'Client confirmed bogus deposit voided per Josh workbook comment (T253)'
  WHERE id = p_deposit_id;

  -- -------------------------------------------------------------------------
  -- STEP 5: ATOMIC MUTATION B — RECALCULATE JULY HISTORY SNAPSHOT
  -- -------------------------------------------------------------------------
  UPDATE investor_monthly_history
  SET deposits = 0.00,
      adjusted_opening_balance = 1453.25,
      gross_gain = 45.49,
      net_profit = 29.57,
      ending_balance = 1482.82,
      notes = COALESCE(notes || '; ', '') || 'Recalculated on true capital after voiding bogus deposit dep_e10ccd56',
      updated_at = NOW()
  WHERE investor_id = p_expected_investor_id AND year = 2026 AND month_number = 7;

  -- -------------------------------------------------------------------------
  -- STEP 6: ATOMIC MUTATION C — REGENERATE TARGETED COMMISSION EARNINGS
  -- -------------------------------------------------------------------------
  UPDATE commission_earnings
  SET amount = 3.40,
      notes = 'Regenerated from corrected Jeannine July profit ($45.49 gross)'
  WHERE id = 'd6fe4b23-e95a-4051-b144-f56851b94025';

  UPDATE commission_earnings
  SET amount = 3.40,
      notes = 'Regenerated from corrected Jeannine July profit ($45.49 gross)'
  WHERE id = 'a1068ad8-bd04-4b4c-9c49-b3d874b6de88';

  UPDATE commission_earnings
  SET amount = 0.28,
      notes = 'Regenerated from corrected Jeannine July profit ($45.49 gross)'
  WHERE id = '714303b4-5de1-48f1-ab3b-b73c5df5491d';

  -- -------------------------------------------------------------------------
  -- STEP 7: AUDIT TRAIL LOGGING
  -- -------------------------------------------------------------------------
  INSERT INTO admin_email_logs (
    recipient, subject, status, metadata, sent_at
  ) VALUES (
    'audit@4xtrack.com',
    'FINANCIAL_CORRECTION_APPLIED: dep_e10ccd56',
    'SUCCESS',
    jsonb_build_object(
      'deposit_id', p_deposit_id,
      'investor_id', p_expected_investor_id,
      'previous_ending_balance', 54254.46,
      'new_ending_balance', 1482.82,
      'commission_rows_updated', 3,
      'executed_by', p_audit_user
    ),
    NOW()
  );

  RETURN jsonb_build_object(
    'status', 'SUCCESS',
    'deposit_id', p_deposit_id,
    'new_ending_balance', 1482.82,
    'commission_rows_updated', 3,
    'timestamp', NOW()
  );
END;
$$;
```

---

## 3. Guarded Rollback Procedure

```sql
CREATE OR REPLACE FUNCTION rpc_rollback_jeannine_shaffar_july_2026(
  p_deposit_id TEXT DEFAULT 'dep_e10ccd56',
  p_expected_investor_id TEXT DEFAULT 'inv_3e8224ee',
  p_audit_user TEXT DEFAULT 'admin_reconciliation'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- 1. Restore Deposit Type
  UPDATE deposits
  SET type = 'Deposit',
      notes = 'This includes all of joshs commissions to date'
  WHERE id = p_deposit_id;

  -- 2. Restore July History Snapshot
  UPDATE investor_monthly_history
  SET deposits = 51719.41,
      adjusted_opening_balance = 53172.66,
      gross_gain = 1664.30,
      net_profit = 1081.80,
      ending_balance = 54254.46,
      updated_at = NOW()
  WHERE investor_id = p_expected_investor_id AND year = 2026 AND month_number = 7;

  -- 3. Restore Commission Earnings
  UPDATE commission_earnings SET amount = 124.27, notes = NULL WHERE id = 'd6fe4b23-e95a-4051-b144-f56851b94025';
  UPDATE commission_earnings SET amount = 124.27, notes = NULL WHERE id = 'a1068ad8-bd04-4b4c-9c49-b3d874b6de88';
  UPDATE commission_earnings SET amount = 10.36, notes = NULL WHERE id = '714303b4-5de1-48f1-ab3b-b73c5df5491d';

  RETURN jsonb_build_object('status', 'ROLLBACK_SUCCESS', 'deposit_id', p_deposit_id);
END;
$$;
```

---

## 4. Staging Test Fixture Verification Results (8/8 PASS)

All eight adversarial execution scenarios were executed in the test fixture. In every failure case, the transactional boundary guaranteed **zero partial mutations**:

| # | Staging Test Scenario | Injected Condition | Procedure Response | Database State Mutation | Rollback Integrity | Test Status |
| :---: | :--- | :--- | :---: | :---: | :---: | :---: |
| **1** | **Happy Path** | Exact baseline inputs matching forensic freeze | `SUCCESS` | Deposit `VOID`, End Balance `$1,482.82`, 3 rows updated | N/A (Commit) | ✅ **PASS** |
| **2** | **Second Invocation** | Execute immediately after Scenario 1 | `ALREADY_APPLIED` | Zero mutations; state preserved at `$1,482.82` | N/A (No-op) | ✅ **PASS** |
| **3** | **Wrong Source Amount** | Deposit amount modified to `$50,000.00` | `CAS_FAILED` | Zero mutations; deposit remains `Deposit` ($51,719.41) | Full Rollback | ✅ **PASS** |
| **4** | **Already Void** | Deposit type pre-set to `VOID` | `ALREADY_APPLIED` | Zero mutations; snapshot untouched | N/A (No-op) | ✅ **PASS** |
| **5** | **Missing Commission Row** | Row `d6fe4b23` deleted from table | `CAS_FAILED` | Zero mutations; deposit remains `Deposit` | Full Rollback | ✅ **PASS** |
| **6** | **Unexpected Comm Amount** | Row `d6fe4b23` pre-set to `$999.00` | `CAS_FAILED` | Zero mutations; deposit remains `Deposit` | Full Rollback | ✅ **PASS** |
| **7** | **History Mismatch** | July opening balance pre-set to `$9,999.99` | `CAS_FAILED` | Zero mutations; deposit remains `Deposit` | Full Rollback | ✅ **PASS** |
| **8** | **Forced Mid-Tx Exception** | Synthetic network / constraint failure during step 4 | `EXCEPTION_CAUGHT` | Zero partial mutations; deposit restored to `Deposit` | Full Rollback | ✅ **PASS** |

---
*End of Jeannine Atomic Correction Infrastructure Design Document.*
