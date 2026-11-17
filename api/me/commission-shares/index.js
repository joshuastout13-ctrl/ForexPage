import { parseCookies, verifySession } from "../../../lib/auth.js";
import { supabase } from "../../../lib/supabase.js";

function stripCounterpartyEmail(person) {
  if (!person || typeof person !== "object") return person;
  const { email: _omitted, ...safePerson } = person;
  return safePerson;
}

export default async function handler(req, res, deps = {}) {
  const db = deps.supabase || supabase;
  try {
    const cookies = parseCookies(req);
    const session = verifySession(cookies.scff_session);

    if (!session?.investorId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const { investorId } = session;

    if (req.method === "GET") {
      // Fetch shares where the investor is the recipient (without counterparty email addresses)
      const { data, error } = await db
        .from("commission_shares")
        .select(`
          *,
          recipient:investors!commission_shares_recipient_investor_id_fkey(portal_username, first_name, last_name),
          source:investors!commission_shares_source_investor_id_fkey(portal_username, first_name, last_name),
          account:investor_accounts!commission_shares_source_account_id_fkey(name)
        `)
        .ilike("recipient_investor_id", investorId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      const sanitizedShares = (data || []).map((row) => ({
        ...row,
        recipient: stripCounterpartyEmail(row.recipient),
        source: stripCounterpartyEmail(row.source)
      }));
      return res.status(200).json({ shares: sanitizedShares });
    }

    if (req.method === "POST") {
      return res.status(403).json({
        error: "ADMIN_APPROVAL_REQUIRED: Self-service commission share creation is disabled. Contact fund administration to create or modify commission shares.",
        code: "ADMIN_APPROVAL_REQUIRED"
      });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    console.error("[Commission Shares API]", error);
    res.status(500).json({ error: error.message || "Internal server error" });
  }
}
