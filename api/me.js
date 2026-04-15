import { parseCookies, verifySession } from "../lib/auth.js";
import { buildDashboard } from "../lib/dashboard.js";

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");

  const cookies = parseCookies(req);
  const session = verifySession(cookies.scff_session);

  if (!session?.investorId) {
    res.statusCode = 401;
    return res.end(JSON.stringify({ error: "Unauthorized" }));
  }

  try {
    const data = await buildDashboard(session.investorId);
    res.end(JSON.stringify(data));
  } catch (err) {
    const status = err.status ?? 500;
    res.statusCode = status;
    res.end(JSON.stringify({ error: err.message ?? "Internal server error" }));
  }
}
