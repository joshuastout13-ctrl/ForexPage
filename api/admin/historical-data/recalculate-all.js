import { verifyAdminSession } from "../../../lib/adminAuth.js";
import { supabase } from "../../../lib/supabase.js";

export default async function handler(req, res) {
  const session = verifyAdminSession(req);
  if (!session) return res.status(401).json({ error: "Unauthorized" });

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { year } = req.body;
    const targetYear = Number(year || new Date().getFullYear());

    // 1. Fetch all active investors
    const { data: investors, error: invErr } = await supabase
      .from("investors")
      .select("id, split_pct, monthly_draw, start_date")
      .eq("status", "Active");
    if (invErr) throw invErr;

    // 2. Fetch all required data globally
    const [ {data: allDeps}, {data: allWds}, {data: allReturns}, {data: commRules}, {data: commEarnings}, {data: allAccounts} ] = await Promise.all([
      supabase.from("deposits").select("*"),
      supabase.from("withdrawals").select("*").in("status", ["Approved", "Completed"]),
      supabase.from("monthly_returns").select("*").eq("year", targetYear),
      supabase.from("commission_rules").select("*"),
      supabase.from("commission_earnings").select("*").eq("year", targetYear),
      supabase.from("investor_accounts").select("*").eq("status", "Active")
    ]);

    // Group returns by month
    const fundRetByM = {};
    allReturns?.forEach(r => { fundRetByM[r.month_number] = Number(r.gross_return_pct || 0); });

    let totalUpdated = 0;
    
    // We process each investor
    for (const inv of investors) {
      const investorId = inv.id;
      const investorSplit = (inv.split_pct || 100) / 100;
      const draw = inv.monthly_draw || 0;
      let startDate = null;
      if (inv.start_date) {
        const d = new Date(inv.start_date);
        if (!isNaN(d.getTime())) {
          startDate = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12, 0, 0));
        }
      }

      const accounts = allAccounts.filter(a => a.investor_id === investorId);
      
      const invDeps = allDeps.filter(d => d.investor_id?.toLowerCase() === investorId.toLowerCase());
      const invWds = allWds.filter(w => w.investor_id?.toLowerCase() === investorId.toLowerCase());
      const invCommRules = commRules.filter(r => r.investor_id?.toLowerCase() === investorId.toLowerCase());
      const invCommEarnings = commEarnings.filter(e => e.recipient_id?.toLowerCase() === investorId.toLowerCase());

      const depsByMAcc = {};
      invDeps.forEach(d => {
        const dt = new Date(d.date);
        if(dt.getFullYear() === targetYear) {
          const m = dt.getMonth() + 1;
          const accId = d.account_id;
          if (accId) {
            if (!depsByMAcc[m]) depsByMAcc[m] = {};
            depsByMAcc[m][accId] = (depsByMAcc[m][accId] || 0) + Number(d.amount);
          }
        }
      });

      const wdsByMAcc = {};
      invWds.forEach(w => {
        if(w.effective_year === targetYear || (!w.effective_year && targetYear === new Date().getFullYear())) {
          const m = w.month_number;
          const accId = w.account_id;
          if (accId) {
            if (!wdsByMAcc[m]) wdsByMAcc[m] = {};
            wdsByMAcc[m][accId] = (wdsByMAcc[m][accId] || 0) + Number(w.amount || 0);
          }
        }
      });

      const commEarningsByM = {};
      invCommEarnings.forEach(e => {
        commEarningsByM[e.month_number] = (commEarningsByM[e.month_number] || 0) + Number(e.amount || 0);
      });

      // Fetch history to see if it's manual
      const { data: history } = await supabase
        .from("investor_monthly_history")
        .select("*")
        .eq("investor_id", investorId)
        .eq("year", targetYear);

      let accountBalances = {};
      accounts.forEach(a => { accountBalances[a.id] = Number(a.starting_capital || 0); });

      for (let m = 1; m <= 12; m++) {
        const isStarted = !startDate || (targetYear > startDate.getUTCFullYear()) || 
                          (targetYear === startDate.getUTCFullYear() && m >= (startDate.getUTCMonth() + 1));
        
        const existing = history?.find(h => h.month_number === m);
        const earnedPrevMonth = (m > 1) ? (commEarningsByM[m - 1] || 0) : 0;
        
        const commAcc = accounts.find(a => a.is_commission) || accounts[0];
        if (commAcc && earnedPrevMonth > 0) {
          accountBalances[commAcc.id] += earnedPrevMonth;
        }

        let totalOpening = 0;
        let totalGain = 0;
        let totalDeps = 0;
        let totalWds = 0;

        for (const acc of accounts) {
          const opening = accountBalances[acc.id];
          const deps = (depsByMAcc[m] && depsByMAcc[m][acc.id]) || 0;
          const wds = (wdsByMAcc[m] && wdsByMAcc[m][acc.id]) || 0;
          
          const grossPct = isStarted ? (fundRetByM[m] || 0) : 0;
          const split = (acc.split_pct !== undefined && acc.split_pct !== null) ? (acc.split_pct / 100) : investorSplit;
          
          const adjStart = opening + deps - wds;
          const totalProfit = adjStart * (grossPct / 100);
          const gain = totalProfit * split;

          const accRules = invCommRules.filter(r => !r.account_id || r.account_id === acc.id);
          if (totalProfit > 0 && accRules.length > 0) {
            for (const rule of accRules) {
              const commAmount = totalProfit * (Number(rule.percent) / 100);
              
              await supabase.from("commission_earnings")
                .delete()
                .eq("recipient_id", rule.recipient_id)
                .eq("source_investor_id", investorId)
                .eq("year", targetYear)
                .eq("month_number", m);

              await supabase.from("commission_earnings").insert({
                recipient_id: rule.recipient_id,
                source_investor_id: investorId,
                year: targetYear,
                month_number: m,
                amount: commAmount
              });
            }
          }

          totalOpening += opening;
          totalGain += gain;
          totalDeps += deps;
          totalWds += wds;

          accountBalances[acc.id] = adjStart + gain;
        }

        const currentDraw = (existing && existing.recurring_draw !== null && existing.recurring_draw !== undefined) ? Number(existing.recurring_draw) : draw;
        if (currentDraw > 0 && accounts.length > 0) {
          accountBalances[accounts[0].id] -= currentDraw;
        }

        const ending = accounts.length > 0 ? Object.values(accountBalances).reduce((a, b) => a + b, 0) : 0;
        
        const monthNames = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        
        await supabase
          .from("investor_monthly_history")
          .upsert({
            investor_id: investorId,
            year: targetYear,
            month_number: m,
            month: monthNames[m],
            opening_balance: totalOpening,
            deposits: totalDeps,
            withdrawals: totalWds,
            gross_return_pct: fundRetByM[m] || 0,
            manual_gain_amount: existing ? existing.manual_gain_amount : null,
            manual_return_pct: existing ? existing.manual_return_pct : null,
            recurring_draw: currentDraw,
            ending_balance: ending,
            is_manual: existing ? !!existing.manual_gain_amount : false,
            updated_at: new Date()
          }, { onConflict: 'investor_id,year,month_number' });
          
        totalUpdated++;
      }
    }

    return res.status(200).json({ success: true, updatedCount: totalUpdated });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}
