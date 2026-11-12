import assert from "node:assert";
import Decimal from "decimal.js";
import { buildInvestorDashboard } from "../lib/dashboard.js";
import { calculateUnpostedOctoberCandidate } from "./helpers/unposted-october-audit.mjs";

console.log("================================================================================");
console.log("OFFLINE TEST SUITE: ALL 15 COMMISSION RECIPIENTS (STRICT BOUNDARY & FAIL-CLOSED)");
console.log("================================================================================\n");

// Expected candidate amounts under candidate calculation (strict pre-start accounts filtered = $0.00):
const expectedRecipients = [
  { id: "inv_015f3774", username: "stoneandco", name: "Stone and Co Owners Account", janSep: 408140.88, oct: 55973.85 },
  { id: "inv_920b8af8", username: "rwamsley",   name: "Ross Wamsley",               janSep: 407405.70, oct: 55448.90 },
  { id: "inv_e1d4f2af", username: "jrichards",  name: "josh richards",              janSep: 99569.30,  oct: 12420.77 },
  { id: "stout001",     username: "jstout",     name: "Joshua Stout",               janSep: 42852.41,  oct: 9241.57, legacyOct: 8331.86 },
  { id: "inv_d0f857c7", username: "jwamsley",   name: "Jacob Wamsley",              janSep: 4968.96,   oct: 1270.73 },
  { id: "inv_d2ab6da4", username: "mbeck",      name: "Michael Beck",               janSep: 14595.55,  oct: 1174.74 },
  { id: "inv_4d52f6a4", username: "dtownley",   name: "David Townley",              janSep: 12309.34,  oct: 1135.06 },
  { id: "inv_a79798ca", username: "tboardwalk", name: "ted Boardwalk",             janSep: 5686.63,   oct: 1083.41 },
  { id: "inv_df9fbf05", username: "valdes",     name: "Valdes Valdes",              janSep: 16989.94,  oct: 1067.45 },
  { id: "inv_d3ec0cf8", username: "arichards",  name: "Adam Richards",              janSep: 2924.97,   oct: 502.24 },
  { id: "inv_141417dc", username: "nguyer",     name: "Nelson Guyer",               janSep: 591.66,    oct: 187.47 },
  { id: "inv_6a1b838a", username: "vtaylor",    name: "Val  Taylor",                janSep: 2587.42,   oct: 155.17 },
  { id: "inv_57a1a49a", username: "bkimball",   name: "Bill and Mary Kimball",      janSep: 2800.24,   oct: 145.94 },
  { id: "inv_a7e429ce", username: "jcolby",     name: "Jim Colby",                  janSep: 839.08,    oct: 82.82 },
  { id: "inv_764c2992", username: "svaldes",    name: "Scott Valdes",               janSep: 0.00,      oct: 0.00 }
];

