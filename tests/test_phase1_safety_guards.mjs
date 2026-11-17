import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Ensure isolated offline environment (no Supabase or live session secret needed)
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.SUPABASE_ANON_KEY;
delete process.env.DATA_SOURCE;
process.env.SESSION_SECRET = "test_phase1_session_secret_offline";
process.env.CRON_SECRET = "test_phase1_cron_secret_offline";
process.env.ACCOUNTING_RETURN_FREEZE_ENABLED = "true";
process.env.ACCOUNTING_FINALIZATION_ENABLED = "true";

import { createSession } from "../lib/auth.js";
import freezeHandler from "../api/admin/accounting/return/freeze/index.js";
import finalizeHandler from "../api/admin/accounting/finalize/index.js";
import cronMonthEndCloseHandler from "../api/cron/month-end-close.js";
import syncMyfxbookHandler from "../api/cron/sync-myfxbook.js";
import meCommissionSharesHandler from "../api/me/commission-shares/index.js";
import { buildInvestorDashboard, resolveMonthCommissionDisplayState } from "../lib/dashboard.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function makeReqRes({ method = "GET", headers = {}, query = {}, body = {}, cookie = "" } = {}) {
  const req = {
    method,
    headers: { ...headers, ...(cookie ? { cookie } : {}) },
    query: { ...query },
    body: { ...body }
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

function renderMonthlyActivityFromIndexHtml(prevRow, targetMonthName = "November") {
  const indexHtml = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
  const marker = "// Prior month commission capitalization logic:";
  const markerIdx = indexHtml.indexOf(marker);
  assert(markerIdx !== -1, "index.html must contain commission capitalization marker");
  const ifIdx = indexHtml.indexOf("if (prevRow) {", markerIdx);
  const openBrace = indexHtml.indexOf("{", ifIdx);
  let depth = 0;
  let endIdx = -1;
  for (let i = openBrace; i < indexHtml.length; i++) {
    if (indexHtml[i] === "{") depth++;
    else if (indexHtml[i] === "}") {
      depth--;
      if (depth === 0) {
        endIdx = i;
        break;
      }
    }
  }
  assert(endIdx !== -1, "Failed to parse if (prevRow) block from index.html");
  const inner = indexHtml.slice(openBrace + 1, endIdx);
  const fn = new Function("prevRow", "r", "money", `let activityHtml = '';\n${inner}\nreturn activityHtml;`);
  const money = (v) => `$${(Number(v) || 0).toFixed(2)}`;
  return fn(prevRow, { month: targetMonthName, year: prevRow.year || 2026, isProjection: false }, money);
}

async function runTests() {
  console.log("=== Phase 1 Safety Guards Offline Regression Suite ===");

  const adminToken = createSession({ adminId: "phase1_admin", role: "admin" });
  const adminCookie = `scff_admin_session=${adminToken}`;

  // -------------------------------------------------------------------------
  // 1. Direct admin freeze & finalize reject incomplete periods BEFORE DB calls
  // -------------------------------------------------------------------------
  {
    let dbCalls = 0;
    let loaderCalls = 0;
    const spyDb = {
      from() {
        dbCalls += 1;
        throw new Error("DB must not be touched when America/Los_Angeles period state is incomplete");
      }
    };
    const spyLoader = async () => {
      loaderCalls += 1;
      throw new Error("Accounting loader must not be called when America/Los_Angeles period state is incomplete");
    };

    // Incomplete current month (2026-11 evaluated on 2026-11-15 PT), even with request override attempts
    for (const badBody of [
      { year: 2026, month: 11, grossReturnPct: 2.0, source: "MYFXBOOK_COMPLETED_MONTH", asOfDate: "2099-01-01T00:00:00Z", override: true },
      { year: 2099, month: 1, grossReturnPct: 2.0, source: "MYFXBOOK_COMPLETED_MONTH", override: true }
    ]) {
      const { req, res } = makeReqRes({ method: "POST", body: badBody, cookie: adminCookie });
      await freezeHandler(req, res, { supabase: spyDb, asOfDate: "2026-11-15T12:00:00Z" });
      assert.strictEqual(res.statusCode, 422);
      assert.strictEqual(res.payload.error, "PERIOD_NOT_HISTORICAL_SETTLED");
    }

    for (const badFin of [
      { year: 2026, month: 10, dryRun: true, asOfDate: "2099-01-01T00:00:00Z", override: true },
      { year: 2026, month: 10, dryRun: false, asOfDate: "2099-01-01T00:00:00Z", override: true },
      { year: 2099, month: 2, dryRun: false }
    ]) {
      const { req, res } = makeReqRes({ method: "POST", body: badFin, cookie: adminCookie });
      await finalizeHandler(req, res, {
        supabase: spyDb,
        loadAccountingData: spyLoader,
        asOfDate: "2026-11-01T06:59:59Z" // Oct 31 23:59:59 PDT -> Oct still CURRENT_OPEN
      });
      assert.strictEqual(res.statusCode, 422);
      assert.strictEqual(res.payload.error, "PERIOD_NOT_HISTORICAL_SETTLED");
    }

    assert.strictEqual(dbCalls, 0, "Zero DB calls permitted before incomplete-period rejection");
    assert.strictEqual(loaderCalls, 0, "Zero loader calls permitted before incomplete-period rejection");
    console.log("  PASS [1]: freeze & finalize reject incomplete America/Los_Angeles periods before DB access or mutation");
  }

  // -------------------------------------------------------------------------
  // 2. Cron handlers ignore HTTP asOfDate / simulatedDate / force overrides
  // -------------------------------------------------------------------------
  {
    let closeDbCalls = 0;
    const spyCloseDb = {
      from() {
        closeDbCalls += 1;
        throw new Error("month-end-close must reject incomplete period before querying accounting_periods");
      }
    };
    const { req: closeReq, res: closeRes } = makeReqRes({
      method: "POST",
      query: { year: "2026", month: "11", asOfDate: "2099-01-01T00:00:00Z", force: "true" },
      body: { year: 2026, month: 11, asOfDate: "2099-01-01T00:00:00Z", force: true },
      headers: { authorization: "Bearer test_phase1_cron_secret_offline" }
    });
    await cronMonthEndCloseHandler(closeReq, closeRes, {
      supabase: spyCloseDb,
      asOfDate: "2026-11-15T12:00:00Z",
      dispatchAdministratorAlert: async () => {}
    });
    assert.strictEqual(closeRes.statusCode, 422);
    assert.strictEqual(closeRes.payload.error, "PERIOD_NOT_HISTORICAL_SETTLED");
    assert.strictEqual(closeDbCalls, 0);

    // sync-myfxbook: HTTP query.simulatedDate & query.force="true" must NOT force scrape outside deps window
    let syncClaimCalls = 0;
    let syncLiveCalls = 0;
    const { req: outsideReq, res: outsideRes } = makeReqRes({
      method: "GET",
      query: { simulatedDate: "2026-11-05T08:30:00Z", force: "true" }, // 12:30 AM PST in HTTP query
      body: { simulatedDate: "2026-11-05T08:30:00Z", force: "true" },
      headers: { authorization: "Bearer test_phase1_cron_secret_offline" }
    });
    await syncMyfxbookHandler(outsideReq, outsideRes, {
      simulatedDate: "2026-11-05T18:00:00Z", // 10:00 AM PST (OUTSIDE_WINDOW) via deps
      claimDailySyncSlot: async () => {
        syncClaimCalls += 1;
        return { claimed: true };
      },
      getMyfxbookLive: async () => {
        syncLiveCalls += 1;
        return { isLiveScraped: true };
      }
    });
    assert.strictEqual(outsideRes.statusCode, 200);
    assert.strictEqual(outsideRes.payload.skipped, true);
    assert.strictEqual(outsideRes.payload.reason, "OUTSIDE_PACIFIC_MIDNIGHT_WINDOW");
    assert.strictEqual(syncClaimCalls, 0, "HTTP simulatedDate/force must not reach claimDailySyncSlot outside window");
    assert.strictEqual(syncLiveCalls, 0, "HTTP simulatedDate/force must not trigger getMyfxbookLive outside window");

    // sync-myfxbook: query.force="true" must NOT bypass failed DB claim even inside deps PRIMARY window
    const { req: claimFailReq, res: claimFailRes } = makeReqRes({
      method: "GET",
      query: { force: "true" },
      headers: { "x-vercel-cron": "1" }
    });
    await syncMyfxbookHandler(claimFailReq, claimFailRes, {
      simulatedDate: "2026-11-05T08:30:00Z", // 12:30 AM PST (PRIMARY) via deps
      claimDailySyncSlot: async () => ({
        claimed: false,
        reason: "PRIMARY_ALREADY_SUCCEEDED",
        existingClaim: { status: "SUCCESS" }
      }),
      getMyfxbookLive: async () => {
        syncLiveCalls += 1;
        return { isLiveScraped: true };
      }
    });
    assert.strictEqual(claimFailRes.statusCode, 200);
    assert.strictEqual(claimFailRes.payload.skipped, true);
    assert.strictEqual(claimFailRes.payload.reason, "PRIMARY_ALREADY_SUCCEEDED");
    assert.strictEqual(syncLiveCalls, 0, "HTTP force=true must not bypass daily DB claim lock");
    console.log("  PASS [2]: Cron handlers ignore HTTP asOfDate/simulatedDate/force while preserving deps clock injection");
  }

  // -------------------------------------------------------------------------
  // 3. Mixed/unlocked October without SUPERSEDED rows fails closed consistently
  // -------------------------------------------------------------------------
  {
    const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const baseReturns = [
      ...Array.from({ length: 9 }, (_, i) => ({ year: 2026, month_number: i + 1, month: MONTH_NAMES[i], gross_return_pct: 2.0, locked: true })),
      { year: 2026, month_number: 10, month: "October", gross_return_pct: 3.05, locked: false },
      { year: 2026, month_number: 11, month: "November", gross_return_pct: 0, locked: false },
      { year: 2026, month_number: 12, month: "December", gross_return_pct: 0, locked: false }
    ];

    const mixedFixtures = [
      {
        label: "unlocked return + locked populated history + active commission (no SUPERSEDED)",
        returnsSheet: baseReturns, // M10 locked=false
        historyTable: [
          { investor_id: "P_REC", year: 2026, month_number: 9, opening_balance: 100000, ending_balance: 102000, locked: true },
          { investor_id: "P_REC", year: 2026, month_number: 10, opening_balance: 102000, ending_balance: 105111, locked: true }
        ]
      },
      {
        label: "locked return + unlocked history + active commission (no SUPERSEDED)",
        returnsSheet: baseReturns.map(r => (r.month_number === 10 ? { ...r, locked: true } : r)),
        historyTable: [
          { investor_id: "P_REC", year: 2026, month_number: 9, opening_balance: 100000, ending_balance: 102000, locked: true },
          { investor_id: "P_REC", year: 2026, month_number: 10, opening_balance: 102000, ending_balance: 105111, locked: false }
        ]
      }
    ];

    for (const fx of mixedFixtures) {
      const dash = await buildInvestorDashboard("p_rec", {
        rawInvestors: [{ id: "P_REC", investorid: "P_REC", portal_username: "p_rec", first_name: "Rec", last_name: "Tester", split_pct: 100, start_date: "2026-01-01" }],
        accounts: [{ id: "ACC_REC", investor_id: "P_REC", starting_capital: 100000, status: "active", is_commission: true }],
        returnsSheet: fx.returnsSheet,
        depositsSheet: [],
        withdrawalsSheet: [],
        historyTable: fx.historyTable,
        commissionEarningsTable: [
          { id: "c_sep", recipient_id: "P_REC", year: 2026, month_number: 9, amount: 500, status: "ACTIVE" },
          { id: "c_oct", recipient_id: "P_REC", year: 2026, month_number: 10, amount: 15162, status: "ACTIVE" }
        ],
        commissionSharesTable: [],
        commissionRulesTable: [],
        cutoverAdjustments: [],
        asOfDate: "2026-11-05T12:00:00Z"
      });

      assert.strictEqual(dash.summary.bookedCommissionsEarnedMonth, 0, `${fx.label}: booked month must be 0`);
      assert.strictEqual(dash.summary.bookedCommissionsEarnedYear, 500, `${fx.label}: booked YTD must exclude unverified Oct`);
      assert.strictEqual(dash.summary.commissionsEarnedMonth, null, `${fx.label}: verified month must be null`);
      assert.strictEqual(dash.summary.commissionsUnavailable, true, `${fx.label}: summary commissionsUnavailable must be true`);

      const octRow = dash.breakdown.find(r => r.monthNumber === 10);
      assert.strictEqual(octRow.commissionsEarned, 0);
      assert.strictEqual(octRow.displayCommissionsEarned, 0);
      assert.strictEqual(octRow.activeCommissionsEarned, 0);
      assert.strictEqual(octRow.verificationStatus, "UNVERIFIED");
      assert.strictEqual(octRow.commissionsUnavailable, true);

      const novHtml = renderMonthlyActivityFromIndexHtml(octRow, "November");
      assert(novHtml.includes("October Commission: Pending Verification"), `${fx.label}: Nov activity must render Pending Verification`);
      assert(!novHtml.includes("15162"), `${fx.label}: Nov activity must never show unverified amount`);
      assert(!novHtml.includes("capitalized"), `${fx.label}: Nov activity must never claim capitalization`);
    }

    // Also unit-check resolveMonthCommissionDisplayState directly
    const directState = resolveMonthCommissionDisplayState({
      commissionsEarned: 15162,
      hasSupersededForMonth: false,
      returnRow: { year: 2026, month_number: 10, locked: true },
      historyRow: { year: 2026, month_number: 10, locked: false },
      isHistoricalCompleted: true
    });
    assert.strictEqual(directState.isBookable, false);
    assert.strictEqual(directState.verificationStatus, "UNVERIFIED");
    assert.strictEqual(directState.displayCommissionsEarned, 0);
    console.log("  PASS [3]: Mixed/unlocked commission states without SUPERSEDED rows fail closed identically in summary & Nov capitalization display");
  }

  // -------------------------------------------------------------------------
  // 4. GET /api/me/commission-shares strips counterparty email fields & query cols
  // -------------------------------------------------------------------------
  {
    const investorCookie = `scff_session=${createSession({ investorId: "inv_recip" })}`;

    // Unauthenticated rejected 401
    {
      const { req, res } = makeReqRes({ method: "GET" });
      await meCommissionSharesHandler(req, res, { supabase: {} });
      assert.strictEqual(res.statusCode, 401);
    }

    // POST disabled 403
    {
      const { req, res } = makeReqRes({ method: "POST", cookie: investorCookie });
      await meCommissionSharesHandler(req, res, { supabase: {} });
      assert.strictEqual(res.statusCode, 403);
    }

    let capturedSelect = null;
    const mockDb = {
      from(table) {
        assert.strictEqual(table, "commission_shares");
        return {
          select(cols) {
            capturedSelect = cols;
            return {
              ilike() {
                return {
                  async order() {
                    return {
                      data: [
                        {
                          id: "share_1",
                          source_investor_id: "inv_src",
                          recipient_investor_id: "inv_recip",
                          commission_percent: 10,
                          recipient: {
                            portal_username: "recip_user",
                            first_name: "Recip",
                            last_name: "Investor",
                            email: "secret-recipient@example.com"
                          },
                          source: {
                            portal_username: "src_user",
                            first_name: "Source",
                            last_name: "Investor",
                            email: "secret-source@example.com"
                          },
                          account: { name: "Source Primary" }
                        }
                      ],
                      error: null
                    };
                  }
                };
              }
            };
          }
        };
      }
    };

    const { req, res } = makeReqRes({ method: "GET", cookie: investorCookie });
    await meCommissionSharesHandler(req, res, { supabase: mockDb });
    assert.strictEqual(res.statusCode, 200);
    assert.ok(capturedSelect && !capturedSelect.toLowerCase().includes("email"), "SQL select projection must not request email column");
    assert.strictEqual(res.payload.shares.length, 1);
    assert.strictEqual("email" in res.payload.shares[0].source, false, "source.email must not appear in GET response");
    assert.strictEqual("email" in res.payload.shares[0].recipient, false, "recipient.email must not appear in GET response");
    assert.strictEqual(JSON.stringify(res.payload).includes("@example.com"), false, "No counterparty email string may serialize");
    assert.strictEqual(res.payload.shares[0].source.portal_username, "src_user");
    assert.strictEqual(res.payload.shares[0].recipient.portal_username, "recip_user");
    assert.strictEqual(res.payload.shares[0].account.name, "Source Primary");
    console.log("  PASS [4]: GET /api/me/commission-shares omits counterparty email from projection and JSON payload");
  }

  console.log("\nPHASE 1 SAFETY GUARDS RESULT: PASS (4/4)");
}

runTests().catch((err) => {
  console.error("PHASE 1 SAFETY GUARDS FAILED:", err);
  process.exit(1);
});
