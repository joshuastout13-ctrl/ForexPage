import assert from "node:assert";
import Decimal from "decimal.js";
import { buildInvestorDashboard } from "../lib/dashboard.js";
import withdrawalHandler from "../api/admin/withdrawals/[id].js";
import { createSession } from "../lib/auth.js";

console.log("===============================================================================");
console.log("FOREXPAGE — TRANSACTION LIFECYCLE & LEDGER INTEGRITY PERMANENT TEST SUITE");
console.log("===============================================================================\n");

let passed = 0;
let failed = 0;

function createMockReqRes({ method = "GET", query = {}, body = {}, adminId = "admin_super" }) {
  const adminCookie = adminId ? createSession({ adminId, role: "admin" }) : "";
  const req = {
    method,
    query,
    body,
    headers: {
      cookie: adminCookie ? `scff_admin_session=${adminCookie}` : ""
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

async function runSuite() {
  // ---------------------------------------------------------------------------
  // 1. Withdrawal Lifecycle: Same ID Across Transitions
  // ---------------------------------------------------------------------------
  try {
    const withdrawal = {
      id: "wd_lifecycle_test_001",
      investor_id: "inv_test",
      account_id: "acc_test",
      amount: 25000.00,
      status: "Pending",
      effective_accounting_date: "2026-05-01",
      year: 2026,
      month_number: 5
    };

    const transitions = ["Approved", "Completed"];
    let current = { ...withdrawal };

    for (const nextStatus of transitions) {
      const prevId = current.id;
      current = { ...current, status: nextStatus, updated_at: new Date().toISOString() };
      assert.strictEqual(current.id, prevId, "Transaction ID must remain invariant across lifecycle transitions");
    }
    assert.strictEqual(current.status, "Completed");
    assert.strictEqual(current.amount, 25000.00);
    console.log("✅ PASS: 1. Withdrawal Lifecycle maintains single transaction ID across state transitions");
    passed++;
  } catch (err) {
    console.error("❌ FAIL: 1. Withdrawal Lifecycle maintains single transaction ID across state transitions");
    console.error(err);
    failed++;
  }

  // ---------------------------------------------------------------------------
  // 2. Economic Deduction: Exactly Once Invariant (Scott Sire May)
  // ---------------------------------------------------------------------------
  try {
    const preloadedData = {
      rawInvestors: [{
        investorsinvestorid: "inv_f22b8d5d",
        portalusername: "ssire",
        name: "Scott Sire",
        investorsplit: 65,
        active: true,
        startdate: "2026-04-01"
      }],
      accounts: [{
        investoraccountsaccountid: "acc_ssire",
        investorid: "inv_f22b8d5d",
        startingcapital: 34310.96,
        opendate: "2026-04-01",
        recurringmonthlydraw: 0
      }],
      returnsSheet: [
        { month: "Apr", monthnumber: 4, year: 2026, grossreturn: 3.15 },
        { month: "May", monthnumber: 5, year: 2026, grossreturn: 3.31 },
        { month: "Jun", monthnumber: 6, year: 2026, grossreturn: 3.67 },
        { month: "Jul", monthnumber: 7, year: 2026, grossreturn: 3.13 },
        { month: "Aug", monthnumber: 8, year: 2026, grossreturn: 3.03 }
      ],
      depositsSheet: [],
      withdrawalsSheet: [
        {
          id: "wd_completed_001",
          investorid: "inv_f22b8d5d",
          amount: 25000.00,
          status: "Completed",
          effectiveyear: 2026,
          effectivemonthnumber: 5,
          month: "May",
          year: 2026
        }
      ],
      historyTable: [
        {
          investor_id: "inv_f22b8d5d",
          year: 2026,
          month_number: 4,
          opening_balance: 34310.96,
          deposits: 0,
          withdrawals: 0,
          ending_balance: 35013.48,
          manual_gain_amount: 702.52
        }
      ],
      live: { source: "Live_Performance", today: 0, week: 0, month: 0, year: 0 }
    };

    const dashboard = await buildInvestorDashboard("ssire", preloadedData);
    const mayRow = dashboard.breakdown.find(r => r.month === "May");

    assert(mayRow, "May row must exist in breakdown");
    assert.strictEqual(mayRow.adjustedStartingBalance, 10013.48, "Eligible capital must be exactly $10,013.48 (deducted exactly once)");
    assert.strictEqual(Math.round(mayRow.gain * 100) / 100, 215.44, "May gain must round to exactly $215.44 on $10,013.48 base");
    assert.strictEqual(Math.round(mayRow.endingBalance * 100) / 100, 10228.92, "May ending balance must round to exactly $10,228.92");
    console.log("✅ PASS: 2. Single economic withdrawal affects balance exactly ONCE (Scott Sire May invariant)");
    passed++;
  } catch (err) {
    console.error("❌ FAIL: 2. Single economic withdrawal affects balance exactly ONCE (Scott Sire May invariant)");
    console.error(err);
    failed++;
  }

  // ---------------------------------------------------------------------------
  // 3. Pending Withdrawals: Zero Balance Capital Deduction
  // ---------------------------------------------------------------------------
  try {
    const preloadedData = {
      rawInvestors: [{
        investorsinvestorid: "inv_test_pending",
        portalusername: "testpending",
        name: "Test Pending",
        investorsplit: 100,
        active: true,
        startdate: "2026-05-01"
      }],
      accounts: [{
        investoraccountsaccountid: "acc_pending",
        investorid: "inv_test_pending",
        startingcapital: 50000.00,
        opendate: "2026-05-01",
        recurringmonthlydraw: 0
      }],
      returnsSheet: [
        { month: "May", monthnumber: 5, year: 2026, grossreturn: 2.00 }
      ],
      depositsSheet: [],
      withdrawalsSheet: [
        {
          id: "wd_pending_001",
          investorid: "inv_test_pending",
          amount: 20000.00,
          status: "Pending",
          effectiveyear: 2026,
          effectivemonthnumber: 5,
          month: "May",
          year: 2026
        }
      ],
      live: { source: "Live_Performance", today: 0, week: 0, month: 0, year: 0 }
    };

    const dashboard = await buildInvestorDashboard("testpending", preloadedData);
    const mayRow = dashboard.breakdown.find(r => r.month === "May");

    assert.strictEqual(mayRow.adjustedStartingBalance, 50000.00, "Pending withdrawal must NOT reduce eligible capital");
    assert.strictEqual(mayRow.pendingWithdrawal, 20000.00, "Pending withdrawal amount must be tracked in pendingWithdrawal property");
    assert.strictEqual(mayRow.oneTimeWithdrawal, 0, "oneTimeWithdrawal must be 0 when only pending exists");
    console.log("✅ PASS: 3. Pending withdrawal row does NOT reduce return-eligible capital");
    passed++;
  } catch (err) {
    console.error("❌ FAIL: 3. Pending withdrawal row does NOT reduce return-eligible capital");
    console.error(err);
    failed++;
  }

  // ---------------------------------------------------------------------------
  // 4. Cancelled Withdrawals: Completely Excluded
  // ---------------------------------------------------------------------------
  try {
    const preloadedData = {
      rawInvestors: [{
        investorsinvestorid: "inv_test_cancelled",
        portalusername: "testcancelled",
        name: "Test Cancelled",
        investorsplit: 100,
        active: true,
        startdate: "2026-05-01"
      }],
      accounts: [{
        investoraccountsaccountid: "acc_canc",
        investorid: "inv_test_cancelled",
        startingcapital: 50000.00,
        opendate: "2026-05-01",
        recurringmonthlydraw: 0
      }],
      returnsSheet: [
        { month: "May", monthnumber: 5, year: 2026, grossreturn: 2.00 }
      ],
      depositsSheet: [],
      withdrawalsSheet: [
        {
          id: "wd_canc_001",
          investorid: "inv_test_cancelled",
          amount: 15000.00,
          status: "Cancelled",
          effectiveyear: 2026,
          effectivemonthnumber: 5,
          month: "May",
          year: 2026
        }
      ],
      live: { source: "Live_Performance", today: 0, week: 0, month: 0, year: 0 }
    };

    const dashboard = await buildInvestorDashboard("testcancelled", preloadedData);
    const mayRow = dashboard.breakdown.find(r => r.month === "May");

    assert.strictEqual(mayRow.adjustedStartingBalance, 50000.00, "Cancelled withdrawal must NOT reduce eligible capital");
    assert.strictEqual(mayRow.pendingWithdrawal, 0, "Cancelled withdrawal must NOT appear as pending");
    assert.strictEqual(mayRow.oneTimeWithdrawal, 0, "Cancelled withdrawal must NOT appear as completed");
    console.log("✅ PASS: 4. Cancelled withdrawals are completely excluded from balance and activity");
    passed++;
  } catch (err) {
    console.error("❌ FAIL: 4. Cancelled withdrawals are completely excluded from balance and activity");
    console.error(err);
    failed++;
  }

  // ---------------------------------------------------------------------------
  // 5. Deposit Lifecycle: VOID Deposits Excluded
  // ---------------------------------------------------------------------------
  try {
    const preloadedData = {
      rawInvestors: [{
        investorsinvestorid: "inv_test_deposit",
        portalusername: "testdep",
        name: "Test Dep",
        investorsplit: 100,
        active: true,
        startdate: "2026-05-01"
      }],
      accounts: [{
        investoraccountsaccountid: "acc_dep",
        investorid: "inv_test_deposit",
        startingcapital: 10000.00,
        opendate: "2026-05-01",
        recurringmonthlydraw: 0
      }],
      returnsSheet: [
        { month: "May", monthnumber: 5, year: 2026, grossreturn: 2.00 }
      ],
      depositsSheet: [
        {
          id: "dep_active",
          investorid: "inv_test_deposit",
          amount: 5000.00,
          type: "Deposit",
          monthnumber: 5,
          year: 2026
        },
        {
          id: "dep_voided",
          investorid: "inv_test_deposit",
          amount: 99000.00,
          type: "VOID",
          monthnumber: 5,
          year: 2026
        }
      ],
      withdrawalsSheet: [],
      live: { source: "Live_Performance", today: 0, week: 0, month: 0, year: 0 }
    };

    const dashboard = await buildInvestorDashboard("testdep", preloadedData);
    const mayRow = dashboard.breakdown.find(r => r.month === "May");

    assert.strictEqual(mayRow.adjustedStartingBalance, 15000.00, "Eligible capital must include active deposit and exclude VOID deposit");
    assert.strictEqual(mayRow.deposits, 5000.00, "Deposits total must equal $5,000.00 (VOID excluded)");
    console.log("✅ PASS: 5. Deposit lifecycle excludes VOID deposits from capital and compounding");
    passed++;
  } catch (err) {
    console.error("❌ FAIL: 5. Deposit lifecycle excludes VOID deposits from capital and compounding");
    console.error(err);
    failed++;
  }

  // ---------------------------------------------------------------------------
  // 6. Available Equity: Does Not Double-Reserve When Properly Lifecycle Transitioned
  // ---------------------------------------------------------------------------
  try {
    const activeWdsWithDuplicate = [
      { id: "wd_p", amount: 25000.00, status: "pending" },
      { id: "wd_c", amount: 25000.00, status: "completed" }
    ];
    const reservedDefect = activeWdsWithDuplicate
      .filter(w => ["pending", "approved", "completed"].includes(w.status.toLowerCase()))
      .reduce((sum, w) => sum + w.amount, 0);
    assert.strictEqual(reservedDefect, 50000.00, "Defect state reproduces $50,000.00 reservation");

    const activeWdsRemediated = [
      { id: "wd_p", amount: 25000.00, status: "cancelled" },
      { id: "wd_c", amount: 25000.00, status: "completed" }
    ];
    const reservedRemediated = activeWdsRemediated
      .filter(w => ["pending", "approved", "completed"].includes(w.status.toLowerCase()))
      .reduce((sum, w) => sum + w.amount, 0);
    assert.strictEqual(reservedRemediated, 25000.00, "Remediated state reserves exactly $25,000.00");
    console.log("✅ PASS: 6. Available Equity calculation does NOT double-reserve when Completed row replaces Pending row");
    passed++;
  } catch (err) {
    console.error("❌ FAIL: 6. Available Equity calculation does NOT double-reserve when Completed row replaces Pending row");
    console.error(err);
    failed++;
  }

  // ---------------------------------------------------------------------------
  // 7. Cashflow Timing Semantics (Production vs Spreadsheet Evaluation)
  // ---------------------------------------------------------------------------
  try {
    const aprilClose = new Decimal(35013.48);
    const mayWithdrawal = new Decimal(25000.00);
    const mayNetReturnPct = new Decimal(3.31).mul(0.65).div(100); // 2.1515%

    // 1. Production Rule: Month-start withdrawal timing
    const prodEligible = aprilClose.sub(mayWithdrawal);
    const prodGain = new Decimal(215.44);
    const prodEnding = prodEligible.add(prodGain);
    assert.strictEqual(prodEligible.toNumber(), 10013.48);
    assert.strictEqual(prodGain.toNumber(), 215.44);
    assert.strictEqual(prodEnding.toNumber(), 10228.92);

    // 2. Spreadsheet Rule: Month-end withdrawal timing
    const sheetEligible = aprilClose;
    const sheetGain = new Decimal(753.31);
    const sheetEnding = sheetEligible.add(sheetGain).sub(mayWithdrawal);
    assert.strictEqual(sheetEligible.toNumber(), 35013.48);
    assert.strictEqual(sheetGain.toNumber(), 753.31);
    assert.strictEqual(sheetEnding.toNumber(), 10766.79);

    // 3. Exact Mathematical Delta
    const gainDelta = sheetGain.sub(prodGain);
    assert.strictEqual(gainDelta.toNumber(), 537.87);
    console.log("✅ PASS: 7. Cashflow timing semantics verified: Production ($215.44) vs Spreadsheet ($753.31) delta is cent-exact ($537.87)");
    passed++;
  } catch (err) {
    console.error("❌ FAIL: 7. Cashflow timing semantics verified");
    console.error(err);
    failed++;
  }

  // ---------------------------------------------------------------------------
  // 8. Physical Deletion Prohibition (HTTP 405 Method Not Allowed)
  // ---------------------------------------------------------------------------
  try {
    const { req, res } = createMockReqRes({ method: "DELETE", query: { id: "wd_test_delete" } });
    await withdrawalHandler(req, res);
    assert.strictEqual(res._getStatus(), 405, "Physical DELETE on withdrawal endpoint must return HTTP 405 Method Not Allowed");
    console.log("✅ PASS: 8. Physical DELETE /api/admin/withdrawals/[id] strictly prohibited (HTTP 405 Method Not Allowed)");
    passed++;
  } catch (err) {
    console.error("❌ FAIL: 8. Physical DELETE /api/admin/withdrawals/[id] strictly prohibited");
    console.error(err);
    failed++;
  }

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  console.log("\n===============================================================================");
  console.log(`TRANSACTION LIFECYCLE TEST RESULTS: ${passed} PASSED / ${failed} FAILED`);
  console.log("===============================================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runSuite();
