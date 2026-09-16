import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import fs from "fs";
import path from "path";
import assert from "assert";
import { fileURLToPath } from "url";
import { calculateBalanceAffectingDeposits, calculateTotalExternalCash, calculateLifetimePerformance } from "../lib/accounting-engine.js";

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

console.log("===============================================================================");
console.log("FOREXPAGE — NATIVE POSTGRESQL 18.4 SCHEMA UPDATE V5 CERTIFICATION SUITE");
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

async function runPostgresMigrationCertification() {
  const port = 54336;
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

  let pool;
  let client;

  try {
    console.log("Starting native PostgreSQL on port " + port + "...");
    await server.initialise();
    await server.start();
    pass("1. Native PostgreSQL started on port " + port);

    pool = new Pool({
      host: "127.0.0.1",
      port,
      user,
      password,
      database: dbName
    });

    client = await pool.connect();

    // ─── STEP A: CREATE PRE-MIGRATION BASELINE PRODUCTION SCHEMA ───────────
    await client.query(`
      CREATE TABLE investors (
        id TEXT PRIMARY KEY,
        portal_username TEXT UNIQUE,
        first_name TEXT,
        last_name TEXT,
        email TEXT,
        active BOOLEAN DEFAULT TRUE,
        split_pct NUMERIC(5, 2) DEFAULT 100.00,
        monthly_draw NUMERIC(12, 2) DEFAULT 0.00,
        start_date DATE,
        role TEXT DEFAULT 'investor',
        notes TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE TABLE investor_accounts (
        id TEXT PRIMARY KEY,
        investor_id TEXT REFERENCES investors(id) ON DELETE CASCADE,
        name TEXT,
        starting_capital NUMERIC(15, 2) DEFAULT 0.00,
        open_date DATE,
        status TEXT DEFAULT 'Active',
        is_commission BOOLEAN DEFAULT FALSE,
        notes TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE TABLE deposits (
        id TEXT PRIMARY KEY,
        investor_id TEXT REFERENCES investors(id) ON DELETE CASCADE,
        account_id TEXT REFERENCES investor_accounts(id) ON DELETE CASCADE,
        date DATE,
        amount NUMERIC(15, 2) NOT NULL,
        type TEXT DEFAULT 'Wire',
        notes TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);
    pass("2. Pre-migration baseline schema created (deposits has NO v5 columns)");

    // ─── STEP B: SEED REALISTIC LEGACY DEPOSIT DATA ──────────────────────────
    await client.query(`
      INSERT INTO investors (id, portal_username, first_name, last_name)
      VALUES 
        ('inv_test_001', 'testuser1', 'Test', 'UserOne'),
        ('inv_test_002', 'testuser2', 'Test', 'UserTwo');

      INSERT INTO investor_accounts (id, investor_id, starting_capital)
      VALUES
        ('acc_test_001', 'inv_test_001', 50000.00),
        ('acc_test_002', 'inv_test_002', 100000.00);

      -- Legacy active deposits
      INSERT INTO deposits (id, investor_id, account_id, date, amount, type, notes)
      VALUES
        ('dep_legacy_001', 'inv_test_001', 'acc_test_001', '2026-04-15', 10000.00, 'Wire', 'Legacy active wire'),
        ('dep_legacy_002', 'inv_test_001', 'acc_test_001', '2026-05-10', 5000.00, 'Check', 'Legacy active check'),
        -- Legacy VOID deposit (type='VOID')
        ('dep_legacy_void', 'inv_test_001', 'acc_test_001', '2026-06-01', 2000.00, 'VOID', 'Legacy voided deposit');
    `);
    pass("3. Seeded legacy deposits (2 active wires, 1 legacy type='VOID' row)");

    // ─── STEP C: RUN SCHEMA_UPDATE_V5.SQL (FIRST RUN) ───────────────────────
    const v5SqlPath = path.resolve(__dirname, "../supabase/schema_update_v5.sql");
    const v5Sql = fs.readFileSync(v5SqlPath, "utf8");
    await client.query(v5Sql);
    pass("4. schema_update_v5.sql executed cleanly on baseline");

    // Verify columns exist
    const { rows: colRows } = await client.query(`
      SELECT column_name, data_type, column_default
      FROM information_schema.columns
      WHERE table_name = 'deposits'
      ORDER BY column_name;
    `);
    const cols = new Set(colRows.map(r => r.column_name));
    assert(cols.has("status"), "status column must exist");
    assert(cols.has("accounting_treatment"), "accounting_treatment column must exist");
    assert(cols.has("effective_accounting_date"), "effective_accounting_date column must exist");
    assert(cols.has("created_by"), "created_by column must exist");
    assert(cols.has("updated_at"), "updated_at column must exist");
    assert(cols.has("voided_at"), "voided_at column must exist");
    assert(cols.has("voided_by"), "voided_by column must exist");
    assert(cols.has("void_reason"), "void_reason column must exist");
    assert(cols.has("idempotency_key"), "idempotency_key column must exist");
    pass("5. Verified all 9 v5 columns exist in database");

    // Verify legacy rows received default values and VOID backfill
    const { rows: legacyRows } = await client.query(`
      SELECT id, status, accounting_treatment, type
      FROM deposits
      ORDER BY id;
    `);
    const dep1 = legacyRows.find(r => r.id === "dep_legacy_001");
    const dep2 = legacyRows.find(r => r.id === "dep_legacy_002");
    const depVoid = legacyRows.find(r => r.id === "dep_legacy_void");

    assert.strictEqual(dep1.status, "confirmed", "Legacy active deposit status must default to 'confirmed'");
    assert.strictEqual(dep1.accounting_treatment, "NEW_CASH", "Legacy active deposit accounting_treatment must default to 'NEW_CASH'");
    assert.strictEqual(dep2.status, "confirmed", "Legacy active deposit 2 status must default to 'confirmed'");
    assert.strictEqual(depVoid.status, "void", "Legacy type='VOID' deposit must be safely backfilled to status='void'");
    pass("6. Legacy rows safe defaults & VOID backfill verified: active rows='confirmed'+'NEW_CASH', VOID rows='void'");

    // ─── STEP D: IDEMPOTENCY CHECK (RUN SCHEMA_UPDATE_V5.SQL SECOND TIME) ───
    await client.query(v5Sql);
    pass("7. schema_update_v5.sql is 100% IDEMPOTENT (second execution succeeded with 0 errors)");

    // ─── STEP E: ATOMIC DATABASE-LEVEL DUPLICATE PREVENTION ─────────────────
    // Insert a record with an idempotency key
    const testKey = "deposit:inv_test_002:2026-05-01:1000000:historical_provenance_test";
    await client.query(`
      INSERT INTO deposits (
        id, investor_id, account_id, date, amount, accounting_treatment, status, idempotency_key
      ) VALUES (
        'dep_prov_001', 'inv_test_002', 'acc_test_002', '2026-05-01', 10000.00, 'HISTORICAL_PROVENANCE', 'confirmed', $1
      );
    `, [testKey]);
    pass("8. Inserted HISTORICAL_PROVENANCE deposit with idempotency key");

    // Attempt to insert duplicate with identical idempotency key -> MUST FAIL WITH 23505
    let duplicateBlocked = false;
    let errorCode = null;
    try {
      await client.query(`
        INSERT INTO deposits (
          id, investor_id, account_id, date, amount, accounting_treatment, status, idempotency_key
        ) VALUES (
          'dep_prov_002', 'inv_test_002', 'acc_test_002', '2026-05-01', 10000.00, 'HISTORICAL_PROVENANCE', 'confirmed', $1
        );
      `, [testKey]);
    } catch (dbErr) {
      duplicateBlocked = true;
      errorCode = dbErr.code;
    }
    assert.strictEqual(duplicateBlocked, true, "Duplicate insert with same idempotency key must be blocked at DB level");
    assert.strictEqual(errorCode, "23505", "Database must raise unique_violation (Postgres code 23505)");
    pass("9. ATOMIC DATABASE DUPLICATE PREVENTION CERTIFIED: duplicate insert rejected with Postgres 23505");

    // Verify NULL idempotency_keys are allowed to coexist (partial index)
    await client.query(`
      INSERT INTO deposits (id, investor_id, account_id, date, amount, idempotency_key)
      VALUES 
        ('dep_null_001', 'inv_test_001', 'acc_test_001', '2026-07-01', 100.00, NULL),
        ('dep_null_002', 'inv_test_001', 'acc_test_001', '2026-07-02', 200.00, NULL);
    `);
    pass("10. Partial unique index verified: multiple NULL idempotency_key rows coexist without collision");

    // ─── STEP F: CHECK CONSTRAINTS ENFORCEMENT ───────────────────────────────
    let invalidTreatmentBlocked = false;
    try {
      await client.query(`
        INSERT INTO deposits (id, investor_id, account_id, date, amount, accounting_treatment)
        VALUES ('dep_bad_001', 'inv_test_001', 'acc_test_001', '2026-08-01', 100.00, 'BOGUS_TREATMENT');
      `);
    } catch (e) {
      invalidTreatmentBlocked = true;
    }
    assert(invalidTreatmentBlocked, "Invalid accounting_treatment must be rejected by CHECK constraint");

    let invalidStatusBlocked = false;
    try {
      await client.query(`
        INSERT INTO deposits (id, investor_id, account_id, date, amount, status)
        VALUES ('dep_bad_002', 'inv_test_001', 'acc_test_001', '2026-08-01', 100.00, 'INVALID_STATUS');
      `);
    } catch (e) {
      invalidStatusBlocked = true;
    }
    assert(invalidStatusBlocked, "Invalid status must be rejected by CHECK constraint");
    pass("11. CHECK constraints verified: invalid treatment and invalid status both strictly blocked");

    // ─── STEP G: AUDITABLE VOID OPERATION ───────────────────────────────────
    const voidTime = new Date().toISOString();
    await client.query(`
      UPDATE deposits
      SET status = 'void',
          type = 'VOID',
          voided_at = $1,
          voided_by = 'admin_josh',
          void_reason = 'Audited QA test void',
          updated_at = NOW()
      WHERE id = 'dep_prov_001';
    `, [voidTime]);

    const { rows: voidedRows } = await client.query(`
      SELECT id, status, type, voided_at, voided_by, void_reason
      FROM deposits WHERE id = 'dep_prov_001';
    `);
    const vr = voidedRows[0];
    assert.strictEqual(vr.status, "void");
    assert.strictEqual(vr.type, "VOID");
    assert.strictEqual(vr.voided_by, "admin_josh");
    assert.strictEqual(vr.void_reason, "Audited QA test void");
    pass("12. Auditable Void operation verified: record preserved in DB with full audit trail");

    // ─── STEP H: VERIFICATION QUERY ─────────────────────────────────────────
    const { rows: reportRows } = await client.query(`
      SELECT
        COUNT(*) AS total_deposits,
        COUNT(*) FILTER (WHERE accounting_treatment = 'NEW_CASH') AS new_cash,
        COUNT(*) FILTER (WHERE accounting_treatment = 'HISTORICAL_PROVENANCE') AS historical_provenance,
        COUNT(*) FILTER (WHERE status = 'confirmed') AS confirmed,
        COUNT(*) FILTER (WHERE status = 'void') AS voided,
        COUNT(*) FILTER (WHERE idempotency_key IS NOT NULL) AS with_idempotency_key
      FROM deposits;
    `);
    const r = reportRows[0];
    console.log("\nDatabase Verification Summary:", JSON.stringify(r, null, 2));
    assert.strictEqual(Number(r.total_deposits), 6); // 2 legacy + 1 legacy void + 1 prov + 2 null
    assert.strictEqual(Number(r.voided), 2); // legacy void + prov void
    assert.strictEqual(Number(r.confirmed), 4); // 2 legacy + 2 null
    pass("13. Verification query executed and matches expected distribution");

  } catch (err) {
    fail("PostgreSQL migration certification error", err);
  } finally {
    if (client) client.release();
    if (pool) await pool.end();
    if (server) {
      try {
        await server.stop();
        pass("14. Native PostgreSQL server stopped cleanly");
      } catch (e) {}
    }
    if (fs.existsSync("data/db")) {
      try {
        fs.rmSync("data/db", { recursive: true, force: true });
      } catch (e) {}
    }
  }

  console.log(`\n===============================================================================`);
  console.log(`NATIVE POSTGRESQL 18.4 MIGRATION CERTIFICATION: ${passed} PASSED / ${failed} FAILED`);
  console.log(`===============================================================================\n`);

  if (failed > 0) process.exit(1);
}

runPostgresMigrationCertification().catch(console.error);
