import { verifyAdminSession } from "../../lib/adminAuth.js";
import { supabase } from "../../lib/supabase.js";
import { assertPeriodUnlocked, isPeriodLockedError } from "../../lib/period-lock-guard.js";

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
        drawFulfillmentWithdrawals, isDrawLinked,
        notes, isManual
      } = payload;

      await assertPeriodUnlocked(supabase, { year: Number(year), monthNumber: Number(monthNumber) }, "edit_historical_data");

      // Calculation logic
      const adjStart = (openingBalance || 0) + (deposits || 0) - (withdrawals || 0);
      let gain = 0;
      
      if (manualGainAmount !== undefined && manualGainAmount !== null) {
        gain = Number(manualGainAmount);
      } else {
        // For now, assume gain is provided or calculated elsewhere.
        // If manualReturnPct is provided, use that.
        const pct = (manualReturnPct !== undefined && manualReturnPct !== null) ? manualReturnPct : grossReturnPct;
        gain = adjStart * (pct / 100);
      }

      // Deduplicate recurring draw only if withdrawal is linked to draw obligation
      const fulfilled = (drawFulfillmentWithdrawals !== undefined && drawFulfillmentWithdrawals !== null)
        ? Number(drawFulfillmentWithdrawals)
        : ((isDrawLinked || (notes && String(notes).toLowerCase().includes('draw')))
            ? (withdrawals || 0)
            : 0);
      const effectiveDraw = Math.max(0, (recurringDraw || 0) - fulfilled);
      const endingBalance = adjStart + gain - effectiveDraw;

      // Fail-closed guard: Cannot overwrite locked historical history records
      const { data: existingRecord } = await supabase
        .from("investor_monthly_history")
        .select("locked")
        .eq("investor_id", investorId)
        .eq("year", year)
        .eq("month_number", monthNumber)
        .maybeSingle();

      if (existingRecord && (existingRecord.locked === true || String(existingRecord.locked).toLowerCase() === 'true')) {
        return res.status(409).json({ 
          error: "PERIOD_LOCKED", 
          message: "Cannot modify locked historical monthly history record." 
        });
      }

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
      if (isPeriodLockedError(err) || String(err?.message || "").includes("PERIOD_LOCKED")) {
        return res.status(409).json({ error: "PERIOD_LOCKED", message: err.message });
      }
      console.error(err);
      return res.status(500).json({ error: err.message });
    }
  }

  res.status(405).json({ error: "Method not allowed" });
}
