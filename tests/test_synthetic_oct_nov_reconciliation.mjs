/**
 * TRACK 2B — DETERMINISTIC SYNTHETIC OCTOBER -> NOVEMBER RECONCILIATION SUITE
 *
 * 100% Offline / Local Execution (Zero Production Credentials, Zero Network, Zero Myfxbook).
 * Runs against EmbeddedPostgres with production schema + 20261114 migration RPCs & triggers.
 *
 * Cohort (100% conserving source + recipient commission splits):
 *   TEST_A: Opening Oct $100,000, 80% split (10% -> TEST_R1, 10% -> TEST_R2) -> $600 comm on +3%
 *   TEST_B: Opening Oct $50,000, 90% split (10% -> TEST_R1)                 -> $150 comm on +3%
 *   TEST_C: Opening Oct $25,000, 100% split                                 -> $0 comm
 *   TEST_R1: Opening Oct $0, 100% split, commission recipient               -> +$450 Nov cap ($300 A + $150 B)
 *   TEST_R2: Opening Oct $0, 100% split, commission recipient               -> +$300 Nov cap ($300 A)
 *   Plus isolated extensions for TEST_NOV_START (2026-11-01) and TEST_MID_START (2026-10-15).
 *
 * Run:
 *   node tests/test_synthetic_oct_nov_reconciliation.mjs
 */

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import Decimal from "decimal.js";
import EmbeddedPostgres from "embedded-postgres";
import { createSession } from "../lib/auth.js";
import { buildInvestorDashboard } from "../lib/dashboard.js";
import { normalizeRow } from "../lib/supabase.js";
import {
  calculateInvestorMonth,
  calculateTotalExternalCash,
  calculateLifetimePerformance,
  calculateLifetimeSettledWithdrawals
} from "../lib/accounting-engine.js";
import { calculateAccountingPeriod } from "../lib/accounting-period-engine.js";
import { getFundAccountingDate, evaluateMonthState, MonthState } from "../lib/month-state.js";
import { executeDailyFinancialReconciliation } from "../lib/daily-reconciliation-engine.js";
import freezeHandler from "../api/admin/accounting/return/freeze/index.js";
import finalizeHandler from "../api/admin/accounting/finalize/index.js";
import cronMonthEndCloseHandler from "../api/cron/month-end-close.js";

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

const { Pool } = pg;
pg.types.setTypeParser(1082, (val) => val);
pg.types.setTypeParser(1700, (val) => (val === null ? null : Number(val)));

const RPC_SPECS = {
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
  ],
  calculate_available_withdrawal_equity_sql: [
    ["p_investor_id", "text"],
    ["p_account_id", "text"],
    ["p_effective_date", "date"],
    ["p_exclude_withdrawal_id", "text"]
  ]
};

