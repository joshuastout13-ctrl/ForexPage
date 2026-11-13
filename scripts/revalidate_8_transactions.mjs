import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { supabase, isAuthoritativeProductionDbConfigured } from '../lib/supabase.js';
import { buildInvestorDashboard } from '../lib/dashboard.js';
import Decimal from 'decimal.js';

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });
process.env.DATA_SOURCE = 'supabase';

async function main() {
  console.log('================================================================================');
  console.log('PHASE 1 — REVALIDATING 8 AUTHORIZED TRANSACTIONS AGAINST LIVE PRODUCTION');
  console.log('Authoritative Supabase: julhldzkiqdeuuoqmvlo');
  console.log('================================================================================\n');

  if (!isAuthoritativeProductionDbConfigured()) {
    throw new Error('FATAL: Not connected to authoritative production Supabase project (julhldzkiqdeuuoqmvlo)');
  }
  console.log('✓ Authoritative production Supabase connection verified.\n');

  const targetAccounts = [
    { num: 1, name: 'Brad Holly', invId: 'inv_5deeea21', accId: 'bholly', type: 'DEPOSIT', amount: 278000.00, date: '2026-10-01', period: 'OCTOBER', treatment: 'NEW_CASH' },
    { num: 2, name: 'Steve Kimball', invId: 'inv_16a045fa', accId: 'skimbell', type: 'WITHDRAWAL', amount: 6000.00, date: '2026-10-01', period: 'OCTOBER', reqStatus: 'Completed' },
    { num: 3, name: 'Dale Waite', invId: 'inv_60ed0c32', accId: 'dwaite', type: 'DEPOSIT', amount: 6500.00, date: '2026-10-01', period: 'OCTOBER', treatment: 'NEW_CASH' },
    { num: 4, name: 'Josh Stout', accId: 'stout001', portal: 'jstout', type: 'WITHDRAWAL', amount: 20000.00, date: '2026-10-01', period: 'OCTOBER', reqStatus: 'Completed' },
    { num: 5, name: 'Glenn Maddocks', invId: 'inv_5a509c6a', accId: 'gmaddocks', type: 'DEPOSIT', amount: 568277.00, date: '2026-10-01', period: 'OCTOBER', treatment: 'NEW_CASH' },
    { num: 6, name: 'Josh Oviatt', invId: 'inv_ce0675be', accId: 'joviatt', type: 'WITHDRAWAL', amount: 795.00, date: '2026-09-01', period: 'SEPTEMBER', reqStatus: 'Completed' },
    { num: 7, name: 'Whit Miller', invId: 'inv_ea8b4eba', accId: 'wmiller', type: 'WITHDRAWAL', amount: 700.00, date: '2026-09-01', period: 'SEPTEMBER', reqStatus: 'Completed' },
    { num: 8, name: 'Jean Harder', invId: 'inv_bc1bcb0c', accId: 'jharder', type: 'WITHDRAWAL', amount: 1500.00, date: '2026-09-01', period: 'SEPTEMBER', reqStatus: 'Completed' }
  ];

  for (const item of targetAccounts) {
    console.log(`--------------------------------------------------------------------------------`);
    console.log(`[Item #${item.num}] ${item.name} (${item.type} $${item.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })} on ${item.date})`);

    // 1. Resolve Investor
    let invQuery = supabase.from('investors').select('*');
    if (item.invId) {
      invQuery = invQuery.eq('id', item.invId);
    } else if (item.portal) {
      invQuery = invQuery.eq('portal_username', item.portal);
    }
    const { data: invRows, error: invErr } = await invQuery;
    if (invErr || !invRows || invRows.length === 0) {
      console.error(`ERROR: Failed to find investor for ${item.name}:`, invErr);
      continue;
    }
    const inv = invRows[0];
    const canonicalInvId = inv.id;
    const portalUsername = inv.portal_username;
    console.log(`  Investor: ID=${canonicalInvId}, Portal=${portalUsername}, Name=${inv.first_name} ${inv.last_name}, Split=${inv.split_pct}%`);

    // 2. Resolve Account
    const { data: accRows, error: accErr } = await supabase
      .from('investor_accounts')
      .select('*')
      .or(`id.eq.${item.accId},investor_id.eq.${canonicalInvId}`);
    if (accErr || !accRows || accRows.length === 0) {
      console.error(`ERROR: Failed to find account for ${item.name}:`, accErr);
      continue;
    }
    const acc = accRows[0];
    const canonicalAccId = acc.id;
    console.log(`  Account: ID=${canonicalAccId}, InvestorID=${acc.investor_id}, OpenDate=${acc.open_date}, StartingCap=$${acc.starting_capital}`);

    // 3. Check existing deposits
    const { data: existingDeps } = await supabase
      .from('deposits')
      .select('*')
      .or(`investor_id.eq.${canonicalInvId},account_id.eq.${canonicalAccId}`);
    
    // 4. Check existing withdrawals
    const { data: existingWds } = await supabase
      .from('withdrawals')
      .select('*')
      .or(`investor_id.eq.${canonicalInvId},account_id.eq.${canonicalAccId}`);

    // Check for exact matching transaction
    let exactMatches = [];
    if (item.type === 'DEPOSIT') {
      exactMatches = (existingDeps || []).filter(d => 
        Number(d.amount) === item.amount && 
        (d.effective_date === item.date || d.date === item.date)
      );
    } else {
      exactMatches = (existingWds || []).filter(w => 
        Number(w.amount) === item.amount && 
        (w.effective_date === item.date || w.date === item.date || w.request_date === item.date)
      );
    }

    console.log(`  Existing Tx Check: Total Deps=${existingDeps?.length || 0}, Total Wds=${existingWds?.length || 0}`);
    console.log(`  Exact Matches Found for ${item.type} $${item.amount} on ${item.date}: ${exactMatches.length}`);
    if (exactMatches.length > 0) {
      console.log(`    -> MATCH DETAILS:`, JSON.stringify(exactMatches, null, 2));
    }

    // 5. Query Monthly History for September and October 2026
    const { data: sepHist } = await supabase
      .from('investor_monthly_history')
      .select('*')
      .or(`investor_id.eq.${canonicalInvId},account_id.eq.${canonicalAccId}`)
      .eq('year', 2026)
      .eq('month_number', 9);
    
    const { data: octHist } = await supabase
      .from('investor_monthly_history')
      .select('*')
      .or(`investor_id.eq.${canonicalInvId},account_id.eq.${canonicalAccId}`)
      .eq('year', 2026)
      .eq('month_number', 10);

    console.log(`  September History: ${sepHist?.length ? JSON.stringify(sepHist[0]) : 'NONE'}`);
    console.log(`  October History:   ${octHist?.length ? JSON.stringify(octHist[0]) : 'NONE'}`);

    // 6. Current Dashboard
    try {
      const dash = await buildInvestorDashboard(portalUsername, null, { mustBeAuthoritative: true });
      console.log(`  Dashboard Current Settled Balance: $${dash.summary.currentBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
      console.log(`  Dashboard Total External Cash Sent: $${dash.summary.totalExternalCashSent.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
      console.log(`  Dashboard Total Withdrawals:       $${dash.summary.totalWithdrawals.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    } catch (e) {
      console.error(`  Dashboard generation failed: ${e.message}`);
    }
  }

  // Also verify global controls before mutation
  console.log('\n================================================================================');
  console.log('GLOBAL FINANCIAL CONTROLS (BEFORE MUTATION)');
  console.log('================================================================================');
  
  // 1. Josh Stout
  const joshDash = await buildInvestorDashboard('jstout', null, { mustBeAuthoritative: true });
  console.log(`Josh Stout Settled Bal:      $${joshDash.summary.currentBalance.toFixed(2)} (Expected $3,400,953.52)`);
  console.log(`Josh Stout Outside Cash:     $${joshDash.summary.totalExternalCashSent.toFixed(2)} (Expected $1,606,090.00)`);
  
  // 2. Ted Boardwalk
  const tedDash = await buildInvestorDashboard('tboardwalk', null, { mustBeAuthoritative: true });
  console.log(`Ted Boardwalk Settled Bal:   $${tedDash.summary.currentBalance.toFixed(2)} (Expected $1,702.78)`);
  
  // 3. David Townley
  const davidDash = await buildInvestorDashboard('dtownley', null, { mustBeAuthoritative: true });
  console.log(`David Townley Settled Bal:   $${davidDash.summary.currentBalance.toFixed(2)} (Expected $38,223.16)`);
  
  // 4. Sheryl Ryan Dunnam
  const { data: sherylHist } = await supabase
    .from('investor_monthly_history')
    .select('*')
    .eq('investor_id', 'inv_7dc0fe9a')
    .eq('year', 2026)
    .eq('month_number', 9);
  console.log(`Sheryl Sep Gain:             $${sherylHist?.[0]?.trading_gain} (Expected $921.00)`);
  console.log(`Sheryl Sep Ending Bal:       $${sherylHist?.[0]?.ending_balance} (Expected $60,921.00)`);

  // 5. Ryan Ringer
  const ringerDash = await buildInvestorDashboard('rringer', null, { mustBeAuthoritative: true });
  console.log(`Ryan Ringer Outside Cash:    $${ringerDash.summary.totalExternalCashSent.toFixed(2)} (Expected $125,000.00)`);

  // 6. Jerry -> Stout Transfer
  const { data: jerryXfer } = await supabase
    .from('internal_transfers')
    .select('*')
    .eq('transfer_code', 'XFER-2026-00005');
  console.log(`Jerry -> Stout Transfer:     ${jerryXfer?.length ? `${jerryXfer[0].transfer_code} $${jerryXfer[0].amount}` : 'NOT FOUND'}`);

  // 7. Stout May Exception
  const { data: stoutMayDep } = await supabase
    .from('deposits')
    .select('*')
    .eq('id', 'dep_454fb0c9');
  console.log(`Stout May Deposit:           ${stoutMayDep?.length ? `${stoutMayDep[0].id} $${stoutMayDep[0].amount} status=${stoutMayDep[0].status}` : 'NOT FOUND'}`);

  // 8. September locked return in monthly_returns
  const { data: sepRet } = await supabase
    .from('monthly_returns')
    .select('*')
    .eq('year', 2026)
    .eq('month_number', 9);
  console.log(`September Fund Return:       ${sepRet?.[0]?.gross_return_pct}% locked=${sepRet?.[0]?.locked} (Expected +3.07% locked=true)`);
}

main().catch(console.error);
