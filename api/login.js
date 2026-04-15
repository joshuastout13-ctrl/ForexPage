import { readSheet, truthy } from "../lib/sheets.js";
import { createSession, sessionCookie } from "../lib/auth.js";
import { CONFIG } from "../lib/config.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password required" });
  }

  try {
    const investors = await readSheet(CONFIG.tabs.investors);
    const investor = investors.find(
      (r) =>
        String(r.username || "").trim().toLowerCase() === username.trim().toLowerCase() &&
        String(r.password || "").trim() === password.trim()
    );

    if (!investor || !truthy(investor.active)) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = createSession({ username: username.trim().toLowerCase() });
    res.setHeader("Set-Cookie", sessionCookie(token));
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
