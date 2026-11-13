process.env.DATA_SOURCE = 'supabase';
import { supabase } from '../lib/supabase.js';

async function auditTed() {
  console.log('=== DEEP DIVE AUDIT: TED BOARDWALK (inv_a79798ca) ===\n');

  // 1. Investor profile
  const { data: inv } = await supabase.from('investors').select('*').eq('id', 'inv_a79798ca').single();
  console.log('Investor Profile:', inv);

  // 2. Accounts
  const { data: accs } = await supabase.from('investor_accounts').select('*').eq('investor_id', 'inv_a79798ca');
  console.log('\nAccounts:', accs);

  // 3. Deposits
  const { data: deps } = await supabase.from('deposits').select('*').eq('investor_id', 'inv_a79798ca').order('date');
  console.log('\nDeposits:', deps);

  // 4. Withdrawals
  const { data: wds } = await supabase.from('withdrawals').select('*').eq('investor_id', 'inv_a79798ca').order('date');
  console.log('\nWithdrawals:', wds);

  // 5. Monthly History (all months)
  const { data: hist } = await supabase.from('investor_monthly_history').select('*').eq('investor_id', 'inv_a79798ca').eq('year', 2026).order('month_number');
  console.log('\nInvestor Monthly History (2026):');
  hist.forEach(h => {
    console.log(`M${h.month_number} (${h.month.padEnd(9)}): Open=${Number(h.opening_balance).toFixed(2).padStart(10)} | Deps=${Number(h.deposits).toFixed(2).padStart(8)} | Wds=${Number(h.withdrawals).toFixed(2).padStart(8)} | Return=${Number(h.gross_return_pct).toFixed(2).padStart(5)}% | Ending=${Number(h.ending_balance).toFixed(2).padStart(10)} | Locked=${h.locked} | Manual=${h.is_manual}`);
  });

  // 6. Commission Earnings (all months)
  const { data: ce } = await supabase.from('commission_earnings').select('*').eq('recipient_id', 'inv_a79798ca').eq('year', 2026).order('month_number');
  console.log('\nCommission Earnings Summary by Month:');
  const ceByM = {};
  ce.forEach(e => {
    const st = e.status || 'ACTIVE';
    if (!ceByM[e.month_number]) ceByM[e.month_number] = { active: 0, super: 0, activeCnt: 0, superCnt: 0 };
    if (st.toUpperCase() === 'ACTIVE') {
      ceByM[e.month_number].active += Number(e.amount);
      ceByM[e.month_number].activeCnt++;
    } else {
      ceByM[e.month_number].super += Number(e.amount);
      ceByM[e.month_number].superCnt++;
    }
  });
  console.log(ceByM);

  // 7. Cutovers table check
  const { data: cutovers, error: cutErr } = await supabase.from('investor_cutover_adjustments').select('*').eq('investor_id', 'inv_a79798ca');
  if (cutErr) console.log('Cutover query error:', cutErr.message);
  else console.log('\nCutover Adjustments:', cutovers);
}

auditTed().catch(console.error);
