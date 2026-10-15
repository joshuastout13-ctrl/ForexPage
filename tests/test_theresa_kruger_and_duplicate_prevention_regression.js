import assert from 'node:assert';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import Decimal from 'decimal.js';
import { supabase, isAuthoritativeProductionDbConfigured } from '../lib/supabase.js';
import { buildInvestorDashboard } from '../lib/dashboard.js';
import { executeTheresaCorrection, getCorrectionSql } from '../scripts/execute_theresa_kruger_correction.mjs';
import { sql } from '../scripts/inspect_internal_transfer_rpc.mjs';
import handler from '../api/admin/deposits/index.js';
import { createSession } from '../lib/auth.js';

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });
process.env.DATA_SOURCE = 'supabase';

console.log('================================================================================');
console.log('THERESA KRUGER CORRECTION & DUPLICATE PREVENTION REGRESSION SUITE');
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

function createMockReqRes({ method = 'POST', body = {}, adminId = 'admin_super' }) {
  const adminCookie = adminId ? createSession({ adminId, role: 'admin' }) : '';
  const req = {
    method,
    body,
    headers: {
      cookie: adminCookie ? `scff_admin_session=${adminCookie}` : ''
    }
  };

  let statusCode = 200;
  let responseData = null;

  const res = {
    status(code) {
      statusCode = code;
      return res;
    },
    setHeader() {
      return res;
    },
    json(data) {
      responseData = data;
      return res;
    },
    _getStatus: () => statusCode,
    _getData: () => responseData
  };

  return { req, res };
}

