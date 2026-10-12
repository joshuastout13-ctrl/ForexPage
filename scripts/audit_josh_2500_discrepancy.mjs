import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { supabase, isAuthoritativeProductionDbConfigured } from '../lib/supabase.js';
import Decimal from 'decimal.js';

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });
process.env.DATA_SOURCE = 'supabase';

async function main() {
  console.log('================================================================================');
  console.log('INVESTIGATION: JOSH STOUT $2,500 EXTERNAL CASH DISCREPANCY');
  console.log('Authoritative Supabase Project: julhldzkiqdeuuoqmvlo');
  console.log('================================================================================\n');

  if (!isAuthoritativeProductionDbConfigured()) {
    throw new Error('FATAL: Not connected to authoritative production Supabase project (julhldzkiqdeuuoqmvlo)');
  }
  console.log('✓ Authoritative production Supabase connection verified.\n');

  // 1. Resolve Josh Stout and Jerry in investors and investor_accounts
  const { data: invs } = await supabase
    .from('investors')
    .select('*')
    .or('id.in.(stout001,jerrys001),portal_username.in.(jstout,jerrys)');

  console.log('--- 1. INVESTOR RECORDS ---');
  console.log(JSON.stringify(invs, null, 2));

  const { data: accs } = await supabase
    .from('investor_accounts')
    .select('*')
    .or('id.in.(stout001,jerrys001),investor_id.in.(stout001,jerrys001)');

  console.log('\n--- 2. INVESTOR ACCOUNT RECORDS ---');
  console.log(JSON.stringify(accs, null, 2));

  // 2. Query ALL deposits for Josh Stout (stout001)
  const { data: stoutDeps } = await supabase
    .from('deposits')
    .select('*')
    .or('investor_id.eq.stout001,account_id.eq.stout001')
    .order('created_at', { ascending: true });

  console.log(`\n--- 3. ALL DEPOSITS FOR JOSH STOUT (${stoutDeps?.length || 0} records) ---`);
  console.log(JSON.stringify(stoutDeps, null, 2));

  // 3. Query ALL internal_transfers involving jerrys001 or stout001
  const { data: transfers } = await supabase
    .from('internal_transfers')
    .select('*')
    .or('source_investor_id.in.(stout001,jerrys001),target_investor_id.in.(stout001,jerrys001)')
    .order('created_at', { ascending: true });

  console.log(`\n--- 4. ALL INTERNAL TRANSFERS (${transfers?.length || 0} records) ---`);
  console.log(JSON.stringify(transfers, null, 2));

  // 4. Query ALL $2,500 records across the entire deposits table
  const { data: all2500Deps } = await supabase
    .from('deposits')
    .select('*')
    .eq('amount', 2500)
    .order('date', { ascending: true });

  console.log(`\n--- 5. ALL $2,500 DEPOSITS IN DATABASE (${all2500Deps?.length || 0} records) ---`);
  console.log(JSON.stringify(all2500Deps, null, 2));

  // 5. Query ALL $2,500 records across the entire withdrawals table
  const { data: all2500Wds } = await supabase
    .from('withdrawals')
    .select('*')
    .eq('amount', 2500)
    .order('request_date', { ascending: true });

  console.log(`\n--- 6. ALL $2,500 WITHDRAWALS IN DATABASE (${all2500Wds?.length || 0} records) ---`);
  console.log(JSON.stringify(all2500Wds, null, 2));

  // 6. Query Jerry's withdrawals across all months
  const { data: jerryWds } = await supabase
    .from('withdrawals')
    .select('*')
    .or('investor_id.eq.jerrys001,account_id.eq.jerrys001')
    .order('request_date', { ascending: true });

  console.log(`\n--- 7. ALL WITHDRAWALS FOR JERRY (${jerryWds?.length || 0} records) ---`);
  console.log(JSON.stringify(jerryWds, null, 2));
}

main().catch(console.error);
