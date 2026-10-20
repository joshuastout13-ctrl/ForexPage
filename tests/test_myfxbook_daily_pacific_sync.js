import assert from "node:assert";
import handler from "../api/cron/sync-myfxbook.js";
import { 
  determineSyncWindow, 
  getPacificDateString, 
  checkDailySyncCompleted, 
  claimDailySyncSlot,
  finalizeDailySyncSuccess,
  finalizeDailySyncFailure,
  acquireLocalSyncLock, 
  releaseLocalSyncLock 
} from "../lib/myfxbook-sync-manager.js";
import { supabase } from "../lib/supabase.js";
import { executeDailyFinancialReconciliation } from "../lib/daily-reconciliation-engine.js";

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

async function runTestSuite() {
  console.log("================================================================================");
  console.log("FOREXPAGE — PACIFIC MIDNIGHT SYNC, ATOMIC CLAIM & CREDIT PROTECTION SUITE");
  console.log("================================================================================\n");

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

  // ---------------------------------------------------------------------------
  // TEST 1: DST-Aware Pacific Window Resolution (PDT and PST)
  // ---------------------------------------------------------------------------
  console.log("--- 1. DST-Aware Pacific Window Resolution ---");

  // In PDT (UTC-7, e.g. 2026-10-20):
  const pdtPrimary = determineSyncWindow("2026-10-20T07:30:00Z");
  check(pdtPrimary.window === "PRIMARY", "1.1. PDT 07:30 UTC maps to PRIMARY window (12:30 AM PDT)");
  check(pdtPrimary.hour === 0 && pdtPrimary.minute === 30, "1.2. PDT 07:30 UTC hour:minute is 00:30");

  const pdtBackup = determineSyncWindow("2026-10-20T08:30:00Z");
  check(pdtBackup.window === "BACKUP", "1.3. PDT 08:30 UTC maps to BACKUP window (1:30 AM PDT)");
  check(pdtBackup.hour === 1 && pdtBackup.minute === 30, "1.4. PDT 08:30 UTC hour:minute is 01:30");

  const pdtOutside = determineSyncWindow("2026-10-20T09:30:00Z");
  check(pdtOutside.window === "OUTSIDE_WINDOW", "1.5. PDT 09:30 UTC maps to OUTSIDE_WINDOW (2:30 AM PDT)");

  // In PST (UTC-8, e.g. 2027-01-15):
  const pstOutside = determineSyncWindow("2027-01-15T07:30:00Z");
  check(pstOutside.window === "OUTSIDE_WINDOW", "1.6. PST 07:30 UTC maps to OUTSIDE_WINDOW (11:30 PM PST prior day)");

  const pstPrimary = determineSyncWindow("2027-01-15T08:30:00Z");
  check(pstPrimary.window === "PRIMARY", "1.7. PST 08:30 UTC maps to PRIMARY window (12:30 AM PST)");
  check(pstPrimary.hour === 0 && pstPrimary.minute === 30, "1.8. PST 08:30 UTC hour:minute is 00:30");

  const pstBackup = determineSyncWindow("2027-01-15T09:30:00Z");
  check(pstBackup.window === "BACKUP", "1.9. PST 09:30 UTC maps to BACKUP window (1:30 AM PST)");
  check(pstBackup.hour === 1 && pstBackup.minute === 30, "1.10. PST 09:30 UTC hour:minute is 01:30");

  // ---------------------------------------------------------------------------
  // TEST 2: Atomic Database-Level Daily Claim Across Vercel Instances
  // ---------------------------------------------------------------------------
  console.log("\n--- 2. Atomic Database-Level Daily Claim Protection ---");

  const testPacificDate = "2099-10-20";
  // Clean up any existing test row before starting
  await supabase.from("myfxbook_sync_claims").delete().eq("pacific_date", testPacificDate);

  // Instance A claims Primary slot
  const claimA = await claimDailySyncSlot({
    pacificDateStr: testPacificDate,
    windowType: "PRIMARY",
    instanceId: "vercel_lambda_instance_A"
  });
  check(claimA.claimed === true, "2.1. Instance A successfully claims daily sync slot for test date");
  check(claimA.claimRecord?.status === "CLAIMED", "2.2. Atomic claim status initialized to CLAIMED");

  // Simultaneous Instance B attempts to claim same slot
  const claimB = await claimDailySyncSlot({
    pacificDateStr: testPacificDate,
    windowType: "PRIMARY",
    instanceId: "vercel_lambda_instance_B"
  });
  check(claimB.claimed === false, "2.3. Simultaneous Instance B claim is atomically rejected");
  check(claimB.reason === "CONCURRENT_INSTANCE_CLAIMED", "2.4. Instance B rejected reason is CONCURRENT_INSTANCE_CLAIMED");

  // Finalize Instance A with genuine fresh data
  const mockLiveData = {
    today: "+0.00%",
    week: "+0.07%",
    month: "+1.71%",
    year: "+31.51%",
    gain: "+31.51%",
    absGain: "+31.51%",
    drawdown: "0.00%",
    fetchedAt: new Date().toISOString(),
    source: "Myfxbook (Scrape.do)",
    isLiveScraped: true
  };
  await finalizeDailySyncSuccess({
    pacificDateStr: testPacificDate,
    windowType: "PRIMARY",
    data: mockLiveData,
    instanceId: "vercel_lambda_instance_A"
  });

  // Verify atomic claim row in database is now SUCCESS with data_hash
  const { data: verifiedClaim } = await supabase
    .from("myfxbook_sync_claims")
    .select("*")
    .eq("pacific_date", testPacificDate)
    .single();

  check(verifiedClaim?.status === "SUCCESS", "2.5. Claim row status transitioned to SUCCESS");
  check(Boolean(verifiedClaim?.data_hash), "2.6. Genuine data fingerprint hash generated and stored");
  check(verifiedClaim?.source === "Myfxbook (Scrape.do)", "2.7. Scrape.do source recorded");

  // Verify checkDailySyncCompleted finds it
  const markerCheck = await checkDailySyncCompleted(testPacificDate);
  check(markerCheck.completed === true, "2.8. Durable success marker detected in database");

  // ---------------------------------------------------------------------------
  // TEST 3: Backup Window Automatic Skipping (0 Credits Consumed)
  // ---------------------------------------------------------------------------
  console.log("\n--- 3. Backup Window Automatic Skipping ---");

  // When Backup window triggers for that test date, it must skip without scraping
  const { req: backupReq, res: backupRes } = createMockReqRes({
    headers: { "x-vercel-cron": "1" },
    query: { simulatedDate: `${testPacificDate}T08:30:00Z` } // Backup window in PDT
  });
  await handler(backupReq, backupRes);
  check(backupRes.getStatusCode() === 200, "3.1. Backup trigger returns HTTP 200");
  check(backupRes.getData()?.skipped === true, "3.2. Backup execution flags skipped: true");
  check(backupRes.getData()?.reason === "BACKUP_SKIPPED_PRIMARY_SUCCEEDED", "3.3. Backup skip reason is BACKUP_SKIPPED_PRIMARY_SUCCEEDED");

  // Clean up synthetic test row
  await supabase.from("myfxbook_sync_claims").delete().eq("pacific_date", testPacificDate);
  await supabase.from("audit_runs").delete().eq("admin_id", "myfxbook_daily_sync").eq("year", 2099);

  // ---------------------------------------------------------------------------
  // TEST 4: Accounting Immutability & Reconciled Balances
  // ---------------------------------------------------------------------------
  console.log("\n--- 4. Accounting Immutability & Reconciled Balances ---");

  // September 2026 lock
  const { data: sepReturn, error: sepErr } = await supabase
    .from("monthly_returns")
    .select("*")
    .eq("year", 2026)
    .eq("month_number", 9)
    .single();

  check(!sepErr && Number(sepReturn.gross_return_pct) === 3.07, "4.1. September 2026 return is strictly +3.07%");
  check(sepReturn.locked === true, "4.2. September 2026 locked is strictly TRUE");

  // October 2026 open status
  const { data: octReturn, error: octErr } = await supabase
    .from("monthly_returns")
    .select("*")
    .eq("year", 2026)
    .eq("month_number", 10)
    .single();

  check(!octErr && octReturn.locked === false, "4.3. October 2026 locked is strictly FALSE");
  check(Number(octReturn.gross_return_pct) === 1.71, "4.4. October 2026 return is +1.71%");

  // 108 accounts ground truth
  const recon = await executeDailyFinancialReconciliation();
  check(recon.status === "PASS", "4.5. Financial reconciliation engine returns PASS");
  check(recon.totalAccountsEvaluated === 108, "4.6. Exactly 108 active investor accounts evaluated");
  check(recon.successfulReconciliations === 108, "4.7. All 108 accounts reconciled with zero balance variances");
  check(recon.anomalyCounts.P0 === 0 && recon.anomalyCounts.P1 === 0, "4.8. Zero P0 or P1 accounting anomalies");

  console.log("\n================================================================================");
  console.log(`PACIFIC MIDNIGHT SYNC SUITE: ${passed} PASSED / ${failed} FAILED`);
  console.log("================================================================================\n");

  if (failed > 0) process.exit(1);
}

runTestSuite().catch(err => {
  console.error("Fatal test error:", err);
  process.exit(1);
});
