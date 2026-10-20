import { getMyfxbookLive } from "../../lib/myfxbook.js";
import { dispatchAdministratorAlert } from "../../lib/financial-alert-dispatcher.js";
import { 
  determineSyncWindow, 
  checkDailySyncCompleted, 
  recordDailySyncResult, 
  acquireSyncLock, 
  releaseSyncLock 
} from "../../lib/myfxbook-sync-manager.js";

/**
 * Vercel Cron Job entry point.
 * 
 * Scheduled Daily Midnight Ingestion (America/Los_Angeles):
 * - Primary Window: 12:30 AM Pacific daily
 * - Backup Window:  1:30 AM Pacific daily (executes ONLY if Primary failed or unrecorded)
 * 
 * Protects Scrape.do credits:
 * - Never scrapes hourly
 * - Prevents concurrent / overlapping executions via memory lock
 * - Uses durable daily success markers in Supabase
 * - Skips Backup if Primary succeeded (0 credits consumed on Backup)
 * - Strict daily limit of 1 successful scrape per calendar day
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

  // 2. Concurrency Protection: Prevent overlapping executions
  if (!acquireSyncLock()) {
    console.warn("[Cron] Overlapping sync request rejected: another synchronization is currently running.");
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
      releaseSyncLock();
      console.log(`[Cron] Sync skipped: Current Pacific time (${hour}:${String(minute).padStart(2, '0')}) is outside the 12:30 AM / 1:30 AM midnight window.`);
      return res.status(200).json({
        success: true,
        skipped: true,
        reason: "OUTSIDE_PACIFIC_MIDNIGHT_WINDOW",
        pacificDate: pacificDateStr,
        pacificTime: `${hour}:${String(minute).padStart(2, '0')}`
      });
    }

    // 4. Durable Daily Success Marker Check (Credit Protection)
    const { completed: alreadyCompleted, marker } = await checkDailySyncCompleted(pacificDateStr);

    if (alreadyCompleted && !isForced) {
      releaseSyncLock();
      console.log(`[Cron] Sync skipped for ${pacificDateStr} (${window} window): A valid fresh result was already recorded today. Preserving Scrape.do credits.`);
      return res.status(200).json({
        success: true,
        skipped: true,
        reason: window === "BACKUP" ? "BACKUP_SKIPPED_PRIMARY_SUCCEEDED" : "ALREADY_COMPLETED_FOR_DAY",
        pacificDate: pacificDateStr,
        window,
        existingMarker: marker
      });
    }

    if (window === "BACKUP") {
      console.log(`[Cron] Executing BACKUP sync for ${pacificDateStr} because primary sync was unrecorded or failed.`);
    } else {
      console.log(`[Cron] Executing PRIMARY sync for ${pacificDateStr} (Trigger: ${isVercelCron ? 'Vercel Scheduler' : 'Manual Header'})...`);
    }

    // 5. Execute Live Scrape Ingestion
    const data = await getMyfxbookLive();

    // 6. Fail-Closed Verification: Confirm live scraping succeeded
    if (!data.isLiveScraped) {
      const errorDetails = data.scrapeErrors?.length ? data.scrapeErrors.join("; ") : "No scraper succeeded (missing API tokens or scrape failure)";
      console.error(`[Cron] Myfxbook synchronization failed in ${window} window: ${errorDetails}`);

      // Record failure audit trail
      await recordDailySyncResult({
        pacificDateStr,
        windowType: window,
        status: "FAILED",
        provider: "Scrape.do",
        attempts: 1,
        errors: data.scrapeErrors || [errorDetails]
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
              <li><strong>Timestamp:</strong> ${new Date().toISOString()}</li>
              <li><strong>Error Diagnostics:</strong> ${errorDetails}</li>
              <li><strong>Action Required:</strong> Verify Scrape.do subscription credits and provider API connectivity.</li>
            </ul>`,
          severity: "P1",
          details: {
            account: "11915183",
            window,
            pacificDateStr,
            errors: data.scrapeErrors
          }
        }).catch(err => console.error("[Cron] Alert dispatch error:", err.message));
      }

      releaseSyncLock();
      return res.status(500).json({
        success: false,
        window,
        pacificDate: pacificDateStr,
        error: `Myfxbook live scraping failed: ${errorDetails}`,
        data
      });
    }

    // 7. Successful Ingestion: Record Durable Success Marker
    const auditId = await recordDailySyncResult({
      pacificDateStr,
      windowType: window,
      status: "SUCCESS",
      metrics: data,
      provider: data.source?.includes("ZenRows") ? "ZenRows" : "Scrape.do",
      attempts: 1
    });

    releaseSyncLock();

    console.log(`[Cron] ${window} sync successful for ${pacificDateStr}:`, JSON.stringify({
      today: data.today,
      week: data.week,
      month: data.month,
      year: data.year,
      source: data.source,
      auditId
    }));

    return res.status(200).json({ 
      success: true, 
      window,
      pacificDate: pacificDateStr,
      auditId,
      message: `Daily Myfxbook ${window} sync completed successfully`,
      data
    });
  } catch (error) {
    releaseSyncLock();
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
