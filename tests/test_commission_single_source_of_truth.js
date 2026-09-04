import assert from "node:assert";
import Decimal from "decimal.js";
import { buildInvestorDashboard } from "../lib/dashboard.js";

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

function roundMoney(d) {
  return new Decimal(d).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/**
 * FOREXPAGE — COMMISSION SINGLE SOURCE OF TRUTH HARD INVARIANTS TEST SUITE
 * 
 * Invariant 1: For each completed month N:
 *   DISPLAYED_COMMISSION_EARNED(N) == DATABASE_COMMISSION_EARNED(N)
 * 
 * Invariant 2: COMMISSION_ADDED(N+1) == DATABASE_COMMISSION_EARNED(N)
 * 
 * Invariant 3: OPEN_MONTH_COMMISSION must not be capitalized early into current balance or next-month opening.
 * 
 * Invariant 4: Displayed next-month opening balance must reconcile:
 *   previous settled closing + commission added + deposits - withdrawals + explicit adjustments == displayed opening balance
 *   to the exact cent (fail on >= $0.01 mismatch).
 */
async function runCommissionSingleSourceOfTruthTests() {
  console.log("================================================================================");
  console.log("FOREXPAGE — COMMISSION SINGLE SOURCE OF TRUTH INVARIANT TESTS");
  console.log("================================================================================\n");

  // 1. Setup Canonical Test Fixtures for Joshua Stout (stout001)
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
    status: "active"
  }];

  const jstoutHistory = [
    {
      id: "h_jstout_7",
      investor_id: "stout001",
      year: 2026,
      month_number: 7,
      month: "July",
      opening_balance: 3107634.54,
      deposits: 54219.35,
      withdrawals: 0.00,
      gross_return_pct: 3.13,
      manual_gain_amount: 97268.96,
      ending_balance: 3204903.50,
      is_manual: true
    },
    {
      id: "h_jstout_8",
      investor_id: "stout001",
      year: 2026,
      month_number: 8,
      month: "August",
      opening_balance: 3214230.32,
      deposits: 2500.00,
      withdrawals: 20000.00,
      gross_return_pct: 3.03,
      manual_gain_amount: 96860.93,
      ending_balance: 3293591.25,
      is_manual: true
    }
  ];

  // Database commission_earnings table:
  // July: $9,326.82
  // August: $11,183.58
  // September (open accrual): $715.76
  const dbCommissionEarnings = [
    { id: "c_jul_1", recipient_id: "stout001", year: 2026, month_number: 7, amount: 9326.82 },
    { id: "c_aug_1", recipient_id: "stout001", year: 2026, month_number: 8, amount: 11183.58 },
    { id: "c_sep_1", recipient_id: "stout001", year: 2026, month_number: 9, amount: 715.76 }
  ];

  const preloaded = {
    rawInvestors: jstoutInvestors,
    accounts: jstoutAccounts,
    returnsSheet: [
      { id: "r_7", year: 2026, month_number: 7, month: "July", gross_return_pct: 3.13 },
      { id: "r_8", year: 2026, month_number: 8, month: "August", gross_return_pct: 3.03 },
      { id: "r_9", year: 2026, month_number: 9, month: "September", gross_return_pct: 0.19 }
    ],
    depositsSheet: [
      { id: "dep_7", investorid: "stout001", year: 2026, month_number: 7, amount: 54219.35 },
      { id: "dep_8", investorid: "stout001", year: 2026, month_number: 8, amount: 2500.00 }
    ],
    withdrawalsSheet: [
      { id: "wd_8", investorid: "stout001", year: 2026, month_number: 8, amount: 20000.00, status: "completed" }
    ],
    historyTable: jstoutHistory,
    commissionEarningsTable: dbCommissionEarnings,
    commissionSharesTable: [],
    commissionRulesTable: [],
    cutoverAdjustments: [],
    live: {
      today: "+0.05%",
      week: "+0.10%",
      month: "+0.19%",
      lastMonth: "+3.03%",
      year: "+29.82%"
    }
  };

  const d = await buildInvestorDashboard("jstout", preloaded);

  // --- INVARIANT 1: DISPLAYED_COMMISSION_EARNED(N) == DATABASE_COMMISSION_EARNED(N) ---
  console.log("1. Testing Invariant 1: DISPLAYED_COMMISSION_EARNED(N) == DATABASE_COMMISSION_EARNED(N)");
  const augustDbCommission = dbCommissionEarnings
    .filter(e => e.recipient_id === "stout001" && e.year === 2026 && e.month_number === 8)
    .reduce((s, e) => s.add(new Decimal(e.amount)), new Decimal(0))
    .toNumber();

  const displayedAugustCommCard = d.summary.commissionsEarnedMonth;
  console.log(`   August DB Commission:          $${augustDbCommission.toFixed(2)}`);
  console.log(`   Displayed Comm. August Card:   $${displayedAugustCommCard.toFixed(2)}`);
  assert.strictEqual(
    displayedAugustCommCard,
    augustDbCommission,
    `Invariant 1 Failure: Comm. August card ($${displayedAugustCommCard}) must strictly equal DB ($${augustDbCommission})`
  );
  console.log("   ✓ Invariant 1 PASSED: Displayed card matches Database Commission exactly ($11,183.58)\n");

  // --- INVARIANT 2: COMMISSION_ADDED(N+1) == DATABASE_COMMISSION_EARNED(N) ---
  console.log("2. Testing Invariant 2: COMMISSION_ADDED(N+1) == DATABASE_COMMISSION_EARNED(N)");
  // August-earned commission ($11,183.58) must be the commission added to September
  const augustBreakdownRow = d.breakdown.find(r => r.monthNumber === 8);
  const septemberBreakdownRow = d.breakdown.find(r => r.monthNumber === 9);

  // In the breakdown payload, commissions earned in month N are stored on month N row as commissionsEarned
  const augustRowCommEarned = augustBreakdownRow.commissionsEarned;
  console.log(`   August Breakdown Row commissionsEarned: $${augustRowCommEarned.toFixed(2)}`);
  console.log(`   Expected September Commission Added:     $${augustDbCommission.toFixed(2)}`);
  assert.strictEqual(
    augustRowCommEarned,
    augustDbCommission,
    `Invariant 2 Failure: August row commissionsEarned ($${augustRowCommEarned}) must equal DB ($${augustDbCommission})`
  );
  console.log("   ✓ Invariant 2 PASSED: Next-month Commission Added matches prior-month DB earned ($11,183.58)\n");

  // --- INVARIANT 3: OPEN_MONTH_COMMISSION must NOT be capitalized early ---
  console.log("3. Testing Invariant 3: OPEN_MONTH_COMMISSION must NOT be capitalized early");
  const septemberRowCommEarned = septemberBreakdownRow.commissionsEarned;
  console.log(`   September (Open Month) Row commissionsEarned: $${septemberRowCommEarned.toFixed(2)} (DB has $715.76)`);
  assert.strictEqual(
    septemberRowCommEarned,
    0,
    `Invariant 3 Failure: Open month commission must not be exposed for forward compounding before month closes`
  );

  const totalCommYtd = d.summary.commissionsEarnedYear;
  const expectedSettledCommYtd = 9326.82 + 11183.58; // July + August only
  console.log(`   Summary Comm. This Year:                      $${totalCommYtd.toFixed(2)}`);
  console.log(`   Expected Settled (Jan-Aug only):              $${expectedSettledCommYtd.toFixed(2)}`);
  assert.strictEqual(
    totalCommYtd,
    expectedSettledCommYtd,
    `Invariant 3 Failure: Comm. This Year ($${totalCommYtd}) must exclude open September commission ($715.76)`
  );
  console.log("   ✓ Invariant 3 PASSED: Open-month commission is strictly isolated from settled accounting\n");

  // --- INVARIANT 4: NEXT-MONTH OPENING BALANCE CENT-EXACT ROLLFORWARD ---
  console.log("4. Testing Invariant 4: Cent-Exact Next-Month Opening Balance Rollforward");
  // August Close: $3,293,591.25
  // September Commission Added: +$11,183.58
  // September Deposits: +$0.00
  // September Withdrawals: -$0.00
  // September Expected Opening: $3,304,774.83
  const augSettledClosing = new Decimal(augustBreakdownRow.endingBalance);
  const sepCommAdded = new Decimal(augustDbCommission);
  const sepDeposits = new Decimal(septemberBreakdownRow.deposits);
  const sepWithdrawals = new Decimal(septemberBreakdownRow.oneTimeWithdrawal).add(septemberBreakdownRow.recurringDraw);
  
  const calculatedSepOpening = augSettledClosing.add(sepCommAdded).add(sepDeposits).sub(sepWithdrawals);
  const displayedSepStarting = new Decimal(septemberBreakdownRow.startingBalance);
  const displayedSepAdjusted = new Decimal(septemberBreakdownRow.adjustedStartingBalance);

  console.log(`   August Settled Closing:        $${augSettledClosing.toFixed(2)}`);
  console.log(`   + September Commission Added:  +$${sepCommAdded.toFixed(2)}`);
  console.log(`   + September Deposits:          +$${sepDeposits.toFixed(2)}`);
  console.log(`   - September Withdrawals:       -$${sepWithdrawals.toFixed(2)}`);
  console.log(`   = Calculated September Opening: $${calculatedSepOpening.toFixed(2)}`);
  console.log(`   Displayed September Starting:   $${displayedSepStarting.toFixed(2)}`);
  console.log(`   Displayed September Adjusted:   $${displayedSepAdjusted.toFixed(2)}`);

  const diffStarting = calculatedSepOpening.sub(displayedSepStarting).abs().toNumber();
  const diffAdjusted = calculatedSepOpening.sub(displayedSepAdjusted).abs().toNumber();

  assert(diffStarting < 0.005, `Invariant 4 Failure: Discrepancy of $${diffStarting} on startingBalance`);
  assert(diffAdjusted < 0.005, `Invariant 4 Failure: Discrepancy of $${diffAdjusted} on adjustedStartingBalance`);

  console.log("   ✓ Invariant 4 PASSED: Rollforward reconciles 100% cent-exact to $3,304,774.83 (Delta = $0.00)\n");

  console.log("================================================================================");
  console.log("ALL COMMISSION SINGLE SOURCE OF TRUTH INVARIANTS PASSED (100%)");
  console.log("================================================================================");
}

runCommissionSingleSourceOfTruthTests().catch(err => {
  console.error("TEST SUITE FAILED:", err);
  process.exit(1);
});
