/**
 * ISOLATED OFFLINE REGRESSION SUITE:
 * Cashflow Guards, Start-Date Metadata Alignment, Locked-Period Equity Warning,
 * HISTORICAL_PROVENANCE Locked-Period Deposit Fix, and Anti-Double-Entry DB/UI Hardening.
 *
 * 100% Offline / Isolated Temp EmbeddedPostgres (Zero Production Credentials).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import EmbeddedPostgres from "embedded-postgres";

delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.SUPABASE_ANON_KEY;
delete process.env.DATA_SOURCE;
process.env.SESSION_SECRET = "test_cashflow_guards_offline_secret";
process.env.ADMIN_USERNAME = "admin_test";

import { createSession } from "../lib/auth.js";
import { checkPeriodLock } from "../lib/period-lock-guard.js";
import depositsHandler from "../api/admin/deposits/index.js";
import equityHandler from "../api/admin/withdrawals/equity.js";

const { Pool } = pg;
pg.types.setTypeParser(1082, (val) => val);
pg.types.setTypeParser(1700, (val) => (val === null ? null : Number(val)));

function makeReqRes({ method = "POST", body = {}, query = {}, cookie = "" } = {}) {
  const req = { method, body, query, headers: { cookie } };
  const res = {
    statusCode: 200,
    headers: {},
    payload: null,
    setHeader(k, v) { this.headers[k] = v; return this; },
    status(code) { this.statusCode = code; return this; },
    json(data) { this.payload = data; return this; }
  };
  return { req, res };
}

function createPgSupabaseAdapter(pool) {
  function buildQuery(table) {
    const state = { filters: [], isNull: [], orderCol: null, orderAsc: true, limitN: null, op: "select", singleMode: null };
    const builder = {
      select() { return builder; },
      eq(col, val) { state.filters.push({ col, val }); return builder; },
      is(col, val) { state.isNull.push({ col, val }); return builder; },
      order(col, { ascending = true } = {}) { state.orderCol = col; state.orderAsc = ascending; return builder; },
      limit(n) { state.limitN = n; return builder; },
      single() { state.singleMode = "single"; return builder.thenExec(); },
      maybeSingle() { state.singleMode = "maybeSingle"; return builder.thenExec(); },
      then(resolve, reject) { return builder.thenExec().then(resolve, reject); },
      async thenExec() {
        const whereParts = [];
        const vals = [];
        for (const f of state.filters) {
          vals.push(f.val);
          whereParts.push(`${f.col} = $${vals.length}`);
        }
        for (const f of state.isNull) {
          if (f.val === null) whereParts.push(`${f.col} IS NULL`);
        }
        const whereSql = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";
        const orderSql = state.orderCol ? `ORDER BY ${state.orderCol} ${state.orderAsc ? "ASC" : "DESC"}` : "";
        const limitSql = state.limitN ? `LIMIT ${Number(state.limitN)}` : "";
        const { rows } = await pool.query(`SELECT * FROM public.${table} ${whereSql} ${orderSql} ${limitSql}`, vals);
        if (state.singleMode === "single") {
          return rows[0] ? { data: rows[0], error: null } : { data: null, error: { message: "Row not found" } };
        }
        if (state.singleMode === "maybeSingle") {
          return { data: rows[0] || null, error: null };
        }
        return { data: rows, error: null };
      }
    };
    return builder;
  }

  return {
    from: (table) => buildQuery(table),
    async rpc(fnName, params = {}) {
      const specs = {
        create_deposit_atomic: [
          ["p_investor_id", "text"], ["p_account_id", "text"], ["p_amount", "numeric"],
          ["p_date", "date"], ["p_effective_date", "date"], ["p_accounting_treatment", "text"],
          ["p_status", "text"], ["p_type", "text"], ["p_notes", "text"],
          ["p_idempotency_key", "text"], ["p_created_by", "text"]
        ],
        create_withdrawal_atomic: [
          ["p_investor_id", "text"], ["p_account_id", "text"], ["p_amount", "numeric"],
          ["p_effective_date", "date"], ["p_status", "text"], ["p_notes", "text"],
          ["p_idempotency_key", "text"], ["p_created_by", "text"],
          ["p_allow_duplicate_amount", "boolean"], ["p_is_draw", "boolean"]
        ]
      };
      const spec = specs[fnName];
      const argsSql = [];
      const vals = [];
      for (const [k, t] of spec) {
        if (Object.prototype.hasOwnProperty.call(params, k)) {
          vals.push(params[k]);
          argsSql.push(`${k} => $${vals.length}::${t}`);
        }
      }
      try {
        const { rows } = await pool.query(`SELECT public.${fnName}(${argsSql.join(", ")}) AS res`, vals);
        return { data: rows[0].res, error: null };
      } catch (err) {
        return { data: null, error: { message: err.message, code: err.code } };
      }
    }
  };
}

async function runTests() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "fx_pg_guards_"));
  const pgPort = 56400 + Math.floor(Math.random() * 500);
  const server = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "postgres",
    password: "password",
    port: pgPort,
    persistent: false
  });

  await server.initialise();
  await server.start();

  const pool = new Pool({
    host: "127.0.0.1",
    port: pgPort,
    user: "postgres",
    password: "password",
    database: "postgres"
  });

  try {
    await pool.query(`
      CREATE TABLE investors (
        id TEXT PRIMARY KEY, first_name TEXT, last_name TEXT, email TEXT,
        portal_username TEXT, active BOOLEAN DEFAULT TRUE, split_pct NUMERIC DEFAULT 100,
        monthly_draw NUMERIC DEFAULT 0, start_date DATE, role TEXT DEFAULT 'Investor'
      );
      CREATE TABLE investor_accounts (
        id TEXT PRIMARY KEY, investor_id TEXT, name TEXT, starting_capital NUMERIC DEFAULT 0,
        status TEXT DEFAULT 'Active', open_date DATE, is_commission BOOLEAN DEFAULT FALSE,
        external_cash_provenance_status TEXT DEFAULT 'UNKNOWN', notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE monthly_returns (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(), year INT NOT NULL, month_number INT NOT NULL,
        month TEXT, gross_return_pct NUMERIC, source TEXT, notes TEXT, locked BOOLEAN DEFAULT FALSE,
        last_updated TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE (year, month_number)
      );
      CREATE TABLE deposits (
        id TEXT PRIMARY KEY DEFAULT ('dep_' || substr(gen_random_uuid()::text, 1, 12)),
        investor_id TEXT, account_id TEXT, amount NUMERIC(15, 2) NOT NULL, type TEXT,
        status TEXT DEFAULT 'confirmed', date DATE, effective_accounting_date DATE,
        accounting_treatment TEXT DEFAULT 'NEW_CASH', is_commission BOOLEAN DEFAULT FALSE,
        notes TEXT, voided_at TIMESTAMPTZ, voided_by TEXT, void_reason TEXT,
        idempotency_key TEXT, created_by TEXT, transfer_id UUID, transfer_leg TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE withdrawals (
        id TEXT PRIMARY KEY DEFAULT ('wd_' || substr(gen_random_uuid()::text, 1, 12)),
        investor_id TEXT, account_id TEXT, amount NUMERIC(15, 2) NOT NULL, status TEXT DEFAULT 'Pending',
        request_date DATE, effective_accounting_date DATE, year INT, month_number INT, month TEXT,
        notes TEXT, idempotency_key TEXT, created_by TEXT, updated_by TEXT, transfer_id UUID, transfer_leg TEXT,
        is_draw BOOLEAN DEFAULT FALSE, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE investor_monthly_history (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(), investor_id TEXT, account_id TEXT,
        year INT NOT NULL, month_number INT NOT NULL, month TEXT, opening_balance NUMERIC,
        deposits NUMERIC DEFAULT 0, withdrawals NUMERIC DEFAULT 0, gross_return_pct NUMERIC DEFAULT 0,
        manual_gain_amount NUMERIC, manual_return_pct NUMERIC, recurring_draw NUMERIC DEFAULT 0,
        ending_balance NUMERIC, is_manual BOOLEAN DEFAULT FALSE, locked BOOLEAN DEFAULT FALSE,
        notes TEXT, updated_at TIMESTAMPTZ DEFAULT NOW(), created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (investor_id, year, month_number)
      );
      CREATE TABLE commission_shares (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(), source_investor_id TEXT, source_account_id TEXT,
        recipient_investor_id TEXT, commission_percent NUMERIC, effective_start_date DATE,
        effective_end_date DATE, status TEXT DEFAULT 'active'
      );
      CREATE TABLE commission_earnings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(), recipient_id TEXT, source_investor_id TEXT,
        source_account_id TEXT, year INT NOT NULL, month_number INT NOT NULL, amount NUMERIC NOT NULL,
        commission_percent_snapshot NUMERIC, commission_share_rule_id TEXT, calculation_version TEXT,
        accounting_period_id INT, status TEXT DEFAULT 'ACTIVE', ledger_key TEXT UNIQUE,
        superseded_at TIMESTAMPTZ, superseded_by_audit_id TEXT, audit_notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE accounting_periods (
        id SERIAL PRIMARY KEY, year INT NOT NULL, month_number INT NOT NULL, status TEXT NOT NULL DEFAULT 'OPEN',
        fund_return_pct NUMERIC, return_source TEXT, return_status TEXT, return_captured_at TIMESTAMPTZ,
        preview_input_hash TEXT, preview_run_id TEXT, finalized_at TIMESTAMPTZ, finalized_by TEXT,
        calculation_version TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (year, month_number)
      );
      CREATE TABLE audit_runs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(), admin_id TEXT, source_investor_id TEXT,
        year INT, month_number INT, report_json JSONB, created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE account_cutover_adjustments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(), investor_id TEXT, account_id TEXT,
        year INT NOT NULL, month_number INT NOT NULL, authorized_opening_balance NUMERIC
      );
      CREATE TABLE internal_transfers (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(), idempotency_key TEXT UNIQUE
      );
      CREATE TABLE commission_rules (id UUID PRIMARY KEY DEFAULT gen_random_uuid());
    `);

    const mig20261114 = fs.readFileSync(path.resolve("supabase/migrations/20261114_unified_cashflow_draw_and_close_protection.sql"), "utf8");
    const mig20261120 = fs.readFileSync(path.resolve("supabase/migrations/20261120170409_fix_start_date_sync_and_duplicate_guards.sql"), "utf8");
    await pool.query(mig20261114);

    // Seed Mark Richards (start 2026-05 vs stale open 2026-01), Dale Waite (2026-06 vs 2026-01), Nelson Guyer (Dec 1)
    await pool.query(`
      INSERT INTO investors (id, portal_username, active, start_date) VALUES
        ('inv_f797f3fe', 'mrichards', true, '2026-05-01'),
        ('inv_60ed0c32', 'dwaite', true, '2026-06-01'),
        ('inv_141417dc', 'nguyer', true, '2026-01-01');

      INSERT INTO investor_accounts (id, investor_id, name, starting_capital, status, open_date) VALUES
        ('mrichards', 'inv_f797f3fe', 'Mark Richards', 407638.43, 'Active', '2026-01-01'),
        ('dwaite', 'inv_60ed0c32', 'Dale Waite', 227275.44, 'Active', '2026-01-01'),
        ('nguyer', 'inv_141417dc', 'Nelson Guyer', 50000.00, 'Active', '2026-01-01');

      INSERT INTO investor_monthly_history (investor_id, year, month_number, month, opening_balance, ending_balance, locked) VALUES
        ('inv_f797f3fe', 2026, 10, 'October', 421343.92, 431618.66, true),
        ('inv_60ed0c32', 2026, 10, 'October', 238200.15, 239802.19, true),
        ('inv_141417dc', 2026, 10, 'October', 50000.00, 51525.00, true);

      INSERT INTO accounting_periods (year, month_number, status, fund_return_pct) VALUES (2026, 10, 'FINALIZED', 3.05);
      INSERT INTO monthly_returns (year, month_number, month, gross_return_pct, locked) VALUES
        (2026, 5, 'May', 3.31, true),
        (2026, 10, 'October', 3.05, true),
        (2026, 11, 'November', 2.16, false),
        (2026, 12, 'December', 0.00, false);
    `);

    // Confirm 20261114 reproduced the exact ACCOUNT_START_DATE_CONFLICT before 20261120 fix
    await assert.rejects(
      pool.query("SELECT public.calculate_available_withdrawal_equity_sql('inv_f797f3fe', 'mrichards', DATE '2026-11-01', NULL)"),
      /ACCOUNT_START_DATE_CONFLICT/
    );

    // Apply 20261120 migration
    await pool.query(mig20261120);

    // 1. Verify open_date synced & equity succeeds for Mark and Dale
    const { rows: eqRows } = await pool.query(`
      SELECT
        (SELECT open_date FROM investor_accounts WHERE id = 'mrichards') AS mark_open,
        (SELECT open_date FROM investor_accounts WHERE id = 'dwaite') AS dale_open,
        public.calculate_available_withdrawal_equity_sql('inv_f797f3fe', 'mrichards', DATE '2026-11-01', NULL) AS mark_eq,
        public.calculate_available_withdrawal_equity_sql('inv_60ed0c32', 'dwaite', DATE '2026-11-01', NULL) AS dale_eq
    `);
    assert.equal(eqRows[0].mark_open, "2026-05-01");
    assert.equal(eqRows[0].dale_open, "2026-06-01");
    assert.equal(Number(eqRows[0].mark_eq), 431618.66);
    assert.equal(Number(eqRows[0].dale_eq), 239802.19);

    // Even if open_date somehow drifted again later, SQL no longer crashes
    await pool.query("UPDATE investor_accounts SET open_date = '2026-01-01' WHERE id = 'dwaite'");
    const { rows: driftedEq } = await pool.query(
      "SELECT public.calculate_available_withdrawal_equity_sql('inv_60ed0c32', 'dwaite', DATE '2026-11-01', NULL) AS eq"
    );
    assert.equal(Number(driftedEq[0].eq), 239802.19);

    // 2. Verify create_withdrawal_atomic duplicate guard across distinct idempotency keys
    const { rows: wd1 } = await pool.query(
      "SELECT public.create_withdrawal_atomic('inv_f797f3fe', 'mrichards', 7000.00, DATE '2026-11-01', 'Completed', 'First wire', 'modal_uuid_1', 'admin_test', FALSE, FALSE) AS out"
    );
    assert.equal(wd1[0].out.status, "SUCCESS");

    const { rows: wdDup } = await pool.query(
      "SELECT public.create_withdrawal_atomic('inv_f797f3fe', 'mrichards', 7000.00, DATE '2026-11-01', 'Completed', 'Reopened modal', 'modal_uuid_2', 'admin_test', FALSE, FALSE) AS out"
    );
    assert.equal(wdDup[0].out.status, "DUPLICATE_ECONOMIC_TRANSACTION");

    const { rows: wdOverride } = await pool.query(
      "SELECT public.create_withdrawal_atomic('inv_f797f3fe', 'mrichards', 7000.00, DATE '2026-11-01', 'Completed', 'Confirmed second wire', 'modal_uuid_3', 'admin_test', TRUE, FALSE) AS out"
    );
    assert.equal(wdOverride[0].out.status, "SUCCESS");

    // 3. Verify unkeyed direct SQL duplicate inserts collide on deterministic trigger keys
    await pool.query("INSERT INTO withdrawals (id, investor_id, account_id, amount, status, request_date, effective_accounting_date) VALUES ('wd_raw_1', 'inv_60ed0c32', 'dwaite', 2000, 'Completed', '2026-11-01', '2026-11-01')");
    await assert.rejects(
      pool.query("INSERT INTO withdrawals (id, investor_id, account_id, amount, status, request_date, effective_accounting_date) VALUES ('wd_raw_2', 'inv_60ed0c32', 'dwaite', 2000, 'Completed', '2026-11-01', '2026-11-01')"),
      /duplicate key value violates unique constraint|idx_withdrawals_idempotency_key/
    );

    // 4. Verify API handlers: HISTORICAL_PROVENANCE allowed in locked period, NEW_CASH blocked, Duplicate deposit blocked + overridable
    const db = createPgSupabaseAdapter(pool);
    const adminCookie = `scff_admin_session=${createSession({ adminId: "admin_test", role: "admin" })}`;
    const allowDb = async () => true;

    // 4a. NEW_CASH in locked May 2026 -> 409 PERIOD_LOCKED
    {
      const { req, res } = makeReqRes({
        method: "POST",
        cookie: adminCookie,
        body: {
          investorId: "inv_f797f3fe", accountId: "mrichards", amount: 5000, date: "2026-05-01",
          accounting_treatment: "NEW_CASH", idempotency_key: "dep_locked_new_cash_1"
        }
      });
      await depositsHandler(req, res, { supabase: db, assertAuthoritativeProductionDb: allowDb });
      assert.equal(res.statusCode, 409);
      assert.equal(res.payload.code, "PERIOD_LOCKED");
    }

    // 4b. HISTORICAL_PROVENANCE in locked May 2026 -> 200 SUCCESS
    {
      const { req, res } = makeReqRes({
        method: "POST",
        cookie: adminCookie,
        body: {
          investorId: "inv_f797f3fe", accountId: "mrichards", amount: 313000, date: "2026-05-01",
          accounting_treatment: "HISTORICAL_PROVENANCE", type: "Historical Outside Cash",
          idempotency_key: "dep_locked_hist_prov_1"
        }
      });
      await depositsHandler(req, res, { supabase: db, assertAuthoritativeProductionDb: allowDb });
      assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
      assert.equal(res.payload.status, "SUCCESS");
    }

    // 4c. First NEW_CASH deposit on Dec 1 succeeds, second without flag returns 409 DUPLICATE_ECONOMIC_DEPOSIT, explicit confirm succeeds
    {
      const { req: reqInit, res: resInit } = makeReqRes({
        method: "POST",
        cookie: adminCookie,
        body: {
          investorId: "inv_141417dc", accountId: "nguyer", amount: 15000, date: "2026-12-01",
          accounting_treatment: "NEW_CASH", type: "Wire", idempotency_key: "dep_nguyer_1"
        }
      });
      await depositsHandler(reqInit, resInit, { supabase: db, assertAuthoritativeProductionDb: allowDb });
      assert.equal(resInit.statusCode, 200);

      const { req, res } = makeReqRes({
        method: "POST",
        cookie: adminCookie,
        body: {
          investorId: "inv_141417dc", accountId: "nguyer", amount: 15000, date: "2026-12-01",
          accounting_treatment: "NEW_CASH", type: "Wire", idempotency_key: "dep_nguyer_2"
        }
      });
      await depositsHandler(req, res, { supabase: db, assertAuthoritativeProductionDb: allowDb });
      assert.equal(res.statusCode, 409);
      assert.equal(res.payload.code, "DUPLICATE_ECONOMIC_DEPOSIT");

      const { req: reqOk, res: resOk } = makeReqRes({
        method: "POST",
        cookie: adminCookie,
        body: {
          investorId: "inv_141417dc", accountId: "nguyer", amount: 15000, date: "2026-12-01",
          accounting_treatment: "NEW_CASH", type: "Wire", idempotency_key: "dep_nguyer_2",
          confirm_duplicate_economic_deposit: true
        }
      });
      await depositsHandler(reqOk, resOk, { supabase: db, assertAuthoritativeProductionDb: allowDb });
      assert.equal(resOk.statusCode, 200);
      assert.equal(resOk.payload.status, "SUCCESS");

      // 4d. Payment method "Internal Transfer" under NEW_CASH must be rejected
      const { req: reqXfer, res: resXfer } = makeReqRes({
        method: "POST",
        cookie: adminCookie,
        body: {
          investorId: "inv_141417dc", accountId: "nguyer", amount: 2500, date: "2026-12-01",
          accounting_treatment: "NEW_CASH", type: "Internal Transfer", idempotency_key: "dep_nguyer_xfer"
        }
      });
      await depositsHandler(reqXfer, resXfer, { supabase: db, assertAuthoritativeProductionDb: allowDb });
      assert.equal(resXfer.statusCode, 400);
      assert.match(resXfer.payload.error, /INTERNAL_TRANSFER_MISCLASSIFIED/);
    }

    // 5. Verify checkPeriodLock & equity.js periodLocked warning
    const octLock = await checkPeriodLock(db, { effectiveDate: "2026-10-01" });
    assert.equal(octLock.locked, true);
    const novLock = await checkPeriodLock(db, { effectiveDate: "2026-11-01" });
    assert.equal(novLock.locked, false);

    {
      const { req, res } = makeReqRes({
        method: "GET",
        cookie: adminCookie,
        query: { investorId: "inv_f797f3fe", accountId: "mrichards", effectiveDate: "2026-10-01" }
      });
      await equityHandler(req, res, {
        supabase: db,
        calculateAvailableWithdrawalEquity: async () => ({ availableEquity: 421343.92, rawEquity: 421343.92 })
      });
      assert.equal(res.statusCode, 200);
      assert.equal(res.payload.periodLocked, true);
      assert.equal(res.payload.periodYear, 2026);
      assert.equal(res.payload.periodMonthNumber, 10);
    }

    // 6. Verify admin.html contains duplicate confirmation UI, err.code forwarding & locked banner
    const adminHtml = fs.readFileSync(path.resolve("admin.html"), "utf8");
    for (const needle of [
      'id="duplicateConfirmBox"',
      'id="field_confirm_duplicate"',
      'confirm_duplicate_economic_deposit',
      'allow_duplicate_amount',
      'data.periodLocked',
      'err.code = json.code',
      'scrollIntoView',
      'buildAccountOptionsHtml',
      'buildInvestorOptionsHtml',
      'buildCommissionShareStatusOptionsHtml'
    ]) {
      assert.ok(adminHtml.includes(needle), `admin.html missing ${needle}`);
    }

    // 7. Verify inline <script> syntax and alphabetical dropdown sorting across admin.html
    const vm = await import("node:vm");
    for (const m of adminHtml.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
      if (m[1].trim()) new vm.Script(m[1]);
    }
    const helperMatch = adminHtml.match(/(function compareDropdownLabels[\s\S]*?)\/\* dropdown-helpers-end \*\//);
    assert.ok(helperMatch, "admin.html dropdown helpers block not found");
    const sandbox = {
      escapeHtml: (s) =>
        String(s)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
    };
    vm.runInNewContext(helperMatch[1], sandbox);

    const extractOptionValuesAndLabels = (html) =>
      [...html.matchAll(/<option value="([^"]*)"([^>]*)>([^<]*)<\/option>/g)].map((m) => ({
        value: m[1],
        selected: /\bselected\b/.test(m[2]),
        label: m[3]
      }));

    const sampleInvestors = [
      { id: "inv_z", portal_username: "ziracheta", first_name: "Zulma", last_name: "Iracheta" },
      { id: "inv_j", portal_username: "jrichards", first_name: "josh", last_name: "richards" },
      { id: "inv_b", portal_username: "bbell", first_name: "Brandon", last_name: "Bell" },
      { id: "inv_jc", portal_username: "jcolby", first_name: "Jim", last_name: "Colby" },
      { id: "inv_bk", portal_username: "bkimball", first_name: "Bill and Mary", last_name: "Kimball" },
      { id: "inv_e", portal_username: "estrongin", first_name: "Eric", last_name: "strongin" }
    ];
    const sampleAccounts = [
      { id: "bbell", investor_id: "inv_b", name: "Main" },
      { id: "jrichards", investor_id: "inv_j", name: "Main" },
      { id: "ziracheta", investor_id: "inv_z", name: "Main" },
      { id: "jcolby", investor_id: "inv_jc", name: "Main" },
      { id: "alpha_orphan", investor_id: "missing_owner", name: "Alpha Orphan" }
    ];

    const accOpts = extractOptionValuesAndLabels(
      sandbox.buildAccountOptionsHtml(sampleAccounts, sampleInvestors, "jrichards")
    );
    assert.deepEqual(
      accOpts.map((o) => o.value),
      ["alpha_orphan", "bbell", "jcolby", "jrichards", "ziracheta"]
    );
    assert.equal(accOpts.find((o) => o.selected)?.value, "jrichards");

    const invOpts = extractOptionValuesAndLabels(
      sandbox.buildInvestorOptionsHtml(sampleInvestors, {
        usePortalUsername: true,
        placeholder: "Select source investor...",
        isSelected: (i) => i.portal_username === "estrongin"
      })
    );
    assert.equal(invOpts[0].label, "Select source investor...");
    assert.deepEqual(
      invOpts.slice(1).map((o) => o.value),
      ["bkimball", "bbell", "estrongin", "jcolby", "jrichards", "ziracheta"]
    );
    assert.equal(invOpts.find((o) => o.selected)?.value, "estrongin");

    const paymentOpts = extractOptionValuesAndLabels(
      sandbox.renderSortedOptions(
        ["Wire", "Check", "Internal Transfer", "Cash", "Deposit"].map((t) => ({ value: t, label: t })),
        (e) => e.value === "Wire"
      )
    );
    assert.deepEqual(
      paymentOpts.map((o) => o.value),
      ["Cash", "Check", "Deposit", "Internal Transfer", "Wire"]
    );
    assert.equal(paymentOpts.find((o) => o.selected)?.value, "Wire");

    const shareStatusOpts = extractOptionValuesAndLabels(sandbox.buildCommissionShareStatusOptionsHtml("active"));
    assert.deepEqual(
      shareStatusOpts.map((o) => o.value),
      ["active", "cancelled", "ended"]
    );
    assert.equal(shareStatusOpts.find((o) => o.selected)?.value, "active");

    const emailFilterMatch = adminHtml.match(/<select id="emailStatusFilter"[^>]*>([\s\S]*?)<\/select>/);
    assert.ok(emailFilterMatch, "emailStatusFilter select missing");
    const emailFilterOpts = extractOptionValuesAndLabels(emailFilterMatch[1]);
    assert.deepEqual(
      emailFilterOpts.map((o) => o.label),
      ["Active Only", "All Status", "Inactive Only"]
    );
    assert.equal(emailFilterOpts.find((o) => o.selected)?.value, "active");

    assert.ok(!adminHtml.includes("recCandidates.map("), "commission_shares should use buildInvestorOptionsHtml");
    assert.ok(!adminHtml.includes("(state.data.accounts || []).map("), "modals should use buildAccountOptionsHtml");

    console.log("✅ ALL OFFLINE CASHFLOW GUARDS & UI REGRESSION CHECKS PASSED!");
  } finally {
    await pool.end().catch(() => {});
    await Promise.race([
      server.stop().catch(() => {}),
      new Promise((r) => setTimeout(r, 4000))
    ]);
    try {
      fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      // Ignore transient Windows file lock during temp cleanup
    }
  }
}

runTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ TEST FAILED:", err);
    process.exit(1);
  });
