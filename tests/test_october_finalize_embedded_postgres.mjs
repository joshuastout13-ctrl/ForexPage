/**
 * ISOLATED EMBEDDED POSTGRES END-TO-END TEST:
 * OCTOBER 2026 RETURN FREEZE, FINALIZATION, & NOVEMBER/DECEMBER ROLLOVER
 *
 * 100% Offline / Local Execution (Zero Production Credentials).
 */

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import EmbeddedPostgres from "embedded-postgres";
import { createSession } from "../lib/auth.js";
import freezeHandler from "../api/admin/accounting/return/freeze/index.js";
import finalizeHandler from "../api/admin/accounting/finalize/index.js";
import { buildInvestorDashboard } from "../lib/dashboard.js";
import { executeDailyFinancialReconciliation } from "../lib/daily-reconciliation-engine.js";
import { normalizeRow } from "../lib/supabase.js";

const { Pool } = pg;

/**
 * Minimal PostgREST-compatible adapter over node-postgres Pool so API handlers
 * and paginatedRead execute real SQL queries/constraints against EmbeddedPostgres.
 */
function createPgSupabaseAdapter(pool) {
  function sanitizeIdent(name) {
    if (!/^[a-zA-Z0-9_]+$/.test(name)) {
      throw new Error(`Unsafe SQL identifier: ${name}`);
    }
    return `"${name}"`;
  }

  class QueryBuilder {
    constructor(table) {
      this.table = sanitizeIdent(table);
      this.rawTable = table;
      this.mode = "select";
      this.filters = [];
      this.orders = [];
      this.rangeBounds = null;
      this.limitVal = null;
      this.payload = null;
      this.upsertOpts = null;
      this.returnSelect = false;
      this.singleRow = false;
    }

    select() {
      if (this.mode === "insert" || this.mode === "update" || this.mode === "upsert") {
        this.returnSelect = true;
      } else {
        this.mode = "select";
      }
      return this;
    }

    insert(rows) {
      this.mode = "insert";
      this.payload = Array.isArray(rows) ? rows : [rows];
      return this;
    }

    update(fields) {
      this.mode = "update";
      this.payload = fields;
      return this;
    }

    upsert(rows, opts = {}) {
      this.mode = "upsert";
      this.payload = Array.isArray(rows) ? rows : [rows];
      this.upsertOpts = opts;
      return this;
    }

    eq(col, val) {
      this.filters.push({ op: "eq", col: sanitizeIdent(col), val });
      return this;
    }

    in(col, vals) {
      this.filters.push({ op: "in", col: sanitizeIdent(col), val: vals });
      return this;
    }

    not(col, op, val) {
      this.filters.push({ op: `not_${op}`, col: sanitizeIdent(col), val });
      return this;
    }

    order(col, { ascending = true } = {}) {
      this.orders.push(`${sanitizeIdent(col)} ${ascending ? "ASC" : "DESC"}`);
      return this;
    }

    range(from, to) {
      this.rangeBounds = [from, to];
      return this;
    }

    limit(n) {
      this.limitVal = n;
      return this;
    }

    single() {
      this.singleRow = true;
      return this;
    }

    _buildWhere(params) {
      if (this.filters.length === 0) return "";
      const clauses = this.filters.map(f => {
        if (f.op === "eq") {
          params.push(f.val);
          return `${f.col} = $${params.length}`;
        }
        if (f.op === "in") {
          params.push(f.val);
          return `${f.col} = ANY($${params.length})`;
        }
        if (f.op === "not_ilike") {
          params.push(f.val);
          return `(${f.col} IS NULL OR ${f.col} NOT ILIKE $${params.length})`;
        }
        throw new Error(`Unsupported filter op: ${f.op}`);
      });
      return `WHERE ${clauses.join(" AND ")}`;
    }

    _serializeVal(colName, val) {
      if (val && typeof val === "object" && !(val instanceof Date)) {
        return JSON.stringify(val);
      }
      return val;
    }

    async _exec() {
      try {
        if (this.mode === "select") {
          const params = [];
          const where = this._buildWhere(params);
          const orderSql = this.orders.length > 0 ? `ORDER BY ${this.orders.join(", ")}` : "";
          let limitSql = "";
          if (this.rangeBounds) {
            const [from, to] = this.rangeBounds;
            limitSql = `LIMIT ${to - from + 1} OFFSET ${from}`;
          } else if (this.limitVal !== null) {
            limitSql = `LIMIT ${this.limitVal}`;
          }
          const sql = `SELECT * FROM ${this.table} ${where} ${orderSql} ${limitSql}`;
          const { rows } = await pool.query(sql, params);
          return { data: this.singleRow ? (rows[0] || null) : rows, error: null };
        }

        if (this.mode === "insert" || this.mode === "upsert") {
          const rows = this.payload;
          if (!rows || rows.length === 0) return { data: [], error: null };
          const cols = Object.keys(rows[0]);
          const colIdents = cols.map(sanitizeIdent).join(", ");
          const params = [];
          const valueTuples = rows.map(r => {
            const placeholders = cols.map(c => {
              params.push(this._serializeVal(c, r[c] === undefined ? null : r[c]));
              return `$${params.length}`;
            });
            return `(${placeholders.join(", ")})`;
          });

          let conflictSql = "";
          if (this.mode === "upsert" && this.upsertOpts?.onConflict) {
            const conflictCols = this.upsertOpts.onConflict.split(",").map(s => sanitizeIdent(s.trim())).join(", ");
            const updates = cols
              .filter(c => !this.upsertOpts.onConflict.split(",").map(s => s.trim()).includes(c))
              .map(c => `${sanitizeIdent(c)} = EXCLUDED.${sanitizeIdent(c)}`)
              .join(", ");
            conflictSql = `ON CONFLICT (${conflictCols}) DO UPDATE SET ${updates}`;
          }

          const returningSql = this.returnSelect ? "RETURNING *" : "";
          const sql = `INSERT INTO ${this.table} (${colIdents}) VALUES ${valueTuples.join(", ")} ${conflictSql} ${returningSql}`;
          const { rows: out } = await pool.query(sql, params);
          if (this.singleRow) {
            return { data: out[0] || null, error: null };
          }
          return { data: this.returnSelect ? out : null, error: null };
        }

        if (this.mode === "update") {
          const cols = Object.keys(this.payload);
          const params = [];
          const sets = cols.map(c => {
            params.push(this._serializeVal(c, this.payload[c] === undefined ? null : this.payload[c]));
            return `${sanitizeIdent(c)} = $${params.length}`;
          });
          const where = this._buildWhere(params);
          const returningSql = this.returnSelect ? "RETURNING *" : "";
          const sql = `UPDATE ${this.table} SET ${sets.join(", ")} ${where} ${returningSql}`;
          const { rows: out } = await pool.query(sql, params);
          return { data: this.singleRow ? (out[0] || null) : (this.returnSelect ? out : null), error: null };
        }

        throw new Error(`Unsupported mode: ${this.mode}`);
      } catch (err) {
        return { data: null, error: { message: err.message, code: err.code } };
      }
    }

    then(resolve, reject) {
      return this._exec().then(resolve, reject);
    }
  }

  return {
    from(table) {
      return new QueryBuilder(table);
    }
  };
}

