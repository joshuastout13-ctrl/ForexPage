/**
 * ISOLATED EMBEDDED POSTGRES END-TO-END TEST:
 * UNIFIED 2026-11-14 REMEDIATION MIGRATION, DRAW RPCS, WEBHOOKS, PERIOD LOCKS & ATOMIC CLOSE v2
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
import depositsHandler from "../api/admin/deposits/index.js";
import depositByIdHandler from "../api/admin/deposits/[id].js";
import withdrawalsHandler from "../api/admin/withdrawals/index.js";
import withdrawalByIdHandler from "../api/admin/withdrawals/[id].js";
import freezeHandler from "../api/admin/accounting/return/freeze/index.js";
import finalizeHandler from "../api/admin/accounting/finalize/index.js";
import cronMonthEndCloseHandler from "../api/cron/month-end-close.js";
import paymentWebhookHandler from "../api/webhooks/payment-provider.js";
import { executeDailyFinancialReconciliation } from "../lib/daily-reconciliation-engine.js";

const { Pool } = pg;
// Match PostgREST/Supabase JSON wire format: DATE as 'YYYY-MM-DD' strings (avoid local TZ shift) and NUMERIC as numbers
pg.types.setTypeParser(1082, (val) => val);
pg.types.setTypeParser(1700, (val) => (val === null ? null : Number(val)));

const RPC_SPECS = {
  create_deposit_atomic: [
    ["p_investor_id", "text"],
    ["p_account_id", "text"],
    ["p_amount", "numeric"],
    ["p_date", "date"],
    ["p_effective_date", "date"],
    ["p_accounting_treatment", "text"],
    ["p_status", "text"],
    ["p_type", "text"],
    ["p_notes", "text"],
    ["p_idempotency_key", "text"],
    ["p_created_by", "text"]
  ],
  create_withdrawal_atomic: [
    ["p_investor_id", "text"],
    ["p_account_id", "text"],
    ["p_amount", "numeric"],
    ["p_effective_date", "date"],
    ["p_status", "text"],
    ["p_notes", "text"],
    ["p_idempotency_key", "text"],
    ["p_created_by", "text"],
    ["p_allow_duplicate_amount", "boolean"],
    ["p_is_draw", "boolean"]
  ],
  update_withdrawal_atomic: [
    ["p_withdrawal_id", "text"],
    ["p_amount", "numeric"],
    ["p_status", "text"],
    ["p_notes", "text"],
    ["p_updated_by", "text"],
    ["p_effective_date", "date"],
    ["p_year", "int"],
    ["p_month_number", "int"],
    ["p_month", "text"],
    ["p_is_draw", "boolean"]
  ],
  calculate_available_withdrawal_equity_sql: [
    ["p_investor_id", "text"],
    ["p_account_id", "text"],
    ["p_effective_date", "date"],
    ["p_exclude_withdrawal_id", "text"]
  ],
  process_payment_provider_event_atomic: [
    ["p_provider", "text"],
    ["p_provider_event_id", "text"],
    ["p_event_type", "text"],
    ["p_investor_id", "text"],
    ["p_account_id", "text"],
    ["p_amount", "numeric"],
    ["p_effective_date", "date"],
    ["p_resource_type", "text"],
    ["p_payload", "jsonb"],
    ["p_notes", "text"],
    ["p_is_draw", "boolean"]
  ],
  finalize_monthly_accounting_v2: [
    ["p_year", "int"],
    ["p_month_number", "int"],
    ["p_gross_return_pct", "numeric"],
    ["p_return_source", "text"],
    ["p_return_status", "text"],
    ["p_input_hash", "text"],
    ["p_preview_run_id", "text"],
    ["p_calculation_version", "text"],
    ["p_admin_id", "text"],
    ["p_period_history_json", "jsonb"],
    ["p_rollover_history_json", "jsonb"],
    ["p_commission_earnings_json", "jsonb"],
    ["p_supersede_reason", "text"]
  ]
};

function createPgSupabaseWithRpcAdapter(pool) {
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
      this.maybeSingleRow = false;
    }

    select() {
      if (["insert", "update", "upsert", "delete"].includes(this.mode)) {
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

    delete() {
      this.mode = "delete";
      return this;
    }

    eq(col, val) {
      this.filters.push({ op: "eq", col: sanitizeIdent(col), val });
      return this;
    }

    neq(col, val) {
      this.filters.push({ op: "neq", col: sanitizeIdent(col), val });
      return this;
    }

    in(col, vals) {
      this.filters.push({ op: "in", col: sanitizeIdent(col), val: vals });
      return this;
    }

    ilike(col, val) {
      this.filters.push({ op: "ilike", col: sanitizeIdent(col), val });
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

    maybeSingle() {
      this.maybeSingleRow = true;
      return this;
    }

    _buildWhere(params) {
      if (this.filters.length === 0) return "";
      const clauses = this.filters.map((f) => {
        if (f.op === "eq") {
          params.push(f.val);
          return `${f.col} = $${params.length}`;
        }
        if (f.op === "neq") {
          params.push(f.val);
          return `${f.col} IS DISTINCT FROM $${params.length}`;
        }
        if (f.op === "in") {
          params.push(f.val);
          return `${f.col} = ANY($${params.length})`;
        }
        if (f.op === "ilike") {
          params.push(f.val);
          return `${f.col} ILIKE $${params.length}`;
        }
        if (f.op === "not_ilike") {
          params.push(f.val);
          return `(${f.col} IS NULL OR ${f.col} NOT ILIKE $${params.length})`;
        }
        throw new Error(`Unsupported filter op: ${f.op}`);
      });
      return `WHERE ${clauses.join(" AND ")}`;
    }

    _serializeVal(val) {
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
          if (this.singleRow || this.maybeSingleRow) {
            return { data: rows[0] || null, error: null };
          }
          return { data: rows, error: null };
        }

        if (this.mode === "insert" || this.mode === "upsert") {
          const rows = this.payload;
          if (!rows || rows.length === 0) return { data: [], error: null };
          const cols = Object.keys(rows[0]);
          const colIdents = cols.map(sanitizeIdent).join(", ");
          const params = [];
          const valueTuples = rows.map((r) => {
            const placeholders = cols.map((c) => {
              params.push(this._serializeVal(r[c] === undefined ? null : r[c]));
              return `$${params.length}`;
            });
            return `(${placeholders.join(", ")})`;
          });

          let conflictSql = "";
          if (this.mode === "upsert" && this.upsertOpts?.onConflict) {
            const conflictCols = this.upsertOpts.onConflict.split(",").map((s) => sanitizeIdent(s.trim())).join(", ");
            const updates = cols
              .filter((c) => !this.upsertOpts.onConflict.split(",").map((s) => s.trim()).includes(c))
              .map((c) => `${sanitizeIdent(c)} = EXCLUDED.${sanitizeIdent(c)}`)
              .join(", ");
            conflictSql = `ON CONFLICT (${conflictCols}) DO UPDATE SET ${updates}`;
          }

          const returningSql = this.returnSelect ? "RETURNING *" : "";
          const sql = `INSERT INTO ${this.table} (${colIdents}) VALUES ${valueTuples.join(", ")} ${conflictSql} ${returningSql}`;
          const { rows: out } = await pool.query(sql, params);
          if (this.singleRow || this.maybeSingleRow) {
            return { data: out[0] || null, error: null };
          }
          return { data: this.returnSelect ? out : null, error: null };
        }

        if (this.mode === "update") {
          const cols = Object.keys(this.payload);
          const params = [];
          const sets = cols.map((c) => {
            params.push(this._serializeVal(this.payload[c] === undefined ? null : this.payload[c]));
            return `${sanitizeIdent(c)} = $${params.length}`;
          });
          const where = this._buildWhere(params);
          const returningSql = this.returnSelect ? "RETURNING *" : "";
          const sql = `UPDATE ${this.table} SET ${sets.join(", ")} ${where} ${returningSql}`;
          const { rows: out } = await pool.query(sql, params);
          return { data: (this.singleRow || this.maybeSingleRow) ? (out[0] || null) : (this.returnSelect ? out : null), error: null };
        }

        if (this.mode === "delete") {
          const params = [];
          const where = this._buildWhere(params);
          const sql = `DELETE FROM ${this.table} ${where}`;
          await pool.query(sql, params);
          return { data: null, error: null };
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
    },
    async rpc(fnName, namedArgs = {}) {
      try {
        const spec = RPC_SPECS[fnName];
        if (!spec) {
          return { data: null, error: { code: "PGRST202", message: `Could not find the function public.${fnName} in schema cache` } };
        }
        // Only pass parameters present in namedArgs using PostgreSQL named argument syntax `param := $n::type`
        const argsSql = [];
        const params = [];
        for (const [paramName, pgType] of spec) {
          if (Object.prototype.hasOwnProperty.call(namedArgs, paramName)) {
            let val = namedArgs[paramName];
            if (pgType === "jsonb" && val !== null && val !== undefined && typeof val !== "string") {
              val = JSON.stringify(val);
            }
            params.push(val === undefined ? null : val);
            argsSql.push(`${paramName} := $${params.length}::${pgType}`);
          }
        }
        const sql = `SELECT public.${sanitizeIdent(fnName)}(${argsSql.join(", ")}) AS res`;
        const { rows } = await pool.query(sql, params);
        return { data: rows[0]?.res ?? null, error: null };
      } catch (err) {
        return { data: null, error: { message: err.message, code: err.code } };
      }
    }
  };
}

function makeReqRes({ method = "POST", body = {}, query = {}, cookie = "", headers = {}, rawBody = null }) {
  const req = {
    method,
    body,
    query,
    rawBody,
    headers: { cookie, ...headers }
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

function signWebhookPayload(secret, bodyObj, tsSec = Math.floor(Date.now() / 1000)) {
  const rawBody = JSON.stringify(bodyObj);
  const sig = crypto.createHmac("sha256", secret).update(`${tsSec}.${rawBody}`).digest("hex");
  return {
    rawBody,
    headers: {
      "x-webhook-timestamp": String(tsSec),
      "x-webhook-signature": `sha256=${sig}`
    }
  };
}

async function createFullSchema(pool) {
  await pool.query(`
    CREATE TABLE investors (
      id TEXT PRIMARY KEY,
      first_name TEXT,
      last_name TEXT,
      email TEXT,
      portal_username TEXT,
      active BOOLEAN DEFAULT TRUE,
      split_pct NUMERIC DEFAULT 100,
      monthly_draw NUMERIC DEFAULT 0,
      start_date DATE,
      role TEXT DEFAULT 'Investor'
    );
    CREATE TABLE investor_accounts (
      id TEXT PRIMARY KEY,
      investor_id TEXT REFERENCES investors(id),
      name TEXT,
      starting_capital NUMERIC DEFAULT 0,
      status TEXT DEFAULT 'Active',
      open_date DATE,
      is_commission BOOLEAN DEFAULT FALSE,
      external_cash_provenance_status TEXT DEFAULT 'UNKNOWN'
    );
    CREATE TABLE monthly_returns (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      year INT NOT NULL,
      month_number INT NOT NULL,
      month TEXT,
      gross_return_pct NUMERIC,
      source TEXT,
      notes TEXT,
      locked BOOLEAN DEFAULT FALSE,
      last_updated TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (year, month_number)
    );
    CREATE TABLE deposits (
      id TEXT PRIMARY KEY DEFAULT ('dep_' || substr(gen_random_uuid()::text, 1, 12)),
      investor_id TEXT,
      account_id TEXT,
      amount NUMERIC(15, 2) NOT NULL,
      type TEXT,
      status TEXT DEFAULT 'confirmed',
      date DATE,
      effective_accounting_date DATE,
      accounting_treatment TEXT DEFAULT 'NEW_CASH',
      is_commission BOOLEAN DEFAULT FALSE,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE withdrawals (
      id TEXT PRIMARY KEY DEFAULT ('wd_' || substr(gen_random_uuid()::text, 1, 12)),
      investor_id TEXT,
      account_id TEXT,
      amount NUMERIC(15, 2) NOT NULL,
      status TEXT DEFAULT 'Pending',
      request_date DATE,
      effective_accounting_date DATE,
      year INT,
      month_number INT,
      month TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE commission_shares (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      source_investor_id TEXT,
      source_account_id TEXT,
      recipient_investor_id TEXT,
      commission_percent NUMERIC,
      effective_start_date DATE,
      effective_end_date DATE,
      status TEXT DEFAULT 'active'
    );
    CREATE TABLE investor_monthly_history (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      investor_id TEXT,
      account_id TEXT,
      year INT NOT NULL,
      month_number INT NOT NULL,
      month TEXT,
      opening_balance NUMERIC,
      deposits NUMERIC DEFAULT 0,
      withdrawals NUMERIC DEFAULT 0,
      gross_return_pct NUMERIC DEFAULT 0,
      manual_gain_amount NUMERIC,
      manual_return_pct NUMERIC,
      recurring_draw NUMERIC DEFAULT 0,
      ending_balance NUMERIC,
      is_manual BOOLEAN DEFAULT FALSE,
      locked BOOLEAN DEFAULT FALSE,
      notes TEXT,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (investor_id, year, month_number)
    );
    CREATE TABLE commission_earnings (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      recipient_id TEXT,
      source_investor_id TEXT,
      source_account_id TEXT,
      year INT NOT NULL,
      month_number INT NOT NULL,
      amount NUMERIC NOT NULL,
      commission_percent_snapshot NUMERIC,
      commission_share_rule_id TEXT,
      calculation_version TEXT,
      accounting_period_id INT,
      status TEXT DEFAULT 'ACTIVE',
      ledger_key TEXT UNIQUE,
      superseded_at TIMESTAMPTZ,
      superseded_by_audit_id TEXT,
      audit_notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE accounting_periods (
      id SERIAL PRIMARY KEY,
      year INT NOT NULL,
      month_number INT NOT NULL,
      status TEXT NOT NULL DEFAULT 'OPEN',
      fund_return_pct NUMERIC,
      return_source TEXT,
      return_status TEXT,
      return_captured_at TIMESTAMPTZ,
      preview_input_hash TEXT,
      preview_run_id TEXT,
      finalized_at TIMESTAMPTZ,
      finalized_by TEXT,
      calculation_version TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (year, month_number)
    );
    CREATE TABLE audit_runs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      admin_id TEXT,
      source_investor_id TEXT,
      year INT,
      month_number INT,
      report_json JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE account_cutover_adjustments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      investor_id TEXT,
      account_id TEXT,
      year INT NOT NULL,
      month_number INT NOT NULL,
      authorized_opening_balance NUMERIC
    );
    CREATE TABLE commission_rules (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid()
    );
  `);
}

async function seedFixture(pool) {
  await pool.query(`
    INSERT INTO investors (id, first_name, last_name, portal_username, active, split_pct, monthly_draw, start_date, role) VALUES
      ('stout001', 'Joshua', 'Stout', 'jstout', true, 100, 0, '2026-01-01', 'Investor'),
      ('inv_65b7fbd9', 'Jeff', 'Bennion', 'jbennion', true, 88.6, 21500, '2026-07-01', 'Investor'),
      ('inv_cash_test', 'Cash', 'Tester', 'cashtester', true, 100, 0, '2026-01-01', 'Investor');

    INSERT INTO investor_accounts (id, investor_id, name, starting_capital, status, open_date, external_cash_provenance_status) VALUES
      ('stout001', 'stout001', 'Stout Primary', 2500000, 'Active', '2026-01-01', 'COMPLETE'),
      ('jbennion', 'inv_65b7fbd9', 'Bennion Primary', 2651044.48, 'Active', '2026-07-01', 'COMPLETE'),
      ('acc_cash_test', 'inv_cash_test', 'Cash Tester Primary', 50000, 'Active', '2026-01-01', 'COMPLETE');

    INSERT INTO commission_shares (id, source_investor_id, source_account_id, recipient_investor_id, commission_percent, effective_start_date, effective_end_date, status) VALUES
      ('22222222-2222-4222-8222-222222222201', 'inv_65b7fbd9', NULL, 'stout001', 11.4, '2026-07-01', NULL, 'active');

    INSERT INTO deposits (id, investor_id, account_id, amount, type, status, date, effective_accounting_date, accounting_treatment) VALUES
      ('dep_stout_ext_1', 'stout001', 'stout001', 706090.00, 'Wire', 'confirmed', '2026-02-01', '2026-02-01', 'NEW_CASH'),
      ('dep_stout_prov_1', 'stout001', 'stout001', 900000.00, 'HISTORICAL_PROVENANCE', 'confirmed', '2026-01-15', '2026-01-15', 'HISTORICAL_PROVENANCE');

    INSERT INTO investor_monthly_history (investor_id, year, month_number, month, opening_balance, deposits, withdrawals, gross_return_pct, recurring_draw, ending_balance, is_manual, locked) VALUES
      ('stout001', 2026, 9, 'September', 3288508.46, 2500.00, 20000.00, 3.07, 0, 3334258.56, false, true),
      ('stout001', 2026, 10, 'October', 3334258.56, 0, 70000.00, 0, 0, 3333453.52, false, false),
      ('stout001', 2026, 11, 'November', 3333453.52, 0, 0, 0, 0, 3333453.52, false, false),
      ('inv_65b7fbd9', 2026, 9, 'September', 2680000.00, 0, 0, 3.07, 21500, 2700000.00, false, true),
      ('inv_65b7fbd9', 2026, 10, 'October', 2700000.00, 0, 0, 0, 21500, 2678500.00, false, false),
      ('inv_65b7fbd9', 2026, 11, 'November', 2678500.00, 0, 0, 0, 21500, 2657000.00, false, false),
      ('inv_cash_test', 2026, 9, 'September', 48510.67, 0, 0, 3.07, 0, 50000.00, false, true),
      ('inv_cash_test', 2026, 10, 'October', 50000.00, 2500.00, 0, 0, 0, 52500.00, false, false),
      ('inv_cash_test', 2026, 11, 'November', 52500.00, 0, 0, 0, 0, 52500.00, false, false);

    INSERT INTO monthly_returns (year, month_number, month, gross_return_pct, source, locked, last_updated) VALUES
      (2026, 9, 'September', 3.07, 'Certified Final Close', true, '2026-10-03T18:26:53Z'),
      (2026, 10, 'October', 3.05, 'Myfxbook (Auto Sync)', false, '2026-10-31T07:30:09Z'),
      (2026, 11, 'November', 1.25, 'Myfxbook (Auto Sync)', false, '2026-11-14T08:30:13Z'),
      (2026, 12, 'December', 0, 'Admin maintained', false, '');

    -- Legacy M10 superseded + active rows on Oct to verify close supersedes old ACTIVE rows
    INSERT INTO commission_earnings (recipient_id, source_investor_id, year, month_number, amount, status, ledger_key) VALUES
      ('stout001', 'inv_65b7fbd9', 2026, 10, 999.99, 'ACTIVE', 'legacy_premature_m10');
  `);
}

async function runTestSuite() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "forexpage-unified-remediation-pg-"));
  const password = "unified-test-password";
  const port = 54341;

  const postgres = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "postgres",
    password,
    port,
    persistent: false
  });

  process.env.SESSION_SECRET = "test-secret-unified-remediation";
  process.env.DATA_SOURCE = "supabase";
  const adminToken = createSession({ adminId: "josh_admin_e2e", role: "admin" });
  const adminCookie = `scff_admin_session=${encodeURIComponent(adminToken)}`;
  const webhookSecret = "whsec_unified_test_secret_123";

  let pool;
  try {
    console.log("1. Starting EmbeddedPostgres & applying 20261114 unified migration...");
    await postgres.initialise();
    await postgres.start();

    pool = new Pool({ host: "127.0.0.1", port, user: "postgres", password, database: "postgres" });
    pool.on("error", () => {});
    await createFullSchema(pool);

    const migrationSql = fs.readFileSync(
      path.resolve("supabase/migrations/20261114_unified_cashflow_draw_and_close_protection.sql"),
      "utf8"
    );
    await pool.query(migrationSql);
    await seedFixture(pool);
    const db = createPgSupabaseWithRpcAdapter(pool);
    console.log("   PASS: 20261114 unified migration applied cleanly on PostgreSQL 18.");

    // -------------------------------------------------------------------------
    // 2. Physical delete triggers & idempotent deposit RPC
    // -------------------------------------------------------------------------
    for (const tbl of ["deposits", "investor_monthly_history", "commission_earnings"]) {
      await assert.rejects(
        pool.query(`DELETE FROM ${tbl}`),
        /PHYSICAL_DELETION_PROHIBITED/,
        `Physical DELETE must be blocked on ${tbl}`
      );
    }

    const depRes1 = await db.rpc("create_deposit_atomic", {
      p_investor_id: "inv_cash_test",
      p_account_id: "acc_cash_test",
      p_amount: 2500,
      p_date: "2026-10-01",
      p_effective_date: "2026-10-01",
      p_accounting_treatment: "NEW_CASH",
      p_status: "confirmed",
      p_type: "Wire",
      p_notes: "Oct Wire",
      p_idempotency_key: "dep_key_oct_stout",
      p_created_by: "test"
    });
    assert.equal(depRes1.error, null, depRes1.error?.message);
    assert.equal(depRes1.data.status, "SUCCESS");

    const depResReplay = await db.rpc("create_deposit_atomic", {
      p_investor_id: "inv_cash_test",
      p_account_id: "acc_cash_test",
      p_amount: 2500,
      p_date: "2026-10-01",
      p_effective_date: "2026-10-01",
      p_accounting_treatment: "NEW_CASH",
      p_status: "confirmed",
      p_type: "Wire",
      p_notes: "Oct Wire",
      p_idempotency_key: "dep_key_oct_stout",
      p_created_by: "test"
    });
    assert.equal(depResReplay.data.status, "IDEMPOTENT_REPLAY");
    assert.equal(depResReplay.data.deposit_id, depRes1.data.deposit_id);

    const depResMismatch = await db.rpc("create_deposit_atomic", {
      p_investor_id: "inv_cash_test",
      p_account_id: "acc_cash_test",
      p_amount: 9999,
      p_date: "2026-10-01",
      p_effective_date: "2026-10-01",
      p_accounting_treatment: "NEW_CASH",
      p_status: "confirmed",
      p_type: "Wire",
      p_notes: "Mismatch",
      p_idempotency_key: "dep_key_oct_stout",
      p_created_by: "test"
    });
    assert.match(depResMismatch.error?.message || "", /IDEMPOTENCY_KEY_PAYLOAD_MISMATCH/);
    console.log("   PASS: Physical delete prohibition & deposit idempotency/conflict enforcement verified.");

    // -------------------------------------------------------------------------
    // 3. Available equity, p_is_draw create & 10-arg update_withdrawal_atomic
    // -------------------------------------------------------------------------
    // Verify SQL equity omits HISTORICAL_PROVENANCE ($900k) and equals settled M9 ending ($3,334,258.56)
    const eqStout = await db.rpc("calculate_available_withdrawal_equity_sql", {
      p_investor_id: "stout001",
      p_account_id: "stout001",
      p_effective_date: "2026-10-01",
      p_exclude_withdrawal_id: null
    });
    assert.equal(Number(eqStout.data), 3334258.56);

    const wdStout = await db.rpc("create_withdrawal_atomic", {
      p_investor_id: "stout001",
      p_account_id: "stout001",
      p_amount: 70000,
      p_effective_date: "2026-10-01",
      p_status: "Completed",
      p_notes: "Oct Wire Payout",
      p_idempotency_key: "wd_key_oct_stout",
      p_created_by: "test",
      p_allow_duplicate_amount: false,
      p_is_draw: false
    });
    assert.equal(wdStout.error, null, wdStout.error?.message);
    assert.equal(wdStout.data.is_draw, false);

    // Bennion recurring draw withdrawal via create_withdrawal_atomic(p_is_draw=true) then 10-arg update_withdrawal_atomic
    const wdBen = await db.rpc("create_withdrawal_atomic", {
      p_investor_id: "inv_65b7fbd9",
      p_account_id: "jbennion",
      p_amount: 21500,
      p_effective_date: "2026-10-01",
      p_status: "Pending",
      p_notes: "Oct Draw Pending",
      p_idempotency_key: "wd_key_oct_bennion",
      p_created_by: "test",
      p_allow_duplicate_amount: false,
      p_is_draw: true
    });
    assert.equal(wdBen.error, null, wdBen.error?.message);
    assert.equal(wdBen.data.is_draw, true);

    const updBen = await db.rpc("update_withdrawal_atomic", {
      p_withdrawal_id: wdBen.data.withdrawal_id,
      p_amount: 21500,
      p_status: "Completed",
      p_notes: "Oct Draw Paid",
      p_updated_by: "admin_e2e",
      p_effective_date: "2026-10-01",
      p_year: 2026,
      p_month_number: 10,
      p_month: "October",
      p_is_draw: true
    });
    assert.equal(updBen.error, null, updBen.error?.message);
    assert.equal(updBen.data.is_draw, true);
    assert.equal(updBen.data.withdrawal.status, "Completed");

    // Reject Completed -> Pending transition
    const illegalTransition = await db.rpc("update_withdrawal_atomic", {
      p_withdrawal_id: wdBen.data.withdrawal_id,
      p_status: "Pending"
    });
    assert.match(illegalTransition.error?.message || "", /INVALID_STATUS_TRANSITION/);
    await assert.rejects(
      pool.query("DELETE FROM withdrawals"),
      /PHYSICAL_DELETION_PROHIBITED/,
      "Physical DELETE must be blocked on withdrawals"
    );
    console.log("   PASS: SQL equity check, 10-arg p_is_draw create/update RPC, delete block & state machine verified.");

    // -------------------------------------------------------------------------
    // 4. Commission Share Overlap & 100% Pool DB Trigger Enforcement
    // -------------------------------------------------------------------------
    // Overlap on same recipient jbennion -> stout001 must fail
    await assert.rejects(
      pool.query(`
        INSERT INTO commission_shares (source_investor_id, recipient_investor_id, commission_percent, effective_start_date, status)
        VALUES ('inv_65b7fbd9', 'stout001', 5, '2026-08-01', 'active')
      `),
      /OVERLAPPING_COMMISSION_SHARE/
    );
    // Pool overflow: split 66.6 + existing 11.4 + new 25 = 103 > 100 must fail
    await assert.rejects(
      pool.query(`
        INSERT INTO commission_shares (source_investor_id, recipient_investor_id, commission_percent, effective_start_date, status)
        VALUES ('inv_65b7fbd9', 'inv_other', 25, '2026-08-01', 'active')
      `),
      /COMMISSION_ALLOCATION_EXCEEDS_100_PCT/
    );
    console.log("   PASS: commission_shares DB overlap & 100% pool triggers verified.");

    // -------------------------------------------------------------------------
    // 5. Payment Provider Webhook HMAC Auth, Replay Idempotency & Draw Flag
    // -------------------------------------------------------------------------
    {
      const { req, res } = makeReqRes({ body: {}, headers: {} });
      await paymentWebhookHandler(req, res, { supabase: db, webhookSecret: "" });
      assert.equal(res.statusCode, 503);
    }
    {
      const payload = {
        provider: "mercury",
        provider_event_id: "evt_nov_dep_001",
        event_type: "deposit.settled",
        resource_type: "deposit",
        investor_id: "inv_cash_test",
        account_id: "acc_cash_test",
        amount: 5000,
        effective_date: "2026-11-01"
      };
      const signed = signWebhookPayload(webhookSecret, payload);
      const { req: badReq, res: badRes } = makeReqRes({
        body: payload,
        rawBody: signed.rawBody,
        headers: { ...signed.headers, "x-webhook-signature": "sha256=" + "0".repeat(64) }
      });
      await paymentWebhookHandler(badReq, badRes, { supabase: db, webhookSecret });
      assert.equal(badRes.statusCode, 401);

      const { req, res } = makeReqRes({
        body: payload,
        rawBody: signed.rawBody,
        headers: signed.headers
      });
      await paymentWebhookHandler(req, res, { supabase: db, webhookSecret });
      assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
      assert.equal(res.payload.idempotentReplay, false);

      // Replay exact webhook event -> 200 idempotentReplay=true, still single DB row
      const { req: req2, res: res2 } = makeReqRes({
        body: payload,
        rawBody: signed.rawBody,
        headers: signed.headers
      });
      await paymentWebhookHandler(req2, res2, { supabase: db, webhookSecret });
      assert.equal(res2.statusCode, 200);
      assert.equal(res2.payload.idempotentReplay, true);
      assert.equal(res2.payload.resource_id, res.payload.resource_id);
    }
    console.log("   PASS: Webhook HMAC fail-closed auth & exactly-once idempotency verified.");

    // -------------------------------------------------------------------------
    // 6. Freeze Return -> Atomic Finalization via finalize_monthly_accounting_v2 RPC
    // -------------------------------------------------------------------------
    process.env.ACCOUNTING_RETURN_FREEZE_ENABLED = "true";
    process.env.ACCOUNTING_FINALIZATION_ENABLED = "true";
    {
      const { req, res } = makeReqRes({
        cookie: adminCookie,
        body: { year: 2026, month: 10, grossReturnPct: 3.05, source: "MYFXBOOK_COMPLETED_MONTH" }
      });
      await freezeHandler(req, res, { supabase: db });
      assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    }

    let dryManifest;
    {
      const { req, res } = makeReqRes({
        cookie: adminCookie,
        body: { year: 2026, month: 10, dryRun: true }
      });
      await finalizeHandler(req, res, { supabase: db });
      assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
      dryManifest = res.payload.manifest;
    }

    {
      const { req, res } = makeReqRes({
        cookie: adminCookie,
        body: { year: 2026, month: 10, dryRun: false, inputHash: dryManifest.inputHash }
      });
      await finalizeHandler(req, res, { supabase: db });
      assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
      assert.equal(res.payload.status, "SUCCESS_FINALIZED");
    }

    // Confirm legacy premature M10 commission was SUPERSEDED and new ACTIVE row inserted
    const { rows: m10Comms } = await pool.query(
      "SELECT status, amount FROM commission_earnings WHERE year = 2026 AND month_number = 10 ORDER BY amount"
    );
    const superseded = m10Comms.filter((r) => r.status === "SUPERSEDED");
    const active = m10Comms.filter((r) => r.status === "ACTIVE");
    assert.equal(superseded.length, 1);
    assert.equal(Number(superseded[0].amount), 999.99);
    assert.equal(active.length, 1);
    assert.ok(Number(active[0].amount) > 9000);
    console.log("   PASS: Atomic finalize_monthly_accounting_v2 RPC committed & superseded legacy M10 row.");

    // -------------------------------------------------------------------------
    // 7. PERIOD_LOCKED Protection on M10 Deposits, Withdrawals, Webhook & Ledgers
    // -------------------------------------------------------------------------
    await assert.rejects(
      pool.query(`INSERT INTO deposits (id, investor_id, account_id, amount, type, status, date, effective_accounting_date) VALUES ('dep_lock_test', 'stout001', 'stout001', 100, 'Wire', 'confirmed', '2026-10-12', '2026-10-12')`),
      /PERIOD_LOCKED/
    );
    {
      const lockPayload = {
        provider: "mercury",
        provider_event_id: "evt_locked_oct",
        event_type: "deposit.settled",
        resource_type: "deposit",
        investor_id: "stout001",
        account_id: "stout001",
        amount: 100,
        effective_date: "2026-10-15"
      };
      const signedLock = signWebhookPayload(webhookSecret, lockPayload);
      const { req, res } = makeReqRes({
        body: lockPayload,
        rawBody: signedLock.rawBody,
        headers: signedLock.headers
      });
      await paymentWebhookHandler(req, res, { supabase: db, webhookSecret });
      assert.equal(res.statusCode, 409);
      assert.equal(res.payload.error, "PERIOD_LOCKED");
    }
    console.log("   PASS: PERIOD_LOCKED SQL & API guards reject post-close cashflow backdating.");

    // -------------------------------------------------------------------------
    // 8. Scheduled Month-End Close Cron Idempotency & Auto-Close Gate
    // -------------------------------------------------------------------------
    process.env.CRON_SECRET = "cron_secret_e2e";
    process.env.AUTO_MONTH_END_CLOSE_ENABLED = "false";
    {
      // Checking Nov 2026 while clock is 2026-12-01 -> shadow preview mode (0 DB writes)
      const { req, res } = makeReqRes({
        method: "POST",
        query: { asOfDate: "2026-12-01T12:00:00Z" },
        headers: { authorization: "Bearer cron_secret_e2e" }
      });
      await cronMonthEndCloseHandler(req, res, { supabase: db });
      assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
      assert.equal(res.payload.mode, "SHADOW_PREVIEW_ONLY");
      assert.equal(res.payload.targetMonth, 11);
    }
    {
      // Already finalized M10 -> skipped idempotently
      const { req, res } = makeReqRes({
        method: "POST",
        query: { year: "2026", month: "10", asOfDate: "2026-12-01T12:00:00Z" },
        headers: { authorization: "Bearer cron_secret_e2e" }
      });
      await cronMonthEndCloseHandler(req, res, { supabase: db });
      assert.equal(res.statusCode, 200);
      assert.equal(res.payload.skipped, true);
      assert.equal(res.payload.reason, "ALREADY_FINALIZED");
    }
    console.log("   PASS: Month-end close cron shadow gate & idempotent replay verified.");

    // -------------------------------------------------------------------------
    // 9. Daily Reconciler Passes Dynamic Checks on Open November Without Hardcoding Alerts
    // -------------------------------------------------------------------------
    {
      const recon = await executeDailyFinancialReconciliation({
        asOfDate: "2026-11-14T12:00:00Z",
        supabaseClient: db
      });
      assert.equal(recon.status, "PASS", JSON.stringify(recon.alerts));
      assert.equal(recon.anomalyCounts.P0, 0);
      assert.equal(recon.anomalyCounts.P1, 0);
      assert.equal(recon.alerts.some((a) => a.category === "FUTURE_DATED_DEPOSIT_PRESENT"), false);
    }
    console.log("   PASS: Dynamic daily reconciler PASS in November with 0 false future-date alerts.");

    console.log("\n================================================================================");
    console.log("ALL UNIFIED REMEDIATION EMBEDDED POSTGRES TESTS PASSED (100%)");
    console.log("================================================================================");
  } finally {
    await pool?.end().catch(() => {});
    await postgres.stop().catch(() => {});
    try {
      fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      // Ignore transient Windows lock on cleanup
    }
  }
}

runTestSuite()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("FATAL UNIFIED TEST FAILURE:", err);
    process.exit(1);
  });
