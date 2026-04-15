import { readSheet, truthy } from "../lib/sheets.js";
import { CONFIG } from "../lib/config.js";
import { createSession, sessionCookie } from "../lib/auth.js";

function getField(row, keys) {
  for (const key of keys) {
    if (row[key] != null && row[key] !== "") return row[key];
  }
  return "";
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const body = req.body || {};
    const username = String(body.username || body.user || "").trim();
    const password = String(body.password || body.pass || "").trim();

    if (!username || !password) {
      res.status(400).json({ error: "Missing username or password" });
      return;
    }

    const investors = await readSheet(CONFIG.tabs.investors);

    const investor = investors.find((row) => {
      const active = truthy(getField(row, ["active"]));
      const rowUser = String(
        getField(row, ["portalusername", "username"])
      ).trim();
      const rowPass = String(
        getField(row, [
          "temppasswordprototypeonly",
          "temppassword",
          "password",
          "portalpassword"
        ])
      ).trim();

      return active && rowUser === username && rowPass === password;
    });

    if (!investor) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    const investorId =
      investor.investorid || investor.id || investor.portalusername || investor.username;

    const token = createSession({ investorId });

    res.setHeader("Set-Cookie", sessionCookie(token));
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message || "Login failed" });
  }
}
