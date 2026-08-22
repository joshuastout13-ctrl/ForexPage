import { readSupabaseTable } from "../../lib/supabase.js";
import { createSession, adminSessionCookie } from "../../lib/auth.js";
import { verifyPassword } from "../../lib/password.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = req.body || {};
    const username = String(body.username ?? "").trim().toLowerCase();
    const password = String(body.password ?? "").trim();

    if (!username || !password) {
      return res.status(400).json({ error: "Missing username or password" });
    }

    const useSupabase = process.env.DATA_SOURCE === "supabase";
    
    if (!useSupabase) {
      return res.status(500).json({ error: "Admin dashboard requires Supabase data source" });
    }

    const investors = await readSupabaseTable("investors");
    
    // Find matching active admin
    const adminUser = investors.find((row) => {
      // Role MUST be admin (case insensitive)
      const role = String(row.role || "").trim().toLowerCase();
      if (role !== "admin") return false;

      // Account MUST be active (if active flag exists)
      if (row.active !== undefined && row.active !== null && !row.active) return false;

      const rowUser = String(
        row.portal_username ?? 
        row.portalusername ?? 
        row.username ?? 
        row.id ?? 
        ""
      ).trim().toLowerCase();

      const storedPass = String(
        row.temp_password ?? 
        row.temppassword ?? 
        row.password ?? 
        row.temppasswordprototypeonly ?? 
        ""
      ).trim();

      if (rowUser !== username) return false;

      return verifyPassword(password, storedPass);
    });

    if (!adminUser) {
      return res.status(401).json({ error: "Invalid admin credentials" });
    }

    const adminId = String(adminUser.id ?? "").trim();
    if (!adminId) {
       return res.status(500).json({ error: "Admin record is missing an id" });
    }

    const token = createSession({ adminId, role: "admin" });
    res.setHeader("Set-Cookie", adminSessionCookie(token, req));
    return res.status(200).json({ success: true, adminId });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Login failed" });
  }
}
