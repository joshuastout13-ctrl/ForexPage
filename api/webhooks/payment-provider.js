import crypto from "crypto";
import { supabase } from "../../lib/supabase.js";
import { assertPeriodUnlocked, isPeriodLockedError } from "../../lib/period-lock-guard.js";

function parseSignatureHeader(sigHeader = "") {
  const raw = String(sigHeader || "").trim();
  if (!raw) return { timestamp: null, signatureHex: "" };
  if (raw.includes("v1=")) {
    let ts = null;
    let v1 = "";
    for (const part of raw.split(",")) {
      const [k, v] = part.split("=").map((s) => s.trim());
      if (k === "t") ts = v;
      if (k === "v1") v1 = v;
    }
    return { timestamp: ts, signatureHex: v1 };
  }
  return { timestamp: null, signatureHex: raw.replace(/^sha256=/i, "") };
}

export function verifyWebhookSignature({ headers = {}, rawBody = null, body = null, secret, nowMs = Date.now(), maxSkewSeconds = 300 }) {
  if (!secret) {
    return { valid: false, status: 503, error: "WEBHOOK_SECRET_NOT_CONFIGURED" };
  }

  const sigHeader = headers["x-webhook-signature"] || headers["x-signature"] || headers["stripe-signature"] || "";
  const parsed = parseSignatureHeader(sigHeader);
  const timestamp = headers["x-webhook-timestamp"] || parsed.timestamp;
  const signatureHex = parsed.signatureHex;

  if (!signatureHex) {
    return { valid: false, status: 401, error: "MISSING_WEBHOOK_SIGNATURE" };
  }

  if (timestamp) {
    const tsNum = Number(timestamp);
    if (!Number.isFinite(tsNum)) {
      return { valid: false, status: 401, error: "INVALID_WEBHOOK_TIMESTAMP" };
    }
    const tsMs = tsNum > 1e12 ? tsNum : tsNum * 1000;
    if (Math.abs(nowMs - tsMs) > maxSkewSeconds * 1000) {
      return { valid: false, status: 401, error: "STALE_WEBHOOK_TIMESTAMP" };
    }
  }

  const payloadString = typeof rawBody === "string"
    ? rawBody
    : (Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : JSON.stringify(body || {}));

  const signedPayload = timestamp ? `${timestamp}.${payloadString}` : payloadString;
  const expectedHex = crypto.createHmac("sha256", secret).update(signedPayload).digest("hex");

  const sigBuf = Buffer.from(signatureHex.toLowerCase(), "utf8");
  const expBuf = Buffer.from(expectedHex.toLowerCase(), "utf8");

  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return { valid: false, status: 401, error: "INVALID_WEBHOOK_SIGNATURE" };
  }

  return { valid: true };
}

function resolveResourceType(body = {}) {
  const explicit = String(body.resource_type || body.resourceType || "").trim().toLowerCase();
  if (explicit === "deposit" || explicit === "withdrawal") return explicit;
  const evt = String(body.event_type || body.eventType || body.type || "").trim().toLowerCase();
  if (evt.includes("deposit") || evt.includes("credit")) return "deposit";
  if (evt.includes("withdrawal") || evt.includes("payout") || evt.includes("draw")) return "withdrawal";
  return "";
}

export default async function handler(req, res, deps = {}) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const db = deps.supabase || supabase;
  const secret = deps.webhookSecret ?? process.env.PAYMENT_WEBHOOK_SECRET;

  const authCheck = verifyWebhookSignature({
    headers: req.headers || {},
    rawBody: req.rawBody ?? null,
    body: req.body || {},
    secret,
    nowMs: deps.nowMs ?? Date.now()
  });

  if (!authCheck.valid) {
    return res.status(authCheck.status).json({ error: authCheck.error });
  }

  if (!db) {
    return res.status(503).json({ error: "DATABASE_UNAVAILABLE" });
  }

  const body = req.body || {};
  const provider = String(body.provider || req.headers?.["x-webhook-provider"] || "payment_provider").trim();
  const providerEventId = String(body.provider_event_id || body.event_id || body.id || "").trim();
  const eventType = String(body.event_type || body.eventType || body.type || "").trim();
  const resourceType = resolveResourceType(body);
  const investorId = String(body.investor_id || body.investorId || "").trim();
  const accountId = String(body.account_id || body.accountId || "").trim();
  const amount = Number(body.amount);
  const effectiveDate = String(body.effective_date || body.effectiveDate || body.date || "").slice(0, 10);
  const notes = body.notes ? String(body.notes) : null;
  const isDraw = Boolean(body.is_draw ?? body.isDraw ?? false);

  if (!providerEventId || !eventType || !resourceType || !investorId || !accountId) {
    return res.status(400).json({
      error: "INVALID_WEBHOOK_PAYLOAD",
      message: "Required fields: provider_event_id, event_type, resource_type ('deposit'|'withdrawal'), investor_id, account_id, amount, effective_date."
    });
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: "INVALID_AMOUNT", message: "amount must be a positive number." });
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) {
    return res.status(400).json({ error: "INVALID_EFFECTIVE_DATE", message: "effective_date must be YYYY-MM-DD." });
  }

  try {
    await assertPeriodUnlocked(db, { dateStr: effectiveDate }, `webhook_${resourceType}`);

    const { data, error } = await db.rpc("process_payment_provider_event_atomic", {
      p_provider: provider,
      p_provider_event_id: providerEventId,
      p_event_type: eventType,
      p_investor_id: investorId,
      p_account_id: accountId,
      p_amount: amount,
      p_effective_date: effectiveDate,
      p_resource_type: resourceType,
      p_payload: body,
      p_notes: notes,
      p_is_draw: isDraw
    });

    if (error) {
      const msg = String(error.message || "");
      if (msg.includes("PERIOD_LOCKED")) {
        return res.status(409).json({ error: "PERIOD_LOCKED", message: msg });
      }
      if (msg.includes("INSUFFICIENT_AVAILABLE_EQUITY")) {
        return res.status(400).json({ error: "INSUFFICIENT_AVAILABLE_EQUITY", message: msg });
      }
      if (msg.includes("INVALID_") || msg.includes("UNSUPPORTED_")) {
        return res.status(400).json({ error: "WEBHOOK_VALIDATION_ERROR", message: msg });
      }
      throw error;
    }

    return res.status(200).json({
      success: true,
      idempotentReplay: Boolean(data?.idempotency_replay),
      provider,
      provider_event_id: providerEventId,
      resource_type: resourceType,
      resource_id: data?.resource_id || null,
      result: data
    });
  } catch (err) {
    if (isPeriodLockedError(err)) {
      return res.status(409).json({ error: "PERIOD_LOCKED", message: err.message });
    }
    console.error("[Payment Webhook Error]:", err.message);
    return res.status(500).json({ error: "WEBHOOK_PROCESSING_FAILED", message: err.message });
  }
}
