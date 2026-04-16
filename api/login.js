import { readSheet, bool, filterInvestors } from "../lib/sheets.js";
import { readSupabaseTable } from "../lib/supabase.js";
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

    const useSupabase = process.env.DATA_SOURCE === "supabase";
    let investors;

    if (useSupabase) {
      console.log(`[Login] Checking credentials in Supabase for: "${username}"`);
      investors = await readSupabaseTable("investors");
    } else {
      console.log(`[Login] Checking credentials in Google Sheets for: "${username}"`);
      investors = await readSheet(CONFIG.tabs.investors);
    }
    
    investors = filterInvestors(investors);
    const targetUser = username.toLowerCase();

    const investor = investors.find((row) => {
      // Skip inactive investors
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
