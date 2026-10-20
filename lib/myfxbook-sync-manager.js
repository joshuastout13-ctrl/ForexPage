import { getFundAccountingDate, FUND_ACCOUNTING_TIMEZONE } from "./month-state.js";
import { supabase } from "./supabase.js";

/**
 * In-memory concurrency lock to prevent overlapping scrape executions.
 */
let isSyncActive = false;

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

/**
 * Checks durable in-database markers to determine if a successful scrape has
 * ALREADY been recorded for the given Pacific calendar day.
 * 
 * Checks both:
 * 1. audit_runs table (admin_id = 'myfxbook_daily_sync' and status = 'SUCCESS')
 * 2. live_performance table (last_updated matches today's Pacific date)
 * 
 * @param {string} pacificDateStr - 'YYYY-MM-DD'
 * @returns {Promise<{ completed: boolean, marker: Object|null }>}
 */
export async function checkDailySyncCompleted(pacificDateStr) {
  if (!supabase) {
    return { completed: false, marker: null };
  }

  try {
    // 1. Check audit_runs table
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

    // 2. Cross-check live_performance table
    const { data: liveData, error: liveErr } = await supabase
      .from("live_performance")
      .select("metric, value_pct, source, last_updated")
      .limit(4);

    if (!liveErr && liveData && liveData.length > 0) {
      const sample = liveData.find(d => d.last_updated && d.source && String(d.source).includes("Scrape.do"));
      if (sample?.last_updated) {
        const lastUpdatedPtDate = getPacificDateString(sample.last_updated);
        if (lastUpdatedPtDate === pacificDateStr) {
          return { completed: true, marker: { source: sample.source, last_updated: sample.last_updated, liveTableMatch: true } };
        }
      }
    }
  } catch (err) {
    console.warn("[Sync Manager] Error reading daily sync marker:", err.message);
  }

  return { completed: false, marker: null };
}

/**
 * Records a durable audit record of a daily sync outcome (SUCCESS or FAILED)
 * into the audit_runs table.
 * 
 * @param {Object} params
 * @param {string} params.pacificDateStr
 * @param {'PRIMARY'|'BACKUP'} params.windowType
 * @param {'SUCCESS'|'FAILED'} params.status
 * @param {Object} [params.metrics=null]
 * @param {string} [params.provider='Scrape.do']
 * @param {number} [params.attempts=1]
 * @param {Array<string>} [params.errors=[]]
 * @returns {Promise<string|null>} Audit record ID
 */
export async function recordDailySyncResult({
  pacificDateStr,
  windowType,
  status,
  metrics = null,
  provider = "Scrape.do",
  attempts = 1,
  errors = []
}) {
  if (!supabase) return null;

  try {
    const pt = getFundAccountingDate();
    const payload = {
      type: "MYFXBOOK_DAILY_SYNC",
      pacificDate: pacificDateStr,
      window: windowType,
      status,
      metrics: metrics ? {
        today: metrics.today,
        week: metrics.week,
        month: metrics.month,
        year: metrics.year,
        source: metrics.source
      } : null,
      provider,
      attempts,
      errors,
      recordedAt: new Date().toISOString()
    };

    const { data, error } = await supabase
      .from("audit_runs")
      .insert([{
        admin_id: "myfxbook_daily_sync",
        year: pt.year,
        month_number: pt.monthNumber,
        report_json: payload
      }])
      .select("id");

    if (error) {
      console.error("[Sync Manager] Error recording daily sync result:", error.message);
      return null;
    }
    return data?.[0]?.id || null;
  } catch (err) {
    console.error("[Sync Manager] Exception recording sync result:", err.message);
    return null;
  }
}

/**
 * Attempts to acquire the in-memory concurrency lock.
 * @returns {boolean} True if lock acquired, false if already busy.
 */
export function acquireSyncLock() {
  if (isSyncActive) return false;
  isSyncActive = true;
  return true;
}

/**
 * Releases the in-memory concurrency lock.
 */
export function releaseSyncLock() {
  isSyncActive = false;
}
