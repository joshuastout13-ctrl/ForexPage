import crypto from "node:crypto";
import { getFundAccountingDate, FUND_ACCOUNTING_TIMEZONE } from "./month-state.js";
import { supabase } from "./supabase.js";

/**
 * In-memory concurrency lock to prevent overlapping scrape executions within a single process.
 */
let isLocalSyncActive = false;

/**
 * Returns formatted Pacific date string (YYYY-MM-DD) for a given timestamp.
 * 
 * @param {Date|string|number|null} [asOfDate=null]
 * @returns {string}
 */
export function getPacificDateString(asOfDate = null) {
  const pt = getFundAccountingDate(asOfDate);
  const m = String(pt.monthNumber).padStart(2, "0");
  const d = String(pt.day).padStart(2, "0");
  return `${pt.year}-${m}-${d}`;
}

/**
 * Determines whether the current Pacific time corresponds to the Primary (12:30 AM),
 * Backup (1:30 AM), or an outside window.
 * 
 * Primary window: 12:15 AM - 12:45 AM Pacific (targets 12:30 AM cron tick)
 * Backup window:  1:15 AM - 1:45 AM Pacific (targets 1:30 AM cron tick)
 * 
 * @param {Date|string|number|null} [asOfDate=null]
 * @returns {{ window: 'PRIMARY'|'BACKUP'|'OUTSIDE_WINDOW', pacificDateStr: string, hour: number, minute: number }}
 */
export function determineSyncWindow(asOfDate = null) {
  const pt = getFundAccountingDate(asOfDate);
  const pacificDateStr = getPacificDateString(asOfDate);

  if (pt.hours === 0 && pt.minutes >= 15 && pt.minutes <= 45) {
    return { window: "PRIMARY", pacificDateStr, hour: pt.hours, minute: pt.minutes };
  }

  if (pt.hours === 1 && pt.minutes >= 15 && pt.minutes <= 45) {
    return { window: "BACKUP", pacificDateStr, hour: pt.hours, minute: pt.minutes };
  }

  return { window: "OUTSIDE_WINDOW", pacificDateStr, hour: pt.hours, minute: pt.minutes };
}

const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/**
 * Returns DST-safe Pacific weekday (0=Sun..6=Sat) and 24-hour clock hour (0..23).
 */
export function getPacificMarketClock(asOfDate = null) {
  const d = asOfDate ? new Date(asOfDate) : new Date();
  if (isNaN(d.getTime())) {
    throw new Error(`INVALID_DATE: Cannot parse asOfDate: ${asOfDate}`);
  }
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: FUND_ACCOUNTING_TIMEZONE,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(d);
  const byType = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return {
    weekdayName: byType.weekday,
    weekday: WEEKDAY_INDEX[byType.weekday] ?? -1,
    hour: Number(byType.hour),
    minute: Number(byType.minute)
  };
}

/**
 * Forex market trading hours in America/Los_Angeles:
 * Open Sunday ~14:00 PT through Friday ~17:00 PT.
 */
export function isIntradayMarketSyncActive(asOfDate = null) {
  const { weekday, hour } = getPacificMarketClock(asOfDate);
  if (weekday === 0) return hour >= 14;
  if (weekday >= 1 && weekday <= 4) return true;
  if (weekday === 5) return hour <= 17;
  return false;
}

/**
 * Resolves the execution mode for /api/cron/sync-myfxbook:
 * - PRIMARY (12:15-12:45 AM PT daily, incl. Sat for Fri close)
 * - BACKUP  (1:15-1:45 AM PT daily fallback if Primary failed)
 * - INTRADAY (every 3h during active Sun 14:00 PT - Fri 17:00 PT market hours)
 * - SKIP    (market-closed weekend hours outside midnight settlement)
 */
