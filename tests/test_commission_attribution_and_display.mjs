import assert from "node:assert";
import Decimal from "decimal.js";
import { buildInvestorDashboard } from "../lib/dashboard.js";

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

/**
 * Exact replica of the index.html monthly breakdown activity rendering logic
 */
function renderMonthlyActivity(prevRow, targetMonthName = '', isProjection = false) {
  let activityHtml = '';
  if (prevRow) {
    const isPrevCommUnverified = Boolean(
      prevRow.commissionsUnavailable ||
      prevRow.isCommissionUnverified ||
      prevRow.hasSupersededCommissions ||
      (prevRow.verificationStatus === 'UNVERIFIED' && (prevRow.commissionsUnavailable || (parseFloat(prevRow.commissionsEarned) || 0) > 0))
    );

    const commAdded = parseFloat(prevRow.activeCommissionsEarned ?? prevRow.commissionsEarned) || 0;
    if (commAdded > 0) {
      const commLabel = (prevRow.month && targetMonthName)
        ? `${prevRow.month} 2026 commission — capitalized in ${targetMonthName}`
        : (prevRow.month ? `Commission Added (${prevRow.month} Earned)` : 'Commission Added');
      activityHtml += `<div class="green">+$${commAdded.toFixed(2)} ${commLabel}${isProjection ? ' (Projected)' : ''}</div>`;
    } else if (isPrevCommUnverified) {
      activityHtml += `<div class="safeguard-unavailable" style="font-size:11px; color:var(--muted);">${prevRow.month} Commission: Pending Verification</div>`;
    }
  }
  return activityHtml;
}

