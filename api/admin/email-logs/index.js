import { verifyAdminSession } from "../../../lib/adminAuth.js";
import { supabase } from "../../../lib/supabase.js";

export default async function handler(req, res) {
  const session = verifyAdminSession(req);
  if (!session) {
    return res.status(401).json({ error: "Unauthorized access" });
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    if (!supabase) {
      return res.status(200).json({ success: true, logs: [] });
    }

    const { data: logs, error } = await supabase
      .from("admin_email_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      if (error.code === "42P01") {
        // Table admin_email_logs does not exist yet in Supabase
        return res.status(200).json({ success: true, logs: [], notice: "admin_email_logs table not created yet" });
      }
      throw error;
    }

    return res.status(200).json({
      success: true,
      count: (logs || []).length,
      logs: logs || []
    });
  } catch (err) {
    console.error("Error in /api/admin/email-logs:", err);
    return res.status(500).json({ error: err.message || "Failed to fetch email logs" });
  }
}
