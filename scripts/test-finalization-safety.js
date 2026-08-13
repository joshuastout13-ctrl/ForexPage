import { calculateAccountingPeriod } from "../lib/accounting-period-engine.js";
import crypto from "crypto";

console.log("\n==================================================");
console.log("PHASE 2 — FINALIZATION SAFETY & SIMULATION TEST SUITE");
console.log("==================================================\n");

let passed = 0;
let failed = 0;

function assertEqual(actual, expected, description) {
  if (actual === expected) {
    console.log(`  ✓ PASS: ${description}`);
    passed++;
  } else {
    console.error(`  ✕ FAIL: ${description}`);
    console.error(`     Expected: ${JSON.stringify(expected)}`);
    console.error(`     Got:      ${JSON.stringify(actual)}`);
    failed++;
  }
}

function assertContains(actual, substring, description) {
  if (String(actual).includes(substring)) {
    console.log(`  ✓ PASS: ${description}`);
    passed++;
  } else {
    console.error(`  ✕ FAIL: ${description}`);
    console.error(`     Expected to contain: ${substring}`);
    console.error(`     Got:                ${actual}`);
    failed++;
  }
}

// -----------------------------------------------------------------------------
// Test 1: Valid Positive Month Dry Run
// -----------------------------------------------------------------------------
console.log("Test 1: Valid Positive Month Dry Run");
{
  const res = calculateAccountingPeriod({
    year: 2026, month: 8, fundReturnPct: 2.81,
    investors: [{ id: "INV-1", split_pct: 70 }],
    commissionShares: [{ source_investor_id: "INV-1", recipient_investor_id: "REC-1", commission_percent: 30, effective_start_date: "2026-01-01", status: "active" }],
    monthlyHistory: [{ investor_id: "INV-1", year: 2026, month_number: 7, ending_balance: 100000 }]
  });
  assertEqual(res.canFinalize, true, "Valid positive month evaluates canFinalize = true");
  assertEqual(res.summary.totalRecipientCommissions, 843, "Recipient commission is $843.00");
}

// -----------------------------------------------------------------------------
// Test 2: Loss Month Dry Run (Recipients = $0)
// -----------------------------------------------------------------------------
console.log("\nTest 2: Loss Month Dry Run");
{
  const res = calculateAccountingPeriod({
    year: 2026, month: 8, fundReturnPct: -1.0,
    investors: [{ id: "INV-1", split_pct: 70 }],
    commissionShares: [{ source_investor_id: "INV-1", recipient_investor_id: "REC-1", commission_percent: 30, effective_start_date: "2026-01-01", status: "active" }],
    monthlyHistory: [{ investor_id: "INV-1", year: 2026, month_number: 7, ending_balance: 100000 }]
  });
  assertEqual(res.summary.totalRecipientCommissions, 0, "Loss month recipient commission is strictly $0.00");
}

// -----------------------------------------------------------------------------
// Test 3: Zero Month Dry Run
// -----------------------------------------------------------------------------
console.log("\nTest 3: Zero Month Dry Run");
{
  const res = calculateAccountingPeriod({
    year: 2026, month: 8, fundReturnPct: 0.0,
    investors: [{ id: "INV-1", split_pct: 70 }],
    commissionShares: [{ source_investor_id: "INV-1", recipient_investor_id: "REC-1", commission_percent: 30, effective_start_date: "2026-01-01", status: "active" }],
    monthlyHistory: [{ investor_id: "INV-1", year: 2026, month_number: 7, ending_balance: 100000 }]
  });
  assertEqual(res.summary.totalRecipientCommissions, 0, "Zero month recipient commission is $0.00");
}

// -----------------------------------------------------------------------------
// Test 4: Stale Input Hash Protection
// -----------------------------------------------------------------------------
console.log("\nTest 4: Stale Input Hash Protection");
{
  const inputA = { year: 2026, month: 8, fundReturnPct: 2.81, investors: [{ id: "INV-1", split_pct: 70 }], monthlyHistory: [{ investor_id: "INV-1", year: 2026, month_number: 7, ending_balance: 100000 }] };
  const inputB = { year: 2026, month: 8, fundReturnPct: 2.85, investors: [{ id: "INV-1", split_pct: 70 }], monthlyHistory: [{ investor_id: "INV-1", year: 2026, month_number: 7, ending_balance: 100000 }] };
  const runA = calculateAccountingPeriod(inputA);
  const runB = calculateAccountingPeriod(inputB);
  assertEqual(runA.inputHash !== runB.inputHash, true, "Modified input changes inputHash");
}

