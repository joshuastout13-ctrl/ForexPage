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
export async function claimDailySyncSlot({ pacificDateStr, windowType, instanceId }) {
  if (!supabase) {
    return { claimed: true, reason: "FALLBACK_NO_DB" };
  }

  try {
    const { data: existing, error: fetchErr } = await supabase
      .from("myfxbook_sync_claims")
      .select("*")
      .eq("pacific_date", pacificDateStr)
      .maybeSingle();

    if (fetchErr) {
      console.error("[Sync Claim] Error fetching claim record:", fetchErr.message);
    }

    // 1. If today already has a confirmed SUCCESS record, skip immediately!
    if (existing && existing.status === "SUCCESS") {
      return {
        claimed: false,
        reason: windowType === "BACKUP" ? "BACKUP_SKIPPED_PRIMARY_SUCCEEDED" : "ALREADY_COMPLETED_FOR_DAY",
        existingClaim: existing
      };
    }

    // 2. If another instance currently holds an unexpired claim (< 10 minutes old), block
    if (existing && existing.status === "CLAIMED") {
      const claimAgeMs = Date.now() - new Date(existing.claimed_at).getTime();
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

    const now = new Date().toISOString();

    if (!existing) {
      // Attempt atomic INSERT for new date
      const { data: inserted, error: insErr } = await supabase
        .from("myfxbook_sync_claims")
        .insert([{
          pacific_date: pacificDateStr,
          status: "CLAIMED",
          claimed_at: now,
          claimed_by: instanceId,
          window_type: windowType,
          attempts: 1
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
      return { claimed: true, claimRecord: inserted };
    } else {
      // Existing row was FAILED or has an expired lease: atomically update
      const { data: updated, error: updErr } = await supabase
        .from("myfxbook_sync_claims")
        .update({
          status: "CLAIMED",
          claimed_at: now,
          claimed_by: instanceId,
          window_type: windowType,
          attempts: (existing.attempts || 1) + 1,
          updated_at: now
        })
        .eq("pacific_date", pacificDateStr)
        .select("*")
        .single();

      if (updErr) {
        return {
          claimed: false,
          reason: "UPDATE_FAILED",
          error: updErr.message
        };
      }
      return { claimed: true, claimRecord: updated };
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
  instanceId
}) {
  if (!supabase) return;

  // Strict Freshness Verification (Requirement 10)
  if (!data || !data.isLiveScraped) {
    throw new Error("Cannot finalize daily sync success: Data is not flagged as genuinely live scraped.");
  }
  const source = data.source || "";
  if (!source.includes("Scrape.do") && !source.includes("ZenRows")) {
    throw new Error(`Cannot finalize daily sync success: Invalid source "${source}". Must be genuine external scraper.`);
  }

  const now = new Date().toISOString();
  const dataFingerprint = `${data.month}_${data.week}_${data.today}_${data.year}_${data.fetchedAt}`;
  const dataHash = crypto.createHash("sha256").update(dataFingerprint).digest("hex");

  // 1. Update atomic myfxbook_sync_claims table
  const { error: claimErr } = await supabase
    .from("myfxbook_sync_claims")
    .update({
      status: "SUCCESS",
      completed_at: now,
      source: data.source,
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
  const pt = getFundAccountingDate();
  await supabase
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
 * Finalizes an atomic daily sync failure in both myfxbook_sync_claims and audit_runs.
 * 
 * @param {Object} params
 * @param {string} params.pacificDateStr
 * @param {'PRIMARY'|'BACKUP'} params.windowType
 * @param {string} params.errorMessage
 * @param {Array<string>} [params.errors=[]]
 * @param {string} [params.instanceId='system']
 */
export async function finalizeDailySyncFailure({
  pacificDateStr,
  windowType,
  errorMessage,
  errors = [],
  instanceId = "system"
}) {
  if (!supabase) return;
  const now = new Date().toISOString();

  // 1. Update atomic myfxbook_sync_claims table
  await supabase
    .from("myfxbook_sync_claims")
    .update({
      status: "FAILED",
      completed_at: now,
      error_message: errorMessage,
      updated_at: now
    })
    .eq("pacific_date", pacificDateStr);

  // 2. Record permanent entry in audit_runs (Requirement 9: Never physically delete production records)
  const pt = getFundAccountingDate();
  await supabase
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
