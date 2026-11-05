import assert from "node:assert";
import Decimal from "decimal.js";
import { buildInvestorDashboard } from "../lib/dashboard.js";

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

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

  // Test Case 1: Earning Month vs Capitalization Month
  console.log("Test 1: Verifying Month Attribution (September Earned -> Capitalized in October)");
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
        locked: true
      },
      {
        id: "h_9",
        investor_id: "stout001",
        year: 2026,
        month_number: 9,
        month: "September",
        opening_balance: 3306008.46, // Includes $11,153.73 August commission credited Sept 1
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
        opening_balance: 3400953.52, // $3,389,465.67 + $11,487.85 September commission
        deposits: 0,
        withdrawals: 67500.00,
        gross_return_pct: 3.05,
        manual_gain_amount: 0,
        ending_balance: 3333453.52,
        locked: false
      }
    ];

    const commissionEarnings = [
      // September Active Earnings for Joshua Stout: exactly $11,487.85
      { id: "c_sep_1", recipient_id: "stout001", year: 2026, month_number: 9, amount: 11487.85, status: "ACTIVE" },
      // October Premature Superseded records
      { id: "c_oct_1", recipient_id: "stout001", year: 2026, month_number: 10, amount: 2450.00, status: "SUPERSEDED" }
    ];

    const returnsSheet = [
      { id: "r_8", year: 2026, month_number: 8, month: "August", gross_return_pct: 3.03, locked: true },
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

    const m9Breakdown = d.breakdown.find(b => b.monthNumber === 9);
    const m10Breakdown = d.breakdown.find(b => b.monthNumber === 10);

    assert.strictEqual(m9Breakdown.commissionsEarned, 11487.85, "September breakdown commissionsEarned must equal 11487.85");
    // In October's breakdown, commissionsEarned should be 0 because October rows are SUPERSEDED
    assert.strictEqual(m10Breakdown.commissionsEarned, 0, "October breakdown commissionsEarned must be 0 for superseded records");

    // Check opening balance roll difference
    const sepEnd = new Decimal(m9Breakdown.endingBalance);
    const octStart = new Decimal(m10Breakdown.startingBalance);
    const rollDiff = octStart.sub(sepEnd);
    assert.strictEqual(rollDiff.toFixed(2), "11487.85", "October starting balance must reflect September commission addition of $11,487.85");

    console.log("   ✓ September commission ($11,487.85) correctly rolls into October starting balance");
    console.log("   ✓ October breakdown preserves 0.00 commissionsEarned for superseded records");
  }

  // Test Case 2: August Superseded Safeguard Display
  console.log("\nTest 2: Verifying August Superseded Safeguard & September Display");
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
        opening_balance: 3389465.67,
        deposits: 0,
        withdrawals: 0,
        gross_return_pct: 3.07,
        manual_gain_amount: 83457.21,
        ending_balance: 3389465.67,
        locked: true
      }
    ];

    // August has SUPERSEDED rows
    const commissionEarnings = [
      { id: "c_aug_1", recipient_id: "stout001", year: 2026, month_number: 8, amount: 11153.73, status: "ACTIVE" },
      { id: "c_aug_sup", recipient_id: "stout001", year: 2026, month_number: 8, amount: 1138.90, status: "SUPERSEDED" },
      { id: "c_sep_1", recipient_id: "stout001", year: 2026, month_number: 9, amount: 11487.85, status: "ACTIVE" }
    ];

    const returnsSheet = [
      { id: "r_8", year: 2026, month_number: 8, month: "August", gross_return_pct: 3.03, locked: false },
      { id: "r_9", year: 2026, month_number: 9, month: "September", gross_return_pct: 3.07, locked: true }
    ];

    const d = await buildInvestorDashboard("jstout", {
      rawInvestors: jstoutInvestors,
      accounts: jstoutAccounts,
      historyTable,
      commissionEarningsTable: commissionEarnings,
      returnsSheet,
      depositsSheet: [],
      withdrawalsSheet: [],
      cutoverAdjustments: [],
      asOfDate: "2026-11-05T00:00:00Z"
    });

    const augRow = d.breakdown.find(b => b.monthNumber === 8);
    // Because August has a SUPERSEDED row, displayCommissionsEarned must be 0
    assert.strictEqual(augRow.commissionsEarned, 0, "August commissionsEarned must be suppressed to 0 when superseded rows exist");
    assert.strictEqual(augRow.verificationStatus, "UNVERIFIED", "August verificationStatus must be UNVERIFIED");

    console.log("   ✓ August commission correctly suppressed from displayCommissionsEarned (0.00) due to superseded batch");
    console.log("   ✓ Explains why September displayed no 'Commission Added' in the prior screenshot");
  }

  // Test Case 3: Summary Cards Fail Closed on Uncertified Data
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
  }

  // Test Case 4: Certified Ledger Allows Verified Commission Display
  console.log("\nTest 4: Explicitly Certified Ledger Unblocks Clean Cards");
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
      isCommissionLedgerCertified: true
    });

    assert.strictEqual(d.summary.commissionsEarnedMonth, 11487.85, "Certified month commission must display 11487.85");
    assert.strictEqual(d.summary.commissionsUnavailable, false, "commissionsUnavailable must be false when certified");

    console.log("   ✓ Explicit certification safely displays verified commissions ($11,487.85)");
  }

  console.log("\n================================================================================");
  console.log("ALL COMMISSION ATTRIBUTION & DISPLAY LOGIC TESTS PASSED (100%)");
  console.log("================================================================================");
}

runTests().catch(err => {
  console.error("Test Suite Failed:", err);
  process.exit(1);
});
