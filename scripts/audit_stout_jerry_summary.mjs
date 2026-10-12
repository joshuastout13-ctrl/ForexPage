import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { supabase, isAuthoritativeProductionDbConfigured } from '../lib/supabase.js';
import Decimal from 'decimal.js';

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });
process.env.DATA_SOURCE = 'supabase';

async function main() {
  console.log('=== FORENSIC ANALYSIS OF JOSH STOUT & JERRY RECORDS ===\n');

  // 1. Investors & Accounts
  const { data: invs } = await supabase.from('investors').select('id, portal_username, first_name, last_name, email, split_pct, start_date').in('id', ['stout001', 'jerrys001']);
  console.log('INVESTORS:');
  console.table(invs);

  const { data: accs } = await supabase.from('investor_accounts').select('id, investor_id, starting_capital, open_date, total_cash_in, external_cash_provenance_status, provenance_certified_at').in('id', ['stout001', 'jerrys001']);
  console.log('ACCOUNTS:');
  console.table(accs);

  // 2. Josh Stout Deposits
  const { data: deps } = await supabase.from('deposits').select('id, amount, date, effective_accounting_date, status, type, accounting_treatment, notes, created_at, created_by, idempotency_key, transfer_id, transfer_leg').eq('investor_id', 'stout001').order('created_at', { ascending: true });
  console.log('\nJOSH STOUT DEPOSITS (ALL):');
  console.table(deps.map(d => ({
    id: d.id,
    amount: d.amount,
    date: d.date,
    effDate: d.effective_accounting_date,
    status: d.status,
    treatment: d.accounting_treatment,
    notes: (d.notes || '').slice(0, 30),
    createdAt: d.created_at,
    createdBy: d.created_by,
    xferId: d.transfer_id,
    leg: d.transfer_leg
  })));

  // 3. Internal Transfers
  const { data: xfers } = await supabase.from('internal_transfers').select('*');
  console.log('\nINTERNAL TRANSFERS:');
  console.table(xfers.map(x => ({
    id: x.id,
    num: x.transfer_number,
    src: x.source_investor_id,
    tgt: x.target_investor_id,
    amount: x.amount,
    effDate: x.effective_accounting_date,
    month: `${x.year}-${x.month_number}`,
    status: x.status,
    key: x.idempotency_key,
    createdAt: x.created_at
  })));

  // 4. Jerry Withdrawals
  const { data: jerryWds } = await supabase.from('withdrawals').select('id, amount, request_date, effective_accounting_date, year, month_number, status, notes, created_at, created_by, transfer_id, transfer_leg').eq('investor_id', 'jerrys001').order('created_at', { ascending: true });
  console.log('\nJERRY WITHDRAWALS (ALL):');
  console.table(jerryWds.map(w => ({
    id: w.id,
    amount: w.amount,
    reqDate: w.request_date,
    effDate: w.effective_accounting_date,
    period: `${w.year}-${w.month_number}`,
    status: w.status,
    notes: (w.notes || '').slice(0, 30),
    createdAt: w.created_at,
    createdBy: w.created_by,
    xferId: w.transfer_id,
    leg: w.transfer_leg
  })));
}

main().catch(console.error);
