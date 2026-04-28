import { verifyAdminSession } from "../../../lib/adminAuth.js";
import { supabase, readSupabaseTable } from "../../../lib/supabase.js";
import crypto from "node:crypto";

export default async function handler(req, res) {
  const session = verifyAdminSession(req);
  if (!session) return res.status(401).json({ error: "Unauthorized" });

  if (req.method === "GET") {
    try {
      const { data: investors, error } = await supabase.from("investors").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      
      const { data: rules, error: rulesError } = await supabase.from("commission_rules").select("*");
      if (!rulesError && rules) {
        investors.forEach(inv => {
          inv.commissionRules = rules.filter(r => r.investor_id === inv.id);
        });
      }
      
      return res.status(200).json({ investors });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === "POST") {
    try {
      const body = req.body || {};
      
      const newId = body.id || `inv_${crypto.randomBytes(4).toString("hex")}`;
      const splitPct = Number(body.splitPct || 0);
      const commissionRules = Array.isArray(body.commissionRules) ? body.commissionRules : [];
      
      // Validate split
      const totalCommissions = commissionRules.reduce((sum, rule) => sum + Number(rule.percent), 0);
      if (Math.abs(splitPct + totalCommissions - 100) > 0.01 && splitPct !== 100) {
        throw new Error(`Split (${splitPct}%) and Commissions (${totalCommissions}%) must equal 100%`);
      }
      
      const investorPayload = {
        id: newId,
        first_name: body.firstName || "",
        last_name: body.lastName || "",
        email: body.email || "",
        portal_username: body.portalUsername || newId,
        temp_password: body.tempPassword || "",
        active: body.active !== false, // Default true
        split_pct: splitPct,
        monthly_draw: Number(body.monthlyDraw || 0),
        start_date: body.startDate || new Date().toISOString().split('T')[0],
        role: body.role || "Investor",
        notes: body.notes || ""
      };

      const { data: invData, error: invError } = await supabase.from("investors").insert([investorPayload]).select();
      if (invError) throw invError;

      // Optionally create an account row if starting data is provided
      let accData = null;
      if (body.startingCapital !== undefined && body.startingCapital !== "") {
        const accPayload = {
          id: body.portalUsername || newId, // To match dashboard logic conventions
          investor_id: newId,
          name: [body.firstName, body.lastName].filter(Boolean).join(" ") || "Main Account",
          starting_capital: Number(body.startingCapital || 0),
          open_date: investorPayload.start_date,
          status: "Active",
          notes: "Created via Admin Dashboard"
        };
        const { data: aData, error: aError } = await supabase.from("investor_accounts").insert([accPayload]).select();
        if (aError) {
          console.error("Failed to create investor account:", aError.message);
        } else {
           accData = aData;
        }
      }

      // Create commission rules if any
      if (commissionRules.length > 0) {
        const rulesPayload = commissionRules.map(rule => ({
          investor_id: newId,
          recipient_id: rule.recipientId,
          percent: Number(rule.percent)
        }));
        
        const { error: rulesError } = await supabase.from("commission_rules").insert(rulesPayload);
        if (rulesError) {
          console.error("Failed to create commission rules:", rulesError.message);
        }
      }

      return res.status(200).json({ success: true, investor: invData[0], account: accData ? accData[0] : null });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  res.status(405).json({ error: "Method not allowed" });
}
