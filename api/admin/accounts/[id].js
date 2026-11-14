import { verifyAdminSession } from "../../../lib/adminAuth.js";
import { supabase } from "../../../lib/supabase.js";

export default async function handler(req, res) {
  const session = verifyAdminSession(req);
  if (!session) return res.status(401).json({ error: "Unauthorized" });

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: "Missing account ID" });

  if (req.method === "PATCH" || req.method === "PUT") {
    try {
      const body = req.body || {};
      const updates = {};
      
      if (body.id !== undefined) updates.id = body.id;
      if (body.investorId !== undefined) updates.investor_id = body.investorId;
      if (body.name !== undefined) updates.name = body.name;
      if (body.startingCapital !== undefined) updates.starting_capital = Number(body.startingCapital);
      if (body.totalCashIn !== undefined) updates.total_cash_in = Number(body.totalCashIn);
      if (body.openDate !== undefined) updates.open_date = body.openDate;
      if (body.status !== undefined) updates.status = body.status;
      if (body.isCommission !== undefined) updates.is_commission = body.isCommission === true || body.isCommission === "true";
      if (body.splitPct !== undefined) updates.split_pct = Number(body.splitPct);
      if (body.notes !== undefined) updates.notes = body.notes;

      if (body.commissionRules !== undefined) {
        const commissionRules = Array.isArray(body.commissionRules) ? body.commissionRules : [];
        if (commissionRules.length > 0) {
          return res.status(400).json({
            error: "LEGACY_COMMISSION_RULES_DEPRECATED: Manage commission shares via /api/admin/commission-shares instead of commissionRules.",
            code: "LEGACY_COMMISSION_RULES_DEPRECATED"
          });
        }
      }

      const { data, error } = await supabase.from("investor_accounts").update(updates).eq("id", id).select();
      if (error) throw error;

      return res.status(200).json({ success: true, account: data[0] });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  res.setHeader("Allow", ["PATCH", "PUT"]);
  res.status(405).json({ error: "Method not allowed" });
}
