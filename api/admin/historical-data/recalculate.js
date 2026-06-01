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
    let currentBalance = 0;

    // 1. Get Investor split, draw, and start date
    const { data: inv, error: invErr } = await supabase
      .from("investors")
      .select("split_pct, monthly_draw, start_date")
      .ilike("id", investorId)
      .single();
    if (invErr) throw invErr;

    const investorSplit = (inv.split_pct || 100) / 100;
    const draw = inv.monthly_draw || 0;
    
    let startDate = null;
    if (inv.start_date) {
      const d = new Date(inv.start_date);
      if (!isNaN(d.getTime())) {
        startDate = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12, 0, 0));
      }
    }

    // 1b. Get Accounts with their splits
    const { data: accounts, error: accsErr } = await supabase
      .from("investor_accounts")
      .select("*")
      .eq("investor_id", investorId)
      .eq("status", "Active");
    if (accsErr) throw accsErr;

    // 2. Fetch all historical records for this year
    const { data: history, error: histErr } = await supabase
      .from("investor_monthly_history")
      .select("*")
      .eq("investor_id", investorId)
      .eq("year", targetYear)
      .order("month_number", { ascending: true });
    if (histErr) throw histErr;

    // 3. Fetch all Deposits, Withdrawals, Fund Returns, Commission Rules, and Commission Earnings
    const [ {data: allDeps}, {data: allWds}, {data: allReturns}, {data: commRules}, {data: commEarnings} ] = await Promise.all([
      supabase.from("deposits").select("*").ilike("investor_id", investorId),
      supabase.from("withdrawals").select("*").ilike("investor_id", investorId).in("status", ["Approved", "Completed"]),
      supabase.from("monthly_returns").select("*").eq("year", targetYear),
      supabase.from("commission_rules").select("*").ilike("investor_id", investorId),
      supabase.from("commission_earnings").select("*").ilike("recipient_id", investorId).eq("year", targetYear)
    ]);

    // Map data by month and account
    const depsByM = {}; 
    const depsByMAcc = {};
    allDeps?.forEach(d => {
      const dt = new Date(d.date); 
      if(dt.getFullYear() === targetYear) {
        const m = dt.getMonth() + 1;
        const amt = Number(d.amount);
        const accId = d.account_id;
        depsByM[m] = (depsByM[m] || 0) + amt;
        if (accId) {
          if (!depsByMAcc[m]) depsByMAcc[m] = {};
          depsByMAcc[m][accId] = (depsByMAcc[m][accId] || 0) + amt;
        }
      }
    });

    const wdsByM = {}; 
    const wdsByMAcc = {};
    allWds?.forEach(w => {
      if(w.effective_year === targetYear || (!w.effective_year && targetYear === new Date().getFullYear())) {
        const m = w.month_number;
        const amt = Number(w.amount || 0);
        const accId = w.account_id;
        wdsByM[m] = (wdsByM[m] || 0) + amt;
        if (accId) {
          if (!wdsByMAcc[m]) wdsByMAcc[m] = {};
          wdsByMAcc[m][accId] = (wdsByMAcc[m][accId] || 0) + amt;
        }
      }
    });

    const fundRetByM = {}; allReturns?.forEach(r => {
      fundRetByM[r.month_number] = Number(r.gross_return_pct || 0);
    });
    const commEarningsByM = {}; commEarnings?.forEach(e => {
      commEarningsByM[e.month_number] = (commEarningsByM[e.month_number] || 0) + Number(e.amount || 0);
    });

    // 4. Track balances per account
    let accountBalances = {};
    accounts.forEach(a => {
      accountBalances[a.id] = Number(a.starting_capital || 0);
    });

    // If startMonth > 1, we need to initialize accountBalances from a previous history row? 
    // This is hard because history is currently aggregated. 
    // We'll assume the starting_capital is the source of truth for the beginning of time.
    // To handle startMonth > 1 properly with multiple accounts, we'd need per-account history.
    // For now, we'll proportion the opening balance if multiple accounts exist.

    const updatedRows = [];

    for (let m = 1; m <= 12; m++) {
      const isStarted = !startDate || (targetYear > startDate.getUTCFullYear()) || 
                        (targetYear === startDate.getUTCFullYear() && m >= (startDate.getUTCMonth() + 1));

      const existing = history.find(h => h.month_number === m);
      const earnedPrevMonth = (m > 1) ? (commEarningsByM[m - 1] || 0) : 0;
      
      // Add commissions to the FIRST commission account found, or just the first account
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
        
        // If the investor hasn't started yet, grossPct is 0
        const grossPct = isStarted ? (fundRetByM[m] || 0) : 0;
        const split = (acc.split_pct !== undefined && acc.split_pct !== null) ? (acc.split_pct / 100) : investorSplit;
        
        const adjStart = opening + deps - wds;
        const totalProfit = adjStart * (grossPct / 100);
        const gain = totalProfit * split;

        // Process commissions for this account
        const accRules = commRules?.filter(r => !r.account_id || r.account_id === acc.id);
        if (totalProfit > 0 && accRules && accRules.length > 0) {
          for (const rule of accRules) {
            const commAmount = totalProfit * (Number(rule.percent) / 100);
            // Delete existing to mimic upsert without requiring unique constraint
            await supabase.from("commission_earnings")
              .delete()
              .eq("recipient_id", rule.recipient_id)
              .eq("source_investor_id", investorId)
              .eq("year", targetYear)
              .eq("month_number", m);

            const { error: commErr } = await supabase.from("commission_earnings").insert({
              recipient_id: rule.recipient_id,
              source_investor_id: investorId,
              year: targetYear,
              month_number: m,
              amount: commAmount
            });
            if (commErr) {
              console.error("[Recalc ERROR] Failed to insert commission:", commErr.message, commErr);
              throw commErr;
            }
          }
        }

        totalOpening += opening;
        totalGain += gain;
        totalDeps += deps;
        totalWds += wds;

        // Update balance for next month (compounding)
        // Draw is still handled at investor level below
        accountBalances[acc.id] = adjStart + gain;
      }

      // Handle monthly draw (subtract from first account or split proportionally)
      const currentDraw = (existing && existing.recurring_draw !== null && existing.recurring_draw !== undefined) ? Number(existing.recurring_draw) : draw;
      if (currentDraw > 0 && accounts.length > 0) {
        accountBalances[accounts[0].id] -= currentDraw;
      }

      if (m < startMonth) continue; // Skip saving if before startMonth

      const ending = Object.values(accountBalances).reduce((a, b) => a + b, 0);
      
      const monthNames = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
      
      const rowPayload = {
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
      };

      console.log(`[Recalc] Month ${m}: Opening ${totalOpening}, Ending ${ending}`);
      
      const { data: up, error: upErr } = await supabase
        .from("investor_monthly_history")
        .upsert(rowPayload, { onConflict: 'investor_id,year,month_number' })
        .select()
        .single();
      
      if (upErr) {
        console.error(`[Recalc] Failed month ${m}:`, upErr.message);
        throw upErr;
      }
      
      updatedRows.push(up);
      currentBalance = ending;
    }
    
    console.log(`[Recalc] Successfully updated ${updatedRows.length} months for ${investorId}`);

    return res.status(200).json({ success: true, updatedCount: updatedRows.length });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}
