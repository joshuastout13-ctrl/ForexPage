import handler from '../api/cron/daily-reconciliation.js';
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
  console.log('DAILY RECONCILIATION CRON ENDPOINT & ALERT PIPELINE TEST SUITE');
  console.log('Authoritative Supabase Project: julhldzkiqdeuuoqmvlo');
  console.log('================================================================================');

  let passed = 0;
  let failed = 0;

  function assert(condition, testName) {
    if (condition) {
      console.log(`✅ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`❌ FAIL: ${testName}`);
      failed++;
    }
  }

  // 1. Test unauthorized access blocked
  const { req: unauthReq, res: unauthRes } = createMockReqRes();
  await handler(unauthReq, unauthRes);
  assert(unauthRes.getStatusCode() === 401, '1. Unauthorized request without cron headers is rejected with HTTP 401');

  // 2. Test authorized execution via Vercel Cron header (x-vercel-cron: '1')
  console.log('\n--- Executing daily reconciliation cron scan with testAlert=true ---');
  const { req: cronReq, res: cronRes } = createMockReqRes({
    headers: { 'x-vercel-cron': '1' },
    query: { testAlert: 'true' }
  });

  await handler(cronReq, cronRes);
  const status = cronRes.getStatusCode();
  const data = cronRes.getData();

  assert(status === 200, `2. Authorized cron execution returns HTTP 200 (received ${status})`);
  assert(data?.success === true, '3. Response body indicates success === true');
  assert(data?.status === 'PASS', '4. Reconciliation status is PASS across all 108 accounts');
  assert(data?.totalAccountsEvaluated === 108, '5. Evaluated exactly 108 investor accounts');
  assert(data?.successfulReconciliations === 108, '6. Reconciled exactly 108/108 accounts cent-exact');
  assert(data?.anomalyCounts?.P0 === 0, '7. Zero P0 critical anomalies detected');
  assert(data?.anomalyCounts?.P1 === 0, '8. Zero P1 structural anomalies detected');
  assert(Boolean(data?.auditRunId), `9. Run successfully recorded in audit_runs table (ID: ${data?.auditRunId})`);
  assert(Boolean(data?.alertDelivery?.logId), `10. Alert successfully delivered and recorded in admin_email_logs (Log ID: ${data?.alertDelivery?.logId})`);

  // Verify database record in audit_runs
  if (data?.auditRunId && supabase) {
    const { data: dbAudit, error: auditErr } = await supabase
      .from('audit_runs')
      .select('id, admin_id, year, month_number, report_json')
      .eq('id', data.auditRunId)
      .single();

    assert(!auditErr && dbAudit?.id === data.auditRunId, '11. Verified audit_runs record exists in Supabase PostgreSQL');
    assert(dbAudit?.report_json?.status === 'PASS', '12. Verified audit_runs report_json carries status: PASS');
  }

  // Verify database record in admin_email_logs
  if (data?.alertDelivery?.logId && supabase) {
    const { data: dbLog, error: logErr } = await supabase
      .from('admin_email_logs')
      .select('id, subject, recipient_emails, status, sent_by, is_test')
      .eq('id', data.alertDelivery.logId)
      .single();

    assert(!logErr && dbLog?.id === data.alertDelivery.logId, '13. Verified admin_email_logs record exists in Supabase PostgreSQL');
    assert(dbLog?.is_test === true, '14. Verified admin_email_logs record is tagged is_test = true');
    assert(dbLog?.sent_by === 'system_daily_reconciler', '15. Verified alert sender is system_daily_reconciler');
  }

  console.log('\n================================================================================');
  console.log(`DAILY RECONCILIATION TEST RESULTS: ${passed} PASSED / ${failed} FAILED`);
  console.log('================================================================================');

  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