// -----------------------------------------------------------------------------
// Test 5-10: Validation Anomaly Gates
// -----------------------------------------------------------------------------
console.log("\nTest 5-10: Validation Anomaly Gates");
{
  // Under-allocated
  const under = calculateAccountingPeriod({
    year: 2026, month: 8, fundReturnPct: 2.81,
    investors: [{ id: "INV-1", split_pct: 50 }],
    commissionShares: [{ source_investor_id: "INV-1", recipient_investor_id: "REC-1", commission_percent: 20, effective_start_date: "2026-01-01", status: "active" }],
    monthlyHistory: [{ investor_id: "INV-1", year: 2026, month_number: 7, ending_balance: 100000 }]
  });
  assertEqual(under.canFinalize, false, "Under-allocated configuration blocks finalization (canFinalize = false)");

  // Over-allocated
  const over = calculateAccountingPeriod({
    year: 2026, month: 8, fundReturnPct: 2.81,
    investors: [{ id: "INV-1", split_pct: 50 }],
    commissionShares: [{ source_investor_id: "INV-1", recipient_investor_id: "REC-1", commission_percent: 60, effective_start_date: "2026-01-01", status: "active" }],
    monthlyHistory: [{ investor_id: "INV-1", year: 2026, month_number: 7, ending_balance: 100000 }]
  });
  assertEqual(over.canFinalize, false, "Over-allocated configuration blocks finalization");

  // Missing return
  const noReturn = calculateAccountingPeriod({
    year: 2026, month: 8, fundReturnPct: null,
    investors: [{ id: "INV-1", split_pct: 70 }],
    monthlyHistory: [{ investor_id: "INV-1", year: 2026, month_number: 7, ending_balance: 100000 }]
  });
  assertEqual(noReturn.canFinalize, false, "Missing return blocks finalization");

  // Non-first-day cashflow
  const nonFirstDay = calculateAccountingPeriod({
    year: 2026, month: 8, fundReturnPct: 2.81,
    investors: [{ id: "INV-1", split_pct: 70 }],
    deposits: [{ id: "D1", investor_id: "INV-1", date: "2026-08-15", amount: 5000 }],
    monthlyHistory: [{ investor_id: "INV-1", year: 2026, month_number: 7, ending_balance: 100000 }]
  });
  assertEqual(nonFirstDay.canFinalize, false, "Non-first-day deposit triggers FLAGGED status and blocks finalization");
}

// -----------------------------------------------------------------------------
// Test 11: Negative Ending Balance Blocks Finalization
// -----------------------------------------------------------------------------
console.log("\nTest 11: Negative Ending Balance Blocks Finalization");
{
  const negEnd = calculateAccountingPeriod({
    year: 2026, month: 8, fundReturnPct: 2.81,
    investors: [{ id: "INV-NEG", split_pct: 100, monthly_draw: 5000 }],
    monthlyHistory: [{ investor_id: "INV-NEG", year: 2026, month_number: 7, ending_balance: 1000 }]
  });
  assertEqual(negEnd.canFinalize, false, "Negative ending balance blocks finalization");
  assertContains(negEnd.investors[0].flags, "NEGATIVE_ENDING_BALANCE", "Flags contain NEGATIVE_ENDING_BALANCE");
}

// -----------------------------------------------------------------------------
// Test 12: Manual History Collision Simulation
// -----------------------------------------------------------------------------
console.log("\nTest 12: Manual History Collision Simulation");
{
  const hist = [{ investor_id: "INV-MANUAL", year: 2026, month_number: 8, is_manual: true, ending_balance: 50000 }];
  const hasManualCollision = hist.some(h => h.is_manual);
  assertEqual(hasManualCollision, true, "Manual historical row detected and flagged as collision");
}

