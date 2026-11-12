import assert from "node:assert";
import Decimal from "decimal.js";
import { buildInvestorDashboard } from "../lib/dashboard.js";
import { calculateUnpostedOctoberCandidate } from "./helpers/unposted-october-audit.mjs";

console.log("================================================================================");
console.log("OFFLINE TEST: DYNAMIC SHARED OCTOBER COMMISSION CALCULATION");
console.log("================================================================================\n");

// 1. Hermetic Fixture with all source accounts and share rules
// Include both valid October accounts and pre-start November accounts to verify strict filtering.
const baseReturns = Array.from({ length: 12 }, (_, i) => ({
  year: 2026,
  month_number: i + 1,
  gross_return_pct: i === 9 ? 3.05 : 3.00,
  locked: i < 9
}));

// Source accounts
const sources = [
  { id: "src_valid_1", portal_username: "valid1", split_pct: 100, start_date: "2026-01-01", balance: 100000 },
  { id: "src_valid_2", portal_username: "valid2", split_pct: 50,  start_date: "2026-10-01", balance: 50000 },
  // Pre-start account (starts November 1, 2026) -> must yield $0.00 in October
  { id: "src_nov_prestart", portal_username: "novpre", split_pct: 50, start_date: "2026-11-01", balance: 10000 }
];

// Recipient: Alice (should earn from valid1 and valid2, but $0 from novpre)
// valid1: 100,000 * 3.05% * 100% split * 10% comm = $305.00
// valid2: 50,000 * 3.05% * 50% split * 20% comm = $152.50
// novpre: 10,000 * 3.05% * 50% split * 10% comm = $0.00 (PRE-START GUARD)
// Total candidate expected = $305.00 + $152.50 = $457.50
const preloaded = {
  rawInvestors: [
    { id: "recip_alice", portal_username: "alice", first_name: "Alice", last_name: "Smith", split_pct: 100, start_date: "2026-01-01" },
    ...sources.map(s => ({ id: s.id, portal_username: s.portal_username, split_pct: s.split_pct, start_date: s.start_date }))
  ],
  accounts: [
    { id: "acc_alice", investor_id: "recip_alice", starting_capital: 10000, is_commission: true },
    ...sources.map(s => ({ id: s.id, investor_id: s.id, starting_capital: s.balance, is_commission: false }))
  ],
  returnsSheet: baseReturns,
  depositsSheet: [],
  withdrawalsSheet: [],
  historyTable: [
    ...sources.map(s => ({ investor_id: s.id, year: 2026, month_number: 10, opening_balance: s.balance, deposits: 0, withdrawals: 0 }))
  ],
  commissionEarningsTable: [
    // Jan-Sep active booked ledger
    { recipient_id: "recip_alice", year: 2026, month_number: 9, amount: 2500.00, status: "ACTIVE" },
    // October superseded row (must be ignored)
    { recipient_id: "recip_alice", year: 2026, month_number: 10, amount: 999.00, status: "SUPERSEDED" }
  ],
  commissionSharesTable: [
    { source_investor_id: "src_valid_1",      recipient_investor_id: "recip_alice", commission_percent: 10, status: "active", effective_start_date: "2026-01-01" },
    { source_investor_id: "src_valid_2",      recipient_investor_id: "recip_alice", commission_percent: 20, status: "active", effective_start_date: "2026-10-01" },
    { source_investor_id: "src_nov_prestart", recipient_investor_id: "recip_alice", commission_percent: 10, status: "active", effective_start_date: "2026-10-19" }
  ],
  commissionRulesTable: [],
  cutoverAdjustments: [],
  asOfDate: "2026-11-05T00:00:00Z"
};

