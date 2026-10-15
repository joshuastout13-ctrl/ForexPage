import { buildInvestorDashboard } from '../lib/dashboard.js';
import { executeDailyFinancialReconciliation } from '../lib/daily-reconciliation-engine.js';
import { calculateTotalExternalCash } from '../lib/accounting-engine.js';
import { paginatedRead, normalizeRow } from '../lib/supabase.js';

async function main() {
  console.log('=== INDEPENDENT VERIFICATION OF INVESTOR DASHBOARDS VS ACCOUNTING RECORDS ===');

  const rawDeposits = (await paginatedRead('deposits')).map(normalizeRow);
  const stoutDeps = rawDeposits.filter(d => d.investor_id === 'stout001');
  const stoutCertifiedCash = calculateTotalExternalCash({ depositRows: stoutDeps, accountStartDate: '2026-01-01' }).total;

  const targets = [
    { portal: 'tkruger', name: 'Theresa Kruger', expSettled: 111688.50, expWds: 5295.66 },
    { portal: 'krucker', name: 'Kevin Rucker', expSettled: 205834.29, expCash: 5000.00 },
    { portal: 'nwaite', name: 'Neal Waite', expSettled: 548166.25, expCash: 12600.00 },
    { portal: 'jstout', name: 'Josh Stout', expSettled: 3333453.52, expCash: 71719.35, expCertifiedCash: 1606090.00, expWds: 110000.00 },
    { portal: 'jerrys001', name: "Jerry's Rogue Jets", expSettled: 567700.07, expCash: 0.00, expWds: 15000.00 },
    { portal: 'tboardwalk', name: 'Ted Boardwalk', expSettled: 1702.78 },
    { portal: 'dtownley', name: 'David Townley', expSettled: 38223.16 },
    { portal: 'salvarado', name: 'Sheryl Dunnam (Alvarado)', expSettled: 60921.00 },
    { portal: 'wmiller', name: 'Whit Miller', expSettled: 118957.05 },
    { portal: 'joviatt', name: 'Josh Oviatt', expSettled: 52578.68 },
    { portal: 'jharder', name: 'Jean Harder', expSettled: 115603.28 }
  ];

  let passed = 0;
  let failed = 0;

  for (const t of targets) {
    const dash = await buildInvestorDashboard(t.portal, null, { mustBeAuthoritative: true });
    const liveBal = Number(dash.summary.currentBalance);
    const liveWds = Number(dash.summary.totalWithdrawals);
    const liveCash = Number(dash.summary.totalCashIn);

    let match = true;
    let details = [];

    if (t.expSettled !== undefined) {
      const diffBal = Math.abs(liveBal - t.expSettled);
      if (diffBal > 0.01) {
        match = false;
        details.push(`Settled balance mismatch: live=$${liveBal.toFixed(2)}, exp=$${t.expSettled.toFixed(2)}`);
      } else {
        details.push(`Settled balance: $${liveBal.toFixed(2)} (MATCH)`);
      }
    }

    if (t.expWds !== undefined) {
      const diffWds = Math.abs(liveWds - t.expWds);
      if (diffWds > 0.01) {
        match = false;
        details.push(`Lifetime withdrawals mismatch: live=$${liveWds.toFixed(2)}, exp=$${t.expWds.toFixed(2)}`);
      } else {
        details.push(`Lifetime withdrawals: $${liveWds.toFixed(2)} (MATCH)`);
      }
    }

    if (t.expCash !== undefined) {
      const diffCash = Math.abs(liveCash - t.expCash);
      if (diffCash > 0.01) {
        match = false;
        details.push(`Outside cash mismatch: live=$${liveCash.toFixed(2)}, exp=$${t.expCash.toFixed(2)}`);
      } else {
        details.push(`Outside cash: $${liveCash.toFixed(2)} (MATCH)`);
      }
    }

    if (t.expCertifiedCash !== undefined) {
      const diffCert = Math.abs(stoutCertifiedCash - t.expCertifiedCash);
      if (diffCert > 0.01) {
        match = false;
        details.push(`Certified cash mismatch: calc=$${stoutCertifiedCash.toFixed(2)}, exp=$${t.expCertifiedCash.toFixed(2)}`);
      } else {
        details.push(`Certified cash: $${stoutCertifiedCash.toFixed(2)} (MATCH)`);
      }
    }

    if (match) {
      console.log(`✅ ${t.name} (${t.portal}): ${details.join(' | ')}`);
      passed++;
    } else {
      console.error(`❌ ${t.name} (${t.portal}): ${details.join(' | ')}`);
      failed++;
    }
  }

  console.log(`\nTARGET ACCOUNTS VERIFICATION: ${passed} PASSED / ${failed} FAILED`);
  if (failed > 0) process.exit(1);

  // Full platform scan
  console.log('\n--- FULL 108-ACCOUNT INDEPENDENT RECONCILIATION SCAN ---');
  const fullReport = await executeDailyFinancialReconciliation();
  console.log(`Status: ${fullReport.status}`);
  console.log(`Accounts Evaluated: ${fullReport.totalAccountsEvaluated}`);
  console.log(`Exact Reconciled: ${fullReport.successfulReconciliations}`);
  console.log(`Failed: ${fullReport.failedReconciliations}`);
  console.log(`P0 Anomalies: ${fullReport.anomalyCounts.P0}`);
  console.log(`P1 Anomalies: ${fullReport.anomalyCounts.P1}`);
  console.log(`P2 Anomalies: ${fullReport.anomalyCounts.P2}`);

  if (fullReport.status !== 'PASS') {
    console.error('Full reconciliation failed!');
    process.exit(1);
  }

  console.log('✅ ALL 108 INVESTOR DASHBOARDS INDEPENDENTLY RECONCILED WITH ZERO DISCREPANCIES!');
}

main().catch(err => {
  console.error('Fatal verification error:', err);
  process.exit(1);
});