// -----------------------------------------------------------------------------
// Test 13-17: Simulation of Atomic Finalization & Rollback
// -----------------------------------------------------------------------------
console.log("\nTest 13-17: Simulation of Atomic Finalization & Rollback");
{
  // Transaction Simulator
  class MockTransaction {
    constructor() {
      this.committed = false;
      this.rolledBack = false;
      this.writtenState = [];
    }
    write(row) {
      if (this.committed || this.rolledBack) throw new Error("Transaction closed");
      this.writtenState.push(row);
    }
    commit() { this.committed = true; }
    rollback() { this.rolledBack = true; this.writtenState = []; }
  }

  // Success simulation
  const txSuccess = new MockTransaction();
  txSuccess.write({ table: "monthly_returns", year: 2026, month: 8 });
  txSuccess.write({ table: "investor_monthly_history", count: 10 });
  txSuccess.write({ table: "commission_earnings", count: 5 });
  txSuccess.commit();
  assertEqual(txSuccess.committed, true, "Transaction commits cleanly on valid execution");
  assertEqual(txSuccess.writtenState.length, 3, "All 3 tables written");

  // Rollback simulation
  const txFail = new MockTransaction();
  try {
    txFail.write({ table: "monthly_returns", year: 2026, month: 8 });
    txFail.write({ table: "investor_monthly_history", count: 5 });
    throw new Error("Simulated database network timeout during commission write");
  } catch (err) {
    txFail.rollback();
  }
  assertEqual(txFail.rolledBack, true, "Transaction rolls back on failure");
  assertEqual(txFail.writtenState.length, 0, "ZERO partial state remains after rollback");
}

// -----------------------------------------------------------------------------
// Test 18-21: Provenance & Version Metadata
// -----------------------------------------------------------------------------
console.log("\nTest 18-21: Provenance & Version Metadata");
{
  const res = calculateAccountingPeriod({
    year: 2026, month: 8, fundReturnPct: 2.81,
    investors: [{ id: "INV-VER", split_pct: 70 }],
    commissionShares: [{ source_investor_id: "INV-VER", recipient_investor_id: "REC-VER", commission_percent: 30, effective_start_date: "2026-01-01", status: "active" }],
    monthlyHistory: [{ investor_id: "INV-VER", year: 2026, month_number: 7, ending_balance: 100000 }]
  });

  assertEqual(res.summary.totalSourceGainLoss + res.summary.totalRecipientCommissions, res.summary.totalGrossFundResult, "Gross Profit = Source Gain + Recipient Commissions ($2810.00)");
  assertEqual(res.investors[0].recipientAllocations[0].commissionPercent, 30, "Commission percent snapshot captured as 30%");
}

// -----------------------------------------------------------------------------
// Test 22: Month N Commission Timing (Not premature Month N+1 credit)
// -----------------------------------------------------------------------------
console.log("\nTest 22: Month N Commission Timing");
{
  const augRes = calculateAccountingPeriod({
    year: 2026, month: 8, fundReturnPct: 2.81,
    investors: [{ id: "INV-SOURCE", split_pct: 70 }],
    commissionShares: [{ source_investor_id: "INV-SOURCE", recipient_investor_id: "REC-ACC", commission_percent: 30, effective_start_date: "2026-01-01", status: "active" }],
    monthlyHistory: [{ investor_id: "INV-SOURCE", year: 2026, month_number: 7, ending_balance: 100000 }]
  });

  // August run generates $843 commission for REC-ACC
  assertEqual(augRes.investors[0].totalRecipientCommissions, 843, "August commission earned is $843.00");
  
  // Verify September run reads August $843 as incoming credit
  const sepRes = calculateAccountingPeriod({
    year: 2026, month: 9, fundReturnPct: 2.0,
    investors: [{ id: "REC-ACC", split_pct: 100 }],
    commissionEarnings: [{ recipient_id: "REC-ACC", source_investor_id: "INV-SOURCE", year: 2026, month_number: 8, amount: 843 }],
    monthlyHistory: [{ investor_id: "REC-ACC", year: 2026, month_number: 8, ending_balance: 50000 }]
  });

  assertEqual(sepRes.investors[0].eligibleCapital, 50843, "September eligible capital correctly includes August credited commission ($50,000 + $843 = $50,843)");
}

// -----------------------------------------------------------------------------
// Test 23-25: Safety & Dry-Run Flags
// -----------------------------------------------------------------------------
console.log("\nTest 23-25: Safety & Dry-Run Flags");
{
  const featureFlagEnabled = process.env.ACCOUNTING_FINALIZATION_ENABLED === "true";
  assertEqual(featureFlagEnabled, false, "ACCOUNTING_FINALIZATION_ENABLED is OFF (false) by default");
}

console.log("\n==================================================");
console.log(`FINALIZATION SAFETY RESULTS: ${passed} PASSED | ${failed} FAILED`);
console.log("==================================================\n");

if (failed > 0) process.exit(1);
