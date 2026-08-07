import { readSheet, bool, filterInvestors } from "../lib/sheets.js";
import { readSupabaseTable } from "../lib/supabase.js";
import { CONFIG } from "../lib/config.js";
import { createSession, sessionCookie } from "../lib/auth.js";
import { verifyPassword } from "../lib/password.js";

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
      investors = await readSupabaseTable("investors");
    } else {
      investors = await readSheet(CONFIG.tabs.investors);
    }
    
    investors = filterInvestors(investors);
    const targetUser = username.toLowerCase();

    const investor = investors.find((row) => {
      // Skip inactive investors
      if (!bool(row.active ?? row.Active)) return false;

      const rowUser = String(
        row.portal_username ?? 
        row.portalusername ?? 
        row.username ?? 
        ""
      ).trim().toLowerCase();

      const storedPass = String(
        row.temp_password ?? 
        row.temppassword ?? 
        row.password ?? 
        row.temppasswordprototypeonly ?? 
        ""
      ).trim();

      if (rowUser !== targetUser) return false;

      // Verify password via bcrypt or legacy plaintext
      return verifyPassword(password, storedPass);
    });

    if (!investor) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const investorId = String(
      investor.id ?? 
      investor.investorid ?? 
      investor.portal_username ?? 
      investor.portalusername ?? 
      ""
    ).trim();

    const forcePasswordChange = Boolean(
      investor.force_password_change ?? 
      investor.forcepasswordchange ?? 
      false
    );

    const token = createSession({ investorId, forcePasswordChange });
    res.setHeader("Set-Cookie", sessionCookie(token, req));
    return res.status(200).json({
      success: true,
      investorId: investorId,
      username: investor.portal_username || username,
      forcePasswordChange: forcePasswordChange
    });
  } catch (err) {
    console.error("[Login API Error]", err);
    return res.status(500).json({ error: err.message || "Login failed" });
  }
}
