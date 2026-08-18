import { supabase } from './lib/supabase.js';

async function main() {
  let { data, error } = await supabase.from('commission_earnings').select('*').eq('recipient_id', 'inv_57a1a49a').eq('source_investor_id', 'inv_16a045fa');
  console.log("EARNINGS ERROR:", error);
  console.log("EARNINGS:", data?.length);
  if (data?.length > 0) console.log(data);

  let historyRes = await supabase.from('accounting_history').select('*').eq('investor_id', 'inv_16a045fa');
  console.log("HISTORY ERROR:", historyRes.error);
  console.log("HISTORY STEVE:", historyRes.data?.length);
  
  let historyRes2 = await supabase.from('accounting_history').select('*').eq('investor_id', 'inv_57a1a49a');
  console.log("HISTORY BILL:", historyRes2.data?.length);

  // Maybe the IDs are different? Let's check investors
  let invRes = await supabase.from('investors').select('id, portal_username, first_name, last_name').in('id', ['inv_16a045fa', 'inv_57a1a49a']);
  console.log("INVESTORS:", invRes.data);
  
  // Let's query all commission_earnings for 2026 for Bill just in case recipient_id is different.
  let billE = await supabase.from('commission_earnings').select('*').eq('recipient_id', 'inv_57a1a49a');
  console.log("BILL ALL E:", billE.data?.length);
}
main().catch(console.error);
