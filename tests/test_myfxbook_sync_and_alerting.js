import assert from 'node:assert';
import handler from '../api/cron/sync-myfxbook.js';
import { supabase } from '../lib/supabase.js';

function createMockReqRes({ headers = {}, query = {}, body = {} } = {}) {
  const req = {
    headers: { ...headers },
    query: { ...query },
    body: { ...body }
  };

  let statusCode = 200;
  let responseData = null;

  const res = {
    status(code) {
      statusCode = code;
      return res;
    },
    json(data) {
      responseData = data;
      return res;
    },
    getStatusCode: () => statusCode,
    getData: () => responseData
  };

  return { req, res };
}

async function runTests() {
  console.log('================================================================================');
  console.log('MYFXBOOK SYNC CRON ENDPOINT & FAIL-CLOSED ALERTING TEST SUITE');
  console.log('================================================================================\n');

  let passed = 0;
  let failed = 0;

  function check(condition, testName) {
    if (condition) {
      console.log(`✅ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`❌ FAIL: ${testName}`);
      failed++;
    }
  }

  // 1. Unauthorized request rejected with HTTP 401
  try {
    const { req: unauthReq, res: unauthRes } = createMockReqRes();
    await handler(unauthReq, unauthRes);
    check(unauthRes.getStatusCode() === 401, '1. Unauthorized request without cron headers is rejected with HTTP 401');
  } catch (err) {
    check(false, `1. Unauthorized request error: ${err.message}`);
  }

  // 2. Secret mismatch rejected with HTTP 401
  try {
    const { req: badSecretReq, res: badSecretRes } = createMockReqRes({
      headers: { authorization: 'Bearer wrong-secret' }
    });
    await handler(badSecretReq, badSecretRes);
    check(badSecretRes.getStatusCode() === 401, '2. Invalid Bearer token is rejected with HTTP 401');
  } catch (err) {
    check(false, `2. Invalid Bearer token error: ${err.message}`);
  }

  // 3. Verify September 2026 remains strictly locked at +3.07%
  try {
    const { data: sepReturn, error: sepErr } = await supabase
      .from('monthly_returns')
      .select('*')
      .eq('year', 2026)
      .eq('month_number', 9)
      .single();

    if (sepErr) throw sepErr;
    check(Number(sepReturn.gross_return_pct) === 3.07, '3. September 2026 gross_return_pct is strictly +3.07%');
    check(sepReturn.locked === true, '3b. September 2026 locked flag is strictly TRUE');
  } catch (err) {
    check(false, `3. September lock check error: ${err.message}`);
  }

  // 4. Verify October 2026 remains OPEN (locked = false)
  try {
    const { data: octReturn, error: octErr } = await supabase
      .from('monthly_returns')
      .select('*')
      .eq('year', 2026)
      .eq('month_number', 10)
      .single();

    if (octErr) throw octErr;
    check(octReturn.locked === false, '4. October 2026 locked flag is strictly FALSE (Open Month)');
    check(Number(octReturn.gross_return_pct) === 1.71, '4b. October 2026 return reflects current Myfxbook 1.71%');
  } catch (err) {
    check(false, `4. October status check error: ${err.message}`);
  }

  console.log(`\n================================================================================`);
  console.log(`MYFXBOOK SYNC TESTS: ${passed} PASSED / ${failed} FAILED`);
  console.log(`================================================================================\n`);

  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
