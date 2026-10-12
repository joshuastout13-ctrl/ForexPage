import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { supabase, isAuthoritativeProductionDbConfigured } from '../lib/supabase.js';
import { sql } from './inspect_internal_transfer_rpc.mjs';
import Decimal from 'decimal.js';

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });
process.env.DATA_SOURCE = 'supabase';

async function verifyPreconditions() {
  console.log('================================================================================');
  console.log('PHASE 1 & 2 PRE-EXECUTION VERIFICATION');
  console.log('Authoritative Supabase Project: julhldzkiqdeuuoqmvlo');
  console.log('================================================================================\n');

  if (!isAuthoritativeProductionDbConfigured()) {
    throw new Error('FATAL: Not connected to authoritative production Supabase project (julhldzkiqdeuuoqmvlo)');
  }
  console.log('✓ Authoritative production Supabase connection verified.\n');

  // 1. Inspect Josh's $70,000 withdrawal record
  console.log('--- 1. JOSH STOUT $70,000 WITHDRAWAL INSPECTION ---');
  const { data: wds } = await supabase
    .from('withdrawals')
    .select('*')
    .eq('investor_id', 'stout001')
    .order('request_date', { ascending: false });

  console.log(`Found ${wds?.length || 0} withdrawals for stout001:`);
  wds?.forEach(w => {
    console.log(`  ID: ${w.id} | Amount: $${w.amount} | Status: ${w.status} | ReqDate: ${w.request_date} | EffDate: ${w.effective_accounting_date} | Key: ${w.idempotency_key} | CreatedAt: ${w.created_at} | UpdatedAt: ${w.updated_at} | UpdatedBy: ${w.updated_by}`);
  });

  const wd70k = wds?.find(w => Number(w.amount) === 70000);
  if (!wd70k) {
    throw new Error('FATAL: Josh $70,000 withdrawal not found in withdrawals table!');
  }
  console.log('\n✓ $70,000 Withdrawal Record Found:');
  console.log(JSON.stringify(wd70k, null, 2));

  // Check October monthly history for Josh
  const { data: stoutOctHist } = await supabase
    .from('investor_monthly_history')
    .select('*')
    .eq('investor_id', 'stout001')
    .eq('year', 2026)
    .eq('month_number', 10)
    .single();

  console.log('\nJosh Stout October 2026 Monthly History:');
  console.log(JSON.stringify(stoutOctHist, null, 2));

  const openingBal = new Decimal(stoutOctHist.opening_balance);
  const depAmt = new Decimal(stoutOctHist.deposits);
  const wdAmt = new Decimal(stoutOctHist.withdrawals);
  const endBal = new Decimal(stoutOctHist.ending_balance);

  console.log(`\nCalculation check:`);
  console.log(`  Opening Balance:    $${openingBal.toFixed(2)}`);
  console.log(`  Deposits:         + $${depAmt.toFixed(2)}`);
  console.log(`  Withdrawals:      - $${wdAmt.toFixed(2)}`);
  console.log(`  Expected Ending:    $${openingBal.plus(depAmt).minus(wdAmt).toFixed(2)}`);
  console.log(`  Actual Ending:      $${endBal.toFixed(2)}`);

  if (!wdAmt.equals(70000)) {
    throw new Error(`FATAL: October history withdrawals is ${wdAmt.toFixed(2)}, expected 70000.00!`);
  }
  if (!endBal.equals(openingBal.plus(depAmt).minus(wdAmt))) {
    throw new Error(`FATAL: October ending balance does not match opening + deposits - withdrawals!`);
  }
  console.log('✓ $70,000 withdrawal is already deducted EXACTLY ONCE from Josh Stout ending balance!\n');

  // 2. Check October Transfer Records
  console.log('--- 2. OCTOBER TRANSFER RECORDS INSPECTION ---');
  // Check dep_654ad1a9
  const { data: dep654 } = await supabase
    .from('deposits')
    .select('*')
    .eq('id', 'dep_654ad1a9')
    .single();

  console.log('Stout Deposit dep_654ad1a9:');
  console.log(JSON.stringify(dep654, null, 2));

  if (!dep654) {
    throw new Error('FATAL: dep_654ad1a9 not found!');
  }
  if (Number(dep654.amount) !== 2500) {
    throw new Error(`FATAL: dep_654ad1a9 amount is ${dep654.amount}, expected 2500!`);
  }

  // Check Jerry withdrawals in October
  const { data: jerryOctWds } = await supabase
    .from('withdrawals')
    .select('*')
    .eq('investor_id', 'jerrys001')
    .eq('year', 2026)
    .eq('month_number', 10);

  console.log(`\nJerry withdrawals in October 2026 (${jerryOctWds?.length || 0} records):`);
  console.log(JSON.stringify(jerryOctWds, null, 2));

  // Check internal_transfers master records
  const { data: transfers } = await supabase
    .from('internal_transfers')
    .select('*')
    .order('created_at', { ascending: true });

  console.log(`\nAll internal transfers in system (${transfers?.length || 0} records):`);
  transfers?.forEach(t => {
    console.log(`  ID: ${t.id} | Number: ${t.transfer_number} | Source: ${t.source_investor_id} | Target: ${t.target_investor_id} | Amount: $${t.amount} | Date: ${t.effective_accounting_date} | Status: ${t.status} | Key: ${t.idempotency_key}`);
  });

  // Check next value of internal_transfer_seq
  const seqRes = await sql(`SELECT last_value, is_called FROM internal_transfer_seq;`);
  console.log('\nInternal transfer sequence status:');
  console.log(JSON.stringify(seqRes.data, null, 2));

  // Check Jerry monthly history
  const { data: jerryOctHist } = await supabase
    .from('investor_monthly_history')
    .select('*')
    .eq('investor_id', 'jerrys001')
    .eq('year', 2026)
    .eq('month_number', 10)
    .single();

  console.log('\nJerry October 2026 Monthly History:');
  console.log(JSON.stringify(jerryOctHist, null, 2));
}

verifyPreconditions().catch(console.error);
