import assert from 'node:assert';
import recalculateAllHandler from '../api/admin/historical-data/recalculate-all.js';
import recalculateHandler from '../api/admin/historical-data/recalculate.js';
import { createSession } from '../lib/auth.js';
import { evaluateMonthState, isMonthExplicitlyFinalizedAndLocked, MonthState } from '../lib/month-state.js';
import { calculateInvestorMonth, isDrawFulfillmentWithdrawal } from '../lib/accounting-engine.js';

console.log('================================================================================');
console.log('TEST SUITE: PLATFORM P0 SECURITY, ROLLOVER & SINGLE-COUNTING VALIDATION');
console.log('================================================================================\n');

let passed = 0;

// 1. Verify elimination of x-bypass-auth in recalculation endpoints
console.log('1. Testing Elimination of x-bypass-auth & Admin Session Gate...');
{
  // A. Unauthenticated request (no cookie, no header)
  const mockReqUnauth = {
    method: 'POST',
    headers: {},
    cookies: {}
  };
  let statusCode = null;
  let jsonResponse = null;
  const mockRes = {
    status: (code) => {
      statusCode = code;
      return {
        json: (data) => { jsonResponse = data; }
      };
    }
  };

  recalculateAllHandler(mockReqUnauth, mockRes);
  assert.strictEqual(statusCode, 401, 'recalculate-all must reject unauthenticated request with 401');
  assert.strictEqual(jsonResponse.error, 'Unauthorized');
  console.log('  ✅ recalculate-all rejects unauthenticated request with 401');

  statusCode = null;
  jsonResponse = null;
  recalculateHandler(mockReqUnauth, mockRes);
  assert.strictEqual(statusCode, 401, 'recalculate single must reject unauthenticated request with 401');
  assert.strictEqual(jsonResponse.error, 'Unauthorized');
  console.log('  ✅ recalculate single rejects unauthenticated request with 401');

  // B. Bypass header attempt without admin session (x-bypass-auth: temp-bypass)
  const mockReqBypass = {
    method: 'POST',
    headers: { 'x-bypass-auth': 'temp-bypass' },
    cookies: {}
  };
  statusCode = null;
  jsonResponse = null;
  recalculateAllHandler(mockReqBypass, mockRes);
  assert.strictEqual(statusCode, 401, 'recalculate-all must reject x-bypass-auth with 401 Unauthorized');
  assert.strictEqual(jsonResponse.error, 'Unauthorized');
  console.log('  ✅ recalculate-all rejects x-bypass-auth with 401');

  statusCode = null;
  jsonResponse = null;
  recalculateHandler(mockReqBypass, mockRes);
  assert.strictEqual(statusCode, 401, 'recalculate single must reject x-bypass-auth with 401 Unauthorized');
  assert.strictEqual(jsonResponse.error, 'Unauthorized');
  console.log('  ✅ recalculate single rejects x-bypass-auth with 401');

  // C. Authorized admin session request
  const validAdminToken = createSession({ adminId: 'admin_test_01', role: 'admin' });
  const mockReqAuth = {
    method: 'GET', // Use GET to test session verification passes and reaches method guard or payload check
    headers: {
      cookie: `scff_admin_session=${validAdminToken}`
    },
    cookies: {
      scff_admin_session: validAdminToken
    }
  };
  statusCode = null;
  jsonResponse = null;
  recalculateAllHandler(mockReqAuth, mockRes);
  // GET is not allowed (only POST), which proves session passed and handler proceeded to method check (405 Method not allowed)
  assert.strictEqual(statusCode, 405, 'Authorized session passes auth and proceeds to method check (405 on GET)');
  assert.strictEqual(jsonResponse.error, 'Method not allowed');
  console.log('  ✅ Authorized admin session cleanly passes authentication gate');

  passed += 5;
}

// 2. Testing Calendar Rollover vs Explicit Period Finalization
console.log('\n2. Testing Calendar Rollover vs Explicit Period Finalization...');
{
  // Simulated date: November 5, 2026
  const asOfNov5 = '2026-11-05T12:00:00Z';

  // October 2026 return is UNLOCKED
  const returnsWithUnlockedOct = [
    { year: 2026, month_number: 9, gross_return_pct: 3.07, locked: true },
    { year: 2026, month_number: 10, gross_return_pct: 3.05, locked: false }
  ];

  // A calendar rollover alone must NOT treat unlocked October as settled
  const stateUnlockedOct = evaluateMonthState(2026, 10, asOfNov5, { returnsList: returnsWithUnlockedOct });
  assert.strictEqual(stateUnlockedOct, MonthState.CURRENT_OPEN, 'Unlocked October on Nov 5 must evaluate to CURRENT_OPEN (not settled)');
  console.log('  ✅ Unlocked October remains CURRENT_OPEN after calendar rollover');

  // When October is explicitly locked, it becomes HISTORICAL_SETTLED
  const returnsWithLockedOct = [
    { year: 2026, month_number: 9, gross_return_pct: 3.07, locked: true },
    { year: 2026, month_number: 10, gross_return_pct: 3.05, locked: true }
  ];
  const stateLockedOct = evaluateMonthState(2026, 10, asOfNov5, { returnsList: returnsWithLockedOct });
  assert.strictEqual(stateLockedOct, MonthState.HISTORICAL_SETTLED, 'Locked October on Nov 5 evaluates to HISTORICAL_SETTLED');
  console.log('  ✅ Locked October correctly evaluates to HISTORICAL_SETTLED');

  // Explicit helper validation
  assert.strictEqual(isMonthExplicitlyFinalizedAndLocked(2026, 10, returnsWithUnlockedOct), false);
  assert.strictEqual(isMonthExplicitlyFinalizedAndLocked(2026, 10, returnsWithLockedOct), true);
  assert.strictEqual(isMonthExplicitlyFinalizedAndLocked(2026, 9, returnsWithUnlockedOct), true);
  console.log('  ✅ isMonthExplicitlyFinalizedAndLocked accurately checks locked status across periods');
  passed += 4;
}

