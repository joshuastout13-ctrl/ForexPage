import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

process.env.DATA_SOURCE = 'supabase';

import { buildInvestorDashboard } from '../lib/dashboard.js';
import { supabase, isAuthoritativeProductionDbConfigured } from '../lib/supabase.js';

async function testDashboard() {
  console.log('Connecting to Supabase...');
  console.log('Authoritative DB configured:', isAuthoritativeProductionDbConfigured());

  const dash = await buildInvestorDashboard('jstout', null, {
    mustBeAuthoritative: true
  });

  console.log('\n--- JSTOUT DASHBOARD SUMMARY ---');
  console.log('Current Settled Balance:', dash.summary.currentBalance);
  console.log('Total External Cash Sent:', dash.summary.totalExternalCashSent);
  console.log('External Deposits Lifetime:', dash.summary.externalDepositsLifetime);
  console.log('Contributed Basis:', dash.summary.contributedBasis);
  console.log('Total Performance Dollar:', dash.summary.totalPerformanceDollar);
  console.log('Total Performance Pct:', dash.summary.totalPerformancePct);
  console.log('Provenance Completeness Status:', dash.summary.provenanceCompletenessStatus);
  console.log('Total Withdrawals:', dash.summary.totalWithdrawals);
  console.log('Total Cash In (YTD):', dash.summary.totalCashIn);
  console.log('Data Source Authority:', dash.dataSourceAuthority);

  // Check investor_accounts row
  const { data: accs } = await supabase
    .from('investor_accounts')
    .select('*')
    .eq('investor_id', 'stout001');

  console.log('\n--- INVESTOR_ACCOUNTS ROW ---');
  console.log(JSON.stringify(accs, null, 2));

  // Check all deposits breakdown by accounting_treatment
  const { data: deposits } = await supabase
    .from('deposits')
    .select('*')
    .eq('investor_id', 'stout001');

  const treatmentMap = {};
  deposits.forEach(d => {
    const t = d.accounting_treatment || 'NULL';
    if (!treatmentMap[t]) treatmentMap[t] = { count: 0, sum: 0, rows: [] };
    treatmentMap[t].count++;
    treatmentMap[t].sum += Number(d.amount);
    treatmentMap[t].rows.push({ id: d.id, amount: d.amount, date: d.date, status: d.status, notes: d.notes, type: d.type });
  });

  console.log('\n--- DEPOSITS BREAKDOWN BY ACCOUNTING_TREATMENT ---');
  console.log(JSON.stringify(treatmentMap, null, 2));
}

testDashboard().catch(console.error);
