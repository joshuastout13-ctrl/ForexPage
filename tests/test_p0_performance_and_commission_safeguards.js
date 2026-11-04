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
  assert.strictEqual(typeof jstoutLive.accountPerformance.today.netReturnPct, "number");
  assert.strictEqual(typeof jstoutLive.accountPerformance.week.netReturnPct, "number");
  assert.strictEqual(typeof jstoutLive.accountPerformance.month.netReturnPct, "number");
  assert.strictEqual(jstoutLive.accountPerformance.year.unavailable, true, "Unfinalized October rollover must fail closed on This Year (YTD)");
  assert.strictEqual(jstoutLive.accountPerformance.year.statusText, FAIL_CLOSED_TEXT);
  assert.strictEqual(jstoutLive.summary.commissionsUnavailable, true, "Uncertified commission ledger must fail closed on Commission cards");
  assert.strictEqual(jstoutLive.summary.commissionsStatusText, FAIL_CLOSED_TEXT);
  assert.strictEqual(jstoutLive.summary.commissionsEarnedMonth, null, "Month commission must be null when unverified, never 0.00");
  assert.strictEqual(jstoutLive.summary.commissionsEarnedYear, null, "Year commission must be null when unverified, never 0.00");
  assert.strictEqual(jstoutLive.summary.commissionsEarnedYearVerifiedLocked, 42047.37);
  console.log("   ✓ Live Joshua Stout dashboard preserves settled balance ($3,333,453.52) and fails closed on unverified metrics\n");

  // 6. Hermetic Fixture Tests for Fail-Closed Display Gate & Ledger Completeness
  console.log("6. Testing Hermetic Fixture Fail-Closed Commission Display Gate & Ledger Completeness");

  // Base hermetic fixture data with Jan-Sep locked commissions and October superseded commissions
  const hermeticBaseFixture = {
    rawInvestors: [{
      id: "inv_hermetic_recip",
      investorid: "inv_hermetic_recip",
      portalusername: "hermetic_recip",
      first_name: "Hermetic",
      last_name: "Recipient",
      split_pct: 50,
      start_date: "2026-01-01"
    }],
    accounts: [{
      id: "acct_hermetic_recip",
      investor_id: "inv_hermetic_recip",
      startingcapital: 500000,
      split_pct: 50,
      status: "active",
      is_commission: true
    }],
    returnsSheet: baseReturns.map(r => (r.month_number === 10 ? { ...r, gross_return_pct: 3.05, locked: false } : r)),
    depositsSheet: [],
    withdrawalsSheet: [],
    historyTable: [],
    commissionEarningsTable: [
      // Completed month verified commissions (e.g. Jan-Sep)
      { id: "comm_jan", recipient_id: "inv_hermetic_recip", year: 2026, month_number: 1, amount: 1000.00, status: "ACTIVE" },
      { id: "comm_sep", recipient_id: "inv_hermetic_recip", year: 2026, month_number: 9, amount: 2000.00, status: "ACTIVE" },
      // October commission row marked SUPERSEDED by remediation
      { id: "comm_oct_superseded", recipient_id: "inv_hermetic_recip", year: 2026, month_number: 10, amount: 1500.00, status: "SUPERSEDED" }
    ],
    commissionSharesTable: [],
    commissionRulesTable: [],
    cutoverAdjustments: [],
    live: { today: "+0.00%", week: "+0.00%", month: "+0.00%", year: "+33.25%" },
    asOfDate: "2026-11-04T12:00:00Z"
  };

  // Case A: Unresolved prior-month commissions remain unavailable after October rows are SUPERSEDED
  const uncertifiedDash = await buildInvestorDashboard("hermetic_recip", hermeticBaseFixture);
  assert.strictEqual(uncertifiedDash.summary.commissionsUnavailable, true,
    "SUPERSEDED October rows must NOT clear the uncertified ledger safeguard");
  assert.strictEqual(uncertifiedDash.summary.commissionsEarnedMonth, null,
    "Uncertified commissionsEarnedMonth must be null");
  assert.strictEqual(uncertifiedDash.summary.commissionsEarnedYear, null,
    "Uncertified commissionsEarnedYear must be null");
  assert.strictEqual(uncertifiedDash.summary.commissionsStatusText, FAIL_CLOSED_TEXT,
    "Status text must be fail-closed message");
  console.log("   ✓ Case A: SUPERSEDED October rows do not clear safeguard; amounts remain null with unverified message");

  // Case B: Verified completed-month commissions display when ledger is explicitly certified complete
  const certifiedDash = await buildInvestorDashboard("hermetic_recip", {
    ...hermeticBaseFixture,
    isCommissionLedgerCertified: true
  });
  assert.strictEqual(certifiedDash.summary.commissionsUnavailable, false,
    "Certified ledger must display completed-month commissions");
  assert.strictEqual(certifiedDash.summary.commissionsEarnedYear, 3000.00,
    "Certified YTD commissions must reflect verified Jan + Sep ($3,000.00)");
  assert.strictEqual(certifiedDash.summary.commissionsEarnedMonth, 0,
    "Certified open October month commission must be 0 (superseded row excluded)");
  assert.strictEqual(certifiedDash.summary.commissionsStatusText, null,
    "Certified ledger has no fail-closed status text");
  console.log("   ✓ Case B: Explicitly certified ledger displays verified completed-month commissions ($3,000.00)");

  // Case C: UI contract verification — unavailable never produces $0.00 or numeric total
  assert.strictEqual(uncertifiedDash.summary.commissionsEarnedMonth, null,
    "UI contract: month commission must be null, never 0 or 0.00");
  assert.strictEqual(uncertifiedDash.summary.commissionsEarnedYear, null,
    "UI contract: year commission must be null, never 0 or 0.00");
  assert.notStrictEqual(uncertifiedDash.summary.commissionsEarnedYear, 0);
  assert.notStrictEqual(uncertifiedDash.summary.commissionsEarnedMonth, 0);
  console.log("   ✓ Case C: UI receives null and unavailable flag, preventing $0.00 rendering\n");

  console.log("================================================================================");
  console.log("ALL P0 PERFORMANCE & COMMISSION SAFEGUARD TESTS PASSED (100%)");
  console.log("================================================================================");
}

runP0RegressionSuite().catch(err => {
  console.error("P0 REGRESSION SUITE FAILED:", err);
  process.exit(1);
});
