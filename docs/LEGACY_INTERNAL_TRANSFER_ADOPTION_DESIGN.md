# Legacy Internal Transfer Adoption Architecture & Specification

## Executive Summary
This document specifies the design and implementation contract for the **Legacy Adoption Workflow** to adopt pre-existing, partially-recorded, or misclassified internal transfer legs into the canonical first-class `internal_transfers` architecture.

> [!IMPORTANT]
> **Adoption Moratorium**: In accordance with the mandate, `dep_bc8434ab` remains **$2,500 NEW_CASH / Internal Transfer** in production and is **UNTOUCHED**. No real investor financial mutations have occurred or will occur until Josh Stout explicitly authorizes the adoption and resolves the missing counterpart leg.

---

## 1. Production Forensics: `dep_bc8434ab` & Jerry Counterpart Investigation

### A. Deposit Row Inspection
Direct query of production table `deposits` in project `julhldzkiqdeuuoqmvlo`:
```json
{
  "id": "dep_bc8434ab",
  "investor_id": "stout001",
  "account_id": "stout001",
  "date": "2026-09-01",
  "amount": "2500.00",
  "type": "Internal Transfer",
  "notes": "From Jerrys to Stout",
  "created_at": "2026-09-18 02:53:29.602794+00",
  "effective_accounting_date": "2026-09-01",
  "status": "confirmed",
  "accounting_treatment": "NEW_CASH",
  "idempotency_key": "3f3c00d4-80b1-4699-945d-5acb9871b4be",
  "transfer_id": null,
  "transfer_leg": null
}
```

### B. Corresponding Jerry Debit/Withdrawal Investigation
Inspection of all withdrawals for Jerry's account (`jerrys001` / `Jerrys Rogue Jets`):
1. **May 2026**: `wd_5614f2b2` ($2,500.00, `Completed`)
2. **June 2026**: `wd_a9234ba4` ($2,500.00, `Approved`)
3. **July 2026**: `wd_e380829e` ($2,500.00, `Completed`)
4. **August 2026**: `wd_jerrys_20260801_d00164e8` ($2,500.00, `Approved`)
5. **September 2026**: **ZERO WITHDRAWAL ROWS EXIST.**

Across the entire production `withdrawals` table:
- There are **zero withdrawals** of $2,500 for September 2026 across all accounts.
- **Result**: **MISMATCH DETECTED**. No corresponding September Jerry debit exists.
- Per mandate: **We STOP, report the mismatch, and do NOT fabricate one.** Josh must authorize any missing economic debit leg before Jerry's account balance is impacted.

---

## 2. Adoption Workflow Architecture & Mechanics

When authorized, historical adoption must link or reclassify existing records **without duplicating economic effects**.

### Critical Distinctions
| Operation | RPC | Economic Effect | Use Case |
| :--- | :--- | :--- | :--- |
| **New Transfer** | `execute_internal_transfer_atomic` | Debits source (-$X), credits target (+$X), creates 3 new rows | Future transfers between active accounts |
| **Legacy Adoption** | `adopt_legacy_internal_transfer_atomic` | Net $0 change to existing balances, links pre-existing rows to new master record | Adopting historical rows like `dep_bc8434ab` |

### Invariant Rules for Historical Adoption
1. **Zero Balance Inflation**:
   - `dep_bc8434ab` currently contributes +$2,500 to Josh's balance under `NEW_CASH`.
   - Under `INTERNAL_TRANSFER`, it continues to contribute +$2,500 to Josh's balance.
   - Net change to Josh's accounting balance before vs. after adoption = **$0.00**.
2. **Total External Cash Reduction**:
   - `dep_bc8434ab` currently counts towards `Total External Cash Sent` ($2,500.00).
   - Upon reclassification to `INTERNAL_TRANSFER`, it stops counting towards external cash ($0.00).
   - Total External Cash for `stout001` decreases by exactly **-$2,500.00** (falling from $2,500.00 to $0.00).
3. **Provenance Status Transition**:
   - Because `stout001` has no other confirmed external cash rows, removing `dep_bc8434ab` from external cash leaves 0 qualifying external cash rows.
   - Provenance status automatically transitions from `PARTIAL` -> `UNKNOWN`.
   - It will **NEVER** transition to `COMPLETE` automatically.
4. **Row Identity & Audit Preservation**:
   - Deposit row ID `dep_bc8434ab` is preserved.
   - Original `created_at`, `date`, `amount`, and `idempotency_key` are preserved.
   - Audit trail is appended with adoption metadata, master transfer reference, and actor.

---

## 3. Candidate Adoption RPC Specification (Draft / Do Not Execute)

