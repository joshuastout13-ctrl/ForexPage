import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { supabase } from '../lib/supabase.js';

async function checkAll8() {
  console.log('=== DEEP INSPECTION OF ALL 8 AUTHORIZED ACCOUNTS ===\n');

  const targets = [
    { name: 'Brad Holly', invId: 'inv_5deeea21', accId: 'bholly', type: 'DEPOSIT', amount: 278000, date: '2026-10-01' },
    { name: 'Steve Kimball', invId: 'inv_16a045fa', accId: 'skimbell', type: 'WITHDRAWAL', amount: 6000, date: '2026-10-01' },
    { name: 'Dale Waite', invId: 'inv_60ed0c32', accId: 'dwaite', type: 'DEPOSIT', amount: 6500, date: '2026-10-01' },
    { name: 'Josh Stout', invId: 'stout001', accId: 'stout001', type: 'WITHDRAWAL', amount: 20000, date: '2026-10-01' },
    { name: 'Glenn Maddocks', invId: 'inv_5a509c6a', accId: 'gmaddocks', type: 'DEPOSIT', amount: 568277, date: '2026-10-01' },
    { name: 'Josh Oviatt', invId: 'inv_ce0675be', accId: 'joviatt', type: 'WITHDRAWAL', amount: 795, date: '2026-09-01' },
    { name: 'Whit Miller', invId: 'inv_ea8b4eba', accId: 'wmiller', type: 'WITHDRAWAL', amount: 700, date: '2026-09-01' },
    { name: 'Jean Harder', invId: 'inv_bc1bcb0c', accId: 'jharder', type: 'WITHDRAWAL', amount: 1500, date: '2026-09-01' }
  ];

  for (const t of targets) {
    console.log(`================================================================================`);
    console.log(`${t.name} (Target: ${t.type} $${t.amount} on ${t.date})`);

    const { data: deps } = await supabase
      .from('deposits')
      .select('*')
      .or(`investor_id.eq.${t.invId},account_id.eq.${t.accId}`)
      .gte('date', '2026-08-01');

    const { data: wds } = await supabase
      .from('withdrawals')
      .select('*')
      .or(`investor_id.eq.${t.invId},account_id.eq.${t.accId}`)
      .gte('request_date', '2026-08-01');

    const { data: hist } = await supabase
      .from('investor_monthly_history')
      .select('*')
      .or(`investor_id.eq.${t.invId},account_id.eq.${t.accId}`)
      .gte('month_number', 8)
      .eq('year', 2026)
      .order('month_number');

    console.log('Deposits (Aug-Oct):');
    (deps || []).forEach(d => {
      console.log(`  ID=${d.id} | Amount=$${d.amount} | Date=${d.date} | EffDate=${d.effective_accounting_date} | Treatment=${d.accounting_treatment} | Status=${d.status} | CreatedAt=${d.created_at} | CreatedBy=${d.created_by}`);
    });

    console.log('Withdrawals (Aug-Oct):');
    (wds || []).forEach(w => {
      console.log(`  ID=${w.id} | Amount=$${w.amount} | ReqDate=${w.request_date} | EffDate=${w.effective_accounting_date} | Status=${w.status} | CreatedAt=${w.created_at} | CreatedBy=${w.created_by}`);
    });

    console.log('Monthly History (Aug-Oct):');
    (hist || []).forEach(h => {
      console.log(`  M${h.month_number} (${h.month}) | Open=$${h.opening_balance} | Deps=$${h.deposits} | Wds=$${h.withdrawals} | Gross%=${h.gross_return_pct} | End=$${h.ending_balance} | Locked=${h.locked} | UpdatedAt=${h.updated_at}`);
    });
  }
}

checkAll8().catch(console.error);