function makeReqRes({ method = "POST", body = {}, cookie = "" }) {
  const req = {
    method,
    body,
    headers: { cookie }
  };
  const res = {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.payload = data;
      return this;
    }
  };
  return { req, res };
}

async function createProductionParitySchema(pool) {
  await pool.query(`
    CREATE TABLE investors (
      id TEXT PRIMARY KEY,
      first_name TEXT,
      last_name TEXT,
      portal_username TEXT,
      active BOOLEAN DEFAULT TRUE,
      split_pct NUMERIC DEFAULT 100,
      monthly_draw NUMERIC DEFAULT 0,
      start_date TEXT,
      role TEXT DEFAULT 'Investor'
    );
    CREATE TABLE investor_accounts (
      id TEXT PRIMARY KEY,
      investor_id TEXT,
      starting_capital NUMERIC DEFAULT 0,
      status TEXT DEFAULT 'Active',
      start_date TEXT,
      external_cash_provenance_status TEXT
    );
    CREATE TABLE monthly_returns (
      year INT NOT NULL,
      month_number INT NOT NULL,
      month TEXT,
      gross_return_pct NUMERIC,
      source TEXT,
      notes TEXT,
      locked BOOLEAN DEFAULT FALSE,
      last_updated TEXT,
      created_at TEXT,
      UNIQUE (year, month_number)
    );
    CREATE TABLE deposits (
      id TEXT PRIMARY KEY,
      investor_id TEXT,
      account_id TEXT,
      amount NUMERIC,
      type TEXT,
      status TEXT,
      date TEXT,
      effective_accounting_date TEXT,
      accounting_treatment TEXT,
      is_commission BOOLEAN DEFAULT FALSE,
      transfer_id TEXT,
      notes TEXT
    );
    CREATE TABLE withdrawals (
      id TEXT PRIMARY KEY,
      investor_id TEXT,
      account_id TEXT,
      amount NUMERIC,
      status TEXT,
      request_date TEXT,
      effective_accounting_date TEXT,
      year INT,
      month_number INT,
      month TEXT,
      is_draw BOOLEAN DEFAULT FALSE,
      transfer_id TEXT,
      notes TEXT
    );
    CREATE TABLE commission_shares (
      id TEXT PRIMARY KEY,
      source_investor_id TEXT,
      source_account_id TEXT,
      recipient_investor_id TEXT,
      commission_percent NUMERIC,
      effective_start_date TEXT,
      effective_end_date TEXT,
      status TEXT
    );
    CREATE TABLE investor_monthly_history (
      id TEXT PRIMARY KEY,
      investor_id TEXT,
      account_id TEXT,
      year INT,
      month_number INT,
      month TEXT,
      opening_balance NUMERIC,
      deposits NUMERIC,
      withdrawals NUMERIC,
      gross_return_pct NUMERIC,
      manual_gain_amount NUMERIC,
      manual_return_pct NUMERIC,
      recurring_draw NUMERIC,
      ending_balance NUMERIC,
      is_manual BOOLEAN DEFAULT FALSE,
      locked BOOLEAN DEFAULT FALSE,
      notes TEXT,
      updated_at TEXT,
      created_at TEXT
    );
    CREATE TABLE commission_earnings (
      id TEXT PRIMARY KEY,
      recipient_id TEXT,
      source_investor_id TEXT,
      source_account_id TEXT,
      year INT,
      month_number INT,
      amount NUMERIC,
      commission_percent_snapshot NUMERIC,
      commission_share_rule_id TEXT,
      calculation_version TEXT,
      accounting_period_id INT,
      status TEXT DEFAULT 'ACTIVE',
      ledger_key TEXT UNIQUE,
      superseded_at TEXT,
      superseded_by_audit_id TEXT,
      audit_notes TEXT,
      created_at TEXT
    );
    CREATE TABLE accounting_periods (
      id SERIAL PRIMARY KEY,
      year INT NOT NULL,
      month_number INT NOT NULL,
      status TEXT NOT NULL,
      fund_return_pct NUMERIC,
      return_source TEXT,
      return_status TEXT,
      return_captured_at TEXT,
      preview_input_hash TEXT,
      preview_run_id TEXT,
      finalized_at TEXT,
      finalized_by TEXT,
      calculation_version TEXT,
      created_at TEXT,
      updated_at TEXT,
      UNIQUE (year, month_number)
    );
    CREATE TABLE audit_runs (
      id TEXT PRIMARY KEY,
      admin_id TEXT,
      source_investor_id TEXT,
      year INT,
      month_number INT,
      report_json JSONB,
      created_at TEXT
    );
    CREATE TABLE account_cutover_adjustments (
      id TEXT PRIMARY KEY,
      investor_id TEXT,
      year INT,
      month_number INT,
      authorized_opening_balance NUMERIC
    );
    CREATE TABLE commission_rules (
      id TEXT PRIMARY KEY
    );
  `);
}

