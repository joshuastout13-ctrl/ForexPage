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
      
      const [accRes, rulesRes] = await Promise.all([
        supabase.from("investor_accounts").select("*"),
        supabase.from("commission_rules").select("*")
      ]);

      const accounts = accRes.data || [];
      const rules = rulesRes.data || [];

      (investors || []).forEach(inv => {
        const invAccs = accounts.filter(a => 
          String(a.investor_id || '').toLowerCase() === String(inv.id || '').toLowerCase() ||
          String(a.investor_id || '').toLowerCase() === String(inv.portal_username || '').toLowerCase() ||
          String(a.id || '').toLowerCase() === String(inv.portal_username || '').toLowerCase()
        );
        inv.accounts = invAccs;
        if (invAccs.length > 0) {
          inv.starting_capital = invAccs[0].starting_capital;
          inv.start_date = inv.start_date || invAccs[0].open_date;
          inv.account_id = invAccs[0].id;
        }
        inv.commissionRules = rules.filter(r => r.investor_id === inv.id);
      });
      
      return res.status(200).json({ investors });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === "POST") {
    try {
      const body = req.body || {};
      
      const newId = body.id || `inv_${crypto.randomBytes(4).toString("hex")}`;
      const splitPct = Number(body.splitPct !== undefined ? body.splitPct : 100);
      const commissionRules = Array.isArray(body.commissionRules) ? body.commissionRules : [];
      const isCommission = body.isCommission === true || body.isCommission === "true";
      
      // Validate split
      if (isNaN(splitPct) || splitPct < 0 || splitPct > 100) {
        throw new Error("Invalid split percentage: must be between 0 and 100");
      }

      if (commissionRules.length > 0) {
        const totalCommissions = commissionRules.reduce((sum, rule) => sum + Number(rule.percent), 0);
        if (splitPct + totalCommissions > 100.01) {
          throw new Error(`Total split (${splitPct}%) and commission rules (${totalCommissions}%) cannot exceed 100%`);
        }
      }
      
      const investorPayload = {
        id: newId,
        first_name: body.firstName || "",
        last_name: body.lastName || "",
        email: body.email || "",
        portal_username: body.portalUsername || newId,
        temp_password: body.tempPassword || body.password || "",
        active: body.active !== false, // Default true
        split_pct: splitPct,
        monthly_draw: Number(body.monthlyDraw || 0),
        start_date: body.startDate || new Date().toISOString().split('T')[0],
        role: body.role || "Investor",
        show_fund_performance: body.showFundPerformance === true || body.showFundPerformance === "true" || body.show_fund_performance === true,
        notes: body.notes || ""
      };

      let { data: invData, error: invError } = await supabase.from("investors").insert([investorPayload]).select();
      if (invError && invError.message && invError.message.includes("show_fund_performance")) {
        delete investorPayload.show_fund_performance;
        const retryRes = await supabase.from("investors").insert([investorPayload]).select();
        invData = retryRes.data;
        invError = retryRes.error;
      }
      if (invError && invError.message && invError.message.includes("Could not find the '")) {
        const colMatch = invError.message.match(/Could not find the '([^']+)' column/);
        if (colMatch && colMatch[1]) {
          delete investorPayload[colMatch[1]];
          const retryRes = await supabase.from("investors").insert([investorPayload]).select();
          invData = retryRes.data;
          invError = retryRes.error;
        }
      }
      if (invError) throw invError;

      // Optionally create an account row if starting data is provided
      let accData = null;
      const accId = body.accountId || body.portalUsername || newId;
      if (body.startingCapital !== undefined && body.startingCapital !== "") {
        const accPayload = {
          id: accId,
          investor_id: newId,
          name: body.name || [body.firstName, body.lastName].filter(Boolean).join(" ") || "Main Account",
          starting_capital: Number(body.startingCapital || 0),
          total_cash_in: Number(body.totalCashIn !== undefined ? body.totalCashIn : (body.startingCapital || 0)),
          open_date: investorPayload.start_date,
          status: "Active",
          is_commission: body.isCommission === true || body.isCommission === "true",
          split_pct: splitPct,
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
          account_id: accId,
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
