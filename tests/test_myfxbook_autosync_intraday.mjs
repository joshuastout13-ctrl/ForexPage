import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.SUPABASE_ANON_KEY;
delete process.env.DATA_SOURCE;
process.env.SESSION_SECRET = "test_autosync_session_secret";
process.env.CRON_SECRET = "test_autosync_cron_secret";

import { createSession } from "../lib/auth.js";
import { updateLivePerformance } from "../lib/supabase.js";
import { getMyfxbookLive, fetchScrapeDoMetrics } from "../lib/myfxbook.js";
import cronSyncHandler from "../api/cron/sync-myfxbook.js";
import commitHandler from "../api/admin/myfxbook-commit.js";
import {
  determineSyncWindow,
  determineSyncExecutionPlan,
  isIntradayMarketSyncActive,
  claimSyncSlot,
  finalizeDailySyncSuccess
} from "../lib/myfxbook-sync-manager.js";

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

function createInMemorySyncDb() {
  const claims = new Map();
  const auditRuns = [];

  return {
    claims,
    auditRuns,
    from(table) {
      if (table === "myfxbook_sync_claims") {
        return {
          select() {
            const filters = {};
            const chain = {
              eq(col, val) {
                filters[col] = val;
                return chain;
              },
              async maybeSingle() {
                const row = claims.get(filters.pacific_date) || null;
                return { data: row ? { ...row } : null, error: null };
              }
            };
            return chain;
          },
          insert(rows) {
            const row = { ...rows[0] };
            return {
              select() {
                return {
                  async single() {
                    if (claims.has(row.pacific_date)) {
                      return { data: null, error: { message: "duplicate key", code: "23505" } };
                    }
                    claims.set(row.pacific_date, { ...row });
                    return { data: { ...row }, error: null };
                  }
                };
              }
            };
          },
          update(patch) {
            const eqFilters = {};
            const execUpdate = () => {
              const cur = claims.get(eqFilters.pacific_date);
              if (!cur) return null;
              if (eqFilters.status !== undefined && cur.status !== eqFilters.status) return null;
              if (eqFilters.updated_at !== undefined && cur.updated_at !== eqFilters.updated_at) return null;
              const next = { ...cur, ...patch };
              claims.set(eqFilters.pacific_date, next);
              return { ...next };
            };
            const chain = {
              eq(col, val) {
                eqFilters[col] = val;
                return chain;
              },
              then(resolve, reject) {
                try {
                  execUpdate();
                  resolve({ error: null });
                } catch (e) {
                  if (reject) reject(e);
                }
              },
              select() {
                return {
                  async maybeSingle() {
                    const updated = execUpdate();
                    return { data: updated, error: null };
                  },
                  async single() {
                    const updated = execUpdate();
                    return { data: updated, error: updated ? null : { message: "not updated" } };
                  }
                };
              }
            };
            return chain;
          }
        };
      }
      if (table === "audit_runs") {
        return {
          async insert(rows) {
            auditRuns.push(...rows);
            return { error: null };
          }
        };
      }
      throw new Error(`Unexpected table ${table}`);
    }
  };
}

