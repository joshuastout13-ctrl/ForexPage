import assert from "node:assert";
import Decimal from "decimal.js";
import { buildInvestorDashboard } from "../lib/dashboard.js";

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

/**
 * Exact replica of the index.html monthly breakdown activity rendering logic
 */
function renderMonthlyActivity(prevRow, isProjection = false) {
  let activityHtml = '';
  if (prevRow) {
    const isPrevCommUnverified = Boolean(
      prevRow.verificationStatus === 'UNVERIFIED' ||
      prevRow.commissionsUnavailable ||
      prevRow.isCommissionUnverified ||
      prevRow.hasSupersededCommissions
    );

    if (isPrevCommUnverified) {
      // Unverified row: verification-pending status takes strict precedence.
      // NEVER render a confirmed green numeric "Commission Added" amount.
      activityHtml += `<div class="safeguard-unavailable" style="font-size:11px; color:var(--muted);">${prevRow.month} Commission: Pending Verification</div>`;
    } else {
      const commAdded = parseFloat(prevRow.commissionsEarned) || 0;
      if (commAdded > 0) {
        const earnedTag = prevRow.month ? ` (${prevRow.month} Earned)` : '';
        activityHtml += `<div class="green">+$${commAdded.toFixed(2)} Commission Added${earnedTag}${isProjection ? ' (Projected)' : ''}</div>`;
      }
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
  console.log("Test 1: Verification-Pending Strict Precedence over Positive Amounts & Zero Fallbacks");
  {
    // Case 1A: Positive amount + UNVERIFIED => Pending message, NO numeric amount rendered
    const unverifiedPositiveRow = {
      month: "July",
      commissionsEarned: 500.00,
      commissionsUnavailable: true,
      verificationStatus: "UNVERIFIED"
    };
    const html1A = renderMonthlyActivity(unverifiedPositiveRow);
    assert(html1A.includes("July Commission: Pending Verification"), "Must show pending verification message");
    assert(!html1A.includes("500"), "Must NOT display numeric amount $500.00 when unverified");
    assert(!html1A.includes("Commission Added"), "Must NOT display confirmed 'Commission Added' label when unverified");
    console.log("   ✓ Positive amount ($500.00) + UNVERIFIED strictly renders pending message with zero numeric leakage");

    // Case 1B: Zero amount + UNVERIFIED => Pending message
    const unverifiedZeroRow = {
      month: "August",
      commissionsEarned: 0.00,
      commissionsUnavailable: true,
      verificationStatus: "UNVERIFIED"
    };
    const html1B = renderMonthlyActivity(unverifiedZeroRow);
    assert(html1B.includes("August Commission: Pending Verification"), "Must show pending verification message for zero amount");
    assert(!html1B.includes("Commission Added"), "Must NOT display 'Commission Added' when zero and unverified");
    console.log("   ✓ Zero amount ($0.00) + UNVERIFIED strictly renders pending verification message");

    // Case 1C: EXACT REQUIREMENT 1: verificationStatus === 'UNVERIFIED' when amount is zero and other flags are absent
    const unverifiedZeroNoFlags = {
      month: "August",
      commissionsEarned: 0,
      verificationStatus: "UNVERIFIED"
      // commissionsUnavailable is absent
      // isCommissionUnverified is absent
      // hasSupersededCommissions is absent
    };
    const html1C = renderMonthlyActivity(unverifiedZeroNoFlags);
    assert(html1C.includes("August Commission: Pending Verification"), "Must show pending verification message when amount is zero and other flags are absent");
    assert(!html1C.includes("Commission Added"), "Must NOT display 'Commission Added'");
    console.log("   ✓ verificationStatus === 'UNVERIFIED' strictly takes precedence when amount is zero and other flags are absent");

    // Case 1D: September $11,487.85 unverified with other flags absent => MUST NOT expose positive amount
    const unverifiedSepNoFlags = {
      month: "September",
      commissionsEarned: 11487.85,
      verificationStatus: "UNVERIFIED"
      // other flags absent
    };
    const html1D = renderMonthlyActivity(unverifiedSepNoFlags);
    assert(html1D.includes("September Commission: Pending Verification"), "Must show pending verification message for unverified September");
    assert(!html1D.includes("Commission Added"), "Must NOT display 'Commission Added'");
    assert(!html1D.includes("11487"), "Must NOT expose 11487 numeric amount");
    console.log("   ✓ verificationStatus === 'UNVERIFIED' strictly takes precedence over September $11,487.85 when other flags absent");

    // Case 1E: Verified positive amount (authorized and certified)
    const verifiedRow = {
      month: "July",
      commissionsEarned: 500.00,
      commissionsUnavailable: false,
      verificationStatus: "VERIFIED"
    };
    const html1E = renderMonthlyActivity(verifiedRow);
    assert(html1E.includes("+$500.00 Commission Added (July Earned)"), "Must display confirmed amount labeled July Earned");
    assert(!html1E.includes("Pending Verification"), "Must NOT show pending verification when verified");
    console.log("   ✓ Explicitly verified row correctly renders '+$500.00 Commission Added (July Earned)'");
  }

  // --- TEST GROUP 2: INTEGRATED DASHBOARD BREAKDOWN ROW SHAPE & UNCERTIFIED SEPTEMBER SAFEGUARD ---
  console.log("\nTest 2: Verifying Monthly Breakdown Row Shape & Uncertified September Safeguard");
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
      // September Active Earnings for Joshua Stout: uncertified booked gross-basis amount ($11,487.85)
      { id: "c_sep_1", recipient_id: "stout001", year: 2026, month_number: 9, amount: 11487.85, status: "ACTIVE" },
      // October Premature Superseded records
      { id: "c_oct_1", recipient_id: "stout001", year: 2026, month_number: 10, amount: 2450.00, status: "SUPERSEDED" }
    ];

    const returnsSheet = [
      { id: "r_8", year: 2026, month_number: 8, month: "August", gross_return_pct: 3.03, locked: false },
      { id: "r_9", year: 2026, month_number: 9, month: "September", gross_return_pct: 3.07, locked: true },
      { id: "r_10", year: 2026, month_number: 10, month: "October", gross_return_pct: 3.05, locked: false }
    ];

    // Build dashboard WITHOUT isCommissionLedgerCertified: September calculation is unresolved
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
    const sepActivity = renderMonthlyActivity(m8Row);
    assert(sepActivity.includes("August Commission: Pending Verification"), "September activity must render 'August Commission: Pending Verification'");
    assert(!sepActivity.includes("Commission Added"), "September activity must NOT render 'Commission Added'");
    console.log("   ✓ Actual August monthly row data correctly drives 'August Commission: Pending Verification' in September activity");

    // REQUIREMENT 2: September $11,487.85 must NOT be labeled as verified/earned without authoritative certification
    assert.strictEqual(m9Row.verificationStatus, "UNVERIFIED", "September verificationStatus must be UNVERIFIED while net-basis calculation is unresolved");
    assert.strictEqual(m9Row.commissionsEarned, 0, "September commissionsEarned must be suppressed to 0 while uncertified");
    assert.strictEqual(m9Row.commissionsUnavailable, true, "September commissionsUnavailable must be true");

    // Test rendering of October activity (prevRow is September)
    const octActivity = renderMonthlyActivity(m9Row);
    assert(octActivity.includes("September Commission: Pending Verification"), "October activity must render 'September Commission: Pending Verification'");
    assert(!octActivity.includes("Commission Added"), "October activity must NOT render confirmed 'Commission Added'");
    assert(!octActivity.includes("11487"), "October activity must NOT expose $11,487.85 as a confirmed green amount");
    console.log("   ✓ Uncertified September row correctly suppresses $11,487.85 and drives 'September Commission: Pending Verification' in October activity");

    // Test rendering of November activity (prevRow is October)
    // October is open/unfinalized with superseded commission rows
    assert.strictEqual(m10Row.commissionsEarned, 0, "October commissionsEarned must be 0");
    assert.strictEqual(m10Row.commissionsUnavailable, true, "October commissionsUnavailable must be true");
    const novActivity = renderMonthlyActivity(m10Row);
    assert(novActivity.includes("October Commission: Pending Verification"), "November activity must render 'October Commission: Pending Verification'");
    console.log("   ✓ October open/unfinalized status prevents any October commission from capitalizing into November");
  }

  // --- TEST GROUP 3: YTD SUMMARY REMAINING UNAVAILABLE ---
  console.log("\nTest 3: Summary Commission Cards Fail Closed on Uncertified Data & YTD Unavailable");
  {
    const commissionEarnings = [
      { id: "c_sep_1", recipient_id: "stout001", year: 2026, month_number: 9, amount: 11487.85, status: "ACTIVE" }
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

    assert.strictEqual(d.summary.commissionsEarnedMonth, null, "commissionsEarnedMonth must be null when uncertified");
    assert.strictEqual(d.summary.commissionsEarnedYear, null, "commissionsEarnedYear must be null when uncertified");
    assert.strictEqual(d.summary.commissionsUnavailable, true, "commissionsUnavailable must be true");
    assert.strictEqual(d.summary.commissionsStatusText, "Temporarily unavailable while being verified");

    console.log("   ✓ Summary cards return null and 'Temporarily unavailable while being verified'");
    console.log("   ✓ YTD commission strictly remains null/unavailable for uncertified periods");
  }

  // --- TEST GROUP 4: CALLER-SUPPLIED BOOLEANS CANNOT CERTIFY COMMISSION LEDGER ---
  console.log("\nTest 4: Caller-Supplied Booleans Cannot Certify Commission Ledger or Bypass Fail-Closed Gate");
  {
    const commissionEarnings = [
      { id: "c_sep_1", recipient_id: "stout001", year: 2026, month_number: 9, amount: 11487.85, status: "ACTIVE" }
    ];

    const returnsSheet = [
      { id: "r_9", year: 2026, month_number: 9, month: "September", gross_return_pct: 3.07, locked: true }
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
      asOfDate: "2026-10-05T00:00:00Z",
      isCommissionLedgerCertified: true,
      commissionLedgerCertified: true
    }, {
      isCommissionLedgerCertified: true,
      commissionLedgerCertified: true
    });

    const m9Row = d.breakdown.find(b => b.monthNumber === 9);
    assert.strictEqual(m9Row.verificationStatus, "UNVERIFIED", "Caller-supplied boolean must NOT certify September");
    assert.strictEqual(m9Row.commissionsEarned, 0, "September commissionsEarned must remain suppressed (0) despite caller-supplied flags");
    assert.strictEqual(m9Row.commissionsUnavailable, true, "September commissionsUnavailable must remain true");

    const octActivity = renderMonthlyActivity(m9Row);
    assert(octActivity.includes("September Commission: Pending Verification"), "Activity must still render pending verification");
    assert(!octActivity.includes("11487"), "Activity must NOT expose $11,487.85 when caller passes boolean flags");

    assert.strictEqual(d.summary.commissionsEarnedMonth, null, "commissionsEarnedMonth must remain null despite caller-supplied flags");
    assert.strictEqual(d.summary.commissionsEarnedYear, null, "commissionsEarnedYear (YTD) must remain fail-closed (null)");
    assert.strictEqual(d.summary.commissionsUnavailable, true, "commissionsUnavailable must remain true");

    console.log("   ✓ Caller-supplied options/preloadedData booleans cannot certify the commission ledger");
    console.log("   ✓ Monthly activity and YTD commission remain strictly fail-closed");
  }

  console.log("\n================================================================================");
  console.log("ALL COMMISSION ATTRIBUTION & DISPLAY LOGIC TESTS PASSED (100%)");
  console.log("================================================================================");
}

runTests().catch(err => {
  console.error("Test Suite Failed:", err);
  process.exit(1);
});