export function determineSyncExecutionPlan(asOfDate = null) {
  const base = determineSyncWindow(asOfDate);
  if (base.window === "PRIMARY" || base.window === "BACKUP") {
    return { ...base, mode: base.window, shouldSync: true, reason: null };
  }
  if (isIntradayMarketSyncActive(asOfDate)) {
    return { ...base, mode: "INTRADAY", window: "INTRADAY", shouldSync: true, reason: null };
  }
  return {
    ...base,
    mode: "SKIP",
    window: "OUTSIDE_WINDOW",
    shouldSync: false,
    reason: "MARKET_CLOSED_OUTSIDE_TRADING_HOURS"
  };
}

/**
 * Checks durable in-database markers to determine if a successful scrape has
 * ALREADY been recorded for the given Pacific calendar day.
 * 
 * @param {string} pacificDateStr - 'YYYY-MM-DD'
 * @returns {Promise<{ completed: boolean, marker: Object|null }>}
 */
export async function checkDailySyncCompleted(pacificDateStr) {
  if (!supabase) {
    return { completed: false, marker: null };
  }

  try {
    // 1. Check atomic myfxbook_sync_claims table
    const { data: claim, error: claimErr } = await supabase
      .from("myfxbook_sync_claims")
      .select("*")
      .eq("pacific_date", pacificDateStr)
      .maybeSingle();

    if (!claimErr && claim && claim.status === "SUCCESS") {
      return { completed: true, marker: claim };
    }

    // 2. Check audit_runs table
    const { data: runs, error: runErr } = await supabase
      .from("audit_runs")
      .select("id, report_json, created_at")
      .eq("admin_id", "myfxbook_daily_sync")
      .order("created_at", { ascending: false })
      .limit(10);

    if (!runErr && runs && runs.length > 0) {
      const match = runs.find(r => 
        r.report_json?.pacificDate === pacificDateStr && 
        r.report_json?.status === "SUCCESS"
      );
      if (match) {
        return { completed: true, marker: match };
      }
    }
  } catch (err) {
    console.warn("[Sync Manager] Error reading daily sync marker:", err.message);
  }

  return { completed: false, marker: null };
}

/**
 * ATOMIC DATABASE-LEVEL DAILY CLAIM (Prevents duplicate scraping across Vercel instances).
 * 
 * Guarantees that only ONE Vercel lambda instance across the entire platform
 * can acquire the daily scraping slot for a given Pacific calendar date.
 * 
 * @param {Object} params
 * @param {string} params.pacificDateStr - 'YYYY-MM-DD'
 * @param {'PRIMARY'|'BACKUP'} params.windowType
 * @param {string} params.instanceId - Unique identifier of the current execution
 * @returns {Promise<{ claimed: boolean, reason?: string, existingClaim?: Object, claimRecord?: Object, error?: string }>}
 */
export async function claimDailySyncSlot({ pacificDateStr, windowType, instanceId, db = supabase }) {
  return claimSyncSlot({ pacificDateStr, windowType, instanceId, db });
}

/**
 * Atomic DB-level claim across Vercel instances for both midnight (PRIMARY/BACKUP)
 * and intraday every-3-hour market-hours refreshes (INTRADAY with cooldown protection).
 */
