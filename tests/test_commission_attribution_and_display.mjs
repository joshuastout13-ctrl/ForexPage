import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Decimal from "decimal.js";
import { buildInvestorDashboard } from "../lib/dashboard.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

const INDEX_HTML = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");

function extractPrevCommSnippetFromIndexHtml() {
  const marker = "// Prior month commission capitalization logic:";
  const markerIdx = INDEX_HTML.indexOf(marker);
  assert(markerIdx !== -1, "index.html must contain commission capitalization block marker");
  const ifIdx = INDEX_HTML.indexOf("if (prevRow) {", markerIdx);
  assert(ifIdx !== -1, "index.html must contain if (prevRow) block");
  const openBrace = INDEX_HTML.indexOf("{", ifIdx);
  let depth = 0;
  let endIdx = -1;
  for (let i = openBrace; i < INDEX_HTML.length; i++) {
    if (INDEX_HTML[i] === "{") depth++;
    else if (INDEX_HTML[i] === "}") {
      depth--;
      if (depth === 0) {
        endIdx = i;
        break;
      }
    }
  }
  assert(endIdx !== -1, "Failed to parse closing brace of if (prevRow) block in index.html");
  const inner = INDEX_HTML.slice(openBrace + 1, endIdx);
  return new Function("prevRow", "r", "money", `let activityHtml = '';\n${inner}\nreturn activityHtml;`);
}

const runIndexPrevCommSnippet = extractPrevCommSnippetFromIndexHtml();

/**
 * Executes the actual index.html monthly breakdown prevRow capitalization logic.
 */
function renderMonthlyActivity(prevRow, targetMonthName = '', isProjection = false) {
  if (!prevRow) return '';
  const money = (v) => `$${(Number(v) || 0).toFixed(2)}`;
  const r = { month: targetMonthName, year: prevRow.year || 2026, isProjection };
  return runIndexPrevCommSnippet(prevRow, r, money);
}