async function seedFixtureData(pool) {
  await pool.query(`
    INSERT INTO investors (id, first_name, last_name, portal_username, active, split_pct, monthly_draw, start_date, role) VALUES
      ('stout001', 'Joshua', 'Stout', 'jstout', true, 100, 0, '2026-01-01', 'Investor'),
      ('inv_65b7fbd9', 'Jeff', 'Bennion', 'jbennion', true, 66.6, 21500, '2026-07-01', 'Investor'),
      ('inv_d8b5ab06', 'Nolan', 'Waite', 'nwaite', true, 50, 0, '2026-06-01', 'Investor'),
      ('inv_kdodge', 'Kathy', 'Dodge', 'kdodge', true, 100, 0, '2026-09-01', 'Investor'),
      ('inv_85d68e7f', 'Josh', 'Geisler', 'jgeisler', true, 50, 0, '2026-11-01', 'Investor'),
      ('inv_1e88ff0c', 'Jerry', 'Fuller', 'jefuller', true, 50, 0, '2026-12-01', 'Investor');

    INSERT INTO investor_accounts (id, investor_id, starting_capital, status, start_date, external_cash_provenance_status) VALUES
      ('jstout', 'stout001', 2500000, 'Active', '2026-01-01', 'COMPLETE'),
      ('jbennion', 'inv_65b7fbd9', 2651044.48, 'Active', '2026-07-01', 'COMPLETE'),
      ('nwaite', 'inv_d8b5ab06', 500000, 'Active', '2026-06-01', 'COMPLETE'),
      ('kdodge', 'inv_kdodge', 10000, 'Active', '2026-09-01', 'COMPLETE'),
      ('jgeisler', 'inv_85d68e7f', 150000, 'Active', '2026-11-01', 'COMPLETE'),
      ('jefuller', 'inv_1e88ff0c', 150000, 'Active', '2026-12-01', 'COMPLETE');

    INSERT INTO monthly_returns (year, month_number, month, gross_return_pct, source, locked, last_updated) VALUES
      (2026, 9, 'September', 3.07, 'Certified Final Close', true, '2026-10-03T18:26:53Z'),
      (2026, 10, 'October', 3.05, 'Myfxbook (Auto Sync)', false, '2026-10-31T07:30:09Z'),
      (2026, 11, 'November', 1.25, 'Myfxbook (Auto Sync)', false, '2026-11-14T08:30:13Z'),
      (2026, 12, 'December', 0, 'Admin maintained', false, '');

    INSERT INTO deposits (id, investor_id, account_id, amount, type, status, date, effective_accounting_date, accounting_treatment, is_commission) VALUES
      ('dep_stout_init', 'stout001', 'jstout', 1603590, 'Historical Outside Cash', 'confirmed', '2026-01-01', '2026-01-01', 'HISTORICAL_PROVENANCE', false),
      ('dep_stout_oct', 'stout001', 'jstout', 2500, 'Wire', 'confirmed', '2026-10-01', '2026-10-01', 'NEW_CASH', false),
      ('dep_nwaite_oct1', 'inv_d8b5ab06', 'nwaite', 6500, 'Wire', 'confirmed', '2026-10-01', '2026-10-01', 'NEW_CASH', false),
      ('dep_nwaite_oct2', 'inv_d8b5ab06', 'nwaite', 1900, 'Wire', 'confirmed', '2026-10-01', '2026-10-01', 'NEW_CASH', false),
      ('dep_kdodge_nov', 'inv_kdodge', 'kdodge', 39470, 'Wire', 'confirmed', '2026-11-01', '2026-11-01', 'NEW_CASH', false);

    INSERT INTO withdrawals (id, investor_id, account_id, amount, status, request_date, effective_accounting_date, year, month_number, month, is_draw) VALUES
      ('wd_stout_oct', 'stout001', 'jstout', 70000, 'Completed', '2026-10-01', '2026-10-01', 2026, 10, 'October', false),
      ('668c0dcd-4c01-4ab0-8e13-d5262ec415d0', 'inv_65b7fbd9', 'jbennion', 21500, 'Completed', '2026-10-01', '2026-10-01', 2026, 10, 'October', true),
      ('8c7e45a8-4a86-45bc-bda4-b6e51f30acfb', 'inv_65b7fbd9', 'jbennion', 21500, 'Completed', '2026-09-01', '2026-09-01', 2026, 9, 'September', true);

    INSERT INTO commission_shares (id, source_investor_id, recipient_investor_id, commission_percent, effective_start_date, effective_end_date, status) VALUES
      ('cs_jb_stout', 'inv_65b7fbd9', 'stout001', 33.4, '2026-07-01', NULL, 'active'),
      ('cs_nw_stout', 'inv_d8b5ab06', 'stout001', 50, '2026-06-01', NULL, 'active');

    INSERT INTO investor_monthly_history (id, investor_id, year, month_number, month, opening_balance, deposits, withdrawals, gross_return_pct, recurring_draw, ending_balance, is_manual, locked, notes) VALUES
      ('h_st_9', 'stout001', 2026, 9, 'September', 3306008.46, 2500, 20000, 3.07, 0, 3389465.67, false, true, NULL),
      ('h_st_10', 'stout001', 2026, 10, 'October', 3401758.56, 2500, 70000, 0, 0, 3334258.56, false, false, NULL),
      ('h_st_11', 'stout001', 2026, 11, 'November', 3333453.52, 0, 0, 0, 0, 3333453.52, false, false, 'PROJECTION_VOIDED: Reset to settled October ending balance pending month close'),
      ('h_st_12', 'stout001', 2026, 12, 'December', 3333453.52, 0, 0, 0, 0, 3333453.52, false, false, 'PROJECTION_VOIDED: Reset to settled October ending balance pending month close'),

      ('h_jb_9', 'inv_65b7fbd9', 2026, 9, 'September', 2738986.503892227, 0, 21500, 3.07, 21500, 2751548.7764481083, false, true, NULL),
      ('h_jb_10', 'inv_65b7fbd9', 2026, 10, 'October', 2751548.7764481083, 0, 21500, 0, 21500, 2708548.7764481083, false, false, NULL),
      ('h_jb_11', 'inv_65b7fbd9', 2026, 11, 'November', 2708548.7764481083, 0, 0, 0, 0, 2708548.7764481083, false, false, 'PROJECTION_VOIDED: Reset to settled October ending balance pending month close'),
      ('h_jb_12', 'inv_65b7fbd9', 2026, 12, 'December', 2708548.7764481083, 0, 0, 0, 0, 2708548.7764481083, false, false, 'PROJECTION_VOIDED: Reset to settled October ending balance pending month close'),

      ('h_nw_9', 'inv_d8b5ab06', 2026, 9, 'September', 534279.1025795467, 12600, 7000, 3.07, 0, 548166.246804143, false, true, NULL),
      ('h_nw_10', 'inv_d8b5ab06', 2026, 10, 'October', 548166.246804143, 6500, 0, 0, 0, 554666.246804143, false, false, NULL),
      ('h_nw_11', 'inv_d8b5ab06', 2026, 11, 'November', 554666.246804143, 0, 0, 0, 0, 554666.246804143, false, false, 'PROJECTION_VOIDED: Reset to settled October ending balance pending month close'),

      ('h_kd_9', 'inv_kdodge', 2026, 9, 'September', 10000, 0, 0, 3.07, 0, 10307, false, true, NULL),
      ('h_kd_10', 'inv_kdodge', 2026, 10, 'October', 10307, 0, 0, 0, 0, 10307, false, false, NULL),
      ('h_kd_11', 'inv_kdodge', 2026, 11, 'November', 10307, 39470, 0, 0, 0, 49777, false, false, 'PROJECTION_VOIDED: Reset to settled October ending balance pending month close'),

      ('h_jg_10', 'inv_85d68e7f', 2026, 10, 'October', 150000, 0, 0, 0, 0, 150000, false, false, NULL),
      ('h_jg_11', 'inv_85d68e7f', 2026, 11, 'November', 150000, 0, 0, 0, 0, 150000, false, false, NULL),

      ('h_jf_11', 'inv_1e88ff0c', 2026, 11, 'November', 150000, 0, 0, 0, 0, 150000, false, false, NULL),
      ('h_jf_12', 'inv_1e88ff0c', 2026, 12, 'December', 150000, 0, 0, 0, 0, 150000, false, false, NULL);

    INSERT INTO commission_earnings (id, recipient_id, source_investor_id, year, month_number, amount, status, created_at) VALUES
      ('ce_sep_st_1', 'stout001', 'inv_65b7fbd9', 2026, 9, 12292.89, 'ACTIVE', '2026-10-03T18:26:16Z'),
      ('ce_oct_legacy_superseded', 'stout001', 'inv_d8b5ab06', 2026, 10, 99999.99, 'SUPERSEDED', '2026-11-01T00:05:00Z');
  `);
}

