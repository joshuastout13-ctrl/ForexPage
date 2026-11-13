import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { supabase, isAuthoritativeProductionDbConfigured } from '../lib/supabase.js';

process.env.DATA_SOURCE = 'supabase';

async function investigateExceptions() {
  console.log('================================================================================');
  console.log('SECTION 7 — SPREADSHEET EXCEPTIONS FORENSIC INVESTIGATION');
  console.log('Authoritative Supabase Project: julhldzkiqdeuuoqmvlo');
  console.log('================================================================================\n');

  // 1. Theresa Kruger
  console.log('--- 1. THERESA KRUGER ---');
  const { data: tkInv } = await supabase.from('investors').select('*').ilike('last_name', '%kruger%');
  console.log('Theresa Kruger Investor:', tkInv);
  if (tkInv && tkInv.length > 0) {
    const invId = tkInv[0].id;
    const { data: wds } = await supabase.from('withdrawals').select('*').eq('investor_id', invId);
    console.log('Theresa Kruger Withdrawals:', wds);
    const { data: hist } = await supabase.from('investor_monthly_history').select('*').eq('investor_id', invId).in('month_number', [8, 9, 10]);
    console.log('Theresa Kruger History:', hist);
  }

  // 2. The 5 Starting-Capital Deposits
  console.log('\n--- 2. FIVE STARTING-CAPITAL DEPOSITS ---');
  const startingCapNames = [
    { name: 'Michele Jackson', last: 'Jackson', amount: 10000, date: '2026-09-01' },
    { name: 'Jack Fuller', last: 'Fuller', amount: 148582.25, date: '2026-10-01' },
    { name: 'Reagan Ruddell', last: 'Ruddell', amount: 2000, date: '2026-09-01' },
    { name: 'Kathy Dodge', last: 'Dodge', amount: 10530, date: '2026-10-01' },
    { name: 'Sheryl Alvarado', last: 'Alvarado', amount: 60000, date: '2026-09-01' }
  ];

  for (const item of startingCapNames) {
    console.log(`\nChecking ${item.name} ($${item.amount} on ${item.date}):`);
    const { data: invs } = await supabase.from('investors').select('*').ilike('last_name', `%${item.last}%`);
    if (invs && invs.length > 0) {
      const inv = invs[0];
      const { data: accs } = await supabase.from('investor_accounts').select('*').eq('investor_id', inv.id);
      const { data: deps } = await supabase.from('deposits').select('*').eq('investor_id', inv.id);
      const { data: hist } = await supabase.from('investor_monthly_history').select('*').eq('investor_id', inv.id).in('month_number', [8, 9, 10]);
      console.log(`  Investor ID: ${inv.id}, Portal: ${inv.portal_username}`);
      console.log(`  Accounts: Starting Cap=$${accs?.[0]?.starting_capital}, OpenDate=${accs?.[0]?.open_date}, TotalCashIn=$${accs?.[0]?.total_cash_in}`);
      console.log(`  Deposits in DB (${deps?.length || 0}):`, deps?.map(d => ({ id: d.id, amount: d.amount, date: d.date, status: d.status, type: d.type, treatment: d.accounting_treatment })));
      console.log(`  History:`, hist?.map(h => ({ m: h.month_number, open: h.opening_balance, deps: h.deposits, wds: h.withdrawals, end: h.ending_balance })));
    } else {
      console.log(`  Not found in investors table`);
    }
  }

  // 3. November Transactions
  console.log('\n--- 3. NOVEMBER TRANSACTIONS ---');
  const novNames = [
    { name: 'Steve Kimball', last: 'Kimball', amount: 175279.32 },
    { name: 'Doug Patterson', last: 'Patterson', amount: 5000 },
    { name: 'Kathy Dodge', last: 'Dodge', amount: 39470 }
  ];

  for (const item of novNames) {
    console.log(`\nChecking ${item.name} (Nov 1 $${item.amount}):`);
    const { data: invs } = await supabase.from('investors').select('*').ilike('last_name', `%${item.last}%`);
    if (invs && invs.length > 0) {
      const inv = invs[0];
      const { data: deps } = await supabase.from('deposits').select('*').eq('investor_id', inv.id).gte('date', '2026-11-01');
      console.log(`  Investor ID: ${inv.id}, Future deposits in DB (${deps?.length || 0}):`, deps);
    }
  }
}

investigateExceptions().catch(console.error);