async function runTests() {
  console.log("================================================================================");
  console.log("TEST SUITE: COMMISSION ATTRIBUTION, DISPLAY LOGIC & FAIL-CLOSED GUARDS");
  console.log("================================================================================\n");

  const jstoutInvestors = [{
    id: "stout001",
    investorid: "stout001",
    portalusername: "jstout",
    first_name: "Joshua",
    last_name: "Stout",
    split_pct: 100,
    start_date: "2026-01-01"
  }];

  const jstoutAccounts = [{
    id: "stout001",
    investor_id: "stout001",
    portalusername: "jstout",
    startingcapital: 2500000.00,
    split_pct: 100,
    status: "active",
    is_commission: true
  }];

  // --- TEST GROUP 1: RENDERING PRECEDENCE UNIT TESTS ---
  console.log("Test 1: Verification-Pending Strict Precedence over Positive Amounts");
  {
    // Case 1A: Active amount with superseded warning => Renders active amount with attribution label
    const activeWithSupersededRow = {
      month: "August",
      commissionsEarned: 11153.73,
      commissionsUnavailable: true,
      hasSupersededCommissions: true,
      verificationStatus: "UNVERIFIED"
    };
    const html1A = renderMonthlyActivity(activeWithSupersededRow, "September");
    assert(html1A.includes("+$11153.73 August 2026 commission — capitalized in September"), "Must display active amount labeled capitalized in September");
    assert(!html1A.includes("Pending Verification"), "Must NOT display pending verification when active amount exists");
    console.log("   ✓ Active amount ($11,153.73) with superseded rows correctly renders active amount without suppressing");

    // Case 1B: Zero amount + UNVERIFIED (e.g. October with 0 active rows) => Pending message
    const unverifiedZeroRow = {
      month: "October",
      commissionsEarned: 0.00,
      commissionsUnavailable: true,
      hasSupersededCommissions: true,
      verificationStatus: "UNVERIFIED"
    };
    const html1B = renderMonthlyActivity(unverifiedZeroRow, "November");
    assert(html1B.includes("October Commission: Pending Verification"), "Must show pending verification message for zero amount");
    assert(!html1B.includes("Commission Added"), "Must NOT display 'Commission Added' when zero and unverified");
    console.log("   ✓ Zero amount ($0.00) + UNVERIFIED strictly renders pending verification message");

    // Case 1C: Verified positive amount => Render green confirmed 'Commission Added (September Earned)'
    const verifiedRow = {
      month: "September",
      commissionsEarned: 11487.85,
      commissionsUnavailable: false,
      verificationStatus: "VERIFIED"
    };
    const html1C = renderMonthlyActivity(verifiedRow);
    assert(html1C.includes("+$11487.85 Commission Added (September Earned)"), "Must display confirmed amount labeled September Earned");
    assert(!html1C.includes("Pending Verification"), "Must NOT show pending verification when verified");
    console.log("   ✓ Verified September row correctly renders '+$11487.85 Commission Added (September Earned)'");
  }

  // --- TEST GROUP 2: INTEGRATED DASHBOARD BREAKDOWN ROW SHAPE & LIVE DATA ---
  console.log("\nTest 2: Verifying Monthly Breakdown Row Shape & August Safeguard");
  {
    const historyTable = [
      {
        id: "h_8",
        investor_id: "stout001",
        year: 2026,
        month_number: 8,
        month: "August",
        opening_balance: 3214239.08,
        deposits: 0,
        withdrawals: 0,
        gross_return_pct: 3.03,
        manual_gain_amount: 80615.65,
        ending_balance: 3294854.73,
        locked: false
      },
      {
        id: "h_9",
        investor_id: "stout001",
        year: 2026,
        month_number: 9,
        month: "September",
        opening_balance: 3306008.46,
        deposits: 0,
        withdrawals: 0,
        gross_return_pct: 3.07,
        manual_gain_amount: 83457.21,
        ending_balance: 3389465.67,
        locked: true
      },
      {
        id: "h_10",
        investor_id: "stout001",
        year: 2026,
        month_number: 10,
        month: "October",
        opening_balance: 3400953.52,
        deposits: 0,
        withdrawals: 67500.00,
        gross_return_pct: 3.05,
        manual_gain_amount: 0,
        ending_balance: 3333453.52,
        locked: false
      }
    ];

    const commissionEarnings = [
      // August has both active and superseded rows
      { id: "c_aug_1", recipient_id: "stout001", year: 2026, month_number: 8, amount: 11153.73, status: "ACTIVE" },
      { id: "c_aug_sup", recipient_id: "stout001", year: 2026, month_number: 8, amount: 1138.90, status: "SUPERSEDED" },
      // September Active Earnings for Joshua Stout: exactly $11,487.85
      { id: "c_sep_1", recipient_id: "stout001", year: 2026, month_number: 9, amount: 11487.85, status: "ACTIVE" },
      // October Premature Superseded records
      { id: "c_oct_1", recipient_id: "stout001", year: 2026, month_number: 10, amount: 2450.00, status: "SUPERSEDED" }
    ];

    const returnsSheet = [
      { id: "r_8", year: 2026, month_number: 8, month: "August", gross_return_pct: 3.03, locked: false },
      { id: "r_9", year: 2026, month_number: 9, month: "September", gross_return_pct: 3.07, locked: true },
      { id: "r_10", year: 2026, month_number: 10, month: "October", gross_return_pct: 3.05, locked: false }
    ];

    const d = await buildInvestorDashboard("jstout", {
      rawInvestors: jstoutInvestors,
      accounts: jstoutAccounts,
      historyTable,
      commissionEarningsTable: commissionEarnings,
      returnsSheet,
      depositsSheet: [],
      withdrawalsSheet: [{ investorid: "stout001", year: 2026, month_number: 10, amount: 67500.00, status: "completed" }],
      cutoverAdjustments: [],
      asOfDate: "2026-11-05T00:00:00Z"
    });

    const m8Row = d.breakdown.find(b => b.monthNumber === 8);
    const m9Row = d.breakdown.find(b => b.monthNumber === 9);
    const m10Row = d.breakdown.find(b => b.monthNumber === 10);

    // Verify properties exist on the actual row shape
    assert("commissionsEarned" in m8Row, "Row must contain commissionsEarned");
    assert("commissionsUnavailable" in m8Row, "Row must contain commissionsUnavailable");
    assert("verificationStatus" in m8Row, "Row must contain verificationStatus");
    assert("isCommissionUnverified" in m8Row, "Row must contain isCommissionUnverified");
    assert("hasSupersededCommissions" in m8Row, "Row must contain hasSupersededCommissions");

    // Test rendering of September activity (prevRow is August)
    const sepActivity = renderMonthlyActivity(m8Row, "September");
    assert(sepActivity.includes("+$11153.73 August 2026 commission — capitalized in September"), "September activity must render active August commission");
    assert(!sepActivity.includes("Pending Verification"), "September activity must NOT say Pending Verification when active amount exists");
    console.log("   ✓ Actual August monthly row data correctly drives '+$11,153.73 August 2026 commission — capitalized in September'");

    // Test rendering of October activity (prevRow is September)
    const octActivity = renderMonthlyActivity(m9Row, "October");
    assert(octActivity.includes("+$11487.85 September 2026 commission — capitalized in October"), "October activity must render September commission");
    console.log("   ✓ Actual September monthly row data correctly drives '+$11,487.85 September 2026 commission — capitalized in October'");

    // Test rendering of November activity (prevRow is October)
    // October is open/unfinalized with superseded commission rows
    assert.strictEqual(m10Row.commissionsEarned, 0, "October commissionsEarned must be 0");
    assert.strictEqual(m10Row.commissionsUnavailable, true, "October commissionsUnavailable must be true");
    const novActivity = renderMonthlyActivity(m10Row);
    assert(novActivity.includes("October Commission: Pending Verification"), "November activity must render 'October Commission: Pending Verification'");
    console.log("   ✓ October open/unfinalized status prevents any October commission from capitalizing into November");
  }

  // --- TEST GROUP 3: YTD SUMMARY REMAINING UNAVAILABLE ---
  console.log("\nTest 3: Summary Commission Cards Fail Closed on Uncertified Data");
  {
    const commissionEarnings = [
      { id: "c_sep_1", recipient_id: "stout001", year: 2026, month_number: 9, amount: 11487.85, status: "ACTIVE" },
      { id: "c_oct_sup", recipient_id: "stout001", year: 2026, month_number: 10, amount: 125.55, status: "SUPERSEDED" }
    ];

    const returnsSheet = [
      { id: "r_9", year: 2026, month_number: 9, month: "September", gross_return_pct: 3.07, locked: true },
      { id: "r_10", year: 2026, month_number: 10, month: "October", gross_return_pct: 3.05, locked: false }
    ];

    const d = await buildInvestorDashboard("jstout", {
      rawInvestors: jstoutInvestors,
      accounts: jstoutAccounts,
      historyTable: [],
      commissionEarningsTable: commissionEarnings,
      returnsSheet,
      depositsSheet: [],
      withdrawalsSheet: [],
      cutoverAdjustments: [],
      asOfDate: "2026-11-05T00:00:00Z"
    });

    assert.strictEqual(d.summary.commissionsEarnedMonth, null, "commissionsEarnedMonth must be null when unverified");
    assert.strictEqual(d.summary.commissionsEarnedYear, null, "commissionsEarnedYear must be null when unverified");
    assert.strictEqual(d.summary.commissionsUnavailable, true, "commissionsUnavailable must be true");
    assert.strictEqual(d.summary.commissionsStatusText, "Temporarily unavailable while being verified");

    console.log("   ✓ Summary cards return null and 'Temporarily unavailable while being verified'");
    console.log("   ✓ YTD commission strictly remains null/unavailable for uncertified periods");
  }

  console.log("\n================================================================================");
  console.log("ALL COMMISSION ATTRIBUTION & DISPLAY LOGIC TESTS PASSED (100%)");
  console.log("================================================================================");
}

runTests().catch(err => {
  console.error("Test Suite Failed:", err);
  process.exit(1);
});
