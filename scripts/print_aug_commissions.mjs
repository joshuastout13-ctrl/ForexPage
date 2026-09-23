import { supabase } from '../lib/supabase.js';

async function run() {
  const { data: rows } = await supabase
    .from('commission_earnings')
    .select('*')
    .eq('recipient_id', 'stout001')
    .eq('year', 2026)
    .eq('month_number', 8);

  console.log(`August 2026 commission_earnings rows count: ${rows.length}`);
  let total = 0;
  rows.forEach(r => {
    total += Number(r.amount);
    console.log(`  Source: ${r.source_investor_id} (acc=${r.source_account_id}) -> Amount: $${r.amount} (key=${r.ledger_key}, rule=${r.commission_share_rule_id})`);
  });
  console.log(`TOTAL August commission_earnings in DB: $${total.toFixed(2)} (${total})`);

  // Also check month 7 (July) and month 9 (September)
  const { data: julRows } = await supabase
    .from('commission_earnings')
    .select('*')
    .eq('recipient_id', 'stout001')
    .eq('year', 2026)
    .eq('month_number', 7);
  let julTotal = 0;
  julRows.forEach(r => julTotal += Number(r.amount));
  console.log(`TOTAL July commission_earnings in DB: $${julTotal.toFixed(2)} (${julTotal})`);

  const { data: sepRows } = await supabase
    .from('commission_earnings')
    .select('*')
    .eq('recipient_id', 'stout001')
    .eq('year', 2026)
    .eq('month_number', 9);
  let sepTotal = 0;
  sepRows.forEach(r => sepTotal += Number(r.amount));
  console.log(`TOTAL September commission_earnings in DB: $${sepTotal.toFixed(2)} (${sepTotal})`);
}

run().catch(console.error);
