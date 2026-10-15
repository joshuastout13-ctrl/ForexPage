import { sendEmail } from "./email.js";
import { supabase } from "./supabase.js";

/**
 * Dispatches an immediate administrator alert for financial discrepancies or scheduler failures.
 * 
 * Supports:
 * 1. Resend Email Delivery (when RESEND_API_KEY is configured)
 * 2. Webhook Notification (when ADMIN_ALERT_WEBHOOK_URL is configured)
 * 3. Immutable In-Database Audit Logging (admin_email_logs table)
 * 
 * @param {Object} params
 * @param {string} params.subject Alert subject line
 * @param {string} params.body Alert body (HTML or markdown-like text)
 * @param {'P0' | 'P1' | 'P2'} [params.severity='P0'] Severity tier
 * @param {Object} [params.details=null] Supporting diagnostic data / report payload
 * @param {boolean} [params.isTest=false] Whether this is a test alert
 * @returns {Promise<{ delivered: boolean, emailSent: boolean, loggedToDb: boolean, logId: string|null, error: string|null }>}
 */
export async function dispatchAdministratorAlert({
  subject,
  body,
  severity = "P0",
  details = null,
  isTest = false
}) {
  const recipientEmail = process.env.ADMIN_ALERT_EMAIL || "joshua.stout13@gmail.com";
  const recipients = [recipientEmail];
  let emailSent = false;
  let emailError = null;
  let webhookSent = false;
  let webhookError = null;
  let logId = null;

  // 1. Channel 1: Resend Email
  if (process.env.RESEND_API_KEY) {
    try {
      const emailResult = await sendEmail({
        recipients,
        subject: subject.trim(),
        body: body.trim()
      });
      emailSent = emailResult.success;
      if (!emailResult.success && emailResult.errors?.length > 0) {
        emailError = JSON.stringify(emailResult.errors);
      }
    } catch (err) {
      emailError = err.message;
      console.error("[Alert Dispatcher] Failed to send email alert via Resend:", err.message);
    }
  } else {
    emailError = "RESEND_API_KEY is not configured in server environment variables.";
    console.warn("[Alert Dispatcher] Resend API key missing; skipping email dispatch.");
  }

  // 2. Channel 2: Webhook (if configured)
  const webhookUrl = process.env.ADMIN_ALERT_WEBHOOK_URL;
  if (webhookUrl) {
    try {
      const webhookPayload = {
        timestamp: new Date().toISOString(),
        severity,
        subject,
        body,
        details
      };
      const wRes = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(webhookPayload)
      });
      webhookSent = wRes.ok;
      if (!wRes.ok) {
        webhookError = `HTTP ${wRes.status}: ${await wRes.text()}`;
      }
    } catch (err) {
      webhookError = err.message;
      console.error("[Alert Dispatcher] Webhook alert failed:", err.message);
    }
  }

  // 3. Channel 3: Authoritative Database Logging (admin_email_logs)
  let loggedToDb = false;
  if (supabase) {
    try {
      const logPayload = {
        subject: subject.trim(),
        body: body.trim(),
        recipient_count: recipients.length,
        recipient_emails: recipients,
        status: emailSent || webhookSent ? "success" : (isTest ? "test_logged" : "alert_logged_no_smtp"),
        sent_by: "system_daily_reconciler",
        is_test: isTest,
        error_message: emailError || webhookError || null,
        details: {
          severity,
          emailSent,
          webhookSent,
          emailError,
          webhookError,
          diagnostics: details
        }
      };

      const { data: logData, error: logErr } = await supabase
        .from("admin_email_logs")
        .insert([logPayload])
        .select("id");

      if (logErr) {
        console.error("[Alert Dispatcher] Failed to insert alert to admin_email_logs:", logErr.message);
      } else if (logData && logData[0]) {
        logId = logData[0].id;
        loggedToDb = true;
      }
    } catch (dbErr) {
      console.error("[Alert Dispatcher] Error during database alert logging:", dbErr.message);
    }
  }

  return {
    delivered: emailSent || webhookSent,
    emailSent,
    webhookSent,
    loggedToDb,
    logId,
    recipientEmail,
    error: emailError || webhookError || null
  };
}
