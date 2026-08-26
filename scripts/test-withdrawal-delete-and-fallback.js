import assert from "node:assert";

// Set mock environment variables before importing application modules
process.env.SUPABASE_URL = "https://mock.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "mock_service_role_key_for_testing";
process.env.SESSION_SECRET = "test_session_secret_32_characters_long_min";

const { default: createWithdrawalHandler } = await import("../api/admin/withdrawals/index.js");
const { default: withdrawalItemHandler } = await import("../api/admin/withdrawals/[id].js");
const { default: cancelWithdrawalHandler } = await import("../api/admin/withdrawals/[id]/cancel.js");
const { default: equityHandler } = await import("../api/admin/withdrawals/equity.js");
const { createSession } = await import("../lib/auth.js");
const { supabase } = await import("../lib/supabase.js");

// Helper mock req/res factory
function createMockReqRes({ method = "GET", query = {}, body = {}, isAuthenticated = true }) {
  const adminCookie = isAuthenticated ? createSession({ adminId: "admin_user_1", role: "admin" }) : "";
  const req = {
    method,
    query,
    body,
    headers: {
      cookie: isAuthenticated ? `scff_admin_session=${adminCookie}` : ""
    }
  };

  let statusCode = 200;
  let responseData = null;
  const responseHeaders = {};

  const res = {
    status(code) {
      statusCode = code;
      return res;
    },
    setHeader(name, value) {
      responseHeaders[name] = value;
      return res;
    },
    json(data) {
      responseData = data;
      return res;
    },
    _getStatus: () => statusCode,
    _getData: () => responseData,
    _getHeaders: () => responseHeaders
  };

  return { req, res };
}

