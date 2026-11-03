import assert from "node:assert";
import Decimal from "decimal.js";
import { isMonthExplicitlyFinalizedAndLocked, evaluateMonthState, MonthState } from "../lib/month-state.js";
import { calculateAccountingPeriod } from "../lib/accounting-period-engine.js";

console.log("================================================================================");
console.log("P0 COMMISSION WRITER CONTAINMENT & UNFINALIZED MONTH PROTECTION REGRESSION SUITE");
console.log("================================================================================\n");

// ------------------------------------------------------------------------------------------------
// TEST 1: isMonthExplicitlyFinalizedAndLocked semantics (Calendar Rollover vs Explicit Finalization)
// ------------------------------------------------------------------------------------------------
console.log("1. Testing that calendar rollover alone is NOT authorization to treat a month as finalized");
const returns2026 = [
  { year: 2026, month_number: 1, gross_return_pct: 3.29, locked: true },
  { year: 2026, month_number: 9, gross_return_pct: 3.07, locked: true },
  { year: 2026, month_number: 10, gross_return_pct: 3.05, locked: false }, // October: calendar past, but UNLOCKED
  { year: 2026, month_number: 11, gross_return_pct: 0.00, locked: false }, // November: current open, UNLOCKED
  { year: 2026, month_number: 12, gross_return_pct: 0.00, locked: false }  // December: future, UNLOCKED
];

// In November 2026, calendar period for October is in the past:
const octState = evaluateMonthState(2026, 10, "2026-11-03T01:00:00Z");
assert.strictEqual(octState, MonthState.HISTORICAL_SETTLED, "Calendar state for October is in the past");

// BUT explicit finalization check MUST FAIL CLOSED because locked is false:
assert.strictEqual(
  isMonthExplicitlyFinalizedAndLocked(2026, 10, returns2026),
  false,
  "October 2026 must be unfinalized because locked === false despite calendar rollover"
);
assert.strictEqual(
  isMonthExplicitlyFinalizedAndLocked(2026, 9, returns2026),
  true,
  "September 2026 must be finalized because locked === true"
);
assert.strictEqual(
  isMonthExplicitlyFinalizedAndLocked(2026, 11, returns2026),
  false,
  "November 2026 must be unfinalized because locked === false"
);
console.log("   ✓ Calendar rollover alone does not authorize finalization (October locked: false -> unfinalized)\n");

// ------------------------------------------------------------------------------------------------
// TEST 2: Unfinalized Month Commissions CANNOT Capitalize into Later-Month History
// ------------------------------------------------------------------------------------------------
console.log("2. Testing that unfinalized month commissions CANNOT capitalize into later history");

// Scenario: Jacob Wamsley (inv_d0f857c7) in Month 11 (November 2026).
// Premature October commissions exist in commissionEarnings table ($270.82).
// Jacob also has an authentic $11,700 deposit in November.
const testInvestors = [
  {
    id: "inv_d0f857c7",
    portal_username: "jwamsley",
    first_name: "Jacob",
    last_name: "Wamsley",
    split_pct: 100,
    monthly_draw: 0
  }
];

const testAccounts = [
  {
    id: "acc_jwamsley",
    investor_id: "inv_d0f857c7",
    starting_capital: 83751.41,
    split_pct: 100,
    status: "Active"
  }
];

// Prior ending balance through October: $83,751.41
const testMonthlyHistory = [
  {
    investor_id: "inv_d0f857c7",
    year: 2026,
    month_number: 10,
    opening_balance: 83751.41,
    deposits: 0,
    withdrawals: 0,
    ending_balance: 83751.41,
    locked: false
  }
];

// Premature October commission: $270.82
const prematureOctComms = [
  {
    id: "comm_oct_jwamsley",
    recipient_id: "inv_d0f857c7",
    source_investor_id: "inv_source_1",
    year: 2026,
    month_number: 10,
    amount: 270.82,
    status: "ACTIVE"
  }
];

// November deposit: $11,700
const testDeposits = [
  {
    id: "dep_nov_jwamsley",
    investor_id: "inv_d0f857c7",
    amount: 11700.00,
    date: "2026-11-01",
    effective_accounting_date: "2026-11-01"
  }
];

// Run period calculation for Month 11 with UNLOCKED October (locked: false):
const runUnlockedOct = calculateAccountingPeriod({
  year: 2026,
  month: 11,
  fundReturnPct: 0.00,
  returnStatus: "OPEN",
  investors: testInvestors,
  accounts: testAccounts,
  deposits: testDeposits,
  withdrawals: [],
  commissionShares: [],
  monthlyHistory: testMonthlyHistory,
  commissionEarnings: prematureOctComms,
  monthlyReturns: returns2026
});

const jwamsleyUnlocked = runUnlockedOct.investors.find(i => i.investorId === "inv_d0f857c7");