export async function claimSyncSlot({
  pacificDateStr,
  windowType,
  instanceId,
  cooldownMs = 150 * 60 * 1000,
  nowMs = Date.now(),
  db = supabase
}) {
  if (!db) {
    return { claimed: true, reason: "FALLBACK_NO_DB" };
  }

  try {
    const { data: existing, error: fetchErr } = await db
      .from("myfxbook_sync_claims")
      .select("*")
      .eq("pacific_date", pacificDateStr)
      .maybeSingle();

    if (fetchErr) {
      console.error("[Sync Claim] Error fetching claim record:", fetchErr.message);
    }

    const isMidnightWindow = windowType === "PRIMARY" || windowType === "BACKUP";

    // 1. Existing SUCCESS guard
    if (existing && existing.status === "SUCCESS") {
      if (isMidnightWindow) {
        if (existing.window_type === "PRIMARY" || existing.window_type === "BACKUP") {
          return {
            claimed: false,
            reason: windowType === "BACKUP" ? "BACKUP_SKIPPED_PRIMARY_SUCCEEDED" : "ALREADY_COMPLETED_FOR_DAY",
            existingClaim: existing
          };
        }
      } else {
        const lastCompletedMs = new Date(existing.completed_at || existing.updated_at || existing.claimed_at).getTime();
        if (Number.isFinite(lastCompletedMs) && (nowMs - lastCompletedMs) < cooldownMs) {
          return {
            claimed: false,
            reason: "INTRADAY_COOLDOWN_ACTIVE",
            nextEligibleInMs: cooldownMs - (nowMs - lastCompletedMs),
            existingClaim: existing
          };
        }
      }
    }

    // 2. If another instance currently holds an unexpired claim (< 10 minutes old), block
    if (existing && existing.status === "CLAIMED") {
      const claimAgeMs = nowMs - new Date(existing.claimed_at).getTime();
      if (claimAgeMs < 10 * 60 * 1000) {
        return {
          claimed: false,
          reason: "CONCURRENT_INSTANCE_CLAIMED",
          claimedBy: existing.claimed_by,
          existingClaim: existing
        };
      }
      // If lease is older than 10 minutes, the previous instance crashed/timed out; allow re-claim below.
    }

    // 3. If Primary failed earlier and this is a repeated Primary call, avoid spinning
    if (existing && existing.status === "FAILED" && windowType === "PRIMARY") {
      return {
        claimed: false,
        reason: "PRIMARY_ALREADY_FAILED_AWAITING_BACKUP",
        existingClaim: existing
      };
    }

    const now = new Date(nowMs).toISOString();

    if (!existing) {
      // Attempt atomic INSERT for new date
      const { data: inserted, error: insErr } = await db
        .from("myfxbook_sync_claims")
        .insert([{
          pacific_date: pacificDateStr,
          status: "CLAIMED",
          claimed_at: now,
          claimed_by: instanceId,
          window_type: windowType,
          attempts: 1,
          updated_at: now
        }])
        .select("*")
        .single();

      if (insErr) {
        // Unique constraint violation: another instance inserted simultaneously
        return {
          claimed: false,
          reason: "CONCURRENT_RACE_LOST",
          error: insErr.message
        };
      }
      return { claimed: true, claimRecord: inserted, wasPriorFailed: false, alreadyAlerted: false };
    } else {
      const wasPriorFailed = existing.status === "FAILED";
      const alreadyAlerted = String(existing.error_message || "").startsWith("[ALERTED]");
      const nextAttempts = wasPriorFailed ? ((existing.attempts || 1) + 1) : ((existing.attempts || 0) + 1);
      // Optimistic conditional UPDATE prevents duplicate intraday/retry scrapes under concurrency
      let query = db
        .from("myfxbook_sync_claims")
        .update({
          status: "CLAIMED",
          claimed_at: now,
          claimed_by: instanceId,
          window_type: windowType,
          attempts: nextAttempts,
          updated_at: now
        })
        .eq("pacific_date", pacificDateStr)
        .eq("status", existing.status);

      if (existing.updated_at) {
        query = query.eq("updated_at", existing.updated_at);
      }

      const { data: updated, error: updErr } = await query
        .select("*")
        .maybeSingle();

      if (updErr || !updated) {
        return {
          claimed: false,
          reason: updErr ? "UPDATE_FAILED" : "CONCURRENT_RACE_LOST",
          error: updErr?.message
        };
      }
      return { claimed: true, claimRecord: updated, wasPriorFailed, alreadyAlerted };
    }
  } catch (err) {
    console.error("[Sync Claim] Atomic claim exception:", err.message);
    return { claimed: false, reason: "EXCEPTION", error: err.message };
  }
}

/**
 * Finalizes an atomic daily sync success in both myfxbook_sync_claims and audit_runs.
 * Strict Freshness Rule: Refuses to mark SUCCESS on cached or invalid data.
 * 
 * @param {Object} params
 * @param {string} params.pacificDateStr
 * @param {'PRIMARY'|'BACKUP'} params.windowType
 * @param {Object} params.data - Returned result from getMyfxbookLive
 * @param {string} params.instanceId
 */
