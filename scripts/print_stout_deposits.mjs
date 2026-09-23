import { supabase } from '../lib/supabase.js';

async function run() {
  const { data: investors } = await supabase
    .from('investors')
    .select('*')
    .or('portal_username.eq.jstout,id.eq.stout001');
  console.log('--- INVESTORS ---');
  console.log(JSON.stringify(investors, null, 2));

  const { data: accounts } = await supabase
    .from('investor_accounts')
    .select('*')
    .or('investor_id.eq.stout001,id.eq.stout001');
  console.log('--- ACCOUNTS ---');
  console.log(JSON.stringify(accounts, null, 2));

  const { data: deposits } = await supabase
    .from('deposits')
    .select('*')
    .or('investor_id.eq.stout001,account_id.eq.stout001')
    .order('date', { ascending: true });
  console.log('--- DEPOSITS ---');
  console.log(JSON.stringify(deposits, null, 2));
}

run().catch(console.error);
