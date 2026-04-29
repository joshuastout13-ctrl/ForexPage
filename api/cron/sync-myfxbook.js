import { getMyfxbookLive } from "../../lib/myfxbook.js";

/**
 * Vercel Cron Job entry point.
 * Triggers a live Myfxbook scrape and Supabase sync.
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
    // getMyfxbookLive() internally calls fetchZenRowsMetrics and updateLivePerformance
    const data = await getMyfxbookLive();

    console.log("[Cron] Sync successful:", JSON.stringify({
      today: data.today,
      week: data.week,
      month: data.month,
      year: data.year
    }));

    return res.status(200).json({ 
      success: true, 
      message: "Sync completed successfully",
      data
    });
  } catch (error) {
    console.error("[Cron] Sync failed:", error.message);
    return res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
}
