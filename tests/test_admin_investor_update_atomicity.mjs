import assert from "node:assert";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import moduleApi from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Strict offline isolation before importing any repository module.
// Note: importing lib/supabase.js invokes dotenv.config({ path: ".env.local" }) when
// NODE_ENV !== "production". Run this test from an empty temporary working directory
// so no local .env.local file is loaded.
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.SUPABASE_ANON_KEY;
delete process.env.DATA_SOURCE;
process.env.SESSION_SECRET = "test_admin_investor_update_atomicity_offline_secret";

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

const { createSession } = await import("../lib/auth.js");
const { isBcryptHash, verifyPassword } = await import("../lib/password.js");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const SHOW_FUND_PERF_MIGRATION_REL_PATH = "supabase/migrations/20261123210000_add_investors_show_fund_performance.sql";
const MIGRATION_REL_PATH = "supabase/migrations/20261123220000_atomic_admin_investor_update_rpc.sql";
const ROUTE_REL_PATH = "api/admin/investors/[id].js";
const SUPABASE_LIB_REL_PATH = "lib/supabase.js";

/**
 * Loads the real api/admin/investors/[id].js route handler offline without adding
 * test-only dependency injection to the route file.
 * - Prefers module.registerHooks() when available (Node >=22.15.0 and Node 26).
 * - Falls back to module.register() when registerHooks() is unavailable (Node 22.0–22.14).
 */
async function loadRealInvestorRouteForOfflineTest(harness) {
  const routeFileUrl = pathToFileURL(path.join(repoRoot, ROUTE_REL_PATH)).href;
  const supabaseFileUrl = pathToFileURL(path.join(repoRoot, SUPABASE_LIB_REL_PATH)).href;

  globalThis.__PHASE3A_INVESTOR_ROUTE_HARNESS__ = harness;
  const supabaseShimUrl = `${supabaseFileUrl}?phase3a_investor_shim=1`;

  const supabaseShimSource = `
    export let supabase = new Proxy({}, {
      get(_target, prop) {
        const client = globalThis.__PHASE3A_INVESTOR_ROUTE_HARNESS__.getSupabaseClient();
        if (!client) return undefined;
        const val = client[prop];
        return typeof val === "function" ? val.bind(client) : val;
      }
    });
    export function __setNullClient(isNull) {
      supabase = isNull ? null : new Proxy({}, {
        get(_target, prop) {
          const client = globalThis.__PHASE3A_INVESTOR_ROUTE_HARNESS__.getSupabaseClient();
          if (!client) return undefined;
          const val = client[prop];
          return typeof val === "function" ? val.bind(client) : val;
        }
      });
    }
  `;

  let hook = null;
  if (typeof moduleApi.registerHooks === "function") {
    hook = moduleApi.registerHooks({
      resolve(specifier, context, nextResolve) {
        const parent = context.parentURL || "";
        if (parent.startsWith(routeFileUrl) && specifier.endsWith("lib/supabase.js")) {
          return { url: supabaseShimUrl, shortCircuit: true };
        }
        return nextResolve(specifier, context);
      },
      load(url, context, nextLoad) {
        if (url === supabaseShimUrl) {
          return { format: "module", shortCircuit: true, source: supabaseShimSource };
        }
        return nextLoad(url, context);
      }
    });
  } else if (typeof moduleApi.register === "function") {
    const loaderSource = `
      export async function resolve(specifier, context, nextResolve) {
        const parent = context.parentURL || "";
        if (parent.startsWith(${JSON.stringify(routeFileUrl)}) && specifier.endsWith("lib/supabase.js")) {
          return { url: ${JSON.stringify(supabaseShimUrl)}, shortCircuit: true };
        }
        return nextResolve(specifier, context);
      }
      export async function load(url, context, nextLoad) {
        if (url === ${JSON.stringify(supabaseShimUrl)}) {
          return { format: "module", shortCircuit: true, source: ${JSON.stringify(supabaseShimSource)} };
        }
        return nextLoad(url, context);
      }
    `;
    moduleApi.register(`data:text/javascript,${encodeURIComponent(loaderSource)}`);
  } else {
    throw new Error("Offline test requires Node module.registerHooks() or module.register()");
  }

  try {
    const [routeMod, shimMod] = await Promise.all([
      import(`${routeFileUrl}?phase3a_run=1`),
      import(supabaseShimUrl)
    ]);
    return { handler: routeMod.default, setNullClient: shimMod.__setNullClient };
  } finally {
    if (hook && typeof hook.deregister === "function") {
      hook.deregister();
    }
  }
}

