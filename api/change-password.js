import { parseCookies, verifySession, createSession, sessionCookie } from "../lib/auth.js";
import { supabase } from "../lib/supabase.js";
import { verifyPassword, hashPassword } from "../lib/password.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // 1. Verify investor session
    const cookies = parseCookies(req);
    const session = verifySession(cookies.scff_session);

    if (!session?.investorId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const body = req.body || {};
    const currentPassword = String(body.currentPassword ?? "").trim();
    const newPassword = String(body.newPassword ?? "").trim();

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "Both current and new passwords are required" });
    }

    if (newPassword.length < 4) {
      return res.status(400).json({ error: "New password must be at least 4 characters" });
    }

    // 2. Look up investor in DB
    const { data: investor, error: lookupErr } = await supabase
      .from("investors")
      .select("id, temp_password, force_password_change")
      .eq("id", session.investorId)
      .maybeSingle();

    if (lookupErr || !investor) {
      return res.status(404).json({ error: "Investor record not found" });
    }

    // 3. Verify current password matches using bcrypt/plaintext support
    const storedPass = String(investor.temp_password || "").trim();
    if (!verifyPassword(currentPassword, storedPass)) {
      return res.status(401).json({ error: "Current password is incorrect" });
    }

    // 4. Hash new password securely using bcrypt
    const newHash = hashPassword(newPassword);

    // 5. Update password hash in DB and clear force_password_change flag
    const { error: updateErr } = await supabase
      .from("investors")
      .update({
        temp_password: newHash,
        force_password_change: false,
        updated_at: new Date().toISOString()
      })
      .eq("id", investor.id);

    if (updateErr) {
      console.error("[Change Password] Update failed:", updateErr);
      return res.status(500).json({ error: "Failed to update password" });
    }

    // 6. Reissue session cookie without forcePasswordChange flag
    const newToken = createSession({
      investorId: session.investorId,
      forcePasswordChange: false
    });
    res.setHeader("Set-Cookie", sessionCookie(newToken, req));

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("[Change Password] Error:", err);
    return res.status(500).json({ error: err.message || "Failed to change password" });
  }
}
