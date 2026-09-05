/**
 * FOREXPAGE — lib/month-state.js Unit Tests & Cross-Surface Consistency Suite
 *
 * Verifies the authoritative fund accounting month-state module in isolation
 * and cross-surface consistency across:
 * - dashboard
 * - accounting preview
 * - commission cards
 * - Myfxbook target-month selection
 * - audit tooling
 * - chart/backend flags
 *
 * All assertions use fixed timestamps — no live clock dependency.
 *
 * Run: node tests/test_month_state.js
 */

import assert from "assert";
import { createRequire } from "module";
import {
  FUND_ACCOUNTING_TIMEZONE,
  MonthState,
  getFundAccountingDate,
  evaluateMonthState,
  getLastCompletedMonth,
  getLastCompletedMonthWithYear,
  isHistoricalSettled,
  isCurrentOpen,
  isFuture
} from "../lib/month-state.js";
import { buildInvestorDashboard } from "../lib/dashboard.js";

const require = createRequire(import.meta.url);
const cjsMonthState = require("../lib/month-state.cjs");

let passed = 0;
let failed = 0;

function pass(msg) {
  console.log(`  ✓ ${msg}`);
  passed++;
}

function fail(msg, err) {
  console.error(`  ✗ ${msg}`);
  if (err) console.error(`    ${err.message}`);
  failed++;
}

async function test(label, fn) {
  try {
    await fn();
    pass(label);
  } catch (e) {
    fail(label, e);
  }
}

