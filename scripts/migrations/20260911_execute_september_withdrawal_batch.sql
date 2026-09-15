-- =============================================================================
-- Execution Script: September 1, 2026 Stakeholder-Authorized Withdrawal Batch
-- Target: Supabase PostgreSQL (Production Project: julhldzkiqdeuuoqmvlo)
-- Authorized By: Josh Stout (Managing Partner / Stone Forex)
-- Total Authorized Requests: 11 (Ted Boardwalk $1,100 EXCLUDED / BLOCKED_EQUITY)
-- Expected Total Cashflow: $167,258.30
-- Mechanism: Canonical public.create_withdrawal_atomic RPC under Investor Advisory Lock
-- =============================================================================

DO $$
DECLARE
  v_batch JSONB := '[
    {"idx": 1, "username": "mrichards", "investor_id": "inv_f797f3fe", "amount": 5000.00, "cents": 500000},
    {"idx": 2, "username": "jbennion", "investor_id": "inv_65b7fbd9", "amount": 21500.00, "cents": 2150000},
    {"idx": 3, "username": "mharris", "investor_id": "inv_4c5c0ee6", "amount": 21000.00, "cents": 2100000},
    {"idx": 4, "username": "dwaite", "investor_id": "inv_60ed0c32", "amount": 2000.00, "cents": 200000},
    {"idx": 5, "username": "tkruger", "investor_id": "inv_8cf28066", "amount": 1697.33, "cents": 169733},
    {"idx": 6, "username": "arichards", "investor_id": "inv_d3ec0cf8", "amount": 3000.00, "cents": 300000},
    {"idx": 7, "username": "dpatterson", "investor_id": "inv_d5761f42", "amount": 150.00, "cents": 15000},
    {"idx": 8, "username": "nwaite", "investor_id": "inv_d8b5ab06", "amount": 7000.00, "cents": 700000},
    {"idx": 9, "username": "jstout", "investor_id": "stout001", "amount": 20000.00, "cents": 2000000},
    {"idx": 10, "username": "bray", "investor_id": "inv_81b6661d", "amount": 76910.97, "cents": 7691097},
    {"idx": 11, "username": "jevans", "investor_id": "inv_6ba53bbe", "amount": 9000.00, "cents": 900000}
  ]'::JSONB;

  v_item RECORD;
  v_acc_id TEXT;
  v_idemp_key TEXT;
  v_res JSONB;
  v_existing_count INT;
  v_avail_equity NUMERIC(20, 2);
  v_created_id TEXT;
  v_verify RECORD;
  v_success_count INT := 0;
  v_total_sum NUMERIC(20, 2) := 0.00;
BEGIN
  -- 0. Absolute Protection Assertion: Ted Boardwalk must never be executed
  FOR v_item IN SELECT * FROM jsonb_to_recordset(v_batch) AS x(idx INT, username TEXT, investor_id TEXT, amount NUMERIC(20, 2), cents BIGINT)
  LOOP
    IF v_item.investor_id = 'inv_a79798ca' OR v_item.username = 'tboardwalk' THEN
      RAISE EXCEPTION 'FATAL: Ted Boardwalk ($1,100) must NOT be executed due to insufficient equity. Entire batch aborted.';
    END IF;

    -- 1. Just-In-Time Precheck
    -- A. Exact economic duplicate check for September 1, 2026
    SELECT COUNT(*) INTO v_existing_count
    FROM withdrawals
    WHERE investor_id = v_item.investor_id
      AND effective_accounting_date = DATE '2026-09-01'
      AND amount = v_item.amount
      AND status IN ('Pending', 'Approved', 'Completed');

    IF v_existing_count > 0 THEN
      RAISE NOTICE 'SKIPPING % (%): Exact September 1 withdrawal already exists.', v_item.username, v_item.investor_id;
      CONTINUE;
    END IF;

    -- Resolve authoritative Account ID
    SELECT id::text INTO v_acc_id
    FROM investor_accounts
    WHERE investor_id = v_item.investor_id
    ORDER BY created_at ASC
    LIMIT 1;

    IF v_acc_id IS NULL THEN
      v_acc_id := v_item.investor_id;
    END IF;

    -- B. Equity Precheck
    v_avail_equity := calculate_available_withdrawal_equity_sql(v_item.investor_id, v_acc_id, DATE '2026-09-01', NULL);
    IF v_avail_equity < v_item.amount THEN
      RAISE EXCEPTION 'FATAL: INSUFFICIENT_EQUITY for % (%): Available $%, Requested $%. Aborting.', 
        v_item.username, v_item.investor_id, v_avail_equity, v_item.amount;
    END IF;

    -- Construct Deterministic Idempotency Key
    v_idemp_key := 'sept-2026-withdrawal-' || v_item.investor_id || '-' || v_item.cents || '-stakeholder-batch';

    -- 2. Execute via canonical create_withdrawal_atomic RPC under advisory lock
    v_res := public.create_withdrawal_atomic(
      p_investor_id           => v_item.investor_id,
      p_account_id            => v_acc_id,
      p_amount                => v_item.amount,
      p_effective_date        => DATE '2026-09-01',
      p_status                => 'Completed',
      p_notes                 => 'Stakeholder-authorized September 1, 2026 withdrawal batch.',
      p_idempotency_key       => v_idemp_key,
      p_created_by            => 'admin_batch_execution',
      p_allow_duplicate_amount => FALSE
    );

    IF v_res->>'status' NOT IN ('SUCCESS', 'IDEMPOTENT_REPLAY') THEN
      RAISE EXCEPTION 'FATAL: RPC failure for % (%): %', v_item.username, v_item.investor_id, v_res->>'error';
    END IF;

    v_created_id := v_res->>'withdrawal_id';

    -- 3. Immediate Sequential Read-Back Verification
    SELECT * INTO v_verify FROM withdrawals WHERE id = v_created_id;
    IF v_verify.id IS NULL 
       OR v_verify.investor_id != v_item.investor_id 
       OR v_verify.amount != v_item.amount 
       OR v_verify.effective_accounting_date != DATE '2026-09-01'
       OR v_verify.status != 'Completed' THEN
      RAISE EXCEPTION 'FATAL: Read-back verification failed for withdrawal % (%)', v_created_id, v_item.username;
    END IF;

    v_success_count := v_success_count + 1;
    v_total_sum := v_total_sum + v_item.amount;
    RAISE NOTICE 'SUCCESS [%/11]: Created % (%) amount $%, withdrawal_id: %', 
      v_item.idx, v_item.username, v_item.investor_id, v_item.amount, v_created_id;
  END LOOP;

  RAISE NOTICE '====================================================================';
  RAISE NOTICE 'BATCH EXECUTION COMPLETE: % transactions executed. Total: $%', v_success_count, v_total_sum;
  RAISE NOTICE '====================================================================';
END $$;

-- Post-Batch Census & Verification Table
SELECT 
  w.id AS withdrawal_id,
  w.investor_id,
  i.portal_username,
  w.account_id,
  w.amount,
  w.effective_accounting_date,
  w.status,
  w.idempotency_key,
  w.created_by,
  w.created_at
FROM withdrawals w
JOIN investors i ON i.id = w.investor_id
WHERE w.effective_accounting_date = DATE '2026-09-01'
ORDER BY w.created_at ASC;