// 3. Testing Single-Counting Recurring Draw Deduplication (Jeff Bennion scenario)
console.log('\n3. Testing Single-Counting Recurring Draw Deduplication...');
{
  // Case A: Withdrawal linked to draw obligation via explicit field
  assert.strictEqual(isDrawFulfillmentWithdrawal({ id: 'w1', is_draw: true }), true);
  assert.strictEqual(isDrawFulfillmentWithdrawal({ id: 'w2', draw_fulfillment: true }), true);
  assert.strictEqual(isDrawFulfillmentWithdrawal({ id: 'w3', purpose: 'monthly_draw' }), true);
  assert.strictEqual(isDrawFulfillmentWithdrawal({ id: 'w4', type: 'monthly_draw' }), true);
  assert.strictEqual(isDrawFulfillmentWithdrawal({ id: 'w5', source_event_type: 'CONTRACTUAL_MONTHLY_DRAW' }), true);
  assert.strictEqual(isDrawFulfillmentWithdrawal({ id: 'w6', linked_draw_id: 'draw_oct_2026' }), true);
  console.log('  ✅ Explicit draw links correctly identified across all valid linking attributes');

  // Case B: General withdrawal or substring in notes (PROHIBITED SUBSTRING MATCHING)
  assert.strictEqual(isDrawFulfillmentWithdrawal({ id: 'w7', notes: 'October draw payment' }), false, 'Substring in notes must NOT infer draw fulfillment');
  assert.strictEqual(isDrawFulfillmentWithdrawal({ id: 'w8', purpose: 'General distribution' }), false);
  assert.strictEqual(isDrawFulfillmentWithdrawal({ id: 'w9', amount: 5000 }), false);
  console.log('  ✅ Notes substring matching strictly rejected; unlinked withdrawals not misidentified');

  // Case C: Calculation single-counting verification (Jeff Bennion scenario)
  // Starting balance: $100,000, recurring draw: $5,000, withdrawal: $5,000 fulfilling draw.
  // Must deduct exactly $5,000 (ending $95,000), NEVER double-deduct to $90,000!
  const resFulfilled = calculateInvestorMonth({
    priorEndingBalance: 100000,
    deposits: 0,
    withdrawals: 5000,
    drawFulfillmentWithdrawals: 5000,
    recurringDraw: 5000,
    fundReturnPct: 0
  });
  assert.strictEqual(resFulfilled.endingBalance, 95000, 'Fulfillment withdrawal single-counts draw obligation ($95,000 ending)');
  assert.strictEqual(resFulfilled.eligibleCapital, 95000);
  console.log('  ✅ Fulfilled draw withdrawal single-counts deduction ($95,000.00 ending)');

  // Case D: Separate ad-hoc withdrawal ($10,000) PLUS separate contractual draw ($5,000).
  // Total deduction must be $15,000 (ending $85,000). Neither is suppressed.
  const resSeparate = calculateInvestorMonth({
    priorEndingBalance: 100000,
    deposits: 0,
    withdrawals: 10000,
    drawFulfillmentWithdrawals: 0,
    recurringDraw: 5000,
    fundReturnPct: 0
  });
  assert.strictEqual(resSeparate.endingBalance, 85000, 'Separate withdrawal preserves distinct contractual draw ($85,000 ending)');
  console.log('  ✅ Separate withdrawal and contractual draw both deducted cleanly ($85,000.00 ending)');

  // Case E: Partial draw fulfillment (e.g. withdrawal of $3,000 towards a $5,000 contractual draw)
  // Deducts $3,000 withdrawal from eligible capital, and $2,000 remaining draw obligation at month-end.
  // Total deduction = $5,000 (ending $95,000).
  const resPartial = calculateInvestorMonth({
    priorEndingBalance: 100000,
    deposits: 0,
    withdrawals: 3000,
    drawFulfillmentWithdrawals: 3000,
    recurringDraw: 5000,
    fundReturnPct: 0
  });
  assert.strictEqual(resPartial.endingBalance, 95000, 'Partial fulfillment cleanly accounts for remaining draw obligation ($95,000 ending)');
  console.log('  ✅ Partial draw fulfillment handles unfulfilled remainder accurately ($95,000.00 ending)');
  passed += 5;
}

console.log('\n================================================================================');
console.log(`ALL PLATFORM P0 VALIDATION CHECKS PASSED: ${passed}/${passed} succeeded`);
console.log('================================================================================\n');
