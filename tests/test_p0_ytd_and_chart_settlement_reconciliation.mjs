import assert from "node:assert";
import { createRequire } from "node:module";
import Decimal from "decimal.js";
import { buildInvestorDashboard } from "../lib/dashboard.js";
import {
  evaluateMonthState,
  hasSettledHistoryForPeriod,
  isMonthExplicitlyFinalizedAndLocked,
  MonthState
} from "../lib/month-state.js";

const require = createRequire(import.meta.url);
const cjsMonthState = require("../lib/month-state.cjs");

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

async function runTests() {
  console.log("================================================================================");
  console.log("P0 YTD & CHART SETTLEMENT RECONCILIATION REGRESSION SUITE");
  console.log("================================================================================\n");

  const asOfNov13 = "2026-11-13T20:05:31Z";

  // Production-mirrored monthly_returns: Jan, Feb, Apr, May, Jun, Sep locked; Mar, Jul, Aug unlocked historical; Oct unlocked placeholder; Nov open; Dec future
  const prodLikeReturns = [
    { year: 2026, month_number: 1, month: "January", gross_return_pct: 3.29, locked: true },
    { year: 2026, month_number: 2, month: "February", gross_return_pct: 3.57, locked: true },
    { year: 2026, month_number: 3, month: "March", gross_return_pct: 3.18, locked: false, source: "Admin maintained" },
    { year: 2026, month_number: 4, month: "April", gross_return_pct: 3.15, locked: true },
    { year: 2026, month_number: 5, month: "May", gross_return_pct: 3.31, locked: true },
    { year: 2026, month_number: 6, month: "June", gross_return_pct: 3.67, locked: true },
    { year: 2026, month_number: 7, month: "July", gross_return_pct: 3.13, locked: false, source: "Manual" },
    { year: 2026, month_number: 8, month: "August", gross_return_pct: 3.03, locked: false, source: "Myfxbook (Auto Sync)" },
    { year: 2026, month_number: 9, month: "September", gross_return_pct: 3.07, locked: true },
    { year: 2026, month_number: 10, month: "October", gross_return_pct: 3.05, locked: false, source: "Myfxbook (Auto Sync)" },
    { year: 2026, month_number: 11, month: "November", gross_return_pct: 1.25, locked: false, source: "Myfxbook (Auto Sync)" },
    { year: 2026, month_number: 12, month: "December", gross_return_pct: 0.00, locked: false }
  ];

  // Investor 1: Active Jan-Sep + unlocked M10 placeholder ($0 gain, $3,000 -> $3,000)
  // Investor 2: Active Jul-Sep + $0 October adjustedStart (withdrew entire $1,000 Oct opening balance)
  const rawInvestors = [
    { id: "inv_jan", portal_username: "jan_inv", first_name: "Jan", last_name: "Investor", split_pct: 100, start_date: "2026-01-01", monthly_draw: 0 },
    { id: "inv_oct0", portal_username: "oct0_inv", first_name: "OctZero", last_name: "Edge", split_pct: 66.6, start_date: "2026-07-01", monthly_draw: 0 }
  ];

  const accounts = [
    { id: "acc_jan", investor_id: "inv_jan", starting_capital: 100000.00, split_pct: 100, status: "active", is_commission: true },
    { id: "acc_oct0", investor_id: "inv_oct0", starting_capital: 1000.00, split_pct: 66.6, status: "active", is_commission: true }
  ];

  const historyTable = [
    // Settled unlocked M3, M7, M8 rows (ending_balance includes trading gain)
    { investor_id: "inv_jan", year: 2026, month_number: 1, opening_balance: 100000.00, deposits: 0, withdrawals: 0, ending_balance: 103290.00, locked: false },
    { investor_id: "inv_jan", year: 2026, month_number: 2, opening_balance: 103290.00, deposits: 0, withdrawals: 0, ending_balance: 106977.45, locked: false },
    { investor_id: "inv_jan", year: 2026, month_number: 3, opening_balance: 106977.45, deposits: 0, withdrawals: 0, ending_balance: 110379.33, locked: false },
    { investor_id: "inv_jan", year: 2026, month_number: 4, opening_balance: 110379.33, deposits: 0, withdrawals: 0, ending_balance: 113856.28, locked: false },
    { investor_id: "inv_jan", year: 2026, month_number: 5, opening_balance: 113856.28, deposits: 0, withdrawals: 0, ending_balance: 117624.92, locked: false },
    { investor_id: "inv_jan", year: 2026, month_number: 6, opening_balance: 117624.92, deposits: 0, withdrawals: 0, ending_balance: 121941.75, locked: false },
    { investor_id: "inv_jan", year: 2026, month_number: 7, opening_balance: 121941.75, deposits: 0, withdrawals: 0, ending_balance: 125758.53, locked: false },
    { investor_id: "inv_jan", year: 2026, month_number: 8, opening_balance: 125758.53, deposits: 0, withdrawals: 0, ending_balance: 129569.01, locked: false },
    { investor_id: "inv_jan", year: 2026, month_number: 9, opening_balance: 129569.01, deposits: 0, withdrawals: 0, ending_balance: 133546.78, locked: true },
    // Unfinalized October placeholder ($0 gain booked: ending == opening)
    { investor_id: "inv_jan", year: 2026, month_number: 10, opening_balance: 134046.78, deposits: 0, withdrawals: 0, ending_balance: 134046.78, locked: false },
    // Open November voided placeholder (must NOT be treated as settled)
    { investor_id: "inv_jan", year: 2026, month_number: 11, opening_balance: 134046.78, deposits: 0, withdrawals: 0, ending_balance: 134046.78, locked: false, notes: "PROJECTION_VOIDED: Reset to settled October ending balance pending month close" },

    // Edge case: Investor 2 starts July, withdraws full $1,000 Oct opening -> $0 October base
    { investor_id: "inv_oct0", year: 2026, month_number: 7, opening_balance: 1000.00, deposits: 0, withdrawals: 0, ending_balance: 1020.85, locked: false },
    { investor_id: "inv_oct0", year: 2026, month_number: 8, opening_balance: 1020.85, deposits: 0, withdrawals: 0, ending_balance: 1041.45, locked: false },
    { investor_id: "inv_oct0", year: 2026, month_number: 9, opening_balance: 1041.45, deposits: 0, withdrawals: 1041.45, ending_balance: 0.00, locked: true },
    { investor_id: "inv_oct0", year: 2026, month_number: 10, opening_balance: 500.00, deposits: 0, withdrawals: 500.00, ending_balance: 0.00, locked: false }
  ];

  const commissionEarningsTable = [
    { id: "c3", recipient_id: "inv_jan", year: 2026, month_number: 3, amount: 150.00, status: "ACTIVE" },
    { id: "c7", recipient_id: "inv_jan", year: 2026, month_number: 7, amount: 250.00, status: "ACTIVE" },
    { id: "c8", recipient_id: "inv_jan", year: 2026, month_number: 8, amount: 300.00, status: "ACTIVE" },
    { id: "c9", recipient_id: "inv_jan", year: 2026, month_number: 9, amount: 500.00, status: "ACTIVE" },
    { id: "c10_sup", recipient_id: "inv_jan", year: 2026, month_number: 10, amount: 600.00, status: "SUPERSEDED" }
  ];

  // 1. Direct month-state unit checks
  assert.strictEqual(evaluateMonthState(2026, 3, asOfNov13, { returnsList: prodLikeReturns, historyList: historyTable }), MonthState.HISTORICAL_SETTLED);
  assert.strictEqual(evaluateMonthState(2026, 7, asOfNov13, { returnsList: prodLikeReturns, historyList: historyTable }), MonthState.HISTORICAL_SETTLED);
  assert.strictEqual(evaluateMonthState(2026, 8, asOfNov13, { returnsList: prodLikeReturns, historyList: historyTable }), MonthState.HISTORICAL_SETTLED);
  assert.strictEqual(evaluateMonthState(2026, 10, asOfNov13, { returnsList: prodLikeReturns, historyList: historyTable }), MonthState.CURRENT_OPEN);
  assert.strictEqual(evaluateMonthState(2026, 10, asOfNov13, { returnsList: prodLikeReturns }), MonthState.CURRENT_OPEN);
  assert.strictEqual(isMonthExplicitlyFinalizedAndLocked(2026, 10, prodLikeReturns, asOfNov13), false);

  // CommonJS bridge parity check
  assert.strictEqual(cjsMonthState.evaluateMonthState(2026, 3, asOfNov13, { returnsList: prodLikeReturns, historyList: historyTable }), MonthState.HISTORICAL_SETTLED);
  assert.strictEqual(cjsMonthState.evaluateMonthState(2026, 10, asOfNov13, { returnsList: prodLikeReturns, historyList: historyTable }), MonthState.CURRENT_OPEN);

  // Guard: ending_balance: undefined (open snapshot) or PROJECTION_VOIDED must not falsely mark a period settled
  assert.strictEqual(hasSettledHistoryForPeriod(2026, 11, historyTable), false);
  assert.strictEqual(hasSettledHistoryForPeriod(2026, 10, [{ year: 2026, month_number: 10, opening_balance: 50000, deposits: 0, withdrawals: 0 }]), false);
  console.log("  ✅ 1. Month-state & CJS parity distinguish settled Mar/Jul/Aug from unclosed Oct");

  // 2. Jan-Sep Investor dashboard reconciliation
  const dashJan = await buildInvestorDashboard("jan_inv", {
    rawInvestors,
    accounts,
    returnsSheet: prodLikeReturns,
    depositsSheet: [],
    withdrawalsSheet: [{ investorid: "inv_oct0", year: 2026, month_number: 9, amount: 1041.45, status: "completed" }, { investorid: "inv_oct0", year: 2026, month_number: 10, amount: 500, status: "completed" }],
    historyTable,
    commissionEarningsTable,
    commissionSharesTable: [],
    commissionRulesTable: [],
    cutoverAdjustments: [],
    live: { today: "+0.00%", week: "+0.45%", month: "+1.25%", year: "+34.91%" }
  }, { asOfDate: asOfNov13 });

  const janChartMonths = dashJan.breakdown.filter(r => r.isHistoricalCompleted).map(r => r.monthNumber);
  assert.deepStrictEqual(janChartMonths, [1, 2, 3, 4, 5, 6, 7, 8, 9], "Chart must show Jan-Sep with zero Mar/Jul/Aug gaps and exclude Oct-Dec");

  // Verify M3, M7, M8 are included in YTD and commissions and equal exact breakdown sum (M1-M9)
  const settledJanGainSum = dashJan.breakdown
    .slice(0, 9)
    .reduce((sum, r) => sum.add(r.gain || 0), new Decimal(0))
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
    .toNumber();
  assert(dashJan.breakdown[2].gain > 3400, "March gain must be included in breakdown");
  assert(dashJan.breakdown[6].gain > 3800, "July gain must be included in breakdown");
  assert(dashJan.breakdown[7].gain > 3800, "August gain must be included in breakdown");
  assert.strictEqual(Number(dashJan.summary.totalGain.toFixed(2)), settledJanGainSum, "Total Gain YTD must equal Jan-Sep sum including Mar/Jul/Aug");
  assert.strictEqual(Number(dashJan.summary.totalGain.toFixed(2)), 33546.79, "Total Gain YTD must match exact M1-M9 compounded return");
  assert.strictEqual(dashJan.summary.ytdSettledThroughMonth, "September");
  assert.strictEqual(dashJan.summary.bookedCommissionsEarnedMonth, 0, "Unposted October commission must remain $0.00");
  assert.strictEqual(dashJan.summary.bookedCommissionsEarnedYear, 1200.00, "Booked YTD commission must match Jan-Sep active ledger ($1,200.00)");
  assert.strictEqual(dashJan.summary.commissionsEarnedYear, null, "Fail-closed verified YTD remains null with SUPERSEDED Oct");
  assert.strictEqual(dashJan.breakdown[2].commissionsEarned, 150.00, "March commission must remain in breakdown");
  assert.strictEqual(dashJan.breakdown[6].commissionsEarned, 250.00, "July commission must remain in breakdown");
  assert.strictEqual(dashJan.breakdown[7].commissionsEarned, 300.00, "August commission must remain in breakdown");
  assert.strictEqual(dashJan.breakdown[9].commissionsEarned, 0, "October breakdown commission must remain $0");
  console.log("  ✅ 2. Jan-Sep YTD, chart continuity (M1-M9), and ledger-backed commissions verified");

  // 3. Zero-gain October edge-case investor must NOT absorb October return into YTD or chart
  const dashOct0 = await buildInvestorDashboard("oct0_inv", {
    rawInvestors,
    accounts,
    returnsSheet: prodLikeReturns,
    depositsSheet: [],
    withdrawalsSheet: [{ investorid: "inv_oct0", year: 2026, month_number: 9, amount: 1041.45, status: "completed" }, { investorid: "inv_oct0", year: 2026, month_number: 10, amount: 500, status: "completed" }],
    historyTable,
    commissionEarningsTable: [{ id: "c9_o0", recipient_id: "inv_oct0", year: 2026, month_number: 9, amount: 500.00, status: "ACTIVE" }],
    commissionSharesTable: [],
    commissionRulesTable: [],
    cutoverAdjustments: [],
    live: { today: "+0.00%", week: "+0.45%", month: "+1.25%", year: "+34.91%" }
  }, { asOfDate: asOfNov13 });

  const oct0ChartMonths = dashOct0.breakdown.filter(r => r.isHistoricalCompleted).map(r => r.monthNumber);
  assert.deepStrictEqual(oct0ChartMonths, [7, 8, 9], "Zero-gain Oct account must exclude unclosed Oct from chart");
  assert.strictEqual(dashOct0.summary.ytdSettledThroughMonth, "September", "Zero-gain Oct account YTD scope must stop at September");
  assert.strictEqual(dashOct0.breakdown[9].effectiveReturnPct, 0, "Unclosed Oct settled return must remain 0");
  assert.strictEqual(dashOct0.breakdown[9].gain, 0, "Unclosed Oct settled gain must remain 0");
  console.log("  ✅ 3. $0-gain October edge-case investor strictly excludes unclosed October from YTD & chart");

  console.log("\n================================================================================");
  console.log("ALL P0 YTD & CHART SETTLEMENT RECONCILIATION TESTS PASSED (3/3)");
  console.log("================================================================================");
}

runTests().catch(err => {
  console.error("❌ TEST SUITE FAILED:", err);
  process.exit(1);
});