async function runTestSuite() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "forexpage-oct-finalize-pg-"));
  const port = 54337;
  const password = "postgrespassword";
  const postgres = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "postgres",
    password,
    port,
    persistent: false
  });

  process.env.SESSION_SECRET = "test-secret-oct-finalize-e2e";
  process.env.DATA_SOURCE = "supabase";
  const adminToken = createSession({ adminId: "josh_admin_test", role: "admin" });
  const adminCookie = `scff_admin_session=${encodeURIComponent(adminToken)}`;

  let pool;
  try {
    console.log("1. Starting isolated EmbeddedPostgres...");
    await postgres.initialise();
    await postgres.start();

    pool = new Pool({ host: "127.0.0.1", port, user: "postgres", password, database: "postgres" });
    pool.on("error", () => {});
    await createProductionParitySchema(pool);
    await seedFixtureData(pool);
    const db = createPgSupabaseAdapter(pool);

    // 2. Test Freeze Return Gate & Dynamic Month Name Message
    process.env.ACCOUNTING_RETURN_FREEZE_ENABLED = "false";
    {
      const { req, res } = makeReqRes({
        cookie: adminCookie,
        body: { year: 2026, month: 10, grossReturnPct: 3.05, source: "MYFXBOOK_COMPLETED_MONTH" }
      });
      await freezeHandler(req, res, { supabase: db });
      assert.equal(res.statusCode, 503);
      assert.equal(res.payload.error, "RETURN_FREEZE_DISABLED");
    }

    process.env.ACCOUNTING_RETURN_FREEZE_ENABLED = "true";
    {
      const { req, res } = makeReqRes({
        cookie: adminCookie,
        body: { year: 2026, month: 10, grossReturnPct: 3.05, source: "MYFXBOOK_COMPLETED_MONTH" }
      });
      await freezeHandler(req, res, { supabase: db });
      assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
      assert.equal(res.payload.success, true);
      assert.match(res.payload.message, /^October 2026 return of 3\.05%/);
      assert.equal(res.payload.frozenReturn.locked, true);
    }
    console.log("   PASS: Freeze handler locks October 2026 cleanly and reports 'October 2026'");

    // 3. Test Finalize Dry-Run (Zero DB Writes)
    process.env.ACCOUNTING_FINALIZATION_ENABLED = "false";
    let dryRunManifest;
    {
      const { req, res } = makeReqRes({
        cookie: adminCookie,
        body: { year: 2026, month: 10, dryRun: true }
      });
      await finalizeHandler(req, res, { supabase: db });
      assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
      assert.equal(res.payload.status, "SUCCESS_DRY_RUN");
      dryRunManifest = res.payload.manifest;
      assert.equal(dryRunManifest.whatWouldChange.totalDatabaseWritesPerformed, 0);
      assert.equal(dryRunManifest.controlEquations.controlCheck, "RECONCILED");
    }

    // Reject dryRun=false when feature flag is off
    {
      const { req, res } = makeReqRes({
        cookie: adminCookie,
        body: { year: 2026, month: 10, dryRun: false, inputHash: dryRunManifest.inputHash }
      });
      await finalizeHandler(req, res, { supabase: db });
      assert.equal(res.statusCode, 503);
    }

    // 4. Reject Stale Input Hash
    process.env.ACCOUNTING_FINALIZATION_ENABLED = "true";
    {
      const { req, res } = makeReqRes({
        cookie: adminCookie,
        body: { year: 2026, month: 10, dryRun: false, inputHash: "stale-hash-000" }
      });
      await finalizeHandler(req, res, { supabase: db });
      assert.equal(res.statusCode, 409);
      assert.equal(res.payload.error, "STALE_PREVIEW");
    }
    console.log("   PASS: Feature flag, dry-run zero-writes, and stale preview hash protections enforced");

    // 5. Execute Live Finalization & November/December Rollover
    {
      const { req, res } = makeReqRes({
        cookie: adminCookie,
        body: { year: 2026, month: 10, dryRun: false, inputHash: dryRunManifest.inputHash }
      });
      await finalizeHandler(req, res, { supabase: db });
      assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
      assert.equal(res.payload.status, "SUCCESS_FINALIZED");
      assert.match(res.payload.message, /October 2026 finalized and rolled over cleanly into November 2026/);
    }

    // 6. Replay Protection: Second finalize call must return 409 ALREADY_FINALIZED
    {
      const { req, res } = makeReqRes({
        cookie: adminCookie,
        body: { year: 2026, month: 10, dryRun: false }
      });
      await finalizeHandler(req, res, { supabase: db });
      assert.equal(res.statusCode, 409, JSON.stringify(res.payload));
      assert.equal(res.payload.error, "ALREADY_FINALIZED");
    }
    console.log("   PASS: Live finalize committed M10 + M11/M12 rollover and blocked duplicate replay with 409");

    // 7. Inspect Postgres Persisted State & Invariants
    const { rows: histRows } = await pool.query("SELECT * FROM investor_monthly_history ORDER BY investor_id, month_number");
    const getHist = (invId, m) => histRows.find(r => r.investor_id === invId && r.month_number === m);

    // Jeff Bennion single-draw M10 & scheduled draw M11
    const jb10 = getHist("inv_65b7fbd9", 10);
    const jb11 = getHist("inv_65b7fbd9", 11);
    assert.equal(jb10.locked, true);
    assert.equal(Number(jb10.withdrawals), 21500);
    assert.equal(Number(jb10.recurring_draw), 0); // Fulfilled by withdrawal 668c0dcd, zero double-count
    assert.equal(Number(Number(jb10.ending_balance).toFixed(2)), 2785504.26);
    assert.equal(jb11.locked, false);
    assert.equal(jb11.notes, null); // PROJECTION_VOIDED cleared
    assert.equal(Number(jb11.opening_balance), Number(jb10.ending_balance)); // Exact rollover continuity
    assert.equal(Number(Number(jb11.opening_balance).toFixed(2)), 2785504.26);
    assert.equal(Number(jb11.recurring_draw), 21500);
    assert.equal(Number(Number(jb11.ending_balance).toFixed(2)), 2764004.26);

    // Nolan Waite M10 picks up late $1,900 deposit -> $8,400 deposits -> rolls into M11
    const nw10 = getHist("inv_d8b5ab06", 10);
    const nw11 = getHist("inv_d8b5ab06", 11);
    assert.equal(Number(nw10.deposits), 8400);
    assert.equal(Number(Number(nw10.ending_balance).toFixed(2)), 565053.88);
    assert.equal(Number(nw11.opening_balance), Number(nw10.ending_balance));

    // Joshua Stout receives exact Oct ACTIVE commissions from jbennion ($27,811.01) + nwaite ($8,487.64)
    const { rows: octComms } = await pool.query("SELECT * FROM commission_earnings WHERE year = 2026 AND month_number = 10");
    const activeOct = octComms.filter(c => c.status === "ACTIVE");
    const supersededOct = octComms.filter(c => c.status === "SUPERSEDED");
    assert.equal(supersededOct.length, 1);
    assert.equal(supersededOct[0].id, "ce_oct_legacy_superseded");
    assert.equal(activeOct.length, 2);
    const stoutOctCommTotal = activeOct.reduce((s, r) => s + Number(r.amount), 0);
    assert.equal(Number(stoutOctCommTotal.toFixed(2)), 36298.65); // 27811.01 + 8487.64

    const st10 = getHist("stout001", 10);
    const st11 = getHist("stout001", 11);
    const st12 = getHist("stout001", 12);
    assert.equal(Number(st10.ending_balance), 3435953.45);
    assert.equal(Number(st11.opening_balance), 3472252.1); // 3435953.45 + 36298.65
    assert.equal(st11.notes, null);
    assert.equal(Number(st12.opening_balance), 3472252.1);
    assert.equal(st12.notes, null);

    // Kathy Dodge Nov $39,470 wire preserved cleanly in rolled-forward M11
    const kd10 = getHist("inv_kdodge", 10);
    const kd11 = getHist("inv_kdodge", 11);
    assert.equal(Number(kd10.ending_balance), 10621.36);
    assert.equal(Number(kd11.opening_balance), 10621.36);
    assert.equal(Number(kd11.deposits), 39470);
    assert.equal(Number(kd11.ending_balance), 50091.36);

    // Nov-1 starter jgeisler zeroed & locked in M10, $150k in M11
    const jg10 = getHist("inv_85d68e7f", 10);
    const jg11 = getHist("inv_85d68e7f", 11);
    assert.equal(jg10.locked, true);
    assert.equal(Number(jg10.opening_balance), 0);
    assert.equal(Number(jg10.ending_balance), 0);
    assert.equal(Number(jg11.opening_balance), 150000);
    assert.equal(Number(jg11.ending_balance), 150000);

    // Dec-1 starter jefuller has NO M10 row, $0 in M11, $150k in M12
    assert.equal(getHist("inv_1e88ff0c", 10), undefined);
    const jf11 = getHist("inv_1e88ff0c", 11);
    const jf12 = getHist("inv_1e88ff0c", 12);
    assert.equal(Number(jf11.opening_balance), 0);
    assert.equal(Number(jf11.ending_balance), 0);
    assert.equal(Number(jf12.opening_balance), 150000);
    assert.equal(Number(jf12.ending_balance), 150000);
    console.log("   PASS: All M10/M11/M12 Postgres balances, commission capitalization, single-draw, and pre-start invariants verified");

    // 8. Verify buildInvestorDashboard & executeDailyFinancialReconciliation on Post-Close DB
    const tables = await Promise.all([
      pool.query("SELECT * FROM investors"),
      pool.query("SELECT * FROM investor_accounts"),
      pool.query("SELECT * FROM monthly_returns"),
      pool.query("SELECT * FROM deposits"),
      pool.query("SELECT * FROM withdrawals"),
      pool.query("SELECT * FROM investor_monthly_history"),
      pool.query("SELECT * FROM commission_earnings"),
      pool.query("SELECT * FROM commission_shares")
    ]);
    const preloaded = {
      rawInvestors: tables[0].rows.map(normalizeRow),
      accounts: tables[1].rows.map(normalizeRow),
      returnsSheet: tables[2].rows.map(normalizeRow),
      depositsSheet: tables[3].rows.map(normalizeRow),
      withdrawalsSheet: tables[4].rows.map(normalizeRow),
      historyTable: tables[5].rows.map(normalizeRow),
      commissionEarningsTable: tables[6].rows.map(normalizeRow),
      commissionSharesTable: tables[7].rows.map(normalizeRow),
      cutoverAdjustments: [],
      live: { today: "+0.00%", week: "+0.47%", month: "+1.25%", year: "+30.53%" }
    };

    const asOfDate = "2026-11-14T12:00:00Z";
    const dashJb = await buildInvestorDashboard("jbennion", preloaded, { asOfDate });
    assert.equal(Number(dashJb.summary.currentBalance.toFixed(2)), 2764004.26);
    assert.equal(dashJb.summary.totalGainUnavailable, false);
    assert.deepEqual(dashJb.summary.ytdPendingCloseMonths, []);

    const dashSt = await buildInvestorDashboard("jstout", preloaded, { asOfDate });
    assert.equal(Number(dashSt.summary.currentBalance.toFixed(2)), 3472252.1);
    assert.equal(dashSt.summary.totalGainUnavailable, false);
    assert.equal(dashSt.summary.commissionsUnavailable, true); // M10 legacy SUPERSEDED audit trail kept fail-closed on verified card
    assert.equal(dashSt.summary.bookedCommissionsEarnedMonth, 36298.65); // Booked Comm displays ACTIVE M10 ledger
    const stOctRow = dashSt.breakdown.find(r => r.monthNumber === 10);
    assert.equal(stOctRow.hasSupersededCommissions, true);
    assert.equal(stOctRow.activeCommissionsEarned, 36298.65);

    const dashJf = await buildInvestorDashboard("jefuller", preloaded, { asOfDate });
    assert.equal(dashJf.summary.currentBalance, 0);

    const reconReport = await executeDailyFinancialReconciliation({ asOfDate, supabaseClient: db });
    assert.equal(reconReport.status, "PASS", JSON.stringify(reconReport.alerts));
    assert.equal(reconReport.anomalyCounts.P0, 0);
    assert.equal(reconReport.anomalyCounts.P1, 0);
    assert.equal(reconReport.summary.p0CriticalAlerts, 0);
    assert.equal(reconReport.summary.p1HighAlerts, 0);
    console.log("   PASS: Post-close buildInvestorDashboard and executeDailyFinancialReconciliation passed with P0=0, P1=0");

    console.log("\n================================================================================");
    console.log("ALL EMBEDDED POSTGRES OCTOBER CLOSE & NOVEMBER ROLLOVER TESTS PASSED (100%)");
    console.log("================================================================================");
  } finally {
    await pool?.end().catch(() => {});
    await postgres.stop().catch(() => {});
    try {
      fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      // Ignore transient Windows file lock on temp dir cleanup
    }
  }
}

runTestSuite()
  .then(() => {
    process.exit(0);
  })
  .catch(err => {
    console.error("FATAL TEST FAILURE:", err);
    process.exit(1);
  });
