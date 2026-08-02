import { verifyAdminSession } from "../../../../lib/adminAuth.js";
import { supabase } from "../../../../lib/supabase.js";

export default async function handler(req, res) {
  try {
    const session = verifyAdminSession(req);
    if (!session) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { id } = req.query;

    if (req.method === "PATCH") {
      const updates = {};
      if (req.body.commissionPercent !== undefined) updates.commission_percent = req.body.commissionPercent;
      if (req.body.effectiveStartDate !== undefined) updates.effective_start_date = req.body.effectiveStartDate;
      if (req.body.effectiveEndDate !== undefined) updates.effective_end_date = req.body.effectiveEndDate || null;
      if (req.body.status !== undefined) updates.status = req.body.status;
      if (req.body.sourceInvestorId !== undefined) updates.source_investor_id = req.body.sourceInvestorId;
      if (req.body.accountId !== undefined) updates.source_account_id = req.body.accountId;
      
      if (req.body.recipientUsername) {
        const { data: recipient } = await supabase
          .from("investors")
          .select("id")
          .or(`portal_username.ilike.${req.body.recipientUsername},email.ilike.${req.body.recipientUsername},id.eq.${req.body.recipientUsername}`)
          .single();
        if (recipient) updates.recipient_investor_id = recipient.id;
      }
      
      updates.updated_at = new Date();

      const { data, error } = await supabase
        .from("commission_shares")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return res.status(200).json({ share: data });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    console.error("[Admin Commission Shares [id] API]", error);
    res.status(500).json({ error: error.message || "Internal server error" });
  }
}
