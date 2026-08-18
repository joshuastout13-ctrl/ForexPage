import { supabase } from './lib/supabase.js';

async function main() {
  console.log("=== 1. RECIPIENT TRACE ===");
  const { data: shares } = await supabase.from('commission_shares').select('*').eq('recipient_investor_id', 'inv_57a1a49a').limit(1);
  if (shares && shares.length > 0) {
    console.log("RAW SHARE DB ROW:");
    console.log(JSON.stringify(shares[0], null, 2));
  }

  console.log("\n=== 2 & 3. BILL KIMBALL COMMISSIONS (STEVE) ===");
  const { data: earnings } = await supabase.from('commission_earnings').select('*').eq('recipient_id', 'inv_57a1a49a').eq('source_investor_id', 'inv_16a045fa').order('year', { ascending: true }).order('month_number', { ascending: true });
  console.log("BILL EARNINGS FROM STEVE:");
  if (earnings) {
    earnings.forEach(e => {
      console.log(`${e.year}-${e.month_number} - Amount: ${e.amount}`);
    });
  } else {
    console.log("No earnings found.");
  }

  const { data: history } = await supabase.from('investor_monthly_history').select('*').in('investor_id', ['inv_16a045fa', 'inv_57a1a49a']).gte('year', 2026).order('year', { ascending: true }).order('month_number', { ascending: true });
  console.log("\nHISTORY (Steve and Bill):");
  if (history) {
    history.forEach(h => {
      if (h.investor_id === 'inv_16a045fa') {
         console.log(`Steve - ${h.year}-${h.month_number}: open: ${h.opening_balance}, deps: ${h.deposit_amount}, wds: ${h.withdrawal_amount}, end: ${h.ending_balance}`);
      } else {
         console.log(`Bill - ${h.year}-${h.month_number}: open: ${h.opening_balance}, deps: ${h.deposit_amount}, wds: ${h.withdrawal_amount}, end: ${h.ending_balance}`);
      }
    });
  }

  console.log("\n=== 4. BILL CHECKPOINT ===");
  const { data: allHistory } = await supabase.from('investor_monthly_history').select('*').eq('investor_id', 'inv_57a1a49a').order('year', { ascending: true }).order('month_number', { ascending: true });
  if (allHistory && allHistory.length > 0) {
    let checkpoint = 0;
    let startFound = false;
    let cutoverBalance = 0;

    allHistory.forEach(h => {
      if (!startFound && h.year >= 2026) {
         cutoverBalance = Number(h.opening_balance);
         checkpoint = cutoverBalance;
         startFound = true;
         console.log(`STARTING BALANCE (${h.year}-${h.month_number}): ${cutoverBalance}`);
      }
      if (h.year >= 2026) {
        const o = Number(h.opening_balance || 0);
        const d = Number(h.deposit_amount || 0);
        const w = Number(h.withdrawal_amount || 0);
        const g = Number(h.gain_amount || h.manual_gain_amount || 0);
        const c = 0; // The manual/legacy rows don't explicitly list commission_earnings if it's legacy?
        // Wait, for 2026 May-July, there are commissions. 
        // Let's just calculate based on their deposits, withdrawals, and gains (since gain = profit + commissions usually for historical).
        console.log(`Month ${h.month_number} | Open ${o.toFixed(2)} +Dep ${d.toFixed(2)} -Wd ${w.toFixed(2)} +Gain ${g.toFixed(2)} = End ${Number(h.ending_balance).toFixed(2)}`);
      }
    });

    console.log(`\nJosh Checkpoint Target: $1,515,404.01`);
  }
}
main().catch(console.error);
