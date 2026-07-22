import { verifyAdminSession } from "../../../lib/adminAuth.js";
import { sendEmail } from "../../../lib/email.js";
import { supabase } from "../../../lib/supabase.js";

export default async function handler(req, res) {
  const session = verifyAdminSession(req);
  if (!session) {
    return res.status(401).json({ error: "Unauthorized access" });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { recipients, subject, body, isTest } = req.body || {};

    if (!subject || !subject.trim()) {
      return res.status(400).json({ error: "Email subject line is required." });
    }

    if (!body || !body.trim()) {
      return res.status(400).json({ error: "Email message body is required." });
    }

    if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({ error: "At least one recipient email address must be selected." });
    }

    // Clean and validate email list
    const validRecipients = recipients
      .map(e => (e || "").trim().toLowerCase())
      .filter(e => e && e.includes("@"));

    if (validRecipients.length === 0) {
      return res.status(400).json({ error: "No valid email addresses provided." });
    }

    console.log(`[Admin Email] Admin (${session.username || session.adminId}) sending email to ${validRecipients.length} recipients. Subject: "${subject.trim()}"`);

    // Call Resend email sender
    const result = await sendEmail({
      recipients: validRecipients,
      subject: subject.trim(),
      body: body.trim()
    });

    // Log send results to Supabase admin_email_logs table
    let logId = null;
    if (supabase) {
      try {
        const logPayload = {
          subject: subject.trim(),
          body: body.trim(),
          recipient_count: validRecipients.length,
          recipient_emails: validRecipients,
          status: result.success ? "success" : (result.sentCount > 0 ? "partial" : "failed"),
          sent_by: session.username || session.adminId || "admin",
          is_test: !!isTest,
          error_message: result.errors && result.errors.length > 0 ? JSON.stringify(result.errors) : null,
          details: result.results || null
        };

        const { data: logData, error: logError } = await supabase
          .from("admin_email_logs")
          .insert([logPayload])
          .select("id");

        if (logError) {
          console.warn("[Admin Email] Failed to record in admin_email_logs table:", logError.message);
        } else if (logData && logData[0]) {
          logId = logData[0].id;
        }
      } catch (logErr) {
        console.warn("[Admin Email] Error logging send outcome to Supabase:", logErr.message);
      }
    }

    return res.status(200).json({
      success: result.success,
      sentCount: result.sentCount,
      failedCount: result.failedCount,
      totalCount: result.totalCount,
      isTest: !!isTest,
      logId,
      errors: result.errors || []
    });
  } catch (err) {
    console.error("Error in /api/admin/send-email:", err);
    return res.status(500).json({ error: err.message || "Failed to send email broadcast" });
  }
}
