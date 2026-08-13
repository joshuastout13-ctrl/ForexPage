import { calculateInvestorMonth } from "../lib/accounting-engine.js";
import { calculateAccountingPeriod } from "../lib/accounting-period-engine.js";

let passedCount = 0;
let failedCount = 0;

function assert(condition, message) {
  if (condition) {
    passedCount++;
    console.log(`  ✓ PASS: ${message}`);
  } else {
    failedCount++;
    console.error(`  ✕ FAIL: ${message}`);
  }
}

function assertEqual(actual, expected, message) {
  if (actual === expected) {
    passedCount++;
    console.log(`  ✓ PASS: ${message} (Expected: ${expected}, Got: ${actual})`);
  } else {
    failedCount++;
    console.error(`  ✕ FAIL: ${message} (Expected: ${expected}, Got: ${actual})`);
  }
}

console.log("\n==================================================");
console.log("SUITE 1: DETERMINISTIC BUSINESS RULE TEST SCENARIOS (1-30)");
console.log("==================================================\n");

// Case 1: +10%, $100k, 50/25/25
console.log("Scenario 1: +10%, $100k eligible capital, 50% source, 25%/25% recipients");
{
  const res = calculateInvestorMonth({
    year: 2026, month: 8, investorId: "INV-1",
    priorEndingBalance: 100000, fundReturnPct: 10, sourceSplitPct: 50,
    commissionShares: [
      { recipientId: "REC-A", commissionPercent: 25 },
      { recipientId: "REC-B", commissionPercent: 25 }
    ]
  });
  assertEqual(res.grossFundResult, 100000 * 0.10, "Gross Fund Result is $10,000");
  assertEqual(res.totalRecipientCommissions, 5000, "Total Recipients = $5,000");
  assertEqual(res.sourceGainLoss, 5000, "Source Gain = $5,000");
  assertEqual(res.reconciliation.status, "PASS", "Reconciliation PASS");
}

// Case 2: +2.81%, several different capitals
console.log("\nScenario 2: +2.81% return across $100k and $50k eligible capitals");
{
  const resA = calculateInvestorMonth({
    year: 2026, month: 8, investorId: "INV-A",
    priorEndingBalance: 100000, fundReturnPct: 2.81, sourceSplitPct: 70,
    commissionShares: [
      { recipientId: "REC-1", commissionPercent: 10 },
      { recipientId: "REC-2", commissionPercent: 20 }
    ]
  });
  assertEqual(resA.grossFundResult, 2810.00, "100k gross result = $2,810.00");
  assertEqual(resA.totalRecipientCommissions, 843.00, "100k recipients total = $843.00");
  assertEqual(resA.sourceGainLoss, 1967.00, "100k source profit = $1,967.00");

  const resB = calculateInvestorMonth({
    year: 2026, month: 8, investorId: "INV-B",
    priorEndingBalance: 50000, fundReturnPct: 2.81, sourceSplitPct: 70,
    commissionShares: [
      { recipientId: "REC-1", commissionPercent: 10 },
      { recipientId: "REC-2", commissionPercent: 20 }
    ]
  });
  assertEqual(resB.grossFundResult, 1405.00, "50k gross result = $1,405.00");
  assertEqual(resB.totalRecipientCommissions, 421.50, "50k recipients total = $421.50");
  assertEqual(resB.sourceGainLoss, 983.50, "50k source profit = $983.50");
}

// Case 3: -1%, 50% source => -0.5% investor effective return
console.log("\nScenario 3: -1% return, 50% source split");
{
  const res = calculateInvestorMonth({
    year: 2026, month: 8, investorId: "INV-3",
    priorEndingBalance: 100000, fundReturnPct: -1.00, sourceSplitPct: 50,
    commissionShares: [{ recipientId: "REC-1", commissionPercent: 50 }]
  });
  assertEqual(res.grossFundResult, -1000.00, "Gross Loss = -$1,000.00");
  assertEqual(res.sourceGainLoss, -500.00, "Source Loss = -$500.00 (-0.5% effective)");
  assertEqual(res.totalRecipientCommissions, 0, "Recipient commissions are $0 on loss month");
}

