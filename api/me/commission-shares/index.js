import { parseCookies, verifySession } from "../../../lib/auth.js";
import { supabase } from "../../../lib/supabase.js";

export default async function handler(req, res) {
  try {
    const cookies = parseCookies(req);
    const session = verifySession(cookies.scff_session);

    if (!session?.investorId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const { investorId } = session;

    if (req.method === "GET") {
      // Fetch shares where the investor is either the source or the recipient
      const { data, error } = await supabase
        .from("commission_shares")
        .select(`
          *,
          recipient:investors!commission_shares_recipient_investor_id_fkey(portal_username, first_name, last_name, email),
          source:investors!commission_shares_source_investor_id_fkey(portal_username, first_name, last_name, email),
          account:investor_accounts!commission_shares_source_account_id_fkey(name)
        `)
        .or(`source_investor_id.ilike.${investorId},recipient_investor_id.ilike.${investorId}`)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return res.status(200).json({ shares: data });
    }

    if (req.method === "POST") {
      // Create a new share
      const { recipient_username, commission_percent, effective_start_date, source_account_id } = req.body;
      
      if (!recipient_username || !commission_percent || !effective_start_date) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      // Find recipient
      const { data: recipient, error: recErr } = await supabase
        .from("investors")
        .select("id")
        .or(`portal_username.ilike.${recipient_username},email.ilike.${recipient_username}`)
        .single();
        
      if (recErr || !recipient) {
        return res.status(404).json({ error: "Recipient not found" });
      }
      
      if (recipient.id.toLowerCase() === investorId.toLowerCase()) {
        return res.status(400).json({ error: "Cannot share commission with yourself" });
      }

      // Validate total active percentage does not exceed 100%
      const { data: activeShares, error: activeErr } = await supabase
        .from("commission_shares")
        .select("commission_percent")
        .ilike("source_investor_id", investorId)
        .in("status", ["active", "pending"])
        .is("effective_end_date", null); // Or complex overlap check. Keep simple for now.

      if (!activeErr && activeShares) {
        const totalPct = activeShares.reduce((sum, s) => sum + Number(s.commission_percent), 0);
        if (totalPct + Number(commission_percent) > 100) {
          return res.status(400).json({ error: "Total commission sharing exceeds 100%" });
        }
      }

      const { data, error } = await supabase
        .from("commission_shares")
        .insert({
          source_investor_id: investorId,
          source_account_id: source_account_id || null,
          recipient_investor_id: recipient.id,
          commission_percent,
          effective_start_date,
          status: "active"
        })
        .select()
        .single();

      if (error) throw error;
      return res.status(201).json({ share: data });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    console.error("[Commission Shares API]", error);
    res.status(500).json({ error: error.message || "Internal server error" });
  }
}
