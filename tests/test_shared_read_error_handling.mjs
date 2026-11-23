import assert from "node:assert";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import moduleApi from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Ensure strict offline isolation before importing repository modules.
// Note: importing lib/supabase.js (via lib/paginated-read.js / lib/daily-reconciliation-engine.js)
// invokes dotenv.config({ path: ".env.local" }) when NODE_ENV !== "production".
// Run this test from an empty temporary working directory so no local .env.local file is loaded.
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.SUPABASE_ANON_KEY;
delete process.env.DATA_SOURCE;
process.env.SESSION_SECRET = "test_shared_read_error_handling_offline_secret";

const networkCalls = [];
const originalFetch = globalThis.fetch;
const originalHttpRequest = http.request;
const originalHttpGet = http.get;
const originalHttpsRequest = https.request;
const originalHttpsGet = https.get;
const originalNetConnect = net.connect;
const originalNetCreateConnection = net.createConnection;

function blockNetwork(apiName) {
  return function blockedNetworkCall(...args) {
    networkCalls.push({ apiName, arg0: String(args[0] || "") });
    throw new Error(`Offline test violation: unexpected ${apiName} network attempt`);
  };
}

globalThis.fetch = blockNetwork("fetch");
http.request = blockNetwork("http.request");
http.get = blockNetwork("http.get");
https.request = blockNetwork("https.request");
https.get = blockNetwork("https.get");
net.connect = blockNetwork("net.connect");
net.createConnection = blockNetwork("net.createConnection");