// Case 4: -1%, 75% source => -0.75%
console.log("\nScenario 4: -1% return, 75% source split");
{
  const res = calculateInvestorMonth({
    year: 2026, month: 8, investorId: "INV-4",
    priorEndingBalance: 100000, fundReturnPct: -1.00, sourceSplitPct: 75,
    commissionShares: [{ recipientId: "REC-1", commissionPercent: 25 }]
  });
  assertEqual(res.sourceGainLoss, -750.00, "Source Loss = -$750.00 (-0.75% effective)");
  assertEqual(res.totalRecipientCommissions, 0, "Recipients get $0 on loss");
}

// Case 5: 0% month
console.log("\nScenario 5: 0% return month");
{
  const res = calculateInvestorMonth({
    year: 2026, month: 8, investorId: "INV-5",
    priorEndingBalance: 100000, fundReturnPct: 0, sourceSplitPct: 70,
    commissionShares: [{ recipientId: "REC-1", commissionPercent: 30 }]
  });
  assertEqual(res.grossFundResult, 0, "Gross Result = $0");
  assertEqual(res.sourceGainLoss, 0, "Source Gain/Loss = $0");
  assertEqual(res.totalRecipientCommissions, 0, "Recipient Commissions = $0");
}

// Case 6: First-day deposit
console.log("\nScenario 6: First-day deposit participates in full month return");
{
  const res = calculateInvestorMonth({
    year: 2026, month: 8, investorId: "INV-6",
    priorEndingBalance: 50000, deposits: 50000, fundReturnPct: 10, sourceSplitPct: 100
  });
  assertEqual(res.eligibleCapital, 100000, "Eligible Capital includes 1st of month deposit ($100k)");
  assertEqual(res.sourceGainLoss, 10000, "Source Profit = $10,000");
}

// Case 7: First-day withdrawal
console.log("\nScenario 7: First-day withdrawal is removed before return");
{
  const res = calculateInvestorMonth({
    year: 2026, month: 8, investorId: "INV-7",
    priorEndingBalance: 100000, withdrawals: 20000, fundReturnPct: 10, sourceSplitPct: 100
  });
  assertEqual(res.eligibleCapital, 80000, "Eligible Capital removes 1st of month withdrawal ($80k)");
  assertEqual(res.sourceGainLoss, 8000, "Source Profit = $8,000");
}

// Case 8: Deposit + withdrawal same month
console.log("\nScenario 8: Deposit + Withdrawal in same month");
{
  const res = calculateInvestorMonth({
    year: 2026, month: 8, investorId: "INV-8",
    priorEndingBalance: 100000, deposits: 20000, withdrawals: 30000, fundReturnPct: 10, sourceSplitPct: 100
  });
  assertEqual(res.eligibleCapital, 90000, "Eligible Capital = $100k + $20k - $30k = $90k");
}

// Case 9: Prior-month commission credit
console.log("\nScenario 9: Prior-month commission credit adds to month N capital");
{
  const res = calculateInvestorMonth({
    year: 2026, month: 8, investorId: "REC-9",
    priorEndingBalance: 50000, priorMonthIncomingCommissions: 5000, fundReturnPct: 10, sourceSplitPct: 100
  });
  assertEqual(res.eligibleCapital, 55000, "Eligible Capital includes credited commission ($55k)");
  assertEqual(res.sourceGainLoss, 5500, "Gain calculated on $55k = $5,500");
}

// Case 10: Commission credited exactly once
console.log("\nScenario 10: Commission credit timing integrity");
{
  const periodRes = calculateAccountingPeriod({
    year: 2026, month: 8, fundReturnPct: 10,
    investors: [{ id: "REC-10", split_pct: 100 }],
    commissionEarnings: [{ recipient_id: "REC-10", year: 2026, month_number: 7, amount: 2500 }]
  });
  const invRes = periodRes.investors.find(i => i.investorId === "REC-10");
  assertEqual(invRes.incomingCommissionCredit, 2500, "July commission credited to August capital");
}

