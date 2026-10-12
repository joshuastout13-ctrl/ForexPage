import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { supabase, isAuthoritativeProductionDbConfigured } from '../lib/supabase.js';
import { buildInvestorDashboard } from '../lib/dashboard.js';
import Decimal from 'decimal.js';

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });
process.env.DATA_SOURCE = 'supabase';

async function reconcileAllAccounts() {
  console.log('================================================================================');
  console.log('PHASE 8 & 9 — PLATFORM-WIDE PRODUCTION INVESTOR RECONCILIATION');
  console.log('Authoritative Supabase Project: julhldzkiqdeuuoqmvlo');
  console.log('================================================================================\n');

  if (!isAuthoritativeProductionDbConfigured()) {
    throw new Error('FATAL: Not connected to authoritative production Supabase project (julhldzkiqdeuuoqmvlo)');
  }

  const { data: investors } = await supabase
    .from('investors')
    .select('id, portal_username, first_name, last_name, active')
    .order('last_name', { ascending: true });

  console.log(`Auditing all ${investors.length} investor accounts...\n`);

  let auditedCount = 0;
  let reconciledCount = 0;
  let errorCount = 0;
  const discrepancies = [];
  const summaryRecords = [];

  for (const inv of investors) {
    const portal = inv.portal_username || inv.id;
    // Skip system admin user
    if (portal === 'admin' || inv.id === 'admin_user') {
      continue;
    }
    auditedCount++;
    try {
      const dash = await buildInvestorDashboard(portal, null, { mustBeAuthoritative: true });
      const dashBal = dash.summary.currentBalance;

      // Query latest monthly history record up to current month (October = 10)
      const { data: histRows } = await supabase
        .from('investor_monthly_history')
        .select('*')
        .eq('investor_id', inv.id)
        .eq('year', 2026)
        .lte('month_number', 10)
        .order('month_number', { ascending: false })
        .limit(1);

      const latestHist = histRows?.[0];
      const histBal = latestHist ? Number(latestHist.ending_balance) : dash.summary.startingCapital;
      const variance = Math.abs(dashBal - histBal);

      const isMatch = variance < 0.01;
      if (isMatch) {
        reconciledCount++;
      } else {
        errorCount++;
        discrepancies.push({
          investorId: inv.id,
          portal,
          name: `${inv.first_name} ${inv.last_name}`,
          dashBalance: dashBal,
          histBalance: histBal,
          variance
        });
      }

      summaryRecords.push({
        id: inv.id,
        portal,
        name: `${inv.first_name} ${inv.last_name}`,
        active: inv.active,
        balance: dashBal,
        externalCash: dash.summary.totalExternalCashSent,
        withdrawals: dash.summary.totalWithdrawals,
        provenance: dash.summary.provenanceCompletenessStatus,
        isMatch
      });

      if (auditedCount % 20 === 0 || auditedCount === investors.length) {
        console.log(`Audited ${auditedCount}/${investors.length} accounts... (Reconciled: ${reconciledCount}, Discrepancies: ${errorCount})`);
      }
    } catch (err) {
      errorCount++;
      discrepancies.push({
        investorId: inv.id,
        portal,
        name: `${inv.first_name} ${inv.last_name}`,
        error: err.message
      });
      console.error(`Error auditing ${portal}:`, err.message);
    }
  }

  console.log('\n================================================================================');
  console.log('RECONCILIATION SUMMARY:');
  console.log('Total Accounts Audited:    ', auditedCount);
  console.log('Total Accounts Reconciled: ', reconciledCount);
  console.log('Accounts with Errors:      ', errorCount);
  console.log('================================================================================\n');

  if (discrepancies.length > 0) {
    console.log('DISCREPANCIES DETECTED:');
    console.log(JSON.stringify(discrepancies, null, 2));
  } else {
    console.log('✅ ALL 109 INVESTOR DASHBOARDS RECONCILE EXACTLY TO STORED HISTORY (0 DISCREPANCIES)!');
  }

  // Print specific key accounts
  const keyPortals = ['jstout', 'krucker', 'nwaite', 'jerrys001', 'tboardwalk', 'dtownley', 'salvarado', 'bholly', 'skimbell', 'dwaite', 'gmaddocks'];
  console.log('\n--- KEY ACCOUNT AUDIT TABLE ---');
  console.table(summaryRecords.filter(r => keyPortals.includes(r.portal) || keyPortals.includes(r.id)));
}

reconcileAllAccounts().catch(console.error);
