import assert from "node:assert";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

// Hard offline network guards (zero real network calls permitted).
const networkCalls = [];
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

http.request = blockNetwork("http.request");
http.get = blockNetwork("http.get");
https.request = blockNetwork("https.request");
https.get = blockNetwork("https.get");
net.connect = blockNetwork("net.connect");
net.createConnection = blockNetwork("net.createConnection");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function createMockClassList(initial = []) {
  const set = new Set(initial);
  return {
    add: (...cls) => cls.forEach((c) => set.add(c)),
    remove: (...cls) => cls.forEach((c) => set.delete(c)),
    toggle: (c, force) => {
      if (force === undefined) {
        if (set.has(c)) set.delete(c);
        else set.add(c);
      } else if (force) {
        set.add(c);
      } else {
        set.delete(c);
      }
    },
    contains: (c) => set.has(c)
  };
}

function createMockElement(id = "", initialText = "") {
  const listeners = new Map();
  return {
    id,
    innerHTML: "",
    textContent: initialText,
    value: "",
    checked: false,
    disabled: false,
    dataset: {},
    style: {},
    files: [],
    classList: createMockClassList(),
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    dispatchEvent(type, event = {}) {
      const fns = listeners.get(type) || [];
      for (const fn of fns) fn(event);
    },
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    scrollIntoView() {},
    remove() {},
    appendChild() {}
  };
}

function createAdminHarness() {
  const html = fs.readFileSync(path.join(repoRoot, "admin.html"), "utf8");
  const scriptStart = html.indexOf("<script>");
  const scriptEnd = html.lastIndexOf("</script>");
  assert(scriptStart !== -1 && scriptEnd > scriptStart, "Could not locate inline <script> in admin.html");

  let scriptBody = html.slice(scriptStart + "<script>".length, scriptEnd);
  assert(scriptBody.trimEnd().endsWith("init();"), "Expected admin.html inline script to end with init();");
  scriptBody = scriptBody.replace(/init\(\);\s*$/, "");
  scriptBody += `
    globalThis.__ADMIN_HARNESS__ = {
      state,
      api,
      loadTab,
      renderTable,
      updateSummaryCards,
      fetchAdminAccountsWithRetry,
      isRetryableAccountsError,
      invalidateAdminAccountsCache,
      money
    };
  `;

  const elements = new Map();
  const getEl = (id) => {
    if (!elements.has(id)) {
      const initial = id === "totalPlatformValue" ? "$0.00" : (id === "totalPlatformAccounts" ? "0" : "");
      elements.set(id, createMockElement(id, initial));
    }
    return elements.get(id);
  };

  const alerts = [];
  const fetchLog = [];
  let fetchHandler = async () => {
    throw new Error("No fake fetchHandler configured");
  };

  const mockDocument = {
    body: {
      classList: createMockClassList(),
      appendChild() {}
    },
    getElementById: getEl,
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    createElement(tag) {
      return createMockElement(tag);
    }
  };

  const context = {
    console: { log() {}, warn() {}, error() {} },
    document: mockDocument,
    window: { location: { reload() {} } },
    alert(msg) {
      alerts.push(String(msg));
    },
    confirm: () => true,
    setTimeout,
    clearTimeout,
    Date,
    Math,
    Number,
    String,
    Array,
    Object,
    Set,
    Map,
    Promise,
    Error,
    TypeError,
    SyntaxError,
    JSON,
    URLSearchParams,
    encodeURIComponent,
    decodeURIComponent,
    parseFloat,
    parseInt,
    isNaN,
    fetch: async (url, opts = {}) => {
      fetchLog.push({ url, method: (opts.method || "GET").toUpperCase() });
      return fetchHandler(url, opts);
    }
  };
  context.globalThis = context;

  vm.runInNewContext(scriptBody, context, { filename: "admin.html" });

  return {
    ...context.__ADMIN_HARNESS__,
    getEl,
    alerts,
    fetchLog,
    setFetchHandler(fn) {
      fetchHandler = fn;
    },
    resetLogs() {
      alerts.length = 0;
      fetchLog.length = 0;
    }
  };
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    }
  };
}

function invalidJsonResponse(status) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      throw new SyntaxError("Unexpected end of JSON input");
    }
  };
}

