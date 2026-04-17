import { parseCookies, verifySession } from "./auth.js";

// Helper to secure admin API routes
export function verifyAdminSession(req) {
  const cookies = parseCookies(req);
  const session = verifySession(cookies.scff_admin_session);

  if (!session || !session.adminId || session.role !== "admin") {
    return null;
  }
  return session;
}