const { paginatedRead } = await import("../lib/supabase.js");
const { loadAccountingData } = await import("../lib/paginated-read.js");
const { executeDailyFinancialReconciliation } = await import("../lib/daily-reconciliation-engine.js");
const { buildInvestorDashboard } = await import("../lib/dashboard.js");
const { createSession } = await import("../lib/auth.js");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function compareValues(a, b) {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  const sa = String(a);
  const sb = String(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

function createMockSupabase(tables, options = {}) {
  const {
    serverPageCap = 2,
    onTableRequest = null
  } = options;

  const requestCountsByTable = {};
  const queryLog = [];
  const writeAttempts = [];

  return {
    requestCountsByTable,
    queryLog,
    writeAttempts,
    from(table) {
      const state = {
        table,
        selectCols: "*",
        filters: [],
        orders: [],
        rangeStart: null,
        rangeEnd: null
      };

      const recordWrite = (op) => (...args) => {
        writeAttempts.push({ table, op, args });
        throw new Error(`Unexpected write operation ${op} on ${table}`);
      };

      const execute = async () => {
        requestCountsByTable[table] = (requestCountsByTable[table] || 0) + 1;
        const requestNumber = requestCountsByTable[table];
        const snapshotState = {
          ...state,
          orders: [...state.orders],
          filters: [...state.filters]
        };
        queryLog.push({ table, requestNumber, ...snapshotState });

        const buildDefaultResult = () => {
          let rows = (tables[table] || []).map((r) => ({ ...r }));

          for (const f of state.filters) {
            if (f.kind === "not" && f.operator === "ilike") {
              const needle = String(f.value).toLowerCase();
              rows = rows.filter((r) => String(r[f.column] ?? "").toLowerCase() !== needle);
            } else if (f.kind === "not" && f.operator === "is" && f.value === null) {
              rows = rows.filter((r) => r[f.column] !== null && r[f.column] !== undefined);
            } else if (f.kind === "in") {
              const allowed = new Set(f.values);
              rows = rows.filter((r) => allowed.has(r[f.column]));
            }
          }

          if (state.orders.length > 0) {
            rows.sort((a, b) => {
              for (const o of state.orders) {
                const cmp = compareValues(a[o.column], b[o.column]);
                if (cmp !== 0) return o.ascending ? cmp : -cmp;
              }
              return 0;
            });
          }

          const start = state.rangeStart ?? 0;
          const end = state.rangeEnd ?? (start + serverPageCap - 1);
          const effectiveCount = Math.min(end - start + 1, serverPageCap);
          return {
            data: rows.slice(start, start + effectiveCount),
            error: null
          };
        };

        const defaultResult = buildDefaultResult();
        if (typeof onTableRequest === "function") {
          const override = onTableRequest({
            table,
            requestNumber,
            state: snapshotState,
            defaultResult
          });
          if (override !== undefined) {
            return override;
          }
        }
        return defaultResult;
      };

      const builder = {
        select(cols = "*") {
          state.selectCols = cols;
          return builder;
        },
        not(column, operator, value) {
          state.filters.push({ kind: "not", column, operator, value });
          return builder;
        },
        in(column, values) {
          state.filters.push({ kind: "in", column, values });
          return builder;
        },
        order(column, { ascending = true } = {}) {
          state.orders.push({ column, ascending });
          return builder;
        },
        range(start, end) {
          state.rangeStart = start;
          state.rangeEnd = end;
          return builder;
        },
        insert: recordWrite("insert"),
        update: recordWrite("update"),
        upsert: recordWrite("upsert"),
        delete: recordWrite("delete"),
        then(onFulfilled, onRejected) {
          return execute().then(onFulfilled, onRejected);
        }
      };

      return builder;
    }
  };
}

function makeReqRes({ method = "GET", cookie = "", headers = {}, query = {}, body = {} } = {}) {
  const req = {
    method,
    headers: { ...headers, ...(cookie ? { cookie } : {}) },
    query: { ...query },
    body: { ...body }
  };
  const res = {
    statusCode: null,
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

function makeAccountingDataset() {
  return {
    investors: [
      { id: "inv_1", portal_username: "user_1", split_pct: 100 }
    ],
    investor_accounts: [
      { id: "acc_1", investor_id: "inv_1", starting_capital: 10000 }
    ],
    deposits: [
      { id: "dep_1", investor_id: "inv_1", amount: 500, type: "Wire" }
    ],
    withdrawals: [
      { id: "wd_1", investor_id: "inv_1", amount: 100, status: "Completed" }
    ],
    commission_shares: [
      { id: "cs_1", source_investor_id: "inv_1", recipient_investor_id: "inv_2", commission_percent: 10 }
    ],
    investor_monthly_history: [
      { id: "hist_1", investor_id: "inv_1", year: 2026, month_number: 8, ending_balance: 10500 }
    ],
    commission_earnings: [
      { id: "ce_1", recipient_id: "inv_2", source_investor_id: "inv_1", year: 2026, month_number: 8, amount: 50 }
    ],
    monthly_returns: [
      { year: 2026, month_number: 8, gross_return_pct: 2.0, locked: true }
    ],
    account_cutover_adjustments: [
      { id: "cut_1", investor_id: "inv_1", year: 2026, month_number: 7, authorized_opening_balance: 10000 },
      { id: "cut_2", investor_id: "inv_1", year: 2026, month_number: 8, authorized_opening_balance: 10200 },
      { id: "cut_3", investor_id: "inv_2", year: 2026, month_number: 8, authorized_opening_balance: 25000 }
    ]
  };
}

function makeReconciliationDataset() {
  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October"
  ];
  const monthly_returns = monthNames.map((month, idx) => ({
    year: 2026,
    month_number: idx + 1,
    month,
    gross_return_pct: idx + 1 === 9 ? 3.07 : (idx + 1 === 10 ? 0.95 : 1.0),
    locked: idx + 1 <= 9
  }));
  const accounting_periods = monthly_returns
    .filter((r) => r.locked)
    .map((r, idx) => ({
      id: idx + 1,
      year: r.year,
      month_number: r.month_number,
      status: "FINALIZED",
      fund_return_pct: r.gross_return_pct
    }));
  const investor_monthly_history = monthNames.slice(0, 9).map((month, idx) => ({
    id: `rh_${idx + 1}`,
    investor_id: "inv_recon_1",
    account_id: "acc_recon_1",
    year: 2026,
    month_number: idx + 1,
    month,
    opening_balance: 10000,
    deposits: 0,
    withdrawals: 0,
    recurring_draw: 0,
    ending_balance: idx + 1 === 9 ? 10307 : 10000,
    locked: true,
    is_manual: false
  }));

  return {
    investors: [{
      id: "inv_recon_1",
      portal_username: "reconuser",
      first_name: "Recon",
      last_name: "User",
      split_pct: 100,
      monthly_draw: 0,
      start_date: "2026-01-01",
      active: true,
      role: "investor"
    }],
    investor_accounts: [{
      id: "acc_recon_1",
      investor_id: "inv_recon_1",
      starting_capital: 10000,
      open_date: "2026-01-01",
      status: "Active",
      split_pct: 100
    }],
    monthly_returns,
    commission_earnings: [],
    commission_shares: [],
    investor_monthly_history,
    deposits: [],
    withdrawals: [],
    account_cutover_adjustments: [
      { id: "cut_r1", investor_id: "inv_other_1", year: 2026, month_number: 7, authorized_opening_balance: 500 },
      { id: "cut_r2", investor_id: "inv_other_2", year: 2026, month_number: 8, authorized_opening_balance: 600 },
      { id: "cut_r3", investor_id: "inv_other_3", year: 2026, month_number: 9, authorized_opening_balance: 700 }
    ],
    accounting_periods
  };
}

function makeAdminAccountsDataset({ omitSecondInvestor = false } = {}) {
  const investors = [
    {
      id: "inv_a",
      portal_username: "alice",
      first_name: "Alice",
      last_name: "Investor",
      split_pct: 100,
      monthly_draw: 0,
      start_date: "2026-01-01",
      active: true,
      role: "investor"
    }
  ];
  if (!omitSecondInvestor) {
    investors.push({
      id: "inv_b",
      portal_username: "bob",
      first_name: "Bob",
      last_name: "Cutover",
      split_pct: 100,
      monthly_draw: 0,
      start_date: "2026-01-01",
      active: true,
      role: "investor"
    });
  }

  return {
    investors,
    investor_accounts: [
      {
        id: "acc_a",
        investor_id: "inv_a",
        name: "Alice Main",
        starting_capital: 10000,
        open_date: "2026-01-01",
        status: "Active",
        split_pct: 100,
        created_at: "2026-01-01T00:00:00Z"
      },
      {
        id: "acc_b",
        investor_id: "inv_b",
        name: "Bob Main",
        starting_capital: 20000,
        open_date: "2026-01-01",
        status: "Active",
        split_pct: 100,
        created_at: "2026-01-02T00:00:00Z"
      }
    ],
    monthly_returns: [
      { year: 2026, month_number: 1, month: "January", gross_return_pct: 5.0, locked: true },
      { year: 2026, month_number: 2, month: "February", gross_return_pct: 2.0, locked: true }
    ],
    deposits: [],
    withdrawals: [],
    investor_monthly_history: [
      {
        id: "hist_a_1",
        investor_id: "inv_a",
        account_id: "acc_a",
        year: 2026,
        month_number: 1,
        month: "January",
        opening_balance: 10000,
        deposits: 0,
        withdrawals: 0,
        recurring_draw: 0,
        ending_balance: 10500,
        locked: true,
        is_manual: false
      },
      {
        id: "hist_a_2",
        investor_id: "inv_a",
        account_id: "acc_a",
        year: 2026,
        month_number: 2,
        month: "February",
        opening_balance: 10500,
        deposits: 0,
        withdrawals: 0,
        recurring_draw: 0,
        ending_balance: 10710,
        locked: true,
        is_manual: false
      }
    ],
    commission_earnings: [],
    commission_shares: [],
    commission_rules: [],
    account_cutover_adjustments: [
      {
        id: "cut_b_1",
        investor_id: "inv_b",
        year: 2026,
        month_number: 1,
        authorized_opening_balance: 50000
      }
    ]
  };
}

function makeFaultScenarios(targetTable, makeRowForLimit) {
  return [
    {
      label: "permission/query error on page 1",
      handler: ({ table, requestNumber }) => {
        if (table === targetTable && requestNumber === 1) {
          return { data: null, error: { code: "42501", message: "permission denied for table" } };
        }
        return undefined;
      },
      expectedPattern: new RegExp(`paginatedRead\\("${targetTable}"\\).*permission denied`, "i")
    },
    {
      label: "query error on page 2 after partial page 1",
      handler: ({ table, requestNumber }) => {
        if (table === targetTable && requestNumber >= 2) {
          return { data: null, error: { code: "42501", message: "permission denied on page 2" } };
        }
        return undefined;
      },
      expectedPattern: new RegExp(`paginatedRead\\("${targetTable}"\\).*request 2`, "i")
    },
    {
      label: "rejected network promise",
      handler: ({ table, requestNumber }) => {
        if (table === targetTable && requestNumber === 1) {
          throw new Error("simulated network reset");
        }
        return undefined;
      },
      expectedPattern: /simulated network reset/i
    },
    {
      label: "null non-array data payload",
      handler: ({ table, requestNumber }) => {
        if (table === targetTable && requestNumber === 1) {
          return { data: null, error: null };
        }
        return undefined;
      },
      expectedPattern: new RegExp(`paginatedRead\\("${targetTable}"\\).*non-array data`, "i")
    },
    {
      label: "malformed row payload",
      handler: ({ table, requestNumber }) => {
        if (table === targetTable && requestNumber === 1) {
          return { data: [null], error: null };
        }
        return undefined;
      },
      expectedPattern: new RegExp(`paginatedRead\\("${targetTable}"\\).*malformed row`, "i")
    },
    {
      label: "repeated page pagination fault",
      handler: ({ table, requestNumber, defaultResult }) => {
        if (table === targetTable && requestNumber === 2) {
          return { data: [makeRowForLimit(1)], error: null };
        }
        if (table === targetTable && requestNumber === 1) {
          return { data: [makeRowForLimit(1)], error: null };
        }
        return defaultResult;
      },
      expectedPattern: new RegExp(`paginatedRead\\("${targetTable}"\\).*repeated page`, "i")
    },
    {
      label: "maxRequests safety limit overflow",
      handler: ({ table, requestNumber }) => {
        if (table === targetTable) {
          return { data: [makeRowForLimit(requestNumber)], error: null };
        }
        return undefined;
      },
      expectedPattern: new RegExp(`paginatedRead\\("${targetTable}"\\).*exceeded maxRequests`, "i")
    }
  ];
}

/**
 * Loads the real api/admin/accounts/index.js route handler offline without adding
 * dependency injection to the route file.
 * - Prefers module.registerHooks() when available (Node >=22.15.0 and Node 26;
 *   synchronous, zero deprecation warnings, clean deregister()).
 * - Falls back to module.register() when registerHooks() is unavailable (Node 22.0–22.14).
 * - paginatedRead delegates to the real lib/supabase.js paginatedRead bound to a fake client.
 * - buildInvestorDashboard uses the real lib/dashboard.js implementation unless overridden.
 * - getMyfxbookLive uses a controlled offline stub (never touches network).
 */
async function loadRealAdminAccountsRouteForOfflineTest(harness) {
  const accountsFileUrl = pathToFileURL(path.join(repoRoot, "api/admin/accounts/index.js")).href;
  const supabaseFileUrl = pathToFileURL(path.join(repoRoot, "lib/supabase.js")).href;
  const myfxbookFileUrl = pathToFileURL(path.join(repoRoot, "lib/myfxbook.js")).href;
  const dashboardFileUrl = pathToFileURL(path.join(repoRoot, "lib/dashboard.js")).href;

  globalThis.__PHASE2D_ROUTE_TEST_HARNESS__ = harness;

  const supabaseShimUrl = `${supabaseFileUrl}?phase2d_route_shim=1`;
  const myfxbookShimUrl = `${myfxbookFileUrl}?phase2d_route_shim=1`;
  const dashboardShimUrl = `${dashboardFileUrl}?phase2d_route_shim=1`;

  const supabaseShimSource = `
    const h = () => globalThis.__PHASE2D_ROUTE_TEST_HARNESS__;
    export const supabase = null;
    export function paginatedRead(table, opts = {}) {
      return h().paginatedRead(table, opts);
    }
  `;
  const myfxbookShimSource = `
    const h = () => globalThis.__PHASE2D_ROUTE_TEST_HARNESS__;
    export function getMyfxbookLive(opts = {}) {
      return h().getMyfxbookLive(opts);
    }
  `;
  const dashboardShimSource = `
    import { buildInvestorDashboard as realBuildInvestorDashboard } from ${JSON.stringify(dashboardFileUrl)};
    const h = () => globalThis.__PHASE2D_ROUTE_TEST_HARNESS__;
    export function buildInvestorDashboard(...args) {
      const override = h().buildInvestorDashboardOverride;
      return override ? override(...args) : realBuildInvestorDashboard(...args);
    }
  `;

  let hook = null;
  if (typeof moduleApi.registerHooks === "function") {
    hook = moduleApi.registerHooks({
      resolve(specifier, context, nextResolve) {
        const parent = context.parentURL || "";
        if (parent.startsWith(accountsFileUrl)) {
          if (specifier.endsWith("lib/supabase.js")) return { url: supabaseShimUrl, shortCircuit: true };
          if (specifier.endsWith("lib/myfxbook.js")) return { url: myfxbookShimUrl, shortCircuit: true };
          if (specifier.endsWith("lib/dashboard.js")) return { url: dashboardShimUrl, shortCircuit: true };
        }
        return nextResolve(specifier, context);
      },
      load(url, context, nextLoad) {
        if (url === supabaseShimUrl) return { format: "module", shortCircuit: true, source: supabaseShimSource };
        if (url === myfxbookShimUrl) return { format: "module", shortCircuit: true, source: myfxbookShimSource };
        if (url === dashboardShimUrl) return { format: "module", shortCircuit: true, source: dashboardShimSource };
        return nextLoad(url, context);
      }
    });
  } else if (typeof moduleApi.register === "function") {
    const loaderSource = `
      export async function resolve(specifier, context, nextResolve) {
        const parent = context.parentURL || "";
        if (parent.startsWith(${JSON.stringify(accountsFileUrl)})) {
          if (specifier.endsWith("lib/supabase.js")) return { url: ${JSON.stringify(supabaseShimUrl)}, shortCircuit: true };
          if (specifier.endsWith("lib/myfxbook.js")) return { url: ${JSON.stringify(myfxbookShimUrl)}, shortCircuit: true };
          if (specifier.endsWith("lib/dashboard.js")) return { url: ${JSON.stringify(dashboardShimUrl)}, shortCircuit: true };
        }
        return nextResolve(specifier, context);
      }
      export async function load(url, context, nextLoad) {
        if (url === ${JSON.stringify(supabaseShimUrl)}) return { format: "module", shortCircuit: true, source: ${JSON.stringify(supabaseShimSource)} };
        if (url === ${JSON.stringify(myfxbookShimUrl)}) return { format: "module", shortCircuit: true, source: ${JSON.stringify(myfxbookShimSource)} };
        if (url === ${JSON.stringify(dashboardShimUrl)}) return { format: "module", shortCircuit: true, source: ${JSON.stringify(dashboardShimSource)} };
        return nextLoad(url, context);
      }
    `;
    const loaderDataUrl = `data:text/javascript;base64,${Buffer.from(loaderSource, "utf8").toString("base64")}`;
    moduleApi.register(loaderDataUrl);
  } else {
    throw new Error("Node runtime provides neither module.registerHooks nor module.register for offline route test");
  }

  const mod = await import(`${accountsFileUrl}?phase2d_offline_run=1`);
  return {
    handler: mod.default,
    cleanup() {
      if (hook && typeof hook.deregister === "function") hook.deregister();
      delete globalThis.__PHASE2D_ROUTE_TEST_HARNESS__;
    }
  };
}

async function runTests() {
  console.log("=== Shared-Read Error Handling & Fail-Closed Admin Accounts Offline Tests ===");

  // ---------------------------------------------------------------------------
  // TEST 1: loadAccountingData (lib/paginated-read.js) fails closed on
  //         account_cutover_adjustments and no longer reads/returns commissionRules
  // ---------------------------------------------------------------------------
  {
    const happyDb = createMockSupabase(makeAccountingDataset(), { serverPageCap: 2 });
    const loaded = await loadAccountingData({ supabaseClient: happyDb });
    assert.deepStrictEqual(
      loaded.cutoverAdjustments.map((r) => r.id),
      ["cut_1", "cut_2", "cut_3"],
      "loadAccountingData must load all paginated account_cutover_adjustments rows"
    );
    assert.strictEqual(
      Object.prototype.hasOwnProperty.call(loaded, "commissionRules"),
      false,
      "loadAccountingData must no longer return unused commissionRules property"
    );
    assert.strictEqual(
      happyDb.requestCountsByTable.commission_rules || 0,
      0,
      "loadAccountingData must not query unused commission_rules table"
    );
    assert.strictEqual(happyDb.writeAttempts.length, 0);

    const cutoverFaults = makeFaultScenarios("account_cutover_adjustments", (n) => ({
      id: `cut_lim_${n}`,
      investor_id: "inv_1",
      year: 2026,
      month_number: ((n - 1) % 12) + 1,
      authorized_opening_balance: 1000
    }));

    for (const fault of cutoverFaults) {
      const mockDb = createMockSupabase(makeAccountingDataset(), {
        serverPageCap: 2,
        onTableRequest: fault.handler
      });
      await assert.rejects(
        () => loadAccountingData({ supabaseClient: mockDb }),
        fault.expectedPattern,
        `loadAccountingData must fail closed on account_cutover_adjustments (${fault.label})`
      );
      assert.strictEqual(mockDb.writeAttempts.length, 0);
    }

    console.log("  PASS [1]: loadAccountingData fails closed on account_cutover_adjustments (7/7) and removes unused commission_rules read/property");
  }

  // ---------------------------------------------------------------------------
  // TEST 2: executeDailyFinancialReconciliation (lib/daily-reconciliation-engine.js)
  //         fails closed on account_cutover_adjustments AND accounting_periods
  // ---------------------------------------------------------------------------
  {
    const baselineDb = createMockSupabase(makeReconciliationDataset(), { serverPageCap: 2 });
    const baselineReport = await executeDailyFinancialReconciliation({
      supabaseClient: baselineDb,
      asOfDate: "2026-10-15T12:00:00Z"
    });
    assert.strictEqual(baselineReport.status, "PASS", `Baseline reconciliation failed: ${JSON.stringify(baselineReport.alerts)}`);
    assert.strictEqual(baselineDb.writeAttempts.length, 0);

    const cutoverFaults = makeFaultScenarios("account_cutover_adjustments", (n) => ({
      id: `cut_recon_${n}`,
      investor_id: `inv_other_${n}`,
      year: 2026,
      month_number: ((n - 1) % 12) + 1,
      authorized_opening_balance: 500
    }));

    for (const fault of cutoverFaults) {
      const mockDb = createMockSupabase(makeReconciliationDataset(), {
        serverPageCap: 2,
        onTableRequest: fault.handler
      });
      await assert.rejects(
        () => executeDailyFinancialReconciliation({
          supabaseClient: mockDb,
          asOfDate: "2026-10-15T12:00:00Z"
        }),
        fault.expectedPattern,
        `executeDailyFinancialReconciliation must fail closed on account_cutover_adjustments (${fault.label})`
      );
      assert.strictEqual(mockDb.writeAttempts.length, 0);
    }

    const periodFaults = makeFaultScenarios("accounting_periods", (n) => ({
      id: n,
      year: 2000 + Math.floor((n - 1) / 12),
      month_number: ((n - 1) % 12) + 1,
      status: "FINALIZED",
      fund_return_pct: 1.0
    }));

    for (const fault of periodFaults) {
      const mockDb = createMockSupabase(makeReconciliationDataset(), {
        serverPageCap: 2,
        onTableRequest: fault.handler
      });
      await assert.rejects(
        () => executeDailyFinancialReconciliation({
          supabaseClient: mockDb,
          asOfDate: "2026-10-15T12:00:00Z"
        }),
        fault.expectedPattern,
        `executeDailyFinancialReconciliation must fail closed on accounting_periods (${fault.label})`
      );
      assert.strictEqual(mockDb.writeAttempts.length, 0);
    }

    console.log("  PASS [2]: executeDailyFinancialReconciliation fails closed on account_cutover_adjustments (7/7) and accounting_periods (7/7)");
  }

  // ---------------------------------------------------------------------------
  // TEST 3: Real GET /api/admin/accounts handler fails closed on required reads
  //         and per-account calculation errors, removes unused commissionRules,
  //         and keeps optional live feed non-fatal (offline via fake client)
  // ---------------------------------------------------------------------------
  {
    let activeMockDb = null;
    const defaultLive = { today: "+0.00%", week: "+0.00%", month: "+0.00%", year: "+0.00%", source: "Offline Stub" };
    const harness = {
      paginatedRead: (table, opts = {}) => paginatedRead(table, { ...opts, client: activeMockDb }),
      getMyfxbookLive: async () => defaultLive,
      buildInvestorDashboardOverride: null
    };

    const { handler: adminAccountsHandler, cleanup } = await loadRealAdminAccountsRouteForOfflineTest(harness);
    const adminToken = createSession({ adminId: "admin_offline_1", role: "admin" });
    const adminCookie = `scff_admin_session=${adminToken}`;

    try {
      // 3a. Unauthenticated request rejected 401 before touching DB
      {
        activeMockDb = createMockSupabase(makeAdminAccountsDataset(), { serverPageCap: 2 });
        const { req, res } = makeReqRes({ method: "GET" });
        await adminAccountsHandler(req, res);
        assert.strictEqual(res.statusCode, 401);
        assert.strictEqual(activeMockDb.queryLog.length, 0);
      }

      // 3b. Happy path: returns HTTP 200 with accurate computed balances (cutover honored),
      //     zero commissionRules property, and zero commission_rules queries even when
      //     commission_rules is absent or its query would fail
      let baselineBalancesById;
      {
        const datasetWithoutCommRules = makeAdminAccountsDataset();
        delete datasetWithoutCommRules.commission_rules;
        activeMockDb = createMockSupabase(datasetWithoutCommRules, {
          serverPageCap: 2,
          onTableRequest: ({ table }) => {
            if (table === "commission_rules") {
              return { data: null, error: { code: "42P01", message: "relation commission_rules does not exist" } };
            }
            return undefined;
          }
        });
        const { req, res } = makeReqRes({ method: "GET", cookie: adminCookie });
        await adminAccountsHandler(req, res);

        assert.strictEqual(res.statusCode, 200, `Expected 200 on healthy admin accounts GET, got ${res.statusCode}: ${JSON.stringify(res.payload)}`);
        assert(Array.isArray(res.payload.accounts) && res.payload.accounts.length === 2);
        assert.strictEqual(activeMockDb.writeAttempts.length, 0);

        const accA = res.payload.accounts.find((a) => a.id === "acc_a");
        const accB = res.payload.accounts.find((a) => a.id === "acc_b");
        assert.strictEqual(typeof accA.current_balance, "number");
        assert.strictEqual(typeof accB.current_balance, "number");
        assert.notStrictEqual(accA.current_balance, accA.starting_capital, "Alice computed balance must reflect returns, not starting_capital");
        assert(accB.current_balance > 50000, `Bob computed balance must honor $50,000 cutover (got ${accB.current_balance})`);
        assert.strictEqual(Object.prototype.hasOwnProperty.call(accA, "commissionRules"), false, "Unused accounts[].commissionRules must be removed");
        assert.strictEqual(Object.prototype.hasOwnProperty.call(accB, "commissionRules"), false, "Unused accounts[].commissionRules must be removed");
        assert.strictEqual(
          activeMockDb.requestCountsByTable.commission_rules || 0,
          0,
          "GET /api/admin/accounts must not query commission_rules"
        );

        // Prove directly via buildInvestorDashboard that populated commissionRulesTable
        // has zero effect on summary.currentBalance (though dashboard still uses it for
        // commissionBreakdown / hasAnyCommissionTies).
        const baseDataset = makeAdminAccountsDataset();
        const basePreloaded = {
          rawInvestors: baseDataset.investors,
          accounts: baseDataset.investor_accounts,
          returnsSheet: baseDataset.monthly_returns,
          depositsSheet: baseDataset.deposits,
          withdrawalsSheet: baseDataset.withdrawals,
          historyTable: baseDataset.investor_monthly_history,
          commissionEarningsTable: baseDataset.commission_earnings,
          commissionSharesTable: baseDataset.commission_shares,
          cutovers: baseDataset.account_cutover_adjustments,
          live: defaultLive
        };
        const populatedRules = [
          { id: "cr_1", investor_id: "inv_a", recipient_id: "inv_b", percent: 20, created_at: "2026-01-01T00:00:00Z" },
          { id: "cr_2", investor_id: "inv_b", recipient_id: "inv_a", percent: 15, created_at: "2026-01-01T00:00:00Z" }
        ];
        for (const acc of [accA, accB]) {
          const dashWithoutRules = await buildInvestorDashboard(acc.investor_id, basePreloaded);
          const dashWithRules = await buildInvestorDashboard(acc.investor_id, {
            ...basePreloaded,
            commissionRulesTable: populatedRules
          });
          assert.strictEqual(
            dashWithoutRules.summary.currentBalance,
            dashWithRules.summary.currentBalance,
            `commissionRulesTable must not alter summary.currentBalance for ${acc.investor_id}`
          );
          assert.strictEqual(
            acc.current_balance,
            dashWithRules.summary.currentBalance,
            `GET /api/admin/accounts current_balance for ${acc.id} must match buildInvestorDashboard with commissionRulesTable`
          );
        }

        baselineBalancesById = { acc_a: accA.current_balance, acc_b: accB.current_balance };
      }

      // 3c. Optional live feed throw must NOT make GET /api/admin/accounts fail or alter balances
      {
        activeMockDb = createMockSupabase(makeAdminAccountsDataset(), { serverPageCap: 2 });
        harness.getMyfxbookLive = async () => {
          throw new Error("simulated optional live feed failure");
        };
        const { req, res } = makeReqRes({ method: "GET", cookie: adminCookie });
        await adminAccountsHandler(req, res);
        harness.getMyfxbookLive = async () => defaultLive;

        assert.strictEqual(res.statusCode, 200, "Optional getMyfxbookLive failure must not cause 500");
        const accA = res.payload.accounts.find((a) => a.id === "acc_a");
        const accB = res.payload.accounts.find((a) => a.id === "acc_b");
        assert.strictEqual(accA.current_balance, baselineBalancesById.acc_a);
        assert.strictEqual(accB.current_balance, baselineBalancesById.acc_b);
      }

      // 3d. Failure in ANY required balance-enrichment read must return non-2xx (500),
      //     never HTTP 200 with missing or starting_capital balances
      const requiredBalanceTables = [
        "investors",
        "monthly_returns",
        "deposits",
        "withdrawals",
        "investor_monthly_history",
        "commission_earnings",
        "commission_shares",
        "account_cutover_adjustments"
      ];
      const faultModes = [
        {
          label: "DB permission error",
          makeHandler: (t) => ({ table }) =>
            table === t ? { data: null, error: { code: "42501", message: `permission denied on ${t}` } } : undefined
        },
        {
          label: "null non-array payload",
          makeHandler: (t) => ({ table }) =>
            table === t ? { data: null, error: null } : undefined
        }
      ];

      for (const targetTable of requiredBalanceTables) {
        for (const mode of faultModes) {
          activeMockDb = createMockSupabase(makeAdminAccountsDataset(), {
            serverPageCap: 2,
            onTableRequest: mode.makeHandler(targetTable)
          });
          const { req, res } = makeReqRes({ method: "GET", cookie: adminCookie });
          await adminAccountsHandler(req, res);

          assert.strictEqual(
            res.statusCode,
            500,
            `GET /api/admin/accounts must return 500 when ${targetTable} fails (${mode.label}), got ${res.statusCode}`
          );
          assert.strictEqual(res.payload?.accounts, undefined, "Error response must not include partial accounts payload");
          assert(typeof res.payload?.error === "string" && res.payload.error.length > 0);
          assert.strictEqual(activeMockDb.writeAttempts.length, 0);
        }
      }

      // 3e. Per-account calculation failure (account 1 succeeds, account 2 throws inside real
      //     buildInvestorDashboard because investor inv_b is missing) must return 500, never 200
      //     with starting_capital substituted as current_balance
      {
        activeMockDb = createMockSupabase(makeAdminAccountsDataset({ omitSecondInvestor: true }), { serverPageCap: 2 });
        const { req, res } = makeReqRes({ method: "GET", cookie: adminCookie });
        await adminAccountsHandler(req, res);

        assert.strictEqual(res.statusCode, 500, `Expected 500 on per-account calculation failure, got ${res.statusCode}`);
        assert.strictEqual(res.payload?.accounts, undefined, "Failed calculation must not return HTTP 200 or accounts array");
        assert(/Investor not found/i.test(res.payload?.error || ""), `Unexpected error message: ${res.payload?.error}`);
        assert.strictEqual(activeMockDb.writeAttempts.length, 0);
      }

      // 3f. Per-account non-finite currentBalance (undefined/NaN) must also fail closed with 500
      {
        activeMockDb = createMockSupabase(makeAdminAccountsDataset(), { serverPageCap: 2 });
        let callCount = 0;
        harness.buildInvestorDashboardOverride = async () => {
          callCount += 1;
          if (callCount === 1) return { summary: { currentBalance: 12345.67 } };
          return { summary: { currentBalance: undefined } };
        };
        const { req, res } = makeReqRes({ method: "GET", cookie: adminCookie });
        await adminAccountsHandler(req, res);
        harness.buildInvestorDashboardOverride = null;

        assert.strictEqual(res.statusCode, 500, `Expected 500 on non-finite currentBalance, got ${res.statusCode}`);
        assert.strictEqual(res.payload?.accounts, undefined);
        assert(/finite current_balance/i.test(res.payload?.error || ""));
      }
    } finally {
      cleanup();
    }

    console.log("  PASS [3]: GET /api/admin/accounts fails closed (500) on all 8 required reads (16/16) and per-account errors, skips unnecessary commission_rules read with identical balances, and tolerates optional live feed failure");
  }

  // ---------------------------------------------------------------------------
  // TEST 4: Source regression checks for singleton-client live-read path in
  //         lib/dashboard.js and api/admin/accounts/index.js
  // ---------------------------------------------------------------------------
  {
    const dashboardSrc = fs.readFileSync(path.join(repoRoot, "lib/dashboard.js"), "utf8");
    assert(
      dashboardSrc.includes('readSupabaseTable("account_cutover_adjustments")'),
      "lib/dashboard.js must read account_cutover_adjustments"
    );
    assert(
      dashboardSrc.includes('readSupabaseTable("commission_rules")'),
      "lib/dashboard.js must retain unfiltered commission_rules read used by unifiedSharesTable/hasAnyCommissionTies"
    );
    assert(
      !/readSupabaseTable\s*\(\s*["']account_cutover_adjustments["'][^)]*\)\s*\.catch\s*\(/.test(dashboardSrc),
      "lib/dashboard.js must not swallow account_cutover_adjustments read errors into []"
    );

    const accountsSrc = fs.readFileSync(path.join(repoRoot, "api/admin/accounts/index.js"), "utf8");
    assert(
      !accountsSrc.includes('paginatedRead("commission_rules"'),
      "api/admin/accounts/index.js must not execute unnecessary commission_rules reads"
    );
    assert(
      !accountsSrc.includes("commissionRulesTable"),
      "api/admin/accounts/index.js must not preload unnecessary commissionRulesTable"
    );
    assert(
      !accountsSrc.includes("acc.commissionRules"),
      "api/admin/accounts/index.js must not attach unused acc.commissionRules field"
    );
    assert(
      !accountsSrc.includes("acc.current_balance = acc.starting_capital"),
      "api/admin/accounts/index.js must not substitute starting_capital as current_balance"
    );
    assert(
      accountsSrc.includes('paginatedRead("account_cutover_adjustments")') &&
      accountsSrc.includes("cutovers:"),
      "api/admin/accounts/index.js must retain account_cutover_adjustments pagination and cutovers forwarding"
    );

    console.log("  PASS [4]: Source regression checks verified for lib/dashboard.js and api/admin/accounts/index.js");
  }

  // ---------------------------------------------------------------------------
  // TEST 5: Zero network calls throughout entire import & test execution
  // ---------------------------------------------------------------------------
  assert.strictEqual(networkCalls.length, 0, `Expected 0 network calls, observed ${networkCalls.length}`);
  console.log("  PASS [5]: Zero network calls and zero writes confirmed");

  console.log("\n=== ALL SHARED-READ ERROR HANDLING TESTS PASSED (5/5) ===");
}

try {
  await runTests();
} finally {
  globalThis.fetch = originalFetch;
  http.request = originalHttpRequest;
  http.get = originalHttpGet;
  https.request = originalHttpsRequest;
  https.get = originalHttpsGet;
  net.connect = originalNetConnect;
  net.createConnection = originalNetCreateConnection;
}
