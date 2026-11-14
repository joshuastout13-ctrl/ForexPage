import crypto from "node:crypto";
import { CONFIG } from "./config.js";

const DEFAULT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function getSessionSecret() {
  const secret = String(process.env.SESSION_SECRET || CONFIG.sessionSecret || "").trim();
  const isProd = process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
  if (isProd && (!secret || secret === "change-this-secret")) {
    throw new Error("CRITICAL_SECURITY_ERROR: SESSION_SECRET must be set to a strong non-default value in production.");
  }
  return secret || "change-this-secret";
}

function sign(value) {
  return crypto
    .createHmac("sha256", getSessionSecret())
    .update(value)
    .digest("hex");
}

export function createSession(payload) {
  const fullPayload = {
    ...(payload || {}),
    exp: (payload && payload.exp !== undefined) ? payload.exp : (Date.now() + DEFAULT_SESSION_TTL_MS)
  };
  const body = Buffer.from(JSON.stringify(fullPayload)).toString("base64url");
  const sig = sign(body);
  return `${body}.${sig}`;
}

export function verifySession(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  if (!body || !sig) return null;

  let expected;
  try {
    expected = sign(body);
  } catch {
    return null;
  }

  const sigBuf = Buffer.from(sig, "utf8");
  const expectedBuf = Buffer.from(expected, "utf8");
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  try {
    const decoded = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (decoded && decoded.exp !== undefined && Date.now() > Number(decoded.exp)) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

export function parseCookies(req) {
  const raw = (req && req.headers && req.headers.cookie) || "";
  const out = {};
  raw.split(";").forEach((part) => {
    const idx = part.indexOf("=");
    if (idx > -1) {
      const key = part.slice(0, idx).trim();
      const val = decodeURIComponent(part.slice(idx + 1).trim());
      out[key] = val;
    }
  });
  return out;
}

function isSecureEnv(req) {
  if (process.env.NODE_ENV === "production") return true;
  if (!req) return false;
  const proto = req.headers ? (req.headers["x-forwarded-proto"] || "") : "";
  return proto.toLowerCase() === "https";
}

export function sessionCookie(token, req = null) {
  const secureFlag = isSecureEnv(req) ? "; Secure" : "";
  return `scff_session=${encodeURIComponent(
    token
  )}; Path=/; HttpOnly; SameSite=Lax${secureFlag}; Max-Age=604800`;
}

export function clearSessionCookie(req = null) {
  const secureFlag = isSecureEnv(req) ? "; Secure" : "";
  return `scff_session=; Path=/; HttpOnly; SameSite=Lax${secureFlag}; Max-Age=0`;
}

export function adminSessionCookie(token, req = null) {
  const secureFlag = isSecureEnv(req) ? "; Secure" : "";
  return `scff_admin_session=${encodeURIComponent(
    token
  )}; Path=/; HttpOnly; SameSite=Lax${secureFlag}; Max-Age=604800`;
}

export function clearAdminSessionCookie(req = null) {
  const secureFlag = isSecureEnv(req) ? "; Secure" : "";
  return `scff_admin_session=; Path=/; HttpOnly; SameSite=Lax${secureFlag}; Max-Age=0`;
}