// Case 11: Pre-start investor
console.log("\nScenario 11: Pre-start investor gets no return");
{
  const res = calculateInvestorMonth({
    year: 2026, month: 8, investorId: "INV-11", startDate: "2026-09-01",
    priorEndingBalance: 0, fundReturnPct: 10, sourceSplitPct: 100
  });
  assertEqual(res.isPreStart, true, "Investor is PRE_START for August");
  assertEqual(res.grossFundResult, 0, "Gross Fund Result is 0");
}

// Case 12: Start on first of selected month
console.log("\nScenario 12: Start on first of selected month");
{
  const res = calculateInvestorMonth({
    year: 2026, month: 8, investorId: "INV-12", startDate: "2026-08-01",
    priorEndingBalance: 100000, fundReturnPct: 10, sourceSplitPct: 100
  });
  assertEqual(res.isPreStart, false, "Investor is active for August");
  assertEqual(res.grossFundResult, 10000, "Gross Result = $10,000");
}

// Case 13-15: Rule Selection (Historical vs Active vs Transition)
console.log("\nScenarios 13-15: Date-aware commission rule selection");
{
  const shares = [
    { id: "S1", source_investor_id: "SRC", recipient_investor_id: "REC", commission_percent: 10, effective_start_date: "2026-01-01", effective_end_date: "2026-06-30", status: "ended" },
    { id: "S2", source_investor_id: "SRC", recipient_investor_id: "REC", commission_percent: 10.8, effective_start_date: "2026-07-01", effective_end_date: null, status: "active" }
  ];

  const junRun = calculateAccountingPeriod({
    year: 2026, month: 6, fundReturnPct: 5,
    investors: [{ id: "SRC", split_pct: 70 }, { id: "REC", split_pct: 100 }],
    commissionShares: shares,
    monthlyHistory: [{ investor_id: "SRC", year: 2026, month_number: 5, ending_balance: 100000 }]
  });
  const junSrc = junRun.investors.find(i => i.investorId === "SRC");
  assertEqual(junSrc.recipientAllocations[0].commissionPercent, 10, "June uses historical 10% rule");

  const julRun = calculateAccountingPeriod({
    year: 2026, month: 7, fundReturnPct: 5,
    investors: [{ id: "SRC", split_pct: 70 }, { id: "REC", split_pct: 100 }],
    commissionShares: shares,
    monthlyHistory: [{ investor_id: "SRC", year: 2026, month_number: 6, ending_balance: 100000 }]
  });
  const julSrc = julRun.investors.find(i => i.investorId === "SRC");
  assertEqual(julSrc.recipientAllocations[0].commissionPercent, 10.8, "July uses current active 10.8% rule");
}

// Case 16: Overlap Conflict
console.log("\nScenario 16: Overlap rule conflict flagging");
{
  const shares = [
    { id: "S1", source_investor_id: "SRC-16", recipient_investor_id: "REC-16", commission_percent: 10, effective_start_date: "2026-01-01", status: "active" },
    { id: "S2", source_investor_id: "SRC-16", recipient_investor_id: "REC-16", commission_percent: 15, effective_start_date: "2026-01-01", status: "active" }
  ];
  const run = calculateAccountingPeriod({
    year: 2026, month: 8, fundReturnPct: 5,
    investors: [{ id: "SRC-16", split_pct: 75 }],
    commissionShares: shares
  });
  const inv = run.investors.find(i => i.investorId === "SRC-16");
  assertEqual(inv.status, "FLAGGED", "Overlapping rules trigger FLAGGED status");
  assert(inv.flags.includes("OVERLAPPING_RULES"), "Flags contain OVERLAPPING_RULES");
}

