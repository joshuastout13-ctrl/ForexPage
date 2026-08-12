/**
 * Commission Rule Selection — Regression Tests
 * 
 * Tests the centralized getApplicableCommissionShare(s) helper
 * and verifies the Glenn Maddocks → Joshua Stout / Stone / Ross
 * historical/current transition scenarios.
 * 
 * Run: node test-commission-selection.js
 */

import { getApplicableCommissionShare, getApplicableCommissionShares } from './lib/commission-utils.js';

// ============================================================================
// Test Data — mirrors expected commission_shares rows for Glenn Maddocks
// ============================================================================
const GLENN_ID = 'gmaddocks';
const JOSHUA_ID = 'jstout';
const STONE_ID = 'stone001';
const ROSS_ID = 'rwamsley';

const testShares = [
  // Joshua Stout — Historical (March–June 2026)
  {
    id: 'test-js-old',
    source_investor_id: GLENN_ID,
    source_account_id: null,
    recipient_investor_id: JOSHUA_ID,
    commission_percent: 10.0,
    effective_start_date: '2026-03-01',
    effective_end_date: '2026-06-30',
    status: 'ended'
  },
  // Joshua Stout — Current (July 2026+)
  {
    id: 'test-js-new',
    source_investor_id: GLENN_ID,
    source_account_id: null,
    recipient_investor_id: JOSHUA_ID,
    commission_percent: 10.8,
    effective_start_date: '2026-07-01',
    effective_end_date: null,
    status: 'active'
  },
  // Stone and Co — Historical (March–June 2026)
  {
    id: 'test-st-old',
    source_investor_id: GLENN_ID,
    source_account_id: null,
    recipient_investor_id: STONE_ID,
    commission_percent: 20.0,
    effective_start_date: '2026-03-01',
    effective_end_date: '2026-06-30',
    status: 'ended'
  },
  // Stone and Co — Current (July 2026+)
  {
    id: 'test-st-new',
    source_investor_id: GLENN_ID,
    source_account_id: null,
    recipient_investor_id: STONE_ID,
    commission_percent: 9.6,
    effective_start_date: '2026-07-01',
    effective_end_date: null,
    status: 'active'
  },
  // Ross Wamsley — Historical (March–June 2026)
  {
    id: 'test-rw-old',
    source_investor_id: GLENN_ID,
    source_account_id: null,
    recipient_investor_id: ROSS_ID,
    commission_percent: 10.0,
    effective_start_date: '2026-03-01',
    effective_end_date: '2026-06-30',
    status: 'ended'
  },
  // Ross Wamsley — Current (July 2026+)
  {
    id: 'test-rw-new',
    source_investor_id: GLENN_ID,
    source_account_id: null,
    recipient_investor_id: ROSS_ID,
    commission_percent: 9.6,
    effective_start_date: '2026-07-01',
    effective_end_date: null,
    status: 'active'
  },
  // A cancelled rule (should always be excluded)
  {
    id: 'test-cancelled',
    source_investor_id: GLENN_ID,
    source_account_id: null,
    recipient_investor_id: JOSHUA_ID,
    commission_percent: 5.0,
    effective_start_date: '2026-01-01',
    effective_end_date: null,
    status: 'cancelled'
  }
];

// ============================================================================
// Test Runner
// ============================================================================
let passed = 0;
let failed = 0;

function assert(testName, actual, expected) {
  if (actual === expected) {
    console.log(`  ✅ ${testName}: ${actual}`);
    passed++;
  } else {
    console.error(`  ❌ ${testName}: expected ${expected}, got ${actual}`);
    failed++;
  }
}

function assertNull(testName, actual) {
  if (actual === null || actual === undefined) {
    console.log(`  ✅ ${testName}: null (as expected)`);
    passed++;
  } else {
    console.error(`  ❌ ${testName}: expected null, got ${JSON.stringify(actual)}`);
    failed++;
  }
}

// ============================================================================
// Test A: Glenn → Joshua transitions
// ============================================================================
console.log('\n=== TEST A: Glenn → Joshua Stout ===');

