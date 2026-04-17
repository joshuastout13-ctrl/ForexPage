import { readSupabaseTable } from "../../lib/supabase.js";
import { createSession, adminSessionCookie } from "../../lib/auth.js";

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

      const rowUser = String(row.portalusername ?? row.username ?? "").trim().toLowerCase();
      const rowPass = String(row.temppassword ?? row.password ?? "").trim();

      return rowUser === username && rowPass === password;
    });

    if (!adminUser) {
      return res.status(401).json({ error: "Invalid admin credentials" });
    }

    const adminId = String(adminUser.id ?? "").trim();
    if (!adminId) {
       return res.status(500).json({ error: "Admin record is missing an id" });
    }

    const token = createSession({ adminId, role: "admin" });
    res.setHeader("Set-Cookie", adminSessionCookie(token));
    return res.status(200).json({ success: true, adminId });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Login failed" });
  }
}
