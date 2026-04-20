import { verifyAdminSession } from "../../lib/adminAuth.js";
import { supabase } from "../../lib/supabase.js";

export default async function handler(req, res) {
  const session = verifyAdminSession(req);
  if (!session) return res.status(401).json({ error: "Unauthorized" });

  if (req.method === "GET") {
    try {
      const { investorId, year } = req.query;
      if (!investorId) return res.status(400).json({ error: "Missing investorId" });

      const { data, error } = await supabase
        .from("investor_monthly_history")
        .select("*")
        .eq("investor_id", investorId)
        .eq("year", year || new Date().getFullYear())
        .order("month_number", { ascending: true });

      if (error) throw error;
      return res.status(200).json({ monthlyHistory: data });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === "POST") {
    try {
      const payload = req.body;
      const { 
        investorId, accountId, year, monthNumber, month,
        openingBalance, deposits, withdrawals, grossReturnPct,
        manualGainAmount, manualReturnPct, recurringDraw,
        notes, isManual
      } = payload;

      // Calculation logic
      const adjStart = (openingBalance || 0) + (deposits || 0) - (withdrawals || 0);
      let gain = 0;
      
      if (manualGainAmount !== undefined && manualGainAmount !== null) {
        gain = Number(manualGainAmount);
      } else {
        // Fallback to calculation based on gross return pct and split (if split is available)
        // For now, assume gain is provided or calculated elsewhere.
        // If manualReturnPct is provided, use that.
        const pct = (manualReturnPct !== undefined && manualReturnPct !== null) ? manualReturnPct : grossReturnPct;
        gain = adjStart * (pct / 100);
      }

      const endingBalance = adjStart + gain - (recurringDraw || 0);

      const { data, error } = await supabase
        .from("investor_monthly_history")
        .upsert({
          investor_id: investorId,
          account_id: accountId,
          year,
          month_number: monthNumber,
          month,
          opening_balance: openingBalance,
          deposits,
          withdrawals,
          gross_return_pct: grossReturnPct,
          manual_gain_amount: manualGainAmount,
          manual_return_pct: manualReturnPct,
          recurring_draw: recurringDraw,
          ending_balance: endingBalance,
          is_manual: isManual || false,
          notes,
          updated_at: new Date()
        }, { onConflict: 'investor_id,year,month_number' }) // Requires unique constraint in DB
        .select()
        .single();

      if (error) throw error;
      return res.status(200).json({ record: data });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: err.message });
    }
  }

  res.status(405).json({ error: "Method not allowed" });
}