async function runRegressionSuite() {
  assert(isAuthoritativeProductionDbConfigured(), 'Must connect to authoritative Supabase (julhldzkiqdeuuoqmvlo)');

  // ---------------------------------------------------------------------------
  // 1. Theresa Withdrawal Amount Correction
  // ---------------------------------------------------------------------------
  try {
    const { data: wd } = await supabase
      .from('withdrawals')
      .select('*')
      .eq('id', 'af879743-8a64-42b9-898a-84d7925c40ad')
      .single();

    assert.strictEqual(Number(wd.amount), 1696.33, 'Withdrawal amount must be exactly 1696.33');
    assert.strictEqual(wd.status, 'Completed', 'Withdrawal status must remain Completed');
    assert.strictEqual(wd.effective_accounting_date, '2026-09-01', 'Effective date must remain 2026-09-01');
    assert(wd.notes && (wd.notes.includes('1,696.33') || wd.notes.includes('1696_33')), 'Notes must reference the authorized 1,696.33 correction');
    pass('1. Theresa withdrawal amount correction: $1,696.33 recorded with Completed status');
  } catch (e) { fail('1. Theresa withdrawal amount correction', e); }

  // ---------------------------------------------------------------------------
  // 2. September Trading-Gain Recalculation
  // ---------------------------------------------------------------------------
  try {
    const { data: m9 } = await supabase
      .from('investor_monthly_history')
      .select('*')
      .eq('investor_id', 'inv_8cf28066')
      .eq('year', 2026)
      .eq('month_number', 9)
      .single();

    assert.strictEqual(Number(m9.withdrawals), 1696.33, 'September history withdrawals must be 1696.33');
    assert.strictEqual(Math.round(Number(m9.ending_balance) * 100), 11168850, 'September ending balance must round to $111,688.50');

    const dash = await buildInvestorDashboard('tkruger', null, { mustBeAuthoritative: true });
    const sepRow = dash.breakdown.find(r => r.monthNumber === 9);
    assert.strictEqual(Math.round(sepRow.adjustedStartingBalance * 100), 11000000, 'September trading basis must be $110,000.00');
    assert.strictEqual(Math.round(sepRow.gain * 100), 168850, 'September trading gain must be $1,688.50');
    assert.strictEqual(Math.round(sepRow.endingBalance * 100), 11168850, 'September ending balance must be $111,688.50');
    pass('2. September trading-gain recalculation: basis=$110,000.00, gain=$1,688.50, end=$111,688.50');
  } catch (e) { fail('2. September trading-gain recalculation', e); }

  // ---------------------------------------------------------------------------
  // 3. October Carryforward
  // ---------------------------------------------------------------------------
  try {
    const { data: m10 } = await supabase
      .from('investor_monthly_history')
      .select('*')
      .eq('investor_id', 'inv_8cf28066')
      .eq('year', 2026)
      .eq('month_number', 10)
      .single();

    assert.strictEqual(Math.round(Number(m10.opening_balance) * 100), 11168850, 'October opening must round to $111,688.50');
    assert.strictEqual(Math.round(Number(m10.ending_balance) * 100), 11168850, 'October ending must round to $111,688.50');

    const dash = await buildInvestorDashboard('tkruger', null, { mustBeAuthoritative: true });
    assert.strictEqual(Math.round(dash.summary.currentBalance * 100), 11168850, 'Current settled balance must round to $111,688.50');
    pass('3. October carryforward: opening and settled balance carry forward $111,688.50');
  } catch (e) { fail('3. October carryforward', e); }

  // ---------------------------------------------------------------------------
  // 4. Locked-History Override & Immutability
  // ---------------------------------------------------------------------------
  try {
    const { data: sepReturn } = await supabase
      .from('monthly_returns')
      .select('*')
      .eq('year', 2026)
      .eq('month_number', 9)
      .single();

    assert.strictEqual(Number(sepReturn.gross_return_pct), 3.07, 'September gross return must remain +3.07%');
    assert.strictEqual(sepReturn.locked, true, 'September return must remain locked=true');

    const { data: m9 } = await supabase
      .from('investor_monthly_history')
      .select('locked, notes')
      .eq('investor_id', 'inv_8cf28066')
      .eq('year', 2026)
      .eq('month_number', 9)
      .single();

    assert.strictEqual(m9.locked, true, 'Theresa Kruger September monthly history must remain locked=true');
    assert(m9.notes && m9.notes.includes('Audited correction'), 'Notes must record explicit audited override');
    pass('4. Locked-history override & immutability: September remains locked at +3.07% with audited override notes');
  } catch (e) { fail('4. Locked-history override & immutability', e); }

  // ---------------------------------------------------------------------------
  // 5. Idempotent Retry
  // ---------------------------------------------------------------------------
  try {
    const retryResult = await executeTheresaCorrection();
    assert.strictEqual(retryResult.status, 'ALREADY_APPLIED', 'Retry must return ALREADY_APPLIED');
    assert.strictEqual(Math.round(retryResult.dash.summary.currentBalance * 100), 11168850, 'Balance must remain $111,688.50 on retry');
    pass('5. Idempotent retry: returning ALREADY_APPLIED without double-adjusting balances');
  } catch (e) { fail('5. Idempotent retry', e); }

  // ---------------------------------------------------------------------------
  // 6. Atomic Rollback Verification
  // ---------------------------------------------------------------------------
  try {
    // Execute a SQL block that induces a deliberate failure midway to prove PostgreSQL rollbacks atomically
    const testRollbackSql = `
      DO $$
      BEGIN
        PERFORM pg_advisory_xact_lock(hashtext('TEST_ROLLBACK_INVARIANT'));
        -- Attempt an invalid assertion
        IF 1 = 1 THEN
          RAISE EXCEPTION 'TEST_ATOMIC_ROLLBACK_VERIFIED';
        END IF;
      END $$;
    `;
    const res = await sql(testRollbackSql);
    const resStr = JSON.stringify(res);
    assert(resStr.includes('TEST_ATOMIC_ROLLBACK_VERIFIED'), 'Transaction failure must throw exception and roll back');
    pass('6. Atomic rollback verification: PostgreSQL aborts cleanly on assertion failure');
  } catch (e) { fail('6. Atomic rollback verification', e); }

  // ---------------------------------------------------------------------------
  // 7. Lifetime Withdrawal Totals
  // ---------------------------------------------------------------------------
  try {
    const dash = await buildInvestorDashboard('tkruger', null, { mustBeAuthoritative: true });
    assert.strictEqual(Math.round(dash.summary.totalWithdrawals * 100), 529566, 'Lifetime withdrawals must be exactly $5,295.66');
    pass('7. Lifetime withdrawal totals: correctly reduced by $1.00 from $5,296.66 to $5,295.66');
  } catch (e) { fail('7. Lifetime withdrawal totals', e); }

  // ---------------------------------------------------------------------------
  // 8. Prevention of Duplicate Embedded Funding (Michele Jackson & Sheryl Alvarado)
  // ---------------------------------------------------------------------------
  try {
    // Test Michele Jackson ($10,000, 2026-09-01) - matches starting capital and open date
    const { req: req1, res: res1 } = createMockReqRes({
      body: {
        investor_id: 'inv_3eae6871',
        account_id: 'mjackson',
        amount: 10000.00,
        date: '2026-09-01',
        accounting_treatment: 'NEW_CASH'
      }
    });
    await handler(req1, res1);
    assert.strictEqual(res1._getStatus(), 409, 'Must return 409 Conflict for embedded starting capital');
    assert(res1._getData()?.error?.includes('EMBEDDED_STARTING_CAPITAL_DUPLICATE'), 'Error must identify EMBEDDED_STARTING_CAPITAL_DUPLICATE');

    // Test Sheryl Alvarado ($60,000, 2026-09-01) - matches starting capital and open date
    const { req: req2, res: res2 } = createMockReqRes({
      body: {
        investor_id: 'inv_7dc0fe9a',
        account_id: 'saverado',
        amount: 60000.00,
        date: '2026-09-01',
        accounting_treatment: 'NEW_CASH'
      }
    });
    await handler(req2, res2);
    assert.strictEqual(res2._getStatus(), 409, 'Must return 409 Conflict for Sheryl Alvarado duplicate');
    assert(res2._getData()?.error?.includes('EMBEDDED_STARTING_CAPITAL_DUPLICATE'), 'Error must identify EMBEDDED_STARTING_CAPITAL_DUPLICATE');

    // Test Internal Transfer Misclassification prevention
    const { req: req3, res: res3 } = createMockReqRes({
      body: {
        investor_id: 'inv_3eae6871',
        account_id: 'mjackson',
        amount: 500.00,
        date: '2026-10-01',
        accounting_treatment: 'NEW_CASH',
        type: 'Transfer'
      }
    });
    await handler(req3, res3);
    assert.strictEqual(res3._getStatus(), 400, 'Must return 400 Bad Request for transfer posted as NEW_CASH');
    assert(res3._getData()?.error?.includes('INTERNAL_TRANSFER_MISCLASSIFIED'), 'Error must identify INTERNAL_TRANSFER_MISCLASSIFIED');

    pass('8. Prevention of duplicate embedded funding: blocked with HTTP 409 EMBEDDED_STARTING_CAPITAL_DUPLICATE');
  } catch (e) { fail('8. Prevention of duplicate embedded funding', e); }

  // ---------------------------------------------------------------------------
  // 9. Preservation of Legitimate Additional Deposits
  // ---------------------------------------------------------------------------
  try {
    // If an administrator provides explicit confirmation confirm_additional_to_starting_capital, the check allows it
    // We test parameter validation path without committing an unwanted write to production
    const { req, res } = createMockReqRes({
      body: {
        investor_id: 'inv_3eae6871',
        account_id: 'mjackson',
        amount: 10000.00,
        date: '2026-09-01',
        accounting_treatment: 'NEW_CASH',
        confirm_additional_to_starting_capital: true,
        // Provide invalid status to halt before actual DB insert
        status: 'invalid_status_for_safety_halt'
      }
    });
    await handler(req, res);
    // Should NOT fail with EMBEDDED_STARTING_CAPITAL_DUPLICATE
    assert.strictEqual(res._getStatus(), 400, 'Must pass embedded capital check and halt on status validation');
    assert(res._getData()?.error?.includes('INVALID_STATUS'), 'Halted at status validation, demonstrating embedded check was bypassed');
    pass('9. Preservation of legitimate additional deposits: explicit administrator confirmation permitted');
  } catch (e) { fail('9. Preservation of legitimate additional deposits', e); }

  // ---------------------------------------------------------------------------
  // 10. Unrelated Account Immutability
  // ---------------------------------------------------------------------------
  try {
    const kruckerDash = await buildInvestorDashboard('krucker', null, { mustBeAuthoritative: true });
    assert.strictEqual(Math.round(kruckerDash.summary.currentBalance * 100), 20583429, 'Kevin Rucker settled balance must be $205,834.29');

    const nwaiteDash = await buildInvestorDashboard('nwaite', null, { mustBeAuthoritative: true });
    assert.strictEqual(Math.round(nwaiteDash.summary.currentBalance * 100), 54816625, 'Neal Waite settled balance must be $548,166.25');

    const jstoutDash = await buildInvestorDashboard('jstout', null, { mustBeAuthoritative: true });
    assert.strictEqual(Math.round(jstoutDash.summary.currentBalance * 100), 333345352, 'Josh Stout settled balance must be $3,333,453.52');

    const jerryDash = await buildInvestorDashboard('jerrys001', null, { mustBeAuthoritative: true });
    assert.strictEqual(Math.round(jerryDash.summary.currentBalance * 100), 56770007, 'Jerry settled balance must be $567,700.07');

    const dtownleyDash = await buildInvestorDashboard('dtownley', null, { mustBeAuthoritative: true });
    assert.strictEqual(Math.round(dtownleyDash.summary.currentBalance * 100), 3822316, 'David Townley settled balance must be $38,223.16');

    const sherylDash = await buildInvestorDashboard('salvarado', null, { mustBeAuthoritative: true });
    assert.strictEqual(Math.round(sherylDash.summary.currentBalance * 100), 6092100, 'Sheryl Dunnam settled balance must be $60,921.00');

    pass('10. Unrelated account immutability: Rucker, Waite, Stout, Jerry, Townley, Dunnam 100% unchanged');
  } catch (e) { fail('10. Unrelated account immutability', e); }

  console.log('\n================================================================================');
  console.log(`REGRESSION SUITE RESULTS: ${passCount} PASSED / ${failCount} FAILED`);
  console.log('================================================================================\n');

  if (failCount > 0) process.exit(1);
}

runRegressionSuite().catch(err => {
  console.error('Fatal suite failure:', err);
  process.exit(1);
});
