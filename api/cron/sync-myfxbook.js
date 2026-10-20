import { getMyfxbookLive } from "../../lib/myfxbook.js";
import { dispatchAdministratorAlert } from "../../lib/financial-alert-dispatcher.js";
import { 
  determineSyncWindow, 
  claimDailySyncSlot,
  finalizeDailySyncSuccess,
  finalizeDailySyncFailure,
  acquireLocalSyncLock, 
  releaseLocalSyncLock 
} from "../../lib/myfxbook-sync-manager.js";

/**
 * Vercel Cron Job entry point.
 * 
 * Scheduled Daily Midnight Ingestion (America/Los_Angeles):
 * - Primary Window: 12:30 AM Pacific daily
 * - Backup Window:  1:30 AM Pacific daily (executes ONLY if Primary failed or unrecorded)
 * 
 * Multi-Tier Concurrency & Scrape.do Credit Protection:
 * 1. Process-level in-memory lock (prevents overlapping in same container)
 * 2. Atomic Database-Level Daily Claim (prevents duplicate scraping across distinct Vercel lambda instances)
 * 3. Durable Daily Success Marker in PostgreSQL (skips Backup if Primary succeeded; 0 credits consumed on Backup)
 * 4. Strict Freshness Validation (refuses to mark SUCCESS on cached or invalid data)
 * 5. Permanent Audit Records (historical monitoring evidence preserved immutably)
 */
export default async function handler(req, res) {
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
    const isForced = req.query?.force === "true";
    const simulatedDate = req.query?.simulatedDate ? new Date(req.query.simulatedDate) : new Date();

    // 3. Timezone Window Verification (America/Los_Angeles)
    const { window, pacificDateStr, hour, minute } = determineSyncWindow(simulatedDate);

    // If outside 12:30 AM / 1:30 AM Pacific window and not forced, safely exit
    if (window === "OUTSIDE_WINDOW" && !isForced) {
      releaseLocalSyncLock();
      console.log(`[Cron] Sync skipped: Current Pacific time (${hour}:${String(minute).padStart(2, '0')}) is outside the 12:30 AM / 1:30 AM midnight window.`);
      return res.status(200).json({
        success: true,
        skipped: true,
        reason: "OUTSIDE_PACIFIC_MIDNIGHT_WINDOW",
        pacificDate: pacificDateStr,
        pacificTime: `${hour}:${String(minute).padStart(2, '0')}`
      });
    }

    // 4. Atomic Database-Level Daily Claim (Cross-Instance Concurrency & Credit Protection)
    const instanceId = req.headers['x-vercel-id'] || `inst_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const claimResult = await claimDailySyncSlot({ pacificDateStr, windowType: window, instanceId });

    if (!claimResult.claimed && !isForced) {
      releaseLocalSyncLock();
      console.log(`[Cron] Sync skipped for ${pacificDateStr} (${window} window): Atomic DB claim rejected: ${claimResult.reason}. Preserving Scrape.do credits.`);
      return res.status(200).json({
        success: true,
        skipped: true,
        reason: claimResult.reason,
        pacificDate: pacificDateStr,
        window,
        existingClaim: claimResult.existingClaim
      });
    }

    if (window === "BACKUP") {
      console.log(`[Cron] Executing BACKUP sync for ${pacificDateStr} under instance ${instanceId}...`);
    } else {
      console.log(`[Cron] Executing PRIMARY sync for ${pacificDateStr} under instance ${instanceId}...`);
    }

    // 5. Execute Live Scrape Ingestion
    const data = await getMyfxbookLive();

    // 6. Fail-Closed Verification: Confirm live scraping succeeded with genuine fresh data
    if (!data.isLiveScraped) {
      const errorDetails = data.scrapeErrors?.length ? data.scrapeErrors.join("; ") : "No scraper succeeded (missing API tokens or scrape failure)";
      console.error(`[Cron] Myfxbook synchronization failed in ${window} window: ${errorDetails}`);

      // Atomically record failure in myfxbook_sync_claims and audit_runs
      await finalizeDailySyncFailure({
        pacificDateStr,
        windowType: window,
        errorMessage: errorDetails,
        errors: data.scrapeErrors || [errorDetails],
        instanceId
      });

      // Dispatch administrator alert if BACKUP failed (both windows exhausted) or if forced
      if (window === "BACKUP" || isForced) {
        await dispatchAdministratorAlert({
          subject: `[ALERT] 4XTrack Daily Myfxbook Sync Failed (Primary & Backup Exhausted)`,
          body: `<h3>Daily Myfxbook Synchronization Alert</h3>
            <p>Both Primary (12:30 AM) and Backup (1:30 AM) Pacific synchronizations failed to capture daily Myfxbook trading data for ${pacificDateStr}.</p>
            <ul>
              <li><strong>Account:</strong> Stone and Company (ID 11915183)</li>
              <li><strong>Window:</strong> ${window}</li>
              <li><strong>Instance:</strong> ${instanceId}</li>
              <li><strong>Timestamp:</strong> ${new Date().toISOString()}</li>
              <li><strong>Error Diagnostics:</strong> ${errorDetails}</li>
              <li><strong>Action Required:</strong> Verify Scrape.do subscription credits and provider API connectivity.</li>
            </ul>`,
          severity: "P1",
          details: {
            account: "11915183",
            window,
            pacificDateStr,
            instanceId,
            errors: data.scrapeErrors
          }
        }).catch(err => console.error("[Cron] Alert dispatch error:", err.message));
      }

      releaseLocalSyncLock();
      return res.status(500).json({
        success: false,
        window,
        pacificDate: pacificDateStr,
        error: `Myfxbook live scraping failed: ${errorDetails}`,
        data
      });
    }

    // 7. Successful Ingestion: Record Atomic Database Claim Completion & Historical Audit
    await finalizeDailySyncSuccess({
      pacificDateStr,
      windowType: window,
      data,
      instanceId
    });

    releaseLocalSyncLock();

    console.log(`[Cron] ${window} sync successful for ${pacificDateStr}:`, JSON.stringify({
      today: data.today,
      week: data.week,
      month: data.month,
      year: data.year,
      source: data.source,
      instanceId
    }));

    return res.status(200).json({ 
      success: true, 
      window,
      pacificDate: pacificDateStr,
      instanceId,
      message: `Daily Myfxbook ${window} sync completed successfully with fresh live data`,
      data
    });
  } catch (error) {
    releaseLocalSyncLock();
    console.error("[Cron] Sync fatal error:", error.message);

    await dispatchAdministratorAlert({
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
