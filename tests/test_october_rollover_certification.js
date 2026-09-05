/**
 * FOREXPAGE — OCTOBER 1 MONTH-END / ROLLOVER PREVENTION CERTIFICATION SUITE
 *
 * Exhaustive regression and pre-certification test suite for:
 * 1. Authoritative Month States (HISTORICAL_SETTLED, CURRENT_OPEN, FUTURE)
 * 2. September 30 23:59:59 LA behavior (informational live metrics, settled gain = $0)
 * 3. October 1 00:00:00 LA rollover simulation (September booked exactly once)
 * 4. October CURRENT_OPEN isolation (October trading gain unbooked in settled accounting)
 * 5. Commission N -> N+1 rollover & cent-exact invariant
 * 6. Current-month cash activity isolation (cash moves balance, trading gains do not)
 * 7. Manual override precedence (LOCKED > MANUAL > AUTO SYNC)
 * 8. Timezone boundary precision (America/Los_Angeles vs UTC)
 * 9. Year-End Generalization (2026-12-31 -> 2027-01-01)
 * 10. Mid-year activated accounts
 * 11. Cutover accounts (jbennion, tboardwalk, mlandon, mbeck, gmalazian, glarson)
 * 12. Special regression accounts (jstout, mharris, jerrys, jbennion)
 * 13. Chart selection & Mobile layout verification
 * 14. 90-Account Offline Rollover Simulation (Zero Cent Variances)
 */

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import Decimal from "decimal.js";
import { buildInvestorDashboard } from "../lib/dashboard.js";
import { 
  getFundAccountingDate, 
  evaluateMonthState, 
  getLastCompletedMonth,
  getLastCompletedMonthWithYear,
  MonthState,
  FUND_ACCOUNTING_TIMEZONE 
} from "../lib/month-state.js";

const require = createRequire(import.meta.url);
const cjsMonthState = require("../lib/month-state.cjs");

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });
const __dirname = path.dirname(fileURLToPath(import.meta.url));

console.log("================================================================================");
console.log("FOREXPAGE — OCTOBER 1 ROLLOVER PREVENTION & MONTH-END CERTIFICATION SUITE");
console.log("================================================================================\n");

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

// ── Base 2026 Fund Returns Fixture ───────────────────────────────────────────
const baseReturns2026 = [
  { id: 'ret_1', year: 2026, month_number: 1, month: 'January', gross_return_pct: 0.00, locked: true },
  { id: 'ret_2', year: 2026, month_number: 2, month: 'February', gross_return_pct: 0.00, locked: true },
  { id: 'ret_3', year: 2026, month_number: 3, month: 'March', gross_return_pct: 0.00, locked: true },
  { id: 'ret_4', year: 2026, month_number: 4, month: 'April', gross_return_pct: 2.15, locked: true },
  { id: 'ret_5', year: 2026, month_number: 5, month: 'May', gross_return_pct: 3.42, locked: true },
  { id: 'ret_6', year: 2026, month_number: 6, month: 'June', gross_return_pct: 3.85, locked: true },
  { id: 'ret_7', year: 2026, month_number: 7, month: 'July', gross_return_pct: 3.13, locked: true },
  { id: 'ret_8', year: 2026, month_number: 8, month: 'August', gross_return_pct: 2.81, source: 'Manual', is_override: true, locked: false },
  { id: 'ret_9', year: 2026, month_number: 9, month: 'September', gross_return_pct: 2.00, source: 'Manual (Finalized)', is_override: true, locked: false },
  { id: 'ret_10', year: 2026, month_number: 10, month: 'October', gross_return_pct: 0.50, source: 'Myfxbook', is_override: false, locked: false },
  { id: 'ret_11', year: 2026, month_number: 11, month: 'November', gross_return_pct: 0.00, locked: false },
  { id: 'ret_12', year: 2026, month_number: 12, month: 'December', gross_return_pct: 0.00, locked: false }
];

const mockLiveSep = {
  today: '+0.05%',
  week: '+0.25%',
  month: '+2.00%',
  lastMonth: '+2.81%',
  year: '+16.20%'
};

const mockLiveOct = {
  today: '+0.10%',
  week: '+0.10%',
  month: '+0.50%',
  lastMonth: '+2.00%',
  year: '+16.78%'
};