function makeAdminCookie() {
  const token = createSession({ adminId: "admin_phase3a_test", role: "admin" });
  return `scff_admin_session=${token}`;
}

function createMockReqRes({ method = "PATCH", id = "inv_001", body = {}, authenticated = true } = {}) {
  const req = {
    method,
    query: id === undefined ? {} : { id },
    headers: authenticated ? { cookie: makeAdminCookie() } : {},
    body
  };
  let statusCode = 200;
  let jsonBody = undefined;
  const res = {
    status(code) {
      statusCode = code;
      return res;
    },
    json(payload) {
      jsonBody = payload;
      return res;
    },
    _getStatus: () => statusCode,
    _getJson: () => jsonBody
  };
  return { req, res };
}

function createMockSupabase({ onRpc, onFrom } = {}) {
  const rpcCalls = [];
  const fromCalls = [];
  return {
    rpcCalls,
    fromCalls,
    async rpc(fnName, params) {
      rpcCalls.push({ fnName, params: structuredClone(params) });
      if (onRpc) return await onRpc(fnName, params);
      return {
        data: {
          status: "SUCCESS",
          investor: {
            id: params.p_investor_id,
            ...params.p_investor_updates
          },
          accounts_updated: 1,
          account_created: false
        },
        error: null
      };
    },
    from(table) {
      fromCalls.push({ table });
      if (onFrom) return onFrom(table);
      throw new Error(`Unexpected direct REST table access via supabase.from("${table}") during atomic PATCH/PUT`);
    }
  };
}

