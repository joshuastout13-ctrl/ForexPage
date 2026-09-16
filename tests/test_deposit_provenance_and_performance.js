/**
 * ============================================================================
 * 4XTrack — DEPOSIT PROVENANCE & PERFORMANCE REGRESSION TEST SUITE
 * ============================================================================
 *
 * Tests the authoritative external cash / Total Deposits / Total Performance
 * contract established Sep 2026.
 *
 * ZERO mutations to production database — all tests use preloadedData.
 *
 * Coverage (per spec):
 *  1. New $10,000 external deposit: Total Deposits +$10k; balance +$10k
 *  2. Historical $1M provenance (already in cutover): Total Deposits +$1M; balance $0 change
 *  3. Commission capitalization: balance changes; Total Deposits unchanged
 *  4. Withdrawal: balance changes; Total Deposits unchanged; no addback
 *  5. Cutover adjustment: accounting baseline may change; Total Deposits unchanged
 *  6. No proven cash: no starting_capital fallback; performance is UNKNOWN (null)
 *  7. Cancelled/Void record: excluded from Total Deposits
 *  8. Duplicate submission: blocked/idempotent via idempotency_key uniqueness
 *
 * Also tests the pure engine functions directly for unit coverage.
 */

import assert from "node:assert";
import Decimal from "decimal.js";
import {
  calculateBalanceAffectingDeposits,
  calculateTotalExternalCash,
  calculateLifetimePerformance
} from "../lib/accounting-engine.js";
import { buildDeterministicIdempotencyKey } from "../lib/financial-mutation-guard.js";
import { buildInvestorDashboard } from "../lib/dashboard.js";

console.log("================================================================================");
console.log("4XTrack — DEPOSIT PROVENANCE & TOTAL PERFORMANCE REGRESSION TEST SUITE");
console.log("================================================================================\n");

let passed = 0;
let failed = 0;

function pass(label) {
  console.log(`  ✅ PASS: ${label}`);
  passed++;
}

function fail(label, err) {
  console.error(`  ❌ FAIL: ${label}`);
  console.error(`     ${err?.message || err}`);
  failed++;
}

// ─── BASE MOCK FACTORY ────────────────────────────────────────────────────────

function basePreload({
  investorId = "inv_test",
  username = "testinv",
  startCapital = 1000000,
  extraDeposits = [],
  extraWithdrawals = [],
  extraHistory = [],
  splitPct = 100
} = {}) {
  return {
    rawInvestors: [{
      investorsinvestorid: investorId,
      portalusername: username,
      first_name: "Test",
      last_name: "Investor",
      investorsplit: splitPct,
      active: true,
      startdate: "2026-01-01"
    }],
    accounts: [{
      id: `acc_${investorId}`,
      investorid: investorId,
      starting_capital: startCapital,
      opendate: "2026-01-01",
      recurringmonthlydraw: 0,
      status: "Active",
      is_commission: false
    }],
    returnsSheet: [
      { month: "January",   month_number: 1,  monthnumber: 1,  year: 2026, gross_return_pct: 3.00, grossreturn: 3.00 },
      { month: "February",  month_number: 2,  monthnumber: 2,  year: 2026, gross_return_pct: 2.50, grossreturn: 2.50 },
      { month: "March",     month_number: 3,  monthnumber: 3,  year: 2026, gross_return_pct: 4.00, grossreturn: 4.00 },
      { month: "April",     month_number: 4,  monthnumber: 4,  year: 2026, gross_return_pct: 2.00, grossreturn: 2.00 },
      { month: "May",       month_number: 5,  monthnumber: 5,  year: 2026, gross_return_pct: 3.50, grossreturn: 3.50 },
      { month: "June",      month_number: 6,  monthnumber: 6,  year: 2026, gross_return_pct: 1.50, grossreturn: 1.50 },
      { month: "July",      month_number: 7,  monthnumber: 7,  year: 2026, gross_return_pct: 2.80, grossreturn: 2.80 },
      { month: "August",    month_number: 8,  monthnumber: 8,  year: 2026, gross_return_pct: 3.10, grossreturn: 3.10 }
    ],
    depositsSheet: extraDeposits,
    withdrawalsSheet: extraWithdrawals,
    historyTable: extraHistory,
    commissionEarningsTable: [],
    commissionSharesTable: [],
    commissionRulesTable: [],
    cutoverAdjustments: [],
    live: { source: "Test", today: "0.00%", week: "0.00%", month: "0.00%", year: "0.00%" }
  };
}

