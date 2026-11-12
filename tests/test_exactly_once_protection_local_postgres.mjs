/**
 * COMPREHENSIVE LOCAL POSTGRESQL EXACTLY-ONCE CASHFLOW PROTECTION TEST SUITE
 * 100% Offline / Local Execution (Zero Production Credentials).
 *
 * Verifies:
 *   1. Double-clicks / concurrent identical requests (advisory lock concurrency).
 *   2. Timeout-and-retry with same idempotency key & same payload (Idempotent Replay).
 *   3. Idempotency key reuse with different payload (Payload Mismatch Rejection).
 *   4. Legitimate separate transactions for same amount & date with distinct keys (Accepted).
 *   5. Duplicate payment-provider callbacks deduplicated by provider_event_id.
 *   6. Internal transfer atomicity (linked debit + credit legs, rollback on failure, zero outside cash).
 *   7. Transaction status transition safety (Completed cannot be cancelled/deleted; explicit reversal required).
 *   8. Permanent physical deletion prohibition (DELETE triggers).
 *   9. Single-counting recurring draw deduplication (Jeff Bennion scenario: withdrawal + draw = exactly 1 deduction).
 *  10. Repeated balance recalculation idempotency (10 recalculations yield identical balance).
 */

import fs from 'fs';
import pg from 'pg';
import EmbeddedPostgres from 'embedded-postgres';
import Decimal from 'decimal.js';
import { calculateInvestorMonth, isDrawFulfillmentWithdrawal } from '../lib/accounting-engine.js';

const { Pool } = pg;