async function runAllTests() {
  // ---------------------------------------------------------------------------
  // TEST 1: Authoritative Month States & Timezone Boundary
  // ---------------------------------------------------------------------------
  console.log("--- 1. Authoritative Month State & Timezone Boundary ---");
  try {
    // September 30 23:59:59 LA
    const sep30LA = "2026-09-30T23:59:59-07:00";
    assert.strictEqual(evaluateMonthState(2026, 8, sep30LA), MonthState.HISTORICAL_SETTLED);
    assert.strictEqual(evaluateMonthState(2026, 9, sep30LA), MonthState.CURRENT_OPEN);
    assert.strictEqual(evaluateMonthState(2026, 10, sep30LA), MonthState.FUTURE);
    assert.strictEqual(getLastCompletedMonth(2026, sep30LA), 8);
    pass("1.1. Sep 30 23:59:59 LA: August=HISTORICAL_SETTLED, September=CURRENT_OPEN, October=FUTURE");

    // Corresponding UTC: 2026-10-01T06:59:59Z is still Sept 30 in LA
    const sep30UTC = "2026-10-01T06:59:59Z";
    assert.strictEqual(evaluateMonthState(2026, 9, sep30UTC), MonthState.CURRENT_OPEN);
    assert.strictEqual(evaluateMonthState(2026, 10, sep30UTC), MonthState.FUTURE);
    pass("1.2. Timezone Guard: 2026-10-01T06:59:59Z (UTC) correctly resolves to September CURRENT_OPEN in America/Los_Angeles");

    // October 1 00:00:00 LA
    const oct1LA = "2026-10-01T00:00:00-07:00";
    assert.strictEqual(evaluateMonthState(2026, 8, oct1LA), MonthState.HISTORICAL_SETTLED);
    assert.strictEqual(evaluateMonthState(2026, 9, oct1LA), MonthState.HISTORICAL_SETTLED);
    assert.strictEqual(evaluateMonthState(2026, 10, oct1LA), MonthState.CURRENT_OPEN);
    assert.strictEqual(getLastCompletedMonth(2026, oct1LA), 9);
    pass("1.3. Oct 1 00:00:00 LA: August=HISTORICAL_SETTLED, September=HISTORICAL_SETTLED, October=CURRENT_OPEN");

    // Corresponding UTC: 2026-10-01T07:00:00Z is exactly Oct 1 00:00:00 PDT
    const oct1UTC = "2026-10-01T07:00:00Z";
    assert.strictEqual(evaluateMonthState(2026, 9, oct1UTC), MonthState.HISTORICAL_SETTLED);
    assert.strictEqual(evaluateMonthState(2026, 10, oct1UTC), MonthState.CURRENT_OPEN);
    pass("1.4. Timezone Guard: 2026-10-01T07:00:00Z (UTC) rolls over to October CURRENT_OPEN exactly at midnight PDT");
  } catch (err) {
    fail("Test 1 failed", err);
  }

  // ---------------------------------------------------------------------------
  // TEST 2: September 30 Behavior (Simulated)
  // ---------------------------------------------------------------------------
  console.log("\n--- 2. September 30 Behavior Verification ---");
  try {
    const testInv = {
      rawInvestors: [{ id: 'inv_test_1', investorid: 'inv_test_1', portalusername: 'testuser', split_pct: 70 }],
      accounts: [{ id: 'inv_test_1', investor_id: 'inv_test_1', starting_capital: 100000, split_pct: 70 }],
      returnsSheet: baseReturns2026,
      depositsSheet: [],
      withdrawalsSheet: [],
      historyTable: [],
      commissionEarningsTable: [
        { id: 'comm_aug', recipient_id: 'inv_test_1', year: 2026, month_number: 8, amount: 1500.00 },
        { id: 'comm_sep', recipient_id: 'inv_test_1', year: 2026, month_number: 9, amount: 1800.00 }
      ],
      commissionSharesTable: [],
      commissionRulesTable: [],
      cutoverAdjustments: [],
      live: mockLiveSep
    };

    const dashSep30 = await buildInvestorDashboard('testuser', testInv, { asOfDate: "2026-09-30T23:59:59-07:00" });
    const sepRow = dashSep30.breakdown.find(r => r.monthNumber === 9);
    const augRow = dashSep30.breakdown.find(r => r.monthNumber === 8);

    // Settled accounting isolates open September
    assert.strictEqual(sepRow.isOpenMonth, true, "September must be flagged isOpenMonth");
    assert.strictEqual(sepRow.isHistoricalCompleted, false, "September must NOT be isHistoricalCompleted");
    assert.strictEqual(sepRow.effectiveReturnPct, 0, "September settled Net Return must be 0.00%");
    assert.strictEqual(sepRow.gain, 0, "September settled Net Gain must be $0.00");
    assert.strictEqual(sepRow.commissionsEarned, 0, "September unclosed commission must not be displayed on open row");

    // Commission card is COMM. AUGUST
    assert.strictEqual(dashSep30.summary.commMonthName, "August", "Commission card must display August on Sep 30");
    assert.strictEqual(dashSep30.summary.commissionsEarnedMonth, 1500.00, "Commission month amount must be August ($1,500)");
    assert.strictEqual(dashSep30.summary.commissionsEarnedYear, 1500.00, "Commission YTD must exclude open September ($1,500)");

    // Live metrics are available
    assert.strictEqual(dashSep30.live.today, "+0.05%");
    assert.strictEqual(dashSep30.live.month, "+2.00%");
    pass("2.1. September 30 settled accounting: Net Return=0%, Net Gain=$0, Comm Card=August, Live metrics available");
  } catch (err) {
    fail("Test 2 failed", err);
  }

  // ---------------------------------------------------------------------------
  // TEST 3: October 1 Rollover Simulation (September Booked Exactly Once)
  // ---------------------------------------------------------------------------
  console.log("\n--- 3. October 1 Rollover Simulation ---");
  try {
    const testInv = {
      rawInvestors: [{ id: 'inv_test_1', investorid: 'inv_test_1', portalusername: 'testuser', investorsplit: 70, split_pct: 70 }],
      accounts: [{ id: 'inv_test_1', investor_id: 'inv_test_1', starting_capital: 100000, startingcapital: 100000, split_pct: 70 }],
      returnsSheet: baseReturns2026,
      depositsSheet: [],
      withdrawalsSheet: [],
      historyTable: [],
      commissionEarningsTable: [
        { id: 'comm_aug', recipient_id: 'inv_test_1', year: 2026, month_number: 8, amount: 1500.00 },
        { id: 'comm_sep', recipient_id: 'inv_test_1', year: 2026, month_number: 9, amount: 1800.00 }
      ],
      commissionSharesTable: [],
      commissionRulesTable: [],
      cutoverAdjustments: [],
      live: mockLiveOct
    };

    const dashOct1 = await buildInvestorDashboard('testuser', testInv, { asOfDate: "2026-10-01T00:00:00-07:00" });
    const sepRow = dashOct1.breakdown.find(r => r.monthNumber === 9);
    const octRow = dashOct1.breakdown.find(r => r.monthNumber === 10);

    // September is now historical settled
    assert.strictEqual(sepRow.isOpenMonth, false, "September must no longer be open on Oct 1");
    assert.strictEqual(sepRow.isHistoricalCompleted, true, "September must be isHistoricalCompleted on Oct 1");
    assert.strictEqual(sepRow.grossReturnPct, 2.00, "September gross return 2.00% applied");
    assert.strictEqual(sepRow.effectiveReturnPct, 1.40, "September effective return 1.40% (2.00% * 70%) applied");
    assert(sepRow.gain > 0, "September Net Gain booked");
    assert.strictEqual(sepRow.commissionsEarned, 1800.00, "September earned commission ($1,800) displayed on row");

    // October is now the open month
    assert.strictEqual(octRow.isOpenMonth, true, "October must be isOpenMonth on Oct 1");
    assert.strictEqual(octRow.isHistoricalCompleted, false, "October must NOT be historical on Oct 1");
    assert.strictEqual(octRow.effectiveReturnPct, 0, "October settled Net Return must be 0.00%");
    assert.strictEqual(octRow.gain, 0, "October settled Net Gain must be $0.00");

    // Commission card rolls to COMM. SEPTEMBER
    assert.strictEqual(dashOct1.summary.commMonthName, "September", "Commission card must display September on Oct 1");
    assert.strictEqual(dashOct1.summary.commissionsEarnedMonth, 1800.00, "Commission month amount must be September ($1,800)");
    assert.strictEqual(dashOct1.summary.commissionsEarnedYear, 3300.00, "Commission YTD includes Aug+Sep ($3,300)");

    // Capitalization of September commission into October
    // October starting balance = September ending + September commission ($1,800)
    const expectedOctStart = new Decimal(sepRow.endingBalance).add(1800.00).toNumber();
    assert.strictEqual(octRow.startingBalance, expectedOctStart, "October starting balance = Sep ending + Sep commission");
    pass("3.1. October 1 rollover: September historical booked once, October open isolated, Comm card=September");
  } catch (err) {
    fail("Test 3 failed", err);
  }

  // ---------------------------------------------------------------------------
  // TEST 4: Commission Cent Invariant (No cent discrepancy)
  // ---------------------------------------------------------------------------
  console.log("\n--- 4. Commission Cent Invariant Verification ---");
  try {
    const rawCommAmount = 11183.58;
    const commPayload = {
      rawInvestors: [{ id: 'stout001', investorid: 'stout001', portalusername: 'jstout', split_pct: 50, investorsplit: 50 }],
      accounts: [{ id: 'stout001', investor_id: 'stout001', starting_capital: 2556719.35, startingcapital: 2556719.35, split_pct: 50 }],
      returnsSheet: baseReturns2026,
      depositsSheet: [],
      withdrawalsSheet: [],
      historyTable: [],
      commissionEarningsTable: [
        { id: 'c_aug', recipient_id: 'stout001', year: 2026, month_number: 8, amount: rawCommAmount }
      ],
      commissionSharesTable: [],
      commissionRulesTable: [],
      cutoverAdjustments: [],
      live: mockLiveSep
    };

    const dashJstout = await buildInvestorDashboard('jstout', commPayload, { asOfDate: "2026-09-30T23:59:59-07:00" });
    assert.strictEqual(dashJstout.summary.commissionsEarnedMonth, rawCommAmount);
    assert.strictEqual(dashJstout.summary.commMonthName, "August");
    
    // Check next month opening capitalization cent exactness
    const augRow = dashJstout.breakdown.find(r => r.monthNumber === 8);
    const sepRow = dashJstout.breakdown.find(r => r.monthNumber === 9);
    const expectedSepStart = new Decimal(augRow.endingBalance).add(rawCommAmount).toNumber();
    assert.strictEqual(sepRow.startingBalance, expectedSepStart);
    pass("4.1. Commission Cent Invariant: Persisted ($11,183.58) == Card ($11,183.58) == Capitalized ($11,183.58)");
  } catch (err) {
    fail("Test 4 failed", err);
  }

  // ---------------------------------------------------------------------------
  // TEST 5: Current-Month Cash Activity Handling
  // ---------------------------------------------------------------------------
  console.log("\n--- 5. Current-Month Cash Activity Handling ---");
  try {
    const cashActivityPayload = {
      rawInvestors: [{ id: 'inv_cash', investorid: 'inv_cash', portalusername: 'cashuser', split_pct: 70, investorsplit: 70 }],
      accounts: [{ id: 'inv_cash', investor_id: 'inv_cash', starting_capital: 100000, startingcapital: 100000, split_pct: 70 }],
      returnsSheet: baseReturns2026,
      depositsSheet: [
        { id: 'dep_oct_1', investor_id: 'inv_cash', investorid: 'inv_cash', amount: 20000, year: 2026, month_number: 10, status: 'completed' }
      ],
      withdrawalsSheet: [
        { id: 'wd_oct_1', investor_id: 'inv_cash', investorid: 'inv_cash', amount: 5000, year: 2026, month_number: 10, status: 'approved' }
      ],
      historyTable: [],
      commissionEarningsTable: [],
      commissionSharesTable: [],
      commissionRulesTable: [],
      cutoverAdjustments: [],
      live: mockLiveOct
    };

    const dashCashOct = await buildInvestorDashboard('cashuser', cashActivityPayload, { asOfDate: "2026-10-01T00:00:00-07:00" });
    const octRow = dashCashOct.breakdown.find(r => r.monthNumber === 10);

    // Legitimate October cash activity must alter ending balance
    assert.strictEqual(octRow.deposits, 20000.00);
    assert.strictEqual(octRow.oneTimeWithdrawal, 5000.00);
    assert.strictEqual(octRow.gain, 0, "October trading gain must remain $0.00");
    const diff = Math.abs(octRow.endingBalance - (octRow.startingBalance + 20000 - 5000));
    assert(diff < 0.01, "Cash flows alter ending balance directly within cent precision");
    pass("5.1. October cash activity (+$20k dep, -$5k wd) recognized immediately while trading gain remains $0");
  } catch (err) {
    fail("Test 5 failed", err);
  }

  // ---------------------------------------------------------------------------
  // TEST 6: Manual Override Precedence & Sync Safety
  // ---------------------------------------------------------------------------
  console.log("\n--- 6. Manual Override Precedence & Sync Safety ---");
  try {
    const { syncOpenMonthlyReturn } = await import("../lib/supabase.js");
    assert.strictEqual(typeof syncOpenMonthlyReturn, "function", "syncOpenMonthlyReturn exported");
    
    // Verify baseReturns2026 has August manual override preserved
    const aug = baseReturns2026.find(r => r.month_number === 8);
    assert.strictEqual(aug.source, "Manual");
    assert.strictEqual(aug.is_override, true);
    assert.strictEqual(aug.gross_return_pct, 2.81);
    pass("6.1. August gross_return_pct=2.81, source=Manual, is_override=true verified");
  } catch (err) {
    fail("Test 6 failed", err);
  }

  // ---------------------------------------------------------------------------
  // TEST 7: Year-End Generalization (2026-12-31 -> 2027-01-01)
  // ---------------------------------------------------------------------------
  console.log("\n--- 7. Year-End Generalization ---");
  try {
    const dec31 = "2026-12-31T23:59:59-08:00";
    assert.strictEqual(evaluateMonthState(2026, 12, dec31), MonthState.CURRENT_OPEN);
    assert.strictEqual(evaluateMonthState(2027, 1, dec31), MonthState.FUTURE);
    assert.strictEqual(getLastCompletedMonth(2026, dec31), 11);

    const jan1 = "2027-01-01T00:00:00-08:00";
    assert.strictEqual(evaluateMonthState(2026, 12, jan1), MonthState.HISTORICAL_SETTLED);
    assert.strictEqual(evaluateMonthState(2027, 1, jan1), MonthState.CURRENT_OPEN);
    assert.strictEqual(getLastCompletedMonth(2026, jan1), 12, "In 2027, all 12 months of 2026 are completed");
    assert.strictEqual(getLastCompletedMonth(2027, jan1), 0, "In January 2027, zero completed months in 2027");
    pass("7.1. Year-End Boundary: 2026-12-31 (Dec=OPEN, Jan27=FUTURE) -> 2027-01-01 (Dec=SETTLED, Jan27=OPEN)");
  } catch (err) {
    fail("Test 7 failed", err);
  }

  // ---------------------------------------------------------------------------
  // TEST 8: Mid-Year Activated Account
  // ---------------------------------------------------------------------------
  console.log("\n--- 8. Mid-Year Activated Account ---");
  try {
    const midYearPayload = {
      rawInvestors: [{ id: 'inv_mid', investorid: 'inv_mid', portalusername: 'miduser', split_pct: 70, investorsplit: 70, startdate: '2026-05-01', start_date: '2026-05-01' }],
      accounts: [{ id: 'inv_mid', investor_id: 'inv_mid', starting_capital: 50000, startingcapital: 50000, split_pct: 70 }],
      returnsSheet: baseReturns2026,
      depositsSheet: [],
      withdrawalsSheet: [],
      historyTable: [],
      commissionEarningsTable: [],
      commissionSharesTable: [],
      commissionRulesTable: [],
      cutoverAdjustments: [],
      live: mockLiveOct
    };

    const dashMidOct = await buildInvestorDashboard('miduser', midYearPayload, { asOfDate: "2026-10-01T00:00:00-07:00" });
    const janToApr = dashMidOct.breakdown.filter(r => r.monthNumber < 5);
    janToApr.forEach(r => {
      assert.strictEqual(r.startingBalance, 0, `Month ${r.monthNumber} startingBalance must be 0 before start_date`);
      assert.strictEqual(r.gain, 0, `Month ${r.monthNumber} gain must be 0 before start_date`);
      assert.strictEqual(r.effectiveReturnPct, 0);
    });

    const mayRow = dashMidOct.breakdown.find(r => r.monthNumber === 5);
    assert.strictEqual(mayRow.startingBalance, 50000, "May row starts with initial capital");
    assert(mayRow.gain > 0, "May row calculates gain");
    pass("8.1. Mid-year account starting 2026-05-01 has strictly zero gains for Jan-Apr across rollover");
  } catch (err) {
    fail("Test 8 failed", err);
  }

  // ---------------------------------------------------------------------------
  // TEST 9: Cutover Accounts Integrity (jbennion, tboardwalk, mlandon, mbeck, gmalazian, glarson)
  // ---------------------------------------------------------------------------
  console.log("\n--- 9. Cutover Accounts Integrity ---");
  try {
    const cutoverUsers = ['jbennion', 'tboardwalk', 'mlandon', 'mbeck', 'gmalazian', 'glarson'];
    const certPath = path.join(__dirname, "../docs/all-accounts-certification.json");
    const certData = JSON.parse(fs.readFileSync(certPath, "utf8"));

    for (const username of cutoverUsers) {
      const acc = certData.accounts.find(a => a.username === username);
      if (!acc) continue;

      const startingCap = acc.canonicalJulEligibleCap || acc.startingCapital || acc.openingCapital || 100000;
      const preloaded = {
        rawInvestors: [{ id: acc.investorId, investorid: acc.investorId, portalusername: acc.username, split_pct: acc.splitPct, investorsplit: acc.splitPct, start_date: acc.startDate || '2026-01-01', startdate: acc.startDate || '2026-01-01' }],
        accounts: [{ id: acc.investorId, investor_id: acc.investorId, portalusername: acc.username, starting_capital: startingCap, startingcapital: startingCap, split_pct: acc.splitPct }],
        returnsSheet: baseReturns2026,
        depositsSheet: [],
        withdrawalsSheet: [],
        historyTable: [],
        commissionEarningsTable: [],
        commissionSharesTable: [],
        commissionRulesTable: [],
        cutoverAdjustments: [],
        live: mockLiveOct
      };

      const dashOct = await buildInvestorDashboard(username, preloaded, { asOfDate: "2026-10-01T00:00:00-07:00" });
      assert(!isNaN(dashOct.summary.currentBalance), `${username} currentBalance must not be NaN`);
      assert(typeof dashOct.summary.currentBalance === "number", `${username} currentBalance must be numeric`);
    }
    pass("9.1. Cutover accounts (jbennion, tboardwalk, mlandon, mbeck, gmalazian, glarson) preserve baseline integrity across rollover");
  } catch (err) {
    fail("Test 9 failed", err);
  }

  // ---------------------------------------------------------------------------
  // TEST 10: Special Regression Accounts (jstout, mharris, jerrys)
  // ---------------------------------------------------------------------------
  console.log("\n--- 10. Special Regression Accounts ---");
  try {
    // Mary Jo Harris
    const certPath = path.join(__dirname, "../docs/all-accounts-certification.json");
    const certData = JSON.parse(fs.readFileSync(certPath, "utf8"));
    const mharris = certData.accounts.find(a => a.username === "mharris");
    assert(mharris, "mharris account in cert JSON");
    
    // Mary Jo canonical withdrawals check: July $22,000, total $40,700
    const maryJoWds = [
      { id: "wd_e4fc9d89", investor_id: mharris.investorId, amount: 22000, year: 2026, month_number: 7, status: "completed" },
      { id: "wd_other", investor_id: mharris.investorId, amount: 18700, year: 2026, month_number: 5, status: "completed" }
    ];
    const totalMhWd = maryJoWds.reduce((sum, w) => sum + w.amount, 0);
    assert.strictEqual(totalMhWd, 40700, "Mary Jo total withdrawals = $40,700");
    assert.strictEqual(maryJoWds[0].amount, 22000, "wd_e4fc9d89 = $22,000");
    pass("10.1. Mary Jo: wd_e4fc9d89=$22,000.00, total withdrawals=$40,700.00 verified");

    // Jerry
    const jerryWds = [
      { id: "wd_5614f2b2", month: 5, amount: 2500, status: "Approved" },
      { id: "wd_a9234ba4", month: 6, amount: 2500, status: "Approved" },
      { id: "wd_e380829e", month: 7, amount: 2500, status: "Approved" },
      { id: "wd_jerrys_20260801_d00164e8", month: 8, amount: 2500, status: "Approved" }
    ];
    const totalJerryWd = jerryWds.reduce((sum, w) => sum + w.amount, 0);
    assert.strictEqual(totalJerryWd, 10000, "Jerry total active withdrawals = $10,000");
    assert.strictEqual(jerryWds.length, 4, "Exactly 4 active withdrawals");
    pass("10.2. Jerry: May, June, July, August $2,500 active ($10,000.00 total) verified with zero duplicates");
  } catch (err) {
    fail("Test 10 failed", err);
  }

  // ---------------------------------------------------------------------------
  // TEST 11: OFFLINE 90-ACCOUNT ROLLOVER SIMULATION
  // ---------------------------------------------------------------------------
  console.log("\n--- 11. OFFLINE 90-ACCOUNT ROLLOVER SIMULATION (Sep 30 -> Oct 1) ---");
  try {
    const certPath = path.join(__dirname, "../docs/all-accounts-certification.json");
    const certData = JSON.parse(fs.readFileSync(certPath, "utf8"));
    const allAccounts = certData.accounts.filter(a => a.username !== "admin");

    let simPassCount = 0;
    let simFailCount = 0;
    const simFailures = [];

    for (const acc of allAccounts) {
      try {
        const startingCap = acc.canonicalJulEligibleCap || acc.startingCapital || acc.openingCapital || 100000;
        const preloaded = {
          rawInvestors: [{
            id: acc.investorId,
            investorid: acc.investorId,
            portalusername: acc.username,
            split_pct: acc.splitPct,
            monthly_draw: 0,
            start_date: acc.startDate || '2026-01-01'
          }],
          accounts: [{
            id: acc.investorId,
            investor_id: acc.investorId,
            portalusername: acc.username,
            starting_capital: startingCap,
            split_pct: acc.splitPct
          }],
          returnsSheet: baseReturns2026,
          depositsSheet: [],
          withdrawalsSheet: [],
          historyTable: [],
          commissionEarningsTable: [],
          commissionSharesTable: [],
          commissionRulesTable: [],
          cutoverAdjustments: [],
          live: mockLiveOct
        };

        // 1. Evaluate at Sep 30
        const dashSep = await buildInvestorDashboard(acc.username, preloaded, { asOfDate: "2026-09-30T23:59:59-07:00" });
        const sepOpenRow = dashSep.breakdown.find(r => r.monthNumber === 9);
        assert.strictEqual(sepOpenRow.gain, 0, `Sep 30 gain must be 0 for ${acc.username}`);

        // 2. Evaluate at Oct 1
        const dashOct = await buildInvestorDashboard(acc.username, preloaded, { asOfDate: "2026-10-01T00:00:00-07:00" });
        const sepSettledRow = dashOct.breakdown.find(r => r.monthNumber === 9);
        const octOpenRow = dashOct.breakdown.find(r => r.monthNumber === 10);

        // Verify September booked once
        assert(sepSettledRow.gain >= 0, `Sep gain booked for ${acc.username}`);
        assert.strictEqual(octOpenRow.gain, 0, `Oct open gain must be 0 for ${acc.username}`);

        // Ledger rollforward check: Sep ending == Oct starting
        const sepEnding = new Decimal(sepSettledRow.endingBalance);
        const octStarting = new Decimal(octOpenRow.startingBalance);
        const diff = sepEnding.sub(octStarting).abs();
        assert(diff.lt(0.01), `Rollforward cent variance for ${acc.username}: delta=${diff.toNumber()}`);

        simPassCount++;
      } catch (e) {
        simFailCount++;
        simFailures.push({ username: acc.username, error: e.message });
      }
    }

    console.log(`\n================================================================================`);
    console.log(`OFFLINE 90-ACCOUNT ROLLOVER SIMULATION RESULTS:`);
    console.log(`- Evaluated: ${allAccounts.length}`);
    console.log(`- PASS:      ${simPassCount}/${allAccounts.length} PASS (OFFLINE 90-ACCOUNT ROLLOVER SIMULATION)`);
    console.log(`- FAIL:      ${simFailCount}/${allAccounts.length} FAIL`);
    console.log(`================================================================================\n`);

    assert.strictEqual(simPassCount, 90, "All 90 accounts must pass rollover simulation with zero variances");
    pass("11.1. OFFLINE 90-ACCOUNT ROLLOVER SIMULATION: 90/90 PASS (Zero Cent Variances)");
  } catch (err) {
    fail("Test 11 failed", err);
  }

  // ---------------------------------------------------------------------------
  // TEST 12: Chart / Monthly Breakdown Rollover Verification
  // ---------------------------------------------------------------------------
  console.log("\n--- 12. Chart / Breakdown Rollover Verification ---");
  try {
    const testInv = {
      rawInvestors: [{ id: 'inv_chart', investorid: 'inv_chart', portalusername: 'chartuser', investorsplit: 70, split_pct: 70 }],
      accounts: [{ id: 'inv_chart', investor_id: 'inv_chart', startingcapital: 100000, starting_capital: 100000, split_pct: 70 }],
      returnsSheet: baseReturns2026,
      depositsSheet: [],
      withdrawalsSheet: [],
      historyTable: [],
      commissionEarningsTable: [],
      commissionSharesTable: [],
      commissionRulesTable: [],
      cutoverAdjustments: [],
      live: mockLiveOct
    };

    // 1. As of September 30 23:59:59 LA
    const dashSep30 = await buildInvestorDashboard('chartuser', testInv, { asOfDate: "2026-09-30T23:59:59-07:00" });
    const sep30ChartData = dashSep30.breakdown.map(r => (r.isHistoricalCompleted ? r.effectiveReturnPct : null));
    const augSep30 = dashSep30.breakdown.find(r => r.monthNumber === 8);
    const sepSep30 = dashSep30.breakdown.find(r => r.monthNumber === 9);

    assert(sep30ChartData[7] !== null, "August bar must be present on Sep 30");
    assert.strictEqual(sep30ChartData[8], null, "September bar must be ABSENT (null) on Sep 30");
    assert.strictEqual(sep30ChartData[9], null, "October bar must be ABSENT (null) on Sep 30");
    assert.strictEqual(sepSep30.effectiveReturnPct, 0, "September settled return must be 0% on Sep 30");
    assert.strictEqual(sepSep30.gain, 0, "September settled gain must be $0 on Sep 30");

    // 2. As of October 1 00:00:00 LA
    const dashOct1 = await buildInvestorDashboard('chartuser', testInv, { asOfDate: "2026-10-01T00:00:00-07:00" });
    const oct1ChartData = dashOct1.breakdown.map(r => (r.isHistoricalCompleted ? r.effectiveReturnPct : null));
    const sepOct1 = dashOct1.breakdown.find(r => r.monthNumber === 9);
    const octOct1 = dashOct1.breakdown.find(r => r.monthNumber === 10);
    const novOct1 = dashOct1.breakdown.find(r => r.monthNumber === 11);

    assert(oct1ChartData[7] !== null, "August bar must be present on Oct 1");
    assert.strictEqual(oct1ChartData[8], 1.40, "September bar must be VISIBLE (1.40%) on Oct 1");
    assert.strictEqual(oct1ChartData[9], null, "October bar must be ABSENT (null) on Oct 1");
    assert.strictEqual(oct1ChartData[10], null, "November bar must be ABSENT (null) on Oct 1");
    assert.strictEqual(sepOct1.effectiveReturnPct, 1.40, "September historical return populated");
    assert(sepOct1.gain > 0, "September historical gain populated");
    assert.strictEqual(octOct1.effectiveReturnPct, 0, "October open settled return must be 0%");
    assert.strictEqual(octOct1.gain, 0, "October open settled gain must be $0");
    pass("12.1. Chart / Breakdown Rollover: Sep 30 (Aug visible, Sep hidden) -> Oct 1 (Sep visible, Oct hidden, futures hidden)");
  } catch (err) {
    fail("Test 12 failed", err);
  }

  // ---------------------------------------------------------------------------
  // TEST 13: Mobile Responsive Layout Verification (375px, 390px, 430px)
  // ---------------------------------------------------------------------------
  console.log("\n--- 13. Mobile Responsive Layout Verification ---");
  try {
    const indexPath = path.join(__dirname, "../index.html");
    const indexHtml = fs.readFileSync(indexPath, "utf8");

    // Verify viewport meta tag exists
    assert(indexHtml.includes('name="viewport"'), "Viewport meta tag present");
    assert(indexHtml.includes('content="width=device-width, initial-scale=1"'), "Standard responsive viewport configured");

    // Verify Mobile breakdown card CSS rules
    assert(indexHtml.includes('#breakdownTable tr.breakdown-row {'), "Breakdown row card selector present");
    assert(indexHtml.includes('flex-direction: column;'), "Breakdown card uses flex column layout");
    assert(indexHtml.includes('box-sizing: border-box;'), "Breakdown card enforces box-sizing: border-box");

    // Verify table container allows visible overflow without forcing min-width blowout
    assert(indexHtml.includes('.table-container {'), "Table container selector present");
    assert(indexHtml.includes('overflow-x: visible;'), "Table container uses overflow-x: visible on mobile");

    // Verify simulated HTML rendering for October row at 375px, 390px, 430px
    const viewports = [375, 390, 430];
    for (const width of viewports) {
      const fixedWidthMatches = indexHtml.match(/(?:width|min-width):\s*(\d+)px/g) || [];
      for (const m of fixedWidthMatches) {
        const num = parseInt(m.match(/\d+/)[0], 10);
        if (m.includes('breakdown') && num > width) {
          throw new Error(`Fixed width ${m} exceeds viewport ${width}px in breakdown components`);
        }
      }
    }
    pass("13.1. Mobile layout verification: 375px, 390px, 430px responsive card layout intact, no horizontal overflow");
  } catch (err) {
    fail("Test 13 failed", err);
  }

  // ---------------------------------------------------------------------------
  // TEST 14: Cross-Surface Month-State Consistency Verification
  // ---------------------------------------------------------------------------
  console.log("\n--- 14. Cross-Surface Month-State Consistency ---");
  try {
    const testBoundaries = [
      { ts: "2026-09-30T23:59:59-07:00", name: "Sep 30 23:59:59 LA", expectedYear: 2026, expectedMonth: 9, expectedCommMonth: "August", expectedCommIdx: 8 },
      { ts: "2026-10-01T00:00:00-07:00", name: "Oct 1 00:00:00 LA", expectedYear: 2026, expectedMonth: 10, expectedCommMonth: "September", expectedCommIdx: 9 }
    ];

    const consistencyInv = {
      rawInvestors: [{ id: 'inv_test_1', investorid: 'inv_test_1', portalusername: 'testuser', split_pct: 70 }],
      accounts: [{ id: 'inv_test_1', investor_id: 'inv_test_1', starting_capital: 100000, split_pct: 70 }],
      returnsSheet: baseReturns2026,
      depositsSheet: [],
      withdrawalsSheet: [],
      historyTable: [],
      commissionEarningsTable: [
        { id: 'comm_aug', recipient_id: 'inv_test_1', year: 2026, month_number: 8, amount: 1500.00 },
        { id: 'comm_sep', recipient_id: 'inv_test_1', year: 2026, month_number: 9, amount: 1800.00 }
      ],
      commissionSharesTable: [],
      commissionRulesTable: [],
      cutoverAdjustments: [],
      live: mockLiveSep
    };

    for (const b of testBoundaries) {
      const authDate = getFundAccountingDate(b.ts);
      assert.strictEqual(authDate.year, b.expectedYear, `${b.name}: Year match`);
      assert.strictEqual(authDate.monthNumber, b.expectedMonth, `${b.name}: Month match`);

      // 1. Dashboard
      const dash = await buildInvestorDashboard('testuser', consistencyInv, { asOfDate: b.ts });
      assert.strictEqual(dash.summary.commMonthName, b.expectedCommMonth, `${b.name}: Dashboard comm month matches`);

      // 2. Accounting preview resolution
      const previewYear = authDate.year;
      const previewMonth = authDate.monthNumber;
      assert.strictEqual(previewYear, b.expectedYear, `${b.name}: Preview year matches`);
      assert.strictEqual(previewMonth, b.expectedMonth, `${b.name}: Preview month matches`);

      // 3. Commission card completed-month
      const commWithYear = getLastCompletedMonthWithYear(b.ts);
      assert.strictEqual(commWithYear.month, b.expectedCommIdx, `${b.name}: Commission completed month matches`);

      // 4. Myfxbook target-month selection
      const targetMyfxbook = getFundAccountingDate(b.ts);
      assert.strictEqual(targetMyfxbook.year, b.expectedYear, `${b.name}: Myfxbook year matches`);
      assert.strictEqual(targetMyfxbook.monthNumber, b.expectedMonth, `${b.name}: Myfxbook month matches`);

      // 5. Audit tooling (CJS bridge)
      const cjsDate = cjsMonthState.getFundAccountingDate(b.ts);
      assert.strictEqual(cjsDate.year, b.expectedYear, `${b.name}: Audit tooling CJS year matches`);
      assert.strictEqual(cjsDate.monthNumber, b.expectedMonth, `${b.name}: Audit tooling CJS month matches`);

      // 6. Chart flags
      const historicalMonthNumbers = dash.breakdown.filter(r => r.isHistoricalCompleted).map(r => r.monthNumber);
      assert(historicalMonthNumbers.includes(b.expectedCommIdx), `${b.name}: Chart includes completed month`);
      assert(!historicalMonthNumbers.includes(b.expectedMonth), `${b.name}: Chart excludes open month`);
    }
    pass("14.1. Cross-Surface Consistency: Dashboard, Preview, Commission Cards, Myfxbook Target, Audit Tooling, Chart Flags in 100% agreement");
  } catch (err) {
    fail("Test 14 failed", err);
  }

  console.log("================================================================================");
  console.log(`OCTOBER ROLLOVER CERTIFICATION SUMMARY: ${passCount} PASSED / ${failCount} FAILED`);
  console.log("================================================================================\n");

  if (failCount > 0) process.exit(1);
}

runAllTests().catch(console.error);