async function run() {
  const dash = await buildInvestorDashboard("alice", preloaded, { asOfDate: "2026-11-05T00:00:00Z" });

  console.log("Booked October (Active Ledger Only):", dash.summary.bookedCommissionsEarnedMonth);
  console.log("Booked YTD (Strict Ledger Jan-Sep):", dash.summary.bookedCommissionsEarnedYear);

  assert.strictEqual(
    dash.summary.bookedCommissionsEarnedMonth,
    0,
    "Booked October earned commission must be $0.00 when October ledger rows are superseded"
  );
  console.log("✅ 1. Booked October commission strictly derived from active ledger ($0.00)");

  assert.strictEqual(
    dash.summary.bookedCommissionsEarnedYear,
    2500.00,
    "Booked YTD must strictly equal active Jan-Sep ledger ($2,500.00), excluding unposted October"
  );
  console.log("✅ 2. Booked YTD strictly retains active ledger ($2,500.00), excluding unposted October");

  // Verify investor response is devoid of candidate fields
  assert.strictEqual(dash.summary._internalCandidateCommissionsEarnedMonth, undefined);
  assert.strictEqual(JSON.stringify(dash).includes("candidate"), false);
  console.log("✅ 3. Investor response is completely decoupled from unposted candidate");

  // Verify standalone candidate calculation helper
  const cand = calculateUnpostedOctoberCandidate({
    recipientId: "recip_alice",
    shares: preloaded.commissionSharesTable,
    rawInvestors: preloaded.rawInvestors,
    historyTable: preloaded.historyTable,
    candidateGrossReturnPct: 3.05
  });

  assert.strictEqual(cand.status, "AVAILABLE");
  assert.strictEqual(
    cand.totalAmount,
    457.50,
    "Dynamic October candidate commission must equal exactly $457.50 ($305.00 + $152.50 + $0.00)"
  );
  assert.strictEqual(cand.estimateStatus, "UNPOSTED_ESTIMATE");
  assert.strictEqual(cand.returnRateLocked, false);
  console.log("✅ 4. Dynamic shared candidate evaluates active rules correctly ($457.50, UNPOSTED_ESTIMATE)");

  // Verify Stout policy handling in standalone helper
  const stoutPreloaded = {
    ...preloaded,
    rawInvestors: [
      { id: "stout001", portal_username: "jstout", first_name: "Joshua", last_name: "Stout", split_pct: 100, start_date: "2026-01-01" },
      ...sources.map(s => ({ id: s.id, portal_username: s.portal_username, split_pct: s.split_pct, start_date: s.start_date }))
    ],
    commissionSharesTable: [
      { source_investor_id: "src_valid_1", recipient_investor_id: "stout001", commission_percent: 10, status: "active", effective_start_date: "2026-01-01" },
      // Mid-October addition: excluded under legacy_75, included under date_effective
      { source_investor_id: "src_valid_2", recipient_investor_id: "stout001", commission_percent: 20, status: "active", effective_start_date: "2026-10-15" }
    ]
  };

  // Stout without options -> UNRESOLVED_POLICY_SELECTION_REQUIRED, totalAmount: null
  const stoutUnresolved = calculateUnpostedOctoberCandidate({
    recipientId: "stout001",
    shares: stoutPreloaded.commissionSharesTable,
    rawInvestors: stoutPreloaded.rawInvestors,
    historyTable: stoutPreloaded.historyTable,
    candidateGrossReturnPct: 3.05
  });
  assert.strictEqual(stoutUnresolved.status, "UNRESOLVED_POLICY_SELECTION_REQUIRED");
  assert.strictEqual(stoutUnresolved.totalAmount, null);
  assert.strictEqual(stoutUnresolved.stoutAlternatives.legacy75, 305.00);
  assert.strictEqual(stoutUnresolved.stoutAlternatives.dateEffective85, 457.50);
  console.log("✅ 5. Stout without policy option fails closed with UNRESOLVED_POLICY_SELECTION_REQUIRED");

  // Stout with legacy_75
  const stoutLegacyCand = calculateUnpostedOctoberCandidate({
    recipientId: "stout001",
    shares: stoutPreloaded.commissionSharesTable,
    rawInvestors: stoutPreloaded.rawInvestors,
    historyTable: stoutPreloaded.historyTable,
    candidateGrossReturnPct: 3.05,
    options: { stoutTreatment: "legacy_75" }
  });

  assert.strictEqual(
    stoutLegacyCand.totalAmount,
    305.00,
    "Stout legacy baseline candidate dynamically excludes mid-October rule ($305.00)"
  );
  assert.strictEqual(
    stoutLegacyCand.policyStatus.includes("UNRESOLVED"),
    true,
    "Stout policy status must be marked UNRESOLVED"
  );
  console.log("✅ 6. Stout legacy baseline option supported dynamically ($305.00 candidate, policy UNRESOLVED)");

  // Stout with date_effective
  const stoutDateEffCand = calculateUnpostedOctoberCandidate({
    recipientId: "stout001",
    shares: stoutPreloaded.commissionSharesTable,
    rawInvestors: stoutPreloaded.rawInvestors,
    historyTable: stoutPreloaded.historyTable,
    candidateGrossReturnPct: 3.05,
    options: { stoutTreatment: "date_effective" }
  });
  assert.strictEqual(stoutDateEffCand.totalAmount, 457.50);
  console.log("✅ 7. Stout date-effective option supported dynamically ($457.50 candidate, policy UNRESOLVED)");

  console.log("\n================================================================================");
  console.log("ALL DYNAMIC CALCULATION OFFLINE TESTS PASSED (100%)");
  console.log("================================================================================\n");
}

run().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