// A1. June 2026 → historical 10.0%
const a1 = getApplicableCommissionShare({
  shares: testShares, year: 2026, month: 6,
  sourceInvestorId: GLENN_ID, recipientInvestorId: JOSHUA_ID
});
assert('A1 - June 2026 commission %', a1?.commission_percent, 10.0);

// A2. July 2026 → current 10.8%
const a2 = getApplicableCommissionShare({
  shares: testShares, year: 2026, month: 7,
  sourceInvestorId: GLENN_ID, recipientInvestorId: JOSHUA_ID
});
assert('A2 - July 2026 commission %', a2?.commission_percent, 10.8);

// A3. August 2026 → current 10.8% (open-ended)
const a3 = getApplicableCommissionShare({
  shares: testShares, year: 2026, month: 8,
  sourceInvestorId: GLENN_ID, recipientInvestorId: JOSHUA_ID
});
assert('A3 - August 2026 commission %', a3?.commission_percent, 10.8);

// A4. February 2026 → no applicable rule (before March start)
const a4 = getApplicableCommissionShare({
  shares: testShares, year: 2026, month: 2,
  sourceInvestorId: GLENN_ID, recipientInvestorId: JOSHUA_ID
});
assertNull('A4 - February 2026 (before any rule)', a4);

// A5. March 2026 → historical 10.0% (start of first rule)
const a5 = getApplicableCommissionShare({
  shares: testShares, year: 2026, month: 3,
  sourceInvestorId: GLENN_ID, recipientInvestorId: JOSHUA_ID
});
assert('A5 - March 2026 commission %', a5?.commission_percent, 10.0);

// ============================================================================
// Test B: Glenn → Stone and Co transitions
// ============================================================================
console.log('\n=== TEST B: Glenn → Stone and Co ===');

// B1. June 2026 → historical 20.0%
const b1 = getApplicableCommissionShare({
  shares: testShares, year: 2026, month: 6,
  sourceInvestorId: GLENN_ID, recipientInvestorId: STONE_ID
});
assert('B1 - June 2026 commission %', b1?.commission_percent, 20.0);

// B2. July 2026 → current 9.6%
const b2 = getApplicableCommissionShare({
  shares: testShares, year: 2026, month: 7,
  sourceInvestorId: GLENN_ID, recipientInvestorId: STONE_ID
});
assert('B2 - July 2026 commission %', b2?.commission_percent, 9.6);

// ============================================================================
// Test C: Glenn → Ross Wamsley transitions
// ============================================================================
console.log('\n=== TEST C: Glenn → Ross Wamsley ===');

// C1. June 2026 → historical 10.0%
const c1 = getApplicableCommissionShare({
  shares: testShares, year: 2026, month: 6,
  sourceInvestorId: GLENN_ID, recipientInvestorId: ROSS_ID
});
assert('C1 - June 2026 commission %', c1?.commission_percent, 10.0);

// C2. July 2026 → current 9.6%
const c2 = getApplicableCommissionShare({
  shares: testShares, year: 2026, month: 7,
  sourceInvestorId: GLENN_ID, recipientInvestorId: ROSS_ID
});
assert('C2 - July 2026 commission %', c2?.commission_percent, 9.6);

// ============================================================================
// Test D: Privacy — Joshua only sees his own recipient rows
// ============================================================================
console.log('\n=== TEST D: Privacy — Recipient-only filtering ===');

const joshuaIdSet = new Set([JOSHUA_ID]);

// D1. Joshua querying July 2026 should only get his own rows, not Stone or Ross
const joshuaShares = getApplicableCommissionShares({
  shares: testShares, year: 2026, month: 7,
  recipientIdSet: joshuaIdSet
});
assert('D1 - Joshua sees only 1 source in July', joshuaShares.length, 1);
assert('D1 - Joshua source is Glenn', joshuaShares[0]?.source_investor_id, GLENN_ID);
assert('D1 - Joshua percent is 10.8%', joshuaShares[0]?.commission_percent, 10.8);

// D2. Joshua querying June should get his historical row only
const joshuaJuneShares = getApplicableCommissionShares({
  shares: testShares, year: 2026, month: 6,
  recipientIdSet: joshuaIdSet
});
assert('D2 - Joshua sees only 1 source in June', joshuaJuneShares.length, 1);
assert('D2 - Joshua percent is 10.0% in June', joshuaJuneShares[0]?.commission_percent, 10.0);

