import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { supabase } from '../lib/supabase.js';

async function scanAllTransactions() {
  const { data: deps } = await supabase.from('deposits').select('*');
  const { data: wds } = await supabase.from('withdrawals').select('*');

  console.log('--- ALL DEPOSITS (' + deps.length + ') ---');
  const dGroups = {};
  deps.forEach(d => {
    const isVoid = String(d.type || '').toUpperCase() === 'VOID' || String(d.status || '').toUpperCase() === 'VOID';
    const k = d.investor_id + '_' + d.amount + '_' + (d.date || d.effective_accounting_date);
    if (!dGroups[k]) dGroups[k] = [];
    dGroups[k].push({ ...d, isVoid });
  });

  for (const [k, rows] of Object.entries(dGroups)) {
    if (rows.length > 1) {
      console.log('Deposit Group > 1:', k);
      rows.forEach(r => console.log('  ', r.id, r.amount, r.date, r.type, r.status, r.accounting_treatment, r.isVoid ? '(VOID)' : '(ACTIVE)'));
    }
  }

  console.log('\n--- ALL WITHDRAWALS (' + wds.length + ') ---');
  const wGroups = {};
  wds.forEach(w => {
    const isCancelled = String(w.status || '').toLowerCase() === 'cancelled';
    const k = w.investor_id + '_' + w.amount + '_' + (w.request_date || w.effective_accounting_date);
    if (!wGroups[k]) wGroups[k] = [];
    wGroups[k].push({ ...w, isCancelled });
  });

  for (const [k, rows] of Object.entries(wGroups)) {
    if (rows.length > 1) {
      console.log('Withdrawal Group > 1:', k);
      rows.forEach(r => console.log('  ', r.id, r.amount, r.request_date, r.status, r.isCancelled ? '(CANCELLED)' : '(ACTIVE)'));
    }
  }
}
scanAllTransactions();
