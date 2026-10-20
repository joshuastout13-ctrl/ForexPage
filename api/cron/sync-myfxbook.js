import { getMyfxbookLive } from "../../lib/myfxbook.js";
import { dispatchAdministratorAlert } from "../../lib/financial-alert-dispatcher.js";

/**
 * Vercel Cron Job entry point.
 * Triggers an hourly live Myfxbook scrape and Supabase sync.
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

  console.log(`[Cron] Starting scheduled Myfxbook sync (Trigger: ${isVercelCron ? 'Vercel Scheduler' : 'Manual Header'})...`);

  try {
    // 2. Trigger the sync logic
    const data = await getMyfxbookLive();

    // 3. Fail-Closed Verification: Confirm live scraping succeeded rather than silently serving stale data
    if (!data.isLiveScraped) {
      const errorDetails = data.scrapeErrors?.length ? data.scrapeErrors.join("; ") : "No scraper succeeded (missing API tokens or scrape failure)";
      console.error(`[Cron] Myfxbook synchronization failed to fetch fresh data: ${errorDetails}`);

      // Dispatch immediate administrator alert (Email + DB audit log)
      await dispatchAdministratorAlert({
        subject: `[ALERT] 4XTrack Myfxbook Live Feed Synchronization Failure`,
        body: `<h3>Myfxbook Live Synchronization Alert</h3>
          <p>The scheduled Myfxbook live data ingestion failed to retrieve fresh performance data from Stone and Company's account.</p>
          <ul>
            <li><strong>Account:</strong> Stone and Company (ID 11915183)</li>
            <li><strong>Trigger:</strong> ${isVercelCron ? 'Vercel Scheduler' : 'Manual / API'}</li>
            <li><strong>Timestamp:</strong> ${new Date().toISOString()}</li>
            <li><strong>Root Cause:</strong> ${errorDetails}</li>
            <li><strong>Fallback State:</strong> Serving cached/stored metrics (Month: ${data.month || 'N/A'})</li>
          </ul>`,
        severity: "P1",
        details: {
          account: "11915183",
          errors: data.scrapeErrors,
          lastData: data
        }
      }).catch(err => console.error("[Cron] Alert dispatch error:", err.message));

      return res.status(500).json({
        success: false,
        error: `Myfxbook live scraping failed: ${errorDetails}`,
        data
      });
    }

    console.log("[Cron] Sync successful:", JSON.stringify({
      today: data.today,
      week: data.week,
      month: data.month,
      year: data.year,
      source: data.source
    }));

    return res.status(200).json({ 
      success: true, 
      message: "Sync completed successfully",
      data
    });
  } catch (error) {
    console.error("[Cron] Sync fatal error:", error.message);

    await dispatchAdministratorAlert({
      subject: `[CRITICAL] 4XTrack Myfxbook Synchronization Fatal Error`,
      body: `<h3>Myfxbook Live Synchronization Fatal Error</h3>
        <p>An unexpected fatal exception occurred during Myfxbook synchronization:</p>
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
