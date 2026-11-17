import { getMyfxbookLive } from "../../lib/myfxbook.js";
import { dispatchAdministratorAlert } from "../../lib/financial-alert-dispatcher.js";
import {
  determineSyncExecutionPlan,
  claimSyncSlot,
  finalizeDailySyncSuccess,
  finalizeDailySyncFailure,
  acquireLocalSyncLock,
  releaseLocalSyncLock
} from "../../lib/myfxbook-sync-manager.js";

/**
 * Vercel Cron Job entry point.
 *
 * Scheduled Automatic Ingestion (America/Los_Angeles):
 * - Primary Midnight Window: 12:30 AM Pacific daily
 * - Backup Midnight Window:  1:30 AM Pacific daily (if Primary failed/unrecorded)
 * - Intraday Market Hours:   Hourly refresh during active trading (Sun 14:00 PT - Fri 17:00 PT),
 *                            protected by cooldown & atomic DB claim locking to avoid duplicate scrapes.
 */
export default async function handler(req, res, deps = {}) {
  const getLive = deps.getMyfxbookLive || getMyfxbookLive;
  const claimSlot = deps.claimSyncSlot || deps.claimDailySyncSlot || claimSyncSlot;
  const finalizeSuccess = deps.finalizeDailySyncSuccess || finalizeDailySyncSuccess;
  const finalizeFailure = deps.finalizeDailySyncFailure || finalizeDailySyncFailure;
  const alertDispatcher = deps.dispatchAdministratorAlert || dispatchAdministratorAlert;

  // 1. Verify Authorization (Vercel Cron security)
  const authHeader = req.headers.authorization;
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  const isAuthorized = isVercelCron || (authHeader && authHeader === `Bearer ${process.env.CRON_SECRET}`);

  if (!isAuthorized) {
    console.warn("[Cron] Unauthorized access attempt blocked. Header missing or secret mismatch.");
    return res.status(401).json({ error: "Unauthorized" });
  }

  // 2. Process-Level Concurrency Protection
  if (!acquireLocalSyncLock()) {
    console.warn("[Cron] Overlapping sync request rejected: another synchronization is currently running in this process.");
    return res.status(429).json({
      success: false,
      skipped: true,
      reason: "CONCURRENT_SYNC_IN_PROGRESS"
    });
  }

  try {
    // Dependency-injected clock only; ignore HTTP query/body simulatedDate/asOfDate/force overrides.
    const clockInput = deps.simulatedDate ?? deps.asOfDate ?? null;
    const simulatedDate = clockInput ? new Date(clockInput) : new Date();
    if (isNaN(simulatedDate.getTime())) {
      releaseLocalSyncLock();
      return res.status(400).json({ error: "INVALID_DATE", message: "Invalid injected simulation clock." });
    }
    const nowMs = simulatedDate.getTime();

    // 3. Pacific Time Window & Market Hours Check
    const { window, mode, pacificDateStr, hour, minute, shouldSync, reason } = determineSyncExecutionPlan(simulatedDate);

    if (!shouldSync) {
      releaseLocalSyncLock();
      console.log(`[Cron] Sync skipped (${hour}:${String(minute).padStart(2, '0')} PT): ${reason}.`);
      return res.status(200).json({
        success: true,
        skipped: true,
        reason,
        pacificDate: pacificDateStr,
        pacificTime: `${hour}:${String(minute).padStart(2, '0')}`
      });
    }

    // 4. Atomic Database-Level Claim (Cross-Instance Concurrency & Credit Protection)
    const instanceId = req.headers['x-vercel-id'] || `inst_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const claimResult = await claimSlot({
      pacificDateStr,
      windowType: mode,
      instanceId,
      cooldownMs: deps.cooldownMs,
      nowMs,
      db: deps.supabase
    });

    if (!claimResult.claimed) {
      releaseLocalSyncLock();
      console.log(`[Cron] Sync skipped for ${pacificDateStr} (${mode} window): ${claimResult.reason}.`);
      return res.status(200).json({
        success: true,
        skipped: true,
        reason: claimResult.reason,
        pacificDate: pacificDateStr,
        window: mode,
        existingClaim: claimResult.existingClaim
      });
    }

    console.log(`[Cron] Executing ${mode} Myfxbook sync for ${pacificDateStr} under instance ${instanceId}...`);

    // 5. Execute Live Scrape Ingestion
    const data = await getLive({ preserveMissing: mode === "INTRADAY" });

    // 6. Fail-Closed Verification: Confirm live scraping succeeded with genuine fresh data
    if (!data.isLiveScraped) {
      const errorDetails = data.scrapeErrors?.length ? data.scrapeErrors.join("; ") : "No scraper succeeded (missing API tokens or scrape failure)";
      console.error(`[Cron] Myfxbook synchronization failed in ${mode} window: ${errorDetails}`);

      // Notify administrator ONLY on actionable error streaks:
      // - Exhausted midnight BACKUP window, OR
      // - Consecutive intraday failure (once per outage streak without hourly spam)
      const isRepeatedIntradayError =
        mode === "INTRADAY" &&
        claimResult.wasPriorFailed &&
        !claimResult.alreadyAlerted;
      const shouldDispatchAlert = mode === "BACKUP" || isRepeatedIntradayError;

      // Record failure in myfxbook_sync_claims and audit_runs
      await finalizeFailure({
        pacificDateStr,
        windowType: mode,
        errorMessage: errorDetails,
        errors: data.scrapeErrors || [errorDetails],
        instanceId,
        alerted: Boolean(shouldDispatchAlert || claimResult.alreadyAlerted),
        nowMs,
        db: deps.supabase
      });

      if (shouldDispatchAlert) {
        const alertSubject = mode === "BACKUP"
          ? `[ALERT] 4XTrack Daily Myfxbook Sync Failed (Primary & Backup Exhausted)`
          : `[ALERT] 4XTrack Automatic Myfxbook Sync Error (Consecutive Intraday Failure)`;
        await alertDispatcher({
          subject: alertSubject,
          body: `<h3>Myfxbook Automatic Synchronization Alert</h3>
            <p>Myfxbook automatic synchronization encountered repeated errors in window <strong>${mode}</strong> for ${pacificDateStr}.</p>
            <ul>
              <li><strong>Account:</strong> Stone and Company (ID 11915183)</li>
              <li><strong>Window:</strong> ${mode}</li>
              <li><strong>Instance:</strong> ${instanceId}</li>
              <li><strong>Timestamp:</strong> ${new Date(nowMs).toISOString()}</li>
              <li><strong>Error Diagnostics:</strong> ${errorDetails}</li>
              <li><strong>Action Required:</strong> Verify Scrape.do subscription credits and provider API connectivity, or manually override in Admin -> Live Performance.</li>
            </ul>`,
          severity: "P1",
          details: {
            account: "11915183",
            window: mode,
            pacificDateStr,
            instanceId,
            errors: data.scrapeErrors
          }
        }).catch(err => console.error("[Cron] Alert dispatch error:", err.message));
      }

      releaseLocalSyncLock();
      return res.status(500).json({
        success: false,
        window: mode,
        pacificDate: pacificDateStr,
        error: `Myfxbook live scraping failed: ${errorDetails}`,
        data
      });
    }

    // 7. Successful Ingestion: Record Atomic Database Claim Completion & Historical Audit
    await finalizeSuccess({
      pacificDateStr,
      windowType: mode,
      data,
      instanceId,
      nowMs,
      db: deps.supabase
    });

    releaseLocalSyncLock();

    console.log(`[Cron] ${mode} sync successful for ${pacificDateStr}:`, JSON.stringify({
      today: data.today,
      week: data.week,
      month: data.month,
      year: data.year,
      source: data.source,
      instanceId
    }));

    return res.status(200).json({
      success: true,
      window: mode,
      pacificDate: pacificDateStr,
      instanceId,
      message: `Myfxbook ${mode} sync completed successfully with fresh live data`,
      data
    });
  } catch (error) {
    releaseLocalSyncLock();
    console.error("[Cron] Sync fatal error:", error.message);

    await alertDispatcher({
      subject: `[CRITICAL] 4XTrack Daily Myfxbook Sync Fatal Error`,
      body: `<h3>Daily Myfxbook Synchronization Fatal Error</h3>
        <p>An unexpected fatal exception occurred during daily Myfxbook synchronization:</p>
        <p><strong>Error:</strong> ${error.message}</p>
        <p><strong>Timestamp:</strong> ${new Date().toISOString()}</p>`,
      severity: "P0",
      details: { error: error.message, stack: error.stack }
    }).catch(err => console.error("[Cron] Alert dispatch error:", err.message));

    return res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
}