async function runTests() {
  console.log("===============================================================================");
  console.log("RUNNING PACKAGE B APPLICATION REMEDIATION REGRESSION TESTS (MOCK / ROUTING)");
  console.log("===============================================================================\n");

  let testsPassed = 0;
  let testsFailed = 0;

  function recordPass(testName) {
    console.log(`✅ PASS: ${testName}`);
    testsPassed++;
  }

  function recordFail(testName, err) {
    console.error(`❌ FAIL: ${testName}`);
    console.error(err);
    testsFailed++;
  }

  // 1. Test Physical DELETE rejection on /api/admin/withdrawals/[id]
  try {
    const { req, res } = createMockReqRes({
      method: "DELETE",
      query: { id: "test-wd-uuid-123" }
    });

    await withdrawalItemHandler(req, res);

    assert.strictEqual(res._getStatus(), 405, "DELETE should return 405 Method Not Allowed");
    assert.ok(res._getData()?.error?.includes("Physical deletion of financial withdrawal records is permanently disabled"), "Error message should mention physical deletion disabled");
    assert.deepStrictEqual(res._getHeaders()["Allow"], ["PATCH", "PUT"], "Allow header must not include DELETE");
    recordPass("1. Physical DELETE endpoint explicitly returns 405 and blocks raw deletion");
  } catch (e) {
    recordFail("1. Physical DELETE rejection", e);
  }

  // 2. Test Missing RPC Fail-Closed on POST /api/admin/withdrawals
  try {
    const originalRpc = supabase?.rpc;
    supabase.rpc = async (funcName) => {
      if (funcName === "create_withdrawal_atomic") {
        return { data: null, error: { message: "function create_withdrawal_atomic(text, text, numeric, date, text, text, text, text) does not exist", code: "42883" } };
      }
      return { data: null, error: null };
    };

    const { req, res } = createMockReqRes({
      method: "POST",
      body: {
        investorId: "test_inv_1",
        accountId: "test_acc_1",
        amount: 500.00,
        month: "August",
        year: 2026,
        status: "Pending"
      }
    });

    await createWithdrawalHandler(req, res);

    assert.strictEqual(res._getStatus(), 503, "Missing create RPC should return 503 Service Unavailable");
    assert.ok(res._getData()?.error?.includes("PACKAGE_B_RPC_UNAVAILABLE"), "Error must state PACKAGE_B_RPC_UNAVAILABLE");
    recordPass("2. Missing create_withdrawal_atomic RPC fails closed with 503 (No raw INSERT)");

    supabase.rpc = originalRpc;
  } catch (e) {
    recordFail("2. Missing create RPC fail-closed", e);
  }

  // 3. Test Missing RPC Fail-Closed on PATCH /api/admin/withdrawals/[id]
  try {
    const originalRpc = supabase?.rpc;
    supabase.rpc = async (funcName) => {
      if (funcName === "update_withdrawal_atomic") {
        return { data: null, error: { message: "function update_withdrawal_atomic(uuid, numeric, text, text, text) does not exist", code: "42883" } };
      }
      return { data: null, error: null };
    };

    const { req, res } = createMockReqRes({
      method: "PATCH",
      query: { id: "test-wd-uuid-123" },
      body: {
        status: "Void"
      }
    });

    await withdrawalItemHandler(req, res);

    assert.strictEqual(res._getStatus(), 503, "Missing update RPC should return 503 Service Unavailable");
    assert.ok(res._getData()?.error?.includes("PACKAGE_B_RPC_UNAVAILABLE"), "Error must state PACKAGE_B_RPC_UNAVAILABLE");
    recordPass("3. Missing update_withdrawal_atomic RPC fails closed with 503 (No raw UPDATE)");

    supabase.rpc = originalRpc;
  } catch (e) {
    recordFail("3. Missing update RPC fail-closed", e);
  }

  // 4. Test Missing RPC Fail-Closed on POST /api/admin/withdrawals/[id]/cancel
  try {
    const originalRpc = supabase?.rpc;
    supabase.rpc = async (funcName) => {
      if (funcName === "update_withdrawal_atomic") {
        return { data: null, error: { message: "function update_withdrawal_atomic does not exist", code: "42883" } };
      }
      return { data: null, error: null };
    };

    const { req, res } = createMockReqRes({
      method: "POST",
      query: { id: "test-wd-uuid-123" }
    });

    await cancelWithdrawalHandler(req, res);

    assert.strictEqual(res._getStatus(), 503, "Missing update RPC on cancel endpoint should return 503");
    assert.ok(res._getData()?.error?.includes("PACKAGE_B_RPC_UNAVAILABLE"), "Error must state PACKAGE_B_RPC_UNAVAILABLE");
    recordPass("4. Missing RPC on cancel endpoint fails closed with 503");

    supabase.rpc = originalRpc;
  } catch (e) {
    recordFail("4. Missing RPC on cancel endpoint", e);
  }

  // 5. Test Successful RPC create flow
  try {
    const originalRpc = supabase?.rpc;
    supabase.rpc = async (funcName, params) => {
      if (funcName === "create_withdrawal_atomic") {
        return {
          data: {
            status: "SUCCESS",
            withdrawal_id: "new-wd-uuid-789",
            amount: params.p_amount,
            available_equity_before: 50000.00,
            available_equity_after: 50000.00 - params.p_amount,
            effective_accounting_date: params.p_effective_date,
            withdrawal: {
              id: "new-wd-uuid-789",
              investor_id: params.p_investor_id,
              amount: params.p_amount,
              status: params.p_status
            }
          },
          error: null
        };
      }
      return { data: null, error: null };
    };

    const { req, res } = createMockReqRes({
      method: "POST",
      body: {
        investorId: "test_inv_1",
        accountId: "test_acc_1",
        amount: 2500.00,
        month: "August",
        year: 2026,
        status: "Approved"
      }
    });

    await createWithdrawalHandler(req, res);

    assert.strictEqual(res._getStatus(), 201, "Successful creation should return 201 Created");
    assert.strictEqual(res._getData()?.status, "SUCCESS");
    assert.strictEqual(res._getData()?.withdrawal?.amount, 2500.00);
    recordPass("5. Successful create_withdrawal_atomic RPC returns 201 with structured payload");

    supabase.rpc = originalRpc;
  } catch (e) {
    recordFail("5. Successful RPC create flow", e);
  }

  // 6. Test Successful RPC update flow (e.g. Void status)
  try {
    const originalRpc = supabase?.rpc;
    supabase.rpc = async (funcName, params) => {
      if (funcName === "update_withdrawal_atomic") {
        return {
          data: {
            status: "SUCCESS",
            withdrawal_id: params.p_withdrawal_id,
            available_equity_before: 47500.00,
            available_equity_after: 50000.00,
            withdrawal: {
              id: params.p_withdrawal_id,
              status: params.p_status
            }
          },
          error: null
        };
      }
      return { data: null, error: null };
    };

    const { req, res } = createMockReqRes({
      method: "PATCH",
      query: { id: "target-wd-uuid-456" },
      body: {
        status: "Void"
      }
    });

    await withdrawalItemHandler(req, res);

    assert.strictEqual(res._getStatus(), 200, "Successful update should return 200 OK");
    assert.strictEqual(res._getData()?.status, "SUCCESS");
    assert.strictEqual(res._getData()?.withdrawal?.status, "Void");
    recordPass("6. Successful update_withdrawal_atomic RPC returns 200 with structured payload");

    supabase.rpc = originalRpc;
  } catch (e) {
    recordFail("6. Successful RPC update flow", e);
  }

  // 7. Test Unauthorized access rejection (No auth header / invalid session)
  try {
    const { req, res } = createMockReqRes({
      method: "POST",
      isAuthenticated: false,
      body: { amount: 1000 }
    });

    await createWithdrawalHandler(req, res);

    assert.strictEqual(res._getStatus(), 401, "Unauthenticated request must return 401 Unauthorized");
    recordPass("7. Unauthenticated request to withdrawal endpoints returns 401 Unauthorized");
  } catch (e) {
    recordFail("7. Unauthorized access rejection", e);
  }

  // 8. Test Read-Only equity endpoint validation
  try {
    const { req, res } = createMockReqRes({
      method: "GET",
      query: {} // Missing investorId
    });

    await equityHandler(req, res);

    assert.strictEqual(res._getStatus(), 400, "Missing investorId should return 400 Bad Request");
    recordPass("8. Read-only equity endpoint properly validates input params");
  } catch (e) {
    recordFail("8. Read-only equity validation", e);
  }

  console.log("\n===============================================================================");
  console.log(`TEST RESULTS: ${testsPassed} PASSED, ${testsFailed} FAILED`);
  console.log("===============================================================================\n");

  if (testsFailed > 0) {
    process.exit(1);
  }
}

runTests();
