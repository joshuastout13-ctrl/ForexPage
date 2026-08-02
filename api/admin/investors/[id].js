import { verifyAdminSession } from "../../../lib/adminAuth.js";
import { supabase } from "../../../lib/supabase.js";

export default async function handler(req, res) {
  const session = verifyAdminSession(req);
  if (!session) return res.status(401).json({ error: "Unauthorized" });

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: "Missing investor ID" });

  if (req.method === "PATCH" || req.method === "PUT") {
    try {
      const body = req.body || {};
      const updates = {};
      
      if (body.firstName !== undefined) updates.first_name = body.firstName;
      if (body.lastName !== undefined) updates.last_name = body.lastName;
      if (body.email !== undefined) updates.email = body.email;
      if (body.portalUsername !== undefined) updates.portal_username = body.portalUsername;
      if (body.tempPassword !== undefined) updates.temp_password = body.tempPassword;
      if (body.password !== undefined) updates.temp_password = body.password;
      if (body.splitPct !== undefined) updates.split_pct = Number(body.splitPct);
      if (body.monthlyDraw !== undefined) updates.monthly_draw = Number(body.monthlyDraw);
      if (body.startDate !== undefined) updates.start_date = body.startDate;
      if (body.role !== undefined) updates.role = body.role;
      if (body.notes !== undefined) updates.notes = body.notes;

      // Handle commission rules if provided
      const splitPct = updates.split_pct !== undefined ? updates.split_pct : undefined;
      const commissionRules = Array.isArray(body.commissionRules) ? body.commissionRules : null;

      let isCommission = body.isCommission === true || body.isCommission === "true";
      if (body.isCommission === undefined) {
        // Need to check if existing account is a commission account
        const { data: existingAccs } = await supabase.from("investor_accounts").select("is_commission").eq("investor_id", id);
        if (existingAccs && existingAccs.length > 0) {
          isCommission = existingAccs[0].is_commission;
        }
      }

      if (isCommission && (commissionRules !== null || splitPct !== undefined)) {
        const effectiveSplit = splitPct !== undefined ? splitPct : Number(body.splitPct !== undefined ? body.splitPct : 100);
        let effectiveRules = commissionRules;
        if (effectiveRules === null) {
          const { data: existingRules } = await supabase.from("commission_rules").select("*").eq("investor_id", id);
          effectiveRules = existingRules || [];
        }
        const totalCommissions = effectiveRules.reduce((sum, rule) => sum + Number(rule.percent), 0);
        
        if (Math.abs(effectiveSplit + totalCommissions - 100) > 0.01) {
          throw new Error(`Split (${effectiveSplit}%) and Commissions (${totalCommissions}%) must equal 100% for commission accounts`);
        }
      }

      // Update investors table
      const { data, error } = await supabase.from("investors").update(updates).eq("id", id).select();
      if (error) throw error;

      // Update associated account details if provided
      let primaryAccId = null;
      const { data: existingAccs } = await supabase.from("investor_accounts").select("*").eq("investor_id", id);
      if (existingAccs && existingAccs.length > 0) {
        const primaryAcc = existingAccs[0];
        primaryAccId = primaryAcc.id;
        const accUpdates = {};
        if (body.name !== undefined) accUpdates.name = body.name;
        if (body.startingCapital !== undefined) accUpdates.starting_capital = Number(body.startingCapital);
        if (body.totalCashIn !== undefined) accUpdates.total_cash_in = Number(body.totalCashIn);
        if (body.isCommission !== undefined) accUpdates.is_commission = body.isCommission === true || body.isCommission === "true";
        if (body.splitPct !== undefined) accUpdates.split_pct = Number(body.splitPct);
        
        if (Object.keys(accUpdates).length > 0) {
          await supabase.from("investor_accounts").update(accUpdates).eq("id", primaryAccId);
        }
      } else if (body.startingCapital !== undefined && body.startingCapital !== "") {
        primaryAccId = body.accountId || body.portalUsername || id;
        const accPayload = {
          id: primaryAccId,
          investor_id: id,
          name: body.name || [body.firstName, body.lastName].filter(Boolean).join(" ") || "Main Account",
          starting_capital: Number(body.startingCapital || 0),
          total_cash_in: Number(body.totalCashIn !== undefined ? body.totalCashIn : (body.startingCapital || 0)),
          open_date: body.startDate || new Date().toISOString().split('T')[0],
          status: "Active",
          is_commission: body.isCommission === true || body.isCommission === "true",
          split_pct: Number(body.splitPct !== undefined ? body.splitPct : 100),
          notes: "Created via Admin Dashboard update"
        };
        await supabase.from("investor_accounts").insert([accPayload]);
      }

      // Update commission rules if provided
      if (commissionRules !== null) {
        // Delete old rules for this investor's primary account
        if (primaryAccId) {
          await supabase.from("commission_rules").delete().eq("account_id", primaryAccId);
        } else {
          await supabase.from("commission_rules").delete().eq("investor_id", id);
        }
        
        if (commissionRules.length > 0) {
          const rulesPayload = commissionRules.map(rule => ({
            investor_id: id,
            account_id: primaryAccId,
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
