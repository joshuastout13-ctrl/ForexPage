import { verifyAdminSession } from "../../lib/adminAuth.js";
import { supabase } from "../../lib/supabase.js";
import { hashPassword } from "../../lib/password.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // Admin-only authorization check
    const session = verifyAdminSession(req);
    if (!session) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const body = req.body || {};
    const investorId = String(body.investorId ?? "").trim();
    const newPassword = String(body.newPassword ?? "").trim();
    const forceChange = body.forceChange !== false; // default true

    if (!investorId) {
      return res.status(400).json({ error: "Missing investorId" });
    }

    if (!newPassword || newPassword.length < 4) {
      return res.status(400).json({ error: "Password must be at least 4 characters" });
    }

    // Look up investor
    const { data: investor, error: lookupErr } = await supabase
      .from("investors")
      .select("id, portal_username")
      .eq("id", investorId)
      .maybeSingle();

    if (lookupErr || !investor) {
      return res.status(404).json({ error: "Investor not found" });
    }

    // Hash password with bcrypt or store plaintext if force change flag requested
    // If forceChange is true, store as temporary plaintext so user can enter it as temporary password,
    // otherwise hash with bcrypt.
    const passwordToStore = forceChange ? newPassword : hashPassword(newPassword);

    const { error: updateErr } = await supabase
      .from("investors")
      .update({
        temp_password: passwordToStore,
        force_password_change: forceChange,
        updated_at: new Date().toISOString()
      })
      .eq("id", investor.id);

    if (updateErr) {
      console.error("[Admin Reset Password] Update failed:", updateErr);
      return res.status(500).json({ error: "Failed to reset password" });
    }

    return res.status(200).json({
      success: true,
      investorId: investor.id,
      forcePasswordChange: forceChange
    });
  } catch (err) {
    console.error("[Admin Reset Password] Error:", err);
    return res.status(500).json({ error: err.message || "Failed to reset password" });
  }
}
