import { supabase } from './lib/supabase.js';

async function main() {
  const { data: earning } = await supabase.from('commission_earnings').select('*').limit(1);
  console.log("EARNING KEYS:", Object.keys(earning[0]));
  
  const { data: earnings } = await supabase.from('commission_earnings').select('*').eq('recipient_investor_id', 'inv_57a1a49a').eq('source_investor_id', 'inv_16a045fa').order('period_start', { ascending: true });
  console.log("EARNINGS 2:");
  console.log(earnings);

  const { data: allBillE } = await supabase.from('commission_earnings').select('*').eq('recipient_investor_id', 'inv_57a1a49a');
  console.log("ALL BILL EARNINGS:");
  allBillE?.forEach(e => console.log(`${e.period_start} ${e.amount}`));

  const { data: allHistory } = await supabase.from('accounting_history').select('*').eq('investor_id', 'inv_57a1a49a').order('period_start', { ascending: true });
  console.log("BILL HISTORY:");
  allHistory?.forEach(h => console.log(h.period_start, h.opening_balance, h.investor_net_profit, h.commission_earnings_amount));

  const { data: sHistory } = await supabase.from('accounting_history').select('*').eq('investor_id', 'inv_16a045fa').order('period_start', { ascending: true });
  console.log("STEVE HISTORY:");
  sHistory?.forEach(h => console.log(h.period_start, h.opening_balance, h.investor_gross_profit));
}
main().catch(console.error);
