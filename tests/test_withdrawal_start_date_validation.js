import assert from "node:assert";
import Decimal from "decimal.js";
import { calculateAvailableWithdrawalEquity } from "../lib/withdrawal-validation.js";

console.log("===============================================================================");
console.log("FOREXPAGE — WITHDRAWAL START-DATE & ACCOUNTING ELIGIBILITY TEST SUITE");
console.log("===============================================================================\n");

let passed = 0;
let failed = 0;

function pass(desc) {
  console.log(`✅ PASS: ${desc}`);
  passed++;
}

function fail(desc, err) {
  console.error(`❌ FAIL: ${desc}`);
  console.error(err);
  failed++;
}

async function runSuite() {
  // Mock fixture matching Mark Richards production profile
  const mockMarkPreloaded = {
    rawInvestors: [{
      id: "inv_f797f3fe",
      portal_username: "mrichards",
      start_date: "2026-05-01",
      active: true,
      split_pct: 100,
      monthly_draw: 0
    }],
    accounts: [{
      id: "mrichards",
      investor_id: "inv_f797f3fe",
      starting_capital: 430160.69,
      open_date: "2026-01-01", // Mismatch with start_date
      status: "Active"
    }],
    historyTable: [
      { id: "h_may", investor_id: "inv_f797f3fe", year: 2026, month_number: 5, ending_balance: 443624.72 },
      { id: "h_jun", investor_id: "inv_f797f3fe", year: 2026, month_number: 6, ending_balance: 443624.72 },
      { id: "h_jul", investor_id: "inv_f797f3fe", year: 2026, month_number: 7, ending_balance: 443624.72 },
      { id: "h_aug", investor_id: "inv_f797f3fe", year: 2026, month_number: 8, ending_balance: 401624.72 }
    ],
    depositsSheet: [],
    withdrawalsSheet: [],
    commissionEarningsTable: []
  };

  // Test 1: Mark April (Pre-Start) -> availableEquity must be strictly 0.00
  try {
    const res = await calculateAvailableWithdrawalEquity("inv_f797f3fe", "2026-04-01", {
      preloadedData: mockMarkPreloaded
    });
    assert.strictEqual(res.availableEquity, 0, "Pre-start availableEquity must be 0");
    assert.strictEqual(res.details.isPreStart, true, "Must flag isPreStart");
    pass("1. Mark Richards April 2026 (pre-start) returns strictly $0.00 available equity");
  } catch (err) {
    fail("1. Mark Richards April pre-start check", err);
  }

  // Test 2: Mark May (Initial Period) -> availableEquity equals starting capital
  try {
    const res = await calculateAvailableWithdrawalEquity("inv_f797f3fe", "2026-05-01", {
      preloadedData: mockMarkPreloaded
    });
    assert.strictEqual(res.availableEquity, 430160.69, "Initial period availableEquity must match starting capital");
    pass("2. Mark Richards May 2026 (first period) returns starting capital ($430,160.69)");
  } catch (err) {
    fail("2. Mark Richards May initial period check", err);
  }

  // Test 3: Mark September (Prospective Month) -> availableEquity equals August ending ($401,624.72)
  try {
    const res = await calculateAvailableWithdrawalEquity("inv_f797f3fe", "2026-09-01", {
      preloadedData: mockMarkPreloaded
    });
    assert.strictEqual(res.availableEquity, 401624.72, "Prospective September availableEquity must match August ending");
    pass("3. Mark Richards September 2026 returns full settled equity ($401,624.72) without start date conflict exception");
  } catch (err) {
    fail("3. Mark Richards September prospective check", err);
  }

  // Mock fixture matching Ted Boardwalk profile
  const mockTedPreloaded = {
    rawInvestors: [{
      id: "inv_a79798ca",
      portal_username: "tboardwalk",
      start_date: "2026-01-01",
      active: true,
      split_pct: 66.6,
      monthly_draw: 0
    }],
    accounts: [{
      id: "tboardwalk",
      investor_id: "inv_a79798ca",
      starting_capital: 17.19,
      open_date: "2026-01-01",
      status: "Active"
    }],
    historyTable: [
      { id: "h_ted_aug", investor_id: "inv_a79798ca", year: 2026, month_number: 8, ending_balance: 384.56 }
    ],
    depositsSheet: [],
    withdrawalsSheet: [],
    commissionEarningsTable: []
  };

  // Test 4: Ted Boardwalk September -> Available equity is $384.56, cannot cover $1,100
  try {
    const res = await calculateAvailableWithdrawalEquity("inv_a79798ca", "2026-09-01", {
      preloadedData: mockTedPreloaded
    });
    assert.strictEqual(res.availableEquity, 384.56, "Ted available equity must be $384.56");
    assert(res.availableEquity < 1100.00, "$1,100 must exceed available equity");
    pass("4. Ted Boardwalk September available equity ($384.56) is accurately evaluated and prevents overdrawing $1,100.00");
  } catch (err) {
    fail("4. Ted Boardwalk overdraw check", err);
  }

  // Mock fixture matching Jeremy Evans (August onboarding)
  const mockJeremyPreloaded = {
    rawInvestors: [{
      id: "inv_6ba53bbe",
      portal_username: "jevans",
      start_date: "2026-08-01",
      active: true,
      split_pct: 50,
      monthly_draw: 0
    }],
    accounts: [{
      id: "jevans",
      investor_id: "inv_6ba53bbe",
      starting_capital: 947592.99,
      open_date: "2026-01-01", // Mismatched legacy default
      status: "Active"
    }],
    historyTable: [
      { id: "h_jevans_aug", investor_id: "inv_6ba53bbe", year: 2026, month_number: 8, ending_balance: 947592.99 }
    ],
    depositsSheet: [],
    withdrawalsSheet: [],
    commissionEarningsTable: []
  };

  // Test 5: Jeremy Evans July (Pre-start) -> 0.00
  try {
    const res = await calculateAvailableWithdrawalEquity("inv_6ba53bbe", "2026-07-01", {
      preloadedData: mockJeremyPreloaded
    });
    assert.strictEqual(res.availableEquity, 0, "July pre-start must be 0");
    pass("5. Jeremy Evans July 2026 (pre-start) returns strictly $0.00");
  } catch (err) {
    fail("5. Jeremy Evans July check", err);
  }

  // Test 6: Jeremy Evans September (Prospective) -> $947,592.99
  try {
    const res = await calculateAvailableWithdrawalEquity("inv_6ba53bbe", "2026-09-01", {
      preloadedData: mockJeremyPreloaded
    });
    assert.strictEqual(res.availableEquity, 947592.99, "September availableEquity must match August ending");
    pass("6. Jeremy Evans September 2026 returns $947,592.99 without start date conflict exception");
  } catch (err) {
    fail("6. Jeremy Evans September check", err);
  }

  console.log("\n===============================================================================");
  console.log(`TEST SUMMARY: ${passed} PASSED / ${failed} FAILED`);
  console.log("===============================================================================\n");

  if (failed > 0) process.exit(1);
}

runSuite();
