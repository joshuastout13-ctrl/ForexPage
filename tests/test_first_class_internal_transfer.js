import assert from 'node:assert';
import { calculateTotalExternalCash, calculateBalanceAffectingDeposits, calculateLifetimePerformance } from '../lib/accounting-engine.js';
import { buildInvestorDashboard } from '../lib/dashboard.js';

async function testInternalTransferInvariants() {
  console.log('=== TEST 1: INTERNAL_TRANSFER DOES NOT CONTRIBUTE TO TOTAL EXTERNAL CASH ===');
  const depositRows = [
    {
      id: 'dep_cash_1',
      investor_id: 'inv_test',
      amount: 100000,
      accounting_treatment: 'NEW_CASH',
      status: 'confirmed'
    },
    {
      id: 'dep_xfer_1',
      investor_id: 'inv_test',
      amount: 25000,
      accounting_treatment: 'INTERNAL_TRANSFER',
      type: 'Internal Transfer',
      status: 'confirmed'
    }
  ];

  const extCash = calculateTotalExternalCash({ depositRows });
  console.log('Total External Cash:', extCash.total);
  assert.strictEqual(extCash.total, 100000, 'INTERNAL_TRANSFER must contribute strictly $0.00 to Total External Cash');

  console.log('\n=== TEST 2: INTERNAL_TRANSFER AFFECTS ACCOUNTING BALANCE ===');
  const balDeposits = calculateBalanceAffectingDeposits({ depositRows, targetYear: 2026, maxMonth: 9 });
  console.log('Balance-affecting deposits:', balDeposits);
  assert.strictEqual(balDeposits, 125000, 'INTERNAL_TRANSFER must affect target account accounting balance');

  console.log('\n=== TEST 3: TOTAL PERFORMANCE DENOMINATOR UNAFFECTED ===');
  const perf = calculateLifetimePerformance({
    totalExternalCashSent: extCash.total,
    hasConfirmedExternalCashRecords: true,
    provenanceCompletenessStatus: 'COMPLETE',
    currentBalance: 150000 // $100k cash + $25k transfer + $25k gain
  });
  console.log('Total Performance $:', perf.totalPerformanceDollar);
  console.log('Total Performance %:', perf.totalPerformancePct);
  // Denominator is $100k, gain is $150k - $100k = $50k (+50.00%)
  assert.strictEqual(perf.totalExternalCashSent, 100000);
  assert.strictEqual(perf.totalPerformanceDollar, 50000);
  assert.strictEqual(perf.totalPerformancePct, 50.0);

  console.log('\n✓ ALL INTERNAL TRANSFER ACCOUNTING ENGINE INVARIANTS PASSED!');
}

testInternalTransferInvariants().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
