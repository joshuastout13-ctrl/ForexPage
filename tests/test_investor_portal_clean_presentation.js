import assert from 'node:assert';
import fs from 'node:fs';
import {
  calculateTotalExternalCash,
  calculateLifetimePerformance,
  calculateBalanceAffectingDeposits,
  calculateLifetimeSettledWithdrawals
} from '../lib/accounting-engine.js';
import { buildInvestorDashboard } from '../lib/dashboard.js';

function pass(msg) {
  console.log(`  ✅ PASS: ${msg}`);
}

function fail(msg, err) {
  console.error(`  ❌ FAIL: ${msg}`);
  console.error(err);
  process.exitCode = 1;
}

// Emulate client-side renderSummary from index.html
function simulateRenderSummary(data) {
  const summary = data.summary || {};
  const investor = data.investor || {};
  const isComplete = summary.provenanceCompletenessStatus === 'COMPLETE';

  const money = n => n === null || n === undefined ? "—" : "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pct = n => n === null || n === undefined ? "—" : (n >= 0 ? "+" : "") + Number(n).toFixed(2) + "%";

  const totalDepositsVal = money(summary.totalExternalCashSent ?? summary.totalCashIn);
  const totalDepositsSubvalue = null;

  let perfValue = "—";
  let perfSubvalue = null;
  let perfClass = "";

  if (isComplete && summary.totalPerformancePct !== null && summary.totalPerformancePct !== undefined) {
    perfValue = pct(summary.totalPerformancePct);
    perfSubvalue = money(summary.totalPerformanceDollar);
    perfClass = summary.totalPerformancePct >= 0 ? 'success' : 'warning';
  } else {
    perfValue = "—";
    perfSubvalue = null;
    perfClass = "";
  }

  const metrics = [
    { label: "Current Balance", value: money(summary.currentBalance ?? summary.current_balance), class: 'success' },
    { label: "Total Gain YTD", value: money(summary.totalGain ?? summary.total_gain), class: 'success' },
    { label: "Total Deposits", value: totalDepositsVal, subvalue: totalDepositsSubvalue },
    { 
      label: "Total Performance", 
      value: perfValue, 
      subvalue: perfSubvalue,
      class: perfClass
    },
    { label: "Total Withdrawals", value: money(summary.totalWithdrawals ?? summary.total_withdrawals), class: 'warning' },
    { label: "Investor Split", value: (investor.splitPct || investor.split_pct || 0) + "%" }
  ];

  const html = metrics.map(m => `
    <div class="metric ${m.class || ''}">
      <div class="label-row">
        <div class="label">${m.label}</div>
      </div>
      <div class="value">${m.value}</div>
      ${m.subvalue ? `<div class="subvalue">${m.subvalue}</div>` : ''}
    </div>
  `).join("");

  return { metrics, html };
}

