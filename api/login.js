import { readSheet, bool } from "../lib/sheets.js";
import { CONFIG } from "../lib/config.js";
import { createSession, sessionCookie } from "../lib/auth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = req.body || {};
    const username = String(body.username ?? body.user ?? "").trim();
    const password = String(body.password ?? body.pass ?? "").trim();

    if (!username || !password) {
      return res.status(400).json({ error: "Missing username or password" });
    }

    const investors = await readSheet(CONFIG.tabs.investors);

    const investor = investors.find((row) => {
      // Skip inactive investors (default to active if column is missing)
      const activeVal = row.active ?? row.Active;
      if (activeVal != null && activeVal !== "" && !bool(activeVal)) return false;

      const rowUser = String(
        row.portalusername ?? row.username ?? ""
      ).trim();
      const rowPass = String(
        row.temppasswordprototypeonly ??
          row.temppassword ??
          row.password ??
          row.portalpassword ??
          ""
      ).trim();

      return rowUser === username && rowPass === password;
    });

    if (!investor) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const investorId = String(
      investor.investorid ?? investor.id ?? investor.portalusername ?? investor.username ?? ""
    ).trim();

    const token = createSession({ investorId });
    res.setHeader("Set-Cookie", sessionCookie(token));
    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Login failed" });
  }
}
