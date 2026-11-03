import assert from "node:assert";
import { buildInvestorDashboard } from "../lib/dashboard.js";
import { extractMyfxbookPeriodMetric } from "../lib/myfxbook.js";

const FAIL_CLOSED_TEXT = "Temporarily unavailable while being verified";

async function runP0RegressionSuite() {
  console.log("================================================================================");
  console.log("P0 PERFORMANCE & COMMISSION PERIOD-ISOLATION & FAIL-CLOSED REGRESSION SUITE");
  console.log("================================================================================\n");

  // 1. Myfxbook HTML Scraper Row-Isolation Regression Test (Source Semantics for Dash)
  console.log("1. Testing Myfxbook HTML Scraper Row-Isolation & Dash Source Semantics");
  const rolloverHtml = `
    <table>
      <tr><td>Today</td><td>-</td></tr>
      <tr><td>This Week</td><td>-</td></tr>
      <tr><td>This Month</td><td>-</td></tr>
      <tr><td>This Year</td><td><span class="green">+33.25%</span></td></tr>
    </table>
  `;
  // Documented Myfxbook source semantics: a dash indicates missing / no data for that period.
  // The parser must return null (missing data) and never treat missing data as zero without evidence,
  // nor tunnel across <tr> rows into This Year.
  assert.strictEqual(extractMyfxbookPeriodMetric(rolloverHtml, "Today"), null);
  assert.strictEqual(extractMyfxbookPeriodMetric(rolloverHtml, "This Week"), null);
  assert.strictEqual(extractMyfxbookPeriodMetric(rolloverHtml, "This Month"), null);
  assert.strictEqual(extractMyfxbookPeriodMetric(rolloverHtml, "This Year"), "+33.25%");
  console.log("   ✓ Scraper strictly isolates each <tr><td> row and preserves null for missing dash data\n");

  // 2. Period Isolation: This Month must NEVER copy This Week when month is 0% and week > 0%
  console.log("2. Testing Period Isolation: Daily, Weekly, Monthly, YTD, Net Return & Commissions");
  const baseReturns = Array.from({ length: 12 }, (_, idx) => ({
    id: `r_${idx + 1}`,
    year: 2026,
    month_number: idx + 1,
    month: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][idx],
    gross_return_pct: idx < 9 ? 2.0 : 0.0,
    locked: idx < 9
  }));

  const splitInvestorPreloaded = {
    rawInvestors: [{
      id: "inv_test50",
      investorid: "inv_test50",
      portalusername: "test50",
      first_name: "Test",
      last_name: "Fifty",
      split_pct: 50,
      start_date: "2026-01-01"
    }],
    accounts: [{
      id: "inv_test50",
      investor_id: "inv_test50",
      portalusername: "test50",
      startingcapital: 100000,
      split_pct: 50,
      status: "active"
    }],
    returnsSheet: baseReturns,
    depositsSheet: [],
    withdrawalsSheet: [],
    historyTable: [],
    commissionEarningsTable: [],
    commissionSharesTable: [],
    commissionRulesTable: [],
    cutoverAdjustments: [],
    live: {
      today: "+0.40%",
      week: "+1.20%",
      month: "+0.00%",
      year: "+19.50%"
    },
    asOfDate: "2026-11-02T12:00:00Z"
  };

  const splitDash = await buildInvestorDashboard("test50", splitInvestorPreloaded);
  assert.strictEqual(splitDash.fundPerformance.today.grossReturnPct, 0.4);
  assert.strictEqual(splitDash.fundPerformance.week.grossReturnPct, 1.2);
  assert.strictEqual(splitDash.fundPerformance.month.grossReturnPct, 0);
  assert.strictEqual(splitDash.accountPerformance.today.netReturnPct, 0.2);
  assert.strictEqual(splitDash.accountPerformance.week.netReturnPct, 0.6);
  assert.strictEqual(splitDash.accountPerformance.month.netReturnPct, 0, "This Month must remain 0% and never reuse This Week");
  assert.strictEqual(splitDash.accountPerformance.month.netDollar, 0, "This Month dollar gain must remain $0.00 when month return is 0%");
  console.log("   ✓ Daily, Weekly, Monthly, Fund Gross, and Investor Net Return are strictly isolated\n");

  // 3. Cross-Period Duplication Fail-Closed Safeguard (Screenshot +33.25% Defect)
  console.log("3. Testing Fail-Closed Safeguard on Duplicated Today/Week/Month Screenshot Defect");
  const duplicatedLiveDash = await buildInvestorDashboard("test50", {
    ...splitInvestorPreloaded,
    live: {
      today: "+33.25%",
      week: "+33.25%",
      month: "+33.25%",
      year: "+33.25%"
    }
  });
  assert.strictEqual(duplicatedLiveDash.accountPerformance.today.unavailable, true);
  assert.strictEqual(duplicatedLiveDash.accountPerformance.week.unavailable, true);
  assert.strictEqual(duplicatedLiveDash.accountPerformance.month.unavailable, true);
  assert.strictEqual(duplicatedLiveDash.accountPerformance.today.statusText, FAIL_CLOSED_TEXT);
  assert.strictEqual(duplicatedLiveDash.accountPerformance.today.netDollar, null);
  assert.strictEqual(duplicatedLiveDash.accountPerformance.week.netDollar, null);
  assert.strictEqual(duplicatedLiveDash.accountPerformance.month.netDollar, null);
  console.log("   ✓ Contaminated Today/Week/Month metrics fail closed with 'Temporarily unavailable while being verified'\n");

  // 4. Zero-Earning Commission Fallback Protection (Scott Valdes / Tommy Aceves Pre-Start Rule)
  console.log("4. Testing Zero-Earning Commission Fallback (Pre-Start Investor & Unbooked Earnings)");
  const svaldesPreloaded = {
    rawInvestors: [
      { id: "inv_764c2992", investorid: "inv_764c2992", portalusername: "svaldes", first_name: "Scott", last_name: "Valdes", split_pct: 50, start_date: "2026-10-01" },
      { id: "inv_9a40740d", investorid: "inv_9a40740d", portalusername: "taceves", first_name: "Tommy", last_name: "Aceves", split_pct: 50, start_date: "2026-11-01" }
    ],
    accounts: [
      { id: "inv_764c2992", investor_id: "inv_764c2992", startingcapital: 50000, split_pct: 50, status: "active" },
      { id: "inv_9a40740d", investor_id: "inv_9a40740d", startingcapital: 11570.11, split_pct: 50, status: "active" }
    ],
    returnsSheet: baseReturns.map(r => (r.month_number === 10 ? { ...r, gross_return_pct: 3.05, locked: false } : r)),
    depositsSheet: [],
    withdrawalsSheet: [],
    historyTable: [],
    commissionEarningsTable: [],
    commissionSharesTable: [{
      id: "share_svaldes",
      source_investor_id: "inv_9a40740d",
      recipient_investor_id: "inv_764c2992",
      commission_percent: 14.1,
      effective_start_date: "2026-10-19",
      status: "active"
    }],
    commissionRulesTable: [],
    cutoverAdjustments: [],
    live: { today: "+0.00%", week: "+0.00%", month: "+0.00%", year: "+33.25%" },
    asOfDate: "2026-11-02T12:00:00Z"
  };

  const svaldesDash = await buildInvestorDashboard("svaldes", svaldesPreloaded);
  assert.strictEqual(svaldesDash.summary.commissionsEarnedMonth, 0, "svaldes October commission must be $0.00, never fabricated");
  assert.strictEqual(svaldesDash.summary.commissionsEarnedYear, 0, "svaldes YTD commission must be $0.00, never fabricated");
  console.log("   ✓ Unbooked / pre-start commission rules never fabricate commission dollar amounts\n");

  // 5. Live Production Supabase Verification for Joshua Stout (jstout)
  console.log("5. Verifying Live Authoritative Dashboard Build for Joshua Stout (jstout)");
  const jstoutLive = await buildInvestorDashboard("jstout");
  assert.strictEqual(Number(jstoutLive.summary.currentBalance.toFixed(2)), 3333453.52, "Joshua Stout settled Current Balance must be preserved at $3,333,453.52");
  assert.strictEqual(jstoutLive.accountPerformance.today.netReturnPct, 0);
  assert.strictEqual(jstoutLive.accountPerformance.week.netReturnPct, 0);
  assert.strictEqual(jstoutLive.accountPerformance.month.netReturnPct, 0);
  assert.strictEqual(jstoutLive.accountPerformance.year.unavailable, true, "Unfinalized October rollover must fail closed on This Year (YTD)");
  assert.strictEqual(jstoutLive.accountPerformance.year.statusText, FAIL_CLOSED_TEXT);
  assert.strictEqual(jstoutLive.summary.commissionsUnavailable, true, "Premature Oct 1 commission rows must fail closed on Commission cards");
  assert.strictEqual(jstoutLive.summary.commissionsStatusText, FAIL_CLOSED_TEXT);
  assert.strictEqual(jstoutLive.summary.commissionsEarnedMonth, null);
  assert.strictEqual(jstoutLive.summary.commissionsEarnedYear, null);
  assert.strictEqual(jstoutLive.summary.commissionsEarnedYearVerifiedLocked, 42047.37);
  console.log("   ✓ Live Joshua Stout dashboard preserves settled balance ($3,333,453.52) and fails closed on unverified metrics\n");

  console.log("================================================================================");
  console.log("ALL P0 PERFORMANCE & COMMISSION SAFEGUARD TESTS PASSED (100%)");
  console.log("================================================================================");
}

runP0RegressionSuite().catch(err => {
  console.error("P0 REGRESSION SUITE FAILED:", err);
  process.exit(1);
});
