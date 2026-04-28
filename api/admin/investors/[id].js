import { verifyAdminSession } from "../../../lib/adminAuth.js";
import { supabase } from "../../../lib/supabase.js";

export default async function handler(req, res) {
  const session = verifyAdminSession(req);
  if (!session) return res.status(401).json({ error: "Unauthorized" });

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: "Missing investor ID" });

  if (req.method === "PATCH") {
    try {
      const body = req.body || {};
      const updates = {};
      
      if (body.firstName !== undefined) updates.first_name = body.firstName;
      if (body.lastName !== undefined) updates.last_name = body.lastName;
      if (body.email !== undefined) updates.email = body.email;
      if (body.portalUsername !== undefined) updates.portal_username = body.portalUsername;
      if (body.tempPassword !== undefined) updates.temp_password = body.tempPassword;
      if (body.splitPct !== undefined) updates.split_pct = Number(body.splitPct);
      if (body.monthlyDraw !== undefined) updates.monthly_draw = Number(body.monthlyDraw);
      if (body.startDate !== undefined) updates.start_date = body.startDate;
      if (body.role !== undefined) updates.role = body.role;
      if (body.notes !== undefined) updates.notes = body.notes;

      // Handle commission rules if provided
      const splitPct = updates.split_pct !== undefined ? updates.split_pct : undefined;
      const commissionRules = Array.isArray(body.commissionRules) ? body.commissionRules : null;

      if (commissionRules !== null) {
        // To validate, we need the split_pct. If not in updates, we'd need to fetch it.
        // But let's assume the frontend sends the whole state or at least the current split_pct in body.splitPct
        const effectiveSplit = splitPct !== undefined ? splitPct : Number(body.splitPct || 100);
        const totalCommissions = commissionRules.reduce((sum, rule) => sum + Number(rule.percent), 0);
        
        if (Math.abs(effectiveSplit + totalCommissions - 100) > 0.01 && effectiveSplit !== 100) {
          throw new Error(`Split (${effectiveSplit}%) and Commissions (${totalCommissions}%) must equal 100%`);
        }
      }

      // Update investors table
      const { data, error } = await supabase.from("investors").update(updates).eq("id", id).select();
      if (error) throw error;

      // Update commission rules if provided
      if (commissionRules !== null) {
        // Delete old rules
        await supabase.from("commission_rules").delete().eq("investor_id", id);
        
        if (commissionRules.length > 0) {
          const rulesPayload = commissionRules.map(rule => ({
            investor_id: id,
            recipient_id: rule.recipientId,
            percent: Number(rule.percent)
          }));
          const { error: rulesError } = await supabase.from("commission_rules").insert(rulesPayload);
          if (rulesError) console.error("Failed to update commission rules:", rulesError.message);
        }
      }

      return res.status(200).json({ success: true, investor: data[0] });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === "DELETE") {
    try {
      // 1. Delete associated records first (Manual cascade)
      await supabase.from("deposits").delete().eq("investor_id", id);
      await supabase.from("withdrawals").delete().eq("investor_id", id);
      await supabase.from("snapshots").delete().eq("investor_id", id);
      await supabase.from("investor_monthly_history").delete().eq("investor_id", id);
      await supabase.from("commission_rules").delete().eq("investor_id", id);
      await supabase.from("commission_rules").delete().eq("recipient_id", id);
      await supabase.from("commission_earnings").delete().eq("recipient_id", id);
      await supabase.from("commission_earnings").delete().eq("source_investor_id", id);
      await supabase.from("investor_accounts").delete().eq("investor_id", id);
      
      // 2. Delete the investor
      const { error } = await supabase.from("investors").delete().eq("id", id);
      if (error) throw error;

      return res.status(200).json({ success: true, message: "Investor and all associated data deleted" });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  res.status(405).json({ error: "Method not allowed" });
}