```sql
CREATE OR REPLACE FUNCTION public.adopt_legacy_internal_transfer_atomic(
  p_deposit_id TEXT,
  p_withdrawal_id TEXT,          -- Can be NULL if debit leg is created simultaneously upon authorization
  p_source_account_id TEXT,
  p_target_account_id TEXT,
  p_effective_date DATE,
  p_purpose TEXT,
  p_notes TEXT,
  p_adopted_by TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_dep RECORD;
  v_wd RECORD;
  v_transfer_id UUID;
  v_transfer_num TEXT;
  v_year INT;
  v_month_num INT;
  v_month_name TEXT;
  v_canonical_date DATE;
  v_source_inv_id TEXT;
  v_target_inv_id TEXT;
  v_remaining_cash INT;
BEGIN
  -- 1. Validate deposit row
  SELECT * INTO v_dep FROM deposits WHERE id = p_deposit_id FOR UPDATE;
  IF NOT FOUND OR v_dep.id IS NULL THEN
    RAISE EXCEPTION 'DEPOSIT_NOT_FOUND: Deposit % does not exist.', p_deposit_id;
  END IF;

  IF v_dep.transfer_id IS NOT NULL THEN
    RAISE EXCEPTION 'DEPOSIT_ALREADY_LINKED: Deposit % is already linked to transfer %.', p_deposit_id, v_dep.transfer_id;
  END IF;

  -- Canonicalize date
  v_canonical_date := DATE_TRUNC('month', COALESCE(p_effective_date, v_dep.effective_accounting_date, v_dep.date))::DATE;
  v_year := EXTRACT(YEAR FROM v_canonical_date)::INT;
  v_month_num := EXTRACT(MONTH FROM v_canonical_date)::INT;
  v_month_name := TO_CHAR(v_canonical_date, 'Month');

  -- Resolve investors
  SELECT investor_id INTO v_source_inv_id FROM investor_accounts WHERE id = p_source_account_id;
  SELECT investor_id INTO v_target_inv_id FROM investor_accounts WHERE id = p_target_account_id;

  -- 2. Create master transfer record
  v_transfer_num := 'XFER-' || v_year || '-ADOPT-' || LPAD(nextval('internal_transfer_seq')::TEXT, 5, '0');

  INSERT INTO internal_transfers (
    transfer_number, source_investor_id, source_account_id, target_investor_id, target_account_id,
    amount, effective_accounting_date, year, month_number, month, status, purpose, notes,
    idempotency_key, created_by
  ) VALUES (
    v_transfer_num, v_source_inv_id, p_source_account_id, v_target_inv_id, p_target_account_id,
    v_dep.amount, v_canonical_date, v_year, v_month_num, TRIM(v_month_name), 'confirmed',
    p_purpose, COALESCE(p_notes, 'Historical adoption of deposit ' || p_deposit_id),
    'adopt-' || p_deposit_id || '-' || COALESCE(p_withdrawal_id, 'new-debit'),
    p_adopted_by
  ) RETURNING id INTO v_transfer_id;

  -- 3. Link existing deposit row and reclassify to INTERNAL_TRANSFER
  UPDATE deposits
  SET transfer_id = v_transfer_id,
      transfer_leg = 'CREDIT',
      accounting_treatment = 'INTERNAL_TRANSFER',
      type = 'Internal Transfer',
      notes = COALESCE(notes, '') || ' [Adopted into transfer ' || v_transfer_num || ' by ' || p_adopted_by || ']',
      updated_at = NOW()
  WHERE id = p_deposit_id;

  -- 4. Link or create withdrawal leg
  IF p_withdrawal_id IS NOT NULL THEN
    SELECT * INTO v_wd FROM withdrawals WHERE id = p_withdrawal_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'WITHDRAWAL_NOT_FOUND: Withdrawal % does not exist.', p_withdrawal_id;
    END IF;
    UPDATE withdrawals
    SET transfer_id = v_transfer_id,
        transfer_leg = 'DEBIT',
        notes = COALESCE(notes, '') || ' [Adopted into transfer ' || v_transfer_num || ' by ' || p_adopted_by || ']',
        updated_at = NOW(),
        updated_by = p_adopted_by
    WHERE id = p_withdrawal_id;
  ELSE
    -- If Josh explicitly authorizes creating the missing debit leg upon adoption:
    INSERT INTO withdrawals (
      id, investor_id, account_id, amount, status, request_date, effective_accounting_date,
      year, month_number, month, notes, transfer_id, transfer_leg, created_by
    ) VALUES (
      gen_random_uuid()::text, v_source_inv_id, p_source_account_id, v_dep.amount, 'Completed',
      v_canonical_date, v_canonical_date, v_year, v_month_num, TRIM(v_month_name),
      'Authorized historical internal transfer debit to ' || p_target_account_id || ' [' || v_transfer_num || ']',
      v_transfer_id, 'DEBIT', p_adopted_by
    );
  END IF;

  -- 5. Auto-evaluate cash provenance on target account
  SELECT count(*) INTO v_remaining_cash
  FROM deposits
  WHERE account_id = p_target_account_id
    AND status = 'confirmed'
    AND accounting_treatment IN ('NEW_CASH', 'HISTORICAL_PROVENANCE');

  IF v_remaining_cash = 0 THEN
    UPDATE investor_accounts
    SET external_cash_provenance_status = 'UNKNOWN',
        updated_at = NOW()
    WHERE id = p_target_account_id
      AND external_cash_provenance_status = 'PARTIAL';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'transfer_id', v_transfer_id,
    'transfer_number', v_transfer_num,
    'target_account_id', p_target_account_id,
    'source_account_id', p_source_account_id,
    'amount', v_dep.amount,
    'adopted_deposit_id', p_deposit_id,
    'adopted_withdrawal_id', p_withdrawal_id
  );
END;
$$;
```
