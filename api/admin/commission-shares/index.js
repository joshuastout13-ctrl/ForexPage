import { verifyAdminSession } from "../../../lib/adminAuth.js";
import { supabase } from "../../../lib/supabase.js";

export default async function handler(req, res) {
  try {
    const session = verifyAdminSession(req);
    if (!session) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (req.method === "GET") {
      const { data, error } = await supabase
        .from("commission_shares")
        .select(`
          *,
          recipient:investors!commission_shares_recipient_investor_id_fkey(portal_username, first_name, last_name, email),
          source:investors!commission_shares_source_investor_id_fkey(portal_username, first_name, last_name, email),
          account:investor_accounts!commission_shares_source_account_id_fkey(name)
        `)
        .order("created_at", { ascending: false });

      if (error) throw error;
      
      const mapped = data.map(i => ({
        id: i.id,
        investor_id: i.source_investor_id,
        account_id: i.source_account_id,
        recipient_id: i.recipient_investor_id,
        recipient_name: i.recipient ? (i.recipient.portal_username || i.recipient.first_name || i.recipient_investor_id) : i.recipient_investor_id,
        percent: i.commission_percent,
        notes: i.status
      }));
      
      return res.status(200).json({ commission_shares: mapped });
    }

    if (req.method === "POST") {
      const { 
        sourceInvestorId, 
        accountId, 
        recipientUsername, 
        commissionPercent, 
        effectiveStartDate,
        effectiveEndDate,
        status
      } = req.body;
      
      // We accept recipientUsername (email or username) from admin portal since it's easier to type, or we can use ID if provided.
      // Wait, in admin portal we defined recipientUsername but it can also be an ID. Let's find the user.
      if (!sourceInvestorId || !recipientUsername || !commissionPercent || !effectiveStartDate) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      // Find recipient
      const { data: recipient, error: recErr } = await supabase
        .from("investors")
        .select("id")
        .or(`portal_username.ilike.${recipientUsername},email.ilike.${recipientUsername},id.eq.${recipientUsername}`)
        .single();
        
      if (recErr || !recipient) {
        return res.status(404).json({ error: "Recipient not found" });
      }
      
      if (recipient.id.toLowerCase() === sourceInvestorId.toLowerCase()) {
        return res.status(400).json({ error: "Cannot share commission with yourself" });
      }

      // Validate total active percentage does not exceed 100%
      const { data: activeShares, error: activeErr } = await supabase
        .from("commission_shares")
        .select("commission_percent")
        .ilike("source_investor_id", sourceInvestorId)
        .in("status", ["active", "pending"])
        .is("effective_end_date", null); 

      if (!activeErr && activeShares) {
        const totalPct = activeShares.reduce((sum, s) => sum + Number(s.commission_percent), 0);
        if (totalPct + Number(commissionPercent) > 100) {
          return res.status(400).json({ error: "Total commission sharing exceeds 100%" });
        }
      }

      const { data, error } = await supabase
        .from("commission_shares")
        .insert({
          source_investor_id: sourceInvestorId,
          source_account_id: accountId || null,
          recipient_investor_id: recipient.id,
          commission_percent: commissionPercent,
          effective_start_date: effectiveStartDate,
          effective_end_date: effectiveEndDate || null,
          status: status || "active"
        })
        .select()
        .single();

      if (error) throw error;
      return res.status(201).json({ share: data });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    console.error("[Admin Commission Shares API]", error);
    res.status(500).json({ error: error.message || "Internal server error" });
  }
}
