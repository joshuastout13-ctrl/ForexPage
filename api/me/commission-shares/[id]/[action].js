import { parseCookies, verifySession } from "../../../../../lib/auth.js";
import { supabase } from "../../../../../lib/supabase.js";

export default async function handler(req, res) {
  try {
    const cookies = parseCookies(req);
    const session = verifySession(cookies.scff_session);

    if (!session?.investorId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const { investorId } = session;
    const { id, action } = req.query;

    if (req.method === "POST" && action === "end") {
      return res.status(403).json({
        error: "ADMIN_APPROVAL_REQUIRED: Self-service termination of commission shares is disabled. Contact fund administration.",
        code: "ADMIN_APPROVAL_REQUIRED"
      });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    console.error("[Commission Shares [id] API]", error);
    res.status(500).json({ error: error.message || "Internal server error" });
  }
}