function makeInvestors() {
  return [
    {
      id: "inv_a",
      portal_username: "alice",
      first_name: "Alice",
      last_name: "Alpha",
      email: "alice@example.invalid",
      active: true,
      starting_capital: 100000,
      split_pct: 100,
      monthly_draw: 0,
      start_date: "2026-01-01"
    },
    {
      id: "inv_b",
      portal_username: "bob",
      first_name: "Bob",
      last_name: "Beta",
      email: "bob@example.invalid",
      active: true,
      starting_capital: 120000,
      split_pct: 100,
      monthly_draw: 0,
      start_date: "2026-01-01"
    }
  ];
}

function makeAccounts(balA, balB) {
  return [
    {
      id: "acc_a",
      investor_id: "inv_a",
      name: "Alice Main",
      starting_capital: 100000,
      current_balance: balA,
      status: "Active",
      open_date: "2026-01-01"
    },
    {
      id: "acc_b",
      investor_id: "inv_b",
      name: "Bob Main",
      starting_capital: 120000,
      current_balance: balB,
      status: "Active",
      open_date: "2026-01-01"
    }
  ];
}

async function seedHealthyState(h, balA = 150000, balB = 200000) {
  h.resetLogs();
  h.state.tab = "investors";
  h.state.search = "";
  h.setFetchHandler(async (url) => {
    if (url === "/api/admin/investors") return jsonResponse(200, { investors: makeInvestors() });
    if (url === "/api/admin/accounts") return jsonResponse(200, { accounts: makeAccounts(balA, balB) });
    throw new Error(`Unexpected URL: ${url}`);
  });
  await h.loadTab("investors");
  assert.strictEqual(h.alerts.length, 0);
  assert.strictEqual(h.state.accountsAvailable, true);
  assert.strictEqual(h.getEl("totalPlatformValue").textContent, h.money(balA + balB));
  assert.strictEqual(h.getEl("totalPlatformAccounts").textContent, 2);
}