// ============================================================================
// Test E: Cancelled rows are excluded
// ============================================================================
console.log('\n=== TEST E: Cancelled rows excluded ===');

// E1. The cancelled 5% rule should never appear
const allJoshuaJan = getApplicableCommissionShares({
  shares: testShares, year: 2026, month: 1,
  sourceInvestorId: GLENN_ID, recipientInvestorId: JOSHUA_ID
});
assert('E1 - No rules in January (cancelled excluded)', allJoshuaJan.length, 0);

// E2. In March, cancelled row should not appear alongside the active 10% row
const allJoshuaMarch = getApplicableCommissionShares({
  shares: testShares, year: 2026, month: 3,
  sourceInvestorId: GLENN_ID, recipientInvestorId: JOSHUA_ID
});
assert('E2 - Only 1 rule in March (cancelled excluded)', allJoshuaMarch.length, 1);
assert('E2 - March rule is 10.0%', allJoshuaMarch[0]?.commission_percent, 10.0);

// ============================================================================
// Test F: Boundary — exact transition month (no gap, no overlap)
// ============================================================================
console.log('\n=== TEST F: Exact transition boundary ===');

// F1. June 30 is the last day the old rule covers — June query should return old rule
const juneShares = getApplicableCommissionShares({
  shares: testShares, year: 2026, month: 6,
  sourceInvestorId: GLENN_ID, recipientInvestorId: JOSHUA_ID
});
assert('F1 - June has exactly 1 applicable rule', juneShares.length, 1);
assert('F1 - June rule is 10.0%', juneShares[0]?.commission_percent, 10.0);

// F2. July 1 is when the new rule starts — July query should return new rule only
const julyShares = getApplicableCommissionShares({
  shares: testShares, year: 2026, month: 7,
  sourceInvestorId: GLENN_ID, recipientInvestorId: JOSHUA_ID
});
assert('F2 - July has exactly 1 applicable rule', julyShares.length, 1);
assert('F2 - July rule is 10.8%', julyShares[0]?.commission_percent, 10.8);

// ============================================================================
// Test G: getApplicableCommissionShares with Set-based IDs
// ============================================================================
console.log('\n=== TEST G: Set-based ID matching ===');

const sourceSet = new Set([GLENN_ID]);
const recipientSet = new Set([JOSHUA_ID]);

const g1 = getApplicableCommissionShare({
  shares: testShares, year: 2026, month: 8,
  sourceIdSet: sourceSet, recipientIdSet: recipientSet
});
assert('G1 - Set-based lookup returns 10.8%', g1?.commission_percent, 10.8);

// ============================================================================
// Test H: Far future dates (open-ended rules)
// ============================================================================
console.log('\n=== TEST H: Far future — open-ended rules ===');

const h1 = getApplicableCommissionShare({
  shares: testShares, year: 2027, month: 12,
  sourceInvestorId: GLENN_ID, recipientInvestorId: JOSHUA_ID
});
assert('H1 - Dec 2027 returns 10.8% (open-ended)', h1?.commission_percent, 10.8);

// ============================================================================
// Test I: All Glenn recipients in July — verify total = 30%
// ============================================================================
console.log('\n=== TEST I: All Glenn recipients July total ===');

const allGlennJuly = getApplicableCommissionShares({
  shares: testShares, year: 2026, month: 7,
  sourceInvestorId: GLENN_ID
});
const totalPct = allGlennJuly.reduce((sum, r) => sum + r.commission_percent, 0);
assert('I1 - 3 active recipients in July', allGlennJuly.length, 3);
assert('I2 - Total recipient % = 30.0', totalPct, 30.0);

// ============================================================================
// Summary
// ============================================================================
console.log(`\n${'='.repeat(50)}`);
console.log(`RESULTS: ${passed} passed, ${failed} failed, ${passed + failed} total`);
console.log(`${'='.repeat(50)}`);

if (failed > 0) {
  process.exit(1);
} else {
  console.log('\n🎉 All tests passed!\n');
  process.exit(0);
}
