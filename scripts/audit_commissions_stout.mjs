import { supabase } from '../lib/supabase.js';

async function run() {
  console.log('=== AUDITING COMMISSION EARNINGS FOR STOUT001 ===');

  // Query commission_earnings where recipient_id is stout001 or jstout
  const { data: commEarnings, error: commErr } = await supabase
    .from('commission_earnings')
    .select('*')
    .or('recipient_id.eq.stout001,recipient_id.eq.jstout')
    .order('year', { ascending: true })
    .order('month_number', { ascending: true });

  if (commErr) {
    console.error('Error fetching commission_earnings:', commErr);
  } else {
    console.log(`\nFound ${commEarnings.length} rows in commission_earnings for stout001/jstout:`);
    console.log(JSON.stringify(commEarnings, null, 2));

    const augRows = commEarnings.filter(r => r.year === 2026 && r.month_number === 8);
    console.log(`\nAugust 2026 commission_earnings rows count: ${augRows.length}`);
    let augSum = 0;
    augRows.forEach((r, idx) => {
      console.log(`  Row ${idx + 1}: Source=${r.source_investor_id} (acc=${r.source_account_id}), amount=$${r.amount}, rule=${r.commission_share_rule_id}, created_at=${r.created_at}`);
      augSum += Number(r.amount || 0);
    });
    console.log(`August 2026 commission_earnings SUM: $${augSum.toFixed(2)} ($${augSum})`);
  }

  // Query commission_shares
  const { data: commShares, error: sharesErr } = await supabase
    .from('commission_shares')
    .select('*')
    .or('recipient_investor_id.eq.stout001,recipient_investor_id.eq.jstout');

  if (sharesErr) {
    console.error('Error fetching commission_shares:', sharesErr);
  } else {
    console.log(`\nFound ${commShares.length} rows in commission_shares:`);
    console.log(JSON.stringify(commShares, null, 2));
  }
}

run().catch(console.error);
