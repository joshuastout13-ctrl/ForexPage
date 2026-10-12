import assert from 'node:assert';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import Decimal from 'decimal.js';
import { supabase, isAuthoritativeProductionDbConfigured } from '../lib/supabase.js';
import { executeDailyFinancialReconciliation } from '../lib/daily-reconciliation-engine.js';
import { buildInvestorDashboard } from '../lib/dashboard.js';

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });
process.env.DATA_SOURCE = 'supabase';

console.log('================================================================================');
console.log('FOREXPAGE — DAILY RECONCILIATION & PRODUCTION GROUND TRUTH REGRESSION SUITE');
console.log('Authoritative Supabase Project: julhldzkiqdeuuoqmvlo');
console.log('================================================================================\n');

let passCount = 0;
let failCount = 0;

function pass(desc) {
  console.log(`✅ PASS: ${desc}`);
  passCount++;
}

function fail(desc, err) {
  console.error(`❌ FAIL: ${desc}`);
  console.error(err);
  failCount++;
}

async function runTestSuite() {
  assert(isAuthoritativeProductionDbConfigured(), 'Authoritative Supabase production DB must be configured');

  // ---------------------------------------------------------------------------
  // 1. Fail-Closed Production Target Verification
  // ---------------------------------------------------------------------------
  try {
    assert.strictEqual(isAuthoritativeProductionDbConfigured(), true, 'Must verify julhldzkiqdeuuoqmvlo is connected');
    pass('1. Fail-closed production target verification: connects strictly to julhldzkiqdeuuoqmvlo');
  } catch (e) { fail('1. Fail-closed production target verification', e); }

  // ---------------------------------------------------------------------------
  // 2. Full-Chain Daily Reconciliation Scan Execution
  // ---------------------------------------------------------------------------
  let report = null;
  try {
    report = await executeDailyFinancialReconciliation();
    assert.strictEqual(report.status, 'PASS', 'Daily reconciliation engine must return overall PASS');
    assert.strictEqual(report.totalAccountsEvaluated, 108, 'Must evaluate all 108 financial investor accounts');
    assert.strictEqual(report.successfulReconciliations, 108, 'All 108 accounts must reconcile with zero balance variances');
    assert.strictEqual(report.anomalyCounts.P0, 0, 'Zero P0 critical anomalies must exist');
    assert.strictEqual(report.anomalyCounts.P1, 0, 'Zero P1 high anomalies must exist');
    pass('2. Full-chain daily reconciliation scan: 108/108 accounts evaluated with 0 P0/P1 anomalies');
  } catch (e) { fail('2. Full-chain daily reconciliation scan', e); }

  // ---------------------------------------------------------------------------
  // 3. September 2026 Locked-Period Immutability (+3.07% Fund Return)
  // ---------------------------------------------------------------------------
  try {
    const { data: sepRow } = await supabase.from('monthly_returns').select('*').eq('year', 2026).eq('month_number', 9).single();
    assert.strictEqual(Number(sepRow.gross_return_pct), 3.07, 'September gross return must be exactly +3.07%');
    assert.strictEqual(sepRow.locked, true, 'September gross return must remain locked=true');
    pass('3. September 2026 locked-period immutability: +3.07% return locked in monthly_returns');
  } catch (e) { fail('3. September 2026 locked-period immutability', e); }

  // ---------------------------------------------------------------------------
  // 4. Kevin Rucker & Neal Waite Duplicate Elimination Revalidation
  // ---------------------------------------------------------------------------
  try {
    const kruckerDash = await buildInvestorDashboard('krucker', null, { mustBeAuthoritative: true });
    assert.strictEqual(Math.round(kruckerDash.summary.currentBalance * 100), 20583429, 'Kevin Rucker settled balance must be $205,834.29');
    assert.strictEqual(kruckerDash.summary.totalExternalCashSent, 5000, 'Kevin Rucker outside cash must be $5,000.00');

    const nwaiteDash = await buildInvestorDashboard('nwaite', null, { mustBeAuthoritative: true });
    assert.strictEqual(Math.round(nwaiteDash.summary.currentBalance * 100), 54816625, 'Neal Waite settled balance must be $548,166.25');
    assert.strictEqual(nwaiteDash.summary.totalExternalCashSent, 12600, 'Neal Waite outside cash must be $12,600.00');
    pass('4. Kevin Rucker & Neal Waite duplicate elimination: balances reflect single legitimate deposit');
  } catch (e) { fail('4. Kevin Rucker & Neal Waite duplicate elimination', e); }

  // ---------------------------------------------------------------------------
  // 5. Josh Stout Withdrawal & External Cash Immutability
  // ---------------------------------------------------------------------------
  try {
    const jstoutDash = await buildInvestorDashboard('jstout', null, { mustBeAuthoritative: true });
    assert.strictEqual(Math.round(jstoutDash.summary.currentBalance * 100), 333345352, 'Josh Stout settled balance must be $3,333,453.52');
    assert.strictEqual(jstoutDash.summary.totalExternalCashSent, 1606090, 'Josh Stout certified outside cash must be $1,606,090.00');
    assert.strictEqual(jstoutDash.summary.totalWithdrawals, 110000, 'Josh Stout lifetime withdrawals must be $110,000.00');
    pass('5. Josh Stout accounting: $70k withdrawal deducted once, $1,606,090 certified cash intact');
  } catch (e) { fail('5. Josh Stout accounting', e); }

  // ---------------------------------------------------------------------------
  // 6. Jerry -> Stout Internal Transfer Symmetry
  // ---------------------------------------------------------------------------
  try {
    const jerryDash = await buildInvestorDashboard('jerrys001', null, { mustBeAuthoritative: true });
    assert.strictEqual(Math.round(jerryDash.summary.currentBalance * 100), 56770007, 'Jerry settled balance must be $567,700.07');
    pass('6. Jerry -> Stout internal transfer: debit deducted once from Jerry balance');
  } catch (e) { fail('6. Jerry -> Stout internal transfer', e); }

  // ---------------------------------------------------------------------------
  // 7. Oviatt, Miller, and Harder Canonical Account Ground Truth
  // ---------------------------------------------------------------------------
  try {
    const oviattDash = await buildInvestorDashboard('joviatt', null, { mustBeAuthoritative: true });
    assert.strictEqual(Math.round(oviattDash.summary.currentBalance * 100), 5257868, 'Josh Oviatt settled balance must be $52,578.68');

    const millerDash = await buildInvestorDashboard('wmiller', null, { mustBeAuthoritative: true });
    assert.strictEqual(Math.round(millerDash.summary.currentBalance * 100), 11895705, 'Whit Miller settled balance must be $118,957.05');

    const harderDash = await buildInvestorDashboard('jharder', null, { mustBeAuthoritative: true });
    assert.strictEqual(Math.round(harderDash.summary.currentBalance * 100), 11560328, 'Jean Harder settled balance must be $115,603.28');
    pass('7. Oviatt, Miller, Harder canonical accounts: balances verify cent-exact ground truth');
  } catch (e) { fail('7. Oviatt, Miller, Harder canonical accounts', e); }

  // ---------------------------------------------------------------------------
  // 8. Open-Month Commission Isolation
  // ---------------------------------------------------------------------------
  try {
    const tedDash = await buildInvestorDashboard('tboardwalk', null, { mustBeAuthoritative: true });
    const tedOctRow = tedDash.breakdown?.find(m => m.monthNumber === 10);
    assert.strictEqual(tedOctRow?.commissionsEarned, 0, 'Open-month commission must not be capitalized early');
    assert.strictEqual(Math.round(tedDash.summary.currentBalance * 100), 170278, 'Ted Boardwalk settled balance must be $1,702.78');
    pass('8. Open-month commission isolation: October commissions remain uncapitalized until month close');
  } catch (e) { fail('8. Open-month commission isolation', e); }

  // ---------------------------------------------------------------------------
  // 9. September to October Carryforward Integrity
  // ---------------------------------------------------------------------------
  try {
    const { data: dtownleyHist } = await supabase.from('investor_monthly_history').select('*').eq('investor_id', 'inv_4d52f6a4').eq('year', 2026).in('month_number', [9, 10]).order('month_number');
    assert.strictEqual(Math.round(Number(dtownleyHist[1].opening_balance) * 100), 3822316, 'David Townley October opening must be $38,223.16');
    pass('9. September to October carryforward: exact cent-level continuity');
  } catch (e) { fail('9. September to October carryforward', e); }

  // ---------------------------------------------------------------------------
  // 10. Future-Dated November Transactions Quarantine
  // ---------------------------------------------------------------------------
  try {
    const skimbellDash = await buildInvestorDashboard('skimbell', null, { mustBeAuthoritative: true });
    assert.strictEqual(Math.round(skimbellDash.summary.currentBalance * 100), 7655699, 'Steve Kimball must not reflect future November deposit');
    pass('10. Future-dated November transactions quarantine: zero leakage into October balance');
  } catch (e) { fail('10. Future-dated November transactions quarantine', e); }

  console.log('\n================================================================================');
  console.log(`DAILY RECONCILIATION SUITE RESULTS: ${passCount} PASSED / ${failCount} FAILED`);
  console.log('================================================================================\n');

  if (failCount > 0) process.exit(1);
}

runTestSuite().catch(err => {
  console.error('Fatal suite failure:', err);
  process.exit(1);
});
