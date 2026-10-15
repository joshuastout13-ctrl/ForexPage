import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { supabase } from '../lib/supabase.js';

process.env.DATA_SOURCE = 'supabase';

const fiveCases = [
  { name: 'Michele Jackson', query: { last: 'Jackson' }, amount: 10000.00, date: '2026-09-01' },
  { name: 'Jack Fuller', query: { last: 'Fuller' }, amount: 148582.25, date: '2026-10-01' },
  { name: 'Reagan Ruddell', query: { last: 'Ruddell' }, amount: 2000.00, date: '2026-09-01' },
  { name: 'Kathy Dodge', query: { last: 'Dodge' }, amount: 10530.00, date: '2026-10-01' },
  { name: 'Sheryl Alvarado', query: { portal: 'salvarado', id: 'inv_7dc0fe9a' }, amount: 60000.00, date: '2026-09-01' }
];

async function forensicFive() {
  console.log('================================================================================');
  console.log('FORENSIC AUDIT OF FIVE POTENTIAL DUPLICATE DEPOSITS');
  console.log('================================================================================\n');

  for (const c of fiveCases) {
    console.log(`--------------------------------------------------------------------------------`);
    console.log(`INVESTIGATING: ${c.name} — Target: $${c.amount.toFixed(2)} on ${c.date}`);
    console.log(`--------------------------------------------------------------------------------`);

    let inv = null;
    if (c.query.id) {
      const { data } = await supabase.from('investors').select('*').eq('id', c.query.id).single();
      inv = data;
    } else if (c.query.last) {
      const { data } = await supabase.from('investors').select('*').ilike('last_name', `%${c.query.last}%`);
      inv = data?.[0];
    }

    if (!inv) {
      console.log('INVESTOR NOT FOUND!');
      continue;
    }

    console.log('A. CANONICAL IDENTITY:');
    console.log(`   Investor ID:     ${inv.id}`);
    console.log(`   Name:            ${inv.first_name} ${inv.last_name}`);
    console.log(`   Portal Username: ${inv.portal_username}`);
    console.log(`   Email:           ${inv.email}`);
    console.log(`   Start Date:      ${inv.start_date}`);
    console.log(`   Split Pct:       ${inv.split_pct}%`);
    console.log(`   Active:          ${inv.active}`);

    // Accounts
    const { data: accounts } = await supabase.from('investor_accounts').select('*').eq('investor_id', inv.id);
    console.log('\n   ACCOUNTS:');
    for (const a of accounts || []) {
      console.log(`   - Account ID:        ${a.id}`);
      console.log(`     Account Name:      ${a.name}`);
      console.log(`     Starting Capital:  $${a.starting_capital}`);
      console.log(`     Total Cash In:     $${a.total_cash_in}`);
      console.log(`     Open Date:         ${a.open_date}`);
      console.log(`     Provenance Status: ${a.external_cash_provenance_status}`);
      console.log(`     Notes:             ${a.notes}`);
    }

    // Deposits
    const { data: deposits } = await supabase.from('deposits').select('*').eq('investor_id', inv.id).order('date', { ascending: true });
    console.log(`\nB. EXISTING DEPOSITS IN LEDGER (${deposits?.length || 0}):`);
    if (deposits && deposits.length > 0) {
      for (const d of deposits) {
        console.log(`   - Deposit ID: ${d.id}`);
        console.log(`     Amount:     $${d.amount}`);
        console.log(`     Date:       ${d.date}`);
        console.log(`     Status:     ${d.status}`);
        console.log(`     Type:       ${d.type}`);
        console.log(`     Treatment:  ${d.accounting_treatment}`);
        console.log(`     Notes:      ${d.notes}`);
      }
    } else {
      console.log('   (No rows in deposits table)');
    }

    // Withdrawals
    const { data: withdrawals } = await supabase.from('withdrawals').select('*').eq('investor_id', inv.id).order('request_date', { ascending: true });
    console.log(`\n   EXISTING WITHDRAWALS IN LEDGER (${withdrawals?.length || 0}):`);
    if (withdrawals && withdrawals.length > 0) {
      for (const w of withdrawals) {
        console.log(`   - WD ID: ${w.id}, Amount: $${w.amount}, Date: ${w.request_date}, Status: ${w.status}, Month: ${w.month_number}/${w.year}`);
      }
    } else {
      console.log('   (No withdrawals)');
    }

    // Monthly history
    const { data: history } = await supabase
      .from('investor_monthly_history')
      .select('*')
      .eq('investor_id', inv.id)
      .eq('year', 2026)
      .order('month_number', { ascending: true });

    console.log(`\nF. 2026 MONTHLY ACCOUNTING HISTORY:`);
    for (const h of history || []) {
      if (h.month_number >= 7) {
        console.log(`   Month ${h.month_number} (${h.month}): Open=$${h.opening_balance}, Dep=$${h.deposits}, Wd=$${h.withdrawals}, GrossPct=${h.gross_return_pct}%, Gain=$${h.manual_gain_amount}, End=$${h.ending_balance}, Locked=${h.locked}, Notes=${h.notes || 'none'}`);
      }
    }

    // Check month 1 to 6 as well if relevant
    const earlierRows = (history || []).filter(h => h.month_number <= 6 && (h.opening_balance > 0 || h.ending_balance > 0));
    if (earlierRows.length > 0) {
      console.log(`   Earlier non-zero months (M1-M6):`);
      for (const h of earlierRows) {
        console.log(`     Month ${h.month_number}: Open=$${h.opening_balance}, End=$${h.ending_balance}`);
      }
    }
    console.log('\n');
  }
}

forensicFive().catch(console.error);
