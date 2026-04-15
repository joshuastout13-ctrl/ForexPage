import { readSheet, bool, filterInvestors } from "../lib/sheets.js";
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

    let investors = await readSheet(CONFIG.tabs.investors);
    
    // [Hyper-Audit] Logging structure
    if (investors.length > 0) {
      console.warn(`[Hyper-Audit] Column Keys detected: [${Object.keys(investors[0]).join(", ")}]`);
      const firstRow = investors[0];
      const uKey = "portalusername";
      const pKey = "temppasswordprototypeonly";
      console.warn(`[Hyper-Audit] Row 1 Sample: { ${uKey}: "${firstRow[uKey]}", ${pKey}: "${String(firstRow[pKey] || "").substring(0, 2)}***" }`);
    }

    const unfiltered = investors.map(i => i.portalusername ?? i.username ?? "N/A").join(", ");
    console.warn(`[Hyper-Audit] ALL usernames before filtering: [${unfiltered}]`);
    
    investors = filterInvestors(investors);
    const foundUsers = investors.map(i => (i.portalusername ?? i.username ?? "N/A")).join(", ");
    console.warn(`[Hyper-Log] Available usernames after filtering: [${foundUsers}]`);

    const targetUser = username.toLowerCase();

    const investor = investors.find((row) => {
      // Skip inactive investors — matches "Active" column (bool handles truthy/falsy)
      if (!bool(row.active ?? row.Active)) return false;

      const rowUser = String(row.portalusername ?? row.username ?? "").trim().toLowerCase();
      const rowPass = String(
        row.temppassword ?? 
        row.password ?? 
        row.temppasswordprototypeonly ?? 
        ""
      ).trim();

      return rowUser === targetUser && rowPass === password;
    });

    if (!investor) {
      console.log(`[Login] Failed login attempt for user: "${username}"`);
      return res.status(401).json({ error: "Invalid credentials" });
    }

    console.log(`[Login] Successful login for: "${username}"`);

    const investorId = String(
      investor.investorid ?? 
      investor.id ?? 
      investor.portalusername ?? 
      investor.investorsinvestorid ?? 
      ""
    ).trim();

    const token = createSession({ investorId });
    res.setHeader("Set-Cookie", sessionCookie(token));
    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Login failed" });
  }
}
