require("dotenv").config({path: ".env.local"});
import("./lib/supabase.js").then(async m => {
  const { data: accounts } = await m.supabase.from("investor_accounts").select("*");
  const { data: investors } = await m.supabase.from("investors").select("*");
  const { data: history } = await m.supabase.from("investor_monthly_history").select("*").eq("year", 2026).order("month_number", { ascending: true });
  
  const historyByInvestor = {};
  for (const h of history) {
    if (!historyByInvestor[h.investor_id]) historyByInvestor[h.investor_id] = [];
    historyByInvestor[h.investor_id].push(h);
  }

  console.log("Auditing Accounts Math (New Logic)...");
  let errors = 0;
  for (const inv of investors) {
    const invId = inv.id;
    const records = historyByInvestor[invId] || [];
    if (records.length === 0) continue;
    
    // Simplification: We assume the investor only has 1 account for this basic check
    const invAccounts = accounts.filter(a => a.investor_id === invId);
    if (invAccounts.length !== 1) continue; 
    
    const split = (invAccounts[0].split_pct !== undefined && invAccounts[0].split_pct !== null) ? (invAccounts[0].split_pct / 100) : (inv.split_pct / 100);

    for (let i = 0; i < records.length; i++) {
      const h = records[i];
      
      const adjStart = h.opening_balance; // NEW LOGIC: strictly opening balance
      const profit = adjStart * (h.gross_return_pct / 100);
      const gain = profit * split;
      
      // Expected ending
      let expectedEnding = adjStart + h.deposits - h.withdrawals + gain - (h.recurring_draw || 0);
      
      if (Math.abs(h.ending_balance - expectedEnding) > 2.0) {
        console.log(`ERROR: Inv ${invId} Month ${h.month_number} Math doesn't add up!`);
        console.log(`  Opening: ${h.opening_balance}, Deps: ${h.deposits}, Wds: ${h.withdrawals}, Draw: ${h.recurring_draw}`);
        console.log(`  Gross Pct: ${h.gross_return_pct}, Split: ${split*100}%`);
        console.log(`  Expected Ending: ${expectedEnding.toFixed(2)}, Actual Ending: ${h.ending_balance.toFixed(2)}`);
        console.log(`  Diff: ${Math.abs(h.ending_balance - expectedEnding).toFixed(2)}`);
        errors++;
      }
    }
  }
  console.log(`Audit complete. Found ${errors} math errors.`);
});
