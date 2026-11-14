import { verifyAdminSession } from "../../../../lib/adminAuth.js";
import { supabase } from "../../../../lib/supabase.js";
import { executeCommissionShareLifecycleAction } from "../../../../lib/commission-share-validation.js";

export default async function handler(req, res) {
  try {
    const session = verifyAdminSession(req);
    if (!session) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { id, action } = req.query;

    if (req.method === "POST" && (action === "deactivate" || action === "reactivate")) {
      const effectiveEndDate = req.body?.effectiveEndDate || req.body?.effective_end_date || null;
      const data = await executeCommissionShareLifecycleAction(supabase, {
        id,
        action,
        effectiveEndDate
      });
      return res.status(200).json({ share: data });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    console.error("[Admin Commission Shares [action] API]", error);
    const statusCode = error?.status || (String(error?.message || "").includes("PERIOD_LOCKED") ? 409 : 500);
    res.status(statusCode).json({ error: error.message || "Internal server error", code: error?.code });
  }
}