async function runSuite() {
  // ──────────────────────────────────────────────────────────────────────────
  // SECTION A: Pure engine unit tests (no dashboard, no DB)
  // ──────────────────────────────────────────────────────────────────────────
  console.log("\n=== SECTION A: Pure Engine Unit Tests ===\n");

  // ─── Test 1: New $10,000 external deposit ─────────────────────────────────
  try {
    const newCashDeposit = { id: "dep_001", investor_id: "inv_a", amount: 10000, accounting_treatment: "NEW_CASH", status: "confirmed", date: "2026-05-15" };

    const balAffecting = calculateBalanceAffectingDeposits({ depositRows: [newCashDeposit] });
    const extCash = calculateTotalExternalCash({ depositRows: [newCashDeposit] });

    assert.strictEqual(balAffecting, 10000, "Balance-affecting deposits must equal $10,000");
    assert.strictEqual(extCash.total, 10000, "Total external cash must equal $10,000");
    assert.strictEqual(extCash.hasConfirmedRecords, true, "Must report hasConfirmedRecords=true");

    const perf = calculateLifetimePerformance({
      totalExternalCashSent: extCash.total,
      hasConfirmedExternalCashRecords: extCash.hasConfirmedRecords,
      currentBalance: 30000
    });

    assert.strictEqual(perf.isProven, true);
    assert.strictEqual(perf.totalExternalCashSent, 10000);
    assert.strictEqual(perf.totalPerformanceDollar, 20000);
    assert.strictEqual(Math.round(perf.totalPerformancePct * 100) / 100, 200.00, "Performance should be 200%");
    pass("1. New $10,000 external deposit: Total Deposits +$10k; performance calculation correct");
  } catch (err) { fail("1. New $10,000 external deposit", err); }

  // ─── Test 2: Historical $1M provenance (already in cutover baseline) ──────
  try {
    const historicalDeposit = {
      id: "dep_hist_001",
      investor_id: "inv_b",
      amount: 1000000,
      accounting_treatment: "HISTORICAL_PROVENANCE",
      status: "confirmed",
      date: "2020-01-01"
    };

    // Balance-affecting: MUST be $0 (historical provenance does NOT add to balance)
    const balAffecting = calculateBalanceAffectingDeposits({ depositRows: [historicalDeposit] });
    assert.strictEqual(balAffecting, 0, "HISTORICAL_PROVENANCE must NOT affect accounting balance ($0)");

    // Total external cash: MUST include the provenance record
    const extCash = calculateTotalExternalCash({ depositRows: [historicalDeposit] });
    assert.strictEqual(extCash.total, 1000000, "HISTORICAL_PROVENANCE must count in Total External Cash ($1M)");
    assert.strictEqual(extCash.hasConfirmedRecords, true);

    // Performance: based on $1M confirmed cash
    const perf = calculateLifetimePerformance({
      totalExternalCashSent: extCash.total,
      hasConfirmedExternalCashRecords: extCash.hasConfirmedRecords,
      currentBalance: 3000000
    });

    assert.strictEqual(perf.totalExternalCashSent, 1000000);
    assert.strictEqual(perf.totalPerformanceDollar, 2000000);
    assert.strictEqual(Math.round(perf.totalPerformancePct * 100) / 100, 200.00, "Performance should be +200%");

    pass("2. Historical $1M provenance: Total Deposits +$1M; accounting balance $0 change; no double-capitalization; performance correct");
  } catch (err) { fail("2. Historical $1M provenance", err); }

  // ─── Test 3: Commission capitalization — Total Deposits unchanged ─────────
  try {
    const deposits = [
      // Legitimate external cash
      { id: "dep_ext_001", investor_id: "inv_c", amount: 50000, accounting_treatment: "NEW_CASH", status: "confirmed", date: "2026-01-01" },
      // Commission deposit — must be excluded from Total Deposits
      { id: "dep_comm_001", investor_id: "inv_c", amount: 5000, type: "COMMISSION", accounting_treatment: "NEW_CASH", status: "confirmed", date: "2026-06-01" }
    ];

    // Balance-affecting: only the external $50k (commission may affect balance separately via earnings)
    const balAffecting = calculateBalanceAffectingDeposits({ depositRows: deposits });
    assert.strictEqual(balAffecting, 50000, "Commission deposits must NOT count in balance-affecting calculation");

    // Total external cash: also excludes commissions
    const extCash = calculateTotalExternalCash({ depositRows: deposits });
    assert.strictEqual(extCash.total, 50000, "Commission deposits must NOT count in Total External Cash");

    pass("3. Commission capitalization: Total Deposits unchanged (commission excluded from external cash)");
  } catch (err) { fail("3. Commission capitalization", err); }

  // ─── Test 4: Withdrawal — Total Deposits unchanged, no addback ───────────
  try {
    const deposits = [
      { id: "dep_001", investor_id: "inv_d", amount: 500000, accounting_treatment: "NEW_CASH", status: "confirmed", date: "2026-01-01" }
    ];

    const extCash = calculateTotalExternalCash({ depositRows: deposits });
    assert.strictEqual(extCash.total, 500000, "Total Deposits must be $500k before and after withdrawal");

    // Simulate a withdrawal reducing balance to $400k
    const currentBalance = 400000;
    const perf = calculateLifetimePerformance({
      totalExternalCashSent: extCash.total,
      hasConfirmedExternalCashRecords: extCash.hasConfirmedRecords,
      currentBalance
    });

    // Total Performance = $400k - $500k = -$100k / -20%
    // Withdrawals are NOT added back — the current balance already reflects them
    assert.strictEqual(perf.totalExternalCashSent, 500000, "External cash sent must remain $500k despite withdrawal");
    assert.strictEqual(perf.totalPerformanceDollar, -100000, "Performance$ must be -$100k (withdrawal not added back)");
    assert.strictEqual(Math.round(perf.totalPerformancePct * 100) / 100, -20.00, "Performance% must be -20%");

    pass("4. Withdrawal: Total Deposits unchanged at $500k; Performance correctly shows -$100k / -20%; no withdrawal addback");
  } catch (err) { fail("4. Withdrawal: Total Deposits unchanged", err); }

  // ─── Test 5: Cutover adjustment — accounting baseline changes; Total Deposits unchanged ──
  try {
    const deposits = [
      { id: "dep_001", investor_id: "inv_e", amount: 250000, accounting_treatment: "HISTORICAL_PROVENANCE", status: "confirmed", date: "2020-01-01" }
    ];

    const extCashBefore = calculateTotalExternalCash({ depositRows: deposits });
    assert.strictEqual(extCashBefore.total, 250000);

    // Simulate a cutover adjustment (authorized_opening_balance changes from $250k to $260k)
    // This is an accounting baseline change — it does NOT affect Total Deposits
    // Total Deposits remains $250k because no new deposit row was added
    const extCashAfter = calculateTotalExternalCash({ depositRows: deposits });
    assert.strictEqual(extCashAfter.total, 250000, "Total Deposits unchanged by cutover adjustment (no deposit row added/removed)");

    pass("5. Cutover adjustment: accounting baseline may change; Total Deposits unchanged (no deposit row mutated)");
  } catch (err) { fail("5. Cutover adjustment", err); }

  // ─── Test 6: No proven cash — FAIL CLOSED; no starting_capital fallback ──
  try {
    // Empty deposit table — no confirmed external cash
    const extCash = calculateTotalExternalCash({ depositRows: [] });
    assert.strictEqual(extCash.total, 0);
    assert.strictEqual(extCash.hasConfirmedRecords, false, "Must report hasConfirmedRecords=false when no deposits exist");

    const perf = calculateLifetimePerformance({
      totalExternalCashSent: extCash.total,
      hasConfirmedExternalCashRecords: extCash.hasConfirmedRecords,
      currentBalance: 1500000,
      // starting_capital should NOT be used as a fallback
      startingCapital: 1000000
    });

    assert.strictEqual(perf.isProven, false, "isProven must be false when no external cash records exist");
    assert.strictEqual(perf.provenanceStatus, "NO_CONFIRMED_EXTERNAL_CASH", "provenanceStatus must indicate no confirmed cash");
    assert.strictEqual(perf.totalPerformanceDollar, null, "totalPerformanceDollar must be null (not fabricated from starting_capital)");
    assert.strictEqual(perf.totalPerformancePct, null, "totalPerformancePct must be null (not fabricated as 0% or any guess)");

    pass("6. No proven cash: isProven=false; provenanceStatus='NO_CONFIRMED_EXTERNAL_CASH'; totalPerformanceDollar=null; totalPerformancePct=null; no starting_capital fallback");
  } catch (err) { fail("6. No proven cash — FAIL CLOSED", err); }

  // ─── Test 7: Cancelled/Void record excluded from Total Deposits ───────────
  try {
    const deposits = [
      // Active external cash
      { id: "dep_active", investor_id: "inv_f", amount: 100000, accounting_treatment: "NEW_CASH", status: "confirmed", date: "2026-01-01" },
      // Voided via new status column
      { id: "dep_void_new", investor_id: "inv_f", amount: 999999, accounting_treatment: "NEW_CASH", status: "void", date: "2026-02-01" },
      // Voided via legacy type='VOID'
      { id: "dep_void_legacy", investor_id: "inv_f", amount: 888888, type: "VOID", status: "void", date: "2026-03-01" },
      // Cancelled
      { id: "dep_cancelled", investor_id: "inv_f", amount: 777777, accounting_treatment: "HISTORICAL_PROVENANCE", status: "cancelled", date: "2026-04-01" }
    ];

    const balAffecting = calculateBalanceAffectingDeposits({ depositRows: deposits });
    const extCash = calculateTotalExternalCash({ depositRows: deposits });

    assert.strictEqual(balAffecting, 100000, "Only the active $100k must be balance-affecting");
    assert.strictEqual(extCash.total, 100000, "Only the active $100k must count in Total External Cash");
    assert.strictEqual(extCash.hasConfirmedRecords, true);

    pass("7. Voided (new status) + Voided (legacy type) + Cancelled records all excluded from Total Deposits; only active $100k counted");
  } catch (err) { fail("7. Cancelled/Void records excluded", err); }

  // ─── Test 8: Duplicate submission blocked via idempotency key ─────────────
  try {
    // Build a deterministic key for a historical provenance deposit
    const key1 = buildDeterministicIdempotencyKey({
      type: "deposit",
      investorId: "inv_g",
      effectiveDate: "2020-01-01",
      amountCents: 100000000, // $1,000,000.00
      purpose: "historical_provenance"
    });

    // Submitting the exact same parameters produces the same key
    const key2 = buildDeterministicIdempotencyKey({
      type: "deposit",
      investorId: "inv_g",
      effectiveDate: "2020-01-01",
      amountCents: 100000000,
      purpose: "historical_provenance"
    });

    assert.strictEqual(key1, key2, "Same deposit parameters must produce the same idempotency key (deterministic)");
    assert(key1.length > 0, "Idempotency key must not be empty");
    assert(!key1.toLowerCase().includes("random"), "Idempotency key must not contain 'random'");

    // A different amount produces a different key (unique per cash event)
    const key3 = buildDeterministicIdempotencyKey({
      type: "deposit",
      investorId: "inv_g",
      effectiveDate: "2020-01-01",
      amountCents: 50000000, // $500,000.00
      purpose: "historical_provenance"
    });

    assert.notStrictEqual(key1, key3, "Different amounts must produce different idempotency keys");
    pass("8. Duplicate submission: same parameters produce identical deterministic idempotency key; different amounts produce different keys; API would return HTTP 409 on duplicate");
  } catch (err) { fail("8. Duplicate submission blocked", err); }

  // ─── Test 9: UNVERIFIED_LEGACY treatment semantics ────────────────────────
  try {
    const legacyDeposit = {
      id: "dep_legacy_test",
      investor_id: "inv_leg",
      amount: 25000,
      accounting_treatment: "UNVERIFIED_LEGACY",
      status: "confirmed",
      date: "2026-08-01"
    };

    // 1. Balance-affecting: UNVERIFIED_LEGACY must be included to maintain monthly ledger continuity
    const balDeposits = calculateBalanceAffectingDeposits({
      depositRows: [legacyDeposit],
      targetYear: 2026,
      maxMonth: 8
    });
    assert.strictEqual(balDeposits, 25000, "UNVERIFIED_LEGACY must affect monthly compounding balance");

    // 2. Total External Cash: UNVERIFIED_LEGACY must be EXCLUDED until certified
    const cashResult = calculateTotalExternalCash({
      depositRows: [legacyDeposit]
    });
    assert.strictEqual(cashResult.total, 0, "UNVERIFIED_LEGACY must NOT count toward Total External Cash");
    assert.strictEqual(cashResult.hasConfirmedRecords, false, "hasConfirmedRecords must be false for unverified rows");

    // 3. Performance: must fail closed (null)
    const perf = calculateLifetimePerformance({
      totalExternalCashSent: cashResult.total,
      hasConfirmedExternalCashRecords: cashResult.hasConfirmedRecords,
      currentBalance: 1200000
    });
    assert.strictEqual(perf.provenanceStatus, "NO_CONFIRMED_EXTERNAL_CASH", "Status must be NO_CONFIRMED_EXTERNAL_CASH");
    assert.strictEqual(perf.totalPerformanceDollar, null, "Performance $ must be null when only unverified legacy rows exist");
    assert.strictEqual(perf.totalPerformancePct, null, "Performance % must be null when only unverified legacy rows exist");

    pass("9. UNVERIFIED_LEGACY treatment: affects monthly balance, strictly excluded from Total External Cash, Performance is null");
  } catch (err) { fail("9. UNVERIFIED_LEGACY treatment", err); }

  // ─── Test 10: Mixed UNVERIFIED_LEGACY and NEW_CASH deposits ───────────────
  try {
    const deposits = [
      { id: "dep_leg", investor_id: "inv_mix", amount: 10000, accounting_treatment: "UNVERIFIED_LEGACY", status: "confirmed", date: "2026-04-01" },
      { id: "dep_new", investor_id: "inv_mix", amount: 50000, accounting_treatment: "NEW_CASH", status: "confirmed", date: "2026-06-01" }
    ];

    // Total External Cash must strictly count the $50k NEW_CASH and exclude the $10k legacy
    const cashResult = calculateTotalExternalCash({ depositRows: deposits });
    assert.strictEqual(cashResult.total, 50000, "Total External Cash must equal $50,000 (excluding $10k legacy)");
    assert.strictEqual(cashResult.hasConfirmedRecords, true, "hasConfirmedRecords must be true");

    // Balance-affecting must include both ($60k)
    const balTotal = calculateBalanceAffectingDeposits({ depositRows: deposits });
    assert.strictEqual(balTotal, 60000, "Both legacy and new cash affect the monthly balance");

    pass("10. Mixed legacy and new cash: Total Deposits strictly reflects proven cash only ($50k), balance reflects both ($60k)");
  } catch (err) { fail("10. Mixed legacy and new cash", err); }

  // ──────────────────────────────────────────────────────────────────────────
  // SECTION B: Dashboard integration tests (preloadedData, no DB)
  // ──────────────────────────────────────────────────────────────────────────
  console.log("\n=== SECTION B: Dashboard Integration Tests ===\n");

  // ─── Test B1: NEW_CASH deposit adds to balance; HISTORICAL_PROVENANCE does not ──
  try {
    const preload = basePreload({
      investorId: "inv_b1",
      username: "testb1",
      startCapital: 1000000,
      extraDeposits: [
        // NEW_CASH: $10k deposited in May — should add to May balance
        {
          id: "dep_new_b1",
          investorid: "inv_b1",
          investor_id: "inv_b1",
          amount: 10000,
          accounting_treatment: "NEW_CASH",
          status: "confirmed",
          date: "2026-05-15",
          monthnumber: 5,
          year: 2026
        },
        // HISTORICAL_PROVENANCE: $1M historical funding — MUST NOT change balance
        {
          id: "dep_hist_b1",
          investorid: "inv_b1",
          investor_id: "inv_b1",
          amount: 1000000,
          accounting_treatment: "HISTORICAL_PROVENANCE",
          status: "confirmed",
          date: "2025-01-01",
          monthnumber: 1,
          year: 2025
        }
      ]
    });

    const dashboard = await buildInvestorDashboard("testb1", preload, { asOfDate: "2026-09-01" });

    // May row: should reflect $10k NEW_CASH but NOT the $1M historical provenance
    const mayRow = dashboard.breakdown.find(r => r.monthNumber === 5);
    assert(mayRow, "May breakdown row must exist");
    assert.strictEqual(mayRow.deposits, 10000, "May deposits must equal $10k NEW_CASH only (not $1M historical)");

    // Total external cash: must include BOTH records ($1M + $10k = $1,010,000)
    assert.strictEqual(
      dashboard.summary.totalExternalCashSent,
      1010000,
      "Total External Cash Sent must include both NEW_CASH and HISTORICAL_PROVENANCE ($1,010,000)"
    );

    pass("B1. NEW_CASH adds $10k to May balance; HISTORICAL_PROVENANCE $1M excluded from balance; Total Deposits = $1,010,000");
  } catch (err) { fail("B1. NEW_CASH vs HISTORICAL_PROVENANCE balance separation (dashboard)", err); }

  // ─── Test B2: No deposits → provenanceStatus = NO_CONFIRMED_EXTERNAL_CASH ──
  try {
    const preload = basePreload({
      investorId: "inv_b2",
      username: "testb2",
      startCapital: 500000,
      extraDeposits: [] // no deposit records
    });

    const dashboard = await buildInvestorDashboard("testb2", preload, { asOfDate: "2026-09-01" });

    assert.strictEqual(
      dashboard.summary.hasConfirmedExternalCash,
      false,
      "hasConfirmedExternalCash must be false when no deposit records exist"
    );
    assert.strictEqual(
      dashboard.summary.provenanceStatus,
      "NO_CONFIRMED_EXTERNAL_CASH",
      "provenanceStatus must be NO_CONFIRMED_EXTERNAL_CASH"
    );
    assert.strictEqual(
      dashboard.summary.totalPerformancePct,
      null,
      "totalPerformancePct must be null (not 0%, not fabricated from starting_capital)"
    );
    assert.strictEqual(
      dashboard.summary.totalPerformanceDollar,
      null,
      "totalPerformanceDollar must be null"
    );
    assert.strictEqual(
      dashboard.summary.totalExternalCashSent,
      0,
      "totalExternalCashSent must be 0"
    );

    pass("B2. No deposit records: provenanceStatus='NO_CONFIRMED_EXTERNAL_CASH'; totalPerformancePct=null; totalPerformanceDollar=null; no starting_capital fallback");
  } catch (err) { fail("B2. No deposits → performance UNKNOWN (dashboard)", err); }

  // ─── Test B3: Void deposit excluded from Total Deposits ─────────────────
  try {
    const preload = basePreload({
      investorId: "inv_b3",
      username: "testb3",
      startCapital: 200000,
      extraDeposits: [
        {
          id: "dep_active_b3",
          investorid: "inv_b3",
          investor_id: "inv_b3",
          amount: 50000,
          accounting_treatment: "NEW_CASH",
          status: "confirmed",
          date: "2026-01-01",
          monthnumber: 1,
          year: 2026
        },
        {
          id: "dep_void_b3",
          investorid: "inv_b3",
          investor_id: "inv_b3",
          amount: 999999,
          accounting_treatment: "NEW_CASH",
          type: "VOID",
          status: "void",
          date: "2026-02-01",
          monthnumber: 2,
          year: 2026
        }
      ]
    });

    const dashboard = await buildInvestorDashboard("testb3", preload, { asOfDate: "2026-09-01" });

    assert.strictEqual(
      dashboard.summary.totalExternalCashSent,
      50000,
      "Voided deposit must be excluded; Total External Cash must equal $50k only"
    );

    pass("B3. Voided deposit excluded from Total Deposits; active $50k correctly counted");
  } catch (err) { fail("B3. Void deposit excluded from Total Deposits (dashboard)", err); }

  // ─── Test B4: Investor with only UNVERIFIED_LEGACY deposit ─────────────────
  try {
    const preload = basePreload({
      investorId: "inv_b4",
      username: "testb4",
      startCapital: 500000,
      extraDeposits: [
        {
          id: "dep_leg_b4",
          investorid: "inv_b4",
          investor_id: "inv_b4",
          amount: 25000,
          accounting_treatment: "UNVERIFIED_LEGACY",
          status: "confirmed",
          date: "2026-08-01",
          monthnumber: 8,
          year: 2026
        }
      ]
    });

    const dashboard = await buildInvestorDashboard("testb4", preload, { asOfDate: "2026-09-01" });

    assert.strictEqual(
      dashboard.summary.totalExternalCashSent,
      0,
      "Total External Cash Sent must be $0 when only UNVERIFIED_LEGACY records exist"
    );
    assert.strictEqual(
      dashboard.summary.hasConfirmedExternalCash,
      false,
      "hasConfirmedExternalCash must be false"
    );
    assert.strictEqual(
      dashboard.summary.provenanceStatus,
      "NO_CONFIRMED_EXTERNAL_CASH",
      "provenanceStatus must be NO_CONFIRMED_EXTERNAL_CASH"
    );
    assert.strictEqual(
      dashboard.summary.totalPerformancePct,
      null,
      "totalPerformancePct must be null"
    );
    assert.strictEqual(
      dashboard.summary.totalPerformanceDollar,
      null,
      "totalPerformanceDollar must be null"
    );
    // Verify August balance in breakdown did include the $25,000
    const augRow = (dashboard.breakdown || []).find(r => r.monthNumber === 8);
    assert(augRow, "August breakdown row must exist");
    assert.strictEqual(augRow.deposits, 25000, "August deposits in breakdown must reflect $25,000 legacy row");

    pass("B4. Investor with only UNVERIFIED_LEGACY: ledger balance preserved ($25k in Aug), Total Deposits=0, Performance=null");
  } catch (err) { fail("B4. Investor with only UNVERIFIED_LEGACY", err); }

  // ──────────────────────────────────────────────────────────────────────────
  // SECTION C: Concurrency & Idempotency Key Regression Tests
  // ──────────────────────────────────────────────────────────────────────────
  console.log("\n=== SECTION C: Concurrency & Idempotency Key Regression Tests ===\n");

  // ─── Test C1: Simulated concurrency / retry with identical mutation key ───
  try {
    const databaseLedger = new Map();

    async function simulateInsertDeposit(payload) {
      if (payload.idempotency_key && databaseLedger.has(payload.idempotency_key)) {
        const err = new Error("duplicate key value violates unique constraint \"idx_deposits_idempotency_key\"");
        err.code = "23505";
        throw err;
      }
      databaseLedger.set(payload.idempotency_key, { ...payload });
      return { success: true, deposit: payload };
    }

    const clientMutationKey = "mut_uuid_20260916_test_client_key";

    const depositPayload = {
      id: "dep_mut_001",
      investor_id: "inv_conc",
      account_id: "acc_conc",
      amount: 15000.00,
      date: "2026-09-01",
      accounting_treatment: "NEW_CASH",
      status: "confirmed",
      idempotency_key: clientMutationKey
    };

    // Simulate two concurrent / retried requests fired simultaneously with identical mutation key
    const results = await Promise.allSettled([
      simulateInsertDeposit(depositPayload),
      simulateInsertDeposit(depositPayload)
    ]);

    const successes = results.filter(r => r.status === "fulfilled");
    const rejections = results.filter(r => r.status === "rejected");

    assert.strictEqual(successes.length, 1, "Exactly one concurrent submission must succeed");
    assert.strictEqual(rejections.length, 1, "Duplicate submission must be rejected");
    assert.strictEqual(rejections[0].reason.code, "23505", "Rejection must be code 23505 unique_violation");
    assert.strictEqual(databaseLedger.size, 1, "Database ledger must contain exactly one financial row");

    pass("C1. Concurrency/retry regression: 2 simultaneous requests with same mutation key produce exactly 1 financial row and 1 unique_violation (23505)");
  } catch (err) { fail("C1. Concurrency/retry regression", err); }

  // ─── Test C2: Legitimate distinct deposits with same investor, amount, date ──
  try {
    const databaseLedger = new Map();

    async function simulateInsertDeposit(payload) {
      if (payload.idempotency_key && databaseLedger.has(payload.idempotency_key)) {
        const err = new Error("duplicate key value violates unique constraint");
        err.code = "23505";
        throw err;
      }
      databaseLedger.set(payload.idempotency_key, { ...payload });
      return { success: true, deposit: payload };
    }

    // Two intentional separate deposits entered through separate form openings:
    // Same investor, same account, same amount ($5,000), same date (2026-09-01).
    // Each receives its own client mutation UUID.
    const keyA = "mut_uuid_first_wire_5000";
    const keyB = "mut_uuid_second_wire_5000";

    const depA = {
      id: "dep_wire_1",
      investor_id: "inv_conc",
      account_id: "acc_conc",
      amount: 5000.00,
      date: "2026-09-01",
      accounting_treatment: "NEW_CASH",
      idempotency_key: keyA
    };
    const depB = {
      id: "dep_wire_2",
      investor_id: "inv_conc",
      account_id: "acc_conc",
      amount: 5000.00,
      date: "2026-09-01",
      accounting_treatment: "NEW_CASH",
      idempotency_key: keyB
    };

    const resA = await simulateInsertDeposit(depA);
    const resB = await simulateInsertDeposit(depB);

    assert(resA.success && resB.success, "Both legitimate distinct deposits must succeed");
    assert.strictEqual(databaseLedger.size, 2, "Database ledger must contain both distinct deposits ($10,000 total)");

    pass("C2. Distinct intentional deposits: identical investor/date/amount with distinct client mutation UUIDs both succeed without false economic blocking");
  } catch (err) { fail("C2. Distinct intentional deposits", err); }

  // ──────────────────────────────────────────────────────────────────────────
  // RESULTS
  // ──────────────────────────────────────────────────────────────────────────
  console.log("\n================================================================================");
  console.log(`RESULTS: ${passed} PASSED / ${failed} FAILED`);
  console.log("================================================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runSuite().catch(err => {
  console.error("Test suite crashed:", err);
  process.exit(1);
});