async function runTests() {
  let passed = 0;

  for (const r of expectedRecipients) {
    console.log(`--- Testing Dashboard & Candidate for ${r.name} (${r.username}) ---`);

    // Construct hermetic offline preloaded fixture
    const mockBasis = r.oct > 0 ? new Decimal(r.oct).div(new Decimal("0.00305")).toDecimalPlaces(2).toNumber() : 0;

    const preloaded = {
      rawInvestors: [
        {
          id: r.id,
          portal_username: r.username,
          first_name: r.name.split(" ")[0],
          last_name: r.name.split(" ").slice(1).join(" "),
          split_pct: 100
        },
        ...(r.oct > 0 ? [{
          id: `src_for_${r.id}`,
          portal_username: `src_${r.username}`,
          split_pct: 100,
          start_date: "2026-01-01"
        }] : []),
        // Pre-start account that must NOT generate commission
        {
          id: `src_prestart_${r.id}`,
          portal_username: `prestart_${r.username}`,
          split_pct: 100,
          start_date: "2026-11-01"
        }
      ],
      accounts: [
        {
          id: `acc_${r.id}`,
          investor_id: r.id,
          starting_capital: 100000,
          is_commission: true
        }
      ],
      returnsSheet: [
        { year: 2026, month_number: 1, gross_return_pct: 3.29, locked: true },
        { year: 2026, month_number: 9, gross_return_pct: 3.07, locked: true },
        { year: 2026, month_number: 10, gross_return_pct: 3.05, locked: false }
      ],
      depositsSheet: [],
      withdrawalsSheet: [],
      historyTable: [
        ...(r.oct > 0 ? [{
          investor_id: `src_for_${r.id}`,
          year: 2026,
          month_number: 10,
          opening_balance: mockBasis,
          deposits: 0,
          withdrawals: 0
        }] : []),
        {
          investor_id: `src_prestart_${r.id}`,
          year: 2026,
          month_number: 10,
          opening_balance: 50000,
          deposits: 0,
          withdrawals: 0
        }
      ],
      commissionEarningsTable: [
        // Seed active Jan-Sep earnings matching authoritative ledger
        ...(r.janSep > 0 ? [{
          recipient_id: r.id,
          year: 2026,
          month_number: 9,
          amount: r.janSep,
          status: "ACTIVE"
        }] : []),
        // Seed superseded Oct earnings (must be ignored)
        {
          recipient_id: r.id,
          year: 2026,
          month_number: 10,
          amount: 9999.99,
          status: "SUPERSEDED"
        }
      ],
      commissionSharesTable: [
        ...(r.oct > 0 ? [{
          source_investor_id: `src_for_${r.id}`,
          recipient_investor_id: r.id,
          commission_percent: 10,
          status: "active",
          effective_start_date: "2026-01-01"
        }] : []),
        {
          source_investor_id: `src_prestart_${r.id}`,
          recipient_investor_id: r.id,
          commission_percent: 10,
          status: "active",
          effective_start_date: "2026-10-19"
        }
      ],
      commissionRulesTable: [],
      cutoverAdjustments: [],
      asOfDate: "2026-11-05T00:00:00Z"
    };

    const d = await buildInvestorDashboard(r.username, preloaded, { asOfDate: "2026-11-05T00:00:00Z" });

    // 1. HERMETIC BOOKED ISOLATION: Assert booked month is STRICTLY $0.00
    assert.strictEqual(
      d.summary.bookedCommissionsEarnedMonth,
      0,
      `Booked October commission for ${r.name} must be $0.00 when October ledger rows are superseded`
    );
    assert.strictEqual(
      d.summary.commissionsUnavailable,
      true,
      `Commissions must be unavailable under fail-closed safeguard for ${r.name}`
    );
    assert.strictEqual(
      d.summary.commissionsEarnedMonth,
      null,
      `Uncertified commissionsEarnedMonth must be null for ${r.name}`
    );
    console.log(`  ✅ Booked October Comm:  $${d.summary.bookedCommissionsEarnedMonth.toFixed(2)} (strictly $0.00 from active ledger)`);

    // 2. HERMETIC BOOKED YTD ISOLATION: Assert booked YTD matches active Jan-Sep ledger exactly
    assert.strictEqual(
      d.summary.bookedCommissionsEarnedYear,
      r.janSep,
      `Booked YTD commission for ${r.name} must match settled Jan-Sep ledger $${r.janSep}`
    );
    assert.strictEqual(
      d.summary.commissionsEarnedYear,
      null,
      `Uncertified commissionsEarnedYear must be null for ${r.name}`
    );
    console.log(`  ✅ Booked YTD Comm:      $${d.summary.bookedCommissionsEarnedYear.toFixed(2)} (strictly matches Jan-Sep ledger)`);

    // 3. HERMETIC SERIALIZATION GUARD: Assert investor response contains NO candidate field or amount
    const serializedJson = JSON.stringify(d);
    assert.strictEqual(d.summary._internalCandidateCommissionsEarnedMonth, undefined, "No candidate field allowed on summary");
    assert.strictEqual(serializedJson.includes("candidate"), false, "Serialized JSON must not contain candidate field");
    console.log(`  ✅ Investor Response:    Strictly devoid of unposted candidate fields`);

    // 4. Standalone calculation helper produces expected candidate
    const cand = calculateUnpostedOctoberCandidate({
      recipientId: r.id,
      shares: preloaded.commissionSharesTable,
      rawInvestors: preloaded.rawInvestors,
      historyTable: preloaded.historyTable,
      candidateGrossReturnPct: 3.05,
      options: r.username === "jstout" ? { stoutTreatment: "date_effective" } : {}
    });

    assert.strictEqual(cand.status, "AVAILABLE");
    assert.strictEqual(
      cand.totalAmount,
      r.oct,
      `Candidate October calculation must equal $${r.oct} for ${r.name} (got ${cand.totalAmount})`
    );
    assert.strictEqual(cand.estimateStatus, "UNPOSTED_ESTIMATE");
    assert.strictEqual(cand.returnRateLocked, false);
    console.log(`  ✅ Standalone Candidate: $${cand.totalAmount.toFixed(2)} (matches expected candidate $${r.oct.toFixed(2)}, marked UNPOSTED_ESTIMATE)`);

    passed++;
  }

  // Test Joshua Stout with policy alternatives
  console.log("\n--- Testing Joshua Stout Policy Handling ---");
  {
    const r = expectedRecipients.find(x => x.username === "jstout");
    const preloadedStout = {
      rawInvestors: [
        { id: r.id, portal_username: r.username, first_name: "Joshua", last_name: "Stout", split_pct: 100, start_date: "2026-01-01" },
        { id: "src_stout_sep", portal_username: "src_stout_sep", split_pct: 100, start_date: "2026-01-01" },
        { id: "src_stout_oct", portal_username: "src_stout_oct", split_pct: 100, start_date: "2026-10-01" }
      ],
      accounts: [{ id: `acc_${r.id}`, investor_id: r.id, starting_capital: 100000, is_commission: true }],
      returnsSheet: [
        { year: 2026, month_number: 10, gross_return_pct: 3.05, locked: false }
      ],
      depositsSheet: [],
      withdrawalsSheet: [],
      historyTable: [
        { investor_id: "src_stout_sep", year: 2026, month_number: 10, opening_balance: new Decimal("8331.86").div(new Decimal("0.00305")).toDecimalPlaces(2).toNumber() },
        { investor_id: "src_stout_oct", year: 2026, month_number: 10, opening_balance: new Decimal("909.71").div(new Decimal("0.00305")).toDecimalPlaces(2).toNumber() }
      ],
      commissionEarningsTable: [
        { recipient_id: r.id, year: 2026, month_number: 9, amount: 42852.41, status: "ACTIVE" },
        { recipient_id: r.id, year: 2026, month_number: 10, amount: 1373.39, status: "SUPERSEDED" }
      ],
      commissionSharesTable: [
        { source_investor_id: "src_stout_sep", recipient_investor_id: r.id, commission_percent: 10, status: "active", effective_start_date: "2026-01-01" },
        { source_investor_id: "src_stout_oct", recipient_investor_id: r.id, commission_percent: 10, status: "active", effective_start_date: "2026-10-15" }
      ],
      commissionRulesTable: [],
      cutoverAdjustments: [],
      asOfDate: "2026-11-05T00:00:00Z"
    };

    // A. Without explicit policy selection: MUST fail-closed with UNRESOLVED_POLICY_SELECTION_REQUIRED and totalAmount: null
    const candUnresolved = calculateUnpostedOctoberCandidate({
      recipientId: r.id,
      shares: preloadedStout.commissionSharesTable,
      rawInvestors: preloadedStout.rawInvestors,
      historyTable: preloadedStout.historyTable,
      candidateGrossReturnPct: 3.05
    });
    assert.strictEqual(candUnresolved.status, "UNRESOLVED_POLICY_SELECTION_REQUIRED");
    assert.strictEqual(candUnresolved.totalAmount, null);
    assert.strictEqual(candUnresolved.stoutAlternatives.dateEffective85, 9241.57);
    assert.strictEqual(candUnresolved.stoutAlternatives.legacy75, 8331.86);
    assert.strictEqual(candUnresolved.stoutAlternatives.delta, 909.71);
    console.log("  ✅ Stout without policy option fails closed with UNRESOLVED_POLICY_SELECTION_REQUIRED (totalAmount: null)");

    // B. With legacy_75 explicit option
    const candLegacy = calculateUnpostedOctoberCandidate({
      recipientId: r.id,
      shares: preloadedStout.commissionSharesTable,
      rawInvestors: preloadedStout.rawInvestors,
      historyTable: preloadedStout.historyTable,
      candidateGrossReturnPct: 3.05,
      options: { stoutTreatment: "legacy_75" }
    });
    assert.strictEqual(candLegacy.totalAmount, 8331.86, "Stout legacy baseline candidate must dynamically compute $8,331.86");
    assert.strictEqual(candLegacy.policyStatus.includes("UNRESOLVED"), true, "Policy status must explicitly state UNRESOLVED");

    // C. With date_effective explicit option
    const candDateEff = calculateUnpostedOctoberCandidate({
      recipientId: r.id,
      shares: preloadedStout.commissionSharesTable,
      rawInvestors: preloadedStout.rawInvestors,
      historyTable: preloadedStout.historyTable,
      candidateGrossReturnPct: 3.05,
      options: { stoutTreatment: "date_effective" }
    });
    assert.strictEqual(candDateEff.totalAmount, 9241.57, "Stout date-effective candidate must dynamically compute $9,241.57");

    console.log(`  ✅ Stout Date-Effective Candidate: $${candDateEff.totalAmount.toFixed(2)} (85 rules alternative)`);
    console.log(`  ✅ Stout Legacy Candidate:         $${candLegacy.totalAmount.toFixed(2)} (75 rules alternative)`);
    console.log(`  ✅ Stout Policy Status:            ${candLegacy.policyStatus}`);
    passed++;
  }

  // Test Fail-Closed All-Or-Nothing Inputs
  console.log("\n--- Testing Fail-Closed All-Or-Nothing Candidate Inputs ---");
  {
    // A. Missing gross return pct -> UNAVAILABLE, totalAmount: null
    const resA = calculateUnpostedOctoberCandidate({
      recipientId: "jstout",
      shares: [],
      rawInvestors: [],
      historyTable: []
      // candidateGrossReturnPct omitted
    });
    assert.strictEqual(resA.status, "UNAVAILABLE");
    assert.strictEqual(resA.totalAmount, null);
    assert.strictEqual(resA.reason, "MISSING_OR_INVALID_GROSS_RETURN_RATE");
    console.log("  ✅ Missing grossReturnPct fails closed with UNAVAILABLE (totalAmount: null)");

    // B. Missing split percentage -> UNAVAILABLE, totalAmount: null (all-or-nothing, never partial)
    const resB = calculateUnpostedOctoberCandidate({
      recipientId: "recip_1",
      candidateGrossReturnPct: 3.05,
      shares: [{ source_investor_id: "src_1", recipient_investor_id: "recip_1", commission_percent: 10, status: "active", effective_start_date: "2026-01-01" }],
      rawInvestors: [{ id: "src_1", portal_username: "src_1", start_date: "2026-01-01" /* missing split_pct */ }],
      historyTable: [{ investor_id: "src_1", year: 2026, month_number: 10, opening_balance: 100000 }]
    });
    assert.strictEqual(resB.status, "UNAVAILABLE");
    assert.strictEqual(resB.totalAmount, null, "Missing split_pct must return UNAVAILABLE with totalAmount null (all-or-nothing)");
    assert.strictEqual(resB.reason.includes("MISSING_OR_INVALID_SPLIT_PCT"), true);
    console.log("  ✅ Missing split_pct fails closed with UNAVAILABLE (all-or-nothing)");

    // C. Non-positive opening balance -> UNAVAILABLE, totalAmount: null (never substitute ending_balance)
    const resC = calculateUnpostedOctoberCandidate({
      recipientId: "recip_1",
      candidateGrossReturnPct: 3.05,
      shares: [{ source_investor_id: "src_1", recipient_investor_id: "recip_1", commission_percent: 10, status: "active", effective_start_date: "2026-01-01" }],
      rawInvestors: [{ id: "src_1", portal_username: "src_1", start_date: "2026-01-01", split_pct: 100 }],
      historyTable: [{ investor_id: "src_1", year: 2026, month_number: 10, opening_balance: 0, ending_balance: 50000 }]
    });
    assert.strictEqual(resC.status, "UNAVAILABLE");
    assert.strictEqual(resC.totalAmount, null, "Non-positive opening balance must return UNAVAILABLE with totalAmount null");
    assert.strictEqual(resC.reason.includes("MISSING_OR_NON_POSITIVE_OPENING_BALANCE"), true);
    console.log("  ✅ Zero opening_balance fails closed with UNAVAILABLE (never substitutes ending_balance)");

    // D. Pre-start source (Nov 1) -> AVAILABLE, totalAmount: 0 (legitimate $0.00 contribution)
    const resD = calculateUnpostedOctoberCandidate({
      recipientId: "recip_1",
      candidateGrossReturnPct: 3.05,
      shares: [{ source_investor_id: "src_nov", recipient_investor_id: "recip_1", commission_percent: 10, status: "active", effective_start_date: "2026-10-19" }],
      rawInvestors: [{ id: "src_nov", portal_username: "src_nov", start_date: "2026-11-01", split_pct: 100 }],
      historyTable: [{ investor_id: "src_nov", year: 2026, month_number: 10, opening_balance: 50000 }]
    });
    assert.strictEqual(resD.status, "AVAILABLE");
    assert.strictEqual(resD.totalAmount, 0, "Pre-start source (2026-11-01) legitimately contributes $0.00");
    console.log("  ✅ Pre-start source account (2026-11-01) legitimately earns $0.00 without making candidate UNAVAILABLE");

    // E. Missing start_date -> UNAVAILABLE, totalAmount: null
    const resE = calculateUnpostedOctoberCandidate({
      recipientId: "recip_1",
      candidateGrossReturnPct: 3.05,
      shares: [{ source_investor_id: "src_nostart", recipient_investor_id: "recip_1", commission_percent: 10, status: "active", effective_start_date: "2026-10-01" }],
      rawInvestors: [{ id: "src_nostart", portal_username: "src_nostart", split_pct: 100 /* missing start_date */ }],
      historyTable: [{ investor_id: "src_nostart", year: 2026, month_number: 10, opening_balance: 50000 }]
    });
    assert.strictEqual(resE.status, "UNAVAILABLE");
    assert.strictEqual(resE.totalAmount, null);
    assert.strictEqual(resE.reason.includes("MISSING_START_DATE"), true);
    console.log("  ✅ Missing start_date fails closed with UNAVAILABLE (totalAmount: null)");

    passed++;
  }

  console.log(`\n================================================================================`);
  console.log(`ALL TESTS PASSED: ${passed}/${expectedRecipients.length + 2} checks succeeded.`);
  console.log(`================================================================================\n`);
}

runTests().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