async function main() {
  console.log("=== ADMIN INVESTOR UPDATE (PATCH/PUT) ATOMICITY OFFLINE CONTRACT TESTS ===");
  console.log(
    "Note: Fake-client and static checks verify the route/RPC contract and migration structure offline; " +
      "they do NOT execute PostgreSQL or prove live database runtime behavior."
  );

  let activeClient = createMockSupabase();
  const { handler, setNullClient } = await loadRealInvestorRouteForOfflineTest({
    getSupabaseClient: () => activeClient
  });

  // -------------------------------------------------------------------------
  // TEST 1: Auth, method, and pre-RPC validation guards (0 RPC / 0 .from() calls)
  // -------------------------------------------------------------------------
  {
    activeClient = createMockSupabase();

    const unauth = createMockReqRes({ authenticated: false, body: { firstName: "Nope" } });
    await handler(unauth.req, unauth.res);
    assert.strictEqual(unauth.res._getStatus(), 401);

    const missingId = createMockReqRes({ id: "", body: { firstName: "Nope" } });
    await handler(missingId.req, missingId.res);
    assert.strictEqual(missingId.res._getStatus(), 400);

    for (const badSplit of [-0.01, 100.01, "not-a-number"]) {
      const bad = createMockReqRes({ body: { splitPct: badSplit } });
      await handler(bad.req, bad.res);
      assert.strictEqual(bad.res._getStatus(), 500, `Invalid splitPct (${badSplit}) must preserve 500 error`);
      assert.match(bad.res._getJson().error, /Invalid split percentage/i);
    }

    const legacyRules = createMockReqRes({
      body: { firstName: "Alice", commissionRules: [{ recipientId: "inv_2", percent: 10 }] }
    });
    await handler(legacyRules.req, legacyRules.res);
    assert.strictEqual(legacyRules.res._getStatus(), 400);
    assert.strictEqual(legacyRules.res._getJson().code, "LEGACY_COMMISSION_RULES_DEPRECATED");

    const badMethod = createMockReqRes({ method: "GET" });
    await handler(badMethod.req, badMethod.res);
    assert.strictEqual(badMethod.res._getStatus(), 405);

    assert.strictEqual(activeClient.rpcCalls.length, 0, "Validation/auth failures must not call RPC");
    assert.strictEqual(activeClient.fromCalls.length, 0, "Validation/auth failures must not touch REST tables");
    console.log("  PASS [1]: Auth, method, splitPct, and legacy commissionRules guards execute before any RPC or table call");
  }

  // -------------------------------------------------------------------------
  // TEST 2: PATCH & PUT invoke exactly ONE RPC call, ZERO .from() calls,
  //         hash passwords in Node, and preserve { success: true, investor }
  // -------------------------------------------------------------------------
  {
    activeClient = createMockSupabase({
      onRpc: async (_fn, params) => ({
        data: {
          status: "SUCCESS",
          investor: {
            id: params.p_investor_id,
            first_name: params.p_investor_updates.first_name,
            last_name: params.p_investor_updates.last_name,
            email: params.p_investor_updates.email,
            portal_username: params.p_investor_updates.portal_username,
            temp_password: params.p_investor_updates.temp_password,
            split_pct: params.p_investor_updates.split_pct,
            monthly_draw: params.p_investor_updates.monthly_draw,
            start_date: params.p_investor_updates.start_date,
            role: params.p_investor_updates.role,
            show_fund_performance: params.p_investor_updates.show_fund_performance,
            notes: params.p_investor_updates.notes
          },
          accounts_updated: 2,
          account_created: false
        },
        error: null
      })
    });

    const patchCall = createMockReqRes({
      method: "PATCH",
      id: "inv_alpha",
      body: {
        firstName: "Alice",
        lastName: "Tester",
        email: "alice@example.test",
        portalUsername: "alicedoe",
        password: "SyntheticPlaintextPassword!1",
        startingCapital: 125000,
        totalCashIn: 130000,
        startDate: "2026-01-01",
        asOfDate: "2026-02-01",
        splitPct: 75,
        monthlyDraw: 1500,
        role: "investor",
        showFundPerformance: true,
        isCommission: "true",
        name: "Alice Primary",
        notes: "Updated atomically"
      }
    });

    await handler(patchCall.req, patchCall.res);

    assert.strictEqual(patchCall.res._getStatus(), 200);
    const json = patchCall.res._getJson();
    assert.deepStrictEqual(Object.keys(json).sort(), ["investor", "success"]);
    assert.strictEqual(json.success, true);
    assert.strictEqual(json.investor.id, "inv_alpha");
    assert.strictEqual(json.investor.show_fund_performance, true);

    assert.strictEqual(activeClient.rpcCalls.length, 1, "PATCH must invoke exactly one RPC");
    assert.strictEqual(activeClient.fromCalls.length, 0, "PATCH must not execute separate REST table reads/writes");

    const call = activeClient.rpcCalls[0];
    assert.strictEqual(call.fnName, "update_investor_profile_and_accounts_atomic");
    assert.strictEqual(call.params.p_investor_id, "inv_alpha");
    assert.strictEqual(call.params.p_target_portal_username, "alicedoe");

    // Password hashed in Node; plaintext never sent to SQL
    assert.strictEqual(isBcryptHash(call.params.p_investor_updates.temp_password), true);
    assert.notStrictEqual(call.params.p_investor_updates.temp_password, "SyntheticPlaintextPassword!1");
    assert.strictEqual(verifyPassword("SyntheticPlaintextPassword!1", call.params.p_investor_updates.temp_password), true);

    // Exact alias precedence preserved:
    // - investors.start_date uses asOfDate when both startDate & asOfDate are supplied
    // - investor_accounts.open_date uses body.startDate || body.asOfDate
    assert.strictEqual(call.params.p_investor_updates.start_date, "2026-02-01");
    assert.strictEqual(call.params.p_account_updates.open_date, "2026-01-01");
    assert.deepStrictEqual(call.params.p_account_updates, {
      name: "Alice Primary",
      starting_capital: 125000,
      total_cash_in: 130000,
      is_commission: true,
      split_pct: 75,
      open_date: "2026-01-01"
    });

    // Exact create-if-missing payload derived when startingCapital is present and non-empty
    assert.strictEqual(call.params.p_create_account_if_missing, true);
    assert.deepStrictEqual(call.params.p_create_account_payload, {
      id: "alicedoe",
      investor_id: "inv_alpha",
      name: "Alice Primary",
      starting_capital: 125000,
      total_cash_in: 130000,
      open_date: "2026-01-01",
      status: "Active",
      is_commission: true,
      split_pct: 75,
      notes: "Created via Admin Dashboard update"
    });

    // Verify PUT uses the identical single-RPC path and preserves pre-hashed bcrypt password
    const existingHash = call.params.p_investor_updates.temp_password;
    const putCall = createMockReqRes({
      method: "PUT",
      id: "inv_alpha",
      body: {
        tempPassword: existingHash,
        password: "ignored_because_tempPassword_defined",
        showFundPerformance: true,
        show_fund_performance: "false"
      }
    });
    await handler(putCall.req, putCall.res);
    assert.strictEqual(putCall.res._getStatus(), 200);
    assert.strictEqual(activeClient.rpcCalls.length, 2);
    assert.strictEqual(activeClient.fromCalls.length, 0);
    const putParams = activeClient.rpcCalls[1].params;
    assert.strictEqual(putParams.p_investor_updates.temp_password, existingHash, "Existing bcrypt hash must not be re-hashed");
    assert.strictEqual(putParams.p_investor_updates.show_fund_performance, false, "show_fund_performance overrides showFundPerformance");
    assert.strictEqual(putParams.p_create_account_if_missing, false);
    assert.strictEqual(putParams.p_create_account_payload, null);

    console.log("  PASS [2]: PATCH & PUT invoke one RPC, zero .from() calls, hash password in Node, and preserve exact response & alias precedence");
  }

  // -------------------------------------------------------------------------
  // TEST 3: Input presence, null vs undefined, empty password, and exact insert trigger
  // -------------------------------------------------------------------------
  {
    activeClient = createMockSupabase();

    // 3a. Omitted startingCapital & explicit notes: null & empty tempPassword
    const c1 = createMockReqRes({
      id: "inv_beta",
      body: {
        firstName: "Beta",
        notes: null,
        tempPassword: "",
        password: "should_not_be_used"
      }
    });
    await handler(c1.req, c1.res);
    assert.strictEqual(c1.res._getStatus(), 200);
    const p1 = activeClient.rpcCalls[0].params;
    assert.strictEqual("notes" in p1.p_investor_updates, true);
    assert.strictEqual(p1.p_investor_updates.notes, null);
    assert.strictEqual("last_name" in p1.p_investor_updates, false);
    assert.strictEqual("show_fund_performance" in p1.p_investor_updates, false);
    assert.strictEqual(p1.p_investor_updates.temp_password, "");
    assert.strictEqual(p1.p_target_portal_username, null);
    assert.deepStrictEqual(p1.p_account_updates, {});
    assert.strictEqual(p1.p_create_account_if_missing, false);
    assert.strictEqual(p1.p_create_account_payload, null);

    // 3b. startingCapital === "" must NOT trigger account creation (preserves exact !== "" condition)
    const c2 = createMockReqRes({
      id: "inv_beta",
      body: { startingCapital: "", portalUsername: "" }
    });
    await handler(c2.req, c2.res);
    assert.strictEqual(c2.res._getStatus(), 200);
    const p2 = activeClient.rpcCalls[1].params;
    assert.strictEqual(p2.p_create_account_if_missing, false);
    assert.strictEqual(p2.p_create_account_payload, null);
    assert.strictEqual(p2.p_target_portal_username, null);
    assert.strictEqual(p2.p_investor_updates.portal_username, "");

    // 3c. startingCapital === 0 MUST trigger account creation (preserves exact !== undefined && !== "")
    const c3 = createMockReqRes({
      id: "inv_gamma",
      body: { firstName: "Gamma", lastName: "Zero", startingCapital: 0 }
    });
    await handler(c3.req, c3.res);
    assert.strictEqual(c3.res._getStatus(), 200);
    const p3 = activeClient.rpcCalls[2].params;
    assert.strictEqual(p3.p_create_account_if_missing, true);
    assert.strictEqual(p3.p_create_account_payload.id, "inv_gamma");
    assert.strictEqual(p3.p_create_account_payload.name, "Gamma Zero");
    assert.strictEqual(p3.p_create_account_payload.starting_capital, 0);
    assert.strictEqual(p3.p_create_account_payload.total_cash_in, 0);
    assert.strictEqual(p3.p_create_account_payload.split_pct, 100);
    assert.strictEqual(p3.p_create_account_payload.status, "Active");
    assert.strictEqual(p3.p_create_account_payload.is_commission, false);
    assert.match(p3.p_create_account_payload.open_date, /^\d{4}-\d{2}-\d{2}$/);
    assert.strictEqual(activeClient.fromCalls.length, 0);

    console.log("  PASS [3]: Input presence, null vs undefined, password precedence, and exact account-insert trigger conditions verified");
  }

  // -------------------------------------------------------------------------
  // TEST 4: Fail-closed RPC error handling (never returns 200 on error or bad payload)
  // -------------------------------------------------------------------------
  {
    const failureCases = [
      {
        label: "Postgres constraint / account write error returned in rpcError",
        onRpc: async () => ({ data: null, error: { message: "duplicate key value violates unique constraint", code: "23505" } }),
        expectedMsg: /duplicate key/i
      },
      {
        label: "Missing optional show_fund_performance column error",
        onRpc: async () => ({
          data: null,
          error: {
            message: "SCHEMA_COLUMN_MISSING: Column public.investors.show_fund_performance does not exist.",
            code: "P0001"
          }
        }),
        expectedMsg: /SCHEMA_COLUMN_MISSING/i
      },
      {
        label: "Investor not found error",
        onRpc: async () => ({
          data: null,
          error: { message: "INVESTOR_NOT_FOUND: Investor inv_missing does not exist.", code: "P0001" }
        }),
        expectedMsg: /INVESTOR_NOT_FOUND/i
      },
      {
        label: "Rejected RPC transport promise",
        onRpc: async () => {
          throw new Error("Simulated network timeout during RPC");
        },
        expectedMsg: /Simulated network timeout/i
      },
      {
        label: "Null RPC data with null error",
        onRpc: async () => ({ data: null, error: null }),
        expectedMsg: /invalid response payload/i
      },
      {
        label: "Malformed RPC data missing investor object",
        onRpc: async () => ({ data: { status: "SUCCESS", investor: null }, error: null }),
        expectedMsg: /invalid response payload/i
      }
    ];

    for (const fc of failureCases) {
      activeClient = createMockSupabase({ onRpc: fc.onRpc });
      const call = createMockReqRes({
        id: "inv_fail",
        body: { firstName: "Fail", startingCapital: 50000, showFundPerformance: true }
      });
      await handler(call.req, call.res);
      assert.strictEqual(call.res._getStatus(), 500, `${fc.label}: must return 500, never 200`);
      assert.strictEqual(call.res._getJson().success, undefined, `${fc.label}: must not set success`);
      assert.match(call.res._getJson().error, fc.expectedMsg, `${fc.label}: error message mismatch`);
      assert.strictEqual(activeClient.rpcCalls.length, 1, `${fc.label}: must not retry or fall back`);
      assert.strictEqual(activeClient.fromCalls.length, 0, `${fc.label}: must not fall back to REST writes`);
    }

    // Null supabase client fails closed
    setNullClient(true);
    try {
      const nullCall = createMockReqRes({ id: "inv_null", body: { firstName: "NoDb" } });
      await handler(nullCall.req, nullCall.res);
      assert.strictEqual(nullCall.res._getStatus(), 500);
      assert.match(nullCall.res._getJson().error, /Database client unavailable/i);
    } finally {
      setNullClient(false);
    }

    console.log("  PASS [4]: All 7 RPC failure, malformed-payload, and unavailable-client cases fail closed (HTTP 500, zero fallback writes)");
  }

  // -------------------------------------------------------------------------
  // TEST 5: DELETE path stays isolated from PATCH/PUT RPC and blocks deletion when financial history exists
  // -------------------------------------------------------------------------
  {
    activeClient = createMockSupabase({
      onRpc: async (fnName, params) => {
        assert.strictEqual(fnName, "delete_draft_investor_atomic", "DELETE must invoke delete_draft_investor_atomic, not PATCH/PUT RPC");
        assert.deepStrictEqual(params, { p_investor_id: "inv_with_history" });
        return {
          data: null,
          error: {
            message:
              "FINANCIAL_HISTORY_IMMUTABLE: Cannot delete investor inv_with_history because 1 associated financial/audit dependencies exist (1 deposits, 0 withdrawals, 0 monthly balance history rows, 0 commission earnings, 0 commission shares, 0 snapshots, 0 audit runs, 0 cutover adjustments, 0 internal transfers, 0 legacy commission rules, 0 payment events, 0 funded accounts, 0 provenance-certified accounts). To remove access, set investor status to 'Inactive' instead."
          }
        };
      }
    });
    const delCall = createMockReqRes({ method: "DELETE", id: "inv_with_history" });
    await handler(delCall.req, delCall.res);
    assert.strictEqual(delCall.res._getStatus(), 409);
    assert.match(delCall.res._getJson().error, /FINANCIAL_HISTORY_IMMUTABLE/);
    assert.strictEqual(activeClient.rpcCalls.length, 1);
    assert.strictEqual(activeClient.rpcCalls[0].fnName, "delete_draft_investor_atomic");
    assert.strictEqual(activeClient.fromCalls.length, 0, "DELETE must not issue direct table queries or deletes");

    console.log("  PASS [5]: DELETE handler stays isolated from PATCH/PUT RPC (409 FINANCIAL_HISTORY_IMMUTABLE via delete_draft_investor_atomic)");
  }

  // -------------------------------------------------------------------------
  // TEST 6: Static regression checks on migration SQL, route file, and privileged client source
  // -------------------------------------------------------------------------
  {
    const showPerfMigrationSql = fs.readFileSync(path.join(repoRoot, SHOW_FUND_PERF_MIGRATION_REL_PATH), "utf8");
    const migrationSql = fs.readFileSync(path.join(repoRoot, MIGRATION_REL_PATH), "utf8");
    const routeSrc = fs.readFileSync(path.join(repoRoot, ROUTE_REL_PATH), "utf8");
    const supabaseSrc = fs.readFileSync(path.join(repoRoot, SUPABASE_LIB_REL_PATH), "utf8");

    // Option A prerequisite column migration properties & ordering
    assert.ok(
      path.basename(SHOW_FUND_PERF_MIGRATION_REL_PATH) < path.basename(MIGRATION_REL_PATH),
      "show_fund_performance column migration must sort chronologically before the atomic RPC migration"
    );
    assert.match(showPerfMigrationSql, /^\s*BEGIN;/m, "show_fund_performance migration must wrap DDL in BEGIN;");
    assert.match(showPerfMigrationSql, /^\s*COMMIT;\s*$/m, "show_fund_performance migration must end with COMMIT;");
    assert.match(
      showPerfMigrationSql,
      /ALTER TABLE public\.investors\s+ADD COLUMN IF NOT EXISTS show_fund_performance BOOLEAN NOT NULL DEFAULT FALSE;/,
      "show_fund_performance migration must add BOOLEAN NOT NULL DEFAULT FALSE on public.investors"
    );
    assert.match(
      showPerfMigrationSql,
      /ALTER TABLE public\.investors\s+ALTER COLUMN show_fund_performance SET DEFAULT FALSE;/
    );
    assert.match(
      showPerfMigrationSql,
      /UPDATE public\.investors\s+SET show_fund_performance = FALSE\s+WHERE show_fund_performance IS NULL;/
    );
    assert.match(
      showPerfMigrationSql,
      /ALTER TABLE public\.investors\s+ALTER COLUMN show_fund_performance SET NOT NULL;/
    );
    assert.match(showPerfMigrationSql, /NOTIFY pgrst, 'reload schema';/);
    assert.strictEqual(/\b(DROP|DELETE|TRUNCATE)\b/i.test(showPerfMigrationSql), false, "Column migration must be purely additive");

    // Migration transactional & security properties
    assert.match(migrationSql, /^\s*BEGIN;/m, "Migration must wrap DDL in BEGIN;");
    assert.match(migrationSql, /^\s*COMMIT;\s*$/m, "Migration must terminate transaction with COMMIT;");
    assert.match(
      migrationSql,
      /DROP FUNCTION IF EXISTS public\.update_investor_profile_and_accounts_atomic\(/,
      "Migration must drop matching signature before CREATE OR REPLACE"
    );
    assert.match(
      migrationSql,
      /CREATE OR REPLACE FUNCTION public\.update_investor_profile_and_accounts_atomic\(/,
      "Migration must define public.update_investor_profile_and_accounts_atomic"
    );
    assert.match(migrationSql, /SECURITY DEFINER/, "Function must use SECURITY DEFINER");
    assert.match(migrationSql, /SET search_path = public, pg_temp/, "Function must pin search_path = public, pg_temp");
    assert.match(
      migrationSql,
      /public\.financial_lock_key\(p_investor_id\)/,
      "Function must use checked-in public.financial_lock_key helper"
    );
    assert.match(migrationSql, /PERFORM pg_advisory_xact_lock\(/, "Function must acquire transactional advisory lock");
    assert.match(
      migrationSql,
      /FROM public\.investors\s+WHERE id = p_investor_id\s+FOR UPDATE;/,
      "Function must lock investor row by exact case-sensitive id equality"
    );
    assert.match(
      migrationSql,
      /LOWER\(COALESCE\(a\.investor_id, ''\)\) = LOWER\(COALESCE\(p_investor_id, ''\)\)/,
      "Account matching must preserve clause 1 (investor_id vs p_investor_id)"
    );
    assert.match(
      migrationSql,
      /LOWER\(COALESCE\(a\.investor_id, ''\)\) = LOWER\(v_target_portal_username\)/,
      "Account matching must preserve clause 2 (investor_id vs targetPortalUsername)"
    );
    assert.match(
      migrationSql,
      /LOWER\(COALESCE\(a\.id, ''\)\) = LOWER\(v_target_portal_username\)/,
      "Account matching must preserve clause 3 (account id vs targetPortalUsername)"
    );
    assert.match(
      migrationSql,
      /ORDER BY a\.id ASC\s+FOR UPDATE/,
      "Account rows must be locked in deterministic ORDER BY a.id ASC"
    );
    assert.match(migrationSql, /UNSUPPORTED_INVESTOR_FIELD/, "Investor JSON keys must be whitelisted");
    assert.match(migrationSql, /UNSUPPORTED_ACCOUNT_FIELD/, "Account update JSON keys must be whitelisted");
    assert.match(migrationSql, /UNSUPPORTED_CREATE_ACCOUNT_FIELD/, "Account insert JSON keys must be whitelisted");
    assert.match(migrationSql, /pg_catalog\.pg_attribute/, "Optional show_fund_performance column must be checked via pg_attribute");
    assert.match(migrationSql, /SCHEMA_COLUMN_MISSING/, "Missing show_fund_performance column must fail closed");
    assert.match(
      migrationSql,
      /EXECUTE 'UPDATE public\.investors AS i SET show_fund_performance = \$1, updated_at = NOW\(\) WHERE i\.id = \$2 RETURNING to_jsonb\(i\)'/,
      "Dynamic SQL must use valid whole-row RETURNING to_jsonb(i) with bind parameters (no dynamic column names)"
    );
    assert.strictEqual(
      migrationSql.includes("to_jsonb(i.*)"),
      false,
      "Migration must never contain invalid PostgreSQL expression to_jsonb(i.*)"
    );
    assert.strictEqual(
      /to_jsonb\(\s*[a-zA-Z_][a-zA-Z0-9_]*\.\*\s*\)/.test(migrationSql),
      false,
      "Migration must never expand alias.* inside to_jsonb()"
    );

    // Upfront key-whitelisting must precede locking, while insert-only required-field checks
    // must be deferred into the ELSIF v_create_if_missing branch (after existing-account matching)
    const lockPos = migrationSql.indexOf("PERFORM pg_advisory_xact_lock(");
    const whitelistPos = migrationSql.indexOf("UNSUPPORTED_CREATE_ACCOUNT_FIELD");
    const matchedBranchPos = migrationSql.indexOf("IF cardinality(v_matched_account_ids) > 0 THEN");
    const createBranchPos = migrationSql.indexOf("ELSIF v_create_if_missing THEN");
    const invalidAccIdPos = migrationSql.indexOf("INVALID_ACCOUNT_ID");
    const investorMismatchPos = migrationSql.indexOf("INVESTOR_ID_MISMATCH");
    assert.ok(whitelistPos > -1 && whitelistPos < lockPos, "Create-account JSON key whitelist must run before locking");
    assert.ok(
      matchedBranchPos > lockPos && createBranchPos > matchedBranchPos,
      "Create-account branch must follow existing-account matching branch"
    );
    assert.ok(
      invalidAccIdPos > createBranchPos && investorMismatchPos > createBranchPos,
      "Insert-only required-field checks (INVALID_ACCOUNT_ID / INVESTOR_ID_MISMATCH) must be deferred to the insert branch"
    );
    const preCreateSql = migrationSql.slice(0, createBranchPos);
    assert.strictEqual(
      preCreateSql.includes("INVALID_ACCOUNT_ID") || preCreateSql.includes("INVESTOR_ID_MISMATCH"),
      false,
      "Existing-account updates must not run insert-only required-field checks before matching"
    );
    assert.strictEqual(/\bALTER\s+TABLE\b/i.test(migrationSql), false, "Draft RPC migration must not ALTER tables");

    // Least-privilege execute permissions
    assert.match(migrationSql, /REVOKE ALL ON FUNCTION public\.update_investor_profile_and_accounts_atomic[\s\S]*?FROM PUBLIC;/);
    assert.match(migrationSql, /REVOKE ALL ON FUNCTION public\.update_investor_profile_and_accounts_atomic[\s\S]*?FROM anon;/);
    assert.match(migrationSql, /REVOKE ALL ON FUNCTION public\.update_investor_profile_and_accounts_atomic[\s\S]*?FROM authenticated;/);
    assert.match(migrationSql, /GRANT EXECUTE ON FUNCTION public\.update_investor_profile_and_accounts_atomic[\s\S]*?TO service_role;/);
    assert.match(migrationSql, /NOTIFY pgrst, 'reload schema';/);

    // Route source verification: PATCH/PUT block contains only RPC and zero direct table writes or silent column drops
    const patchSectionStart = routeSrc.indexOf('if (req.method === "PATCH" || req.method === "PUT")');
    const deleteSectionStart = routeSrc.indexOf('if (req.method === "DELETE")');
    assert.ok(patchSectionStart > -1 && deleteSectionStart > patchSectionStart, "Expected PATCH/PUT and DELETE blocks");
    const patchSection = routeSrc.slice(patchSectionStart, deleteSectionStart);
    assert.match(patchSection, /supabase\.rpc\(\s*"update_investor_profile_and_accounts_atomic"/);
    assert.strictEqual(patchSection.includes(".from("), false, "PATCH/PUT block must not make separate supabase.from() calls");
    assert.strictEqual(patchSection.includes("Could not find the '"), false, "PATCH/PUT block must not silently strip missing columns");
    assert.strictEqual(patchSection.includes("delete updates["), false, "PATCH/PUT block must not delete requested investor fields");
    assert.strictEqual(patchSection.includes("delete accUpdates["), false, "PATCH/PUT block must not delete requested account fields");

    // Source-only verification that lib/supabase.js creates the server client with SUPABASE_SERVICE_ROLE_KEY
    assert.match(
      supabaseSrc,
      /const supabaseServiceRoleKey = process\.env\.SUPABASE_SERVICE_ROLE_KEY;\s*[\s\S]*?export const supabase = \(supabaseUrl && supabaseServiceRoleKey\)\s*\?\s*createClient\(supabaseUrl, supabaseServiceRoleKey\)/,
      "lib/supabase.js must construct the server supabase client with SUPABASE_SERVICE_ROLE_KEY"
    );

    console.log("  PASS [6]: Migration SQL security/locking/matching/whitelist properties and route/client source checks verified");
  }

  // -------------------------------------------------------------------------
  // TEST 7: Zero network calls confirmed
  // -------------------------------------------------------------------------
  assert.strictEqual(networkCalls.length, 0, `Unexpected network calls: ${JSON.stringify(networkCalls)}`);
  console.log("  PASS [7]: Zero network calls confirmed");

  console.log("=== ALL ADMIN INVESTOR UPDATE ATOMICITY TESTS PASSED (7/7) ===");
}

try {
  await main();
} finally {
  globalThis.fetch = originalFetch;
  http.request = originalHttpRequest;
  http.get = originalHttpGet;
  https.request = originalHttpsRequest;
  https.get = originalHttpsGet;
  net.connect = originalNetConnect;
  net.createConnection = originalNetCreateConnection;
}
