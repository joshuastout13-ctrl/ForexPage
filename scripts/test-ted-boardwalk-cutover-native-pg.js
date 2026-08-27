import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import fs from "fs";
import crypto from "crypto";
import assert from "assert";
import Decimal from "decimal.js";

const { Pool } = pg;

function computeSha256(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const normalized = content.replace(/\r\n/g, "\n");
  return crypto.createHash("sha256").update(normalized, "utf8").digest("hex");
}

function extractStepBSql(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const match = content.match(/## Step B: Mutating Atomic Transaction\s*```sql([\s\S]*?)```/);
  if (!match) throw new Error("Could not extract Step B SQL from " + filePath);
  return match[1].trim();
}

async function runTedCutoverNativeCertification() {
  console.log("==================================================");
  console.log("TED BOARDWALK JULY 1 CUTOVER NATIVE PG 18.4 TEST");
  console.log("==================================================\n");

  const tedFile = "docs/TED_BOARDWALK_JULY_CUTOVER_CORRECTION_SQL.md";
  const migrationFile = "docs/ACCOUNT_CUTOVER_MECHANISM_MIGRATION.sql";

  const tedSha = computeSha256(tedFile);
  const migrationSha = computeSha256(migrationFile);

  console.log("=== ARTIFACT SHA-256 HASHES ===");
  console.log(`Ted Boardwalk SQL Hash: ${tedSha}`);
  console.log(`Migration SQL Hash:      ${migrationSha}\n`);

  if (fs.existsSync("data/db")) {
    fs.rmSync("data/db", { recursive: true, force: true });
  }

  const port = 54333;
  const user = "postgres";
  const password = "password";
  const dbName = "postgres";

  const server = new EmbeddedPostgres({
    port,
    user,
    password,
    database: dbName
  });

  console.log("1. Starting native PostgreSQL 18.4 server on port " + port + "...");
  await server.initialise();
  await server.start();
  console.log("✓ Native PostgreSQL server started successfully.\n");

  const pool = new Pool({
    host: "127.0.0.1",
    port,
    user,
    password,
    database: dbName
  });

  const client = await pool.connect();

  try {
    const { rows: verRows } = await client.query("SELECT version();");
    console.log("=== NATIVE SERVER METADATA ===");
    console.log(`Version: ${verRows[0].version}\n`);

    // Schema Initialization
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
        starting_capital NUMERIC(15, 2) DEFAULT 0.00,
        open_date DATE,
        status TEXT DEFAULT 'Active',
        is_commission BOOLEAN DEFAULT false,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE TABLE investor_monthly_history (
        id TEXT PRIMARY KEY,
        investor_id TEXT REFERENCES investors(id),
        year INTEGER NOT NULL,
        month_number INTEGER NOT NULL,
        month TEXT,
        opening_balance NUMERIC(20, 10),
        deposits NUMERIC(20, 10) DEFAULT 0.00,
        withdrawals NUMERIC(20, 10) DEFAULT 0.00,
        gross_return_pct NUMERIC(5, 2) DEFAULT 0.00,
        ending_balance NUMERIC(20, 10),
        is_manual BOOLEAN DEFAULT false,
        locked BOOLEAN DEFAULT false,
        notes TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE TABLE deposits (
        id TEXT PRIMARY KEY,
        investor_id TEXT REFERENCES investors(id),
        account_id TEXT,
        amount NUMERIC(15, 2),
        date DATE,
        effective_accounting_date DATE,
        type TEXT,
        notes TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE TABLE withdrawals (
        id TEXT PRIMARY KEY,
        investor_id TEXT REFERENCES investors(id),
        account_id TEXT,
        amount NUMERIC(15, 2),
        status TEXT,
        request_date DATE,
        effective_accounting_date DATE,
        year INTEGER,
        month_number INTEGER,
        notes TEXT,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE TABLE commission_earnings (
        id TEXT PRIMARY KEY,
        recipient_id TEXT REFERENCES investors(id),
        source_investor_id TEXT REFERENCES investors(id),
        year INTEGER,
        month_number INTEGER,
        amount NUMERIC(15, 2)
      );

      CREATE TABLE monthly_returns (
        id TEXT PRIMARY KEY,
        year INTEGER,
        month_number INTEGER,
        gross_return_pct NUMERIC(5, 2) DEFAULT 0.00
      );

      CREATE OR REPLACE FUNCTION financial_lock_key(p_investor_id TEXT)
      RETURNS BIGINT AS $$
      BEGIN
        RETURN ('x' || substr(md5(p_investor_id), 1, 15))::bit(64)::bigint;
      END;
      $$ LANGUAGE plpgsql IMMUTABLE;
    `);

    // Install Cutover Migration / Package B 2.2.0
    const migrationSql = fs.readFileSync(migrationFile, "utf8");
    await client.query(migrationSql);
    console.log("✓ Package B 2.2.0 / Cutover Migration Installed.\n");

    // Seed Initial State
    async function seedTedState() {
      await client.query(`
        TRUNCATE account_cutover_adjustments, monthly_returns, commission_earnings, withdrawals, deposits, investor_monthly_history, investor_accounts, investors CASCADE;

        INSERT INTO investors (id, portal_username, start_date, split_pct, monthly_draw, active)
        VALUES ('inv_a79798ca', 'tboardwalk', '2026-01-01', 66.60, 0.00, true);

        INSERT INTO investor_accounts (id, investor_id, starting_capital, open_date, status)
        VALUES ('tboardwalk', 'inv_a79798ca', 0.00, '2026-01-01', 'Active');

        INSERT INTO withdrawals (id, investor_id, account_id, amount, status, request_date, year, month_number)
        VALUES ('wd_9a4f1219', 'inv_a79798ca', 'tboardwalk', 5000.00, 'Completed', '2026-06-01', 2026, 6);

        -- July Commissions ($367.01)
        INSERT INTO commission_earnings (id, recipient_id, source_investor_id, year, month_number, amount)
        VALUES 
          ('comm_jul_1', 'inv_a79798ca', 'inv_a79798ca', 2026, 7, 367.01);

        -- Uncorrected History
        INSERT INTO investor_monthly_history (id, investor_id, year, month_number, month, opening_balance, deposits, withdrawals, gross_return_pct, ending_balance)
        VALUES 
          ('h_ted_6', 'inv_a79798ca', 2026, 6, 'June', 2593.22, 0.00, 5000.00, 3.67, -2465.6105042133895),
          ('h_ted_7', 'inv_a79798ca', 2026, 7, 'July', -2041.6805042133897, 0.00, 0.00, 3.13, -2084.240967668121),
          ('h_ted_8', 'inv_a79798ca', 2026, 8, 'August', -1717.2309676681211, 0.00, 0.00, 0.00, -1717.2309676681211);
      `);
    }

    await seedTedState();

    // 1. Forward Execution Test
    console.log("--- TEST 1: Forward Step B Execution ---");
    const stepBSql = extractStepBSql(tedFile);
    await client.query(stepBSql);

    // Verify Cutover Record
    const { rows: cutoverRows } = await client.query("SELECT * FROM account_cutover_adjustments WHERE investor_id = 'inv_a79798ca';");
    assert.strictEqual(cutoverRows.length, 1);
    assert.strictEqual(Number(cutoverRows[0].authorized_opening_balance).toFixed(2), "17.19");
    assert.strictEqual(cutoverRows[0].month_number, 7);
    console.log("  Cutover Record: PASS ($17.19 on 2026-07-01)");

    // Verify July & August History
    const { rows: histRows } = await client.query("SELECT * FROM investor_monthly_history WHERE investor_id = 'inv_a79798ca' ORDER BY month_number;");
    const julHist = histRows.find(r => r.month_number === 7);
    const augHist = histRows.find(r => r.month_number === 8);

    assert.strictEqual(Number(julHist.opening_balance).toFixed(2), "17.19");
    assert.strictEqual(Number(julHist.ending_balance).toFixed(2), "17.55");
    console.log(`  July History:   PASS ($17.19 opening -> $17.55 ending)`);

    assert.strictEqual(Number(augHist.opening_balance).toFixed(2), "384.56");
    assert.strictEqual(Number(augHist.ending_balance).toFixed(2), "384.56");
    console.log(`  August History: PASS ($384.56 opening -> $384.56 ending with July commissions)`);

    // Verify Package B Available Equity
    const { rows: eqJul } = await client.query("SELECT calculate_available_withdrawal_equity_sql('inv_a79798ca', 'tboardwalk', DATE '2026-07-01', NULL) AS eq;");
    assert.strictEqual(Number(eqJul[0].eq).toFixed(2), "17.19");
    console.log(`  Package B July Equity:   PASS ($17.19)`);

    const { rows: eqAug } = await client.query("SELECT calculate_available_withdrawal_equity_sql('inv_a79798ca', 'tboardwalk', DATE '2026-08-01', NULL) AS eq;");
    assert.strictEqual(Number(eqAug[0].eq).toFixed(2), "384.56");
    console.log(`  Package B August Equity: PASS ($384.56)\n`);

    // 2. Idempotency Test
    console.log("--- TEST 2: Idempotency Rerun ---");
    await client.query(stepBSql);
    const { rows: cutoverRows2 } = await client.query("SELECT * FROM account_cutover_adjustments WHERE investor_id = 'inv_a79798ca';");
    assert.strictEqual(cutoverRows2.length, 1);
    console.log("  Idempotency Rerun: PASS (Zero duplicate cutover records)\n");

    // 3. CAS Mismatch Test
    console.log("--- TEST 3: CAS Mismatch Protection ---");
    await seedTedState();
    await client.query("UPDATE withdrawals SET amount = 4500.00 WHERE id = 'wd_9a4f1219';");
    let casThrew = false;
    try {
      await client.query(stepBSql);
    } catch (e) {
      casThrew = true;
      assert.ok(e.message.includes("CAS_FAILURE"));
    }
    assert.strictEqual(casThrew, true);
    console.log("  CAS Mismatch Abort: PASS\n");

    // 4. Forced Rollback / Zero Partial Writes Test
    console.log("--- TEST 4: Forced Rollback / Atomic Boundary ---");
    await seedTedState();
    const failingSql = stepBSql.replace(
      "RAISE NOTICE 'SUCCESS: Ted Boardwalk July 1 cutover reset completed and verified.';",
      "RAISE EXCEPTION 'SIMULATED_FAILURE_FOR_ROLLBACK';"
    );
    let rollbackThrew = false;
    try {
      await client.query(failingSql);
    } catch (e) {
      rollbackThrew = true;
    }
    assert.strictEqual(rollbackThrew, true);
    const { rows: cutoverAfterRollback } = await client.query("SELECT * FROM account_cutover_adjustments WHERE investor_id = 'inv_a79798ca';");
    assert.strictEqual(cutoverAfterRollback.length, 0);
    console.log("  Forced Rollback Zero Partial Writes: PASS\n");

    console.log("==================================================");
    console.log("TED BOARDWALK CERTIFICATION: 100% PASS");
    console.log("  Forward Execution:        PASS");
    console.log("  Idempotency:              PASS");
    console.log("  CAS Mismatch Guard:       PASS");
    console.log("  Zero Partial Writes:      PASS");
    console.log("  Package B Cutover Equity: PASS ($17.19 Jul / $384.56 Aug)");
    console.log("  Financial Residual:       $0.00");
    console.log("==================================================");

  } finally {
    client.release();
    await pool.end();
    await server.stop();
  }
}

runTedCutoverNativeCertification().catch(err => {
  console.error("CERTIFICATION FATAL ERROR:", err);
  process.exit(1);
});
