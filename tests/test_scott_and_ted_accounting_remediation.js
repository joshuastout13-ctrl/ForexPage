import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import fs from "fs";
import path from "path";
import assert from "assert";
import Decimal from "decimal.js";
import { fileURLToPath } from "url";
import { buildInvestorDashboard } from "../lib/dashboard.js";
import { calculateInvestorMonth } from "../lib/accounting-engine.js";
import { calculateAvailableWithdrawalEquity } from "../lib/withdrawal-validation.js";

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

console.log("===============================================================================");
console.log("FOREXPAGE — SCOTT SIRE REMEDIATION & TED BOARDWALK ACCOUNTING TEST SUITE");
console.log("===============================================================================\n");

let passed = 0;
let failed = 0;

function pass(desc) {
  console.log(`✅ PASS: ${desc}`);
  passed++;
}

function fail(desc, err) {
  console.error(`❌ FAIL: ${desc}`);
  console.error(err);
  failed++;
}

async function runSuite() {
  // ===========================================================================
  // PART 1: IN-MEMORY DASHBOARD & ACCOUNTING ENGINE CERTIFICATION
  // ===========================================================================
  console.log("--- PART 1: In-Memory Dashboard & Canonical Month-Opening Verification ---\n");

  try {
    // 1A. Scott Sire May Invariant & General Month-Opening Rule
    const mockScottData = {
      rawInvestors: [{
        id: "inv_f22b8d5d",
        portal_username: "ssire",
        portalusername: "ssire",
        split_pct: 65,
        start_date: "2026-04-01",
        monthly_draw: 0
      }],
      accounts: [{
        id: "ssire",
        investor_id: "inv_f22b8d5d",
        starting_capital: 34310.96,
        open_date: "2026-04-01",
        status: "Active"
      }],
      returnsSheet: [
        { year: 2026, month_number: 4, month: "April", gross_return_pct: 3.15, locked: true },
        { year: 2026, month_number: 5, month: "May", gross_return_pct: 3.31, locked: true },
        { year: 2026, month_number: 6, month: "June", gross_return_pct: 3.67, locked: true },
        { year: 2026, month_number: 7, month: "July", gross_return_pct: 3.13, locked: true },
        { year: 2026, month_number: 8, month: "August", gross_return_pct: 3.03, locked: true },
        { year: 2026, month_number: 9, month: "September", gross_return_pct: 0.19, locked: false }
      ],
      depositsSheet: [],
      withdrawalsSheet: [
        // Completed May withdrawal
        {
          id: "wd_completed_may_ssire",
          investor_id: "inv_f22b8d5d",
          amount: 25000.00,
          status: "Completed",
          effective_accounting_date: "2026-05-01",
          year: 2026,
          month_number: 5
        },
        // Cancelled orphaned pending row
        {
          id: "wd_pending_may_ssire",
          investor_id: "inv_f22b8d5d",
          amount: 25000.00,
          status: "Cancelled",
          effective_accounting_date: "2026-05-01",
          year: 2026,
          month_number: 5
        }
      ],
      historyTable: [
        {
          investor_id: "inv_f22b8d5d",
          year: 2026,
          month_number: 4,
          opening_balance: 34310.96,
          deposits: 0,
          withdrawals: 0,
          gross_return_pct: 3.15,
          ending_balance: 35013.48,
          manual_gain_amount: 702.52
        }
      ],
      commissionEarningsTable: [],
      commissionSharesTable: [],
      commissionRulesTable: [],
      cutoverAdjustments: [],
      live: { source: "Live_Performance", today: 0, week: 0, month: 0, year: 0 },
      asOfDate: "2026-09-05"
    };

    const scottDash = await buildInvestorDashboard("ssire", mockScottData);
    const mayRow = scottDash.breakdown.find(r => r.monthNumber === 5);
    const sepRow = scottDash.breakdown.find(r => r.monthNumber === 9);

    assert(mayRow, "Scott Sire May row must exist");
    // April ending was 35,013.48. May starting capital = 35,013.48 - 25,000 = 10,013.48
    assert.strictEqual(mayRow.adjustedStartingBalance, 10013.48, "May return-eligible capital must be exactly $10,013.48");
    assert.strictEqual(mayRow.oneTimeWithdrawal, 25000.00, "May Completed withdrawal must be $25,000.00");
    assert.strictEqual(mayRow.pendingWithdrawal, 0.00, "May Pending withdrawal must be 0 (cancelled row excluded)");
    assert.strictEqual(Math.round(mayRow.gain * 100) / 100, 215.44, "May net trading gain must be $215.44 on $10,013.48 capital");
    assert.strictEqual(Math.round(mayRow.endingBalance * 100) / 100, 10228.92, "May ending balance must be $10,228.92");
    pass("1A. Scott Sire May starting capital ($10,013.48) and gain ($215.44) verified under general rule");

    // Check available equity validation for Scott
    const scottEq = await calculateAvailableWithdrawalEquity("inv_f22b8d5d", "2026-09-01", {
      rawInvestors: mockScottData.rawInvestors,
      accounts: mockScottData.accounts,
      historyTable: [{ investor_id: "inv_f22b8d5d", year: 2026, month_number: 8, ending_balance: 10896.46 }],
      withdrawalsSheet: mockScottData.withdrawalsSheet
    });
    assert.strictEqual(scottEq.availableEquity, 10896.46, "Scott Sire September available equity must be full $10,896.46 (pending row released)");
    pass("1B. Scott Sire available equity is fully restored to $10,896.46 when Pending row is Cancelled");

    // 1C. Ted Boardwalk September 1 $0 Cutover Position
    const mockTedData = {
      rawInvestors: [{
        id: "inv_a79798ca",
        portal_username: "tboardwalk",
        portalusername: "tboardwalk",
        split_pct: 66.60,
        start_date: "2026-01-01",
        monthly_draw: 0
      }],
      accounts: [{
        id: "tboardwalk",
        investor_id: "inv_a79798ca",
        starting_capital: 0.00,
        open_date: "2026-01-01",
        is_commission: true,
        status: "Active"
      }],
      returnsSheet: [
        { year: 2026, month_number: 7, month: "July", gross_return_pct: 3.13, locked: true },
        { year: 2026, month_number: 8, month: "August", gross_return_pct: 2.81, locked: true },
        { year: 2026, month_number: 9, month: "September", gross_return_pct: 0.19, locked: false }
      ],
      depositsSheet: [],
      withdrawalsSheet: [
        // Historical June withdrawal preserved
        { id: "wd_june_ted", investor_id: "inv_a79798ca", amount: 5000.00, status: "Completed", effective_accounting_date: "2026-06-01", year: 2026, month_number: 6 }
      ],
      historyTable: [
        { investor_id: "inv_a79798ca", year: 2026, month_number: 7, opening_balance: 17.19, deposits: 0, withdrawals: 0, gross_return_pct: 3.13, ending_balance: 17.55 },
        { investor_id: "inv_a79798ca", year: 2026, month_number: 8, opening_balance: 384.56, deposits: 0, withdrawals: 0, gross_return_pct: 0.00, ending_balance: 384.56 },
        { investor_id: "inv_a79798ca", year: 2026, month_number: 9, opening_balance: 0.00, deposits: 0, withdrawals: 0, gross_return_pct: 0.00, ending_balance: 0.00, is_manual: true }
      ],
      commissionEarningsTable: [
        { recipient_id: "inv_a79798ca", year: 2026, month_number: 7, amount: 367.01 }
      ],
      commissionSharesTable: [],
      commissionRulesTable: [],
      cutoverAdjustments: [
        { investor_id: "inv_a79798ca", year: 2026, month_number: 7, authorized_opening_balance: 17.19 },
        { investor_id: "inv_a79798ca", year: 2026, month_number: 9, authorized_opening_balance: 0.00 }
      ],
      live: { source: "Live_Performance", today: 0, week: 0, month: 0, year: 0 },
      asOfDate: "2026-09-05"
    };

    const tedDash = await buildInvestorDashboard("tboardwalk", mockTedData);
    const tedSepRow = tedDash.breakdown.find(r => r.monthNumber === 9);

    assert(tedSepRow, "Ted Boardwalk September row must exist");
    assert.strictEqual(tedSepRow.startingBalance, 0.00, "Ted Boardwalk September starting balance must be $0.00 per cutover reset");
    assert.strictEqual(tedSepRow.adjustedStartingBalance, 0.00, "Ted Boardwalk September adjusted starting balance must be $0.00");
    assert.strictEqual(tedSepRow.gain, 0.00, "Ted Boardwalk September gain must be $0.00");
    assert.strictEqual(tedSepRow.endingBalance, 0.00, "Ted Boardwalk September ending balance must be $0.00");
    pass("1C. Ted Boardwalk September 1 reset to $0.00 verified in dashboard");

    // 1D. Ted Boardwalk Available Equity via JS Validator
    const tedEq = await calculateAvailableWithdrawalEquity("inv_a79798ca", "2026-09-01", {
      rawInvestors: mockTedData.rawInvestors,
      accounts: mockTedData.accounts,
      historyTable: mockTedData.historyTable,
      cutoverAdjustments: mockTedData.cutoverAdjustments,
      withdrawalsSheet: []
    });
    assert.strictEqual(tedEq.availableEquity, 0.00, "Ted Boardwalk September available equity must be $0.00 under cutover reset");
    pass("1D. Ted Boardwalk available equity evaluates strictly to $0.00 via cutover awareness");

    // 1E. General Accounting Engine Formula Verification
    const calcResult = calculateInvestorMonth({
      year: 2026,
      month: 8,
      investorId: "test_investor",
      priorEndingBalance: 100000.00,
      deposits: 15000.00,
      withdrawals: 5000.00,
      priorMonthIncomingCommissions: 2000.00,
      fundReturnPct: 3.00,
      sourceSplitPct: 100.00
    });
    // Month Opening Base = 100,000 + 2,000 = 102,000
    // Month Starting / Eligible Capital = 102,000 + 15,000 - 5,000 = 112,000
    assert.strictEqual(calcResult.openingBalance, 102000.00, "Opening balance base is prior ending + prior commissions ($102,000.00)");
    assert.strictEqual(calcResult.startingBalance, 112000.00, "Starting balance is opening base + deposits - withdrawals ($112,000.00)");
    assert.strictEqual(calcResult.eligibleCapital, 112000.00, "Eligible capital equals starting balance ($112,000.00)");
    assert.strictEqual(calcResult.grossFundResult, 3360.00, "Gross return is 3.00% on $112,000.00 = $3,360.00");
    assert.strictEqual(calcResult.endingBalance, 115360.00, "Ending balance is $112,000.00 + $3,360.00 = $115,360.00");
    pass("1E. Pure accounting engine calculateInvestorMonth conforms to Josh's general month-opening formula");

  } catch (err) {
    fail("Part 1 in-memory verification", err);
  }

  // ===========================================================================
  // PART 2: NATIVE POSTGRESQL 18.4 PRODUCTION MIGRATION VERIFICATION
  // ===========================================================================
  console.log("\n--- PART 2: Native PostgreSQL 18.4 Production Migration Test ---\n");

  const port = 54335;
  const dbName = "postgres";
  const user = "postgres";
  const password = "postgrespassword";

  if (fs.existsSync("data/db")) {
    try {
      fs.rmSync("data/db", { recursive: true, force: true });
    } catch (e) {}
  }

  const server = new EmbeddedPostgres({
    port,
    user,
    password,
    database: dbName
  });

  try {
    console.log("Starting native PostgreSQL on port " + port + "...");
    await server.initialise();
    await server.start();
    pass("2A. Native PostgreSQL 18.4 started");

    const pool = new Pool({
      host: "127.0.0.1",
      port,
      user,
      password,
      database: dbName
    });

    const client = await pool.connect();

    // Setup Schema matching Production Supabase
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
        notes TEXT,
        updated_by TEXT,
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

      CREATE OR REPLACE FUNCTION update_withdrawal_atomic(
        p_withdrawal_id TEXT,
        p_amount NUMERIC DEFAULT NULL,
        p_status TEXT DEFAULT NULL,
        p_notes TEXT DEFAULT NULL,
        p_updated_by TEXT DEFAULT NULL
      )
      RETURNS JSONB
      LANGUAGE plpgsql
      SECURITY DEFINER
      AS $$
      DECLARE
        v_current_wd RECORD;
        v_lock_key BIGINT;
        v_target_amount NUMERIC(20, 2);
        v_target_status TEXT;
      BEGIN
        SELECT * INTO v_current_wd FROM withdrawals WHERE id = p_withdrawal_id FOR UPDATE;
        IF v_current_wd.id IS NULL THEN
          RAISE EXCEPTION 'WITHDRAWAL_NOT_FOUND: Withdrawal % does not exist.', p_withdrawal_id;
        END IF;

        v_lock_key := financial_lock_key(v_current_wd.investor_id);
        PERFORM pg_advisory_xact_lock(v_lock_key);

        v_target_amount := COALESCE(p_amount, v_current_wd.amount);
        v_target_status := COALESCE(p_status, v_current_wd.status);

        UPDATE withdrawals
        SET amount = v_target_amount,
            status = v_target_status,
            notes = COALESCE(p_notes, notes),
            updated_by = COALESCE(p_updated_by, updated_by),
            updated_at = NOW()
        WHERE id = p_withdrawal_id;

        RETURN jsonb_build_object(
          'status', 'SUCCESS',
          'withdrawal', jsonb_build_object(
            'id', p_withdrawal_id,
            'amount', v_target_amount,
            'status', v_target_status
          )
        );
      END;
      $$;
    `);

    // Load PostgreSQL calculate_available_withdrawal_equity_sql from migration file
    const eqMigration = fs.readFileSync(
      path.join(__dirname, "../scripts/migrations/20260911_fix_start_date_conflict_validation.sql"),
      "utf8"
    );
    await client.query(eqMigration);
    pass("2B. Schema and Package B functions installed successfully");

    // Seed production baseline state
    await client.query(`
      -- Investors
      INSERT INTO investors (id, portal_username, start_date, split_pct) VALUES
        ('jerrys001', 'jerrys', '2026-05-01', 100.00),
        ('inv_4c5c0ee6', 'mharris', '2026-05-01', 100.00),
        ('inv_f22b8d5d', 'ssire', '2026-04-01', 65.00),
        ('inv_a79798ca', 'tboardwalk', '2026-01-01', 66.60);

      -- Accounts
      INSERT INTO investor_accounts (id, investor_id, starting_capital, open_date) VALUES
        ('jerrys001', 'jerrys001', 500000.00, '2026-05-01'),
        ('mharris', 'inv_4c5c0ee6', 1000000.00, '2026-05-01'),
        ('acc_ssire', 'inv_f22b8d5d', 34310.96, '2026-04-01'),
        ('tboardwalk', 'inv_a79798ca', -1477.23, '2026-01-01');

      -- Jerry August Completed
      INSERT INTO withdrawals (id, investor_id, amount, status, effective_accounting_date, year, month_number) VALUES
        ('wd_jerry_aug', 'jerrys001', 2500.00, 'Completed', DATE '2026-08-01', 2026, 8);

      -- Mary Jo September Completed
      INSERT INTO withdrawals (id, investor_id, amount, status, effective_accounting_date, year, month_number) VALUES
        ('wd_maryjo_sep', 'inv_4c5c0ee6', 21000.00, 'Completed', DATE '2026-09-01', 2026, 9);

      -- Other 10 September Batch Completed rows (total 11 rows = $167,258.30)
      INSERT INTO withdrawals (id, investor_id, amount, status, effective_accounting_date, year, month_number) VALUES
        ('wd_b1', 'jerrys001', 5000.00, 'Completed', DATE '2026-09-01', 2026, 9),
        ('wd_b2', 'jerrys001', 21500.00, 'Completed', DATE '2026-09-01', 2026, 9),
        ('wd_b4', 'jerrys001', 2000.00, 'Completed', DATE '2026-09-01', 2026, 9),
        ('wd_b5', 'jerrys001', 1697.33, 'Completed', DATE '2026-09-01', 2026, 9),
        ('wd_b6', 'jerrys001', 3000.00, 'Completed', DATE '2026-09-01', 2026, 9),
        ('wd_b7', 'jerrys001', 150.00, 'Completed', DATE '2026-09-01', 2026, 9),
        ('wd_b8', 'jerrys001', 7000.00, 'Completed', DATE '2026-09-01', 2026, 9),
        ('wd_b9', 'jerrys001', 20000.00, 'Completed', DATE '2026-09-01', 2026, 9),
        ('wd_b10', 'jerrys001', 76910.97, 'Completed', DATE '2026-09-01', 2026, 9),
        ('wd_b11', 'jerrys001', 9000.00, 'Completed', DATE '2026-09-01', 2026, 9);

      -- Scott Sire May DUAL records (1 Completed, 1 Pending)
      INSERT INTO withdrawals (id, investor_id, amount, status, effective_accounting_date, year, month_number) VALUES
        ('wd_completed_may_ssire', 'inv_f22b8d5d', 25000.00, 'Completed', DATE '2026-05-01', 2026, 5),
        ('wd_pending_may_ssire', 'inv_f22b8d5d', 25000.00, 'Pending', DATE '2026-05-01', 2026, 5);

      -- Scott History
      INSERT INTO investor_monthly_history (investor_id, year, month_number, ending_balance) VALUES
        ('inv_f22b8d5d', 2026, 4, 35013.48),
        ('inv_f22b8d5d', 2026, 8, 10896.46);

      -- Ted Boardwalk July cutover + history
      INSERT INTO account_cutover_adjustments (investor_id, year, month_number, effective_date, authorized_opening_balance, prior_rollforward_balance, reason, authorization_reference) VALUES
        ('inv_a79798ca', 2026, 7, DATE '2026-07-01', 17.19, -2041.68, 'July 1 reset', 'JOSH_JULY_RESET');

      INSERT INTO investor_monthly_history (investor_id, year, month_number, ending_balance) VALUES
        ('inv_a79798ca', 2026, 8, 384.56);
    `);
    pass("2C. Baseline test fixtures seeded");

    // Check pre-migration available equity
    const { rows: preScott } = await client.query("SELECT calculate_available_withdrawal_equity_sql('inv_f22b8d5d', 'acc_ssire', DATE '2026-05-01') AS eq;");
    // Scott had 35013.48 prior ending - 50000 active withdrawals (25k pending + 25k completed) = 0.00
    assert.strictEqual(Number(preScott[0].eq), 0.00, "Scott Sire May equity before migration reserves $50,000 and is $0.00");

    const { rows: preTed } = await client.query("SELECT calculate_available_withdrawal_equity_sql('inv_a79798ca', 'tboardwalk', DATE '2026-09-01') AS eq;");
    assert.strictEqual(Number(preTed[0].eq), 384.56, "Ted Boardwalk September equity before migration is $384.56");
    pass("2D. Pre-migration equity verified (Scott defect: $50,000 reserved; Ted: $384.56 available)");

    // Execute the exact production migration script
    const migrationSql = fs.readFileSync(
      path.join(__dirname, "../scripts/migrations/20260915_scott_sire_remediation_and_ted_boardwalk_reset.sql"),
      "utf8"
    );
    await client.query(migrationSql);
    pass("2E. Execution script 20260915_scott_sire_remediation_and_ted_boardwalk_reset.sql executed cleanly");

    // Check post-migration Scott Sire state
    const { rows: postScottWds } = await client.query("SELECT id, status, amount FROM withdrawals WHERE investor_id = 'inv_f22b8d5d' ORDER BY status;");
    assert.strictEqual(postScottWds.length, 2, "Scott Sire must still have exactly 2 withdrawal records (audit trail preserved)");
    const cancelledRow = postScottWds.find(w => w.id === 'wd_pending_may_ssire');
    const completedRow = postScottWds.find(w => w.id === 'wd_completed_may_ssire');
    assert.strictEqual(cancelledRow.status, 'Cancelled', "wd_pending_may_ssire must be transitioned to Cancelled");
    assert.strictEqual(completedRow.status, 'Completed', "wd_completed_may_ssire must remain Completed");

    const { rows: postScottEq } = await client.query("SELECT calculate_available_withdrawal_equity_sql('inv_f22b8d5d', 'acc_ssire', DATE '2026-05-01') AS eq;");
    // 35,013.48 prior ending - 25,000 completed = 10,013.48 available equity!
    assert.strictEqual(Number(postScottEq[0].eq), 10013.48, "Scott Sire May available equity releases $25,000 to exactly $10,013.48");
    pass("2F. Scott Sire: Cancelled status recorded, $25,000 equity reservation released");

    // Check post-migration Ted Boardwalk state
    const { rows: tedCutovers } = await client.query("SELECT * FROM account_cutover_adjustments WHERE investor_id = 'inv_a79798ca' AND year = 2026 AND month_number = 9;");
    assert.strictEqual(tedCutovers.length, 1, "Ted Boardwalk September cutover adjustment record exists");
    assert.strictEqual(Number(tedCutovers[0].authorized_opening_balance), 0.00, "September cutover opening balance is strictly $0.00");
    assert.strictEqual(Number(tedCutovers[0].prior_rollforward_balance), 384.56, "Prior rollforward recorded as $384.56");

    const { rows: tedHist } = await client.query("SELECT * FROM investor_monthly_history WHERE investor_id = 'inv_a79798ca' AND year = 2026 AND month_number = 9;");
    assert.strictEqual(tedHist.length, 1, "Ted Boardwalk September history record exists");
    assert.strictEqual(Number(tedHist[0].opening_balance), 0.00, "September history opening is $0.00");
    assert.strictEqual(Number(tedHist[0].ending_balance), 0.00, "September history ending is $0.00");

    const { rows: tedAcc } = await client.query("SELECT is_commission, starting_capital FROM investor_accounts WHERE investor_id = 'inv_a79798ca';");
    assert.strictEqual(tedAcc[0].is_commission, true, "Ted account is marked is_commission = true");
    assert.strictEqual(Number(tedAcc[0].starting_capital), 0.00, "Ted account starting capital is $0.00");

    const { rows: postTedEq } = await client.query("SELECT calculate_available_withdrawal_equity_sql('inv_a79798ca', 'tboardwalk', DATE '2026-09-01') AS eq;");
    assert.strictEqual(Number(postTedEq[0].eq), 0.00, "Ted Boardwalk September available equity evaluates strictly to $0.00 via cutover");
    pass("2G. Ted Boardwalk: September 1 $0.00 cutover baseline and commission-only status verified");

    // Verify Jerry, Mary Jo, and September batch intact
    const { rows: jerryCheck } = await client.query("SELECT COUNT(*) FROM withdrawals WHERE investor_id = 'jerrys001' AND effective_accounting_date = DATE '2026-08-01' AND status = 'Completed';");
    assert.strictEqual(Number(jerryCheck[0].count), 1, "Jerry August completed withdrawal intact");

    const { rows: maryJoCheck } = await client.query("SELECT COUNT(*) FROM withdrawals WHERE investor_id = 'inv_4c5c0ee6' AND effective_accounting_date = DATE '2026-09-01' AND status = 'Completed';");
    assert.strictEqual(Number(maryJoCheck[0].count), 1, "Mary Jo September completed withdrawal intact");

    const { rows: batchCheck } = await client.query("SELECT COUNT(*), SUM(amount) FROM withdrawals WHERE effective_accounting_date = DATE '2026-09-01' AND status = 'Completed';");
    assert.strictEqual(Number(batchCheck[0].count), 11, "September batch count strictly 11");
    assert.strictEqual(Number(batchCheck[0].sum), 167258.30, "September batch sum strictly $167,258.30");
    pass("2H. Absolute protection certified: Jerry, Mary Jo, and September batch 100% untouched");

    await client.release();
    await pool.end();
    await server.stop();
    pass("2I. Native PostgreSQL server stopped cleanly");

  } catch (err) {
    fail("Part 2 native PostgreSQL migration test", err);
    try { await server.stop(); } catch (e) {}
  }

  // ===========================================================================
  // SUMMARY
  // ===========================================================================
  console.log("\n===============================================================================");
  console.log(`TEST SUMMARY: ${passed} PASSED / ${failed} FAILED`);
  console.log("===============================================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runSuite();