function createPgSupabaseWithRpcAdapter(pool) {
  function sanitizeIdent(name) {
    if (!/^[a-zA-Z0-9_]+$/.test(name)) throw new Error(`Unsafe SQL identifier: ${name}`);
    return `"${name}"`;
  }

  class QueryBuilder {
    constructor(table) {
      this.table = sanitizeIdent(table);
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
          if (this.singleRow || this.maybeSingleRow) return { data: rows[0] || null, error: null };
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
          if (this.singleRow || this.maybeSingleRow) return { data: out[0] || null, error: null };
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
          return { data: null, error: { code: "PGRST202", message: `Function ${fnName} not mapped in test adapter` } };
        }
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

function makeReqRes({ method = "POST", body = {}, query = {}, cookie = "", headers = {} }) {
  const req = { method, body, query, headers: { cookie, ...headers } };
  const res = {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(data) { this.payload = data; return this; }
  };
  return { req, res };
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

async function loadSnapshotFromPg(pool) {
  const [inv, acc, mr, dep, wd, cs, hist, ce, cr, cut] = await Promise.all([
    pool.query("SELECT * FROM investors"),
    pool.query("SELECT * FROM investor_accounts"),
    pool.query("SELECT * FROM monthly_returns"),
    pool.query("SELECT * FROM deposits"),
    pool.query("SELECT * FROM withdrawals"),
    pool.query("SELECT * FROM commission_shares"),
    pool.query("SELECT * FROM investor_monthly_history"),
    pool.query("SELECT * FROM commission_earnings"),
    pool.query("SELECT * FROM commission_rules"),
    pool.query("SELECT * FROM account_cutover_adjustments")
  ]);
  return {
    rawInvestors: inv.rows.map(normalizeRow),
    accounts: acc.rows.map(normalizeRow),
    returnsSheet: mr.rows.map(normalizeRow),
    depositsSheet: dep.rows.map(normalizeRow),
    withdrawalsSheet: wd.rows.map(normalizeRow),
    commissionSharesTable: cs.rows.map(normalizeRow),
    historyTable: hist.rows.map(normalizeRow),
    commissionEarningsTable: ce.rows.map(normalizeRow),
    commissionRulesTable: cr.rows.map(normalizeRow),
    cutovers: cut.rows.map(normalizeRow),
    live: { today: "0%", week: "0%", month: "0%", year: "0%" }
  };
}

async function seedSyntheticCohort(pool) {
  const xferUuid = "00000000-0000-4000-8000-000000000901";

  await pool.query(`
    INSERT INTO investors (id, first_name, last_name, portal_username, active, split_pct, monthly_draw, start_date, role) VALUES
      ('TEST_A', 'Synthetic', 'Alpha', 'test_a', true, 80, 0, '2026-01-01', 'Investor'),
      ('TEST_B', 'Synthetic', 'Beta', 'test_b', true, 90, 0, '2026-01-01', 'Investor'),
      ('TEST_C', 'Synthetic', 'Gamma', 'test_c', true, 100, 0, '2026-01-01', 'Investor'),
      ('TEST_R1', 'Synthetic', 'RecOne', 'test_r1', true, 100, 0, '2026-01-01', 'Investor'),
      ('TEST_R2', 'Synthetic', 'RecTwo', 'test_r2', true, 100, 0, '2026-01-01', 'Investor');

    INSERT INTO investor_accounts (id, investor_id, name, starting_capital, status, open_date, is_commission, external_cash_provenance_status) VALUES
      ('ACC_A', 'TEST_A', 'Synthetic A', 100000, 'Active', '2026-01-01', false, 'COMPLETE'),
      ('ACC_B', 'TEST_B', 'Synthetic B', 50000, 'Active', '2026-01-01', false, 'COMPLETE'),
      ('ACC_C', 'TEST_C', 'Synthetic C', 25000, 'Active', '2026-01-01', false, 'COMPLETE'),
      ('ACC_R1', 'TEST_R1', 'Synthetic R1', 0, 'Active', '2026-01-01', true, 'COMPLETE'),
      ('ACC_R2', 'TEST_R2', 'Synthetic R2', 0, 'Active', '2026-01-01', true, 'COMPLETE');

    -- Effective Oct 1 commission rules totaling 100% per source:
    -- TEST_A: 80% source + 10% TEST_R1 + 10% TEST_R2 (produces $600 commission on +3% = $300 each)
    -- TEST_B: 90% source + 10% TEST_R1                 (produces $150 commission on +3% to R1)
    INSERT INTO commission_shares (id, source_investor_id, recipient_investor_id, commission_percent, effective_start_date, effective_end_date, status) VALUES
      ('33333333-3333-4333-8333-333333333301', 'TEST_A', 'TEST_R1', 10, '2026-10-01', NULL, 'active'),
      ('33333333-3333-4333-8333-333333333302', 'TEST_A', 'TEST_R2', 10, '2026-10-01', NULL, 'active'),
      ('33333333-3333-4333-8333-333333333303', 'TEST_B', 'TEST_R1', 10, '2026-10-01', NULL, 'active');

    -- Settled September ending balances = Oct 1 opening capital ($100k, $50k, $25k, $0, $0 = $175,000)
    INSERT INTO investor_monthly_history (investor_id, year, month_number, month, opening_balance, deposits, withdrawals, gross_return_pct, recurring_draw, ending_balance, is_manual, locked) VALUES
      ('TEST_A', 2026, 9, 'September', 100000, 0, 0, 0, 0, 100000, false, true),
      ('TEST_B', 2026, 9, 'September', 50000, 0, 0, 0, 0, 50000, false, true),
      ('TEST_C', 2026, 9, 'September', 25000, 0, 0, 0, 0, 25000, false, true),
      ('TEST_R1', 2026, 9, 'September', 0, 0, 0, 0, 0, 0, false, true),
      ('TEST_R2', 2026, 9, 'September', 0, 0, 0, 0, 0, 0, false, true),
      -- Open October placeholder rows (unlocked, 0 settled gain prior to close)
      ('TEST_A', 2026, 10, 'October', 100000, 0, 0, 0, 0, 100000, false, false),
      ('TEST_B', 2026, 10, 'October', 50000, 0, 0, 0, 0, 50000, false, false),
      ('TEST_C', 2026, 10, 'October', 25000, 0, 0, 0, 0, 25000, false, false),
      ('TEST_R1', 2026, 10, 'October', 0, 0, 0, 0, 0, 0, false, false),
      ('TEST_R2', 2026, 10, 'October', 0, 0, 0, 0, 0, 0, false, false);

    INSERT INTO monthly_returns (year, month_number, month, gross_return_pct, source, locked, last_updated) VALUES
      (2026, 9, 'September', 3.07, 'Mocked Seed', true, '2026-10-01T08:00:00Z'),
      (2026, 10, 'October', 3.00, 'Mocked Benchmark Return', false, '2026-10-31T23:59:59Z'),
      (2026, 11, 'November', 0, 'Mocked Open Return', false, ''),
      (2026, 12, 'December', 0, 'Mocked Future Return', false, '');

    -- External provenance baseline ($175,000 total) + Nov 1 NEW_CASH +$5,000 + Nov 1 $10k INTERNAL_TRANSFER
    INSERT INTO deposits (id, investor_id, account_id, amount, type, status, date, effective_accounting_date, accounting_treatment, is_commission, transfer_id) VALUES
      ('syn_prov_a', 'TEST_A', 'ACC_A', 100000, 'Historical Outside Cash', 'confirmed', '2026-01-01', '2026-01-01', 'HISTORICAL_PROVENANCE', false, NULL),
      ('syn_prov_b', 'TEST_B', 'ACC_B', 50000, 'Historical Outside Cash', 'confirmed', '2026-01-01', '2026-01-01', 'HISTORICAL_PROVENANCE', false, NULL),
      ('syn_prov_c', 'TEST_C', 'ACC_C', 25000, 'Historical Outside Cash', 'confirmed', '2026-01-01', '2026-01-01', 'HISTORICAL_PROVENANCE', false, NULL),
      ('syn_dep_b_nov', 'TEST_B', 'ACC_B', 5000, 'Wire', 'confirmed', '2026-11-01', '2026-11-01', 'NEW_CASH', false, NULL),
      ('syn_dep_b_xfer', 'TEST_B', 'ACC_B', 10000, 'Internal Transfer', 'confirmed', '2026-11-01', '2026-11-01', 'INTERNAL_TRANSFER', false, '${xferUuid}');

    -- Nov 1 settled withdrawals: TEST_C -$2,000 outside withdrawal + TEST_A -$10,000 linked transfer debit (no unspecified recipient withdrawals)
    INSERT INTO withdrawals (id, investor_id, account_id, amount, status, request_date, effective_accounting_date, year, month_number, month, is_draw, transfer_id) VALUES
      ('syn_wd_c_nov', 'TEST_C', 'ACC_C', 2000, 'Completed', '2026-11-01', '2026-11-01', 2026, 11, 'November', false, NULL),
      ('syn_wd_a_xfer', 'TEST_A', 'ACC_A', 10000, 'Completed', '2026-11-01', '2026-11-01', 2026, 11, 'November', false, '${xferUuid}');

    -- Legacy superseded Oct row to confirm Open Oct fail-closed + Clean Finalization supersede
    INSERT INTO commission_earnings (recipient_id, source_investor_id, year, month_number, amount, status, ledger_key, created_at) VALUES
      ('TEST_R1', 'TEST_A', 2026, 10, 99.00, 'SUPERSEDED', 'syn_legacy_sup_r1', '2026-10-01T00:00:00Z');
  `);
}

async function runTests() {
  console.log("=== TRACK 2B: DETERMINISTIC SYNTHETIC OCT -> NOV RECONCILIATION SUITE ===");

  // Strictly offline: clear any remote env vars
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SESSION_SECRET = "synthetic-offline-session-secret";
  process.env.DATA_SOURCE = "supabase";
  process.env.ACCOUNTING_RETURN_FREEZE_ENABLED = "true";
  process.env.ACCOUNTING_FINALIZATION_ENABLED = "true";
  process.env.AUTO_MONTH_END_CLOSE_ENABLED = "true";
  process.env.CRON_SECRET = "synthetic-cron-secret";

  // ---------------------------------------------------------------------------
  // 1. America/Los_Angeles DST & Month-Boundary Assertions
  // ---------------------------------------------------------------------------
  console.log("\n[1] Testing America/Los_Angeles PDT/PST month-boundary semantics...");
  {
    // Oct 31 23:59:59 PDT == 2026-11-01T06:59:59Z
    const preNov = getFundAccountingDate("2026-11-01T06:59:59Z");
    assert.strictEqual(preNov.year, 2026);
    assert.strictEqual(preNov.monthNumber, 10);
    assert.strictEqual(preNov.day, 31);
    assert.strictEqual(evaluateMonthState(2026, 10, "2026-11-01T06:59:59Z"), MonthState.CURRENT_OPEN);

    // Nov 1 00:00:00 PDT == 2026-11-01T07:00:00Z
    const atNov = getFundAccountingDate("2026-11-01T07:00:00Z");
    assert.strictEqual(atNov.year, 2026);
    assert.strictEqual(atNov.monthNumber, 11);
    assert.strictEqual(atNov.day, 1);
    assert.strictEqual(evaluateMonthState(2026, 10, "2026-11-01T07:00:00Z"), MonthState.HISTORICAL_SETTLED);
    assert.strictEqual(evaluateMonthState(2026, 11, "2026-11-01T07:00:00Z"), MonthState.CURRENT_OPEN);

    // Nov 30 23:59:59 PST (UTC-8 after DST ends!) == 2026-12-01T07:59:59Z
    const preDec = getFundAccountingDate("2026-12-01T07:59:59Z");
    assert.strictEqual(preDec.monthNumber, 11);
    assert.strictEqual(preDec.day, 30);
    assert.strictEqual(evaluateMonthState(2026, 11, "2026-12-01T07:59:59Z"), MonthState.CURRENT_OPEN);

    // Dec 1 00:00:00 PST == 2026-12-01T08:00:00Z
    const atDec = getFundAccountingDate("2026-12-01T08:00:00Z");
    assert.strictEqual(atDec.monthNumber, 12);
    assert.strictEqual(evaluateMonthState(2026, 11, "2026-12-01T08:00:00Z"), MonthState.HISTORICAL_SETTLED);
    console.log("  PASS: PDT/PST month transitions exact to the second.");
  }

  // ---------------------------------------------------------------------------
  // 2. EmbeddedPostgres Lifecycle + Migration + Full Oct Open -> Close -> Nov Rollover
  // ---------------------------------------------------------------------------
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "forexpage-syn-oct-nov-pg-"));
  const port = 54348;
  const password = "syn-offline-pg-password";
  const postgres = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "postgres",
    password,
    port,
    persistent: false
  });

  const adminToken = createSession({ adminId: "syn_admin_audit", role: "admin" });
  const adminCookie = `scff_admin_session=${encodeURIComponent(adminToken)}`;
  let pool;

  try {
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
    await seedSyntheticCohort(pool);
    const db = createPgSupabaseWithRpcAdapter(pool);

    // 2A. Reject premature close before period end via cronMonthEndCloseHandler
    console.log("\n[2] Testing premature close rejections...");
    {
      const { req, res } = makeReqRes({
        method: "POST",
        query: { year: "2026", month: "10", asOfDate: "2099-01-01T00:00:00Z", force: "true" },
        body: { asOfDate: "2099-01-01T00:00:00Z", force: true },
        headers: { authorization: "Bearer synthetic-cron-secret" }
      });
      // Oct 31 23:59:59 PDT via deps -> PERIOD_NOT_HISTORICAL_SETTLED (422), HTTP overrides ignored
      await cronMonthEndCloseHandler(req, res, {
        supabase: db,
        asOfDate: "2026-11-01T06:59:59Z",
        dispatchAdministratorAlert: async () => {},
        alertDispatcher: async () => {}
      });
      assert.strictEqual(res.statusCode, 422);
      assert.strictEqual(res.payload.error, "PERIOD_NOT_HISTORICAL_SETTLED");

      // Nov 15 trying to close Nov via deps -> PERIOD_NOT_HISTORICAL_SETTLED (422), HTTP overrides ignored
      const { req: reqNov, res: resNov } = makeReqRes({
        method: "POST",
        query: { year: "2026", month: "11", asOfDate: "2099-01-01T00:00:00Z", force: "true" },
        body: { asOfDate: "2099-01-01T00:00:00Z", force: true },
        headers: { authorization: "Bearer synthetic-cron-secret" }
      });
      await cronMonthEndCloseHandler(reqNov, resNov, {
        supabase: db,
        asOfDate: "2026-11-15T12:00:00Z",
        dispatchAdministratorAlert: async () => {},
        alertDispatcher: async () => {}
      });
      assert.strictEqual(resNov.statusCode, 422);
      assert.strictEqual(resNov.payload.error, "PERIOD_NOT_HISTORICAL_SETTLED");

      // Direct admin freezeHandler rejects incomplete periods under America/Los_Angeles BEFORE any mutation (no request override)
      let finalizeLoaderCalls = 0;
      const instrumentedLoader = async (args) => {
        finalizeLoaderCalls += 1;
        throw new Error("Should not load data when period-state guard fails");
      };

      // Oct 31 23:59:59 PDT -> Oct is still CURRENT_OPEN -> 422 PERIOD_NOT_HISTORICAL_SETTLED
      {
        const { req: reqFrzOctEarly, res: resFrzOctEarly } = makeReqRes({
          method: "POST",
          body: {
            year: 2026,
            month: 10,
            grossReturnPct: 3.00,
            source: "MYFXBOOK_COMPLETED_MONTH",
            asOfDate: "2099-01-01T00:00:00Z", // attempt client override must be ignored
            override: true
          },
          cookie: adminCookie
        });
        await freezeHandler(reqFrzOctEarly, resFrzOctEarly, {
          supabase: db,
          asOfDate: "2026-11-01T06:59:59Z"
        });
        assert.strictEqual(resFrzOctEarly.statusCode, 422);
        assert.strictEqual(resFrzOctEarly.payload.error, "PERIOD_NOT_HISTORICAL_SETTLED");
      }

      let freezeDbTouched = 0;
      const neverTouchDb = {
        from() {
          freezeDbTouched += 1;
          throw new Error("DB must not be touched when period-state guard rejects");
        }
      };

      // Current month Nov 2026 when now = 2026-11-15 -> CURRENT_OPEN -> 422 PERIOD_NOT_HISTORICAL_SETTLED (zero DB touch)
      {
        const { req: reqFrzNov, res: resFrzNov } = makeReqRes({
          method: "POST",
          body: { year: 2026, month: 11, grossReturnPct: 1.25, source: "MYFXBOOK_COMPLETED_MONTH" },
          cookie: adminCookie
        });
        await freezeHandler(reqFrzNov, resFrzNov, {
          supabase: neverTouchDb,
          asOfDate: "2026-11-15T12:00:00Z"
        });
        assert.strictEqual(resFrzNov.statusCode, 422);
        assert.strictEqual(resFrzNov.payload.error, "PERIOD_NOT_HISTORICAL_SETTLED");
      }

      // Future period (live clock, no deps.asOfDate) -> FUTURE -> 422 PERIOD_NOT_HISTORICAL_SETTLED (zero DB touch)
      {
        const { req: reqFrzFuture, res: resFrzFuture } = makeReqRes({
          method: "POST",
          body: { year: 2099, month: 1, grossReturnPct: 1.00, source: "MYFXBOOK_COMPLETED_MONTH", override: true },
          cookie: adminCookie
        });
        await freezeHandler(reqFrzFuture, resFrzFuture, { supabase: neverTouchDb });
        assert.strictEqual(resFrzFuture.statusCode, 422);
        assert.strictEqual(resFrzFuture.payload.error, "PERIOD_NOT_HISTORICAL_SETTLED");
      }
      assert.strictEqual(freezeDbTouched, 0, "freezeHandler must reject incomplete periods before any DB call");

      // Direct admin finalizeHandler rejects incomplete periods (both dryRun=true & dryRun=false) BEFORE loader/mutations
      for (const testCase of [
        { year: 2026, month: 10, dryRun: true, asOfDate: "2026-11-01T06:59:59Z" },
        { year: 2026, month: 10, dryRun: false, asOfDate: "2026-11-01T06:59:59Z" },
        { year: 2026, month: 11, dryRun: true, asOfDate: "2026-11-15T12:00:00Z" },
        { year: 2026, month: 11, dryRun: false, asOfDate: "2026-11-15T12:00:00Z" },
        { year: 2099, month: 1, dryRun: false, asOfDate: null }
      ]) {
        const { req: reqFinEarly, res: resFinEarly } = makeReqRes({
          method: "POST",
          body: {
            year: testCase.year,
            month: testCase.month,
            dryRun: testCase.dryRun,
            asOfDate: "2099-01-01T00:00:00Z", // attempt client override must be ignored
            override: true
          },
          cookie: adminCookie
        });
        const depsFin = {
          supabase: neverTouchDb,
          loadAccountingData: instrumentedLoader
        };
        if (testCase.asOfDate) depsFin.asOfDate = testCase.asOfDate;
        await finalizeHandler(reqFinEarly, resFinEarly, depsFin);
        assert.strictEqual(resFinEarly.statusCode, 422);
        assert.strictEqual(resFinEarly.payload.error, "PERIOD_NOT_HISTORICAL_SETTLED");
      }
      assert.strictEqual(finalizeLoaderCalls, 0, "finalizeHandler must reject incomplete periods before loading or mutating DB");
      assert.strictEqual(freezeDbTouched, 0, "finalizeHandler must reject incomplete periods before any DB call");

      // Confirm zero DB writes occurred during rejected freeze/finalize calls
      const postRejectRet = await pool.query("SELECT month_number, gross_return_pct, locked FROM monthly_returns WHERE year=2026 AND month_number IN (10, 11) ORDER BY month_number");
      assert.strictEqual(postRejectRet.rows[0].locked, false);
      assert.strictEqual(postRejectRet.rows[1].locked, false);
      assert.strictEqual(postRejectRet.rows[1].gross_return_pct, 0);
      const postRejectPeriods = await pool.query("SELECT COUNT(*)::int AS cnt FROM accounting_periods");
      assert.strictEqual(postRejectPeriods.rows[0].cnt, 0);

      // Direct finalizeHandler also rejects unfrozen completed Oct return (422 RETURN_NOT_FROZEN) once Nov begins
      const { req: reqUnfrozen, res: resUnfrozen } = makeReqRes({
        method: "POST",
        body: { year: 2026, month: 10, dryRun: false },
        cookie: adminCookie
      });
      await finalizeHandler(reqUnfrozen, resUnfrozen, {
        supabase: db,
        asOfDate: "2026-11-15T12:00:00Z"
      });
      assert.strictEqual(resUnfrozen.statusCode, 422);
      assert.strictEqual(resUnfrozen.payload.error, "RETURN_NOT_FROZEN");
      console.log("  PASS: Rejected premature cron & direct admin freeze/finalize (422 PERIOD_NOT_HISTORICAL_SETTLED, zero mutations) and unfrozen finalize (422 RETURN_NOT_FROZEN).");
    }

    // 2B. Verify Open October state BEFORE close (dashboard parity check)
    console.log("\n[3] Verifying Open October pre-close dashboard behavior...");
    {
      const snapOpen = await loadSnapshotFromPg(pool);
      const dashA = await buildInvestorDashboard("TEST_A", snapOpen, { asOfDate: "2026-11-15T12:00:00Z" });
      const dashR1 = await buildInvestorDashboard("TEST_R1", snapOpen, { asOfDate: "2026-11-15T12:00:00Z" });

      const octA = dashA.breakdown.find(r => r.monthNumber === 10);
      const novA = dashA.breakdown.find(r => r.monthNumber === 11);
      assert.strictEqual(octA.gain, 0);
      assert.strictEqual(octA.pendingGain, 2400);
      assert.strictEqual(octA.pendingEffectiveReturnPct, 2.4);
      assert.strictEqual(octA.endingBalance, 100000);
      // Nov does NOT include Oct +$2,400 before close; includes Nov 1 -$10,000 transfer -> $90,000
      assert.strictEqual(novA.startingBalance, 100000);
      assert.strictEqual(novA.adjustedStartingBalance, 90000);

      // R1 has superseded Oct row & unfinalized Oct -> Booked Comm = 0 & unavailable, display/active = 0
      assert.strictEqual(dashR1.summary.bookedCommissionsEarnedMonth, 0);
      assert.strictEqual(dashR1.summary.commissionsUnavailable, true);
      const octR1 = dashR1.breakdown.find(r => r.monthNumber === 10);
      assert.strictEqual(octR1.displayCommissionsEarned, 0);
      assert.strictEqual(octR1.activeCommissionsEarned, 0);
      assert.strictEqual(octR1.commissionsEarned, 0);
      console.log("  PASS: Open Oct does not book unclosed gains/commissions into Nov.");
    }

    // 2C. Freeze + Dry-Run Preview + Atomic Close (October 2026 +3.00% Mock Return)
    console.log("\n[4] Freezing +3.00% Oct return and executing atomic close...");
    {
      const { req: reqFreeze, res: resFreeze } = makeReqRes({
        method: "POST",
        body: { year: 2026, month: 10, grossReturnPct: 3.00, source: "MYFXBOOK_COMPLETED_MONTH" },
        cookie: adminCookie
      });
      await freezeHandler(reqFreeze, resFreeze, { supabase: db, asOfDate: "2026-11-15T12:00:00Z" });
      assert.strictEqual(resFreeze.statusCode, 200);
      assert.strictEqual(resFreeze.payload.success, true);

      const { req: reqPreview, res: resPreview } = makeReqRes({
        method: "POST",
        body: { year: 2026, month: 10, dryRun: true },
        cookie: adminCookie
      });
      await finalizeHandler(reqPreview, resPreview, { supabase: db, asOfDate: "2026-11-15T12:00:00Z" });
      assert.strictEqual(resPreview.statusCode, 200);
      assert.strictEqual(resPreview.payload.manifest.controlEquations.controlCheck, "RECONCILED");
      assert.strictEqual(resPreview.payload.manifest.controlEquations.grossEligibleCapital, 175000);
      assert.strictEqual(resPreview.payload.manifest.controlEquations.totalGrossFundResult, 5250);
      assert.strictEqual(resPreview.payload.manifest.controlEquations.totalSourceGainLoss, 4500);
      assert.strictEqual(resPreview.payload.manifest.controlEquations.totalRecipientCommissions, 750);

      const { inputHash, previewRunId } = resPreview.payload.manifest;

      const { req: reqFin, res: resFin } = makeReqRes({
        method: "POST",
        body: { year: 2026, month: 10, dryRun: false, inputHash, previewRunId },
        cookie: adminCookie
      });
      await finalizeHandler(reqFin, resFin, { supabase: db, asOfDate: "2026-11-15T12:00:00Z" });
      assert.strictEqual(resFin.statusCode, 200);
      assert.strictEqual(resFin.payload.status, "SUCCESS_FINALIZED");
      console.log("  PASS: Atomic Oct close finalized cleanly via finalize_monthly_accounting_v2.");
    }

    // 2D. Verify Idempotent Replay (2nd finalize rejected 409 ALREADY_FINALIZED, zero extra rows)
    console.log("\n[5] Verifying idempotent close replay protection...");
    {
      const { req: reqReplay, res: resReplay } = makeReqRes({
        method: "POST",
        body: { year: 2026, month: 10, dryRun: false },
        cookie: adminCookie
      });
      await finalizeHandler(reqReplay, resReplay, { supabase: db, asOfDate: "2026-11-15T12:00:00Z" });
      assert.strictEqual(resReplay.statusCode, 409);
      assert.strictEqual(resReplay.payload.error, "ALREADY_FINALIZED");

      const commCountRes = await pool.query("SELECT COUNT(*)::int AS cnt FROM commission_earnings WHERE year=2026 AND month_number=10 AND status='ACTIVE'");
      assert.strictEqual(commCountRes.rows[0].cnt, 3); // Exactly 3 ACTIVE rows (A->R1 $300, A->R2 $300, B->R1 $150)
      const supCountRes = await pool.query("SELECT COUNT(*)::int AS cnt FROM commission_earnings WHERE year=2026 AND month_number=10 AND status='SUPERSEDED'");
      assert.strictEqual(supCountRes.rows[0].cnt, 1);
      const octHistCnt = await pool.query("SELECT COUNT(*)::int AS cnt FROM investor_monthly_history WHERE year=2026 AND month_number=10");
      const novHistCnt = await pool.query("SELECT COUNT(*)::int AS cnt FROM investor_monthly_history WHERE year=2026 AND month_number=11");
      assert.strictEqual(octHistCnt.rows[0].cnt, 5);
      assert.strictEqual(novHistCnt.rows[0].cnt, 5);
      console.log("  PASS: Second finalize returned 409 ALREADY_FINALIZED; single rollover & 3 ACTIVE commission rows verified.");
    }

    // 2E. Verify Post-Close History, Rollover, Dashboard Parity, and Exact Requested Reconciliation ($183,250)
    console.log("\n[6] Verifying post-close DB state, /api/me dashboard parity, and $183,250.00 reconciliation...");
    {
      const novHist = await pool.query(`
        SELECT investor_id, opening_balance, deposits, withdrawals, ending_balance, locked
        FROM investor_monthly_history WHERE year=2026 AND month_number=11 ORDER BY investor_id
      `);
      const byInv = Object.fromEntries(novHist.rows.map(r => [r.investor_id, r]));

      // Requested scenario exact outputs under 100%-conserving splits (80/10/10 A, 90/10 B, 100 C) with Nov 1 cashflows & 0 R1/R2 withdrawals:
      assert.strictEqual(byInv.TEST_A.opening_balance, 102400); // $100k + $2,400
      assert.strictEqual(byInv.TEST_A.withdrawals, 10000);       // Linked INTERNAL_TRANSFER debit
      assert.strictEqual(byInv.TEST_A.ending_balance, 92400);

      assert.strictEqual(byInv.TEST_B.opening_balance, 51350);  // $50k + $1,350
      assert.strictEqual(byInv.TEST_B.deposits, 15000);         // $5k NEW_CASH + $10k INTERNAL_TRANSFER credit
      assert.strictEqual(byInv.TEST_B.ending_balance, 66350);

      assert.strictEqual(byInv.TEST_C.opening_balance, 25750);  // $25k + $750
      assert.strictEqual(byInv.TEST_C.withdrawals, 2000);       // $2,000 settled withdrawal
      assert.strictEqual(byInv.TEST_C.ending_balance, 23750);

      assert.strictEqual(byInv.TEST_R1.opening_balance, 450);   // $300 A + $150 B capitalized Nov 1
      assert.strictEqual(byInv.TEST_R1.withdrawals, 0);
      assert.strictEqual(byInv.TEST_R1.ending_balance, 450);

      assert.strictEqual(byInv.TEST_R2.opening_balance, 300);   // $300 A capitalized Nov 1
      assert.strictEqual(byInv.TEST_R2.withdrawals, 0);
      assert.strictEqual(byInv.TEST_R2.ending_balance, 300);

      const engineFundNovSum = 92400 + 66350 + 23750 + 450 + 300;
      assert.strictEqual(engineFundNovSum, 183250);

      // Verify Dashboard payload parity for all 5 synthetic accounts
      const snapClosed = await loadSnapshotFromPg(pool);
      const expectedNovAdj = { TEST_A: 92400, TEST_B: 66350, TEST_C: 23750, TEST_R1: 450, TEST_R2: 300 };
      const expectedExtCash = { TEST_A: 100000, TEST_B: 55000, TEST_C: 25000, TEST_R1: 0, TEST_R2: 0 };

      let fundExternalTotal = 0;
      let fundDashboardSum = 0;

      for (const invId of ["TEST_A", "TEST_B", "TEST_C", "TEST_R1", "TEST_R2"]) {
        const dash = await buildInvestorDashboard(invId, snapClosed, { asOfDate: "2026-11-15T12:00:00Z" });
        const octRow = dash.breakdown.find(r => r.monthNumber === 10);
        const novRow = dash.breakdown.find(r => r.monthNumber === 11);

        assert.strictEqual(novRow.startingBalance, byInv[invId].opening_balance, `${invId} Nov opening parity`);
        assert.strictEqual(novRow.adjustedStartingBalance, expectedNovAdj[invId], `${invId} Nov adjustedStart parity`);
        assert.strictEqual(dash.summary.currentBalance, expectedNovAdj[invId], `${invId} summary.currentBalance parity`);
        assert.strictEqual(dash.summary.totalExternalCashSent, expectedExtCash[invId], `${invId} external cash (transfer excluded)`);
        assert.strictEqual(octRow.performancePendingClose, false);
        assert.strictEqual(octRow.displayCommissionsEarned, octRow.activeCommissionsEarned);

        fundExternalTotal += dash.summary.totalExternalCashSent;
        fundDashboardSum += dash.summary.currentBalance;
      }

      // Fund-level settled external cash & settled external withdrawals (paired INTERNAL_TRANSFER nets to $0) & zero residual
      const transferDepositIds = new Set(
        (snapClosed.depositsSheet || [])
          .filter(d => String(d.accounting_treatment || "").toUpperCase() === "INTERNAL_TRANSFER" && d.transfer_id)
          .map(d => String(d.transfer_id).trim())
      );
      const externalWithdrawalRows = (snapClosed.withdrawalsSheet || []).filter(
        w => !(w.transfer_id && transferDepositIds.has(String(w.transfer_id).trim()))
      );
      const settledExtWithdrawals = calculateLifetimeSettledWithdrawals({
        withdrawalRows: externalWithdrawalRows,
        asOfDate: "2026-11-30"
      });
      assert.strictEqual(settledExtWithdrawals.total, 2000); // Only TEST_C -$2,000; linked transfer is excluded
      assert.strictEqual(fundExternalTotal, 180000); // $175,000 + $5,000 (transfer contributes $0)
      assert.strictEqual(fundDashboardSum, 183250);
      const residual = fundDashboardSum - (175000 + 5250 + 5000 - settledExtWithdrawals.total);
      assert.strictEqual(residual, 0);

      // Total Performance contract under $2,000 settled withdrawals:
      // lib/accounting-engine.js computes currentBalance - totalExternalCashSent (net of settled withdrawals, without adding back withdrawals):
      // $183,250 - $180,000 = +$3,250.00 (+1.81%), vs $5,250 gross economic trading gain before $2,000 withdrawal.
      const perfEngine = calculateLifetimePerformance({
        totalExternalCashSent: 180000,
        hasConfirmedExternalCashRecords: true,
        currentBalance: 183250,
        provenanceCompletenessStatus: "COMPLETE"
      });
      assert.strictEqual(perfEngine.totalPerformanceDollar, 3250);
      assert.ok(Math.abs(perfEngine.totalPerformancePct - ((183250 - 180000) / 180000) * 100) < 1e-12);
      assert.strictEqual(perfEngine.totalPerformancePct.toFixed(2), "1.81");

      // Commission cards & breakdown capitalization line agree for R1 ($450) and R2 ($300)
      const dashR1 = await buildInvestorDashboard("TEST_R1", snapClosed, { asOfDate: "2026-11-15T12:00:00Z" });
      assert.strictEqual(dashR1.summary.bookedCommissionsEarnedMonth, 450);
      assert.strictEqual(dashR1.summary.commissionsEarnedMonth, 450);
      assert.strictEqual(dashR1.summary.commissionsUnavailable, false);
      assert.strictEqual(dashR1.summary.commMonthName, "October");
      assert.strictEqual(dashR1.breakdown.find(r => r.monthNumber === 10).displayCommissionsEarned, 450);

      const dashR2 = await buildInvestorDashboard("TEST_R2", snapClosed, { asOfDate: "2026-11-15T12:00:00Z" });
      assert.strictEqual(dashR2.summary.bookedCommissionsEarnedMonth, 300);
      assert.strictEqual(dashR2.summary.commissionsEarnedMonth, 300);
      assert.strictEqual(dashR2.breakdown.find(r => r.monthNumber === 10).displayCommissionsEarned, 300);

      // Post-close Period Lock DB Trigger Enforcement
      await assert.rejects(
        pool.query(`INSERT INTO deposits (investor_id, account_id, amount, status, date, effective_accounting_date, accounting_treatment) VALUES ('TEST_A', 'ACC_A', 1000, 'confirmed', '2026-10-01', '2026-10-01', 'NEW_CASH')`),
        /PERIOD_LOCKED/
      );
      await assert.rejects(
        pool.query(`UPDATE investor_monthly_history SET ending_balance = 999999 WHERE investor_id='TEST_A' AND year=2026 AND month_number=10`),
        /PERIOD_LOCKED/
      );

      // Daily Financial Reconciliation on finalized PG snapshot must PASS with 0 P0/P1
      const recon = await executeDailyFinancialReconciliation({
        supabaseClient: db,
        asOfDate: "2026-11-15T12:00:00Z"
      });
      assert.strictEqual(recon.status, "PASS", JSON.stringify(recon.alerts));
      assert.strictEqual(recon.anomalyCounts.P0, 0);
      assert.strictEqual(recon.anomalyCounts.P1, 0);

      console.log("  PASS: History, rollover, API/dashboard parity, Total Performance, Period Locks, and Reconciliation all verified.");
    }

    // -------------------------------------------------------------------------
    // 7. Same-Period (2026-10-01) Timing Test + Loss Month + Cent Rounding + Pre/Mid Starters + Draw RPC
    // -------------------------------------------------------------------------
    console.log("\n[7] Verifying same-period Oct-1 cashflow timing, loss month, rounding, and start_date policy...");
    {
      // 7A. Same-period (2026-10-01) cashflow rule puts cashflows BEFORE +3.00% Oct return:
      const samePeriodOct = calculateAccountingPeriod({
        year: 2026,
        month: 10,
        fundReturnPct: 3.00,
        investors: [
          { id: "TEST_A", split_pct: 80, monthly_draw: 0, start_date: "2026-01-01", active: true },
          { id: "TEST_B", split_pct: 90, monthly_draw: 0, start_date: "2026-01-01", active: true },
          { id: "TEST_C", split_pct: 100, monthly_draw: 0, start_date: "2026-01-01", active: true }
        ],
        accounts: [
          { id: "ACC_A", investor_id: "TEST_A", starting_capital: 100000, status: "Active" },
          { id: "ACC_B", investor_id: "TEST_B", starting_capital: 50000, status: "Active" },
          { id: "ACC_C", investor_id: "TEST_C", starting_capital: 25000, status: "Active" }
        ],
        deposits: [
          { investor_id: "TEST_B", amount: 5000, status: "confirmed", effective_accounting_date: "2026-10-01", accounting_treatment: "NEW_CASH" },
          { investor_id: "TEST_B", amount: 10000, status: "confirmed", effective_accounting_date: "2026-10-01", accounting_treatment: "INTERNAL_TRANSFER" }
        ],
        withdrawals: [
          { investor_id: "TEST_C", amount: 2000, status: "Completed", effective_accounting_date: "2026-10-01" },
          { investor_id: "TEST_A", amount: 10000, status: "Completed", effective_accounting_date: "2026-10-01" }
        ],
        commissionShares: [
          { id: "s1", source_investor_id: "TEST_A", recipient_investor_id: "TEST_R1", commission_percent: 10, effective_start_date: "2026-10-01", status: "active" },
          { id: "s2", source_investor_id: "TEST_A", recipient_investor_id: "TEST_R2", commission_percent: 10, effective_start_date: "2026-10-01", status: "active" },
          { id: "s3", source_investor_id: "TEST_B", recipient_investor_id: "TEST_R1", commission_percent: 10, effective_start_date: "2026-10-01", status: "active" }
        ],
        monthlyHistory: [],
        commissionEarnings: [],
        monthlyReturns: [{ year: 2026, month_number: 10, gross_return_pct: 3.00, locked: true }]
      });
      const spA = samePeriodOct.investors.find(i => i.investorId === "TEST_A");
      const spB = samePeriodOct.investors.find(i => i.investorId === "TEST_B");
      const spC = samePeriodOct.investors.find(i => i.investorId === "TEST_C");
      assert.strictEqual(spA.eligibleCapital, 90000);
      assert.strictEqual(spB.eligibleCapital, 65000);
      assert.strictEqual(spC.eligibleCapital, 23000);
      assert.strictEqual(samePeriodOct.summary.totalGrossFundResult, 5340); // 2700 + 1950 + 690

      // 7B. Loss Month (-2.00%): Zero recipient commissions, source absorbs split % only
      const lossRes = calculateInvestorMonth({
        year: 2026,
        month: 10,
        investorId: "TEST_A",
        startDate: "2026-01-01",
        priorEndingBalance: 100000,
        fundReturnPct: -2.00,
        sourceSplitPct: 70,
        commissionShares: [
          { recipient_investor_id: "TEST_R1", commission_percent: 15 },
          { recipient_investor_id: "TEST_R2", commission_percent: 15 }
        ]
      });
      assert.strictEqual(lossRes.totalRecipientCommissions, 0);
      assert.strictEqual(lossRes.sourceGainLoss, -1400); // -2000 * 70%
      assert.strictEqual(lossRes.endingBalance, 98600);

      // 7C. Penny Rounding Invariant Favoring Source ($333.33 @ +3.01% = $10.03 gross)
      const roundRes = calculateInvestorMonth({
        year: 2026,
        month: 10,
        investorId: "TEST_ROUND",
        startDate: "2026-01-01",
        priorEndingBalance: 333.33,
        fundReturnPct: 3.01,
        sourceSplitPct: 70,
        commissionShares: [
          { recipient_investor_id: "TEST_R1", commission_percent: 15 },
          { recipient_investor_id: "TEST_R2", commission_percent: 15 }
        ]
      });
      // Gross = 10.033233 -> 10.03; R1 = round(1.5045)=1.50; R2 = 1.50; Source remainder = 10.03 - 3.00 = 7.03 (vs naive 7.02)
      assert.strictEqual(roundRes.grossFundResult, 10.03);
      assert.strictEqual(roundRes.totalRecipientCommissions, 3.00);
      assert.strictEqual(roundRes.sourceGainLoss, 7.03);
      assert.strictEqual(roundRes.roundingAdjustment, 0.01);

      // 7D. Nov-1 Starter vs Mid-Month Starter (2026-10-15) + SQL Equity Guard Behavior
      const startPolicies = calculateAccountingPeriod({
        year: 2026,
        month: 10,
        fundReturnPct: 3.00,
        investors: [
          { id: "TEST_NOV_START", split_pct: 100, monthly_draw: 0, start_date: "2026-11-01", active: true },
          { id: "TEST_MID_START", split_pct: 50, monthly_draw: 0, start_date: "2026-10-15", active: true }
        ],
        accounts: [
          { id: "ACC_NS", investor_id: "TEST_NOV_START", starting_capital: 10000, status: "Active" },
          { id: "ACC_MS", investor_id: "TEST_MID_START", starting_capital: 8000, status: "Active" }
        ],
        monthlyReturns: [{ year: 2026, month_number: 10, gross_return_pct: 3.00, locked: true }]
      });
      const novStarter = startPolicies.investors.find(i => i.investorId === "TEST_NOV_START");
      const midStarter = startPolicies.investors.find(i => i.investorId === "TEST_MID_START");
      assert.strictEqual(novStarter.isPreStart, true);
      assert.strictEqual(novStarter.endingBalance, 0);
      assert.strictEqual(midStarter.isPreStart, false); // Documented policy: month-level start check, no proration
      assert.strictEqual(midStarter.grossFundResult, 240); // Full Oct 3.00% on $8,000

      // Seed mid-month starter into PG and test calculate_available_withdrawal_equity_sql
      await pool.query(`
        INSERT INTO investors (id, portal_username, split_pct, start_date, active) VALUES ('TEST_MID_START', 'mid', 50, '2026-10-15', true);
        INSERT INTO investor_accounts (id, investor_id, starting_capital, open_date, status) VALUES ('ACC_MS', 'TEST_MID_START', 8000, '2026-10-15', 'Active');
      `);
      const eqOct = await db.rpc("calculate_available_withdrawal_equity_sql", {
        p_investor_id: "TEST_MID_START",
        p_account_id: "ACC_MS",
        p_effective_date: "2026-10-01",
        p_exclude_withdrawal_id: null
      });
      // Because '2026-10-01' < '2026-10-15', SQL equity function returns $0.00 in start month when start_date day > 1!
      assert.strictEqual(eqOct.data, 0);

      console.log("  PASS: Timing rules, loss split, rounding remainder, start_date policies, and SQL equity check verified.");
    }

    console.log("\nTRACK 2B RESULT: ALL ASSERTIONS PASSED");
  } finally {
    const withTimeout = (p, ms = 3000) => Promise.race([p, new Promise(r => setTimeout(r, ms))]);
    if (pool) await withTimeout(pool.end().catch(() => {}));
    await withTimeout(postgres.stop().catch(() => {}));
    try {
      fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      // Ignore transient Windows temp directory lock during cleanup
    }
  }
}

runTests()
  .then(() => {
    process.exit(0);
  })
  .catch(err => {
    console.error("TRACK 2B FAILED:", err);
    process.exit(1);
  });
