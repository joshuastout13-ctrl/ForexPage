import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import Decimal from 'decimal.js';
import { supabase, isAuthoritativeProductionDbConfigured } from '../lib/supabase.js';
import { buildInvestorDashboard } from '../lib/dashboard.js';

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

function round2(val) {
  if (val === null || val === undefined || isNaN(Number(val))) return 0;
  return new Decimal(val).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
}

process.env.DATA_SOURCE = 'supabase';

async function run() {
  console.log('=== 4XTRACK AUDIT: DUPLICATE SEPTEMBER DEPOSITS ===');
  
  // 1. Production Safety Check
  const url = process.env.SUPABASE_URL || '';
  console.log(`Supabase URL: ${url}`);
  const isAuth = isAuthoritativeProductionDbConfigured();
  console.log(`Authoritative Production Db Configured: ${isAuth}`);
  if (!isAuth) {
    throw new Error('FAIL CLOSED: Authoritative Supabase project julhldzkiqdeuuoqmvlo not configured!');
  }

  // 2. KEVIN RUCKER
  console.log('\n--- 2. KEVIN RUCKER (inv_7e7dcda2 / krucker) ---');
  const { data: kruckerInv } = await supabase
    .from('investors')
    .select('*')
    .eq('id', 'inv_7e7dcda2')
    .single();
  console.log('Investor details:', JSON.stringify(kruckerInv, null, 2));

  const { data: kruckerDeps } = await supabase
    .from('deposits')
    .select('*')
    .eq('investor_id', 'inv_7e7dcda2')
    .order('created_at', { ascending: true });
  console.log('All deposits for Kevin Rucker:');
  console.table(kruckerDeps);

  const { data: kruckerHist } = await supabase
    .from('investor_monthly_history')
    .select('*')
    .eq('investor_id', 'inv_7e7dcda2')
    .in('month', ['August', 'September', 'October'])
    .order('year', { ascending: true })
    .order('month_number', { ascending: true });
  console.log('Monthly History (Aug-Oct):');
  console.table(kruckerHist);

  const { data: kruckerCommShares } = await supabase
    .from('commission_shares')
    .select('*')
    .eq('source_investor_id', 'inv_7e7dcda2');
  console.log('Commission shares for Kevin Rucker:');
  console.table(kruckerCommShares);

  const kruckerDash = await buildInvestorDashboard('krucker', null, { mustBeAuthoritative: true });
  console.log('Current Dashboard for Kevin Rucker:');
  console.log({
    currentBalance: kruckerDash.summary.currentBalance,
    totalExternalCashSent: kruckerDash.summary.totalExternalCashSent,
    totalPerformanceDollar: kruckerDash.summary.totalPerformanceDollar
  });

  // 3. NEAL WAITE
  console.log('\n--- 3. NEAL WAITE (inv_d8b5ab06 / nwaite) ---');
  const { data: nwaiteInv } = await supabase
    .from('investors')
    .select('*')
    .eq('id', 'inv_d8b5ab06')
    .single();
  console.log('Investor details:', JSON.stringify(nwaiteInv, null, 2));

  const { data: nwaiteDeps } = await supabase
    .from('deposits')
    .select('*')
    .eq('investor_id', 'inv_d8b5ab06')
    .order('created_at', { ascending: true });
  console.log('All deposits for Neal Waite:');
  console.table(nwaiteDeps);

  const { data: nwaiteWds } = await supabase
    .from('withdrawals')
    .select('*')
    .eq('investor_id', 'inv_d8b5ab06')
    .order('created_at', { ascending: true });
  console.log('All withdrawals for Neal Waite:');
  console.table(nwaiteWds);

  const { data: nwaiteHist } = await supabase
    .from('investor_monthly_history')
    .select('*')
    .eq('investor_id', 'inv_d8b5ab06')
    .in('month', ['August', 'September', 'October'])
    .order('year', { ascending: true })
    .order('month_number', { ascending: true });
  console.log('Monthly History (Aug-Oct):');
  console.table(nwaiteHist);

  const { data: nwaiteCommShares } = await supabase
    .from('commission_shares')
    .select('*')
    .eq('source_investor_id', 'inv_d8b5ab06');
  console.log('Commission shares for Neal Waite:');
  console.table(nwaiteCommShares);

  // Check for any transaction anywhere with $12,600
  const { data: anyDeps12600 } = await supabase
    .from('deposits')
    .select('id, investor_id, amount, date, type, status, treatment, notes')
    .eq('amount', 12600);
  console.log('Any deposits with amount $12,600:');
  console.table(anyDeps12600);

  const { data: anyWds12600 } = await supabase
    .from('withdrawals')
    .select('id, investor_id, amount, date, status, notes')
    .eq('amount', 12600);
  console.log('Any withdrawals with amount $12,600:');
  console.table(anyWds12600);

  const nwaiteDash = await buildInvestorDashboard('nwaite', null, { mustBeAuthoritative: true });
  console.log('Current Dashboard for Neal Waite:');
  console.log({
    currentBalance: nwaiteDash.summary.currentBalance,
    totalExternalCashSent: nwaiteDash.summary.totalExternalCashSent,
    totalPerformanceDollar: nwaiteDash.summary.totalPerformanceDollar
  });

  // 4. GLOBAL CONTROLS
  console.log('\n--- 4. GLOBAL CONTROLS ---');

  // Josh Stout: stout001
  const stoutDash = await buildInvestorDashboard('jstout', null, { mustBeAuthoritative: true });
  const { data: stoutSeptHist } = await supabase
    .from('investor_monthly_history')
    .select('*')
    .eq('investor_id', 'inv_9e9a4bb0') // or check stout investor id
    .eq('year', 2026)
    .eq('month', 'September')
    .single();
  const { data: stoutComm } = await supabase
    .from('investor_commissions')
    .select('commission_amount')
    .eq('recipient_investor_id', 'inv_9e9a4bb0')
    .eq('month', 'September')
    .eq('year', 2026);
  const stoutSeptCommTotal = (stoutComm || []).reduce((acc, c) => acc.add(new Decimal(c.commission_amount)), new Decimal(0));

  console.log('Josh Stout Controls:');
  console.log({
    currentSettledBalance: stoutDash.summary.currentBalance,
    certifiedExternalCash: stoutDash.summary.totalExternalCashSent,
    septemberCommission: stoutSeptCommTotal.toNumber()
  });

  // Ted Boardwalk: tboardwalk / inv_a79798ca
  const tboardDash = await buildInvestorDashboard('tboardwalk', null, { mustBeAuthoritative: true });
  const { data: tboardSeptHist } = await supabase
    .from('investor_monthly_history')
    .select('*')
    .eq('investor_id', 'inv_a79798ca')
    .eq('year', 2026)
    .eq('month', 'September')
    .single();
  const { data: tboardComm } = await supabase
    .from('investor_commissions')
    .select('commission_amount')
    .eq('recipient_investor_id', 'inv_a79798ca')
    .eq('month', 'September')
    .eq('year', 2026);
  const tboardSeptCommTotal = (tboardComm || []).reduce((acc, c) => acc.add(new Decimal(c.commission_amount)), new Decimal(0));
  const { data: tboardJuneWd } = await supabase
    .from('withdrawals')
    .select('*')
    .eq('investor_id', 'inv_a79798ca')
    .eq('amount', 5000);

  console.log('Ted Boardwalk Controls:');
  console.log({
    septemberOpening: tboardSeptHist?.opening_balance,
    septemberEnding: tboardSeptHist?.ending_balance,
    septemberCommission: tboardSeptCommTotal.toNumber(),
    currentSettledBalance: tboardDash.summary.currentBalance,
    june5kWd: tboardJuneWd
  });

  // David Townley: dtownley / inv_13d6a9a7
  const dtownleyDash = await buildInvestorDashboard('dtownley', null, { mustBeAuthoritative: true });
  console.log('David Townley Controls:');
  console.log({
    currentSettledBalance: dtownleyDash.summary.currentBalance
  });

  // Sheryl Ryan Dunnam: inv_7dc0fe9a
  const { data: sherylSeptHist } = await supabase
    .from('investor_monthly_history')
    .select('*')
    .eq('investor_id', 'inv_7dc0fe9a')
    .eq('year', 2026)
    .eq('month', 'September')
    .single();
  console.log('Sheryl Ryan Dunnam Controls:');
  console.log({
    septemberGain: sherylSeptHist?.gain,
    septemberEnding: sherylSeptHist?.ending_balance
  });

  // Ryan Ringer: rringer / inv_74479532
  const rringerDash = await buildInvestorDashboard('rringer', null, { mustBeAuthoritative: true });
  console.log('Ryan Ringer Controls:');
  console.log({
    certifiedExternalCash: rringerDash.summary.totalExternalCashSent
  });

  // Jerry -> Stout: September transfer $2,500
  const { data: jerryXfer } = await supabase
    .from('internal_transfers')
    .select('*')
    .eq('amount', 2500);
  console.log('Jerry -> Stout internal transfer:');
  console.table(jerryXfer);

  // Stout May: $7,500 deposit
  const { data: stoutMayDep } = await supabase
    .from('deposits')
    .select('*')
    .eq('id', 'dep_454fb0c9');
  console.log('Stout May deposit:');
  console.table(stoutMayDep);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