export async function finalizeDailySyncSuccess({
  pacificDateStr,
  windowType,
  data,
  instanceId,
  nowMs = Date.now(),
  db = supabase
}) {
  if (!db) return;

  // Strict Freshness Verification (Requirement 10)
  if (!data || !data.isLiveScraped) {
    throw new Error("Cannot finalize daily sync success: Data is not flagged as genuinely live scraped.");
  }
  const source = data.source || "";
  if (!source.includes("Scrape.do") && !source.includes("ZenRows")) {
    throw new Error(`Cannot finalize daily sync success: Invalid source "${source}". Must be genuine external scraper.`);
  }

  const now = new Date(nowMs).toISOString();
  const dataFingerprint = `${data.month}_${data.week}_${data.today}_${data.year}_${data.fetchedAt}`;
  const dataHash = crypto.createHash("sha256").update(dataFingerprint).digest("hex");

  // 1. Update atomic myfxbook_sync_claims table
  const { error: claimErr } = await db
    .from("myfxbook_sync_claims")
    .update({
      status: "SUCCESS",
      completed_at: now,
      window_type: windowType,
      source: data.source,
      error_message: null,
      metrics: {
        today: data.today,
        week: data.week,
        month: data.month,
        year: data.year,
        gain: data.gain,
        absGain: data.absGain,
        drawdown: data.drawdown,
        fetchedAt: data.fetchedAt
      },
      data_hash: dataHash,
      updated_at: now
    })
    .eq("pacific_date", pacificDateStr);

  if (claimErr) {
    console.error("[Sync Claim] Error updating claim to SUCCESS:", claimErr.message);
  }

  // 2. Record permanent entry in audit_runs (Requirement 9: Preserve historical evidence, never delete)
  const pt = getFundAccountingDate(nowMs);
  await db
    .from("audit_runs")
    .insert([{
      admin_id: "myfxbook_daily_sync",
      year: pt.year,
      month_number: pt.monthNumber,
      report_json: {
        type: "MYFXBOOK_DAILY_SYNC",
        pacificDate: pacificDateStr,
        window: windowType,
        status: "SUCCESS",
        claimedBy: instanceId,
        source: data.source,
        dataHash,
        metrics: data,
        completedAt: now
      }
    }]);
}

/**
 * Finalizes an atomic sync failure in both myfxbook_sync_claims and audit_runs.
 */
export async function finalizeDailySyncFailure({
  pacificDateStr,
  windowType,
  errorMessage,
  errors = [],
  instanceId = "system",
  alerted = false,
  nowMs = Date.now(),
  db = supabase
}) {
  if (!db) return;
  const now = new Date(nowMs).toISOString();
  const storedErrorMsg = alerted ? `[ALERTED] ${errorMessage}` : errorMessage;

  // 1. Update atomic myfxbook_sync_claims table
  await db
    .from("myfxbook_sync_claims")
    .update({
      status: "FAILED",
      completed_at: now,
      error_message: storedErrorMsg,
      updated_at: now
    })
    .eq("pacific_date", pacificDateStr);

  // 2. Record permanent entry in audit_runs (Requirement 9: Never physically delete production records)
  const pt = getFundAccountingDate(nowMs);
  await db
    .from("audit_runs")
    .insert([{
      admin_id: "myfxbook_daily_sync",
      year: pt.year,
      month_number: pt.monthNumber,
      report_json: {
        type: "MYFXBOOK_DAILY_SYNC",
        pacificDate: pacificDateStr,
        window: windowType,
        status: "FAILED",
        claimedBy: instanceId,
        errorMessage,
        errors,
        completedAt: now
      }
    }]);
}

/**
 * Local in-memory lock (process-level).
 */
export function acquireLocalSyncLock() {
  if (isLocalSyncActive) return false;
  isLocalSyncActive = true;
  return true;
}

export function releaseLocalSyncLock() {
  isLocalSyncActive = false;
}
