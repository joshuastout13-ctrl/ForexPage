import { verifyAdminSession } from "../../lib/adminAuth.js";
import { readSupabaseTable } from "../../lib/supabase.js";

export default async function handler(req, res) {
  try {
    const session = verifyAdminSession(req);

    if (!session) {
      return res.status(401).json({ error: "Not authenticated as admin" });
    }

    const investors = await readSupabaseTable("investors");
    const adminUser = investors.find(r => r.id === session.adminId);

    if (!adminUser) {
        return res.status(401).json({ error: "Admin record not found" });
    }

    res.status(200).json({
      admin: {
        id: adminUser.id,
        username: adminUser.portalusername ?? adminUser.username,
        name: [adminUser.firstname, adminUser.lastname].filter(Boolean).join(" ") || "Admin"
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to load admin profile" });
  }
}
