import assert from "node:assert";
import Decimal from "decimal.js";
import { buildInvestorDashboard } from "../lib/dashboard.js";

console.log("================================================================================");
console.log("OFFLINE TEST SUITE: ALL 15 COMMISSION RECIPIENTS DISPLAY RECONCILIATION");
console.log("================================================================================\n");

const expectedRecipients = [
  { id: "inv_015f3774", username: "stoneandco", name: "Stone and Co Owners Account", janSep: 408140.88, oct: 56501.04 },
  { id: "inv_920b8af8", username: "rwamsley",   name: "Ross Wamsley",               janSep: 407405.70, oct: 55974.74 },
  { id: "inv_e1d4f2af", username: "jrichards",  name: "josh richards",              janSep: 99569.30,  oct: 12573.11 },
  { id: "stout001",     username: "jstout",     name: "Joshua Stout",               janSep: 42852.41,  oct: 9308.69, legacyOct: 8331.86 },
  { id: "inv_df9fbf05", username: "valdes",     name: "Valdes Valdes",              janSep: 16989.94,  oct: 1067.45 },
  { id: "inv_d2ab6da4", username: "mbeck",      name: "Michael Beck",               janSep: 14595.55,  oct: 1174.74 },
  { id: "inv_4d52f6a4", username: "dtownley",   name: "David Townley",              janSep: 12309.34,  oct: 1135.06 },
  { id: "inv_a79798ca", username: "tboardwalk", name: "ted Boardwalk",             janSep: 5686.63,   oct: 1087.22 },
  { id: "inv_d0f857c7", username: "jwamsley",   name: "Jacob Wamsley",              janSep: 4968.96,   oct: 1270.73 },
  { id: "inv_d3ec0cf8", username: "arichards",  name: "Adam Richards",              janSep: 2924.97,   oct: 502.24 },
  { id: "inv_57a1a49a", username: "bkimball",   name: "Bill and Mary Kimball",      janSep: 2800.24,   oct: 145.94 },
  { id: "inv_6a1b838a", username: "vtaylor",    name: "Val  Taylor",                janSep: 2587.42,   oct: 155.17 },
  { id: "inv_a7e429ce", username: "jcolby",     name: "Jim Colby",                  janSep: 839.08,    oct: 82.82 },
  { id: "inv_141417dc", username: "nguyer",     name: "Nelson Guyer",               janSep: 591.66,    oct: 187.47 },
  { id: "inv_764c2992", username: "svaldes",    name: "Scott Valdes",               janSep: 0.00,      oct: 0.00 }
];

async function runTests() {
  let passed = 0;

  for (const r of expectedRecipients) {
    console.log(`--- Testing Dashboard for ${r.name} (${r.username}) ---`);
    
    // Construct hermetic offline preloaded fixture
    const preloaded = {
      rawInvestors: [{
        id: r.id,
        portal_username: r.username,
        first_name: r.name.split(" ")[0],
        last_name: r.name.split(" ").slice(1).join(" "),
        split_pct: 100
      }],
      accounts: [{
        id: `acc_${r.id}`,
        investor_id: r.id,
        starting_capital: 100000,
        is_commission: true
      }],
      returnsSheet: [
        { year: 2026, month_number: 1, gross_return_pct: 3.29, locked: true },
        { year: 2026, month_number: 9, gross_return_pct: 3.07, locked: true },
        { year: 2026, month_number: 10, gross_return_pct: 3.05, locked: false }
      ],
      depositsSheet: [],
      withdrawalsSheet: [],
      historyTable: [],
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
      commissionSharesTable: [],
      commissionRulesTable: [],
      cutoverAdjustments: [],
      asOfDate: "2026-11-05T00:00:00Z"
    };

    const d = await buildInvestorDashboard(r.username, preloaded, { asOfDate: "2026-11-05T00:00:00Z" });

    // Verify October-earned monthly card
    assert.strictEqual(
      d.summary.bookedCommissionsEarnedMonth,
      r.oct,
      `October earned must equal $${r.oct} for ${r.name}`
    );
    console.log(`  ✅ October Earned Comm: $${d.summary.bookedCommissionsEarnedMonth.toFixed(2)} (matches expected $${r.oct.toFixed(2)})`);

    // Verify Booked YTD card strictly equals active ledger rows (Jan-Sep), never including unposted October
    assert.strictEqual(
      d.summary.bookedCommissionsEarnedYear,
      r.janSep,
      `Booked YTD must equal settled Jan-Sep ledger ($${r.janSep}) for ${r.name}, not unposted October`
    );
    console.log(`  ✅ Booked YTD Comm:     $${d.summary.bookedCommissionsEarnedYear.toFixed(2)} (matches settled Jan–Sep ledger $${r.janSep.toFixed(2)})`);

    // Verify month naming
    assert.strictEqual(d.summary.commMonthName, "October", "commMonthName must be October");
    assert.strictEqual(d.summary.commissionsEarnedMonthName, "October", "commissionsEarnedMonthName must be October");
    passed++;
  }

  // Test Stout with legacy 75-share baseline option
  console.log("\n--- Testing Joshua Stout with legacy 75-share baseline option ---");
  {
    const preloadedStout = {
      rawInvestors: [{ id: "stout001", portal_username: "jstout", split_pct: 100 }],
      accounts: [{ id: "acc_stout", investor_id: "stout001", starting_capital: 100000, is_commission: true }],
      returnsSheet: [
        { year: 2026, month_number: 9, gross_return_pct: 3.07, locked: true },
        { year: 2026, month_number: 10, gross_return_pct: 3.05, locked: false }
      ],
      depositsSheet: [],
      withdrawalsSheet: [],
      historyTable: [],
      commissionEarningsTable: [
        { recipient_id: "stout001", year: 2026, month_number: 9, amount: 42852.41, status: "ACTIVE" }
      ],
      commissionSharesTable: [],
      commissionRulesTable: [],
      cutoverAdjustments: [],
      asOfDate: "2026-11-05T00:00:00Z"
    };

    const dLegacy = await buildInvestorDashboard("jstout", preloadedStout, {
      asOfDate: "2026-11-05T00:00:00Z",
      useLegacyStoutBaseline: true
    });

    assert.strictEqual(
      dLegacy.summary.bookedCommissionsEarnedMonth,
      8331.86,
      "Legacy Stout baseline must show $8,331.86"
    );
    assert.strictEqual(
      dLegacy.summary.bookedCommissionsEarnedYear,
      42852.41,
      "Booked YTD must remain strictly $42,852.41"
    );
    console.log(`  ✅ Stout Legacy 75-share October Comm: $${dLegacy.summary.bookedCommissionsEarnedMonth.toFixed(2)} (matches expected $8,331.86)`);
    console.log(`  ✅ Stout Legacy Booked YTD:             $${dLegacy.summary.bookedCommissionsEarnedYear.toFixed(2)} (matches expected $42,852.41)`);
    passed++;
  }

  console.log(`\n================================================================================`);
  console.log(`ALL TESTS PASSED: ${passed}/${expectedRecipients.length + 1} checks succeeded.`);
  console.log(`================================================================================\n`);
}

runTests().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
