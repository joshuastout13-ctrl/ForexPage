import { verifyAdminSession } from "../../../lib/adminAuth.js";
import { supabase } from "../../../lib/supabase.js";

export default async function handler(req, res) {
  const session = verifyAdminSession(req);
  if (!session) return res.status(401).json({ error: "Unauthorized" });

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { investorId, year, startMonthNumber } = req.body;
    if (!investorId) return res.status(400).json({ error: "Missing investorId" });

    const startMonth = Number(startMonthNumber || 1);
    const targetYear = Number(year || new Date().getFullYear());

    // 1. Get Investor split and draw
    const { data: inv, error: invErr } = await supabase
      .from("investors")
      .select("split_pct, recurring_monthly_draw")
      .eq("id", investorId)
      .single();
    if (invErr) throw invErr;

    const split = (inv.split_pct || 100) / 100;
    const draw = inv.recurring_monthly_draw || 0;

    // 2. Fetch all historical records for this year to see what's already there
    const { data: history, error: histErr } = await supabase
      .from("investor_monthly_history")
      .select("*")
      .eq("investor_id", investorId)
      .eq("year", targetYear)
      .order("month_number", { ascending: true });
    if (histErr) throw histErr;

    // 3. Fetch all Deposits, Withdrawals, Fund Returns, Commission Rules, and Commission Earnings
    const [ {data: allDeps}, {data: allWds}, {data: allReturns}, {data: commRules}, {data: commEarnings} ] = await Promise.all([
      supabase.from("deposits").select("*").eq("investor_id", investorId),
      supabase.from("withdrawals").select("*").eq("investor_id", investorId).eq("status", "Approved"),
      supabase.from("monthly_returns").select("*").eq("year", targetYear),
      supabase.from("commission_rules").select("*").eq("investor_id", investorId),
      supabase.from("commission_earnings").select("*").eq("recipient_id", investorId).eq("year", targetYear)
    ]);

    // Map data by month
    const depsByM = {}; allDeps?.forEach(d => {
      const dt = new Date(d.date); 
      if(dt.getFullYear() === targetYear) {
        const m = dt.getMonth() + 1;
        depsByM[m] = (depsByM[m] || 0) + Number(d.amount);
      }
    });
    const wdsByM = {}; allWds?.forEach(w => {
      if(w.effective_year === targetYear || (!w.effective_year && targetYear === new Date().getFullYear())) {
        wdsByM[w.month_number] = (wdsByM[w.month_number] || 0) + Number(w.amount || 0);
      }
    });
    const fundRetByM = {}; allReturns?.forEach(r => {
      fundRetByM[r.month_number] = Number(r.gross_return_pct || 0);
    });
    const commEarningsByM = {}; commEarnings?.forEach(e => {
      commEarningsByM[e.month_number] = (commEarningsByM[e.month_number] || 0) + Number(e.amount || 0);
    });

    // 4. Iterate from startMonth to 12
    let currentBalance = 0;
    
    // Find the opening balance for the start month
    const prevMonth = history.find(h => h.month_number === startMonth - 1);
    if (prevMonth) {
      currentBalance = Number(prevMonth.ending_balance);
    } else if (startMonth === 1) {
      // Get starting capital if month 1
      const { data: accs } = await supabase.from("investor_accounts").select("starting_capital").eq("investor_id", investorId).eq("status", "Active");
      currentBalance = accs?.reduce((sum, a) => sum + Number(a.starting_capital), 0) || 0;
    } else {
      // Fallback: try to find the earliest history row if startMonth > 1
      const firstRow = history.find(h => h.month_number === startMonth);
      if (firstRow) currentBalance = Number(firstRow.opening_balance);
    }

    const updatedRows = [];

    for (let m = startMonth; m <= 12; m++) {
      const existing = history.find(h => h.month_number === m);
      
      // Add commissions earned in the PREVIOUS month to the opening balance of THIS month
      // Only do this if we are carrying over from m-1. For startMonth, currentBalance already includes it if it was in the DB.
      // Wait, if we are looping, currentBalance is the ending_balance of m-1.
      const earnedPrevMonth = (m > 1) ? (commEarningsByM[m - 1] || 0) : 0;
      if (m > startMonth) {
        currentBalance += earnedPrevMonth;
      } else if (m === startMonth && startMonth > 1 && !existing) {
         // If we are starting mid-year and regenerating, we'd need it. But usually history exists.
         currentBalance += earnedPrevMonth;
      }
      
      const opening = currentBalance;
      const deps = depsByM[m] || (existing ? Number(existing.deposits) : 0);
      const wds = wdsByM[m] || (existing ? Number(existing.withdrawals) : 0);
      const grossPct = fundRetByM[m] || (existing ? Number(existing.gross_return_pct) : 0);
      
      const adjStart = opening + deps - wds;
      let gain = 0;
      let isManual = false;
      let totalProfit = adjStart * (grossPct / 100);

      if (existing && existing.manual_gain_amount !== null && existing.manual_gain_amount !== undefined) {
        gain = Number(existing.manual_gain_amount);
        isManual = true;
      } else {
        const effPct = grossPct * split;
        gain = adjStart * (effPct / 100);
      }

      // Process commission payouts if profit > 0
      if (totalProfit > 0 && commRules && commRules.length > 0) {
        for (const rule of commRules) {
          const commAmount = totalProfit * (Number(rule.percent) / 100);
          
          // Upsert commission earnings
          await supabase.from("commission_earnings").upsert({
            recipient_id: rule.recipient_id,
            source_investor_id: investorId,
            year: targetYear,
            month_number: m,
            amount: commAmount
          }, { onConflict: 'recipient_id,source_investor_id,year,month_number' }).select();
        }
      }

      const ending = adjStart + gain - draw;
      
      const monthNames = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
      
      const rowPayload = {
        investor_id: investorId,
        year: targetYear,
        month_number: m,
        month: monthNames[m],
        opening_balance: opening,
        deposits: deps,
        withdrawals: wds,
        gross_return_pct: grossPct,
        manual_gain_amount: existing ? existing.manual_gain_amount : null,
        manual_return_pct: existing ? existing.manual_return_pct : null,
        recurring_draw: draw,
        ending_balance: ending,
        is_manual: isManual,
        updated_at: new Date()
      };

      const { data: up, error: upErr } = await supabase
        .from("investor_monthly_history")
        .upsert(rowPayload, { onConflict: 'investor_id,year,month_number' })
        .select()
        .single();
      
      if (upErr) throw upErr;
      updatedRows.push(up);
      currentBalance = ending;
    }

    return res.status(200).json({ success: true, updatedCount: updatedRows.length });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}