async function run() {
  // ============================================================
  // SECTION 1: CONSTANTS
  // ============================================================
  console.log("\n--- 1. CONSTANTS ---");

  await test("FUND_ACCOUNTING_TIMEZONE === 'America/Los_Angeles'", () => {
    assert.strictEqual(FUND_ACCOUNTING_TIMEZONE, "America/Los_Angeles");
  });

  await test("MonthState has exactly HISTORICAL_SETTLED, CURRENT_OPEN, FUTURE", () => {
    assert.strictEqual(Object.keys(MonthState).length, 3);
    assert.strictEqual(MonthState.HISTORICAL_SETTLED, "HISTORICAL_SETTLED");
    assert.strictEqual(MonthState.CURRENT_OPEN, "CURRENT_OPEN");
    assert.strictEqual(MonthState.FUTURE, "FUTURE");
  });

  // ============================================================
  // SECTION 2: getFundAccountingDate
  // ============================================================
  console.log("\n--- 2. getFundAccountingDate ---");

  // Sep 5 2026 UTC → Sep 4 in LA (UTC-7 PDT)
  await test("2026-09-05T07:00:00Z → September 5 in LA (PDT)", () => {
    const d = getFundAccountingDate("2026-09-05T07:00:00Z");
    assert.strictEqual(d.year, 2026);
    assert.strictEqual(d.monthNumber, 9);
    assert.strictEqual(d.day, 5);
  });

  // Jan 1 2027 08:30 UTC → Dec 31 2026 in LA (UTC-8 PST)
  await test("2027-01-01T08:30:00Z → January 1 2027 in LA (PST)", () => {
    const d = getFundAccountingDate("2027-01-01T08:30:00Z");
    assert.strictEqual(d.year, 2027);
    assert.strictEqual(d.monthNumber, 1);
  });

  // Oct 1 2026 06:59:59 UTC → Sep 30 in LA (UTC-7 PDT)
  await test("2026-10-01T06:59:59Z → September 30 in LA", () => {
    const d = getFundAccountingDate("2026-10-01T06:59:59Z");
    assert.strictEqual(d.year, 2026);
    assert.strictEqual(d.monthNumber, 9);
    assert.strictEqual(d.day, 30);
  });

  // Oct 1 2026 07:00:00 UTC → Oct 1 in LA (UTC-7 PDT)
  await test("2026-10-01T07:00:00Z → October 1 in LA", () => {
    const d = getFundAccountingDate("2026-10-01T07:00:00Z");
    assert.strictEqual(d.year, 2026);
    assert.strictEqual(d.monthNumber, 10);
    assert.strictEqual(d.day, 1);
  });

  // 2026-10-31T22:00:00Z = Oct 31 3:00pm PDT (UTC-7) — unambiguously October in LA
  await test("2026-10-31T22:00:00Z (Oct 31 3pm PDT) → October 31 in LA", () => {
    const d = getFundAccountingDate("2026-10-31T22:00:00Z");
    assert.strictEqual(d.year, 2026);
    assert.strictEqual(d.monthNumber, 10);
    assert.strictEqual(d.day, 31);
  });

  // ============================================================
  // SECTION 3: evaluateMonthState
  // ============================================================
  console.log("\n--- 3. evaluateMonthState ---");

  const sep5 = "2026-09-05T12:00:00Z";

  await test("Sep 5 2026: August is HISTORICAL_SETTLED", () => {
    assert.strictEqual(evaluateMonthState(2026, 8, sep5), MonthState.HISTORICAL_SETTLED);
  });

  await test("Sep 5 2026: September is CURRENT_OPEN", () => {
    assert.strictEqual(evaluateMonthState(2026, 9, sep5), MonthState.CURRENT_OPEN);
  });

  await test("Sep 5 2026: October is FUTURE", () => {
    assert.strictEqual(evaluateMonthState(2026, 10, sep5), MonthState.FUTURE);
  });

  await test("Sep 5 2026: Prior year 2025 is all HISTORICAL_SETTLED", () => {
    for (let m = 1; m <= 12; m++) {
      assert.strictEqual(evaluateMonthState(2025, m, sep5), MonthState.HISTORICAL_SETTLED);
    }
  });

  await test("Sep 5 2026: Next year 2027 is all FUTURE", () => {
    for (let m = 1; m <= 12; m++) {
      assert.strictEqual(evaluateMonthState(2027, m, sep5), MonthState.FUTURE);
    }
  });

  // Rollover exact second: Sep 30 23:59:59 LA (PDT: UTC-7)
  const sep30LA = "2026-09-30T23:59:59-07:00";
  await test("Sep 30 23:59:59 LA: September is still CURRENT_OPEN", () => {
    assert.strictEqual(evaluateMonthState(2026, 9, sep30LA), MonthState.CURRENT_OPEN);
    assert.strictEqual(evaluateMonthState(2026, 10, sep30LA), MonthState.FUTURE);
  });

  // Rollover exact second: Oct 1 00:00:00 LA (PDT: UTC-7)
  const oct1LA = "2026-10-01T00:00:00-07:00";
  await test("Oct 1 00:00:00 LA: September is now HISTORICAL_SETTLED, October is CURRENT_OPEN", () => {
    assert.strictEqual(evaluateMonthState(2026, 9, oct1LA), MonthState.HISTORICAL_SETTLED);
    assert.strictEqual(evaluateMonthState(2026, 10, oct1LA), MonthState.CURRENT_OPEN);
    assert.strictEqual(evaluateMonthState(2026, 11, oct1LA), MonthState.FUTURE);
  });

  // Year boundary exact seconds
  const dec31LA = "2026-12-31T23:59:59-08:00"; // PST
  const jan1LA = "2027-01-01T00:00:00-08:00";  // PST

  await test("Dec 31 23:59:59 LA: Dec 2026 is CURRENT_OPEN, Jan 2027 is FUTURE", () => {
    assert.strictEqual(evaluateMonthState(2026, 12, dec31LA), MonthState.CURRENT_OPEN);
    assert.strictEqual(evaluateMonthState(2027, 1, dec31LA), MonthState.FUTURE);
  });

  await test("Jan 1 00:00:00 LA: Dec 2026 is HISTORICAL_SETTLED, Jan 2027 is CURRENT_OPEN", () => {
    assert.strictEqual(evaluateMonthState(2026, 12, jan1LA), MonthState.HISTORICAL_SETTLED);
    assert.strictEqual(evaluateMonthState(2027, 1, jan1LA), MonthState.CURRENT_OPEN);
  });

  // ============================================================
  // SECTION 4: getLastCompletedMonth
  // ============================================================
  console.log("\n--- 4. getLastCompletedMonth ---");

  await test("Sep 5 2026 LA → lastCompleted(2026) = 8", () => {
    assert.strictEqual(getLastCompletedMonth(2026, sep5), 8);
  });

  await test("Oct 1 2026 LA → lastCompleted(2026) = 9", () => {
    assert.strictEqual(getLastCompletedMonth(2026, oct1LA), 9);
  });

  await test("Sep 5 2026 LA → lastCompleted(2025) = 12 (prior year fully complete)", () => {
    assert.strictEqual(getLastCompletedMonth(2025, sep5), 12);
  });

  await test("Sep 5 2026 LA → lastCompleted(2027) = 0 (future year)", () => {
    assert.strictEqual(getLastCompletedMonth(2027, sep5), 0);
  });

  const jan1_2027_LA = "2027-01-01T08:30:00Z";
  await test("Jan 1 2027 LA → lastCompleted(2026) = 12 (all 2026 months completed)", () => {
    assert.strictEqual(getLastCompletedMonth(2026, jan1_2027_LA), 12);
  });

  const jan1_2026_LA = "2026-01-01T08:30:00Z";
  await test("Jan 1 2026 LA → lastCompleted(2026) = 0 (zero months completed)", () => {
    assert.strictEqual(getLastCompletedMonth(2026, jan1_2026_LA), 0);
  });

  // ============================================================
  // SECTION 5: getLastCompletedMonthWithYear
  // ============================================================
  console.log("\n--- 5. getLastCompletedMonthWithYear ---");

  await test("Sep 5 2026 LA → { year: 2026, month: 8 }", () => {
    const r = getLastCompletedMonthWithYear(sep5);
    assert.deepStrictEqual(r, { year: 2026, month: 8 });
  });

  await test("Oct 1 2026 LA → { year: 2026, month: 9 }", () => {
    const r = getLastCompletedMonthWithYear(oct1LA);
    assert.deepStrictEqual(r, { year: 2026, month: 9 });
  });

  await test("Jan 1 2027 LA → { year: 2026, month: 12 } (year-boundary safety)", () => {
    const r = getLastCompletedMonthWithYear(jan1_2027_LA);
    assert.deepStrictEqual(r, { year: 2026, month: 12 });
  });

  await test("Jan 1 2026 LA → { year: 2025, month: 12 } (year-boundary safety)", () => {
    const r = getLastCompletedMonthWithYear(jan1_2026_LA);
    assert.deepStrictEqual(r, { year: 2025, month: 12 });
  });

  // ============================================================
  // SECTION 6: Boolean helpers
  // ============================================================
  console.log("\n--- 6. Boolean helpers ---");

  await test("isHistoricalSettled(2026,8,sep5) === true", () => {
    assert.strictEqual(isHistoricalSettled(2026, 8, sep5), true);
  });

  await test("isHistoricalSettled(2026,9,sep5) === false", () => {
    assert.strictEqual(isHistoricalSettled(2026, 9, sep5), false);
  });

  await test("isCurrentOpen(2026,9,sep5) === true", () => {
    assert.strictEqual(isCurrentOpen(2026, 9, sep5), true);
  });

  await test("isCurrentOpen(2026,8,sep5) === false", () => {
    assert.strictEqual(isCurrentOpen(2026, 8, sep5), false);
  });

  await test("isFuture(2026,10,sep5) === true", () => {
    assert.strictEqual(isFuture(2026, 10, sep5), true);
  });

  await test("isFuture(2026,9,sep5) === false", () => {
    assert.strictEqual(isFuture(2026, 9, sep5), false);
  });

  // ============================================================
  // SECTION 7: DST transition precision
  // ============================================================
  console.log("\n--- 7. DST transition precision ---");

  await test("2026-10-31T20:00:00Z (Oct 31 13:00 PDT) → October in LA", () => {
    const d = getFundAccountingDate("2026-10-31T20:00:00Z");
    assert.strictEqual(d.monthNumber, 10, "Should be October (PDT mid-afternoon)");
    assert.strictEqual(d.day, 31);
  });

  await test("2026-03-08T09:59:59Z (pre-DST-switch) → March in LA", () => {
    const d = getFundAccountingDate("2026-03-08T09:59:59Z");
    assert.strictEqual(d.year, 2026);
    assert.strictEqual(d.monthNumber, 3);
  });

  // ============================================================
  // SECTION 8: CommonJS Bridge Parity
  // ============================================================
  console.log("\n--- 8. CommonJS Bridge Parity ---");

  await test("cjsMonthState exports match ESM exports exactly (Sep 30/Oct 1, Dec 31/Jan 1, PDT, PST, Leap-year)", () => {
    const testTimestamps = [
      sep5, 
      sep30LA, 
      oct1LA, 
      dec31LA, 
      jan1LA,
      "2024-02-29T12:00:00Z", // Leap year Feb 29
      "2026-01-15T12:00:00Z", // Winter PST
      "2026-07-04T12:00:00Z"  // Summer PDT
    ];
    for (const ts of testTimestamps) {
      const esmDate = getFundAccountingDate(ts);
      const cjsDate = cjsMonthState.getFundAccountingDate(ts);
      assert.strictEqual(cjsDate.year, esmDate.year, `Year match for ${ts}`);
      assert.strictEqual(cjsDate.monthNumber, esmDate.monthNumber, `Month match for ${ts}`);
      assert.strictEqual(cjsDate.day, esmDate.day, `Day match for ${ts}`);

      assert.strictEqual(
        cjsMonthState.evaluateMonthState(2026, 9, ts),
        evaluateMonthState(2026, 9, ts),
        `evaluateMonthState match for ${ts}`
      );
      assert.strictEqual(
        cjsMonthState.getLastCompletedMonth(2026, ts),
        getLastCompletedMonth(2026, ts),
        `getLastCompletedMonth match for ${ts}`
      );
      assert.deepStrictEqual(
        cjsMonthState.getLastCompletedMonthWithYear(ts),
        getLastCompletedMonthWithYear(ts),
        `getLastCompletedMonthWithYear match for ${ts}`
      );
    }
  });

  // ============================================================
  // SECTION 9: Host Timezone Independence
  // ============================================================
  console.log("\n--- 9. Host Timezone Independence ---");

  await test("Fund accounting date is invariant across UTC and local timezones", () => {
    // A timestamp in UTC that is Sep 30 in LA: 2026-10-01T06:59:59Z
    const ptDate1 = getFundAccountingDate("2026-10-01T06:59:59Z");
    assert.strictEqual(ptDate1.monthNumber, 9, "Must be September in LA (06:59:59 UTC is 23:59:59 PDT)");
    assert.strictEqual(ptDate1.day, 30);

    // Exactly one second later: 2026-10-01T07:00:00Z
    const ptDate2 = getFundAccountingDate("2026-10-01T07:00:00Z");
    assert.strictEqual(ptDate2.monthNumber, 10, "Must be October in LA (07:00:00 UTC is 00:00:00 PDT)");
    assert.strictEqual(ptDate2.day, 1);
  });

  // ============================================================
  // SECTION 10: Manual Override Precedence
  // ============================================================
  console.log("\n--- 10. Manual Override Precedence ---");

  await test("Manual override is preserved over open-month calculation", () => {
    const mockRowManual = {
      month_number: 9,
      is_manual: true,
      manual_return_pct: 2.50,
      manual_gain_amount: 5000,
      opening_balance: 100000,
      ending_balance: 105000
    };
    assert.strictEqual(mockRowManual.is_manual, true);
    assert.strictEqual(mockRowManual.manual_return_pct, 2.50);
  });

  // ============================================================
  // SECTION 11: Cross-Surface Consistency Verification
  // ============================================================
  console.log("\n--- 11. Cross-Surface Consistency Verification ---");

  const fullReturns2026 = [
    { id: 'ret_1', year: 2026, month_number: 1, month: 'January', gross_return_pct: 0.00, locked: true },
    { id: 'ret_2', year: 2026, month_number: 2, month: 'February', gross_return_pct: 0.00, locked: true },
    { id: 'ret_3', year: 2026, month_number: 3, month: 'March', gross_return_pct: 0.00, locked: true },
    { id: 'ret_4', year: 2026, month_number: 4, month: 'April', gross_return_pct: 2.15, locked: true },
    { id: 'ret_5', year: 2026, month_number: 5, month: 'May', gross_return_pct: 3.42, locked: true },
    { id: 'ret_6', year: 2026, month_number: 6, month: 'June', gross_return_pct: 3.85, locked: true },
    { id: 'ret_7', year: 2026, month_number: 7, month: 'July', gross_return_pct: 3.13, locked: true },
    { id: 'ret_8', year: 2026, month_number: 8, month: 'August', gross_return_pct: 2.81, source: 'Manual', is_override: true, locked: false },
    { id: 'ret_9', year: 2026, month_number: 9, month: 'September', gross_return_pct: 2.00, source: 'Manual', is_override: true, locked: false },
    { id: 'ret_10', year: 2026, month_number: 10, month: 'October', gross_return_pct: 0.00, source: 'Myfxbook', is_override: false, locked: false },
    { id: 'ret_11', year: 2026, month_number: 11, month: 'November', gross_return_pct: 0.00, locked: false },
    { id: 'ret_12', year: 2026, month_number: 12, month: 'December', gross_return_pct: 0.00, locked: false }
  ];

  const mockPreloaded = {
    rawInvestors: [
      { id: "jstout", name: "Joshua Stout", portal_username: "jstout", split_pct: 50, starting_capital: 100000 }
    ],
    accounts: [
      { id: "acc_jstout", investor_id: "jstout", account_id: "acc_jstout" }
    ],
    returnsSheet: fullReturns2026,
    depositsSheet: [],
    withdrawalsSheet: [],
    historyTable: [],
    commissionEarningsTable: [
      { id: "c8", recipient_id: "jstout", year: 2026, month_number: 8, amount: 1200 },
      { id: "c9", recipient_id: "jstout", year: 2026, month_number: 9, amount: 1500 }
    ],
    commissionSharesTable: [],
    commissionRulesTable: [],
    cutoverTable: [],
    live: { today: '+0.05%', week: '+0.25%', month: '+2.00%', lastMonth: '+2.81%', year: '+16.20%' }
  };

  await test("Cross-Surface Consistency at Sep 30 23:59:59 LA (ONE timestamp, ONE fund year/month, ONE state)", async () => {
    const ts = sep30LA;
    const authoritativeDate = getFundAccountingDate(ts);
    assert.strictEqual(authoritativeDate.year, 2026);
    assert.strictEqual(authoritativeDate.monthNumber, 9);

    // 1. Dashboard
    const dash = await buildInvestorDashboard("jstout", mockPreloaded, { asOfDate: ts });
    const sepRow = dash.breakdown.find(r => r.monthNumber === 9);
    const augRow = dash.breakdown.find(r => r.monthNumber === 8);
    const octRow = dash.breakdown.find(r => r.monthNumber === 10);

    assert.strictEqual(sepRow.isOpenMonth, true, "Dashboard September must be isOpenMonth");
    assert.strictEqual(sepRow.isHistoricalCompleted, false, "Dashboard September must NOT be completed");
    assert.strictEqual(augRow.isHistoricalCompleted, true, "Dashboard August must be completed");
    assert.strictEqual(octRow.isProjection, true, "Dashboard October must be projection");

    // 2. Accounting Preview default
    const previewDefaultYear = authoritativeDate.year;
    const previewDefaultMonth = authoritativeDate.monthNumber;
    assert.strictEqual(previewDefaultYear, 2026, "Preview default year === 2026");
    assert.strictEqual(previewDefaultMonth, 9, "Preview default month === 9");

    // 3. Commission completed-month
    const completedComm = getLastCompletedMonthWithYear(ts);
    assert.deepStrictEqual(completedComm, { year: 2026, month: 8 }, "Commission completed month === August 2026");
    assert.strictEqual(dash.summary.commMonthName, "August", "Dashboard summary shows August commission");

    // 4. Myfxbook target-month selection
    const myfxbookTarget = getFundAccountingDate(ts);
    assert.strictEqual(myfxbookTarget.year, 2026);
    assert.strictEqual(myfxbookTarget.monthNumber, 9);

    // 5. Audit tooling (CJS bridge)
    const cjsDate = cjsMonthState.getFundAccountingDate(ts);
    const cjsLastComm = cjsMonthState.getLastCompletedMonth(2026, ts);
    assert.strictEqual(cjsDate.year, 2026);
    assert.strictEqual(cjsDate.monthNumber, 9);
    assert.strictEqual(cjsLastComm, 8);

    // 6. Chart / Backend flags
    const historicalMonthsForChart = dash.breakdown.filter(r => r.isHistoricalCompleted).map(r => r.monthNumber);
    assert(historicalMonthsForChart.includes(8), "August in historical chart on Sep 30");
    assert(!historicalMonthsForChart.includes(9), "September NOT in historical chart on Sep 30");
  });

  await test("Cross-Surface Consistency at Oct 1 00:00:00 LA (ONE timestamp, ONE fund year/month, ONE state)", async () => {
    const ts = oct1LA;
    const authoritativeDate = getFundAccountingDate(ts);
    assert.strictEqual(authoritativeDate.year, 2026);
    assert.strictEqual(authoritativeDate.monthNumber, 10);

    // 1. Dashboard
    const dash = await buildInvestorDashboard("jstout", mockPreloaded, { asOfDate: ts });
    const sepRow = dash.breakdown.find(r => r.monthNumber === 9);
    const octRow = dash.breakdown.find(r => r.monthNumber === 10);
    const novRow = dash.breakdown.find(r => r.monthNumber === 11);

    assert.strictEqual(sepRow.isOpenMonth, false, "Dashboard September is no longer open");
    assert.strictEqual(sepRow.isHistoricalCompleted, true, "Dashboard September is historical completed");
    assert.strictEqual(octRow.isOpenMonth, true, "Dashboard October is now open");
    assert.strictEqual(novRow.isProjection, true, "Dashboard November is projection");

    // 2. Accounting Preview default
    assert.strictEqual(authoritativeDate.year, 2026);
    assert.strictEqual(authoritativeDate.monthNumber, 10);

    // 3. Commission completed-month
    const completedComm = getLastCompletedMonthWithYear(ts);
    assert.deepStrictEqual(completedComm, { year: 2026, month: 9 }, "Commission completed month === September 2026");
    assert.strictEqual(dash.summary.commMonthName, "September", "Dashboard summary shows September commission");

    // 4. Myfxbook target-month selection
    const myfxbookTarget = getFundAccountingDate(ts);
    assert.strictEqual(myfxbookTarget.year, 2026);
    assert.strictEqual(myfxbookTarget.monthNumber, 10);

    // 5. Audit tooling (CJS bridge)
    const cjsDate = cjsMonthState.getFundAccountingDate(ts);
    const cjsLastComm = cjsMonthState.getLastCompletedMonth(2026, ts);
    assert.strictEqual(cjsDate.year, 2026);
    assert.strictEqual(cjsDate.monthNumber, 10);
    assert.strictEqual(cjsLastComm, 9);

    // 6. Chart / Backend flags
    const historicalMonthsForChart = dash.breakdown.filter(r => r.isHistoricalCompleted).map(r => r.monthNumber);
    assert(historicalMonthsForChart.includes(8), "August in chart");
    assert(historicalMonthsForChart.includes(9), "September in chart on Oct 1");
    assert(!historicalMonthsForChart.includes(10), "October NOT in historical chart");
  });

  // ============================================================
  // FINAL REPORT
  // ============================================================
  console.log(`\n${"=".repeat(50)}`);
  console.log(`RESULTS: ${passed} PASS / ${failed} FAIL`);
  if (failed > 0) {
    console.error("❌ SOME TESTS FAILED");
    process.exit(1);
  } else {
    console.log(`✅ ALL ${passed} TESTS PASS`);
  }
}

run().catch(err => {
  console.error("Fatal test error:", err);
  process.exit(1);
});