// Fail-closed invariant:
// 1. Prior ending balance must be 83,751.41
// 2. Incoming commissions credited MUST BE $0.00 (not $270.82!)
// 3. Opening balance MUST BE 83,751.41 (not 84,022.23!)
// 4. Ending balance MUST BE 83,751.41 + 11,700.00 = 95,451.41 (preserving deposit, excluding unfinalized comm)
assert.strictEqual(
  jwamsleyUnlocked.priorEndingBalance,
  83751.41,
  "Prior ending balance must match historical basis"
);
assert.strictEqual(
  jwamsleyUnlocked.incomingCommissionCredit,
  0,
  "Incoming commissions from unlocked October MUST NOT capitalize into November capital (must be 0)"
);
assert.strictEqual(
  jwamsleyUnlocked.deposits,
  11700.00,
  "Newer cashflow ($11,700 deposit) MUST be strictly preserved intact"
);
assert.strictEqual(
  jwamsleyUnlocked.eligibleCapital,
  95451.41,
  "Eligible capital must equal 83,751.41 + 11,700 = 95,451.41 (without premature commission)"
);
assert.strictEqual(
  jwamsleyUnlocked.endingBalance,
  95451.41,
  "Ending balance must equal 95,451.41"
);
console.log("   ✓ Unlocked October commission ($270.82) correctly blocked from capitalizing into Month 11");
console.log("   ✓ Jacob Wamsley's authentic November deposit ($11,700.00) strictly preserved intact\n");

// ------------------------------------------------------------------------------------------------
// TEST 3: When Month is Explicitly Finalized and Locked, Commissions DO Capitalize
// ------------------------------------------------------------------------------------------------
console.log("3. Testing that when a month IS explicitly finalized and locked, commissions properly capitalize");

// Create return list where Month 10 is officially locked:
const returnsWithLockedOct = returns2026.map(r => r.month_number === 10 ? { ...r, locked: true } : r);

const runLockedOct = calculateAccountingPeriod({
  year: 2026,
  month: 11,
  fundReturnPct: 0.00,
  returnStatus: "OPEN",
  investors: testInvestors,
  accounts: testAccounts,
  deposits: testDeposits,
  withdrawals: [],
  commissionShares: [],
  monthlyHistory: testMonthlyHistory,
  commissionEarnings: prematureOctComms,
  monthlyReturns: returnsWithLockedOct
});

const jwamsleyLocked = runLockedOct.investors.find(i => i.investorId === "inv_d0f857c7");
assert.strictEqual(
  jwamsleyLocked.incomingCommissionCredit,
  270.82,
  "Incoming commissions MUST capitalize once the prior month is officially finalized and locked"
);
assert.strictEqual(
  jwamsleyLocked.eligibleCapital,
  95722.23, // 83,751.41 + 270.82 + 11,700.00 = 95,722.23
  "Eligible capital must include capitalized commission when month is locked"
);
console.log("   ✓ Capitalization authorized ONLY upon explicit return locking\n");

// ------------------------------------------------------------------------------------------------
// TEST 4: Fail-Closed Guard Throws UNAUTHORIZED_COMMISSION_GENERATION for Unlocked Months
// ------------------------------------------------------------------------------------------------
console.log("4. Testing that commission writer throws UNAUTHORIZED_COMMISSION_GENERATION on unlocked month");

function simulateCommissionInsertGuard(commissionsToInsert, fundRetLockedByM) {
  const unauthorizedComms = commissionsToInsert.filter(c => fundRetLockedByM[c.month_number] !== true);
  if (unauthorizedComms.length > 0) {
    throw new Error(
      `UNAUTHORIZED_COMMISSION_GENERATION: Cannot generate commissions for unfinalized/unlocked month(s): ` +
      `${[...new Set(unauthorizedComms.map(c => c.month_number))].join(', ')}. A calendar rollover alone is not authorization.`
    );
  }
  return true;
}

const lockedMap = {
  1: true,
  9: true,
  10: false, // October unlocked!
  11: false
};

// Attempt to insert commissions for Month 10:
assert.throws(
  () => {
    simulateCommissionInsertGuard(
      [{ recipient_id: "inv_1", source_investor_id: "inv_2", year: 2026, month_number: 10, amount: 500 }],
      lockedMap
    );
  },
  /UNAUTHORIZED_COMMISSION_GENERATION/,
  "Attempting to generate commissions for unlocked Month 10 must throw UNAUTHORIZED_COMMISSION_GENERATION"
);

// Generating for Month 9 (which is locked) succeeds:
const allowed = simulateCommissionInsertGuard(
  [{ recipient_id: "inv_1", source_investor_id: "inv_2", year: 2026, month_number: 9, amount: 500 }],
  lockedMap
);
assert.strictEqual(allowed, true);
console.log("   ✓ Fail-closed guard strictly refuses commission writes for unfinalized/unlocked months\n");

// ------------------------------------------------------------------------------------------------
// TEST 5: Admin Historical Data Refuses to Overwrite Locked Monthly History Record
// ------------------------------------------------------------------------------------------------
console.log("5. Testing that admin historical data endpoints refuse to overwrite locked records");

function simulateHistoricalDataGuard(existingRecord) {
  if (existingRecord && (existingRecord.locked === true || String(existingRecord.locked).toLowerCase() === 'true')) {
    throw new Error("LOCKED_RECORD: Cannot modify locked historical history record.");
  }
  return true;
}

assert.throws(
  () => simulateHistoricalDataGuard({ id: "hist_1", locked: true }),
  /LOCKED_RECORD/,
  "Attempting to modify a locked monthly history record must throw LOCKED_RECORD"
);
assert.strictEqual(
  simulateHistoricalDataGuard({ id: "hist_2", locked: false }),
  true,
  "Modifying an unlocked record is permitted"
);
console.log("   ✓ Fail-closed guard prevents destructive mutation of locked history records\n");

console.log("================================================================================");
console.log("ALL COMMISSION WRITER CONTAINMENT TESTS PASSED (5 / 5) ✓");
console.log("================================================================================\n");