function assertInvalidatedAndNoStaleOrFallbackBalances(h, staleBalA, staleTotal, label) {
  assert.strictEqual(h.state.accountsAvailable, false, `${label}: accountsAvailable must be false`);
  assert.strictEqual(h.state.data.accounts.length, 0, `${label}: cached accounts must be empty`);
  assert.strictEqual(h.getEl("totalPlatformValue").textContent, "—", `${label}: totalPlatformValue must be '—', never stale or $0.00`);
  assert.strictEqual(h.getEl("totalPlatformAccounts").textContent, "—", `${label}: totalPlatformAccounts must be '—', never stale or 0`);
  assert.strictEqual(h.getEl("dataHead").innerHTML, "", `${label}: table header must be cleared`);
  assert.strictEqual(h.getEl("dataBody").innerHTML, "", `${label}: table body must be cleared`);

  // Trigger search re-render on investors tab -> must never show stale balance, starting_capital, or $0.00 in Current Balance cell
  h.getEl("searchBar").dispatchEvent("input", { target: { value: "alice" } });
  const bodyAfterSearch = h.getEl("dataBody").innerHTML;
  assert(!bodyAfterSearch.includes(h.money(staleBalA)), `${label}: search must not show stale balance`);
  assert(!bodyAfterSearch.includes(h.money(staleTotal)), `${label}: search must not show stale total`);
  const tds = [...bodyAfterSearch.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
  assert(tds.length >= 7, `${label}: expected investor row cells on search`);
  assert(tds[6].includes("—"), `${label}: Current Balance cell must render '—', got ${tds[6]}`);
  assert(!tds[6].includes(h.money(100000)), `${label}: Current Balance cell must never show starting_capital`);
  assert(!tds[6].includes("$0.00"), `${label}: Current Balance cell must never show $0.00`);
  h.state.search = "";

  // Accounts tab render must render 0 stale rows
  const prevTab = h.state.tab;
  h.state.tab = "accounts";
  h.renderTable();
  assert.strictEqual(h.getEl("dataBody").innerHTML, "", `${label}: accounts tab must render 0 rows when invalidated`);
  h.state.tab = prevTab;
}

async function runTests() {
  console.log("=== Admin Accounts Retry Classification & Failure Recovery Offline Tests ===");
  const h = createAdminHarness();

  // ---------------------------------------------------------------------------
  // TEST 1: Network/transport failure followed by 200 retries exactly once and recovers
  // ---------------------------------------------------------------------------
  {
    await seedHealthyState(h, 150000, 200000);
    h.resetLogs();
    let accCalls = 0;
    h.setFetchHandler(async (url) => {
      if (url === "/api/admin/investors") return jsonResponse(200, { investors: makeInvestors() });
      if (url === "/api/admin/accounts") {
        accCalls += 1;
        if (accCalls === 1) throw new TypeError("Failed to fetch");
        return jsonResponse(200, { accounts: makeAccounts(165000, 215000) });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    await h.loadTab("investors");
    assert.strictEqual(accCalls, 2, "Network failure must retry exactly once (2 total calls)");
    assert.strictEqual(h.alerts.length, 0, "Recovered retry must not trigger alert");
    assert.strictEqual(h.state.accountsAvailable, true);
    assert.strictEqual(h.getEl("totalPlatformValue").textContent, h.money(380000));
    assert.strictEqual(h.getEl("totalPlatformAccounts").textContent, 2);
    assert(!h.getEl("dataBody").innerHTML.includes(h.money(150000)), "Must not retain stale balance");
    assert(h.getEl("dataBody").innerHTML.includes(h.money(165000)));
    assert(h.getEl("dataBody").innerHTML.includes(h.money(215000)));
    console.log("  PASS [1]: Network/transport failure followed by 200 retries once and recovers without stale values");
  }

  // ---------------------------------------------------------------------------
  // TEST 2: HTTP 5xx (500, 503) followed by 200 retries exactly once and recovers
  // ---------------------------------------------------------------------------
  for (const status of [500, 503]) {
    await seedHealthyState(h, 150000, 200000);
    h.resetLogs();
    let accCalls = 0;
    h.setFetchHandler(async (url) => {
      if (url === "/api/admin/investors") return jsonResponse(200, { investors: makeInvestors() });
      if (url === "/api/admin/accounts") {
        accCalls += 1;
        if (accCalls === 1) return jsonResponse(status, { error: `transient HTTP ${status}` });
        return jsonResponse(200, { accounts: makeAccounts(160000, 210000) });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    await h.loadTab("investors");
    assert.strictEqual(accCalls, 2, `HTTP ${status} must retry exactly once (2 total calls)`);
    assert.strictEqual(h.alerts.length, 0);
    assert.strictEqual(h.state.accountsAvailable, true);
    assert.strictEqual(h.getEl("totalPlatformValue").textContent, h.money(370000));
    assert.strictEqual(h.getEl("totalPlatformAccounts").textContent, 2);
    assert(h.getEl("dataBody").innerHTML.includes(h.money(160000)));
  }
  console.log("  PASS [2]: HTTP 5xx (500, 503) followed by 200 retries once and recovers cleanly");

  // ---------------------------------------------------------------------------
  // TEST 3: Two retryable failures (2x 5xx and 2x transport) clear cache/totals,
  //         preserve alert, prevent stale/zero/starting_capital display, and recover later
  // ---------------------------------------------------------------------------
  {
    const doubleRetryableCases = [
      {
        label: "two consecutive HTTP 500 responses",
        failAccounts: () => jsonResponse(500, { error: "DB balance calculation failed" })
      },
      {
        label: "two consecutive network rejections",
        failAccounts: () => {
          throw new TypeError("Failed to fetch");
        }
      },
      {
        label: "HTTP 502 followed by network rejection",
        failAccounts: (attempt) => {
          if (attempt === 1) return jsonResponse(502, { error: "Bad Gateway" });
          throw new TypeError("connection reset");
        }
      }
    ];

    for (const tc of doubleRetryableCases) {
      await seedHealthyState(h, 165000, 215000);
      h.resetLogs();
      let accCalls = 0;
      h.setFetchHandler(async (url) => {
        if (url === "/api/admin/investors") return jsonResponse(200, { investors: makeInvestors() });
        if (url === "/api/admin/accounts") {
          accCalls += 1;
          return tc.failAccounts(accCalls);
        }
        throw new Error(`Unexpected URL: ${url}`);
      });

      await h.loadTab("investors");
      assert.strictEqual(accCalls, 2, `${tc.label}: must attempt initial + exactly 1 retry (observed ${accCalls})`);
      assert.strictEqual(h.alerts.length, 1, `${tc.label}: must preserve existing error alert`);
      assert(h.alerts[0].includes("Failed to load data:"));
      assertInvalidatedAndNoStaleOrFallbackBalances(h, 165000, 380000, tc.label);
    }

    // Tab switch while accounts remain failing still refuses stale cache
    h.resetLogs();
    let tabSwitchAccCalls = 0;
    h.setFetchHandler(async (url) => {
      if (url === "/api/admin/deposits") return jsonResponse(200, { deposits: [] });
      if (url === "/api/admin/accounts") {
        tabSwitchAccCalls += 1;
        return jsonResponse(503, { error: "still unavailable" });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    h.state.tab = "deposits";
    await h.loadTab("deposits");
    assert.strictEqual(tabSwitchAccCalls, 2);
    assert.strictEqual(h.state.accountsAvailable, false);
    assert.strictEqual(h.getEl("totalPlatformValue").textContent, "—");
    assert.strictEqual(h.getEl("totalPlatformAccounts").textContent, "—");

    // Next normal refresh recovers completely
    await seedHealthyState(h, 175000, 225000);
    assert.strictEqual(h.getEl("totalPlatformValue").textContent, h.money(400000));
    assert(h.getEl("dataBody").innerHTML.includes(h.money(175000)));
    assert(h.getEl("dataBody").innerHTML.includes(h.money(225000)));

    console.log("  PASS [3]: Two retryable failures clear cache/totals, preserve alert, block stale/zero/starting_capital, and recover on next refresh");
  }

  // ---------------------------------------------------------------------------
  // TEST 4: Non-retryable failures are NEVER retried (exact 1 call) and invalidate cache
  //         - 4xx (400, 401, 403, 404, 422)
  //         - AbortError
  //         - Malformed 200 responses (invalid JSON, {}, { accounts: null }, [])
  //         - Invalid balance data (missing, null, NaN, string, null account row)
  // ---------------------------------------------------------------------------
  {
    const nonRetryableCases = [
      ...[400, 401, 403, 404, 422].map((status) => ({
        label: `HTTP ${status}`,
        respond: () => jsonResponse(status, { error: `Client/Auth HTTP ${status}` })
      })),
      {
        label: "AbortError",
        respond: () => {
          const err = new Error("The operation was aborted");
          err.name = "AbortError";
          throw err;
        }
      },
      {
        label: "HTTP 200 invalid JSON",
        respond: () => invalidJsonResponse(200)
      },
      {
        label: "HTTP 200 empty object {}",
        respond: () => jsonResponse(200, {})
      },
      {
        label: "HTTP 200 null accounts",
        respond: () => jsonResponse(200, { accounts: null })
      },
      {
        label: "HTTP 200 raw array instead of object",
        respond: () => jsonResponse(200, [])
      },
      {
        label: "HTTP 200 missing current_balance",
        respond: () => jsonResponse(200, {
          accounts: [{ id: "acc_a", investor_id: "inv_a", starting_capital: 100000, status: "Active" }]
        })
      },
      {
        label: "HTTP 200 null current_balance",
        respond: () => jsonResponse(200, {
          accounts: [{ id: "acc_a", investor_id: "inv_a", starting_capital: 100000, current_balance: null, status: "Active" }]
        })
      },
      {
        label: "HTTP 200 NaN current_balance",
        respond: () => jsonResponse(200, {
          accounts: [{ id: "acc_a", investor_id: "inv_a", starting_capital: 100000, current_balance: Number.NaN, status: "Active" }]
        })
      },
      {
        label: "HTTP 200 string current_balance",
        respond: () => jsonResponse(200, {
          accounts: [{ id: "acc_a", investor_id: "inv_a", starting_capital: 100000, current_balance: "150000", status: "Active" }]
        })
      },
      {
        label: "HTTP 200 null account row",
        respond: () => jsonResponse(200, { accounts: [null] })
      }
    ];

    for (const tc of nonRetryableCases) {
      await seedHealthyState(h, 180000, 220000);
      h.resetLogs();
      let accCalls = 0;
      h.setFetchHandler(async (url) => {
        if (url === "/api/admin/investors") return jsonResponse(200, { investors: makeInvestors() });
        if (url === "/api/admin/accounts") {
          accCalls += 1;
          return tc.respond();
        }
        throw new Error(`Unexpected URL: ${url}`);
      });

      await h.loadTab("investors");
      assert.strictEqual(accCalls, 1, `${tc.label}: MUST NOT be retried (observed ${accCalls} calls)`);
      assert.strictEqual(h.alerts.length, 1, `${tc.label}: must preserve existing error alert`);
      assert(h.alerts[0].includes("Failed to load data:"));
      assertInvalidatedAndNoStaleOrFallbackBalances(h, 180000, 400000, tc.label);
    }

    // Also verify non-tagged arbitrary Error is classified non-retryable
    assert.strictEqual(h.isRetryableAccountsError(new Error("generic client bug")), false);
    assert.strictEqual(h.isRetryableAccountsError(null), false);

    console.log(`  PASS [4]: All ${nonRetryableCases.length} non-retryable failure classes (4xx, AbortError, malformed 200, invalid balances) perform 0 retries and clear stale balances/totals`);
  }

  // ---------------------------------------------------------------------------
  // TEST 5: Unrelated API requests are never retried (on 5xx or network error)
  // ---------------------------------------------------------------------------
  {
    for (const mode of ["500", "network"]) {
      h.resetLogs();
      let depCalls = 0;
      h.setFetchHandler(async (url) => {
        if (url === "/api/admin/deposits") {
          depCalls += 1;
          if (mode === "500") return jsonResponse(500, { error: "deposits failed" });
          throw new TypeError("Failed to fetch");
        }
        throw new Error(`Unexpected URL: ${url}`);
      });

      await h.loadTab("deposits");
      assert.strictEqual(depCalls, 1, `Unrelated /api/admin/deposits (${mode}) must NOT be retried`);
      assert.strictEqual(h.alerts.length, 1);
    }
    console.log("  PASS [5]: Unrelated API routes are never retried on 5xx or network failure");
  }

  // ---------------------------------------------------------------------------
  // TEST 6: Investors-list failure with fresh accounts updates accounts cache &
  //         summary totals, preserves alert, and clears stale investor rows;
  //         simultaneous accounts failure preserves retry + cache invalidation
  // ---------------------------------------------------------------------------
  {
    // 6a. Initial load (from static HTML $0.00 / 0): /api/admin/investors fails, /api/admin/accounts succeeds
    const freshHarness = createAdminHarness();
    assert.strictEqual(freshHarness.getEl("totalPlatformValue").textContent, "$0.00");
    assert.strictEqual(freshHarness.getEl("totalPlatformAccounts").textContent, "0");

    let invCalls = 0;
    let accCalls = 0;
    freshHarness.setFetchHandler(async (url) => {
      if (url === "/api/admin/investors") {
        invCalls += 1;
        return jsonResponse(500, { error: "investors directory unavailable" });
      }
      if (url === "/api/admin/accounts") {
        accCalls += 1;
        return jsonResponse(200, { accounts: makeAccounts(210000, 220000) });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    await freshHarness.loadTab("investors");
    assert.strictEqual(invCalls, 1, "/api/admin/investors must NOT be retried");
    assert.strictEqual(accCalls, 1);
    assert.strictEqual(freshHarness.alerts.length, 1, "Investor-list failure must preserve error alert");
    assert(freshHarness.alerts[0].includes("investors directory unavailable"));
    assert.strictEqual(freshHarness.state.accountsAvailable, true, "Successful accounts load must mark accountsAvailable=true");
    assert.strictEqual(freshHarness.state.data.accounts.length, 2);
    assert.strictEqual(freshHarness.state.data.investors.length, 0);
    assert.strictEqual(
      freshHarness.getEl("totalPlatformValue").textContent,
      freshHarness.money(430000),
      "Fresh accounts summary must replace initial static $0.00 even when /api/admin/investors fails"
    );
    assert.strictEqual(freshHarness.getEl("totalPlatformAccounts").textContent, 2);
    assert.strictEqual(freshHarness.getEl("dataHead").innerHTML, "");
    assert.strictEqual(freshHarness.getEl("dataBody").innerHTML, "");

    // 6b. Refresh after prior healthy load ($350,000): /api/admin/investors fails while
    //     /api/admin/accounts succeeds with fresh balances ($440,000, after 1 transient 500 retry)
    await seedHealthyState(h, 150000, 200000);
    h.resetLogs();
    invCalls = 0;
    accCalls = 0;
    h.setFetchHandler(async (url) => {
      if (url === "/api/admin/investors") {
        invCalls += 1;
        return jsonResponse(500, { error: "investors query failed" });
      }
      if (url === "/api/admin/accounts") {
        accCalls += 1;
        if (accCalls === 1) return jsonResponse(503, { error: "transient accounts 503" });
        return jsonResponse(200, { accounts: makeAccounts(215000, 225000) });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    await h.loadTab("investors");
    assert.strictEqual(invCalls, 1, "/api/admin/investors must not be retried");
    assert.strictEqual(accCalls, 2, "/api/admin/accounts must still recover via 1 automatic retry");
    assert.strictEqual(h.alerts.length, 1, "Investor-list failure must preserve existing alert");
    assert(h.alerts[0].includes("investors query failed"));
    assert.strictEqual(h.state.accountsAvailable, true);
    assert.strictEqual(h.state.data.accounts.length, 2);
    assert.strictEqual(h.state.data.investors.length, 0, "Stale cached investor rows must be cleared on investors-list failure");
    assert.strictEqual(
      h.getEl("totalPlatformValue").textContent,
      h.money(440000),
      "Summary total must update to fresh $440,000 instead of retaining stale $350,000"
    );
    assert.strictEqual(h.getEl("totalPlatformAccounts").textContent, 2);
    assert.strictEqual(h.getEl("dataBody").innerHTML, "");

    // Search after investor-list failure must not render stale investor rows
    h.getEl("searchBar").dispatchEvent("input", { target: { value: "alice" } });
    assert.strictEqual(h.getEl("dataBody").innerHTML, "", "Search must not re-render stale investor rows after investors-list failure");
    h.state.search = "";

    // 6c. Both /api/admin/investors and /api/admin/accounts fail -> accounts retries once,
    //     cache & totals are invalidated to '—', stale investors cleared, and alert shown
    await seedHealthyState(h, 150000, 200000);
    h.resetLogs();
    invCalls = 0;
    accCalls = 0;
    h.setFetchHandler(async (url) => {
      if (url === "/api/admin/investors") {
        invCalls += 1;
        return jsonResponse(500, { error: "investors failed" });
      }
      if (url === "/api/admin/accounts") {
        accCalls += 1;
        return jsonResponse(500, { error: "accounts failed" });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    await h.loadTab("investors");
    assert.strictEqual(invCalls, 1);
    assert.strictEqual(accCalls, 2, "Accounts failure must preserve 1-retry policy");
    assert.strictEqual(h.alerts.length, 1);
    assert.strictEqual(h.state.accountsAvailable, false);
    assert.strictEqual(h.state.data.accounts.length, 0);
    assert.strictEqual(h.state.data.investors.length, 0);
    assert.strictEqual(h.getEl("totalPlatformValue").textContent, "—");
    assert.strictEqual(h.getEl("totalPlatformAccounts").textContent, "—");

    // Search after dual failure renders 0 stale rows
    h.getEl("searchBar").dispatchEvent("input", { target: { value: "alice" } });
    assert.strictEqual(h.getEl("dataBody").innerHTML, "");
    h.state.search = "";

    console.log("  PASS [6]: Investors-list failure updates fresh account cache/totals & clears stale investors; accounts failure preserves retry & invalidation");
  }

  // ---------------------------------------------------------------------------
  // TEST 7: Defensive UI guard — updateSummaryCards & renderTable never fall back
  //         to starting_capital or $0.00 if an account lacks a finite current_balance
  // ---------------------------------------------------------------------------
  {
    h.state.accountsAvailable = true;
    h.state.data.accounts = [{ id: "acc_missing", investor_id: "inv_a", name: "Broken", starting_capital: 99999, status: "Active" }];
    h.updateSummaryCards();
    assert.strictEqual(h.getEl("totalPlatformValue").textContent, "—");
    h.state.tab = "accounts";
    h.renderTable();
    assert(h.getEl("dataBody").innerHTML.includes(">—<"));
    assert(!h.getEl("dataBody").innerHTML.includes(`>${h.money(99999)}<`));
    console.log("  PASS [7]: Defensive summary & table rendering never substitute starting_capital or $0.00");
  }

  // ---------------------------------------------------------------------------
  // TEST 8: Zero real network calls
  // ---------------------------------------------------------------------------
  assert.strictEqual(networkCalls.length, 0, `Expected 0 real network calls, observed ${networkCalls.length}`);
  console.log("  PASS [8]: Zero real network calls confirmed");

  console.log("\n=== ALL ADMIN ACCOUNTS RETRY & RECOVERY TESTS PASSED (8/8) ===");
}

try {
  await runTests();
} finally {
  http.request = originalHttpRequest;
  http.get = originalHttpGet;
  https.request = originalHttpsRequest;
  https.get = originalHttpsGet;
  net.connect = originalNetConnect;
  net.createConnection = originalNetCreateConnection;
}
