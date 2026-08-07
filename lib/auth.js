import crypto from "node:crypto";
import { CONFIG } from "./config.js";

function sign(value) {
  return crypto
    .createHmac("sha256", CONFIG.sessionSecret)
    .update(value)
    .digest("hex");
}

export function createSession(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = sign(body);
  return `${body}.${sig}`;
}

export function verifySession(token) {
  if (!token || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  const expected = sign(body);
  if (sig !== expected) return null;

  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
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
