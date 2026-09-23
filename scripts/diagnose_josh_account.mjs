import { supabase } from '../lib/supabase.js';

async function run() {
  console.log('=== AUTHORITATIVE PRODUCTION AUDIT FOR JOSHUA STOUT ===');

  // 1. Find the investor records matching jstout / Joshua Stout
  const { data: investors, error: invErr } = await supabase
    .from('investors')
    .select('*')
    .or('portal_username.ilike.%stout%,id.ilike.%stout%,first_name.ilike.%josh%');

  if (invErr) {
    console.error('Error fetching investors:', invErr);
    process.exit(1);
  }
  console.log('\n--- INVESTOR RECORDS FOUND ---');
  console.log(JSON.stringify(investors, null, 2));

  // 2. Find all accounts linked
  const investorIds = investors.map(i => i.investor_id || i.id);
  const { data: accounts, error: accErr } = await supabase
    .from('investor_accounts')
    .select('*')
    .in('investor_id', investorIds);

  if (accErr) {
    console.error('Error fetching accounts:', accErr);
    process.exit(1);
  }
  console.log('\n--- ACCOUNTS FOUND ---');
  console.log(JSON.stringify(accounts, null, 2));

  const accountIds = accounts.map(a => a.id);
  const allTargetIds = [...new Set([...investorIds, ...accountIds])];

  // 3. Query ALL deposits
  const { data: deposits, error: depErr } = await supabase
    .from('deposits')
    .select('*')
    .or(`investor_id.in.(${allTargetIds.map(id => `"${id}"`).join(',')}),account_id.in.(${allTargetIds.map(id => `"${id}"`).join(',')})`);

  if (depErr) {
    console.error('Error fetching deposits:', depErr);
    process.exit(1);
  }
  console.log('\n--- ALL DEPOSITS FOUND ---');
  console.log(JSON.stringify(deposits, null, 2));

  // 4. Query ALL withdrawals
  const { data: withdrawals, error: wdErr } = await supabase
    .from('withdrawals')
    .select('*')
    .or(`investor_id.in.(${allTargetIds.map(id => `"${id}"`).join(',')}),account_id.in.(${allTargetIds.map(id => `"${id}"`).join(',')})`);

  if (wdErr) {
    console.error('Error fetching withdrawals:', wdErr);
    process.exit(1);
  }
  console.log('\n--- ALL WITHDRAWALS FOUND ---');
  console.log(JSON.stringify(withdrawals, null, 2));

  // 5. Query ALL history rows
  const { data: history, error: histErr } = await supabase
    .from('investor_history')
    .select('*')
    .in('investor_id', allTargetIds)
    .order('year', { ascending: true })
    .order('month_number', { ascending: true });

  if (histErr) {
    console.error('Error fetching history:', histErr);
    process.exit(1);
  }
  console.log('\n--- ALL HISTORY ROWS FOUND ---');
  console.log(JSON.stringify(history, null, 2));

  // 6. Query cutover adjustments
  const { data: cutovers, error: cutErr } = await supabase
    .from('cutover_adjustments')
    .select('*')
    .in('investor_id', allTargetIds);

  if (cutErr) {
    console.error('Error fetching cutovers:', cutErr);
  } else {
    console.log('\n--- ALL CUTOVERS FOUND ---');
    console.log(JSON.stringify(cutovers, null, 2));
  }

  // 7. Query commission earnings
  const { data: commissions, error: commErr } = await supabase
    .from('commission_earnings')
    .select('*')
    .or(`recipient_investor_id.in.(${allTargetIds.map(id => `"${id}"`).join(',')}),source_investor_id.in.(${allTargetIds.map(id => `"${id}"`).join(',')})`);

  if (commErr) {
    console.error('Error fetching commissions:', commErr);
  } else {
    console.log('\n--- ALL COMMISSIONS FOUND ---');
    console.log(JSON.stringify(commissions, null, 2));
  }
}

run().catch(console.error);
