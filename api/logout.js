import { clearSessionCookie } from "../lib/auth.js";

export default function handler(_req, res) {
  res.setHeader("Set-Cookie", clearSessionCookie());
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ ok: true }));
}