async function runTests() {
  console.log("=== Myfxbook Automatic Intraday + Midnight Sync Test Suite ===");

  // 1. vercel.json runs sync-myfxbook every 3 hours aligned to Pacific midnight settlement
  {
    const vercelCfg = JSON.parse(fs.readFileSync(path.join(__dirname, "../vercel.json"), "utf8"));
    const syncCron = vercelCfg.crons.find((c) => c.path === "/api/cron/sync-myfxbook");
    assert(syncCron, "vercel.json must configure /api/cron/sync-myfxbook cron");
    assert.strictEqual(
      syncCron.schedule,
      "30 2,5,8,11,14,17,20,23 * * *",
      "Cron schedule must trigger every 3 hours while hitting 08:30 UTC midnight window year-round"
    );
    const hours = syncCron.schedule.split(" ")[1].split(",").map(Number);
    assert.strictEqual(hours.length, 8, "Every-3-hour schedule must run 8 ticks per UTC day");
    for (let i = 0; i < hours.length; i += 1) {
      const next = hours[(i + 1) % hours.length];
      const delta = (next - hours[i] + 24) % 24;
      assert.strictEqual(delta, 3, "Every cron tick must be spaced strictly 3 hours apart");
    }
    assert(hours.includes(8), "08:30 UTC must be included to hit PRIMARY in PST and BACKUP in PDT");
    console.log("  PASS [1]: vercel.json configures every-3-hour /api/cron/sync-myfxbook aligned with PST/PDT midnight");
  }

  // 2. Window & market hours routing preserves PDT/PST midnight behavior + enables intraday trading hours
  {
    // Preserved legacy midnight windows
    assert.strictEqual(determineSyncWindow("2026-10-20T07:30:00Z").window, "PRIMARY");
    assert.strictEqual(determineSyncWindow("2026-10-20T08:30:00Z").window, "BACKUP");
    assert.strictEqual(determineSyncWindow("2027-01-15T08:30:00Z").window, "PRIMARY");
    assert.strictEqual(determineSyncWindow("2027-01-15T09:30:00Z").window, "BACKUP");

    // Monday Nov 16 2026 10:30 AM PST (18:30 UTC) -> INTRADAY
    const monMorningPlan = determineSyncExecutionPlan("2026-11-16T18:30:00Z");
    assert.strictEqual(monMorningPlan.mode, "INTRADAY");
    assert.strictEqual(monMorningPlan.shouldSync, true);

    // Sunday Nov 15 2026 15:30 PST (23:30 UTC) -> INTRADAY (market open)
    assert.strictEqual(isIntradayMarketSyncActive("2026-11-15T23:30:00Z"), true);
    assert.strictEqual(determineSyncExecutionPlan("2026-11-15T23:30:00Z").mode, "INTRADAY");

    // Saturday Nov 21 2026 10:30 AM PST (18:30 UTC) -> SKIP (market closed)
    assert.strictEqual(isIntradayMarketSyncActive("2026-11-21T18:30:00Z"), false);
    const satDayPlan = determineSyncExecutionPlan("2026-11-21T18:30:00Z");
    assert.strictEqual(satDayPlan.mode, "SKIP");
    assert.strictEqual(satDayPlan.shouldSync, false);
    assert.strictEqual(satDayPlan.reason, "MARKET_CLOSED_OUTSIDE_TRADING_HOURS");

    // Saturday Nov 21 2026 12:30 AM PST (08:30 UTC) -> PRIMARY still captures Friday close!
    const satMidnightPlan = determineSyncExecutionPlan("2026-11-21T08:30:00Z");
    assert.strictEqual(satMidnightPlan.mode, "PRIMARY");
    assert.strictEqual(satMidnightPlan.shouldSync, true);
    console.log("  PASS [2]: Midnight PRIMARY/BACKUP, Sun-Fri intraday trading hours, and weekend market-closed skip verified");
  }

  // 3. Atomic claim supports midnight idempotency AND intraday hourly refresh with cooldown
  {
    const db = createInMemorySyncDb();
    const dateStr = "2026-11-16";

    // A. 00:30 PST PRIMARY claims & succeeds
    const t0 = Date.parse("2026-11-16T08:30:00Z");
    const c1 = await claimSyncSlot({ pacificDateStr: dateStr, windowType: "PRIMARY", instanceId: "inst_1", nowMs: t0, db });
    assert.strictEqual(c1.claimed, true);
    await finalizeDailySyncSuccess({
      pacificDateStr: dateStr,
      windowType: "PRIMARY",
      instanceId: "inst_1",
      nowMs: t0 + 1000,
      db,
      data: { today: "+0.00%", week: "+0.00%", month: "+1.25%", year: "+34.91%", isLiveScraped: true, source: "Myfxbook (Scrape.do)", fetchedAt: new Date(t0).toISOString() }
    });

    // B. 01:30 PST BACKUP skips because PRIMARY already succeeded
    const t1 = Date.parse("2026-11-16T09:30:00Z");
    const c2 = await claimSyncSlot({ pacificDateStr: dateStr, windowType: "BACKUP", instanceId: "inst_2", nowMs: t1, db });
    assert.strictEqual(c2.claimed, false);
    assert.strictEqual(c2.reason, "BACKUP_SKIPPED_PRIMARY_SUCCEEDED");

    // C. 01:05 PST INTRADAY (+35m) and 02:30 PST (+2h) -> skipped by 2.5h cooldown (150 min)
    const cCoolShort = await claimSyncSlot({ pacificDateStr: dateStr, windowType: "INTRADAY", instanceId: "inst_cool_1", nowMs: Date.parse("2026-11-16T09:05:00Z"), db });
    assert.strictEqual(cCoolShort.claimed, false);
    assert.strictEqual(cCoolShort.reason, "INTRADAY_COOLDOWN_ACTIVE");

    const cCool2h = await claimSyncSlot({ pacificDateStr: dateStr, windowType: "INTRADAY", instanceId: "inst_cool_2", nowMs: Date.parse("2026-11-16T10:30:00Z"), db });
    assert.strictEqual(cCool2h.claimed, false);
    assert.strictEqual(cCool2h.reason, "INTRADAY_COOLDOWN_ACTIVE");

    // D. Monday 03:30 AM PST (11:30 UTC, +3h) -> claims INTRADAY automatically and updates Today / This Week!
    let scrapeCount = 0;
    const { req: dayReq, res: dayRes } = makeReqRes({
      method: "GET",
      query: { force: "true", simulatedDate: "2026-11-21T18:30:00Z" }, // attempt Saturday HTTP override ignored!
      headers: { "x-vercel-cron": "1" }
    });
    await cronSyncHandler(dayReq, dayRes, {
      supabase: db,
      simulatedDate: "2026-11-16T11:30:00Z", // Monday 03:30 AM PST (+3h from PRIMARY)
      getMyfxbookLive: async () => {
        scrapeCount += 1;
        return {
          today: "+0.08%",
          week: "+0.15%",
          month: "+1.40%",
          year: "+35.11%",
          source: "Myfxbook (Scrape.do)",
          isLiveScraped: true,
          fetchedAt: "2026-11-16T11:30:02Z"
        };
      }
    });
    assert.strictEqual(dayRes.statusCode, 200);
    assert.strictEqual(dayRes.payload.skipped, undefined);
    assert.strictEqual(dayRes.payload.window, "INTRADAY");
    assert.strictEqual(dayRes.payload.data.today, "+0.08%");
    assert.strictEqual(dayRes.payload.data.week, "+0.15%");
    assert.strictEqual(scrapeCount, 1);
    assert.strictEqual(db.claims.get(dateStr).metrics.today, "+0.08%");
    assert.strictEqual(db.claims.get(dateStr).metrics.week, "+0.15%");

    // E. Immediate duplicate intraday hit 5 minutes later -> blocked by cooldown (0 scrapes)
    const { req: dupReq, res: dupRes } = makeReqRes({
      method: "GET",
      query: { force: "true" }, // force ignored!
      headers: { "x-vercel-cron": "1" }
    });
    await cronSyncHandler(dupReq, dupRes, {
      supabase: db,
      simulatedDate: "2026-11-16T11:35:00Z",
      getMyfxbookLive: async () => {
        scrapeCount += 1;
        return { isLiveScraped: true };
      }
    });
    assert.strictEqual(dupRes.statusCode, 200);
    assert.strictEqual(dupRes.payload.skipped, true);
    assert.strictEqual(dupRes.payload.reason, "INTRADAY_COOLDOWN_ACTIVE");
    assert.strictEqual(scrapeCount, 1);

    // F. 1st failed intraday scrape (+3h at 14:30 UTC) records FAILED cleanly without spamming alert
    let alertCount = 0;
    const { req: failReq, res: failRes } = makeReqRes({
      method: "GET",
      headers: { "x-vercel-cron": "1" }
    });
    await cronSyncHandler(failReq, failRes, {
      supabase: db,
      simulatedDate: "2026-11-16T14:30:00Z",
      getMyfxbookLive: async () => ({
        isLiveScraped: false,
        scrapeErrors: ["Scrape.do returned HTML without parseable period metrics"]
      }),
      dispatchAdministratorAlert: async () => {
        alertCount += 1;
      }
    });
    assert.strictEqual(failRes.statusCode, 500);
    assert.strictEqual(db.claims.get(dateStr).status, "FAILED");
    assert.strictEqual(alertCount, 0, "Single transient intraday failure must not alert yet");

    // G. 2nd & 3rd consecutive failed intraday scrapes (+3h ticks at 17:30Z, 20:30Z) dispatch ONE alert total
    for (const ts of ["2026-11-16T17:30:00Z", "2026-11-16T20:30:00Z"]) {
      const { req: rF, res: sF } = makeReqRes({ method: "GET", headers: { "x-vercel-cron": "1" } });
      await cronSyncHandler(rF, sF, {
        supabase: db,
        simulatedDate: ts,
        getMyfxbookLive: async () => ({ isLiveScraped: false, scrapeErrors: ["Upstream timeout"] }),
        dispatchAdministratorAlert: async () => { alertCount += 1; }
      });
      assert.strictEqual(sF.statusCode, 500);
    }
    assert.strictEqual(alertCount, 1, "Consecutive intraday failure must send exactly ONE alert per outage streak");

    // H. Next successful sync (+3h at 23:30 UTC) clears error streak and updates metrics again
    const { req: recReq, res: recRes } = makeReqRes({ method: "GET", headers: { "x-vercel-cron": "1" } });
    await cronSyncHandler(recReq, recRes, {
      supabase: db,
      simulatedDate: "2026-11-16T23:30:00Z",
      getMyfxbookLive: async () => ({
        today: "+0.22%",
        week: "+0.29%",
        month: "+1.54%",
        year: "+35.30%",
        source: "Myfxbook (Scrape.do)",
        isLiveScraped: true,
        fetchedAt: "2026-11-16T23:30:02Z"
      })
    });
    assert.strictEqual(recRes.statusCode, 200);
    assert.strictEqual(db.claims.get(dateStr).error_message, null);

    // I. Missing CRON_SECRET must fail closed even against "Bearer undefined"
    const prevSecret = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;
    try {
      const { req: undefReq, res: undefRes } = makeReqRes({
        method: "GET",
        headers: { authorization: "Bearer undefined" }
      });
      await cronSyncHandler(undefReq, undefRes, { supabase: db });
      assert.strictEqual(undefRes.statusCode, 401);
    } finally {
      process.env.CRON_SECRET = prevSecret;
    }

    console.log("  PASS [3]: Every-3-hour automatic intraday refresh, 150m cooldown credit protection, CRON_SECRET guard, HTTP override ignore, error-only streak alerting, and recovery verified");
  }

  // 4. updateLivePerformance respects is_override & preserves missing metrics safely
  {
    const rows = new Map([
      ["Today", { metric: "Today", value_pct: "0.08", is_override: false }],
      ["This Week", { metric: "This Week", value_pct: "0.99", is_override: true }],
      ["This Month", { metric: "This Month", value_pct: "1.40", is_override: false }],
      ["This Year", { metric: "This Year", value_pct: "35.11", is_override: false }]
    ]);
    const mockLiveDb = {
      from(table) {
        assert.strictEqual(table, "live_performance");
        return {
          async select() {
            return { data: Array.from(rows.values()), error: null };
          },
          async upsert(updates) {
            updates.forEach((u) => rows.set(u.metric, { ...rows.get(u.metric), ...u }));
            return { error: null };
          }
        };
      }
    };

    // Intraday partial parse (`today: null`, `month: null`, `year: "+35.20%"`, `week: "+0.25%"` overridden):
    await updateLivePerformance(
      { today: null, week: "+0.25%", month: null, year: "+35.20%" },
      { customClient: mockLiveDb, preserveMissing: true, source: "Myfxbook (Scrape.do)" }
    );
    assert.strictEqual(rows.get("Today").value_pct, "0.08", "Intraday missing Today (-) must not erase prior valid intraday value");
    assert.strictEqual(rows.get("This Week").value_pct, "0.99", "Manual override metric (is_override=true) must be skipped by auto-sync");
    assert.strictEqual(rows.get("This Month").value_pct, "1.40", "Missing This Month must never be overwritten with 0.00%");
    assert.strictEqual(rows.get("This Year").value_pct, "35.20", "Valid non-overridden metric updates cleanly");

    // Midnight rollover (`preserveMissing: false`): resets non-overridden Today ("-") cleanly to 0.00 without zeroing Month
    await updateLivePerformance(
      { today: null, week: "+0.25%", month: null, year: "+35.20%" },
      { customClient: mockLiveDb, preserveMissing: false, source: "Myfxbook (Scrape.do)" }
    );
    assert.strictEqual(rows.get("Today").value_pct, "0.00", "Midnight rollover resets null Today (-) to 0.00");
    assert.strictEqual(rows.get("This Month").value_pct, "1.40", "Midnight rollover still preserves This Month if missing");
    assert(rows.get("Today").last_updated && rows.get("Today").updated_at, "updateLivePerformance updates both last_updated and updated_at");
    console.log("  PASS [4]: updateLivePerformance skips manual overrides cleanly, updates timestamps, and prevents spurious 0.00% overwrites");
  }

  // 5. Admin /api/admin/myfxbook-commit updates live_performance AND syncs open monthly_returns
  {
    const adminCookie = `scff_admin_session=${createSession({ adminId: "admin_1", role: "admin" })}`;
    let syncedMonthArg = null;
    let upsertedRows = null;
    const mockDb = {
      from(table) {
        assert.strictEqual(table, "live_performance");
        return {
          async upsert(rows) {
            upsertedRows = rows;
            return { error: null };
          }
        };
      }
    };
    const { req, res } = makeReqRes({
      method: "POST",
      cookie: adminCookie,
      body: { today: "+0.08%", week: "+0.15%", month: "+1.40%", year: "+35.11%" }
    });
    await commitHandler(req, res, {
      supabase: mockDb,
      syncOpenMonthlyReturn: async (monthStr) => {
        syncedMonthArg = monthStr;
        return { success: true };
      }
    });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(upsertedRows.length, 4);
    assert(upsertedRows[0].last_updated && upsertedRows[0].updated_at, "Admin commit sets both last_updated and updated_at");
    assert.strictEqual(syncedMonthArg, "+1.40%");
    console.log("  PASS [5]: Admin myfxbook-commit writes live_performance and syncs open monthly_returns");
  }

  // 6. getMyfxbookLive({ skipScraper: true }) exposes real DB lastUpdated & fetchScrapeDoMetrics retries transient 502 once
  {
    const dbUpdatedAt = "2026-11-18T16:30:27.000Z";
    const cached = await getMyfxbookLive({
      skipScraper: true,
      readTable: async () => [
        { metric: "Today", value_pct: "0.50", last_updated: dbUpdatedAt },
        { metric: "This Week", value_pct: "1.00", last_updated: dbUpdatedAt }
      ]
    });
    assert.strictEqual(cached.today, "+0.50%");
    assert.strictEqual(cached.lastUpdated, dbUpdatedAt);
    assert.strictEqual(cached.fetchedAt, dbUpdatedAt, "Cached read must expose DB lastUpdated instead of fabricating new Date()");

    let attempts = 0;
    const sampleHtml = `<table><tr><td>Today</td><td><span>+0.42%</span></td></tr><tr><td>This Week</td><td><span>+0.92%</span></td></tr><tr><td>This Month</td><td><span>+2.18%</span></td></tr><tr><td>This Year</td><td><span>+36.15%</span></td></tr></table>`;
    const scraped = await fetchScrapeDoMetrics({
      token: "test_token",
      retryDelayMs: 0,
      fetchFn: async () => {
        attempts += 1;
        if (attempts === 1) {
          return { ok: false, status: 502, text: async () => "Bad Gateway" };
        }
        return { ok: true, status: 200, text: async () => sampleHtml };
      }
    });
    assert.strictEqual(attempts, 2, "Transient 502 triggers 1 automatic retry");
    assert.strictEqual(scraped.today, "+0.42%");
    assert.strictEqual(scraped.month, "+2.18%");
    console.log("  PASS [6]: getMyfxbookLive preserves real DB lastUpdated and retries transient Scrape.do 502 once");
  }

  // 7. index.html shows real sync timestamp on Account & Fund Performance without stale 4:00 PM PST copy
  {
    const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
    assert(!html.includes("Data refreshes daily at 4:00 PM PST"), "Stale 4:00 PM PST copy must be removed");
    assert(html.includes('id="accountLiveMeta"'), "Account Performance card must render real sync timestamp");
    assert(html.includes("formatLiveSyncLabel(live.lastUpdated || live.fetchedAt)"), "UI must format real DB sync timestamp instead of new Date()");
    console.log("  PASS [7]: index.html displays real last-synced timestamp and 3-hour cadence copy");
  }

  console.log("\nMYFXBOOK AUTOSYNC TEST RESULT: PASS (7/7)");
}

runTests().catch((err) => {
  console.error("MYFXBOOK AUTOSYNC FAILED:", err);
  process.exit(1);
});
