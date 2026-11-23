import assert from "node:assert/strict";
import http from "node:http";
import https from "node:https";
import net from "node:net";

// Install hard network-call blockers BEFORE importing lib/supabase.js or any caller modules.
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

const { createClient } = await import("@supabase/supabase-js");
const { paginatedRead, readSupabaseTable } = await import("../lib/supabase.js");
const { loadAccountingData } = await import("../lib/paginated-read.js");
const { executeDailyFinancialReconciliation } = await import("../lib/daily-reconciliation-engine.js");
const { getMyfxbookLive } = await import("../lib/myfxbook.js");

function deepFreezeRows(rows) {
  return Object.freeze(rows.map((row) => Object.freeze({ ...row })));
}

function matchesIlike(value, pattern) {
  if (value === null || value === undefined) return null;
  const escaped = String(pattern)
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/%/g, ".*")
    .replace(/_/g, ".");
  return new RegExp(`^${escaped}$`, "i").test(String(value));
}

function compareField(a, b, ascending) {
  if (a === b) return 0;
  if (a === null || a === undefined) return ascending ? 1 : -1;
  if (b === null || b === undefined) return ascending ? -1 : 1;
  const cmp = typeof a === "number" && typeof b === "number"
    ? a - b
    : String(a).localeCompare(String(b));
  return ascending ? cmp : -cmp;
}

function projectRow(row, select) {
  if (!select || select.trim() === "*") {
    return { ...row };
  }
  const cols = select.split(",").map((c) => c.trim()).filter(Boolean);
  const out = {};
  for (const col of cols) {
    if (Object.prototype.hasOwnProperty.call(row, col)) {
      out[col] = row[col];
    }
  }
  return out;
}

/**
 * Strict read-only synthetic PostgREST/Supabase mock supporting multi-column `.order()`,
 * `.range()`, server-side page caps (< requested pageSize), adversarial tie-reordering across
 * requests (to expose unstable non-unique ORDER BY clauses), write prohibition, and fault injection.
 */
function createMockSupabase(tables, options = {}) {
  const { serverPageCap = 1000, adversarialTieOrder = false, onPageRequest = null } = options;
  const frozenTables = {};
  for (const [name, rows] of Object.entries(tables)) {
    frozenTables[name] = deepFreezeRows(rows);
  }

  const queryLog = [];
  const writeAttempts = [];
  const requestCountsByTable = {};

  function forbidWrite(table, op) {
    writeAttempts.push({ table, op });
    throw new Error(`WRITE_OPERATION_FORBIDDEN: ${op} on ${table}`);
  }

  return {
    queryLog,
    writeAttempts,
    requestCountsByTable,
    rpc(name) {
      forbidWrite(`rpc:${name}`, "rpc");
    },
    get storage() {
      forbidWrite("storage", "storage");
      return null;
    },
    from(table) {
      const state = {
        table,
        select: "*",
        filters: [],
        orders: [],
        range: null
      };

      const execute = async () => {
        requestCountsByTable[table] = (requestCountsByTable[table] || 0) + 1;
        const requestNumber = requestCountsByTable[table];
        const entry = {
          table,
          requestNumber,
          select: state.select,
          filters: state.filters.map((f) => ({ ...f })),
          orders: state.orders.map((o) => ({ ...o })),
          range: state.range ? { ...state.range } : null
        };
        queryLog.push(entry);

        let rows = (frozenTables[table] || []).slice();
        // Simulate Postgres non-deterministic tie order across independent page requests:
        // reverse base row order on even requests before sorting by state.orders.
        // Any ORDER BY with unresolved ties across page boundaries will scramble/duplicate/skip rows.
        if (adversarialTieOrder && requestNumber % 2 === 0) {
          rows.reverse();
        }

        for (const f of state.filters) {
          if (f.kind === "eq") {
            rows = rows.filter((r) => r[f.column] === f.value);
          } else if (f.kind === "gte") {
            rows = rows.filter((r) => r[f.column] >= f.value);
          } else if (f.kind === "in") {
            rows = rows.filter((r) => f.values.includes(r[f.column]));
          } else if (f.kind === "not") {
            rows = rows.filter((r) => {
              if (f.operator === "ilike") {
                return matchesIlike(r[f.column], f.value) === false;
              }
              if (f.operator === "is" && f.value === null) {
                return r[f.column] !== null && r[f.column] !== undefined;
              }
              throw new Error(`Unsupported mock .not operator: ${f.operator}`);
            });
          }
        }

        if (state.orders.length > 0) {
          rows.sort((a, b) => {
            for (const ord of state.orders) {
              const cmp = compareField(a[ord.column], b[ord.column], ord.ascending);
              if (cmp !== 0) return cmp;
            }
            return 0;
          });
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
          data: sliced.map((r) => projectRow(r, state.select)),
          error: null
        };

        if (typeof onPageRequest === "function") {
          return onPageRequest({ ...entry, defaultResult });
        }
        return defaultResult;
      };

      const builder = {
        select(cols = "*") {
          state.select = cols;
          return builder;
        },
        eq(column, value) {
          state.filters.push({ kind: "eq", column, value });
          return builder;
        },
        gte(column, value) {
          state.filters.push({ kind: "gte", column, value });
          return builder;
        },
        in(column, values) {
          state.filters.push({ kind: "in", column, values: [...values] });
          return builder;
        },
        not(column, operator, value) {
          state.filters.push({ kind: "not", column, operator, value });
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
          forbidWrite(table, "insert");
        },
        update() {
          forbidWrite(table, "update");
        },
        upsert() {
          forbidWrite(table, "upsert");
        },
        delete() {
          forbidWrite(table, "delete");
        },
        then(onFulfilled, onRejected) {
          return execute().then(onFulfilled, onRejected);
        }
      };

      return builder;
    }
  };
}

