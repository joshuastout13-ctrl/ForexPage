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

    // 3. Delete existing commission_earnings where this investor is the SOURCE for the target year
    await supabase
      .from("commission_earnings")
      .delete()
      .ilike("source_investor_id", investorId)
      .eq("year", targetYear);

    // 4. Fetch all Deposits, Withdrawals, Fund Returns, Commission Shares, and Commission Earnings (where investor is recipient)
    const [ {data: allDeps}, {data: allWds}, {data: allReturns}, {data: commShares}, {data: commEarnings} ] = await Promise.all([
      supabase.from("deposits").select("*").ilike("investor_id", investorId).not("type", "ilike", "VOID"),
      supabase.from("withdrawals").select("*").ilike("investor_id", investorId).in("status", ["Approved", "Completed"]),
      supabase.from("monthly_returns").select("*").eq("year", targetYear),
      supabase.from("commission_shares").select("*").ilike("source_investor_id", investorId),
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
        const accId = d.account_id || accounts[0]?.id;
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
        const accId = w.account_id || accounts[0]?.id;
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

    // 5. Track balances per account
    let accountBalances = {};
    accounts.forEach(a => {
      accountBalances[a.id] = Number(a.starting_capital || 0);
    });

    const updatedRows = [];
    const commissionsToInsert = [];

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
        const totalProfit = opening * (grossPct / 100);
        const gain = totalProfit * split;

        // Process commissions for this account
        // Rule: first affected month is the first calculation period whose date range starts on or after the effective date
        const monthStart = new Date(Date.UTC(targetYear, m - 1, 1));
        
        const activeShares = (commShares || []).filter(share => {
          if (share.status === 'cancelled') return false;
          if (share.source_account_id && share.source_account_id !== acc.id) return false;
          
          const shareStart = new Date(share.effective_start_date);
          const shareEnd = share.effective_end_date ? new Date(share.effective_end_date) : null;
          
          return monthStart >= shareStart && (!shareEnd || monthStart <= shareEnd);
        });

        if (totalProfit > 0 && activeShares.length > 0) {
          for (const share of activeShares) {
            const commAmount = totalProfit * (Number(share.commission_percent) / 100);
            commissionsToInsert.push({
              recipient_id: share.recipient_investor_id,
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

        // Update balance for next month (compounding)
        accountBalances[acc.id] = adjStart + gain;
      }

      // Handle monthly draw
      const currentDraw = (existing && existing.recurring_draw !== null && existing.recurring_draw !== undefined) ? Number(existing.recurring_draw) : draw;
      if (currentDraw > 0 && accounts.length > 0) {
        accountBalances[accounts[0].id] -= currentDraw;
      }

      if (m < startMonth) continue;

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
    
    // Bulk insert commissions
    if (commissionsToInsert.length > 0) {
      const { error: commErr } = await supabase.from("commission_earnings").insert(commissionsToInsert);
      if (commErr) {
        console.error("[Recalc ERROR] Failed to insert commissions:", commErr.message);
        throw commErr;
      }
    }

    console.log(`[Recalc] Successfully updated ${updatedRows.length} months for ${investorId}`);

    return res.status(200).json({ success: true, updatedCount: updatedRows.length });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}
