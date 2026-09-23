import { supabase } from '../lib/supabase.js';

async function run() {
  console.log('=== TARGETED AUDIT: stout001 ===');

  // 1. Investor record
  const { data: investors } = await supabase
    .from('investors')
    .select('*')
    .or('portal_username.eq.jstout,id.eq.stout001');
  console.log('INVESTORS:', JSON.stringify(investors, null, 2));

  // 2. Account record
  const { data: accounts } = await supabase
    .from('investor_accounts')
    .select('*')
    .or('investor_id.eq.stout001,id.eq.stout001');
  console.log('ACCOUNTS:', JSON.stringify(accounts, null, 2));

  // 3. Deposits for stout001
  const { data: deposits } = await supabase
    .from('deposits')
    .select('*')
    .or('investor_id.eq.stout001,account_id.eq.stout001')
    .order('date', { ascending: true });
  console.log('DEPOSITS for stout001:', JSON.stringify(deposits, null, 2));

  // 4. Withdrawals for stout001
  const { data: withdrawals } = await supabase
    .from('withdrawals')
    .select('*')
    .or('investor_id.eq.stout001,account_id.eq.stout001')
    .order('year', { ascending: true })
    .order('month_number', { ascending: true });
  console.log('WITHDRAWALS for stout001:', JSON.stringify(withdrawals, null, 2));

  // 5. Monthly History for stout001
  const { data: history } = await supabase
    .from('investor_monthly_history')
    .select('*')
    .eq('investor_id', 'stout001')
    .order('year', { ascending: true })
    .order('month_number', { ascending: true });
  console.log('MONTHLY HISTORY for stout001:', JSON.stringify(history, null, 2));

  // 6. Commission Earnings for stout001
  const { data: comms } = await supabase
    .from('commission_earnings')
    .select('*')
    .or('recipient_investor_id.eq.stout001,recipient_id.eq.stout001')
    .order('year', { ascending: true })
    .order('month_number', { ascending: true });
  console.log('COMMISSION EARNINGS for stout001:', JSON.stringify(comms, null, 2));
}

run().catch(console.error);