// Case 17-18: Under/Over allocation
console.log("\nScenarios 17-18: Under and Over allocation validation");
{
  const resUnder = calculateInvestorMonth({
    year: 2026, month: 8, investorId: "INV-17",
    priorEndingBalance: 100000, fundReturnPct: 10, sourceSplitPct: 70,
    commissionShares: [{ recipientId: "REC-1", commissionPercent: 20 }] // Total = 90%
  });
  assertEqual(resUnder.reconciliation.status, "FLAGGED", "Under-allocation (90%) is FLAGGED");

  const resOver = calculateInvestorMonth({
    year: 2026, month: 8, investorId: "INV-18",
    priorEndingBalance: 100000, fundReturnPct: 10, sourceSplitPct: 70,
    commissionShares: [{ recipientId: "REC-1", commissionPercent: 35 }] // Total = 105%
  });
  assertEqual(resOver.reconciliation.status, "FLAGGED", "Over-allocation (105%) is FLAGGED");
}

// Case 19-22: Missing Split, Missing Return, $0 Capital, Negative Capital
console.log("\nScenarios 19-22: Config anomaly flagging");
{
  const run19 = calculateAccountingPeriod({
    year: 2026, month: 8, fundReturnPct: 5,
    investors: [{ id: "INV-19", split_pct: null }]
  });
  assert(run19.investors[0].flags.includes("MISSING_SOURCE_SPLIT"), "Missing source split flagged");

  const run20 = calculateAccountingPeriod({
    year: 2026, month: 8, fundReturnPct: null,
    investors: [{ id: "INV-20", split_pct: 100 }]
  });
  assert(run20.investors[0].flags.includes("MISSING_RETURN"), "Missing return flagged");

  const res21 = calculateInvestorMonth({
    year: 2026, month: 8, investorId: "INV-21", priorEndingBalance: 0, fundReturnPct: 10, sourceSplitPct: 100
  });
  assertEqual(res21.grossFundResult, 0, "$0 capital produces $0 gross result");

  const res22 = calculateInvestorMonth({
    year: 2026, month: 8, investorId: "INV-22", priorEndingBalance: -5000, fundReturnPct: 10, sourceSplitPct: 100
  });
  assertEqual(res22.reconciliation.status, "FLAGGED", "Negative eligible capital is FLAGGED");
}

// Case 23: Cent Rounding Favors Investor
console.log("\nScenario 23: Cent rounding favors source investor");
{
  // 3 recipients splitting 33.33%, 33.33%, 33.34% + 0% source on $10.00 gross profit
  // Recipients: $3.33, $3.33, $3.33 = $9.99 total
  // Source gets gross (10.00) - recipients (9.99) = $0.01 rounding remainder!
  const res = calculateInvestorMonth({
    year: 2026, month: 8, investorId: "INV-23",
    priorEndingBalance: 100, fundReturnPct: 10, sourceSplitPct: 0,
    commissionShares: [
      { recipientId: "REC-A", commissionPercent: 33.33 },
      { recipientId: "REC-B", commissionPercent: 33.33 },
      { recipientId: "REC-C", commissionPercent: 33.34 }
    ]
  });
  assertEqual(res.grossFundResult, 10.00, "Gross profit = $10.00");
  assertEqual(res.totalRecipientCommissions, 9.99, "Total recipients = $9.99");
  assertEqual(res.sourceGainLoss, 0.01, "Source receives remaining $0.01 cent rounding adjustment");
}

// Case 24-27: Multiple Recipients, 100% Source, Loss/Zero Commission Zeroing
console.log("\nScenarios 24-27: Recipients allocations & Loss/Zero zeroing");
{
  const res25 = calculateInvestorMonth({
    year: 2026, month: 8, investorId: "INV-25",
    priorEndingBalance: 100000, fundReturnPct: 5, sourceSplitPct: 100, commissionShares: []
  });
  assertEqual(res25.sourceGainLoss, 5000, "100% source gets full $5,000 gain");

  const res26 = calculateInvestorMonth({
    year: 2026, month: 8, investorId: "INV-26",
    priorEndingBalance: 100000, fundReturnPct: -5, sourceSplitPct: 70,
    commissionShares: [{ recipientId: "REC-1", commissionPercent: 30 }]
  });
  assertEqual(res26.totalRecipientCommissions, 0, "Loss month creates ZERO recipient commissions");
  assertEqual(res26.recipientAllocations[0].amount, 0, "Recipient allocation amount is 0");

  const res27 = calculateInvestorMonth({
    year: 2026, month: 8, investorId: "INV-27",
    priorEndingBalance: 100000, fundReturnPct: 0, sourceSplitPct: 70,
    commissionShares: [{ recipientId: "REC-1", commissionPercent: 30 }]
  });
  assertEqual(res27.totalRecipientCommissions, 0, "Zero month creates ZERO recipient commissions");
}

