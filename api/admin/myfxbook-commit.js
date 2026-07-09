import { verifyAdminSession } from "../../lib/adminAuth.js";
import { supabase } from "../../lib/supabase.js";

/**
 * Admin endpoint: Commits the admin-approved Myfxbook metrics to the
 * live_performance table. Called after the admin clicks "Accept" on
 * the preview modal.
 *
 * Body: { today, week, month, year }  (percentage strings like "+0.37%")
 */
export default async function handler(req, res) {
  const session = verifyAdminSession(req);
  if (!session) return res.status(401).json({ error: "Unauthorized" });

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { today, week, month, year } = req.body || {};

    const mapping = [
      { key: "today", metric: "Today", value: today },
      { key: "week",  metric: "This Week", value: week },
      { key: "month", metric: "This Month", value: month },
      { key: "year",  metric: "This Year", value: year }
    ];

    const updates = mapping.map(m => {
      const cleanVal = String(m.value || "0.00%").replace(/[+%\s]/g, "");
      return {
        metric: m.metric,
        value_pct: cleanVal,
        source: "Myfxbook (Admin Approved)",
        last_updated: new Date().toISOString(),
        is_override: false
      };
    });

    const { error } = await supabase
      .from("live_performance")
      .upsert(updates, { onConflict: "metric" });

    if (error) throw error;

    console.log(`[Admin] Committed ${updates.length} Myfxbook metrics approved by ${session.name || "admin"}`);
    return res.status(200).json({ success: true, updatedCount: updates.length });
  } catch (err) {
    console.error("[Admin] Myfxbook commit failed:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
