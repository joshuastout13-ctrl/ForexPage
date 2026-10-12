import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { supabase, isAuthoritativeProductionDbConfigured } from '../lib/supabase.js';
import Decimal from 'decimal.js';

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });
process.env.DATA_SOURCE = 'supabase';

async function traceMovements() {
  console.log('================================================================================');
  console.log('TRACE OF EVERY $2,500 MOVEMENT BETWEEN JERRY AND STOUT (MAY - OCT 2026)');
  console.log('================================================================================\n');

  const months = [
    { name: 'May 2026', num: 5, date: '2026-05-01' },
    { name: 'June 2026', num: 6, date: '2026-06-01' },
    { name: 'July 2026', num: 7, date: '2026-07-01' },
    { name: 'August 2026', num: 8, date: '2026-08-01' },
    { name: 'September 2026', num: 9, date: '2026-09-01' },
    { name: 'October 2026', num: 10, date: '2026-10-01' }
  ];

  for (const m of months) {
    console.log(`--------------------------------------------------------------------------------`);
    console.log(`MONTH: ${m.name} (${m.date})`);

    // Jerry Withdrawals for this month
    const { data: jerryWds } = await supabase
      .from('withdrawals')
      .select('*')
      .eq('investor_id', 'jerrys001')
      .or(`request_date.eq.${m.date},effective_accounting_date.eq.${m.date},and(year.eq.2026,month_number.eq.${m.num})`);

    // Stout Deposits for this month
    const { data: stoutDeps } = await supabase
      .from('deposits')
      .select('*')
      .eq('investor_id', 'stout001')
      .or(`date.eq.${m.date},effective_accounting_date.eq.${m.date}`);

    // Internal transfers for this month
    const { data: xfers } = await supabase
      .from('internal_transfers')
      .select('*')
      .eq('source_investor_id', 'jerrys001')
      .eq('target_investor_id', 'stout001')
      .or(`effective_accounting_date.eq.${m.date},and(year.eq.2026,month_number.eq.${m.num})`);

    console.log('  JERRY WITHDRAWALS (DEBIT SIDE):');
    if (!jerryWds || jerryWds.length === 0) {
      console.log('    (None found)');
    } else {
      jerryWds.forEach(w => {
        console.log(`    ID: ${w.id} | Amount: $${w.amount} | Status: ${w.status} | ReqDate: ${w.request_date} | EffDate: ${w.effective_accounting_date} | Notes: "${w.notes}" | TransferID: ${w.transfer_id} | Leg: ${w.transfer_leg} | CreatedAt: ${w.created_at} | CreatedBy: ${w.created_by}`);
      });
    }

    console.log('  STOUT DEPOSITS (CREDIT SIDE):');
    if (!stoutDeps || stoutDeps.length === 0) {
      console.log('    (None found)');
    } else {
      stoutDeps.forEach(d => {
        console.log(`    ID: ${d.id} | Amount: $${d.amount} | Status: ${d.status} | Date: ${d.date} | EffDate: ${d.effective_accounting_date} | Treatment: ${d.accounting_treatment} | Type: ${d.type} | Notes: "${d.notes}" | TransferID: ${d.transfer_id} | Leg: ${d.transfer_leg} | CreatedAt: ${d.created_at} | CreatedBy: ${d.created_by}`);
      });
    }

    console.log('  INTERNAL TRANSFER MASTER RECORD:');
    if (!xfers || xfers.length === 0) {
      console.log('    (None found)');
    } else {
      xfers.forEach(x => {
        console.log(`    ID: ${x.id} | Num: ${x.transfer_number} | Amount: $${x.amount} | Status: ${x.status} | EffDate: ${x.effective_accounting_date} | Notes: "${x.notes}" | Key: ${x.idempotency_key}`);
      });
    }
  }
}

traceMovements().catch(console.error);