async function runTests() {
  console.log("=== Shared Pagination Contract Offline Suite (lib/supabase.js) ===");

  // ---------------------------------------------------------------------------
  // TEST 1: >1,000 rows under a simulated server cap smaller than pageSize
  // ---------------------------------------------------------------------------
  {
    const TOTAL_ROWS = 1375;
    const SERVER_CAP = 240; // Strictly smaller than default pageSize=1000 and non-divisor
    const deposits = Array.from({ length: TOTAL_ROWS }, (_, idx) => ({
      id: `dep_${String(TOTAL_ROWS - idx).padStart(4, "0")}`, // Deliberately unsorted source input
      investor_id: `inv_${(idx % 50) + 1}`,
      amount: 100 + idx,
      type: "Wire"
    }));

    const mockDb = createMockSupabase({ deposits }, { serverPageCap: SERVER_CAP });
    const rows = await paginatedRead("deposits", { client: mockDb });

    assert.strictEqual(rows.length, TOTAL_ROWS, `Expected all ${TOTAL_ROWS} rows, got ${rows.length}`);
    assert.strictEqual(rows[0].id, "dep_0001");
    assert.strictEqual(rows[1000].id, "dep_1001");
    assert.strictEqual(rows[TOTAL_ROWS - 1].id, `dep_${TOTAL_ROWS}`);

    // Verify contiguous advancing offsets by actual returned count + empty terminator request
    const expectedRequests = Math.ceil(TOTAL_ROWS / SERVER_CAP) + 1; // 6 nonempty + 1 empty = 7
    assert.strictEqual(mockDb.queryLog.length, expectedRequests);
    let expectedFrom = 0;
    for (const q of mockDb.queryLog) {
      assert.deepStrictEqual(q.orders, [{ column: "id", ascending: true }]);
      assert.strictEqual(q.range.from, expectedFrom);
      assert.strictEqual(q.range.to, expectedFrom + 999);
      expectedFrom = Math.min(expectedFrom + SERVER_CAP, TOTAL_ROWS);
    }
    assert.strictEqual(mockDb.writeAttempts.length, 0);
    console.log(`  PASS [1]: Paginated ${TOTAL_ROWS} rows under server cap=${SERVER_CAP} with zero skipped rows (${expectedRequests} requests including EOF)`);
  }

  // ---------------------------------------------------------------------------
  // TEST 2: Stable single-column and composite ordering (defaults + explicit)
  // ---------------------------------------------------------------------------
  {
    // 2a. Default composite ordering on monthly_returns: ["year", "month_number"] across >1,000 rows
    const monthlyReturns = [];
    for (let yr = 2025; yr >= 1941; yr -= 1) { // 85 years * 12 months = 1,020 rows, inserted reverse
      for (let m = 12; m >= 1; m -= 1) {
        monthlyReturns.push({ year: yr, month_number: m, gross_return_pct: 1.25 });
      }
    }
    assert(monthlyReturns.length > 1000, "monthly_returns fixture must exceed 1,000 rows");

    const mrDb = createMockSupabase({ monthly_returns: monthlyReturns }, { serverPageCap: 230 });
    const mrRows = await paginatedRead("monthly_returns", { client: mrDb });
    assert.strictEqual(mrRows.length, 1020);
    assert.deepStrictEqual(
      { year: mrRows[0].year, month_number: mrRows[0].month_number },
      { year: 1941, month_number: 1 }
    );
    assert.deepStrictEqual(
      { year: mrRows[11].year, month_number: mrRows[11].month_number },
      { year: 1941, month_number: 12 }
    );
    assert.deepStrictEqual(
      { year: mrRows[mrRows.length - 1].year, month_number: mrRows[mrRows.length - 1].month_number },
      { year: 2025, month_number: 12 }
    );
    for (const q of mrDb.queryLog) {
      assert.deepStrictEqual(q.orders, [
        { column: "year", ascending: true },
        { column: "month_number", ascending: true }
      ]);
    }

    // 2b. Default single-column ordering on live_performance ("metric") and composite on accounting_periods
    const lpDb = createMockSupabase(
      {
        live_performance: [
          { metric: "This Year", value_pct: "12.0" },
          { metric: "This Month", value_pct: "1.5" },
          { metric: "Today", value_pct: "0.2" }
        ],
        accounting_periods: [
          { id: 3, year: 2026, month_number: 10, status: "FINALIZED" },
          { id: 1, year: 2026, month_number: 8, status: "FINALIZED" },
          { id: 2, year: 2026, month_number: 9, status: "FINALIZED" }
        ]
      },
      { serverPageCap: 2 }
    );
    const lpRows = await paginatedRead("live_performance", { client: lpDb });
    assert.deepStrictEqual(lpRows.map((r) => r.metric), ["This Month", "This Year", "Today"]);
    const apRows = await paginatedRead("accounting_periods", { client: lpDb });
    assert.deepStrictEqual(apRows.map((r) => `${r.year}-${r.month_number}`), ["2026-8", "2026-9", "2026-10"]);
    for (const q of lpDb.queryLog.filter((e) => e.table === "live_performance")) {
      assert.deepStrictEqual(q.orders, [{ column: "metric", ascending: true }]);
    }
    for (const q of lpDb.queryLog.filter((e) => e.table === "accounting_periods")) {
      assert.deepStrictEqual(q.orders, [
        { column: "year", ascending: true },
        { column: "month_number", ascending: true }
      ]);
    }

    // 2c. Explicit non-unique single-column order with TIES across page boundaries (adversarial tie-reordering)
    //     Must append verified unique tie-breaker "id" ASC on EVERY page without duplicating or dropping tied rows.
    {
      const tiedDeposits = [
        { id: "dep_05", created_at: "2026-08-10", amount: 500 },
        { id: "dep_01", created_at: "2026-08-10", amount: 100 },
        { id: "dep_04", created_at: "2026-08-10", amount: 400 },
        { id: "dep_02", created_at: "2026-08-10", amount: 200 },
        { id: "dep_03", created_at: "2026-08-10", amount: 300 },
        { id: "dep_10", created_at: "2026-08-09", amount: 1000 },
        { id: "dep_06", created_at: "2026-08-09", amount: 600 },
        { id: "dep_09", created_at: "2026-08-09", amount: 900 },
        { id: "dep_07", created_at: "2026-08-09", amount: 700 },
        { id: "dep_08", created_at: "2026-08-09", amount: 800 }
      ];
      const tiedDb = createMockSupabase(
        { deposits: tiedDeposits },
        { serverPageCap: 2, adversarialTieOrder: true }
      );
      const tiedRows = await paginatedRead("deposits", {
        client: tiedDb,
        orderBy: "created_at",
        ascending: false
      });
      assert.deepStrictEqual(
        tiedRows.map((r) => r.id),
        ["dep_01", "dep_02", "dep_03", "dep_04", "dep_05", "dep_06", "dep_07", "dep_08", "dep_09", "dep_10"]
      );
      assert.strictEqual(tiedDb.queryLog.length, 6); // 5 data pages + 1 empty EOF page
      for (const q of tiedDb.queryLog) {
        assert.deepStrictEqual(q.orders, [
          { column: "created_at", ascending: false },
          { column: "id", ascending: true }
        ]);
      }
    }

    // 2d. Composite-key table (monthly_returns: year, month_number) with non-unique explicit orders
    //     and ties across page boundaries under adversarial tie-reordering:
    //     - partial key ("year" DESC) -> appends only missing "month_number" ASC (no duplicate "year")
    //     - partial key ("month_number" DESC) -> appends only missing "year" ASC (no duplicate "month_number")
    //     - non-key column ("gross_return_pct" DESC) -> appends FULL composite key ("year" ASC, "month_number" ASC)
    {
      const tiedReturns = [];
      for (const yr of [2025, 2026]) {
        for (let m = 1; m <= 6; m += 1) {
          tiedReturns.push({ year: yr, month_number: m, gross_return_pct: 2.5 });
        }
      }

      // Partial key: year DESC -> appends only month_number ASC
      const yrDb = createMockSupabase({ monthly_returns: tiedReturns }, { serverPageCap: 3, adversarialTieOrder: true });
      const yrRows = await paginatedRead("monthly_returns", { client: yrDb, orderBy: "year", ascending: false });
      assert.deepStrictEqual(
        yrRows.map((r) => `${r.year}-${r.month_number}`),
        ["2026-1", "2026-2", "2026-3", "2026-4", "2026-5", "2026-6", "2025-1", "2025-2", "2025-3", "2025-4", "2025-5", "2025-6"]
      );
      for (const q of yrDb.queryLog) {
        assert.deepStrictEqual(q.orders, [
          { column: "year", ascending: false },
          { column: "month_number", ascending: true }
        ]);
      }

      // Partial key (second column only): month_number DESC -> appends only year ASC
      const mnDb = createMockSupabase({ monthly_returns: tiedReturns }, { serverPageCap: 3, adversarialTieOrder: true });
      const mnRows = await paginatedRead("monthly_returns", {
        client: mnDb,
        orderBy: [{ column: "month_number", ascending: false }]
      });
      assert.strictEqual(mnRows.length, 12);
      assert.deepStrictEqual(
        mnRows.slice(0, 4).map((r) => `${r.year}-${r.month_number}`),
        ["2025-6", "2026-6", "2025-5", "2026-5"]
      );
      for (const q of mnDb.queryLog) {
        assert.deepStrictEqual(q.orders, [
          { column: "month_number", ascending: false },
          { column: "year", ascending: true }
        ]);
      }

      // Non-key column with 100% tied values -> appends FULL composite key (year ASC, month_number ASC)
      const pctDb = createMockSupabase({ monthly_returns: tiedReturns }, { serverPageCap: 3, adversarialTieOrder: true });
      const pctRows = await paginatedRead("monthly_returns", {
        client: pctDb,
        orderBy: "gross_return_pct",
        ascending: false
      });
      assert.deepStrictEqual(
        pctRows.map((r) => `${r.year}-${r.month_number}`),
        ["2025-1", "2025-2", "2025-3", "2025-4", "2025-5", "2025-6", "2026-1", "2026-2", "2026-3", "2026-4", "2026-5", "2026-6"]
      );
      for (const q of pctDb.queryLog) {
        assert.deepStrictEqual(q.orders, [
          { column: "gross_return_pct", ascending: false },
          { column: "year", ascending: true },
          { column: "month_number", ascending: true }
        ]);
      }
    }

    // 2e. Already-unique explicit orders preserve caller directions and do NOT duplicate key columns
    {
      const customRows = [
        { id: "d1", year: 2025, month_number: 2, created_at: "2025-02-01" },
        { id: "d2", year: 2026, month_number: 1, created_at: "2026-01-01" },
        { id: "d3", year: 2025, month_number: 1, created_at: "2025-01-01" },
        { id: "d4", year: 2026, month_number: 2, created_at: "2026-02-01" }
      ];

      // deposits with explicit id DESC -> no extra id appended
      const idDescDb = createMockSupabase({ deposits: customRows }, { serverPageCap: 2, adversarialTieOrder: true });
      const idDescRows = await paginatedRead("deposits", { client: idDescDb, orderBy: "id", ascending: false });
      assert.deepStrictEqual(idDescRows.map((r) => r.id), ["d4", "d3", "d2", "d1"]);
      for (const q of idDescDb.queryLog) {
        assert.deepStrictEqual(q.orders, [{ column: "id", ascending: false }]);
      }

      // deposits with mixed-direction spec already including id DESC -> preserves id DESC without duplicating id
      const mixedSpecDb = createMockSupabase({ deposits: customRows }, { serverPageCap: 2, adversarialTieOrder: true });
      const mixedRows = await paginatedRead("deposits", {
        client: mixedSpecDb,
        orderBy: [
          { column: "year", ascending: false },
          { column: "month_number", ascending: true },
          { column: "id", ascending: false }
        ]
      });
      assert.deepStrictEqual(mixedRows.map((r) => r.id), ["d2", "d4", "d3", "d1"]);
      for (const q of mixedSpecDb.queryLog) {
        assert.deepStrictEqual(q.orders, [
          { column: "year", ascending: false },
          { column: "month_number", ascending: true },
          { column: "id", ascending: false }
        ]);
      }

      // accounting_periods with verified alternate PK "id" DESC -> already unique, does not append year/month_number
      const apAltDb = createMockSupabase(
        {
          accounting_periods: [
            { id: 1, year: 2026, month_number: 8, status: "FINALIZED" },
            { id: 2, year: 2026, month_number: 9, status: "FINALIZED" },
            { id: 3, year: 2026, month_number: 10, status: "FINALIZED" }
          ]
        },
        { serverPageCap: 2, adversarialTieOrder: true }
      );
      const apAltRows = await paginatedRead("accounting_periods", { client: apAltDb, orderBy: "id", ascending: false });
      assert.deepStrictEqual(apAltRows.map((r) => r.id), [3, 2, 1]);
      for (const q of apAltDb.queryLog) {
        assert.deepStrictEqual(q.orders, [{ column: "id", ascending: false }]);
      }
    }

    console.log("  PASS [2]: Single-column, composite, and non-unique explicit orders verified across tied page boundaries on every request");
  }

  // ---------------------------------------------------------------------------
  // TEST 3: Invalid explicit options MUST throw (never silently fall back to defaults)
  // ---------------------------------------------------------------------------
  {
    const mockDb = createMockSupabase({ deposits: [] });
    const invalidNumericValues = [null, "", "100", 10.5, NaN, Infinity, -Infinity, 0, -1, true, {}, []];

    for (const bad of [...invalidNumericValues, 1001]) {
      await assert.rejects(
        () => paginatedRead("deposits", { client: mockDb, pageSize: bad }),
        /pageSize/i,
        `Expected pageSize=${String(bad)} to throw`
      );
    }

    for (const bad of invalidNumericValues) {
      await assert.rejects(
        () => paginatedRead("deposits", { client: mockDb, maxRows: bad }),
        /maxRows/i,
        `Expected maxRows=${String(bad)} to throw`
      );
      await assert.rejects(
        () => paginatedRead("deposits", { client: mockDb, maxRequests: bad }),
        /maxRequests/i,
        `Expected maxRequests=${String(bad)} to throw`
      );
      await assert.rejects(
        () => paginatedRead("deposits", { client: mockDb, maxPages: bad }),
        /maxPages/i,
        `Expected maxPages=${String(bad)} to throw`
      );
    }

    await assert.rejects(
      () => paginatedRead("deposits", { client: mockDb, maxRequests: 5, maxPages: 6 }),
      /conflicting/i
    );

    const invalidOrders = [null, "", "   ", [], [null], [""], [{ column: "" }], [{ column: "id", ascending: "yes" }], 42, true];
    for (const badOrder of invalidOrders) {
      await assert.rejects(
        () => paginatedRead("deposits", { client: mockDb, orderBy: badOrder }),
        /orderBy/i,
        `Expected orderBy=${JSON.stringify(badOrder)} to throw`
      );
    }

    await assert.rejects(() => paginatedRead("deposits", { client: mockDb, ascending: "true" }), /ascending/i);
    await assert.rejects(() => paginatedRead("deposits", { client: mockDb, select: "" }), /select/i);
    await assert.rejects(() => paginatedRead("deposits", { client: mockDb, select: null }), /select/i);
    await assert.rejects(() => paginatedRead("deposits", { client: mockDb, queryModifier: "bad" }), /queryModifier/i);
    await assert.rejects(() => paginatedRead("deposits", null), /options/i);
    await assert.rejects(() => paginatedRead("deposits", []), /options/i);
    await assert.rejects(() => paginatedRead("", { client: mockDb }), /table/i);
    await assert.rejects(() => paginatedRead("deposits", { client: {} }), /client/i);
    await assert.rejects(() => paginatedRead("deposits"), /not initialized/i);

    assert.strictEqual(mockDb.queryLog.length, 0, "Invalid options must fail before issuing any query");
    console.log("  PASS [3]: All invalid explicit options rejected without silent fallback or DB queries");
  }

  // ---------------------------------------------------------------------------
  // TEST 4: Query errors & null/undefined/non-array/malformed data on page 1 and later page
  // ---------------------------------------------------------------------------
  {
    const deposits = Array.from({ length: 6 }, (_, i) => ({
      id: `dep_${i + 1}`,
      amount: 100
    }));

    const faultPayloads = [
      { label: "query error object", result: { data: null, error: { message: "permission denied" } } },
      { label: "query error string", result: { data: null, error: "database error" } },
      { label: "rejected query promise", throwErr: new Error("socket closed") },
      { label: "null data", result: { data: null, error: null } },
      { label: "undefined data", result: { data: undefined, error: null } },
      { label: "object data", result: { data: { rows: [] }, error: null } },
      { label: "string data", result: { data: "not-an-array", error: null } },
      { label: "number data", result: { data: 123, error: null } },
      { label: "boolean data", result: { data: true, error: null } },
      { label: "null response envelope", result: null },
      { label: "array response envelope", result: [] },
      { label: "malformed non-object row in array", result: { data: [null], error: null } }
    ];

    for (const failOnRequest of [1, 2]) {
      for (const fault of faultPayloads) {
        const mockDb = createMockSupabase(
          { deposits },
          {
            serverPageCap: 2,
            onPageRequest({ requestNumber, defaultResult }) {
              if (requestNumber === failOnRequest) {
                if (fault.throwErr) throw fault.throwErr;
                return fault.result;
              }
              return defaultResult;
            }
          }
        );

        await assert.rejects(
          () => paginatedRead("deposits", { client: mockDb }),
          `Expected ${fault.label} on page ${failOnRequest} to throw`
        );
      }
    }

    // Also verify missing/null verified key on a later page fails closed when page 1 carried the key
    {
      const mockDb = createMockSupabase(
        { deposits },
        {
          serverPageCap: 2,
          onPageRequest({ requestNumber, defaultResult }) {
            if (requestNumber === 2) {
              return { data: [{ id: null, amount: 100 }], error: null };
            }
            return defaultResult;
          }
        }
      );
      await assert.rejects(
        () => paginatedRead("deposits", { client: mockDb }),
        /missing\/null verified key/i
      );
    }
    console.log(`  PASS [4]: All ${faultPayloads.length} error/malformed payloads threw on both page 1 and page 2 (zero partial results)`);
  }

  // ---------------------------------------------------------------------------
  // TEST 5: Exact maxRows success after EOF vs overflow failure
  // ---------------------------------------------------------------------------
  {
    const makeDeposits = (n) =>
      Array.from({ length: n }, (_, i) => ({ id: `dep_${String(i + 1).padStart(3, "0")}`, amount: 10 }));

    // 5a. Exact maxRows (5 rows, pageSize 3) -> succeeds after empty page 3
    {
      const mockDb = createMockSupabase({ deposits: makeDeposits(5) }, { serverPageCap: 3 });
      const rows = await paginatedRead("deposits", { client: mockDb, pageSize: 3, maxRows: 5 });
      assert.strictEqual(rows.length, 5);
      assert.strictEqual(mockDb.queryLog.length, 3);
    }

    // 5b. Exact maxRows on exact page multiple (6 rows, pageSize 3, maxRows 6) -> succeeds after empty page 3
    {
      const mockDb = createMockSupabase({ deposits: makeDeposits(6) }, { serverPageCap: 3 });
      const rows = await paginatedRead("deposits", { client: mockDb, pageSize: 3, maxRows: 6 });
      assert.strictEqual(rows.length, 6);
      assert.strictEqual(mockDb.queryLog.length, 3);
    }

    // 5c. Exceeding maxRows by 1 on later page (7 rows, pageSize 3, maxRows 6) -> throws
    {
      const mockDb = createMockSupabase({ deposits: makeDeposits(7) }, { serverPageCap: 3 });
      await assert.rejects(
        () => paginatedRead("deposits", { client: mockDb, pageSize: 3, maxRows: 6 }),
        /maxRows/i
      );
    }

    // 5d. Exceeding maxRows within a single page (6 rows, pageSize 10, maxRows 5) -> throws
    {
      const mockDb = createMockSupabase({ deposits: makeDeposits(6) }, { serverPageCap: 10 });
      await assert.rejects(
        () => paginatedRead("deposits", { client: mockDb, pageSize: 10, maxRows: 5 }),
        /maxRows/i
      );
    }

    console.log("  PASS [5]: Exact maxRows succeeds after EOF confirmation; any extra row throws");
  }

  // ---------------------------------------------------------------------------
  // TEST 6: Request-limit termination without silent truncation
  // ---------------------------------------------------------------------------
  {
    const makeDeposits = (n) =>
      Array.from({ length: n }, (_, i) => ({ id: `dep_${String(i + 1).padStart(3, "0")}`, amount: 10 }));

    // 6a. Exact maxRequests reached on EOF (4 rows, cap 2 => 2 data + 1 empty = 3 requests) -> succeeds
    {
      const mockDb = createMockSupabase({ deposits: makeDeposits(4) }, { serverPageCap: 2 });
      const rows = await paginatedRead("deposits", {
        client: mockDb,
        pageSize: 100,
        maxRows: 1000,
        maxRequests: 3
      });
      assert.strictEqual(rows.length, 4);
      assert.strictEqual(mockDb.queryLog.length, 3);
    }

    // 6b. Request bound reached before EOF can be confirmed (6 rows, cap 2, maxRequests=3) -> throws
    {
      const mockDb = createMockSupabase({ deposits: makeDeposits(6) }, { serverPageCap: 2 });
      await assert.rejects(
        () => paginatedRead("deposits", { client: mockDb, pageSize: 100, maxRows: 1000, maxRequests: 3 }),
        /maxRequests/i
      );
      assert.strictEqual(mockDb.queryLog.length, 3);
    }

    // 6c. Alias maxPages works identically and throws before silent truncation
    {
      const mockDb = createMockSupabase({ deposits: makeDeposits(4) }, { serverPageCap: 2 });
      await assert.rejects(
        () => paginatedRead("deposits", { client: mockDb, pageSize: 100, maxRows: 1000, maxPages: 2 }),
        /maxRequests/i
      );
    }

    console.log("  PASS [6]: Finite maxRequests/maxPages bound throws before silent truncation");
  }

  // ---------------------------------------------------------------------------
  // TEST 7: Verified-key repeated/no-progress detection + NO false rejection of duplicate business rows
  // ---------------------------------------------------------------------------
  {
    // 7a. Range-ignoring server repeating page 1 on deposits (verified key: id)
    {
      const mockDb = createMockSupabase(
        { deposits: [{ id: "d1", amount: 100 }, { id: "d2", amount: 200 }] },
        {
          onPageRequest({ requestNumber }) {
            if (requestNumber <= 2) {
              return { data: [{ id: "d1", amount: 100 }, { id: "d2", amount: 200 }], error: null };
            }
            return { data: [], error: null };
          }
        }
      );
      await assert.rejects(() => paginatedRead("deposits", { client: mockDb }), /repeated page/i);
    }

    // 7b. Subset / no-progress response on deposits (verified key: id)
    {
      const pages = [
        [{ id: "d1", amount: 100 }, { id: "d2", amount: 200 }, { id: "d3", amount: 300 }],
        [{ id: "d2", amount: 200 }, { id: "d3", amount: 300 }]
      ];
      const mockDb = createMockSupabase(
        { deposits: [] },
        { onPageRequest: ({ requestNumber }) => ({ data: pages[requestNumber - 1] ?? [], error: null }) }
      );
      await assert.rejects(() => paginatedRead("deposits", { client: mockDb }), /no progress/i);
    }

    // 7c. Overlapping verified key across pages (e.g. concurrent insertion offset drift)
    {
      const pages = [
        [{ id: "d1", amount: 100 }, { id: "d2", amount: 200 }],
        [{ id: "d2", amount: 200 }, { id: "d3", amount: 300 }]
      ];
      const mockDb = createMockSupabase(
        { deposits: [] },
        { onPageRequest: ({ requestNumber }) => ({ data: pages[requestNumber - 1] ?? [], error: null }) }
      );
      await assert.rejects(() => paginatedRead("deposits", { client: mockDb }), /already-seen verified key/i);
    }

    // 7d. Duplicate verified key within a single page
    {
      const mockDb = createMockSupabase(
        { deposits: [] },
        {
          onPageRequest: ({ requestNumber }) => ({
            data: requestNumber === 1 ? [{ id: "d1", amount: 100 }, { id: "d1", amount: 100 }] : [],
            error: null
          })
        }
      );
      await assert.rejects(() => paginatedRead("deposits", { client: mockDb }), /duplicate verified key/i);
    }

    // 7e. Composite verified key repeated page on monthly_returns (year, month_number)
    {
      const mockDb = createMockSupabase(
        { monthly_returns: [] },
        {
          onPageRequest: ({ requestNumber }) => ({
            data: requestNumber <= 2
              ? [{ year: 2026, month_number: 1, gross_return_pct: 1.5 }, { year: 2026, month_number: 2, gross_return_pct: 2.0 }]
              : [],
            error: null
          })
        }
      );
      await assert.rejects(() => paginatedRead("monthly_returns", { client: mockDb }), /repeated page/i);
    }

    // 7f. Legitimate duplicate business rows in a projection that omits verified key MUST SUCCEED,
    //     while non-unique explicit order STILL appends verified tie-breaker "id" without leaking "id" into select/response.
    {
      const identicalBusinessDeposits = Array.from({ length: 5 }, (_, i) => ({
        id: `d_${i + 1}`,
        investor_id: "inv_1",
        amount: 500
      }));
      const mockDb = createMockSupabase(
        { deposits: identicalBusinessDeposits },
        { serverPageCap: 2, adversarialTieOrder: true }
      );
      const projected = await paginatedRead("deposits", {
        client: mockDb,
        select: "investor_id, amount",
        orderBy: "amount"
      });
      assert.strictEqual(projected.length, 5, "Identical projected business rows across pages must NOT be falsely rejected");
      assert.deepStrictEqual(Object.keys(projected[0]).sort(), ["amount", "investor_id"]);
      assert.deepStrictEqual(projected[0], { investor_id: "inv_1", amount: 500 });
      assert.deepStrictEqual(projected[4], { investor_id: "inv_1", amount: 500 });
      for (const q of mockDb.queryLog) {
        assert.strictEqual(q.select, "investor_id, amount", "Caller select projection must remain unchanged");
        assert.deepStrictEqual(q.orders, [
          { column: "amount", ascending: true },
          { column: "id", ascending: true }
        ]);
      }
    }

    // 7g. Alternate verified unique key (accounting_periods.id) detects repeated pages when year/month_number omitted,
    //     while projection omitting ALL verified keys ("status") preserves legitimate duplicate business rows.
    {
      const repAltDb = createMockSupabase(
        { accounting_periods: [] },
        {
          onPageRequest: ({ requestNumber }) => ({
            data: requestNumber <= 2 ? [{ id: 1, status: "FINALIZED" }, { id: 2, status: "FINALIZED" }] : [],
            error: null
          })
        }
      );
      await assert.rejects(
        () => paginatedRead("accounting_periods", { client: repAltDb, select: "id, status" }),
        /repeated page/i
      );

      const dupStatusDb = createMockSupabase(
        {
          accounting_periods: [
            { id: 1, year: 2026, month_number: 1, status: "FINALIZED" },
            { id: 2, year: 2026, month_number: 2, status: "FINALIZED" },
            { id: 3, year: 2026, month_number: 3, status: "FINALIZED" },
            { id: 4, year: 2026, month_number: 4, status: "FINALIZED" },
            { id: 5, year: 2026, month_number: 5, status: "FINALIZED" }
          ]
        },
        { serverPageCap: 2, adversarialTieOrder: true }
      );
      const statuses = await paginatedRead("accounting_periods", { client: dupStatusDb, select: "status" });
      assert.strictEqual(statuses.length, 5);
      assert.deepStrictEqual(statuses[0], { status: "FINALIZED" });
    }

    // 7h. Unverified table FAILS CLOSED (never invents "id" or claims stable pagination)
    {
      const unverifiedDb = createMockSupabase({
        unverified_custom_table: [{ bucket: "A", amount: 100 }]
      });
      await assert.rejects(
        () => paginatedRead("unverified_custom_table", { client: unverifiedDb }),
        /no schema-verified unique key/i
      );
      await assert.rejects(
        () => paginatedRead("unverified_custom_table", { client: unverifiedDb, orderBy: "bucket" }),
        /no schema-verified unique key/i
      );
      await assert.rejects(
        () => paginatedRead("toString", { client: unverifiedDb }),
        /no schema-verified unique key/i
      );
      assert.strictEqual(unverifiedDb.queryLog.length, 0, "Unverified tables must fail closed before querying");
    }

    console.log("  PASS [7]: Verified-key repeated/no-progress detection, duplicate business-row preservation, and fail-closed unverified tables confirmed");
  }

  // ---------------------------------------------------------------------------
  // TEST 8: Real caller & wrapper compatibility (readSupabaseTable, loadAccountingData,
  //         executeDailyFinancialReconciliation, getMyfxbookLive, and real PostgREST builder)
  // ---------------------------------------------------------------------------
  {
    // 8a. readSupabaseTable & loadAccountingData (>1,000 rows under cap=300 + adversarial ties)
    const investors = Array.from({ length: 1050 }, (_, i) => ({
      id: `inv_${String(i + 1).padStart(4, "0")}`,
      portal_username: `user_${i + 1}`,
      split_pct: 70
    }));
    const monthlyHistory = Array.from({ length: 1120 }, (_, i) => ({
      id: `hist_${String(i + 1).padStart(4, "0")}`,
      investor_id: `inv_${String((i % 100) + 1).padStart(4, "0")}`,
      year: 2026,
      month_number: (i % 12) + 1,
      ending_balance: 10000
    }));
    const commissionEarnings = Array.from({ length: 1040 }, (_, i) => ({
      id: `ce_${String(i + 1).padStart(4, "0")}`,
      recipient_id: "inv_0001",
      source_investor_id: "inv_0002",
      year: 2026,
      month_number: (i % 12) + 1,
      amount: 50
    }));
    const deposits = [
      { id: "dep_1", investor_id: "inv_0001", amount: 5000, type: "Wire" },
      { id: "dep_2", investor_id: "inv_0001", amount: 9999, type: "VOID" }
    ];
    const withdrawals = [
      { id: "wd_1", investor_id: "inv_0001", amount: 250, status: "Approved" },
      { id: "wd_2", investor_id: "inv_0001", amount: 500, status: "Cancelled" }
    ];
    const monthlyReturns = [
      { year: 2026, month_number: 2, gross_return_pct: 2.0 },
      { year: 2026, month_number: 1, gross_return_pct: 1.0 }
    ];

    const mockDb = createMockSupabase(
      {
        investors,
        investor_accounts: [{ id: "acc_1", investor_id: "inv_0001", starting_capital: 10000 }],
        deposits,
        withdrawals,
        commission_shares: [{ id: "cs_1", source_investor_id: "inv_0002", recipient_investor_id: "inv_0001", commission_percent: 10 }],
        investor_monthly_history: monthlyHistory,
        commission_earnings: commissionEarnings,
        monthly_returns: monthlyReturns,
        account_cutover_adjustments: [],
        commission_rules: []
      },
      { serverPageCap: 300, adversarialTieOrder: true }
    );

    const normalizedInvestors = await readSupabaseTable("investors", { client: mockDb });
    assert.strictEqual(normalizedInvestors.length, 1050);
    assert.strictEqual(normalizedInvestors[1049].investorsinvestorid, "inv_1050");
    assert.strictEqual(normalizedInvestors[1049].investorsplit, 70);

    const logStart = mockDb.queryLog.length;
    const loaded = await loadAccountingData({ supabaseClient: mockDb });
    assert.strictEqual(loaded.investors.length, 1050);
    assert.strictEqual(loaded.monthlyHistory.length, 1120);
    assert.strictEqual(loaded.commissionEarnings.length, 1040);
    assert.deepStrictEqual(loaded.deposits.map((d) => d.id), ["dep_1"]);
    assert.deepStrictEqual(loaded.withdrawals.map((w) => w.id), ["wd_1"]);
    assert.deepStrictEqual(loaded.monthlyReturns.map((r) => r.month_number), [1, 2]);

    const loadQueries = mockDb.queryLog.slice(logStart);
    for (const q of loadQueries) {
      if (q.table === "monthly_returns") {
        assert.deepStrictEqual(q.orders, [
          { column: "year", ascending: true },
          { column: "month_number", ascending: true }
        ]);
      } else {
        assert.deepStrictEqual(q.orders, [{ column: "id", ascending: true }]);
      }
      if (q.table === "deposits") {
        assert.deepStrictEqual(q.filters, [{ kind: "not", column: "type", operator: "ilike", value: "VOID" }]);
      }
      if (q.table === "withdrawals") {
        assert.deepStrictEqual(q.filters, [{ kind: "in", column: "status", values: ["Approved", "Completed", "Pending", "pending"] }]);
      }
    }
    assert.strictEqual(mockDb.writeAttempts.length, 0);

    // 8b. executeDailyFinancialReconciliation (lib/daily-reconciliation-engine.js) via fake supabaseClient
    {
      const reconMonths = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October"
      ];
      const reconReturns = reconMonths.map((month, idx) => ({
        year: 2026,
        month_number: idx + 1,
        month,
        gross_return_pct: idx + 1 === 9 ? 3.07 : (idx + 1 === 10 ? 0.95 : 1.0),
        locked: idx + 1 <= 9
      }));
      const reconPeriods = reconReturns
        .filter((r) => r.locked)
        .map((r, idx) => ({
          id: idx + 1,
          year: r.year,
          month_number: r.month_number,
          status: "FINALIZED",
          fund_return_pct: r.gross_return_pct
        }));
      const reconHistory = reconMonths.slice(0, 9).map((month, idx) => ({
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

      const reconDb = createMockSupabase(
        {
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
          monthly_returns: reconReturns,
          commission_earnings: [],
          commission_shares: [],
          investor_monthly_history: reconHistory,
          deposits: [],
          withdrawals: [],
          account_cutover_adjustments: [],
          accounting_periods: reconPeriods
        },
        { serverPageCap: 2, adversarialTieOrder: true }
      );

      const report = await executeDailyFinancialReconciliation({
        supabaseClient: reconDb,
        asOfDate: "2026-10-15T12:00:00Z"
      });
      assert.strictEqual(report.status, "PASS", `Expected PASS from synthetic reconciliation, got alerts: ${JSON.stringify(report.alerts)}`);
      assert.strictEqual(report.totalAccountsEvaluated, 1);
      assert.strictEqual(report.successfulReconciliations, 1);
      assert.strictEqual(report.anomalyCounts.P0, 0);
      assert.strictEqual(report.anomalyCounts.P1, 0);
      assert.strictEqual(reconDb.writeAttempts.length, 0);

      for (const q of reconDb.queryLog) {
        if (q.table === "monthly_returns" || q.table === "accounting_periods") {
          assert.deepStrictEqual(q.orders, [
            { column: "year", ascending: true },
            { column: "month_number", ascending: true }
          ]);
        } else {
          assert.deepStrictEqual(q.orders, [{ column: "id", ascending: true }]);
        }
      }
      assert(reconDb.requestCountsByTable.monthly_returns >= 6, "monthly_returns must paginate across multiple pages under cap=2");
      assert(reconDb.requestCountsByTable.accounting_periods >= 5, "accounting_periods must paginate across multiple pages under cap=2");
    }

    // 8c. getMyfxbookLive (lib/myfxbook.js) reading live_performance via readSupabaseTable
    {
      const lpDb = createMockSupabase(
        {
          live_performance: [
            { metric: "This Year", value_pct: "30.53", last_updated: "2026-10-15T10:00:00Z" },
            { metric: "Today", value_pct: "0.15", last_updated: "2026-10-15T12:00:00Z" },
            { metric: "This Week", value_pct: "0.47", last_updated: "2026-10-15T11:00:00Z" },
            { metric: "This Month", value_pct: "0.95", last_updated: "2026-10-15T11:30:00Z" }
          ]
        },
        { serverPageCap: 2, adversarialTieOrder: true }
      );
      const live = await getMyfxbookLive({
        skipScraper: true,
        readTable: (table) => readSupabaseTable(table, { client: lpDb })
      });
      assert.strictEqual(live.today, "+0.15%");
      assert.strictEqual(live.week, "+0.47%");
      assert.strictEqual(live.month, "+0.95%");
      assert.strictEqual(live.year, "+30.53%");
      assert.strictEqual(lpDb.queryLog.length, 3); // 2 data pages + 1 empty EOF
      for (const q of lpDb.queryLog) {
        assert.deepStrictEqual(q.orders, [{ column: "metric", ascending: true }]);
      }
    }

    // 8d. Real @supabase/supabase-js + @supabase/postgrest-js query builder URL verification (fake fetch, 0 network)
    {
      const capturedUrls = [];
      const depositDataset = [
        { id: "d1", investor_id: "inv_1", amount: 500 },
        { id: "d2", investor_id: "inv_1", amount: 500 },
        { id: "d3", investor_id: "inv_1", amount: 500 },
        { id: "d4", investor_id: "inv_1", amount: 500 }
      ];
      const returnDataset = [
        { year: 2026, month_number: 1, gross_return_pct: 1.0 },
        { year: 2026, month_number: 2, gross_return_pct: 2.0 },
        { year: 2025, month_number: 12, gross_return_pct: 1.5 }
      ];

      const fakeFetch = async (input, init = {}) => {
        const url = new URL(typeof input === "string" ? input : input.url);
        assert.strictEqual((init.method || "GET").toUpperCase(), "GET", "PostgREST client must issue GET only");
        capturedUrls.push(url);
        const table = url.pathname.split("/").pop();
        const selectParam = url.searchParams.get("select") || "*";
        const offset = Number(url.searchParams.get("offset") || 0);
        const cap = 2; // Simulate server page cap < requested limit=1000
        const source = table === "deposits" ? depositDataset : returnDataset;
        const page = source.slice(offset, offset + cap).map((r) => projectRow(r, selectParam));
        return new Response(JSON.stringify(page), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      };

      const realBuilderClient = createClient("https://synthetic-offline.invalid", "synthetic-offline-key", {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { fetch: fakeFetch }
      });

      const projected = await paginatedRead("deposits", {
        client: realBuilderClient,
        select: "investor_id, amount",
        orderBy: "amount"
      });
      assert.strictEqual(projected.length, 4);
      assert.deepStrictEqual(Object.keys(projected[0]).sort(), ["amount", "investor_id"]);
      const depUrls = capturedUrls.filter((u) => u.pathname.endsWith("/deposits"));
      assert.strictEqual(depUrls.length, 3); // offsets 0, 2, 4 (EOF)
      assert.deepStrictEqual(depUrls.map((u) => u.searchParams.get("offset")), ["0", "2", "4"]);
      for (const u of depUrls) {
        assert.strictEqual(u.searchParams.get("select"), "investor_id,amount");
        assert.strictEqual(u.searchParams.get("order"), "amount.asc,id.asc");
        assert.strictEqual(u.searchParams.get("limit"), "1000");
      }

      const retRows = await paginatedRead("monthly_returns", {
        client: realBuilderClient,
        orderBy: "year",
        ascending: false
      });
      assert.strictEqual(retRows.length, 3);
      const retUrls = capturedUrls.filter((u) => u.pathname.endsWith("/monthly_returns"));
      assert.strictEqual(retUrls.length, 3); // offsets 0, 2, 3 (EOF)
      for (const u of retUrls) {
        assert.strictEqual(u.searchParams.get("select"), "*");
        assert.strictEqual(u.searchParams.get("order"), "year.desc,month_number.asc");
      }
    }

    console.log("  PASS [8]: readSupabaseTable, loadAccountingData, executeDailyFinancialReconciliation, getMyfxbookLive, and real PostgREST query builder verified offline");
  }

  // ---------------------------------------------------------------------------
  // TEST 9: Zero network calls throughout entire module import and test run
  // ---------------------------------------------------------------------------
  assert.strictEqual(networkCalls.length, 0, `Expected 0 network calls, observed ${networkCalls.length}`);
  console.log("  PASS [9]: Zero network calls and zero writes confirmed");

  console.log("\n=== ALL SHARED PAGINATION CONTRACT TESTS PASSED (9/9) ===");
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
