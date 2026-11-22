import assert from "node:assert/strict";
import http from "node:http";
import https from "node:https";
import net from "node:net";

// Install hard network-call guards BEFORE importing the route or any helper modules.
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
    networkCalls.push({ apiName, argsCount: args.length });
    throw new Error(`NETWORK_CALL_FORBIDDEN: ${apiName} must not be invoked in offline test`);
  };
}

globalThis.fetch = blockNetwork("fetch");
http.request = blockNetwork("http.request");
http.get = blockNetwork("http.get");
https.request = blockNetwork("https.request");
https.get = blockNetwork("https.get");
net.connect = blockNetwork("net.connect");
net.createConnection = blockNetwork("net.createConnection");

const { default: handler } = await import("../api/admin/accounting/cashflows-review/index.js");
const { createSession } = await import("../lib/auth.js");

function deepFreezeRows(rows) {
  return Object.freeze(rows.map((row) => Object.freeze({ ...row })));
}

function createAdminCookie() {
  const token = createSession({ adminId: "admin_offline_verifier", role: "admin" });
  return `scff_admin_session=${encodeURIComponent(token)}`;
}

function createMockReq({ method = "GET", query = {}, authenticated = true } = {}) {
  return {
    method,
    query,
    headers: authenticated ? { cookie: createAdminCookie() } : {}
  };
}

function createMockRes() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
}

function matchesIlike(value, pattern) {
  if (value === null || value === undefined) return null; // SQL NULL semantics
  const escaped = String(pattern)
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/%/g, ".*")
    .replace(/_/g, ".");
  return new RegExp(`^${escaped}$`, "i").test(String(value));
}

function compareValues(a, b, ascending) {
  if (a === b) return 0;
  if (a === null || a === undefined) return ascending ? 1 : -1;
  if (b === null || b === undefined) return ascending ? -1 : 1;
  const cmp = typeof a === "number" && typeof b === "number"
    ? a - b
    : String(a).localeCompare(String(b));
  return ascending ? cmp : -cmp;
}

/**
 * Strict in-memory read-only Supabase mock with simulated server-side page caps,
 * PostgREST filter/order/range emulation, write prohibition, and optional page fault injection.
 */
function createInMemorySupabaseMock(tables, options = {}) {
  const { serverPageCap = 1000, onPageRequest = null } = options;
  const frozenTables = {};
  for (const [name, rows] of Object.entries(tables)) {
    frozenTables[name] = deepFreezeRows(rows);
  }

  const queryLog = [];
  const writeAttempts = [];
  const requestCountsByTable = {};

  function recordForbiddenWrite(table, op) {
    writeAttempts.push({ table, op });
    throw new Error(`WRITE_OPERATION_FORBIDDEN: ${op} on ${table}`);
  }

  const client = {
    queryLog,
    writeAttempts,
    requestCountsByTable,
    rpc(fnName) {
      recordForbiddenWrite(`rpc:${fnName}`, "rpc");
    },
    get storage() {
      recordForbiddenWrite("storage", "storage");
      return null;
    },
    from(table) {
      const state = {
        table,
        selectCols: null,
        filters: [],
        orders: [],
        range: null
      };

      const execute = async () => {
        requestCountsByTable[table] = (requestCountsByTable[table] || 0) + 1;
        const requestNumber = requestCountsByTable[table];

        const queryEntry = {
          table,
          requestNumber,
          select: state.selectCols,
          filters: state.filters.map((f) => ({ ...f })),
          orders: state.orders.map((o) => ({ ...o })),
          range: state.range ? { ...state.range } : null
        };
        queryLog.push(queryEntry);

        let rows = (frozenTables[table] || []).slice();

        for (const filter of state.filters) {
          if (filter.kind === "not") {
            rows = rows.filter((row) => {
              if (filter.operator === "ilike") {
                const matched = matchesIlike(row[filter.column], filter.value);
                return matched === false; // SQL NOT (NULL) is NULL (excluded)
              }
              throw new Error(`Unsupported mock .not operator: ${filter.operator}`);
            });
          } else if (filter.kind === "in") {
            const allowed = Array.isArray(filter.values) ? filter.values : [];
            rows = rows.filter((row) => allowed.includes(row[filter.column]));
          }
        }

        for (const ord of state.orders) {
          rows.sort((a, b) => compareValues(a[ord.column], b[ord.column], ord.ascending));
        }

        let sliced = rows;
        if (state.range) {
          const { from, to } = state.range;
          const requestedCount = Math.max(0, to - from + 1);
          const effectiveCount = Math.min(requestedCount, serverPageCap);
          sliced = rows.slice(from, from + effectiveCount);
        } else {
          sliced = rows.slice(0, serverPageCap);
        }

        const defaultResult = {
          data: sliced.map((r) => ({ ...r })),
          error: null
        };

        if (typeof onPageRequest === "function") {
          return onPageRequest({ ...queryEntry, defaultResult });
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
          state.filters.push({ kind: "in", column, values: [...values] });
          return builder;
        },
        order(column, opts = {}) {
          state.orders.push({ column, ascending: opts.ascending !== false });
          return builder;
        },
        range(from, to) {
          state.range = { from, to };
          return builder;
        },
        insert() {
          recordForbiddenWrite(table, "insert");
        },
        update() {
          recordForbiddenWrite(table, "update");
        },
        upsert() {
          recordForbiddenWrite(table, "upsert");
        },
        delete() {
          recordForbiddenWrite(table, "delete");
        },
        then(onFulfilled, onRejected) {
          return execute().then(onFulfilled, onRejected);
        }
      };

      return builder;
    }
  };

  return client;
}

