import { verifyAdminSession } from "../../lib/adminAuth.js";
import { getMyfxbookLive } from "../../lib/myfxbook.js";
import { supabase } from "../../lib/supabase.js";

/**
 * Admin endpoint: Fetches live Myfxbook data in preview mode (no DB write).
 * Returns the fetched metrics alongside the current DB values so the admin
 * can compare before accepting.
 */
export default async function handler(req, res) {
  const session = verifyAdminSession(req);
  if (!session) return res.status(401).json({ error: "Unauthorized" });

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // 1. Fetch current DB values
    const { data: currentRows, error: dbErr } = await supabase
      .from("live_performance")
      .select("*");
    if (dbErr) throw dbErr;

    const current = {};
    (currentRows || []).forEach(row => {
      const key = row.metric;
      current[key] = { value_pct: row.value_pct, source: row.source, last_updated: row.last_updated };
    });

    // 2. Fetch live data from Myfxbook WITHOUT saving
    const preview = await getMyfxbookLive({ previewMode: true });

    return res.status(200).json({
      success: true,
      preview,
      current
    });
  } catch (err) {
    console.error("[Admin] Myfxbook preview failed:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
