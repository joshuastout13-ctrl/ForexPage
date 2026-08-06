import { parseCookies, verifySession } from "../lib/auth.js";
import { buildInvestorDashboard } from "../lib/dashboard.js";

export default async function handler(req, res) {
  try {
    const cookies = parseCookies(req);
    const session = verifySession(cookies.scff_session);

    if (!session?.investorId) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    if (session.forcePasswordChange) {
      res.status(200).json({ forcePasswordChange: true });
      return;
    }

    const data = await buildInvestorDashboard(session.investorId);

    if (data.investor && (data.investor.force_password_change || data.investor.forcePasswordChange)) {
      res.status(200).json({ forcePasswordChange: true });
      return;
    }

    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to load dashboard" });
  }
}
