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

  // 1. vercel.json runs sync-myfxbook hourly (:30 * * * *)
  {
    const vercelCfg = JSON.parse(fs.readFileSync(path.join(__dirname, "../vercel.json"), "utf8"));
    const syncCron = vercelCfg.crons.find((c) => c.path === "/api/cron/sync-myfxbook");
    assert(syncCron, "vercel.json must configure /api/cron/sync-myfxbook cron");
    assert.strictEqual(syncCron.schedule, "30 * * * *", "Cron schedule must trigger hourly to allow automatic intraday updates");
    console.log("  PASS [1]: vercel.json configures hourly /api/cron/sync-myfxbook schedule");
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

    // C. 01:40 PST INTRADAY (10m after prior) -> skipped by cooldown
    const t2 = Date.parse("2026-11-16T09:40:00Z");
    // Cooldown vs 00:30: wait 00:30 -> 01:40 is 70m, so test cooldown at 01:05 (35m after PRIMARY)
    const cCool = await claimSyncSlot({ pacificDateStr: dateStr, windowType: "INTRADAY", instanceId: "inst_cool", nowMs: Date.parse("2026-11-16T09:05:00Z"), db });
    assert.strictEqual(cCool.claimed, false);
    assert.strictEqual(cCool.reason, "INTRADAY_COOLDOWN_ACTIVE");

    // D. Monday 10:30 AM PST (18:30 UTC) -> claims INTRADAY automatically and updates Today / This Week!
    let scrapeCount = 0;
    const { req: dayReq, res: dayRes } = makeReqRes({
      method: "GET",
      query: { force: "true", simulatedDate: "2026-11-21T18:30:00Z" }, // attempt Saturday HTTP override ignored!
      headers: { "x-vercel-cron": "1" }
    });
    await cronSyncHandler(dayReq, dayRes, {
      supabase: db,
      simulatedDate: "2026-11-16T18:30:00Z", // Monday 10:30 AM PST
      getMyfxbookLive: async () => {
        scrapeCount += 1;
        return {
          today: "+0.08%",
          week: "+0.15%",
          month: "+1.40%",
          year: "+35.11%",
          source: "Myfxbook (Scrape.do)",
          isLiveScraped: true,
          fetchedAt: "2026-11-16T18:30:02Z"
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
      simulatedDate: "2026-11-16T18:35:00Z",
      getMyfxbookLive: async () => {
        scrapeCount += 1;
        return { isLiveScraped: true };
      }
    });
    assert.strictEqual(dupRes.statusCode, 200);
    assert.strictEqual(dupRes.payload.skipped, true);
    assert.strictEqual(dupRes.payload.reason, "INTRADAY_COOLDOWN_ACTIVE");
    assert.strictEqual(scrapeCount, 1);

    // F. 1st failed intraday scrape records FAILED cleanly without spamming alert
    let alertCount = 0;
    const { req: failReq, res: failRes } = makeReqRes({
      method: "GET",
      headers: { "x-vercel-cron": "1" }
    });
    await cronSyncHandler(failReq, failRes, {
      supabase: db,
      simulatedDate: "2026-11-16T19:30:00Z",
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

    // G. 2nd consecutive failed intraday scrape dispatches ONE alert; 3rd does NOT spam
    for (const ts of ["2026-11-16T20:30:00Z", "2026-11-16T21:30:00Z"]) {
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

    // H. Next successful sync clears error streak and updates metrics again
    const { req: recReq, res: recRes } = makeReqRes({ method: "GET", headers: { "x-vercel-cron": "1" } });
    await cronSyncHandler(recReq, recRes, {
      supabase: db,
      simulatedDate: "2026-11-16T22:30:00Z",
      getMyfxbookLive: async () => ({
        today: "+0.22%",
        week: "+0.29%",
        month: "+1.54%",
        year: "+35.30%",
        source: "Myfxbook (Scrape.do)",
        isLiveScraped: true,
        fetchedAt: "2026-11-16T22:30:02Z"
      })
    });
    assert.strictEqual(recRes.statusCode, 200);
    assert.strictEqual(db.claims.get(dateStr).error_message, null);

    console.log("  PASS [3]: Hourly automatic intraday refresh, cooldown credit protection, HTTP override ignore, error-only streak alerting, and recovery verified");
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
    console.log("  PASS [4]: updateLivePerformance skips manual overrides cleanly and prevents spurious 0.00% overwrites");
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
    assert.strictEqual(syncedMonthArg, "+1.40%");
    console.log("  PASS [5]: Admin myfxbook-commit writes live_performance and syncs open monthly_returns");
  }

  console.log("\nMYFXBOOK AUTOSYNC TEST RESULT: PASS (5/5)");
}

runTests().catch((err) => {
  console.error("MYFXBOOK AUTOSYNC FAILED:", err);
  process.exit(1);
});