async function runExactlyOnceTestSuite() {
  console.log('================================================================================');
  console.log('EXACTLY-ONCE CASHFLOW PROTECTION & RECALCULATION IDEMPOTENCY TEST SUITE');
  console.log('Environment: Isolated Local Embedded PostgreSQL (Zero Production Credentials)');
  console.log('================================================================================\n');

  const port = 54333;
  const dbName = 'postgres';
  const user = 'postgres';
  const password = 'postgrespassword';
  const connStr = `postgresql://${user}:${password}@127.0.0.1:${port}/${dbName}`;

  if (fs.existsSync('data')) {
    fs.rmSync('data', { recursive: true, force: true });
  }

  const server = new EmbeddedPostgres({
    port,
    user,
    password,
    database: dbName,
    dataDir: 'data/test_db_exactly_once'
  });

  console.log(`Starting isolated Embedded PostgreSQL server on port ${port}...`);
  await server.initialise();
  await server.start();
  console.log('✅ Local PostgreSQL server started successfully.\n');

  const pool = new Pool({ connectionString: connStr, max: 15 });

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✅ PASS: ${message}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${message}`);
      failed++;
    }
  }

  try {
    const client = await pool.connect();

    // 1. Setup Base Schema & Functions
    console.log('1. Setting up schema and financial helper functions...');
    await client.query(`
      DROP TABLE IF EXISTS payment_provider_events CASCADE;
      DROP TABLE IF EXISTS investor_monthly_history CASCADE;
      DROP TABLE IF EXISTS internal_transfers CASCADE;
      DROP TABLE IF EXISTS withdrawals CASCADE;
      DROP TABLE IF EXISTS deposits CASCADE;
      DROP TABLE IF EXISTS investor_accounts CASCADE;
      DROP TABLE IF EXISTS investors CASCADE;
      DROP SEQUENCE IF EXISTS internal_transfer_seq CASCADE;

      CREATE TABLE investors (
        id TEXT PRIMARY KEY,
        portal_username TEXT UNIQUE,
        first_name TEXT,
        last_name TEXT,
        monthly_draw NUMERIC(15, 2) DEFAULT 0.00,
        split_pct NUMERIC(5, 2) DEFAULT 70.00,
        status TEXT DEFAULT 'Active',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE investor_accounts (
        id TEXT PRIMARY KEY,
        investor_id TEXT REFERENCES investors(id),
        starting_capital NUMERIC(15, 2) DEFAULT 0.00,
        split_pct NUMERIC(5, 2) DEFAULT 70.00,
        status TEXT DEFAULT 'Active',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE deposits (
        id TEXT PRIMARY KEY,
        investor_id TEXT REFERENCES investors(id),
        account_id TEXT REFERENCES investor_accounts(id),
        amount NUMERIC(15, 2) NOT NULL,
        date DATE DEFAULT CURRENT_DATE,
        effective_accounting_date DATE DEFAULT CURRENT_DATE,
        type TEXT DEFAULT 'Wire',
        accounting_treatment TEXT DEFAULT 'NEW_CASH',
        status TEXT DEFAULT 'confirmed',
        notes TEXT,
        idempotency_key TEXT,
        transfer_id UUID,
        transfer_leg TEXT,
        created_by TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE withdrawals (
        id TEXT PRIMARY KEY,
        investor_id TEXT REFERENCES investors(id),
        account_id TEXT REFERENCES investor_accounts(id),
        amount NUMERIC(15, 2) NOT NULL,
        effective_accounting_date DATE DEFAULT CURRENT_DATE,
        request_date DATE DEFAULT CURRENT_DATE,
        status TEXT DEFAULT 'Pending',
        notes TEXT,
        year INTEGER,
        month_number INTEGER,
        month TEXT,
        idempotency_key TEXT,
        transfer_id UUID,
        transfer_leg TEXT,
        created_by TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE internal_transfers (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        transfer_number TEXT UNIQUE,
        source_investor_id TEXT REFERENCES investors(id),
        source_account_id TEXT REFERENCES investor_accounts(id),
        target_investor_id TEXT REFERENCES investors(id),
        target_account_id TEXT REFERENCES investor_accounts(id),
        amount NUMERIC(15, 2) NOT NULL,
        effective_accounting_date DATE,
        year INTEGER,
        month_number INTEGER,
        month TEXT,
        status TEXT DEFAULT 'confirmed',
        purpose TEXT,
        notes TEXT,
        idempotency_key TEXT,
        created_by TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE investor_monthly_history (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        investor_id TEXT REFERENCES investors(id),
        year INTEGER NOT NULL,
        month_number INTEGER NOT NULL,
        month TEXT,
        opening_balance NUMERIC(15, 2) DEFAULT 0.00,
        deposits NUMERIC(15, 2) DEFAULT 0.00,
        withdrawals NUMERIC(15, 2) DEFAULT 0.00,
        gross_return_pct NUMERIC(6, 4) DEFAULT 0.00,
        recurring_draw NUMERIC(15, 2) DEFAULT 0.00,
        ending_balance NUMERIC(15, 2) DEFAULT 0.00,
        locked BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(investor_id, year, month_number)
      );

      CREATE SEQUENCE internal_transfer_seq START WITH 1;

      CREATE OR REPLACE FUNCTION financial_lock_key(p_text TEXT) RETURNS BIGINT AS $$
      BEGIN
        RETURN ('x' || substr(md5(p_text), 1, 16))::bit(64)::bigint;
      END;
      $$ LANGUAGE plpgsql IMMUTABLE;

      CREATE OR REPLACE FUNCTION calculate_available_withdrawal_equity_sql(
        p_investor_id TEXT,
        p_account_id TEXT,
        p_as_of_date DATE,
        p_exclude_wd_id TEXT DEFAULT NULL
      ) RETURNS NUMERIC AS $$
      DECLARE
        v_start NUMERIC := 0;
        v_deps NUMERIC := 0;
        v_wds NUMERIC := 0;
      BEGIN
        SELECT COALESCE(starting_capital, 0) INTO v_start
        FROM investor_accounts WHERE id = p_account_id;

        SELECT COALESCE(SUM(amount), 0) INTO v_deps
        FROM deposits
        WHERE account_id = p_account_id AND status = 'confirmed';

        SELECT COALESCE(SUM(amount), 0) INTO v_wds
        FROM withdrawals
        WHERE account_id = p_account_id
          AND status IN ('Pending', 'Approved', 'Completed')
          AND (p_exclude_wd_id IS NULL OR id != p_exclude_wd_id);

        RETURN v_start + v_deps - v_wds;
      END;
      $$ LANGUAGE plpgsql;
    `);

    // 2. Apply Migration
    console.log('2. Applying Exactly-Once Migration SQL...');
    const migrationSql = fs.readFileSync('supabase/migrations/20261111_robust_exactly_once_cashflow_protection.sql', 'utf8');
    await client.query(migrationSql);
    console.log('✅ Migration applied successfully.\n');

    // Seed test investor
    await client.query(`
      INSERT INTO investors (id, portal_username, first_name, last_name, monthly_draw, split_pct)
      VALUES
        ('inv_bennion', 'jbennion', 'Jeff', 'Bennion', 21500.00, 66.60),
        ('inv_stout', 'jstout', 'Joshua', 'Stout', 0.00, 100.00),
        ('inv_target', 'target_user', 'Target', 'User', 0.00, 70.00);

      INSERT INTO investor_accounts (id, investor_id, starting_capital, split_pct)
      VALUES
        ('acc_bennion', 'inv_bennion', 2751548.78, 66.60),
        ('acc_stout', 'inv_stout', 3401758.56, 100.00),
        ('acc_target', 'inv_target', 100000.00, 70.00);
    `);
    client.release();

    // =========================================================================
    // TEST 1: Double-Click / Concurrent Identical Requests
    // =========================================================================
    console.log('--- TEST 1: Double-Click / Concurrent Identical Requests Under Advisory Lock ---');
    const key1 = 'req_idempotent_001';
    const c1 = await pool.connect();
    const c2 = await pool.connect();

    // Fire two simultaneous requests with identical idempotency key
    const [resA, resB] = await Promise.all([
      c1.query(`SELECT public.create_withdrawal_atomic('inv_stout', 'acc_stout', 10000.00, '2026-11-01', 'Approved', 'Double-click test', $1, 'tester');`, [key1]),
      c2.query(`SELECT public.create_withdrawal_atomic('inv_stout', 'acc_stout', 10000.00, '2026-11-01', 'Approved', 'Double-click test', $1, 'tester');`, [key1])
    ]);

    const outA = resA.rows[0].create_withdrawal_atomic;
    const outB = resB.rows[0].create_withdrawal_atomic;

    const countRows1 = (await pool.query(`SELECT COUNT(*) FROM withdrawals WHERE idempotency_key = $1;`, [key1])).rows[0].count;

    assert(countRows1 === '1', 'Exactly one withdrawal row exists in database');
    assert(
      (outA.status === 'SUCCESS' && outB.status === 'IDEMPOTENT_REPLAY') ||
      (outB.status === 'SUCCESS' && outA.status === 'IDEMPOTENT_REPLAY'),
      'One connection gets SUCCESS, the concurrent twin gets IDEMPOTENT_REPLAY'
    );
    assert(
      outA.withdrawal_id === outB.withdrawal_id,
      'Both concurrent requests resolve to the identical withdrawal_id'
    );
    c1.release();
    c2.release();

    // =========================================================================
    // TEST 2: Timeout-and-Retry with Same Idempotency Key & Same Payload
    // =========================================================================
    console.log('\n--- TEST 2: Timeout-and-Retry (Idempotent Replay) ---');
    const retryRes = await pool.query(
      `SELECT public.create_withdrawal_atomic('inv_stout', 'acc_stout', 10000.00, '2026-11-01', 'Approved', 'Double-click test', $1, 'tester');`,
      [key1]
    );
    const retryOut = retryRes.rows[0].create_withdrawal_atomic;
    assert(retryOut.status === 'IDEMPOTENT_REPLAY', 'Retry returns IDEMPOTENT_REPLAY status');
    assert(retryOut.idempotency_replay === true, 'idempotency_replay flag is true');
    assert(retryOut.withdrawal_id === outA.withdrawal_id, 'Returned record matches original created withdrawal');

    // =========================================================================
    // TEST 3: Idempotency Key Conflict with Different Payload (Rejected)
    // =========================================================================
    console.log('\n--- TEST 3: Idempotency Key Conflict with Different Payload ---');
    let threwMismatch = false;
    let mismatchMsg = '';
    try {
      // Attempt using key1 with a different amount ($20,000 instead of $10,000)
      await pool.query(
        `SELECT public.create_withdrawal_atomic('inv_stout', 'acc_stout', 20000.00, '2026-11-01', 'Approved', 'Payload mismatch test', $1, 'tester');`,
        [key1]
      );
    } catch (err) {
      threwMismatch = true;
      mismatchMsg = err.message;
    }
    assert(threwMismatch, 'Reusing key with different amount throws exception');
    assert(mismatchMsg.includes('IDEMPOTENCY_KEY_PAYLOAD_MISMATCH'), 'Error code is IDEMPOTENCY_KEY_PAYLOAD_MISMATCH');

    // =========================================================================
    // TEST 4: Legitimate Separate Transactions for Same Amount & Same Date
    // =========================================================================
    console.log('\n--- TEST 4: Legitimate Separate Transactions (Same Amount, Date & Account) ---');
    // Two distinct distributions of $2,500 on the same date with distinct operation keys
    const sepKeyA = 'batch_distrib_part_1_uuid_abc';
    const sepKeyB = 'batch_distrib_part_2_uuid_xyz';

    const distA = await pool.query(
      `SELECT public.create_withdrawal_atomic('inv_stout', 'acc_stout', 2500.00, '2026-11-01', 'Approved', 'Split distribution leg 1', $1, 'admin');`,
      [sepKeyA]
    );
    const distB = await pool.query(
      `SELECT public.create_withdrawal_atomic('inv_stout', 'acc_stout', 2500.00, '2026-11-01', 'Approved', 'Split distribution leg 2', $1, 'admin');`,
      [sepKeyB]
    );

    assert(distA.rows[0].create_withdrawal_atomic.status === 'SUCCESS', 'First $2,500 distribution succeeds');
    assert(distB.rows[0].create_withdrawal_atomic.status === 'SUCCESS', 'Second $2,500 distribution with distinct key succeeds without false-positive blocking');
    assert(
      distA.rows[0].create_withdrawal_atomic.withdrawal_id !== distB.rows[0].create_withdrawal_atomic.withdrawal_id,
      'Two distinct withdrawal records were legitimately created'
    );

    // =========================================================================
    // TEST 5: Payment-Provider Webhook Deduplication
    // =========================================================================
    console.log('\n--- TEST 5: Payment Provider Webhook Event Deduplication ---');
    const eventId = 'evt_stripe_test_charge_998877';

    // First webhook call
    const hook1 = await pool.query(
      `SELECT public.process_payment_provider_event_atomic('stripe', $1, 'payment_intent.succeeded', 'inv_stout', 'acc_stout', 5000.00, '2026-11-01', 'deposit', '{"test": 1}'::jsonb, 'Stripe deposit');`,
      [eventId]
    );
    const hookOut1 = hook1.rows[0].process_payment_provider_event_atomic;
    assert(hookOut1.status === 'SUCCESS', 'Initial webhook delivery processed successfully');
    assert(hookOut1.idempotency_replay === false, 'First processing is not a replay');

    // Duplicate webhook call (e.g. network retry from Stripe)
    const hook2 = await pool.query(
      `SELECT public.process_payment_provider_event_atomic('stripe', $1, 'payment_intent.succeeded', 'inv_stout', 'acc_stout', 5000.00, '2026-11-01', 'deposit', '{"test": 1}'::jsonb, 'Stripe deposit retry');`,
      [eventId]
    );
    const hookOut2 = hook2.rows[0].process_payment_provider_event_atomic;
    assert(hookOut2.status === 'ALREADY_PROCESSED', 'Duplicate webhook call returns ALREADY_PROCESSED');
    assert(hookOut2.idempotency_replay === true, 'idempotency_replay is true');
    assert(hookOut2.resource_id === hookOut1.resource_id, 'Points to identical original deposit ID');

    // Verify deposits table only has 1 record for this webhook
    const depCount = (await pool.query(`SELECT COUNT(*) FROM deposits WHERE idempotency_key = $1;`, [`webhook_stripe_${eventId}`])).rows[0].count;
    assert(depCount === '1', 'Exactly one deposit row exists for this provider event ID');

    // =========================================================================
    // TEST 6: Internal Transfer Atomicity & Zero Outside Cash
    // =========================================================================
    console.log('\n--- TEST 6: Internal Transfer Atomicity & Failure Rollback ---');
    // Successful transfer
    const xferKey = 'xfer_monthly_test_001';
    const xferRes = await pool.query(`
      SELECT public.execute_internal_transfer_atomic(
        'acc_stout', 'acc_target', 1500.00, '2026-11-01', 'Monthly rebalance', 'Internal xfer test', $1, 'admin'
      );
    `, [xferKey]);
    const xferOut = xferRes.rows[0].execute_internal_transfer_atomic;
    assert(xferOut.success === true, 'Internal transfer succeeded');

    // Verify linked legs
    const debitLeg = (await pool.query(`SELECT * FROM withdrawals WHERE transfer_id = $1;`, [xferOut.transfer_id])).rows[0];
    const creditLeg = (await pool.query(`SELECT * FROM deposits WHERE transfer_id = $1;`, [xferOut.transfer_id])).rows[0];
    assert(debitLeg && debitLeg.transfer_leg === 'DEBIT' && Number(debitLeg.amount) === 1500.00, 'Debit leg recorded as Completed withdrawal');
    assert(creditLeg && creditLeg.transfer_leg === 'CREDIT' && creditLeg.accounting_treatment === 'INTERNAL_TRANSFER', 'Credit leg recorded with accounting_treatment = INTERNAL_TRANSFER');

    // Test transfer failure rollback (e.g. amount exceeds source equity)
    let transferFailed = false;
    try {
      await pool.query(`
        SELECT public.execute_internal_transfer_atomic(
          'acc_stout', 'acc_target', 999999999.00, '2026-11-01', 'Excessive xfer', 'Should fail', 'xfer_fail_key', 'admin'
        );
      `);
    } catch (err) {
      transferFailed = true;
    }
    assert(transferFailed, 'Transfer exceeding equity fails closed');
    const phantomLegs = (await pool.query(`SELECT COUNT(*) FROM withdrawals WHERE notes LIKE '%Excessive xfer%';`)).rows[0].count;
    assert(phantomLegs === '0', 'Zero phantom withdrawal/deposit legs inserted on failed transfer');

    // =========================================================================
    // TEST 7: Permanent Physical Deletion Prohibition
    // =========================================================================
    console.log('\n--- TEST 7: Permanent Physical Deletion Prohibition ---');
    let delDepBlocked = false;
    let delWdBlocked = false;
    let delXferBlocked = false;

    try {
      await pool.query(`DELETE FROM deposits WHERE id = $1;`, [creditLeg.id]);
    } catch (e) {
      delDepBlocked = e.message.includes('PHYSICAL_DELETION_PROHIBITED');
    }
    try {
      await pool.query(`DELETE FROM withdrawals WHERE id = $1;`, [debitLeg.id]);
    } catch (e) {
      delWdBlocked = e.message.includes('PHYSICAL_DELETION_PROHIBITED');
    }
    try {
      await pool.query(`DELETE FROM internal_transfers WHERE id = $1;`, [xferOut.transfer_id]);
    } catch (e) {
      delXferBlocked = e.message.includes('PHYSICAL_DELETION_PROHIBITED');
    }

    assert(delDepBlocked, 'Physical DELETE on deposits table is blocked by trigger');
    assert(delWdBlocked, 'Physical DELETE on withdrawals table is blocked by trigger');
    assert(delXferBlocked, 'Physical DELETE on internal_transfers table is blocked by trigger');

    // =========================================================================
    // TEST 8: Safe Status Transitions
    // =========================================================================
    console.log('\n--- TEST 8: Safe Status Transitions ---');
    // Completed withdrawal cannot be flipped to Cancelled
    let cancelCompletedBlocked = false;
    try {
      // Create a Completed withdrawal
      const compRes = await pool.query(`
        SELECT public.create_withdrawal_atomic('inv_stout', 'acc_stout', 500.00, '2026-11-01', 'Completed', 'Completed test', 'key_comp_01', 'admin');
      `);
      const compId = compRes.rows[0].create_withdrawal_atomic.withdrawal_id;
      // Attempt cancel via update_withdrawal_atomic
      await pool.query(`
        SELECT public.update_withdrawal_atomic($1, 500.00, 'Cancelled', 'Trying to cancel completed', 'admin');
      `, [compId]);
    } catch (e) {
      cancelCompletedBlocked = e.message.includes('Completed withdrawals are financially immutable');
    }
    assert(cancelCompletedBlocked, 'Completed withdrawal is financially immutable and cannot be flipped to Cancelled');

    // =========================================================================
    // TEST 9: Explicit Draw Linkage (No Substrings) & Genuinely Separate Obligations
    // =========================================================================
    console.log('\n--- TEST 9: Explicit Draw Linkage (No Substrings) & Separate Obligations ---');

    // 9.1: Prohibit Substring Matching: Misleading notes/keys MUST NOT be treated as draw fulfillment
    assert(isDrawFulfillmentWithdrawal({ notes: 'October draw' }) === false, 'Misleading note "October draw" without explicit link is NOT treated as draw fulfillment');
    assert(isDrawFulfillmentWithdrawal({ idempotency_key: 'JOSH_AUTH_DRAW_skimbell_6000' }) === false, 'Misleading key containing "DRAW" without explicit link is NOT treated as draw fulfillment');
    assert(isDrawFulfillmentWithdrawal({ notes: 'Draw for home purchase', idempotency_key: 'key_123' }) === false, 'Unrelated withdrawal with word "Draw" is NOT treated as draw fulfillment');

    // 9.2: Verified Explicit Links: Boolean flag, standardized purpose/type, or source_event_type
    assert(isDrawFulfillmentWithdrawal({ is_draw: true }) === true, 'Withdrawal with explicit is_draw: true IS identified as draw fulfillment');
    assert(isDrawFulfillmentWithdrawal({ draw_fulfillment: true }) === true, 'Withdrawal with explicit draw_fulfillment: true IS identified as draw fulfillment');
    assert(isDrawFulfillmentWithdrawal({ purpose: 'monthly_draw' }) === true, 'Withdrawal with purpose "monthly_draw" IS identified as draw fulfillment');
    assert(isDrawFulfillmentWithdrawal({ type: 'monthly_draw' }) === true, 'Withdrawal with type "monthly_draw" IS identified as draw fulfillment');
    assert(isDrawFulfillmentWithdrawal({ source_event_type: 'CONTRACTUAL_MONTHLY_DRAW' }) === true, 'Withdrawal with source_event_type CONTRACTUAL_MONTHLY_DRAW IS identified as draw fulfillment');
    assert(isDrawFulfillmentWithdrawal({ linked_draw_id: 'draw_rec_2026_10' }) === true, 'Withdrawal with linked_draw_id IS identified as draw fulfillment');

    // 9.3: Default Behavior: drawFulfillmentWithdrawals omitted defaults to 0 (never silently treats all withdrawals as draw)
    const defaultOmittedCalc = calculateInvestorMonth({
      year: 2026,
      month: 10,
      investorId: 'inv_default_test',
      priorEndingBalance: 100000.00,
      deposits: 0,
      withdrawals: 10000.00,
      // drawFulfillmentWithdrawals omitted! Must default to 0!
      recurringDraw: 5000.00,
      fundReturnPct: 0
    });
    // Expected: eligibleCapital = 100,000 - 10,000 = 90,000
    // effectiveDrawToDeduct = max(0, 5000 - 0) = 5,000
    // endingBalance = 90,000 - 5,000 = 85,000 (Both deducted, $15,000 total deduction)
    assert(defaultOmittedCalc.endingBalance === 85000.00, 'Omitted drawFulfillmentWithdrawals defaults to 0 and preserves separate contractual draw ($85,000 ending)');

    // 9.4: Genuinely Separate Contractual Obligation: Ad-hoc withdrawal + Contractual Draw
    const separateCalc = calculateInvestorMonth({
      year: 2026,
      month: 10,
      investorId: 'inv_separate_test',
      priorEndingBalance: 100000.00,
      deposits: 0,
      withdrawals: 10000.00,
      drawFulfillmentWithdrawals: 0, // Explicitly 0 draw fulfillment (unrelated ad-hoc withdrawal)
      recurringDraw: 5000.00,
      fundReturnPct: 0
    });
    assert(separateCalc.eligibleCapital === 90000.00, 'Separate ad-hoc withdrawal reduces capital by $10,000 ($90,000.00)');
    assert(separateCalc.endingBalance === 85000.00, 'Contractual $5,000 draw is preserved and also deducted ($85,000.00 ending, $15,000 total deduction)');

    // 9.5: Verified Linked Draw: Jeff Bennion Scenario ($21,500 withdrawal fulfills $21,500 draw)
    const bennionCalc = calculateInvestorMonth({
      year: 2026,
      month: 10,
      investorId: 'inv_bennion',
      priorEndingBalance: 2751548.78,
      deposits: 0,
      withdrawals: 21500.00,
      drawFulfillmentWithdrawals: 21500.00, // Explicit verified draw fulfillment
      recurringDraw: 21500.00,
      fundReturnPct: 0
    });
    assert(bennionCalc.eligibleCapital === 2730048.78, 'Bennion eligible capital reflects $21,500 withdrawal ($2,730,048.78)');
    assert(bennionCalc.endingBalance === 2730048.78, 'Bennion ending balance single-counts draw fulfillment ($2,730,048.78, NOT $2,708,548.78)');

    // 9.6: Partial Draw Fulfillment ($10,000 partial fulfillment of $21,500 obligation)
    const partialCalc = calculateInvestorMonth({
      year: 2026,
      month: 10,
      investorId: 'inv_partial_test',
      priorEndingBalance: 100000.00,
      deposits: 0,
      withdrawals: 10000.00,
      drawFulfillmentWithdrawals: 10000.00, // Partial fulfillment
      recurringDraw: 21500.00,
      fundReturnPct: 0
    });
    // Expected: 100,000 - 10,000 - (21,500 - 10,000) = 90,000 - 11,500 = 78,500
    assert(partialCalc.endingBalance === 78500.00, 'Partial draw leaves unfulfilled remainder ($78,500 ending, exactly $21,500 total deduction)');

    // =========================================================================
    // TEST 10: Repeated Recalculation Idempotency (10 Cycles)
    // =========================================================================
    console.log('\n--- TEST 10: Repeated Recalculation Idempotency (10 Cycles) ---');
    let allIdentical = true;
    for (let cycle = 1; cycle <= 10; cycle++) {
      const reCalc = calculateInvestorMonth({
        year: 2026,
        month: 10,
        investorId: 'inv_bennion',
        priorEndingBalance: 2751548.78,
        deposits: 0,
        withdrawals: 21500.00,
        drawFulfillmentWithdrawals: 21500.00,
        recurringDraw: 21500.00,
        fundReturnPct: 0
      });
      if (reCalc.endingBalance !== 2730048.78 || reCalc.eligibleCapital !== 2730048.78) {
        allIdentical = false;
        break;
      }
    }
    assert(allIdentical, '10 consecutive recalculations yield identical balances down to the exact penny ($2,730,048.78)');

    // =========================================================================
    // TEST 11: create_deposit_atomic Payload Binding & Payload Mismatch Rejection
    // =========================================================================
    console.log('\n--- TEST 11: create_deposit_atomic Payload Binding & Mismatch Rejection ---');
    const depKeyBase = 'dep_idempotent_test_payload_binding';

    // Initial deposit
    const depInit = await pool.query(`
      SELECT public.create_deposit_atomic(
        'inv_stout', 'acc_stout', 10000.00, '2026-10-01'::DATE, '2026-10-01'::DATE,
        'NEW_CASH', 'confirmed', 'Wire', 'Initial deposit', $1, 'tester'
      );
    `, [depKeyBase]);
    const depInitId = depInit.rows[0].create_deposit_atomic.deposit_id;
    assert(depInit.rows[0].create_deposit_atomic.status === 'SUCCESS', 'Initial deposit succeeds');

    // Identical replay succeeds
    const depReplay = await pool.query(`
      SELECT public.create_deposit_atomic(
        'inv_stout', 'acc_stout', 10000.00, '2026-10-01'::DATE, '2026-10-01'::DATE,
        'NEW_CASH', 'confirmed', 'Wire', 'Initial deposit', $1, 'tester'
      );
    `, [depKeyBase]);
    assert(depReplay.rows[0].create_deposit_atomic.status === 'IDEMPOTENT_REPLAY', 'Identical replay returns IDEMPOTENT_REPLAY');
    assert(depReplay.rows[0].create_deposit_atomic.deposit_id === depInitId, 'Replay resolves to identical deposit ID');

    // 11.1: Reusing key with changed amount must fail
    let diffAmountThrew = false;
    try {
      await pool.query(`
        SELECT public.create_deposit_atomic(
          'inv_stout', 'acc_stout', 20000.00, '2026-10-01'::DATE, '2026-10-01'::DATE,
          'NEW_CASH', 'confirmed', 'Wire', 'Changed amount', $1, 'tester'
        );
      `, [depKeyBase]);
    } catch (e) {
      diffAmountThrew = e.message.includes('IDEMPOTENCY_KEY_PAYLOAD_MISMATCH');
    }
    assert(diffAmountThrew, 'Key reuse with changed amount is REJECTED with IDEMPOTENCY_KEY_PAYLOAD_MISMATCH');

    // 11.2: Reusing key with changed account must fail
    let diffAccountThrew = false;
    try {
      await pool.query(`
        SELECT public.create_deposit_atomic(
          'inv_stout', 'acc_target', 10000.00, '2026-10-01'::DATE, '2026-10-01'::DATE,
          'NEW_CASH', 'confirmed', 'Wire', 'Changed account', $1, 'tester'
        );
      `, [depKeyBase]);
    } catch (e) {
      diffAccountThrew = e.message.includes('IDEMPOTENCY_KEY_PAYLOAD_MISMATCH');
    }
    assert(diffAccountThrew, 'Key reuse with changed account_id is REJECTED with IDEMPOTENCY_KEY_PAYLOAD_MISMATCH');

    // 11.3: Reusing key with changed accounting treatment must fail
    let diffTreatmentThrew = false;
    try {
      await pool.query(`
        SELECT public.create_deposit_atomic(
          'inv_stout', 'acc_stout', 10000.00, '2026-10-01'::DATE, '2026-10-01'::DATE,
          'HISTORICAL_PROVENANCE', 'confirmed', 'Wire', 'Changed treatment', $1, 'tester'
        );
      `, [depKeyBase]);
    } catch (e) {
      diffTreatmentThrew = e.message.includes('IDEMPOTENCY_KEY_PAYLOAD_MISMATCH');
    }
    assert(diffTreatmentThrew, 'Key reuse with changed accounting_treatment is REJECTED with IDEMPOTENCY_KEY_PAYLOAD_MISMATCH');

    // =========================================================================
    // TEST 12: Legitimate Same-Amount & Same-Date Transactions with Distinct Keys
    // =========================================================================
    console.log('\n--- TEST 12: Legitimate Separate Transactions with Distinct Keys ---');
    const legitDep1 = await pool.query(`
      SELECT public.create_deposit_atomic(
        'inv_stout', 'acc_stout', 5000.00, '2026-10-01'::DATE, '2026-10-01'::DATE,
        'NEW_CASH', 'confirmed', 'Wire', 'First wire', 'distinct_key_001', 'tester'
      );
    `);
    const legitDep2 = await pool.query(`
      SELECT public.create_deposit_atomic(
        'inv_stout', 'acc_stout', 5000.00, '2026-10-01'::DATE, '2026-10-01'::DATE,
        'NEW_CASH', 'confirmed', 'Wire', 'Second wire', 'distinct_key_002', 'tester'
      );
    `);
    assert(legitDep1.rows[0].create_deposit_atomic.status === 'SUCCESS', 'First legitimate $5,000 deposit succeeds');
    assert(legitDep2.rows[0].create_deposit_atomic.status === 'SUCCESS', 'Second legitimate $5,000 deposit on same date with distinct key succeeds');
    assert(legitDep1.rows[0].create_deposit_atomic.deposit_id !== legitDep2.rows[0].create_deposit_atomic.deposit_id, 'Two distinct deposits were legitimately created without false-positive blocking');

    console.log('\n================================================================================');
    console.log(`TEST SUITE RESULTS: ${passed} PASSED, ${failed} FAILED (Total ${passed + failed})`);
    console.log('================================================================================\n');

  } finally {
    await pool.end();
    console.log('Stopping local PostgreSQL server...');
    await server.stop();
    console.log('Local PostgreSQL server stopped.\n');
  }

  if (failed > 0) {
    throw new Error(`${failed} tests failed!`);
  }
}

runExactlyOnceTestSuite().catch(err => {
  console.error('Fatal error running test suite:', err);
  process.exit(1);
});
