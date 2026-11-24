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
process.env.SESSION_SECRET = "test_admin_investor_delete_atomicity_offline_secret";

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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const DELETE_MIGRATION_REL_PATH = "supabase/migrations/20261124000000_atomic_admin_investor_delete_rpc.sql";
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

  globalThis.__PHASE3B_INVESTOR_DELETE_HARNESS__ = harness;
  const supabaseShimUrl = `${supabaseFileUrl}?phase3b_investor_delete_shim=1`;

  const supabaseShimSource = `
    export let supabase = new Proxy({}, {
      get(_target, prop) {
        const client = globalThis.__PHASE3B_INVESTOR_DELETE_HARNESS__.getSupabaseClient();
        if (!client) return undefined;
        const val = client[prop];
        return typeof val === "function" ? val.bind(client) : val;
      }
    });
    export function __setNullClient(isNull) {
      supabase = isNull ? null : new Proxy({}, {
        get(_target, prop) {
          const client = globalThis.__PHASE3B_INVESTOR_DELETE_HARNESS__.getSupabaseClient();
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
    const loaderDataUrl = `data:text/javascript;base64,${Buffer.from(loaderSource, "utf8").toString("base64")}`;
    moduleApi.register(loaderDataUrl);
  } else {
    throw new Error("Node runtime supports neither module.registerHooks nor module.register for offline route loading.");
  }

  try {
    const [routeMod, shimMod] = await Promise.all([
      import(`${routeFileUrl}?phase3b_test_instance=1`),
      import(supabaseShimUrl)
    ]);
    return {
      handler: routeMod.default,
      setNullClient: shimMod.__setNullClient
    };
  } finally {
    if (hook && typeof hook.deregister === "function") {
      hook.deregister();
    }
  }
}

function createMockSupabase({ onRpc, onFrom } = {}) {
  const rpcCalls = [];
  const fromCalls = [];
  return {
    rpcCalls,
    fromCalls,
    async rpc(fnName, params) {
      rpcCalls.push({ fnName, params });
      if (onRpc) return await onRpc(fnName, params);
      return { data: null, error: new Error("Unhandled mock rpc call") };
    },
    from(table) {
      fromCalls.push({ table });
      if (onFrom) return onFrom(table);
      throw new Error(`Unexpected direct supabase.from("${table}") call on atomic DELETE path`);
    }
  };
}

function createMockReqRes(opts = {}) {
  const method = opts.method ?? "DELETE";
  const hasExplicitId = Object.prototype.hasOwnProperty.call(opts, "id");
  const id = hasExplicitId ? opts.id : "inv_draft_1";
  const body = opts.body ?? {};
  const authenticated = opts.authenticated ?? true;
  const token = createSession({ adminId: "admin_phase3b", role: "admin" });
  const req = {
    method,
    query: id !== undefined ? { id } : {},
    body,
    headers: authenticated ? { cookie: `scff_admin_session=${token}` } : {}
  };

  let statusCode = 200;
  let jsonBody = null;
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(payload) {
      jsonBody = payload;
      return this;
    },
    _getStatus: () => statusCode,
    _getJson: () => jsonBody
  };
  return { req, res };
}

async function main() {
  console.log("=== Admin Investor DELETE Safety & Atomicity Offline Tests ===");
  console.log("Note: Fake-client and static checks verify the route/RPC contract and migration structure offline; they do NOT execute PostgreSQL or prove live database runtime behavior.");

  let activeClient = createMockSupabase();
  const { handler, setNullClient } = await loadRealInvestorRouteForOfflineTest({
    getSupabaseClient: () => activeClient
  });

  // -------------------------------------------------------------------------
  // TEST 1: Preserved authorization, input validation, unavailable DB, and method guards
  // -------------------------------------------------------------------------
  {
    activeClient = createMockSupabase();

    // 401 when unauthenticated
    const unauth = createMockReqRes({ authenticated: false });
    await handler(unauth.req, unauth.res);
    assert.strictEqual(unauth.res._getStatus(), 401);
    assert.strictEqual(unauth.res._getJson().error, "Unauthorized");

    // 400 when id is missing, empty, whitespace-only, or array-polluted
    for (const badId of [undefined, "", "   ", ["inv_1", "inv_2"]]) {
      const badReq = createMockReqRes({ id: badId });
      await handler(badReq.req, badReq.res);
      assert.strictEqual(badReq.res._getStatus(), 400);
      assert.strictEqual(badReq.res._getJson().error, "Missing investor ID");
    }

    // 405 on unsupported method
    const unsupported = createMockReqRes({ method: "GET" });
    await handler(unsupported.req, unsupported.res);
    assert.strictEqual(unsupported.res._getStatus(), 405);
    assert.strictEqual(unsupported.res._getJson().error, "Method not allowed");

    assert.strictEqual(activeClient.rpcCalls.length, 0, "Guards must block before calling RPC");
    assert.strictEqual(activeClient.fromCalls.length, 0, "Guards must block before calling supabase.from()");

    // 503 when supabase client is unavailable
    setNullClient(true);
    try {
      const noDb = createMockReqRes({ id: "inv_draft_1" });
      await handler(noDb.req, noDb.res);
      assert.strictEqual(noDb.res._getStatus(), 503);
      assert.strictEqual(noDb.res._getJson().error, "Database client unavailable.");
    } finally {
      setNullClient(false);
    }

    console.log("  PASS [1]: Preserved auth (401), ID validation (400), unavailable DB (503), and method (405) guards");
  }

  // -------------------------------------------------------------------------
  // TEST 2: Zero-history draft deletion uses exactly one atomic RPC call and zero direct table calls
  // -------------------------------------------------------------------------
  {
    activeClient = createMockSupabase({
      onRpc: async (fnName, params) => {
        assert.strictEqual(fnName, "delete_draft_investor_atomic");
        assert.deepStrictEqual(params, { p_investor_id: "inv_draft_clean" });
        return {
          data: {
            status: "DELETED",
            deleted_investor_id: "inv_draft_clean",
            deleted_account_ids: ["inv_draft_clean"],
            deleted_accounts_count: 1
          },
          error: null
        };
      }
    });

    const ok = createMockReqRes({ method: "DELETE", id: "  inv_draft_clean  ", body: { action: "delete_user" } });
    await handler(ok.req, ok.res);
    assert.strictEqual(ok.res._getStatus(), 200);
    assert.deepStrictEqual(ok.res._getJson(), {
      success: true,
      message: "Draft investor profile deleted (zero financial history)"
    });
    assert.strictEqual(activeClient.rpcCalls.length, 1);
    assert.strictEqual(activeClient.fromCalls.length, 0, "DELETE must never issue separate REST table queries or deletes");

    console.log("  PASS [2]: Zero-history draft deletion executes via one delete_draft_investor_atomic RPC call (HTTP 200, zero REST writes)");
  }

  // -------------------------------------------------------------------------
  // TEST 3: Protected history, ambiguous account linkage, missing investor, and invalid ID mappings
  // -------------------------------------------------------------------------
  {
    const domainCases = [
      {
        label: "Protected financial/audit history blocked (409 FINANCIAL_HISTORY_IMMUTABLE)",
        id: "inv_protected",
        rpcError: {
          code: "P0001",
          message:
            "FINANCIAL_HISTORY_IMMUTABLE: Cannot delete investor inv_protected because 3 associated financial/audit dependencies exist (0 deposits, 0 withdrawals, 0 monthly balance history rows, 0 commission earnings, 1 commission shares, 1 snapshots, 1 audit runs, 0 cutover adjustments, 0 internal transfers, 0 legacy commission rules, 0 payment events, 0 funded accounts, 0 provenance-certified accounts). To remove access, set investor status to 'Inactive' instead."
        },
        expectedStatus: 409,
        expectedCode: "FINANCIAL_HISTORY_IMMUTABLE"
      },
      {
        label: "ERROR-prefixed immutability message still maps cleanly to 409",
        id: "inv_protected_prefixed",
        rpcError: {
          code: "P0001",
          message: "ERROR: FINANCIAL_HISTORY_IMMUTABLE: Cannot delete investor inv_protected_prefixed because 1 associated financial/audit dependencies exist."
        },
        expectedStatus: 409,
        expectedCode: "FINANCIAL_HISTORY_IMMUTABLE"
      },
      {
        label: "Ambiguous account ownership linkage blocked (409 AMBIGUOUS_ACCOUNT_LINKAGE)",
        id: "inv_ambiguous",
        rpcError: {
          code: "P0001",
          message: "AMBIGUOUS_ACCOUNT_LINKAGE: Account jdoe references investor_id inv_other instead of exact owner inv_ambiguous. Refusing deletion; set investor status to 'Inactive' instead."
        },
        expectedStatus: 409,
        expectedCode: "AMBIGUOUS_ACCOUNT_LINKAGE"
      },
      {
        label: "Non-existent investor returns 404 INVESTOR_NOT_FOUND instead of silent 200",
        id: "inv_missing",
        rpcError: {
          code: "P0001",
          message: "INVESTOR_NOT_FOUND: Investor inv_missing does not exist."
        },
        expectedStatus: 404,
        expectedCode: "INVESTOR_NOT_FOUND"
      },
      {
        label: "RPC invalid ID validation returns 400 INVALID_INVESTOR_ID",
        id: "inv_invalid",
        rpcError: {
          code: "P0001",
          message: "INVALID_INVESTOR_ID: Investor ID is required."
        },
        expectedStatus: 400,
        expectedCode: "INVALID_INVESTOR_ID"
      }
    ];

    for (const tc of domainCases) {
      activeClient = createMockSupabase({
        onRpc: async () => ({ data: null, error: tc.rpcError })
      });
      const call = createMockReqRes({ method: "DELETE", id: tc.id });
      await handler(call.req, call.res);
      assert.strictEqual(call.res._getStatus(), tc.expectedStatus, `${tc.label}: unexpected status`);
      assert.strictEqual(call.res._getJson().code, tc.expectedCode, `${tc.label}: unexpected code`);
      assert.strictEqual(call.res._getJson().success, undefined, `${tc.label}: must not set success`);
      assert.strictEqual(activeClient.rpcCalls.length, 1, `${tc.label}: must call RPC once`);
      assert.strictEqual(activeClient.fromCalls.length, 0, `${tc.label}: must not fall back to REST`);
    }

    console.log("  PASS [3]: Protected history (409), ambiguous account linkage (409), missing investor (404), and invalid ID (400) mapped cleanly");
  }

  // -------------------------------------------------------------------------
  // TEST 4: Fail-closed HTTP 500 on ALL check failures, schema/FK/trigger gaps, missing RPC, and malformed payloads
  // -------------------------------------------------------------------------
  {
    const failClosedCases = [
      {
        label: "Missing migration RPC (PGRST202)",
        onRpc: async () => ({
          data: null,
          error: { code: "PGRST202", message: "Could not find the function public.delete_draft_investor_atomic(p_investor_id) in the schema cache" }
        }),
        expectedMsg: /Could not find the function/
      },
      {
        label: "Required core table missing (commission_shares) fails closed",
        onRpc: async () => ({
          data: null,
          error: { code: "P0001", message: "REQUIRED_TABLE_MISSING: Required table public.commission_shares does not exist; refusing investor deletion." }
        }),
        expectedMsg: /REQUIRED_TABLE_MISSING/
      },
      {
        label: "Required internal_transfers table missing fails closed",
        onRpc: async () => ({
          data: null,
          error: { code: "P0001", message: "REQUIRED_TABLE_MISSING: Required table public.internal_transfers does not exist; refusing investor deletion." }
        }),
        expectedMsg: /REQUIRED_TABLE_MISSING:.*internal_transfers/
      },
      {
        label: "Required internal_transfers table schema mismatch fails closed",
        onRpc: async () => ({
          data: null,
          error: { code: "P0001", message: "SCHEMA_VERIFICATION_FAILED: Table public.internal_transfers exists without expected source/target investor/account columns; refusing investor deletion." }
        }),
        expectedMsg: /SCHEMA_VERIFICATION_FAILED:.*internal_transfers/
      },
      {
        label: "Unverified foreign key dependency fails closed",
        onRpc: async () => ({
          data: null,
          error: { code: "P0001", message: "UNVERIFIED_FOREIGN_KEY_DEPENDENCY: Cannot safely delete investor inv_fail because table public.extra_ledger column investor_id has unverified foreign key extra_fkey (delete_action=c) referencing investors/investor_accounts." }
        }),
        expectedMsg: /UNVERIFIED_FOREIGN_KEY_DEPENDENCY/
      },
      {
        label: "Unverified DELETE trigger fails closed",
        onRpc: async () => ({
          data: null,
          error: { code: "P0001", message: "UNVERIFIED_DELETE_TRIGGER: Cannot safely delete investor inv_fail because table public.investors has unverified DELETE trigger trg_custom_delete." }
        }),
        expectedMsg: /UNVERIFIED_DELETE_TRIGGER/
      },
      {
        label: "Database physical-delete trigger rejection fails closed",
        onRpc: async () => ({
          data: null,
          error: { code: "P0001", message: "PHYSICAL_DELETION_PROHIBITED: Financial and audit records in table deposits cannot be physically deleted." }
        }),
        expectedMsg: /PHYSICAL_DELETION_PROHIBITED/
      },
      {
        label: "Delete count mismatch fails closed",
        onRpc: async () => ({
          data: null,
          error: { code: "P0001", message: "DELETE_COUNT_MISMATCH: Expected to delete 1 draft investor row for inv_fail, deleted 0." }
        }),
        expectedMsg: /DELETE_COUNT_MISMATCH/
      },
      {
        label: "Empty/opaque RPC error object fails closed",
        onRpc: async () => ({ data: null, error: {} }),
        expectedMsg: /Atomic investor deletion failed/i
      },
      {
        label: "Rejected RPC promise fails closed",
        onRpc: async () => {
          throw new Error("connection terminated unexpectedly");
        },
        expectedMsg: /connection terminated unexpectedly/
      },
      {
        label: "Null RPC payload fails closed",
        onRpc: async () => ({ data: null, error: null }),
        expectedMsg: /invalid response payload/i
      },
      {
        label: "Unexpected RPC status fails closed",
        onRpc: async () => ({
          data: { status: "BLOCKED", deleted_investor_id: "inv_fail" },
          error: null
        }),
        expectedMsg: /invalid response payload/i
      },
      {
        label: "Mismatched deleted_investor_id fails closed",
        onRpc: async () => ({
          data: { status: "DELETED", deleted_investor_id: "inv_someone_else" },
          error: null
        }),
        expectedMsg: /invalid response payload/i
      }
    ];

    for (const fc of failClosedCases) {
      activeClient = createMockSupabase({ onRpc: fc.onRpc });
      const call = createMockReqRes({ method: "DELETE", id: "inv_fail" });
      await handler(call.req, call.res);
      assert.strictEqual(call.res._getStatus(), 500, `${fc.label}: must fail closed with HTTP 500`);
      assert.strictEqual(call.res._getJson().success, undefined, `${fc.label}: must not report success`);
      assert.match(call.res._getJson().error, fc.expectedMsg, `${fc.label}: error message mismatch`);
      assert.strictEqual(activeClient.rpcCalls.length, 1, `${fc.label}: must not retry`);
      assert.strictEqual(activeClient.fromCalls.length, 0, `${fc.label}: must never fall back to direct REST queries/deletes`);
    }

    console.log("  PASS [4]: All 13 check-failure, missing/malformed internal_transfers, schema/FK/trigger-gap, missing-RPC, and malformed-payload cases fail closed (HTTP 500, zero fallback)");
  }

  // -------------------------------------------------------------------------
  // TEST 5: Static regression checks on migration SQL, route DELETE & PATCH/PUT isolation, and grants
  // -------------------------------------------------------------------------
  {
    const migrationSql = fs.readFileSync(path.join(repoRoot, DELETE_MIGRATION_REL_PATH), "utf8");
    const routeSrc = fs.readFileSync(path.join(repoRoot, ROUTE_REL_PATH), "utf8");
    const supabaseSrc = fs.readFileSync(path.join(repoRoot, SUPABASE_LIB_REL_PATH), "utf8");

    // Transactional wrapper & pure-RPC additive scope
    assert.match(migrationSql, /^\s*BEGIN;/m, "Migration must wrap DDL in BEGIN;");
    assert.match(migrationSql, /^\s*COMMIT;\s*$/m, "Migration must end with COMMIT;");
    assert.strictEqual(/\bALTER\s+TABLE\b/i.test(migrationSql), false, "Draft delete RPC migration must not ALTER tables");
    assert.strictEqual(/\bCREATE\s+TRIGGER\b/i.test(migrationSql), false, "Draft delete RPC migration must not create/alter table triggers");
    assert.strictEqual(/\bTRUNCATE\b/i.test(migrationSql), false, "Migration must never TRUNCATE");

    // Function signature, security definer, pinned search_path, locking conventions
    assert.match(migrationSql, /DROP FUNCTION IF EXISTS public\.delete_draft_investor_atomic\(text\);/);
    assert.match(migrationSql, /CREATE OR REPLACE FUNCTION public\.delete_draft_investor_atomic\(\s*p_investor_id TEXT\s*\)\s*RETURNS JSONB/s);
    assert.match(migrationSql, /SECURITY DEFINER/);
    assert.match(migrationSql, /SET search_path = public, pg_temp/);
    assert.match(migrationSql, /public\.financial_lock_key\(v_investor_id\)/);
    assert.match(migrationSql, /PERFORM pg_advisory_xact_lock\(v_lock_key\);/);
    assert.match(migrationSql, /FROM public\.investors\s+WHERE id = v_investor_id\s+FOR UPDATE;/);
    assert.match(migrationSql, /ORDER BY a\.id ASC\s+FOR UPDATE/);
    assert.match(migrationSql, /PERFORM pg_advisory_xact_lock\(hashtext\(v_prelock_acc_id\)\);/);
    assert.match(migrationSql, /pg_try_advisory_xact_lock\(hashtext\(v_acc_rec\.id\)\)/);
    const prelockPos = migrationSql.indexOf("PERFORM pg_advisory_xact_lock(hashtext(v_prelock_acc_id));");
    const investorForUpdatePos = migrationSql.search(/FROM public\.investors\s+WHERE id = v_investor_id\s+FOR UPDATE;/);
    assert.ok(
      prelockPos > -1 && investorForUpdatePos > prelockPos,
      "Account advisory locks must be acquired before FOR UPDATE row locks to prevent deadlock with transfer RPCs"
    );

    // Fail-closed catalog and schema guards
    assert.match(migrationSql, /REQUIRED_TABLE_MISSING/);
    assert.match(migrationSql, /AMBIGUOUS_ACCOUNT_LINKAGE/);
    assert.match(migrationSql, /pg_catalog\.pg_constraint/);
    assert.match(migrationSql, /UNVERIFIED_FOREIGN_KEY_DEPENDENCY/);
    assert.match(migrationSql, /pg_catalog\.pg_trigger/);
    assert.match(migrationSql, /UNVERIFIED_DELETE_TRIGGER/);
    assert.match(migrationSql, /SCHEMA_VERIFICATION_FAILED/);
    assert.match(migrationSql, /FINANCIAL_HISTORY_IMMUTABLE/);
    assert.match(migrationSql, /DELETE_COUNT_MISMATCH/);

    // All checked-in protected financial/commission/audit tables MUST be checked
    for (const table of [
      "public.deposits",
      "public.withdrawals",
      "public.investor_monthly_history",
      "public.commission_earnings",
      "public.commission_shares",
      "public.snapshots",
      "public.audit_runs",
      "public.account_cutover_adjustments",
      "public.internal_transfers",
      "public.commission_rules",
      "public.payment_provider_events"
    ]) {
      assert.ok(migrationSql.includes(table), `Migration must explicitly inspect ${table}`);
    }

    // public.internal_transfers MUST be a required table (never treated as optional when absent)
    const requiredArrayMatch = migrationSql.match(/FOREACH\s+v_missing_table\s+IN\s+ARRAY\s+ARRAY\[([\s\S]*?)\]\s+LOOP/);
    assert.ok(requiredArrayMatch, "Migration must define required table array before locking/deleting");
    assert.match(
      requiredArrayMatch[1],
      /'internal_transfers'/,
      "public.internal_transfers must be in the required-table fail-closed check list"
    );
    assert.strictEqual(
      /IF\s+to_regclass\('public\.internal_transfers'\)\s+IS\s+NOT\s+NULL/i.test(migrationSql),
      false,
      "public.internal_transfers must NOT be guarded as optional (IS NOT NULL)"
    );
    assert.match(
      migrationSql,
      /IF\s+to_regclass\('public\.internal_transfers'\)\s+IS\s+NULL\s+THEN\s+RAISE\s+EXCEPTION\s+'REQUIRED_TABLE_MISSING:/,
      "Step 9i must fail closed with REQUIRED_TABLE_MISSING if public.internal_transfers is absent"
    );
    for (const col of ["source_investor_id", "source_account_id", "target_investor_id", "target_account_id"]) {
      assert.match(
        migrationSql,
        new RegExp(`attrelid\\s*=\\s*'public\\.internal_transfers'::regclass[\\s\\S]*?attname\\s*=\\s*'${col}'`),
        `Migration must verify public.internal_transfers.${col} via pg_catalog.pg_attribute`
      );
    }

    // Account capital & provenance protection
    assert.match(migrationSql, /COALESCE\(v_acc_rec\.starting_capital,\s*0\)\s*<>\s*0/);
    assert.match(migrationSql, /COALESCE\(v_acc_rec\.total_cash_in,\s*0\)\s*<>\s*0/);
    assert.match(migrationSql, /initial_cash_contribution/);
    assert.match(migrationSql, /capital_origin_type/);
    assert.match(migrationSql, /external_cash_provenance_status/);

    // Strictly NEVER DELETE FROM any financial or audit table — only investor_accounts and investors
    const deleteTargets = [...migrationSql.matchAll(/\bDELETE\s+FROM\s+([a-zA-Z0-9_."]+)/gi)].map((m) => m[1].toLowerCase());
    assert.deepStrictEqual(
      deleteTargets,
      ["public.investor_accounts", "public.investors"],
      `RPC must ONLY delete from public.investor_accounts and public.investors (found: ${JSON.stringify(deleteTargets)})`
    );

    // Gate ordering: all catalog/history checks and immutability gate MUST precede both DELETE statements
    const fkAuditPos = migrationSql.indexOf("UNVERIFIED_FOREIGN_KEY_DEPENDENCY");
    const triggerAuditPos = migrationSql.indexOf("UNVERIFIED_DELETE_TRIGGER");
    const immutabilityGatePos = migrationSql.indexOf("IF v_total_protected_records IS NULL OR v_total_protected_records > 0 THEN");
    const firstDeletePos = migrationSql.indexOf("DELETE FROM public.investor_accounts");
    const secondDeletePos = migrationSql.indexOf("DELETE FROM public.investors");
    assert.ok(fkAuditPos > -1 && fkAuditPos < firstDeletePos, "FK catalog audit must run before any DELETE");
    assert.ok(triggerAuditPos > -1 && triggerAuditPos < firstDeletePos, "DELETE trigger audit must run before any DELETE");
    assert.ok(immutabilityGatePos > -1 && immutabilityGatePos < firstDeletePos, "Immutability gate must run before any DELETE");
    assert.ok(firstDeletePos < secondDeletePos, "investor_accounts delete must precede investors delete");

    // Never use invalid PostgreSQL expression to_jsonb(alias.*)
    assert.strictEqual(/to_jsonb\(\s*[a-zA-Z_][a-zA-Z0-9_]*\.\*\s*\)/.test(migrationSql), false);

    // Least-privilege grants (service_role ONLY)
    assert.match(migrationSql, /REVOKE ALL ON FUNCTION public\.delete_draft_investor_atomic\(text\) FROM PUBLIC;/);
    assert.match(migrationSql, /REVOKE ALL ON FUNCTION public\.delete_draft_investor_atomic\(text\) FROM anon;/);
    assert.match(migrationSql, /REVOKE ALL ON FUNCTION public\.delete_draft_investor_atomic\(text\) FROM authenticated;/);
    assert.match(migrationSql, /GRANT EXECUTE ON FUNCTION public\.delete_draft_investor_atomic\(text\) TO service_role;/);
    assert.strictEqual(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.delete_draft_investor_atomic[\s\S]*?TO\s+(PUBLIC|anon|authenticated)/i.test(migrationSql), false, "Must not broaden grants beyond service_role");
    assert.match(migrationSql, /NOTIFY pgrst, 'reload schema';/);

    // Route source isolation: DELETE calls ONLY delete_draft_investor_atomic; ZERO .from() or .delete() calls; PATCH/PUT preserved
    const patchStart = routeSrc.indexOf('if (req.method === "PATCH" || req.method === "PUT")');
    const deleteStart = routeSrc.indexOf('if (req.method === "DELETE")');
    assert.ok(patchStart > -1 && deleteStart > patchStart, "Expected PATCH/PUT and DELETE blocks");
    const patchSection = routeSrc.slice(patchStart, deleteStart);
    const deleteSection = routeSrc.slice(deleteStart);

    assert.match(patchSection, /supabase\.rpc\(\s*"update_investor_profile_and_accounts_atomic"/, "PATCH/PUT RPC must remain intact");
    assert.match(deleteSection, /supabase\.rpc\(\s*"delete_draft_investor_atomic"/, "DELETE must invoke delete_draft_investor_atomic");
    assert.strictEqual(deleteSection.includes(".from("), false, "DELETE block must not issue direct supabase.from() calls");
    assert.strictEqual(deleteSection.includes(".delete("), false, "DELETE block must not issue direct .delete() calls");
    assert.strictEqual(deleteSection.includes("snapshots"), false, "DELETE block must never delete snapshots");
    assert.strictEqual(deleteSection.includes("commission_rules"), false, "DELETE block must never delete commission_rules");

    // Server client still uses SUPABASE_SERVICE_ROLE_KEY
    assert.match(supabaseSrc, /const supabaseServiceRoleKey = process\.env\.SUPABASE_SERVICE_ROLE_KEY;/);

    console.log("  PASS [5]: Migration SQL security/locking/catalog-audit/immutability/grant invariants and route isolation verified");
  }

  // -------------------------------------------------------------------------
  // TEST 6: Zero network calls confirmed
  // -------------------------------------------------------------------------
  assert.strictEqual(networkCalls.length, 0, `Unexpected network calls: ${JSON.stringify(networkCalls)}`);
  console.log("  PASS [6]: Zero network calls confirmed");

  console.log("=== ALL ADMIN INVESTOR DELETE SAFETY & ATOMICITY TESTS PASSED (6/6) ===");
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