async function runTests() {
  console.log("================================================================================");
  console.log("TEST SUITE: COMMISSION ATTRIBUTION, DISPLAY LOGIC & FAIL-CLOSED GUARDS");
  console.log("================================================================================\n");

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
    status: "active",
    is_commission: true
  }];

  // --- TEST GROUP 1: RENDERING PRECEDENCE UNIT TESTS ---
  console.log("Test 1: Verification-Pending Strict Precedence over Positive Amounts");
  {
    // Case 1A: Unverified row even with non-zero numeric property MUST fail closed in display
    const activeWithSupersededRow = {
      month: "August",
      year: 2026,
      commissionsEarned: 11153.73,
      activeCommissionsEarned: 11153.73,
      commissionsUnavailable: true,
      hasSupersededCommissions: true,
      verificationStatus: "UNVERIFIED"
    };
    const html1A = renderMonthlyActivity(activeWithSupersededRow, "September");
    assert(html1A.includes("August Commission: Pending Verification"), "Unverified status must render Pending Verification");
    assert(!html1A.includes("+$11153.73"), "Must NOT display unverified commission amount as capitalized");
    assert(!html1A.includes("capitalized in September"), "Must NOT display capitalization wording when unverified");
    console.log("   ✓ Unverified row fails closed in index.html even if stale positive commission amount is present");

    // Case 1B: Zero amount + UNVERIFIED (e.g. October with 0 active rows) => Pending message
    const unverifiedZeroRow = {
      month: "October",
      year: 2026,
      commissionsEarned: 0.00,
      commissionsUnavailable: true,
      hasSupersededCommissions: true,
      verificationStatus: "UNVERIFIED"
    };
    const html1B = renderMonthlyActivity(unverifiedZeroRow, "November");
    assert(html1B.includes("October Commission: Pending Verification"), "Must show pending verification message for zero amount");
    assert(!html1B.includes("Commission Added"), "Must NOT display 'Commission Added' when zero and unverified");
    console.log("   ✓ Zero amount ($0.00) + UNVERIFIED strictly renders pending verification message");

    // Case 1C: Verified positive amount (with or without historical SUPERSEDED rows) => Render green capitalized line
    const verifiedRow = {
      month: "September",
      year: 2026,
      commissionsEarned: 11487.85,
      displayCommissionsEarned: 11487.85,
      activeCommissionsEarned: 11487.85,
      commissionsUnavailable: false,
      hasSupersededCommissions: true,
      verificationStatus: "VERIFIED"
    };
    const html1C = renderMonthlyActivity(verifiedRow, "October");
    assert(html1C.includes("+$11487.85 September 2026 commission — capitalized in October"), "Must display verified capitalized amount even with historical SUPERSEDED audit rows");
    assert(!html1C.includes("Pending Verification"), "Must NOT show pending verification when verified");
    console.log("   ✓ Verified row (including cleanly superseded historical audit rows) renders green capitalization line");
  }

  // --- TEST GROUP 2: INTEGRATED DASHBOARD BREAKDOWN ROW SHAPE & LIVE DATA ---
  console.log("\nTest 2: Verifying Monthly Breakdown Row Shape & August Safeguard");
  {
    const historyTable = [
      {
        id: "h_8",
        investor_id: "stout001",
        year: 2026,
        month_number: 8,
        month: "August",
        opening_balance: 3214239.08,
        deposits: 0,
        withdrawals: 0,
        gross_return_pct: 3.03,
        manual_gain_amount: 80615.65,
        ending_balance: 3294854.73,
        locked: false
      },
      {
        id: "h_9",
        investor_id: "stout001",
        year: 2026,
        month_number: 9,
        month: "September",
        opening_balance: 3306008.46,
        deposits: 0,
        withdrawals: 0,
        gross_return_pct: 3.07,
        manual_gain_amount: 83457.21,
        ending_balance: 3389465.67,
        locked: true
      },
      {
        id: "h_10",
        investor_id: "stout001",
        year: 2026,
        month_number: 10,
        month: "October",
        opening_balance: 3400953.52,
        deposits: 0,
        withdrawals: 67500.00,
        gross_return_pct: 3.05,
        manual_gain_amount: 0,
        ending_balance: 3333453.52,
        locked: false
      }
    ];

    const commissionEarnings = [
      // August has both active and superseded rows
      { id: "c_aug_1", recipient_id: "stout001", year: 2026, month_number: 8, amount: 11153.73, status: "ACTIVE" },
      { id: "c_aug_sup", recipient_id: "stout001", year: 2026, month_number: 8, amount: 1138.90, status: "SUPERSEDED" },
      // September Active Earnings for Joshua Stout: exactly $11,487.85
      { id: "c_sep_1", recipient_id: "stout001", year: 2026, month_number: 9, amount: 11487.85, status: "ACTIVE" },
      // October Premature Superseded records
      { id: "c_oct_1", recipient_id: "stout001", year: 2026, month_number: 10, amount: 2450.00, status: "SUPERSEDED" }
    ];

    const returnsSheet = [
      { id: "r_8", year: 2026, month_number: 8, month: "August", gross_return_pct: 3.03, locked: false },
      { id: "r_9", year: 2026, month_number: 9, month: "September", gross_return_pct: 3.07, locked: true },
      { id: "r_10", year: 2026, month_number: 10, month: "October", gross_return_pct: 3.05, locked: false }
    ];

    const d = await buildInvestorDashboard("jstout", {
      rawInvestors: jstoutInvestors,
      accounts: jstoutAccounts,
      historyTable,
      commissionEarningsTable: commissionEarnings,
      returnsSheet,
      depositsSheet: [],
      withdrawalsSheet: [{ investorid: "stout001", year: 2026, month_number: 10, amount: 67500.00, status: "completed" }],
      cutoverAdjustments: [],
      asOfDate: "2026-11-05T00:00:00Z"
    });

    const m8Row = d.breakdown.find(b => b.monthNumber === 8);
    const m9Row = d.breakdown.find(b => b.monthNumber === 9);
    const m10Row = d.breakdown.find(b => b.monthNumber === 10);

    // Verify properties exist on the actual row shape
    assert("commissionsEarned" in m8Row, "Row must contain commissionsEarned");
    assert("commissionsUnavailable" in m8Row, "Row must contain commissionsUnavailable");
    assert("verificationStatus" in m8Row, "Row must contain verificationStatus");
    assert("isCommissionUnverified" in m8Row, "Row must contain isCommissionUnverified");
    assert("hasSupersededCommissions" in m8Row, "Row must contain hasSupersededCommissions");

    // Test rendering of September activity (prevRow is August: unlocked return/history + superseded row => fail closed consistently)
    assert.strictEqual(m8Row.commissionsEarned, 0, "Unverified/mixed August commissionsEarned must fail closed to 0");
    assert.strictEqual(m8Row.displayCommissionsEarned, 0, "Unverified/mixed August displayCommissionsEarned must fail closed to 0");
    assert.strictEqual(m8Row.activeCommissionsEarned, 0, "Unverified/mixed August activeCommissionsEarned must fail closed to 0");
    assert.strictEqual(m8Row.commissionsUnavailable, true, "Unverified/mixed August commissionsUnavailable must be true");
    assert.strictEqual(m8Row.verificationStatus, "UNVERIFIED", "Unverified/mixed August verificationStatus must be UNVERIFIED");
    const sepActivity = renderMonthlyActivity(m8Row, "September");
    assert(sepActivity.includes("August Commission: Pending Verification"), "September activity must fail closed to Pending Verification when August is unverified/mixed");
    assert(!sepActivity.includes("+$11153.73"), "September activity must NOT display unverified August commission");
    console.log("   ✓ Mixed/unlocked August with SUPERSEDED row fails closed consistently (breakdown=$0, Pending Verification)");

    // Test rendering of October activity (prevRow is September)
    const octActivity = renderMonthlyActivity(m9Row, "October");
    assert(octActivity.includes("+$11487.85 September 2026 commission — capitalized in October"), "October activity must render September commission");
    console.log("   ✓ Actual September monthly row data correctly drives '+$11,487.85 September 2026 commission — capitalized in October'");

    // Test rendering of November activity (prevRow is October)
    // October is open/unfinalized with superseded commission rows
    assert.strictEqual(m10Row.commissionsEarned, 0, "October commissionsEarned must be 0");
    assert.strictEqual(m10Row.commissionsUnavailable, true, "October commissionsUnavailable must be true");
    const novActivity = renderMonthlyActivity(m10Row);
    assert(novActivity.includes("October Commission: Pending Verification"), "November activity must render 'October Commission: Pending Verification'");
    console.log("   ✓ October open/unfinalized status prevents any October commission from capitalizing into November");
  }

  // --- TEST GROUP 3: YTD SUMMARY REMAINING UNAVAILABLE ---
  console.log("\nTest 3: Summary Commission Cards Fail Closed on Uncertified Data");
  {
    const commissionEarnings = [
      { id: "c_sep_1", recipient_id: "stout001", year: 2026, month_number: 9, amount: 11487.85, status: "ACTIVE" },
      { id: "c_oct_sup", recipient_id: "stout001", year: 2026, month_number: 10, amount: 125.55, status: "SUPERSEDED" }
    ];

    const returnsSheet = [
      { id: "r_9", year: 2026, month_number: 9, month: "September", gross_return_pct: 3.07, locked: true },
      { id: "r_10", year: 2026, month_number: 10, month: "October", gross_return_pct: 3.05, locked: false }
    ];

    const d = await buildInvestorDashboard("jstout", {
      rawInvestors: jstoutInvestors,
      accounts: jstoutAccounts,
      historyTable: [],
      commissionEarningsTable: commissionEarnings,
      returnsSheet,
      depositsSheet: [],
      withdrawalsSheet: [],
      cutoverAdjustments: [],
      asOfDate: "2026-11-05T00:00:00Z"
    });

    assert.strictEqual(d.summary.commissionsEarnedMonth, null, "commissionsEarnedMonth must be null when unverified");
    assert.strictEqual(d.summary.commissionsEarnedYear, null, "commissionsEarnedYear must be null when unverified");
    assert.strictEqual(d.summary.commissionsUnavailable, true, "commissionsUnavailable must be true");
    assert.strictEqual(d.summary.commissionsStatusText, "Temporarily unavailable while being verified");

    console.log("   ✓ Summary cards return null and 'Temporarily unavailable while being verified'");
    console.log("   ✓ YTD commission strictly remains null/unavailable for uncertified periods");
  }

  console.log("\n================================================================================");
  console.log("ALL COMMISSION ATTRIBUTION & DISPLAY LOGIC TESTS PASSED (100%)");
  console.log("================================================================================");
}

runTests().catch(err => {
  console.error("Test Suite Failed:", err);
  process.exit(1);
});
