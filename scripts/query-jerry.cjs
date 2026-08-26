require('dotenv').config({ path: '.env.local' });

async function main() {
  const { supabase } = await import('../lib/supabase.js');

  console.log('==================================================');
  console.log('1. INVESTORS TABLE (jerrys001)');
  console.log('==================================================');
  const { data: inv, error: e1 } = await supabase
    .from('investors')
    .select('*')
    .or('id.eq.jerrys001,portal_username.eq.jerrys');
  console.log(JSON.stringify(inv, null, 2));
  if (e1) console.error('Error inv:', e1);

  console.log('\n==================================================');
  console.log('2. INVESTOR_ACCOUNTS TABLE (jerrys001)');
  console.log('==================================================');
  const { data: acc, error: e2 } = await supabase
    .from('investor_accounts')
    .select('*')
    .or('investor_id.eq.jerrys001,id.eq.jerrys001');
  console.log(JSON.stringify(acc, null, 2));
  if (e2) console.error('Error acc:', e2);

  console.log('\n==================================================');
  console.log('3. INVESTOR_MONTHLY_HISTORY (jerrys001)');
  console.log('==================================================');
  const { data: hist, error: e3 } = await supabase
    .from('investor_monthly_history')
    .select('*')
    .eq('investor_id', 'jerrys001')
    .order('year', { ascending: true })
    .order('month_number', { ascending: true });
  console.log(JSON.stringify(hist, null, 2));
  if (e3) console.error('Error hist:', e3);

  console.log('\n==================================================');
  console.log('4. WITHDRAWALS TABLE (jerrys001)');
  console.log('==================================================');
  const { data: wds, error: e4 } = await supabase
    .from('withdrawals')
    .select('*')
    .eq('investor_id', 'jerrys001')
    .order('request_date', { ascending: true });
  console.log(JSON.stringify(wds, null, 2));
  if (e4) console.error('Error wds:', e4);

  console.log('\n==================================================');
  console.log('5. DEPOSITS TABLE (jerrys001)');
  console.log('==================================================');
  const { data: deps, error: e5 } = await supabase
    .from('deposits')
    .select('*')
    .eq('investor_id', 'jerrys001')
    .order('date', { ascending: true });
  console.log(JSON.stringify(deps, null, 2));
  if (e5) console.error('Error deps:', e5);

  console.log('\n==================================================');
  console.log('6. COMMISSION_EARNINGS TABLE (jerrys001)');
  console.log('==================================================');
  const { data: comms, error: e6 } = await supabase
    .from('commission_earnings')
    .select('*')
    .eq('recipient_id', 'jerrys001');
  console.log(JSON.stringify(comms, null, 2));
  if (e6) console.error('Error comms:', e6);

  console.log('\n==================================================');
  console.log('7. LIVE PACKAGE B calculate_available_withdrawal_equity_sql');
  console.log('==================================================');
  const { data: eq, error: e7 } = await supabase.rpc('calculate_available_withdrawal_equity_sql', {
    p_investor_id: 'jerrys001',
    p_account_id: 'jerrys001',
    p_effective_date: '2026-08-01',
    p_exclude_withdrawal_id: null
  });
  console.log('Result:', eq);
  console.log('Error:', e7);

  console.log('\n==================================================');
  console.log('8. MONTHLY_RETURNS TABLE (Fund Level 2026)');
  console.log('==================================================');
  const { data: returns, error: e8 } = await supabase
    .from('monthly_returns')
    .select('*')
    .eq('year', 2026)
    .order('month_number', { ascending: true });
  console.log(JSON.stringify(returns, null, 2));
  if (e8) console.error('Error returns:', e8);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
