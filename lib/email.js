import { Resend } from "resend";
import dotenv from "dotenv";

if (process.env.NODE_ENV !== "production") {
  dotenv.config({ path: ".env.local" });
}

const apiKey = process.env.RESEND_API_KEY;
const resend = apiKey ? new Resend(apiKey) : null;

/**
 * Wraps content in a professional HTML email template formatted for Stone & Company Forex Fund.
 */
export function generateEmailHtml({ subject, body }) {
  // Convert plain text newlines to <br> if body doesn't already contain HTML tags
  const formattedBody = /<[a-z][\s\S]*>/i.test(body)
    ? body
    : body.split("\n").join("<br/>");

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(subject || "Stone & Company Forex Fund Update")}</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      background-color: #08101d;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      color: #e7eefb;
      -webkit-font-smoothing: antialiased;
    }
    .wrapper {
      width: 100%;
      background-color: #08101d;
      padding: 36px 12px;
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
      background: #0f172a;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 16px;
      overflow: hidden;
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4);
    }
    .header {
      background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
      padding: 28px 32px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      text-align: left;
    }
    .badge {
      display: inline-block;
      padding: 4px 10px;
      border-radius: 999px;
      background: rgba(79, 140, 255, 0.15);
      color: #7fb3ff;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      border: 1px solid rgba(127, 179, 255, 0.25);
      margin-bottom: 10px;
    }
    .header h1 {
      margin: 0 0 12px 0;
      font-size: 20px;
      font-weight: 700;
      color: #ffffff;
      letter-spacing: -0.02em;
    }
    .subject-line {
      font-size: 16px;
      font-weight: 600;
      color: #7fb3ff;
      border-left: 3px solid #4f8cff;
      padding-left: 10px;
      margin-top: 8px;
    }
    .content {
      padding: 32px;
      font-size: 15px;
      line-height: 1.65;
      color: #cbd5e1;
    }
    .content h1, .content h2, .content h3 {
      color: #f8fafc;
    }
    .footer {
      background-color: #0b1324;
      padding: 24px 32px;
      border-top: 1px solid rgba(255, 255, 255, 0.06);
      font-size: 12px;
      color: #64748b;
      line-height: 1.5;
    }
    .footer a {
      color: #4f8cff;
      text-decoration: none;
    }
    .divider {
      height: 1px;
      background: rgba(255, 255, 255, 0.08);
      margin: 16px 0;
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="container">
      <div class="header">
        <div class="badge">Official Announcement</div>
        <h1>Stone & Company Forex Fund</h1>
        <div class="subject-line">${escapeHtml(subject || "Fund Update")}</div>
      </div>
      <div class="content">
        ${formattedBody}
      </div>
      <div class="footer">
        <p style="margin:0 0 8px 0;"><strong>Stone and Company Forex Fund</strong></p>
        <p style="margin:0 0 12px 0;">This email was sent from the official admin dashboard to account holders of Stone and Company Forex Fund.</p>
        <div class="divider"></div>
        <p style="margin:0;">If you have any questions regarding your account, please reach out to fund management.</p>
      </div>
    </div>
  </div>
</body>
</html>
  `.trim();
}

/**
 * Converts HTML body into clean plain text fallback.
 */
export function generatePlainText(htmlOrText) {
  return htmlOrText
    .replace(/<br\s*[\/]?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .trim();
}

/**
 * Escapes special HTML characters in string.
 */
function escapeHtml(str) {
  return (str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Sends single or batch email via Resend API with optional file attachments.
 * 
 * @param {Object} opts
 * @param {string[]} opts.recipients Array of email addresses
 * @param {string} opts.subject Email subject
 * @param {string} opts.body Raw message body (plain text or HTML)
 * @param {Array<{filename: string, content: string}>} [opts.attachments] Array of attachments with filename and base64 content
 * @param {string} [opts.from] Optional sender address override
 * @param {string} [opts.replyTo] Optional reply-to address
 */
export async function sendEmail({ recipients, subject, body, attachments, from, replyTo }) {
  if (!resend) {
    throw new Error("RESEND_API_KEY is not configured on the server environment variables.");
  }

  if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
    throw new Error("No recipients specified.");
  }

  if (!subject || !subject.trim()) {
    throw new Error("Email subject is required.");
  }

  if (!body || !body.trim()) {
    throw new Error("Email body is required.");
  }

  const senderEmail = from || process.env.RESEND_FROM_EMAIL || "Stone & Company Forex Fund <onboarding@resend.dev>";
  const replyToEmail = replyTo || process.env.RESEND_REPLY_TO || undefined;

  const htmlContent = generateEmailHtml({ subject, body });
  const textContent = generatePlainText(body);

  // Format attachments for Resend if present
  const resendAttachments = (attachments && Array.isArray(attachments))
    ? attachments.map(att => {
        let cleanContent = att.content || "";
        if (cleanContent.includes(",")) {
          cleanContent = cleanContent.split(",")[1];
        }
        return {
          filename: att.filename,
          content: cleanContent
        };
      })
    : undefined;

  const results = [];
  const errors = [];

  // Send in batches of 50
  const BATCH_SIZE = 50;
  for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
    const batch = recipients.slice(i, i + BATCH_SIZE);
    
    const batchPayload = batch.map(toEmail => ({
      from: senderEmail,
      to: [toEmail],
      replyTo: replyToEmail,
      subject: subject.trim(),
      html: htmlContent,
      text: textContent,
      attachments: resendAttachments
    }));

    try {
      const { data, error } = await resend.batch.send(batchPayload);
      if (error) {
        console.error("Resend batch send error:", error);
        errors.push({ batch, error: error.message });
      } else {
        results.push({ batch, data });
      }
    } catch (err) {
      console.error("Failed sending email batch:", err.message);
      errors.push({ batch, error: err.message });
    }
  }

  const failedCount = errors.reduce((acc, e) => acc + e.batch.length, 0);
  const sentCount = recipients.length - failedCount;

  return {
    success: failedCount === 0,
    totalCount: recipients.length,
    sentCount,
    failedCount,
    errors,
    results
  };
}