async function invokeRoute(mockClient, { method = "GET", query = { year: "2026", month: "8" }, authenticated = true, paginationOptions = undefined } = {}) {
  const req = createMockReq({ method, query, authenticated });
  const res = createMockRes();
  const deps = { supabase: mockClient };
  if (paginationOptions !== undefined) {
    deps.paginationOptions = paginationOptions;
  }
  await handler(req, res, deps);
  return res;
}

async function runTests() {
  console.log("=== Cashflows Review Pagination & Error Handling Offline Suite ===");

  // ---------------------------------------------------------------------------
  // TEST 1: >1,000 rows in EVERY source table with server page cap < pageSize
  // ---------------------------------------------------------------------------
  {
    const INVESTOR_COUNT = 1235;
    const DEPOSIT_COUNT = 1340;
    const WITHDRAWAL_COUNT = 1285;
    const SERVER_PAGE_CAP = 275; // Strictly smaller than requested pageSize (1000) and non-divisor

    const investors = [];
    for (let i = 1; i <= INVESTOR_COUNT; i += 1) {
      const id = `inv_${String(i).padStart(4, "0")}`;
      if (i % 10 === 0) {
        investors.push({ id, first_name: "", last_name: "", portal_username: `user_${i}` });
      } else {
        investors.push({ id, first_name: `First${i}`, last_name: `Last${i}`, portal_username: `u${i}` });
      }
    }

    const deposits = [];
    let expectedDepositCount = 0;
    let expectedDepositTotal = 0;
    const expectedDepositIds = [];
    for (let i = 1; i <= DEPOSIT_COUNT; i += 1) {
      const id = `dep_${String(i).padStart(4, "0")}`;
      const invIndex = ((i - 1) % INVESTOR_COUNT) + 1;
      const investorId = `inv_${String(invIndex).padStart(4, "0")}`;
      const isTargetPeriod = i % 2 === 0; // 670 rows in 2026-08 across indices 2..1340 (well past 1,000)
      const isVoid = i % 20 === 0; // Must be excluded by .not("type", "ilike", "VOID")
      const amount = Number((100 + (i % 73) * 1.25).toFixed(2));
      const day = String(((i - 1) % 28) + 1).padStart(2, "0");
      const dateStr = isTargetPeriod ? `2026-08-${day}` : (i % 3 === 0 ? `2026-07-${day}` : `2026-09-${day}`);
      const hasEffectiveDate = i % 4 === 0;
      const effectiveDate = hasEffectiveDate ? "2026-08-01" : null;

      deposits.push({
        id,
        investor_id: investorId,
        amount,
        date: i % 16 === 0 ? null : dateStr,
        created_at: `${dateStr}T12:00:00Z`,
        type: isVoid ? (i % 40 === 0 ? "void" : "VOID") : "Wire",
        effective_accounting_date: effectiveDate
      });

      if (isTargetPeriod && !isVoid) {
        expectedDepositCount += 1;
        expectedDepositTotal += amount;
        expectedDepositIds.push(id);
      }
    }

    const withdrawals = [];
    const includedStatuses = ["Approved", "Completed", "pending"];
    let expectedWithdrawalCount = 0;
    let expectedWithdrawalTotal = 0;
    const expectedWithdrawalIds = [];
    for (let i = 1; i <= WITHDRAWAL_COUNT; i += 1) {
      const id = `wd_${String(i).padStart(4, "0")}`;
      const invIndex = ((i - 1) % INVESTOR_COUNT) + 1;
      const investorId = `inv_${String(invIndex).padStart(4, "0")}`;
      const isTargetPeriod = i % 2 === 1; // spans 1..1285 (well past 1,000)
      // Include a mix of valid statuses + excluded "Pending" and "Cancelled" rows,
      // while keeping >1,000 qualifying rows in the filtered withdrawals table.
      let status;
      if (i % 25 === 0) {
        status = "Pending"; // Excluded (title-case)
      } else if (i % 25 === 1) {
        status = "Cancelled"; // Excluded
      } else {
        status = includedStatuses[i % includedStatuses.length];
      }

      const amount = Number((50 + (i % 41) * 0.5).toFixed(2));
      const day = String(((i - 1) % 28) + 1).padStart(2, "0");
      const dateStr = isTargetPeriod ? `2026-08-${day}` : "2026-07-15";

      withdrawals.push({
        id,
        investor_id: investorId,
        amount,
        request_date: dateStr,
        year: isTargetPeriod ? 2026 : 2026,
        month_number: isTargetPeriod ? 8 : 7,
        status,
        effective_accounting_date: i % 6 === 0 ? "2026-08-01" : null
      });

      if (isTargetPeriod && includedStatuses.includes(status)) {
        expectedWithdrawalCount += 1;
        expectedWithdrawalTotal += amount;
        expectedWithdrawalIds.push(id);
      }
    }

    // Verify our fixture genuinely has >1,000 rows AFTER filters in all 3 tables.
    const nonVoidDeposits = deposits.filter((d) => String(d.type).toUpperCase() !== "VOID").length;
    const qualifyingWithdrawals = withdrawals.filter((w) => includedStatuses.includes(w.status)).length;
    assert(investors.length > 1000, "Fixture must have >1,000 investors");
    assert(nonVoidDeposits > 1000, "Fixture must have >1,000 filtered deposits");
    assert(qualifyingWithdrawals > 1000, "Fixture must have >1,000 filtered withdrawals");

    const mockDb = createInMemorySupabaseMock(
      { deposits, withdrawals, investors },
      { serverPageCap: SERVER_PAGE_CAP }
    );

    const res = await invokeRoute(mockDb, { query: { year: "2026", month: "8" } });
    assert.strictEqual(res.statusCode, 200, `Expected 200, got ${res.statusCode}: ${JSON.stringify(res.body)}`);

    // Preserve exact response shape — no extra top-level or summary fields
    assert.deepStrictEqual(
      Object.keys(res.body).sort(),
      ["defaultProposedEffectiveDate", "deposits", "note", "period", "status", "summary", "withdrawals"]
    );
    assert.deepStrictEqual(
      Object.keys(res.body.summary).sort(),
      [
        "allProposedDatesAreDay1",
        "totalDepositAmount",
        "totalDepositsCount",
        "totalWithdrawalAmount",
        "totalWithdrawalsCount"
      ]
    );
    assert.strictEqual(res.body.status, "SUCCESS_READ_ONLY");
    assert.strictEqual(res.body.period, "2026-08");
    assert.strictEqual(res.body.defaultProposedEffectiveDate, "2026-08-01");
    assert.strictEqual(
      res.body.note,
      "Proposed effective dates require admin review before writing to production columns."
    );

    // Exact completeness across all pages (including records > 1,000)
    assert.strictEqual(res.body.deposits.length, expectedDepositCount);
    assert.strictEqual(res.body.summary.totalDepositsCount, expectedDepositCount);
    assert.strictEqual(res.body.summary.totalDepositAmount, Number(expectedDepositTotal.toFixed(2)));
    assert.deepStrictEqual(res.body.deposits.map((d) => d.id), expectedDepositIds);

    assert.strictEqual(res.body.withdrawals.length, expectedWithdrawalCount);
    assert.strictEqual(res.body.summary.totalWithdrawalsCount, expectedWithdrawalCount);
    assert.strictEqual(res.body.summary.totalWithdrawalAmount, Number(expectedWithdrawalTotal.toFixed(2)));
    assert.deepStrictEqual(res.body.withdrawals.map((w) => w.id), expectedWithdrawalIds);
    assert.strictEqual(res.body.summary.allProposedDatesAreDay1, true);

    // Verify investor names beyond index 1,000 resolved properly from paginated investors table
    const lateDeposit = res.body.deposits.find((d) => d.id === "dep_1234");
    assert(lateDeposit, "Expected deposit dep_1234 beyond 1,000th row to be present");
    assert.strictEqual(lateDeposit.investorId, "inv_1234");
    assert.strictEqual(lateDeposit.investorName, "First1234 Last1234");

    const fallbackUsernameDeposit = res.body.deposits.find((d) => d.investorId === "inv_1230");
    assert(fallbackUsernameDeposit, "Expected deposit for inv_1230 beyond 1,000th investor");
    assert.strictEqual(fallbackUsernameDeposit.investorName, "user_1230");

    // Verify pagination mechanics: deterministic ID ordering, advancing offsets, empty terminator page
    for (const [table, totalFiltered] of [
      ["deposits", nonVoidDeposits],
      ["withdrawals", qualifyingWithdrawals],
      ["investors", investors.length]
    ]) {
      const tableQueries = mockDb.queryLog.filter((q) => q.table === table);
      const expectedRequests = Math.ceil(totalFiltered / SERVER_PAGE_CAP) + 1; // +1 for empty terminator page
      assert.strictEqual(
        tableQueries.length,
        expectedRequests,
        `Expected ${expectedRequests} paginated requests for ${table}, got ${tableQueries.length}`
      );
      let expectedFrom = 0;
      for (const q of tableQueries) {
        assert.deepStrictEqual(q.orders, [{ column: "id", ascending: true }], `${table} must order by id ASC`);
        assert.strictEqual(q.range.from, expectedFrom, `${table} offset must advance cleanly without gaps`);
        assert.strictEqual(q.range.to, expectedFrom + 999, `${table} range end must request default pageSize 1000`);
        expectedFrom = Math.min(expectedFrom + SERVER_PAGE_CAP, totalFiltered);
      }
    }

    assert.strictEqual(mockDb.writeAttempts.length, 0);
    console.log(
      `  PASS [1]: Paginated >1,000 rows in all 3 tables under server cap=${SERVER_PAGE_CAP} ` +
      `(deposits=${expectedDepositCount}, withdrawals=${expectedWithdrawalCount}, investors=${investors.length})`
    );
  }

  // ---------------------------------------------------------------------------
  // TEST 2: Exact withdrawal-status inclusions and exclusions (no title-case "Pending")
  // ---------------------------------------------------------------------------
  {
    const investors = [{ id: "inv_1", first_name: "Ada", last_name: "Lovelace", portal_username: "ada" }];
    const deposits = [];
    const withdrawals = [
      // Included statuses (exact existing filter)
      { id: "w_01_approved", investor_id: "inv_1", amount: 100.25, request_date: "2026-08-01", year: 2026, month_number: 8, status: "Approved" },
      { id: "w_02_completed", investor_id: "inv_1", amount: 200.5, request_date: "2026-08-02", year: 2026, month_number: 8, status: "Completed" },
      { id: "w_03_pending_lower", investor_id: "inv_1", amount: 300.75, request_date: "2026-08-03", year: 2026, month_number: 8, status: "pending" },
      // Excluded statuses (including title-case "Pending", which MUST remain excluded)
      { id: "w_04_Pending_title", investor_id: "inv_1", amount: 999.0, request_date: "2026-08-04", year: 2026, month_number: 8, status: "Pending" },
      { id: "w_05_PENDING_upper", investor_id: "inv_1", amount: 888.0, request_date: "2026-08-05", year: 2026, month_number: 8, status: "PENDING" },
      { id: "w_06_approved_lower", investor_id: "inv_1", amount: 777.0, request_date: "2026-08-06", year: 2026, month_number: 8, status: "approved" },
      { id: "w_07_completed_lower", investor_id: "inv_1", amount: 666.0, request_date: "2026-08-07", year: 2026, month_number: 8, status: "completed" },
      { id: "w_08_padded_pending", investor_id: "inv_1", amount: 555.0, request_date: "2026-08-08", year: 2026, month_number: 8, status: " pending " },
      { id: "w_09_cancelled", investor_id: "inv_1", amount: 444.0, request_date: "2026-08-09", year: 2026, month_number: 8, status: "Cancelled" },
      { id: "w_10_rejected", investor_id: "inv_1", amount: 333.0, request_date: "2026-08-10", year: 2026, month_number: 8, status: "Rejected" },
      { id: "w_11_void", investor_id: "inv_1", amount: 222.0, request_date: "2026-08-11", year: 2026, month_number: 8, status: "Void" },
      { id: "w_12_empty", investor_id: "inv_1", amount: 111.0, request_date: "2026-08-12", year: 2026, month_number: 8, status: "" },
      { id: "w_13_null", investor_id: "inv_1", amount: 50.0, request_date: "2026-08-13", year: 2026, month_number: 8, status: null },
      { id: "w_14_missing", investor_id: "inv_1", amount: 25.0, request_date: "2026-08-14", year: 2026, month_number: 8 }
    ];

    const mockDb = createInMemorySupabaseMock({ deposits, withdrawals, investors }, { serverPageCap: 2 });
    const res = await invokeRoute(mockDb, { query: { year: "2026", month: "8" } });

    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(
      res.body.withdrawals.map((w) => w.id),
      ["w_01_approved", "w_02_completed", "w_03_pending_lower"]
    );
    assert.strictEqual(res.body.summary.totalWithdrawalsCount, 3);
    assert.strictEqual(res.body.summary.totalWithdrawalAmount, 601.5);

    const withdrawalQueries = mockDb.queryLog.filter((q) => q.table === "withdrawals");
    assert(withdrawalQueries.length >= 2, "Withdrawals must paginate across multiple pages");
    for (const q of withdrawalQueries) {
      assert.deepStrictEqual(q.filters, [
        { kind: "in", column: "status", values: ["Approved", "Completed", "pending"] }
      ]);
    }
    assert.strictEqual(mockDb.writeAttempts.length, 0);
    console.log("  PASS [2]: Exact withdrawal-status filter preserved (Approved/Completed/pending included; title-case Pending & others excluded)");
  }

  // ---------------------------------------------------------------------------
  // TEST 3: Later-page query errors fail closed (no partial results)
  // ---------------------------------------------------------------------------
  {
    const baseData = {
      investors: Array.from({ length: 10 }, (_, idx) => ({
        id: `inv_${idx + 1}`,
        first_name: "Test",
        last_name: `Inv${idx + 1}`
      })),
      deposits: Array.from({ length: 10 }, (_, idx) => ({
        id: `dep_${String(idx + 1).padStart(2, "0")}`,
        investor_id: "inv_1",
        amount: 100,
        date: "2026-08-01",
        type: "Wire"
      })),
      withdrawals: Array.from({ length: 10 }, (_, idx) => ({
        id: `wd_${String(idx + 1).padStart(2, "0")}`,
        investor_id: "inv_1",
        amount: 50,
        request_date: "2026-08-01",
        year: 2026,
        month_number: 8,
        status: "Approved"
      }))
    };

    const errorCases = [
      { label: "deposits page 2 error object", table: "deposits", failOnRequest: 2, mode: "errorObject" },
      { label: "withdrawals page 3 error object", table: "withdrawals", failOnRequest: 3, mode: "errorObject" },
      { label: "investors page 2 rejected promise", table: "investors", failOnRequest: 2, mode: "throw" }
    ];

    for (const c of errorCases) {
      const mockDb = createInMemorySupabaseMock(baseData, {
        serverPageCap: 3,
        onPageRequest({ table, requestNumber, defaultResult }) {
          if (table === c.table && requestNumber === c.failOnRequest) {
            if (c.mode === "throw") {
              throw new Error(`simulated transport failure on ${table} page ${requestNumber}`);
            }
            return { data: null, error: { message: `simulated query error on ${table} page ${requestNumber}` } };
          }
          return defaultResult;
        }
      });

      const res = await invokeRoute(mockDb);
      assert.strictEqual(res.statusCode, 500, `Expected 500 for ${c.label}, got ${res.statusCode}`);
      assert.strictEqual(res.body.error, "CASHFLOWS_REVIEW_FAILED");
      assert.strictEqual(res.body.deposits, undefined, "Must not return partial deposits");
      assert.strictEqual(res.body.withdrawals, undefined, "Must not return partial withdrawals");
      assert.strictEqual(res.body.summary, undefined, "Must not return partial summary");
      assert.strictEqual(mockDb.writeAttempts.length, 0);
    }
    console.log("  PASS [3]: Later-page query errors and thrown rejections fail closed with HTTP 500 and zero partial results");
  }

  // ---------------------------------------------------------------------------
  // TEST 4: Null and other non-array page data fail closed
  // ---------------------------------------------------------------------------
  {
    const baseData = {
      investors: [{ id: "inv_1", first_name: "Test", last_name: "One" }],
      deposits: Array.from({ length: 6 }, (_, idx) => ({
        id: `dep_${idx + 1}`,
        investor_id: "inv_1",
        amount: 100,
        date: "2026-08-01",
        type: "Wire"
      })),
      withdrawals: []
    };

    const badPayloads = [
      { label: "null data on page 1", failOnRequest: 1, response: { data: null, error: null } },
      { label: "null data on page 2", failOnRequest: 2, response: { data: null, error: null } },
      { label: "undefined data on page 2", failOnRequest: 2, response: { data: undefined, error: null } },
      { label: "plain object data on page 2", failOnRequest: 2, response: { data: { rows: [] }, error: null } },
      { label: "string data on page 2", failOnRequest: 2, response: { data: "not-an-array", error: null } },
      { label: "number data on page 2", failOnRequest: 2, response: { data: 42, error: null } },
      { label: "boolean data on page 2", failOnRequest: 2, response: { data: true, error: null } },
      { label: "null response envelope on page 2", failOnRequest: 2, response: null },
      { label: "non-object row element inside array", failOnRequest: 2, response: { data: [null], error: null } }
    ];

    for (const bad of badPayloads) {
      const mockDb = createInMemorySupabaseMock(baseData, {
        serverPageCap: 2,
        onPageRequest({ table, requestNumber, defaultResult }) {
          if (table === "deposits" && requestNumber === bad.failOnRequest) {
            return bad.response;
          }
          return defaultResult;
        }
      });

      const res = await invokeRoute(mockDb);
      assert.strictEqual(res.statusCode, 500, `Expected 500 for ${bad.label}, got ${res.statusCode}`);
      assert.strictEqual(res.body.error, "CASHFLOWS_REVIEW_FAILED");
      assert.strictEqual(res.body.deposits, undefined);
      assert.strictEqual(mockDb.writeAttempts.length, 0);
    }
    console.log(`  PASS [4]: All ${badPayloads.length} null / non-array / malformed page data cases fail closed`);
  }

  // ---------------------------------------------------------------------------
  // TEST 5: Repeated pages, lack of progress, and overlapping IDs fail closed
  // ---------------------------------------------------------------------------
  {
    const baseData = {
      investors: [{ id: "inv_1", first_name: "Test", last_name: "One" }],
      deposits: Array.from({ length: 6 }, (_, idx) => ({
        id: `dep_${idx + 1}`,
        investor_id: "inv_1",
        amount: 100,
        date: "2026-08-01",
        type: "Wire"
      })),
      withdrawals: []
    };

    const stallCases = [
      {
        label: "consecutive repeated page",
        expectedPattern: /repeated page/i,
        pages: [
          [{ id: "dep_1", investor_id: "inv_1", amount: 100, date: "2026-08-01", type: "Wire" }, { id: "dep_2", investor_id: "inv_1", amount: 100, date: "2026-08-01", type: "Wire" }],
          [{ id: "dep_1", investor_id: "inv_1", amount: 100, date: "2026-08-01", type: "Wire" }, { id: "dep_2", investor_id: "inv_1", amount: 100, date: "2026-08-01", type: "Wire" }]
        ]
      },
      {
        label: "cycling repeated page",
        expectedPattern: /repeated page/i,
        pages: [
          [{ id: "dep_1", investor_id: "inv_1", amount: 100, date: "2026-08-01", type: "Wire" }],
          [{ id: "dep_2", investor_id: "inv_1", amount: 100, date: "2026-08-01", type: "Wire" }],
          [{ id: "dep_1", investor_id: "inv_1", amount: 100, date: "2026-08-01", type: "Wire" }]
        ]
      },
      {
        label: "lack of progress (subset of previously seen rows)",
        expectedPattern: /no progress/i,
        pages: [
          [
            { id: "dep_1", investor_id: "inv_1", amount: 100, date: "2026-08-01", type: "Wire" },
            { id: "dep_2", investor_id: "inv_1", amount: 100, date: "2026-08-01", type: "Wire" },
            { id: "dep_3", investor_id: "inv_1", amount: 100, date: "2026-08-01", type: "Wire" }
          ],
          [
            { id: "dep_2", investor_id: "inv_1", amount: 100, date: "2026-08-01", type: "Wire" },
            { id: "dep_3", investor_id: "inv_1", amount: 100, date: "2026-08-01", type: "Wire" }
          ]
        ]
      },
      {
        label: "overlapping row ID across pages (offset drift insertion)",
        expectedPattern: /already-seen/i,
        pages: [
          [
            { id: "dep_1", investor_id: "inv_1", amount: 100, date: "2026-08-01", type: "Wire" },
            { id: "dep_2", investor_id: "inv_1", amount: 100, date: "2026-08-01", type: "Wire" }
          ],
          [
            { id: "dep_2", investor_id: "inv_1", amount: 100, date: "2026-08-01", type: "Wire" },
            { id: "dep_3", investor_id: "inv_1", amount: 100, date: "2026-08-01", type: "Wire" }
          ]
        ]
      },
      {
        label: "duplicate row ID within a single page",
        expectedPattern: /duplicate id/i,
        pages: [
          [
            { id: "dep_1", investor_id: "inv_1", amount: 100, date: "2026-08-01", type: "Wire" },
            { id: "dep_1", investor_id: "inv_1", amount: 100, date: "2026-08-01", type: "Wire" }
          ]
        ]
      }
    ];

    for (const sc of stallCases) {
      const mockDb = createInMemorySupabaseMock(baseData, {
        onPageRequest({ table, requestNumber, defaultResult }) {
          if (table === "deposits") {
            const page = sc.pages[requestNumber - 1] ?? [];
            return { data: page, error: null };
          }
          return defaultResult;
        }
      });

      const res = await invokeRoute(mockDb);
      assert.strictEqual(res.statusCode, 500, `Expected 500 for ${sc.label}, got ${res.statusCode}`);
      assert.strictEqual(res.body.error, "CASHFLOWS_REVIEW_FAILED");
      assert.match(res.body.message, sc.expectedPattern, `Unexpected error message for ${sc.label}: ${res.body.message}`);
      assert.strictEqual(mockDb.writeAttempts.length, 0);
    }
    console.log("  PASS [5]: Repeated pages, lack of progress, and duplicate/overlapping IDs fail closed");
  }

  // ---------------------------------------------------------------------------
  // TEST 6: Exact maxRows acceptance vs overflow, and maxRequests boundary vs overflow
  // ---------------------------------------------------------------------------
  {
    const makeDeposits = (count) =>
      Array.from({ length: count }, (_, idx) => ({
        id: `dep_${String(idx + 1).padStart(3, "0")}`,
        investor_id: "inv_1",
        amount: 10,
        date: "2026-08-01",
        type: "Wire"
      }));
    const investors = [{ id: "inv_1", first_name: "Limit", last_name: "Tester" }];

    // 6a. Exactly maxRows (5 rows, pageSize 3) with next page empty -> SUCCEEDS
    {
      const mockDb = createInMemorySupabaseMock(
        { deposits: makeDeposits(5), withdrawals: [], investors },
        { serverPageCap: 3 }
      );
      const res = await invokeRoute(mockDb, {
        paginationOptions: { pageSize: 3, maxRows: 5, maxRequests: 10 }
      });
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.summary.totalDepositsCount, 5);
      assert.strictEqual(res.body.summary.totalDepositAmount, 50);
    }

    // 6b. Exactly maxRows on an exact page multiple (6 rows, pageSize 3, maxRows 6) with page 3 empty -> SUCCEEDS
    {
      const mockDb = createInMemorySupabaseMock(
        { deposits: makeDeposits(6), withdrawals: [], investors },
        { serverPageCap: 3 }
      );
      const res = await invokeRoute(mockDb, {
        paginationOptions: { pageSize: 3, maxRows: 6, maxRequests: 10 }
      });
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.summary.totalDepositsCount, 6);
      assert.strictEqual(mockDb.requestCountsByTable.deposits, 3); // 2 full pages + 1 empty terminator page
    }

    // 6c. Exceeding maxRows by 1 (7 rows, pageSize 3, maxRows 6) -> FAILS CLOSED
    {
      const mockDb = createInMemorySupabaseMock(
        { deposits: makeDeposits(7), withdrawals: [], investors },
        { serverPageCap: 3 }
      );
      const res = await invokeRoute(mockDb, {
        paginationOptions: { pageSize: 3, maxRows: 6, maxRequests: 10 }
      });
      assert.strictEqual(res.statusCode, 500);
      assert.strictEqual(res.body.error, "CASHFLOWS_REVIEW_FAILED");
      assert.match(res.body.message, /maxRows/i);
    }

    // 6d. Exact maxRequests (4 rows under server cap 2 => 2 data pages + 1 empty page = 3 requests === maxRequests) -> SUCCEEDS
    {
      const mockDb = createInMemorySupabaseMock(
        { deposits: makeDeposits(4), withdrawals: [], investors },
        { serverPageCap: 2 }
      );
      const res = await invokeRoute(mockDb, {
        paginationOptions: { pageSize: 10, maxRows: 100, maxRequests: 3 }
      });
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.summary.totalDepositsCount, 4);
      assert.strictEqual(mockDb.requestCountsByTable.deposits, 3);
    }

    // 6e. Request-limit overflow (6 rows under server cap 2 needs 4 requests including empty terminator, maxRequests=3) -> FAILS CLOSED
    {
      const mockDb = createInMemorySupabaseMock(
        { deposits: makeDeposits(6), withdrawals: [], investors },
        { serverPageCap: 2 }
      );
      const res = await invokeRoute(mockDb, {
        paginationOptions: { pageSize: 10, maxRows: 100, maxRequests: 3 }
      });
      assert.strictEqual(res.statusCode, 500);
      assert.strictEqual(res.body.error, "CASHFLOWS_REVIEW_FAILED");
      assert.match(res.body.message, /maxRequests/i);
    }

    console.log("  PASS [6]: Exact maxRows/maxRequests boundaries succeed while overflows fail closed");
  }

  // ---------------------------------------------------------------------------
  // TEST 7: Read-only method enforcement, auth enforcement, zero writes, zero network
  // ---------------------------------------------------------------------------
  {
    const mockDb = createInMemorySupabaseMock({ deposits: [], withdrawals: [], investors: [] });

    const unauthRes = await invokeRoute(mockDb, { authenticated: false });
    assert.strictEqual(unauthRes.statusCode, 401);
    assert.strictEqual(mockDb.queryLog.length, 0, "Unauthenticated requests must not query database");

    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const res = await invokeRoute(mockDb, { method });
      assert.strictEqual(res.statusCode, 405, `Expected 405 for ${method}`);
      assert.deepStrictEqual(res.body, { error: "Method not allowed" });
    }
    assert.strictEqual(mockDb.queryLog.length, 0, "Non-GET requests must not query database");
    assert.strictEqual(mockDb.writeAttempts.length, 0, "Route must never perform writes");
    assert.strictEqual(networkCalls.length, 0, "Offline suite must make zero network calls");
    console.log("  PASS [7]: Auth (401), read-only method enforcement (405), zero writes, and zero network calls verified");
  }

  console.log("\n=== ALL CASHFLOWS REVIEW PAGINATION TESTS PASSED (7/7) ===");
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
