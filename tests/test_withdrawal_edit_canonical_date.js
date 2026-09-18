import assert from "assert";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { canonicalizeWithdrawalPeriod, calculateAvailableWithdrawalEquity } from "../lib/withdrawal-validation.js";

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function pass(name) {
  console.log(`✅ PASS: ${name}`);
}

function fail(name, err) {
  console.error(`❌ FAIL: ${name}`, err);
  process.exit(1);
}

async function runTests() {
  console.log("===============================================================================");
  console.log("FOREXPAGE — WITHDRAWAL EDIT CANONICAL DATE & EQUITY REGRESSION TEST SUITE");
  console.log("===============================================================================\n");

  // ---------------------------------------------------------------------------
  // TEST SECTION 1: CANONICAL PERIOD RESOLVER PURE LOGIC INVARIANTS
  // ---------------------------------------------------------------------------
  console.log("--- PART 1: Pure Logic Invariants for Period Canonicalization ---\n");

  try {
    // 1A. Full Month Name "August"
    const p1 = canonicalizeWithdrawalPeriod({ month: "August", year: 2026 });
    assert.strictEqual(p1.effectiveDate, "2026-08-01", "Full month 'August' must resolve to 2026-08-01");
    assert.strictEqual(p1.year, 2026);
    assert.strictEqual(p1.monthNumber, 8);
    assert.strictEqual(p1.monthName, "August");
    pass("1A. Full month 'August' canonicalizes to 2026-08-01");

    // 1B. Case-insensitive Abbreviation "aug"
    const p2 = canonicalizeWithdrawalPeriod({ month: "aug", year: "2026" });
    assert.strictEqual(p2.effectiveDate, "2026-08-01", "'aug' must resolve to 2026-08-01");
    assert.strictEqual(p2.monthNumber, 8);
    pass("1B. Case-insensitive abbreviation 'aug' canonicalizes to 2026-08-01");

    // 1C. Numeric Month 8
    const p3 = canonicalizeWithdrawalPeriod({ month: 8, year: 2026 });
    assert.strictEqual(p3.effectiveDate, "2026-08-01", "Numeric month 8 must resolve to 2026-08-01");
    assert.strictEqual(p3.monthName, "August");
    pass("1C. Numeric month 8 canonicalizes to 2026-08-01");

    // 1D. ISO Effective Date Input
    const p4 = canonicalizeWithdrawalPeriod({ effectiveDate: "2026-08-01" });
    assert.strictEqual(p4.effectiveDate, "2026-08-01", "ISO date '2026-08-01' must resolve to 2026-08-01");
    assert.strictEqual(p4.year, 2026);
    assert.strictEqual(p4.monthNumber, 8);
    pass("1D. ISO effective date string canonicalizes correctly");

    // 1E. Mid-month ISO date must be normalized to first-of-month
    const p5 = canonicalizeWithdrawalPeriod({ effective_accounting_date: "2026-08-15" });
    assert.strictEqual(p5.effectiveDate, "2026-08-01", "Mid-month date must normalize to 2026-08-01");
    pass("1E. Mid-month date string normalizes to first of the month");

    // 1F. Invalid month must fail closed
    let threw = false;
    try {
      canonicalizeWithdrawalPeriod({ month: "InvalidMonth", year: 2026 });
    } catch (e) {
      threw = true;
      assert(e.message.includes("INVALID_EFFECTIVE_DATE"), "Must throw INVALID_EFFECTIVE_DATE");
    }
    assert(threw, "Invalid month input must fail closed");
    pass("1F. Invalid month string fails closed with INVALID_EFFECTIVE_DATE");

  } catch (err) {
    fail("Part 1: Canonical Period Resolver", err);
  }

  // ---------------------------------------------------------------------------
  // TEST SECTION 2: REAL POSTGRESQL 18.4 ATOMIC RPC & JOSH SCENARIO
  // ---------------------------------------------------------------------------
  console.log("\n--- PART 2: Real PostgreSQL 18.4 Execution & Josh Reproduction ---\n");

  const dbDir = "./data/db_test_wd_canonical";
  if (fs.existsSync(dbDir)) {
    try {
      fs.rmSync(dbDir, { recursive: true, force: true });
    } catch (e) {}
  }

  const port = 54337;
  const pgServer = new EmbeddedPostgres({
    port,
    databaseDir: dbDir,
    user: "postgres",
    password: "password",
    persistent: false
  });

  try {
    await pgServer.initialise();
    await pgServer.start();
    pass("2A. Embedded PostgreSQL 18.4 started");

    const pool = new Pool({
      connectionString: `postgresql://postgres:password@localhost:${port}/postgres`
    });
    const client = await pool.connect();

    // Create service_role
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
          CREATE ROLE service_role;
        END IF;
      END $$;
    `);

    // Create Core Schema
    await client.query(`
      CREATE TABLE investors (
        id TEXT PRIMARY KEY,
        portal_username TEXT UNIQUE,
        start_date DATE,
        split_pct NUMERIC(5, 2) DEFAULT 100.00,
        monthly_draw NUMERIC(15, 2) DEFAULT 0.00,
        active BOOLEAN DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE TABLE investor_accounts (
        id TEXT PRIMARY KEY,
        investor_id TEXT REFERENCES investors(id),
        name TEXT,
        starting_capital NUMERIC(15, 2) DEFAULT 0.00,
        open_date DATE,
        status TEXT DEFAULT 'Active',
        is_commission BOOLEAN DEFAULT false,
        notes TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE TABLE withdrawals (
        id TEXT PRIMARY KEY,
        investor_id TEXT REFERENCES investors(id),
        account_id TEXT,
        amount NUMERIC(15, 2) NOT NULL,
        status TEXT NOT NULL,
        request_date DATE,
        effective_accounting_date DATE,
        year INTEGER,
        month_number INTEGER,
        month TEXT,
        notes TEXT,
        updated_by TEXT,
        idempotency_key TEXT,
        created_by TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE TABLE deposits (
        id TEXT PRIMARY KEY,
        investor_id TEXT REFERENCES investors(id),
        account_id TEXT,
        amount NUMERIC(15, 2) NOT NULL,
        date DATE,
        effective_accounting_date DATE,
        type TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE TABLE commission_earnings (
        id TEXT PRIMARY KEY,
        recipient_id TEXT REFERENCES investors(id),
        source_investor_id TEXT,
        year INTEGER NOT NULL,
        month_number INTEGER NOT NULL,
        amount NUMERIC(15, 2) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE TABLE investor_monthly_history (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        investor_id TEXT REFERENCES investors(id),
        account_id TEXT,
        year INTEGER NOT NULL,
        month_number INTEGER NOT NULL,
        month TEXT,
        opening_balance NUMERIC(15, 2),
        deposits NUMERIC(15, 2) DEFAULT 0.00,
        withdrawals NUMERIC(15, 2) DEFAULT 0.00,
        gross_return_pct NUMERIC(5, 2) DEFAULT 0.00,
        ending_balance NUMERIC(15, 2),
        is_manual BOOLEAN DEFAULT false,
        notes TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        CONSTRAINT uq_history UNIQUE (investor_id, year, month_number)
      );

      CREATE TABLE account_cutover_adjustments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        investor_id TEXT NOT NULL REFERENCES investors(id),
        account_id TEXT,
        year INTEGER NOT NULL,
        month_number INTEGER NOT NULL,
        effective_date DATE NOT NULL,
        authorized_opening_balance NUMERIC(20, 10) NOT NULL,
        prior_rollforward_balance NUMERIC(20, 10) NOT NULL,
        reason TEXT NOT NULL,
        authorization_reference TEXT NOT NULL,
        created_by TEXT DEFAULT 'system',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        idempotency_key TEXT UNIQUE,
        CONSTRAINT uq_cutover_period UNIQUE (investor_id, year, month_number)
      );

      CREATE OR REPLACE FUNCTION financial_lock_key(p_id TEXT)
      RETURNS BIGINT LANGUAGE plpgsql IMMUTABLE AS $$
      BEGIN
        RETURN ('x' || substr(md5(p_id), 1, 15))::bit(64)::bigint;
      END;
      $$;
    `);

    // Load calculate_available_withdrawal_equity_sql from migration
    const fixStartDateSql = fs.readFileSync(
      path.join(__dirname, "../scripts/migrations/20260911_fix_start_date_conflict_validation.sql"),
      "utf8"
    );
    await client.query(fixStartDateSql);

    // Load create_withdrawal_atomic duplicate guard migration
    const hardenDuplicateSql = fs.readFileSync(
      path.join(__dirname, "../scripts/migrations/20260905_harden_create_withdrawal_atomic_duplicate_guard.sql"),
      "utf8"
    );
    await client.query(hardenDuplicateSql);

    // Load newly created update_withdrawal_atomic migration with period support
    const updateAtomicSql = fs.readFileSync(
      path.join(__dirname, "../scripts/migrations/20260918_support_effective_date_in_update_withdrawal_atomic.sql"),
      "utf8"
    );
    await client.query(updateAtomicSql);
    pass("2B. Schema and Package B RPCs (including new 20260918 update migration) loaded");

    // Seed Jerry's Rogue Jets data
    await client.query(`
      INSERT INTO investors (id, portal_username, start_date, split_pct, active) VALUES
        ('jerrys001', 'jerrys', DATE '2026-05-01', 70.00, true);

      INSERT INTO investor_accounts (id, investor_id, starting_capital, open_date, status) VALUES
        ('jerrys001', 'jerrys001', 514124.14, DATE '2026-05-01', 'Active');

      INSERT INTO investor_monthly_history (investor_id, year, month_number, month, opening_balance, deposits, withdrawals, gross_return_pct, ending_balance) VALUES
        ('jerrys001', 2026, 5, 'May', 514124.14, 0, 2500, 3.73, 530467.65),
        ('jerrys001', 2026, 6, 'Jun', 530467.65, 0, 2500, 1.95, 537827.67),
        ('jerrys001', 2026, 7, 'Jul', 537827.67, 0, 2500, 2.05, 546135.92);

      -- Existing withdrawal: Approved status, 2026-08-01, month is NULL in DB
      INSERT INTO withdrawals (
        id, investor_id, account_id, amount, status, effective_accounting_date, request_date, year, month_number, month
      ) VALUES (
        'wd_jerrys_20260801_d00164e8', 'jerrys001', 'jerrys001', 2500.00, 'Approved', DATE '2026-08-01', DATE '2026-08-01', 2026, 8, NULL
      );
    `);
    pass("2C. Jerry's Rogue Jets production baseline state seeded");

    // 2D. Verify Available Equity at 2026-08-01 with Self-Exclusion
    const { rows: eqCheck } = await client.query(`
      SELECT
        calculate_available_withdrawal_equity_sql('jerrys001', 'jerrys001', DATE '2026-08-01', 'wd_jerrys_20260801_d00164e8') as aug_equity_self_excluded,
        calculate_available_withdrawal_equity_sql('jerrys001', 'jerrys001', DATE '2026-08-01', NULL) as aug_equity_no_exclude,
        calculate_available_withdrawal_equity_sql('jerrys001', 'jerrys001', DATE '2026-01-01', NULL) as jan_equity;
    `);

    const augSelfExcluded = parseFloat(eqCheck[0].aug_equity_self_excluded);
    const augNoExclude = parseFloat(eqCheck[0].aug_equity_no_exclude);
    const janEquity = parseFloat(eqCheck[0].jan_equity);

    assert.strictEqual(augSelfExcluded, 546135.92, "Jerry's August available equity self-excluded must be $546,135.92");
    assert.strictEqual(augNoExclude, 543635.92, "Jerry's August available equity without self-exclusion must be $543,635.92 ($546,135.92 - $2,500)");
    assert.strictEqual(janEquity, 0.00, "Jerry's January available equity (pre-start) must be strictly $0.00");
    pass("2D. August available equity ($546,135.92) vs pre-start January ($0.00) verified with self-exclusion");

    // 2E. Execute Josh's exact Edit scenario:
    // Josh sends: { amount: 2500, month: "August", year: 2026, status: "Completed" }
    const inputPayload = {
      investorId: "jerrys001",
      accountId: "jerrys001",
      amount: 2500,
      month: "August",
      year: 2026,
      status: "Completed"
    };
    const resolvedPeriod = canonicalizeWithdrawalPeriod(inputPayload);
    assert.strictEqual(resolvedPeriod.effectiveDate, "2026-08-01");
    assert.strictEqual(resolvedPeriod.monthNumber, 8);
    assert.strictEqual(resolvedPeriod.monthName, "August");

    const { rows: updateResult } = await client.query(`
      SELECT update_withdrawal_atomic(
        $1::TEXT,
        $2::NUMERIC,
        $3::TEXT,
        $4::TEXT,
        $5::TEXT,
        $6::DATE,
        $7::INT,
        $8::INT,
        $9::TEXT
      );
    `, [
      "wd_jerrys_20260801_d00164e8",
      inputPayload.amount,
      inputPayload.status,
      "Completed by Admin",
      "admin_josh",
      resolvedPeriod.effectiveDate,
      resolvedPeriod.year,
      resolvedPeriod.monthNumber,
      resolvedPeriod.monthName
    ]);

    const resJson = updateResult[0].update_withdrawal_atomic;
    assert.strictEqual(resJson.status, "SUCCESS", "update_withdrawal_atomic must succeed");
    assert.strictEqual(resJson.withdrawal_id, "wd_jerrys_20260801_d00164e8");
    assert.strictEqual(resJson.effective_accounting_date, "2026-08-01");
    assert.strictEqual(parseFloat(resJson.available_equity_before), 546135.92);
    pass("2E. Josh's exact August 2026 edit successfully updates to Completed via atomic RPC");

    // 2F. Verify database row state
    const { rows: rowCheck } = await client.query(`
      SELECT *, effective_accounting_date::TEXT as eff_date_str FROM withdrawals WHERE id = 'wd_jerrys_20260801_d00164e8';
    `);
    assert.strictEqual(rowCheck.length, 1, "Exactly one row must exist (single row identity preserved)");
    const updatedRow = rowCheck[0];
    assert.strictEqual(updatedRow.status, "Completed");
    assert.strictEqual(parseFloat(updatedRow.amount), 2500.00);
    assert.strictEqual(updatedRow.eff_date_str, "2026-08-01");
    assert.strictEqual(updatedRow.year, 2026);
    assert.strictEqual(updatedRow.month_number, 8);
    assert.strictEqual(updatedRow.month, "August");
    pass("2F. Database row attributes (effective_accounting_date, year, month_number, month) verified");

    // 2G. Verify Completed withdrawal is financially immutable
    let immutabilityThrew = false;
    try {
      await client.query(`
        SELECT update_withdrawal_atomic(
          'wd_jerrys_20260801_d00164e8',
          2500.00,
          'Pending',
          'Attempt rollback',
          'admin_test'
        );
      `);
    } catch (e) {
      immutabilityThrew = true;
      assert(e.message.includes("INVALID_STATUS_TRANSITION"), "Must throw INVALID_STATUS_TRANSITION");
    }
    assert(immutabilityThrew, "Completed withdrawal cannot transition backwards to Pending");
    pass("2G. Completed withdrawal immutability protection verified");

    // 2H. Test pre-start date edit rejection
    // Insert a test pending row for another account
    await client.query(`
      INSERT INTO withdrawals (
        id, investor_id, account_id, amount, status, effective_accounting_date, request_date, year, month_number
      ) VALUES (
        'wd_test_prestart', 'jerrys001', 'jerrys001', 500.00, 'Pending', DATE '2026-08-01', DATE '2026-08-01', 2026, 8
      );
    `);

    let prestartThrew = false;
    try {
      await client.query(`
        SELECT update_withdrawal_atomic(
          'wd_test_prestart',
          500.00,
          'Approved',
          'Change to January',
          'admin_test',
          DATE '2026-01-01',
          2026,
          1,
          'January'
        );
      `);
    } catch (e) {
      prestartThrew = true;
      assert(e.message.includes("WITHDRAWAL_EXCEEDS_AVAILABLE_EQUITY"), "Must fail closed due to $0.00 available equity at pre-start date");
    }
    assert(prestartThrew, "Editing to pre-start date must fail closed");
    pass("2H. Editing effective date to pre-start boundary fails closed against $0.00 equity");

    // 2I. Test truly insufficient equity rejection
    let excessThrew = false;
    try {
      await client.query(`
        SELECT update_withdrawal_atomic(
          'wd_test_prestart',
          9999999.00,
          'Approved',
          'Excessive amount',
          'admin_test',
          DATE '2026-08-01',
          2026,
          8,
          'August'
        );
      `);
    } catch (e) {
      excessThrew = true;
      assert(e.message.includes("WITHDRAWAL_EXCEEDS_AVAILABLE_EQUITY"), "Must fail when amount exceeds available equity");
    }
    assert(excessThrew, "Excessive amount must fail closed");
    pass("2I. Truly excessive withdrawal amount fails closed");

    // 2J. Test calling with legacy 5 parameters (backwards compatibility)
    const { rows: legacyCallRes } = await client.query(`
      SELECT update_withdrawal_atomic(
        'wd_test_prestart',
        600.00,
        'Pending',
        'Updated note via 5 params',
        'admin_test'
      );
    `);
    const legJson = legacyCallRes[0].update_withdrawal_atomic;
    assert.strictEqual(legJson.status, "SUCCESS");
    assert.strictEqual(parseFloat(legJson.amount), 600.00);
    pass("2J. Backwards compatibility: calling with 5 arguments works without signature ambiguity");

    client.release();
    await pool.end();
  } catch (err) {
    fail("Part 2: Real PostgreSQL Execution", err);
  } finally {
    await pgServer.stop();
  }

  console.log("\n===============================================================================");
  console.log("ALL REGRESSION TESTS PASSED (16 / 16)");
  console.log("===============================================================================\n");
}

runTests().catch(err => {
  console.error("Fatal error running tests:", err);
  process.exit(1);
});