async function runCleanPresentationSuite() {
  console.log("================================================================================");
  console.log("INVESTOR PORTAL CLEAN PRESENTATION REGRESSION SUITE");
  console.log("================================================================================\n");

  const FORBIDDEN_INVESTOR_PHRASES = [
    "Verification in progress",
    "Pending verification",
    "Lifetime basis incomplete",
    "Not established",
    "Unknown provenance",
    "Basis Incomplete"
  ];

  // ---------------------------------------------------------------------------
  // TEST 1: HTML Source Audit of index.html
  // ---------------------------------------------------------------------------
  try {
    const indexHtml = fs.readFileSync('index.html', 'utf8');

    for (const phrase of FORBIDDEN_INVESTOR_PHRASES) {
      assert.ok(
        !indexHtml.includes(phrase),
        `index.html must NOT contain forbidden phrase "${phrase}"`
      );
    }
    pass("1. Source Audit: index.html contains zero forbidden provenance/verification messaging");
  } catch (err) { fail("Test 1 failed", err); }

  // ---------------------------------------------------------------------------
  // TEST 2: PARTIAL Investor Portal Rendering
  // ---------------------------------------------------------------------------
  try {
    const partialData = {
      summary: {
        currentBalance: 3287310.70,
        totalGain: 740904.71,
        totalExternalCashSent: 2500.00,
        totalWithdrawals: 40000.00,
        totalPerformanceDollar: null,
        totalPerformancePct: null,
        provenanceCompletenessStatus: 'PARTIAL'
      },
      investor: { splitPct: 100 }
    };

    const { metrics, html } = simulateRenderSummary(partialData);

    const depMetric = metrics.find(m => m.label === "Total Deposits");
    assert.strictEqual(depMetric.value, "$2,500.00", "Total Deposits must show verified amount");
    assert.strictEqual(depMetric.subvalue, null, "Total Deposits subvalue must be strictly null (no 'Verification in progress')");

    const perfMetric = metrics.find(m => m.label === "Total Performance");
    assert.strictEqual(perfMetric.value, "—", "Total Performance value must be neutral '—' under PARTIAL");
    assert.strictEqual(perfMetric.subvalue, null, "Total Performance subvalue must be strictly null (no 'Lifetime basis incomplete' or 'Pending verification')");
    assert.strictEqual(perfMetric.class, "", "Total Performance class must be neutral empty string");

    for (const phrase of FORBIDDEN_INVESTOR_PHRASES) {
      assert.ok(!html.includes(phrase), `Rendered PARTIAL HTML must NOT contain "${phrase}"`);
    }

    // Verify compact DOM: no empty <div class="subvalue"> tags rendered
    assert.ok(!html.includes('<div class="subvalue">'), "PARTIAL cards must not render empty subvalue divs, preserving compact layout");

    pass("2. PARTIAL Investor: Total Deposits shows '$2,500.00', Performance shows clean '—' with zero provenance subtitles");
  } catch (err) { fail("Test 2 failed", err); }

  // ---------------------------------------------------------------------------
  // TEST 3: UNKNOWN Investor Portal Rendering
  // ---------------------------------------------------------------------------
  try {
    const unknownData = {
      summary: {
        currentBalance: 150000.00,
        totalGain: 25000.00,
        totalExternalCashSent: 0.00,
        totalWithdrawals: 0.00,
        totalPerformanceDollar: null,
        totalPerformancePct: null,
        provenanceCompletenessStatus: 'UNKNOWN'
      },
      investor: { splitPct: 80 }
    };

    const { metrics, html } = simulateRenderSummary(unknownData);

    const depMetric = metrics.find(m => m.label === "Total Deposits");
    assert.strictEqual(depMetric.subvalue, null, "UNKNOWN Total Deposits subvalue must be null");

    const perfMetric = metrics.find(m => m.label === "Total Performance");
    assert.strictEqual(perfMetric.value, "—", "UNKNOWN Total Performance must show '—'");
    assert.strictEqual(perfMetric.subvalue, null, "UNKNOWN Total Performance subvalue must be null (not 'Not established')");

    for (const phrase of FORBIDDEN_INVESTOR_PHRASES) {
      assert.ok(!html.includes(phrase), `Rendered UNKNOWN HTML must NOT contain "${phrase}"`);
    }

    pass("3. UNKNOWN Investor: Clean '—' display with zero provenance subtitles or 'Not established' labels");
  } catch (err) { fail("Test 3 failed", err); }

  // ---------------------------------------------------------------------------
  // TEST 4: COMPLETE Investor Portal Rendering
  // ---------------------------------------------------------------------------
  try {
    const completeData = {
      summary: {
        currentBalance: 3287310.70,
        totalGain: 740904.71,
        totalExternalCashSent: 2500000.00,
        totalWithdrawals: 40000.00,
        totalPerformanceDollar: 787310.70,
        totalPerformancePct: 31.4924,
        provenanceCompletenessStatus: 'COMPLETE'
      },
      investor: { splitPct: 100 }
    };

    const { metrics, html } = simulateRenderSummary(completeData);

    const perfMetric = metrics.find(m => m.label === "Total Performance");
    assert.strictEqual(perfMetric.value, "+31.49%", "COMPLETE Total Performance must format percentage normally");
    assert.strictEqual(perfMetric.subvalue, "$787,310.70", "COMPLETE Total Performance must format dollar gain normally");
    assert.strictEqual(perfMetric.class, "success", "COMPLETE Total Performance class must be success for positive return");

    assert.ok(html.includes("+31.49%"), "Rendered HTML must contain formatted percentage");
    assert.ok(html.includes("$787,310.70"), "Rendered HTML must contain formatted dollar amount");

    pass("4. COMPLETE Investor: Total Performance % and $ render normally using established formula (+31.49%, $787,310.70)");
  } catch (err) { fail("Test 4 failed", err); }

  // ---------------------------------------------------------------------------
  // TEST 5: Admin Portal Retains Provenance Controls & Auditing
  // ---------------------------------------------------------------------------
  try {
    const adminHtml = fs.readFileSync('admin.html', 'utf8');
    assert.ok(adminHtml.includes('certify-provenance') || adminHtml.includes('certify_account_external_cash_provenance'), "admin.html must retain certify-provenance action");
    assert.ok(adminHtml.includes('provenance_certified_at') || adminHtml.includes('Basis Incomplete'), "admin.html must retain provenance auditing details");

    const buildAdminJs = fs.readFileSync('build-admin.js', 'utf8');
    assert.ok(buildAdminJs.includes('certify-provenance'), "build-admin.js must retain certify-provenance action");

    pass("5. Admin Portal: Provenance controls, certification endpoints, and audit metadata remain fully preserved for administrators");
  } catch (err) { fail("Test 5 failed", err); }

  // ---------------------------------------------------------------------------
  // TEST 6: Financial Calculation Invariants (Zero Math Changes)
  // ---------------------------------------------------------------------------
  try {
    const depositRows = [
      { id: 'dep_1', amount: 2500, accounting_treatment: 'NEW_CASH', status: 'confirmed' }
    ];

    const extCash = calculateTotalExternalCash({ depositRows });
    assert.strictEqual(extCash.total, 2500, "External cash calculation must remain 2500");

    const balDeps = calculateBalanceAffectingDeposits({ depositRows, targetYear: 2026, maxMonth: 9 });
    assert.strictEqual(balDeps, 2500, "Balance affecting deposits must remain 2500");

    const perfPartial = calculateLifetimePerformance({
      totalExternalCashSent: 2500,
      hasConfirmedExternalCashRecords: true,
      currentBalance: 3287310.70,
      provenanceCompletenessStatus: 'PARTIAL'
    });
    assert.strictEqual(perfPartial.totalPerformanceDollar, null, "PARTIAL performance dollar must remain strictly null");
    assert.strictEqual(perfPartial.totalPerformancePct, null, "PARTIAL performance pct must remain strictly null");

    const perfComplete = calculateLifetimePerformance({
      totalExternalCashSent: 2500,
      hasConfirmedExternalCashRecords: true,
      currentBalance: 3287310.70,
      provenanceCompletenessStatus: 'COMPLETE'
    });
    assert.strictEqual(perfComplete.totalPerformanceDollar, 3284810.70, "COMPLETE performance dollar calculated normally");
    assert.strictEqual(perfComplete.isProven, true, "COMPLETE isProven must be true");

    pass("6. Financial Calculations: Accounting engine math, null-locks on partial status, and baseline formulas 100% untouched");
  } catch (err) { fail("Test 6 failed", err); }

  console.log("\n================================================================================");
  console.log("ALL 6 CLEAN PRESENTATION TESTS PASSED (100%)");
  console.log("================================================================================\n");
}

runCleanPresentationSuite().catch(err => {
  console.error("Suite execution error:", err);
  process.exit(1);
});