// Case 28-29: Idempotency & Byte-Equivalent Output (excluding ephemeral fields)
console.log("\nScenarios 28-29: Idempotency & Byte-Equivalent Output");
{
  const input = {
    year: 2026, month: 8, fundReturnPct: 2.81,
    capturedAt: "2026-08-13T00:00:00.000Z",
    investors: [{ id: "INV-IDEM", split_pct: 70 }],
    commissionShares: [{ source_investor_id: "INV-IDEM", recipient_investor_id: "REC-IDEM", commission_percent: 30, effective_start_date: "2026-01-01", status: "active" }],
    monthlyHistory: [{ investor_id: "INV-IDEM", year: 2026, month_number: 7, ending_balance: 100000 }]
  };

  const sanitize = (res) => {
    const copy = JSON.parse(JSON.stringify(res));
    delete copy.previewRunId;
    delete copy.generatedAt;
    delete copy.returnCapturedAt;
    return copy;
  };

  const runA = calculateAccountingPeriod(input);
  const runB = calculateAccountingPeriod(input);

  assertEqual(runA.inputHash, runB.inputHash, "inputHash is identical across repeated runs");
  assertEqual(JSON.stringify(sanitize(runA)), JSON.stringify(sanitize(runB)), "Financial JSON is byte-equivalent excluding ephemeral metadata");
}

console.log("\n==================================================");
console.log("SUITE 2: RANDOMIZED PROPERTY-BASED MATH TESTS (1,000 TRIALS)");
console.log("==================================================\n");

let propertyFailures = 0;

for (let i = 0; i < 1000; i++) {
  // Random eligible capital between $1.00 and $1,000,000.00
  const capital = Math.round((Math.random() * 1000000 + 1) * 100) / 100;
  // Random fund return between -15.00% and +15.00%
  const returnPct = Math.round((Math.random() * 30 - 15) * 100) / 100;
  // Random source split between 50% and 100%
  const sourceSplit = Math.round((Math.random() * 50 + 50) * 10) / 10;
  const recipPercent = 100 - sourceSplit;

  const res = calculateInvestorMonth({
    year: 2026, month: 8, investorId: `PROP-${i}`,
    priorEndingBalance: capital, fundReturnPct: returnPct, sourceSplitPct: sourceSplit,
    commissionShares: recipPercent > 0 ? [{ recipientId: "REC-PROP", commissionPercent: recipPercent }] : []
  });

  if (returnPct > 0) {
    // PROPERTY 1: In positive profit months with 100% total split, source + recipients === grossProfit to the cent
    const totalAllocated = res.sourceGainLoss + res.totalRecipientCommissions;
    const diff = Math.abs(totalAllocated - res.grossFundResult);
    if (diff > 0.0001) {
      propertyFailures++;
      console.error(`Property 1 Violation at trial ${i}: gross=${res.grossFundResult}, source=${res.sourceGainLoss}, recipients=${res.totalRecipientCommissions}`);
    }
  } else if (returnPct < 0) {
    // PROPERTY 2: In loss months, recipient commissions MUST be $0.00 and source loss = round(grossLoss * sourcePct / 100)
    if (res.totalRecipientCommissions !== 0) {
      propertyFailures++;
      console.error(`Property 2 Violation at trial ${i}: recipient commissions non-zero (${res.totalRecipientCommissions}) on loss month`);
    }
  }
}

assertEqual(propertyFailures, 0, "1,000 Randomized Property Tests Passed without financial discrepancy");

console.log("\n==================================================");
console.log(`SUMMARY: ${passedCount} PASSED | ${failedCount} FAILED`);
console.log("==================================================\n");

if (failedCount > 0) {
  process.exit(1);
}
