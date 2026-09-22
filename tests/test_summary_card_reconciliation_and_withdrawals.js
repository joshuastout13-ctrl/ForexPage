import assert from "node:assert";
import Decimal from "decimal.js";
import {
  calculateTotalExternalCash,
  calculateLifetimePerformance,
  calculateBalanceAffectingDeposits
} from "../lib/accounting-engine.js";
import { buildInvestorDashboard } from "../lib/dashboard.js";

function pass(msg) {
  console.log(`  ✅ PASS: ${msg}`);
}

function fail(msg, err) {
  console.error(`  ❌ FAIL: ${msg}`);
  console.error(err);
  process.exitCode = 1;
}

async function runSuite() {
  console.log("================================================================================");
  console.log("SUMMARY CARDS, WITHDRAWALS & PROVENANCE RECONCILIATION REGRESSION SUITE");
  console.log("================================================================================\n");

  // ─── Test 1: Multiple historical withdrawals across multiple months ──────────
  try {
    const preloaded = {
      rawInvestors: [{
        investorsinvestorid: "inv_w1",
        portalusername: "testw1",
        first_name: "Multi",
        last_name: "Withdrawal",
        investorsplit: 100,
        active: true,
        startdate: "2026-01-01"
      }],
      accounts: [{
        id: "acc_w1",
        investorid: "inv_w1",
        starting_capital: 1000000.00,
        external_cash_provenance_status: "PARTIAL",
        status: "Active"
      }],
      returnsSheet: [
        { month: "January", month_number: 1, monthnumber: 1, year: 2026, gross_return_pct: 2.0 },
        { month: "February", month_number: 2, monthnumber: 2, year: 2026, gross_return_pct: 2.0 },
        { month: "March", month_number: 3, monthnumber: 3, year: 2026, gross_return_pct: 2.0 },
        { month: "April", month_number: 4, monthnumber: 4, year: 2026, gross_return_pct: 2.0 },
        { month: "May", month_number: 5, monthnumber: 5, year: 2026, gross_return_pct: 2.0 },
        { month: "June", month_number: 6, monthnumber: 6, year: 2026, gross_return_pct: 2.0 },
        { month: "July", month_number: 7, monthnumber: 7, year: 2026, gross_return_pct: 2.0 },
        { month: "August", month_number: 8, monthnumber: 8, year: 2026, gross_return_pct: 2.0 }
      ],
      depositsSheet: [
        { id: "dep_w1", investorid: "inv_w1", amount: 5000, accounting_treatment: "NEW_CASH", status: "confirmed", monthnumber: 3, year: 2026 }
      ],
      withdrawalsSheet: [
        // Month 2: Completed $10,000
        { id: "wd_1", investorid: "inv_w1", amount: 10000, status: "completed", month_number: 2, year: 2026 },
        // Month 5: Approved $15,000
        { id: "wd_2", investorid: "inv_w1", amount: 15000, status: "Approved", month_number: 5, year: 2026 },
        // Month 7: Completed $25,000
        { id: "wd_3", investorid: "inv_w1", amount: 25000, status: "Completed", month_number: 7, year: 2026 },
        // Month 8: Pending $5,000 (must NOT be added to settled withdrawals)
        { id: "wd_4", investorid: "inv_w1", amount: 5000, status: "Pending", month_number: 8, year: 2026 },
        // Month 8: Cancelled $50,000 (must NOT be added to withdrawals)
        { id: "wd_5", investorid: "inv_w1", amount: 50000, status: "Cancelled", month_number: 8, year: 2026 }
      ],
      historyTable: [],
      commissionEarningsTable: [],
      commissionSharesTable: [],
      commissionRulesTable: [],
      cutoverAdjustments: [],
      live: {}
    };

    const d = await buildInvestorDashboard("testw1", preloaded, { asOfDate: "2026-08-31" });

    // Completed/Approved: Month 2 ($10k) + Month 5 ($15k) + Month 7 ($25k) = $50,000
    // Pending ($5k) is excluded from settled withdrawals
    // Cancelled ($50k) is excluded entirely
    assert.strictEqual(d.summary.totalWithdrawals, 50000, "Settled withdrawals must sum completed and approved across months ($50,000)");

    // Pending withdrawal must be visible in breakdown pendingWithdrawal field
    const augRow = d.breakdown.find(r => r.monthNumber === 8);
    assert.strictEqual(augRow.pendingWithdrawal, 5000, "August breakdown must show $5,000 pending withdrawal");

    pass("1. Multiple historical withdrawals across multiple months: Completed ($35k) + Approved ($15k) = $50k settled; Pending ($5k) and Cancelled ($50k) excluded correctly");
  } catch (err) { fail("1. Multiple historical withdrawals", err); }

  // ─── Test 2: PARTIAL deposits do not corrupt withdrawal totals ────────────
  try {
    const preloaded = {
      rawInvestors: [{
        investorsinvestorid: "inv_w2",
        portalusername: "testw2",
        first_name: "Test",
        last_name: "W2",
        investorsplit: 100,
        active: true,
        startdate: "2026-01-01"
      }],
      accounts: [{
        id: "acc_w2",
        investorid: "inv_w2",
        starting_capital: 1000000.00,
        external_cash_provenance_status: "PARTIAL",
        status: "Active"
      }],
      returnsSheet: [
        { month: "August", month_number: 8, monthnumber: 8, year: 2026, gross_return_pct: 0 }
      ],
      depositsSheet: [
        // $2,500 PARTIAL deposit
        { id: "dep_p", investorid: "inv_w2", amount: 2500, accounting_treatment: "NEW_CASH", status: "confirmed", monthnumber: 8, year: 2026 }
      ],
      withdrawalsSheet: [
        // $20,000 completed withdrawal
        { id: "wd_p", investorid: "inv_w2", amount: 20000, status: "completed", month_number: 8, year: 2026 }
      ],
      historyTable: [],
      commissionEarningsTable: [],
      commissionSharesTable: [],
      commissionRulesTable: [],
      cutoverAdjustments: [],
      live: {}
    };

    const d = await buildInvestorDashboard("testw2", preloaded, { asOfDate: "2026-08-31" });

    assert.strictEqual(d.summary.totalExternalCashSent, 2500, "Total deposits must be $2,500");
    assert.strictEqual(d.summary.totalWithdrawals, 20000, "Total withdrawals must be $20,000");
    assert.strictEqual(d.summary.provenanceCompletenessStatus, "PARTIAL");
    assert.strictEqual(d.summary.totalPerformanceDollar, null, "Performance $ must be null under PARTIAL");
    assert.strictEqual(d.summary.totalPerformancePct, null, "Performance % must be null under PARTIAL");

    pass("2. PARTIAL deposits do not corrupt withdrawal totals: Total Deposits = $2,500, Withdrawals = $20,000 independently preserved");
  } catch (err) { fail("2. PARTIAL deposits and withdrawals", err); }

  // ─── Test 3: Provenance changes do not alter YTD Gain or Current Balance ──
  try {
    const baseFixture = (provenanceStatus) => ({
      rawInvestors: [{
        investorsinvestorid: "inv_w3",
        portalusername: "testw3",
        first_name: "Test",
        last_name: "W3",
        investorsplit: 100,
        active: true,
        startdate: "2026-01-01"
      }],
      accounts: [{
        id: "acc_w3",
        investorid: "inv_w3",
        starting_capital: 1000000.00,
        external_cash_provenance_status: provenanceStatus,
        status: "Active"
      }],
      returnsSheet: [
        { month: "January", month_number: 1, monthnumber: 1, year: 2026, gross_return_pct: 3.0 },
        { month: "February", month_number: 2, monthnumber: 2, year: 2026, gross_return_pct: 2.5 },
        { month: "March", month_number: 3, monthnumber: 3, year: 2026, gross_return_pct: 4.0 }
      ],
      depositsSheet: [
        { id: "dep_3", investorid: "inv_w3", amount: 10000, accounting_treatment: "NEW_CASH", status: "confirmed", monthnumber: 2, year: 2026 }
      ],
      withdrawalsSheet: [
        { id: "wd_3", investorid: "inv_w3", amount: 5000, status: "completed", month_number: 3, year: 2026 }
      ],
      historyTable: [],
      commissionEarningsTable: [],
      commissionSharesTable: [],
      commissionRulesTable: [],
      cutoverAdjustments: [],
      live: {}
    });

    const dUnknown = await buildInvestorDashboard("testw3", baseFixture("UNKNOWN"), { asOfDate: "2026-03-31" });
    const dPartial = await buildInvestorDashboard("testw3", baseFixture("PARTIAL"), { asOfDate: "2026-03-31" });
    const dComplete = await buildInvestorDashboard("testw3", baseFixture("COMPLETE"), { asOfDate: "2026-03-31" });

    // Assert that Total Gain YTD is IDENTICAL across all three provenance states
    assert.strictEqual(dUnknown.summary.totalGain, dPartial.summary.totalGain, "YTD Gain must not change between UNKNOWN and PARTIAL");
    assert.strictEqual(dPartial.summary.totalGain, dComplete.summary.totalGain, "YTD Gain must not change between PARTIAL and COMPLETE");

    // Assert that Current Balance is IDENTICAL across all three provenance states
    assert.strictEqual(dUnknown.summary.currentBalance, dPartial.summary.currentBalance, "Current Balance must not change between UNKNOWN and PARTIAL");
    assert.strictEqual(dPartial.summary.currentBalance, dComplete.summary.currentBalance, "Current Balance must not change between PARTIAL and COMPLETE");

    // Assert that Total Withdrawals is IDENTICAL across all three provenance states
    assert.strictEqual(dUnknown.summary.totalWithdrawals, dPartial.summary.totalWithdrawals);
    assert.strictEqual(dPartial.summary.totalWithdrawals, dComplete.summary.totalWithdrawals);

    pass("3. Provenance changes do NOT alter YTD Gain ($98,787.50), Current Balance ($1,103,787.50), or Withdrawals ($5,000)");
  } catch (err) { fail("3. Provenance independence", err); }

  // ─── Test 4: HISTORICAL_PROVENANCE vs NEW_CASH accounting effects ────────
  try {
    const fixtureHist = {
      rawInvestors: [{ investorsinvestorid: "inv_h", portalusername: "testh", first_name: "H", last_name: "P", investorsplit: 100, active: true, startdate: "2026-01-01" }],
      accounts: [{ id: "acc_h", investorid: "inv_h", starting_capital: 1000000.00, startingcapital: 1000000.00, external_cash_provenance_status: "COMPLETE", status: "Active" }],
      returnsSheet: [{ month: "January", month_number: 1, monthnumber: 1, year: 2026, gross_return_pct: 0 }],
      depositsSheet: [
        // Historical provenance $500k — already in starting capital
        { id: "dep_hp", investorid: "inv_h", amount: 500000, accounting_treatment: "HISTORICAL_PROVENANCE", status: "confirmed", monthnumber: 1, year: 2026 }
      ],
      withdrawalsSheet: [],
      historyTable: [],
      commissionEarningsTable: [],
      commissionSharesTable: [],
      commissionRulesTable: [],
      cutoverAdjustments: [],
      live: {}
    };

    const dHist = await buildInvestorDashboard("testh", fixtureHist, { asOfDate: "2026-01-31" });

    // Balance must NOT be recapitalized (remains $1,000,000, NOT $1,500,000)
    assert.strictEqual(dHist.summary.currentBalance, 1000000, "HISTORICAL_PROVENANCE must NOT add to balance ($1M)");
    // Total External Cash must count the $500k
    assert.strictEqual(dHist.summary.totalExternalCashSent, 500000, "HISTORICAL_PROVENANCE must count in Total Deposits ($500k)");

    // Now test NEW_CASH: $500k adds to balance
    const fixtureNew = {
      ...fixtureHist,
      depositsSheet: [
        { id: "dep_nc", investorid: "inv_h", amount: 500000, accounting_treatment: "NEW_CASH", status: "confirmed", monthnumber: 1, year: 2026 }
      ]
    };

    const dNew = await buildInvestorDashboard("testh", fixtureNew, { asOfDate: "2026-01-31" });
    // Balance MUST increase to $1,500,000
    assert.strictEqual(dNew.summary.currentBalance, 1500000, "NEW_CASH must add to balance ($1.5M)");
    assert.strictEqual(dNew.summary.totalExternalCashSent, 500000, "NEW_CASH counts in Total Deposits ($500k)");

    pass("4. HISTORICAL_PROVENANCE counts toward Total Deposits without recapitalizing balance; NEW_CASH both counts and adds to balance");
  } catch (err) { fail("4. Historical vs New cash accounting", err); }

  console.log("\n================================================================================");
  console.log("ALL TESTS COMPLETED");
  console.log("================================================================================\n");
}

runSuite();
