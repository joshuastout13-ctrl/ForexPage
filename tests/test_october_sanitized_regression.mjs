/**
 * TRACK 2A — SANITIZED STRUCTURAL OCTOBER & ROLLOVER REGRESSION SUITE
 *
 * 100% Offline / Local Execution:
 * - Zero production credentials, zero network calls, zero Myfxbook calls.
 * - Uses strictly pseudonymous IDs/aliases and anonymized structural parameters
 *   (NO names, emails, logins, or production transaction IDs).
 * - Live production history comparisons are explicitly reported as BLOCKED
 *   because verified SELECT-only database access is not available locally.
 *
 * Run:
 *   node tests/test_october_sanitized_regression.mjs
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Decimal from "decimal.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { buildInvestorDashboard } from "../lib/dashboard.js";
import {
  calculateInvestorMonth,
  calculateTotalExternalCash,
  calculateBalanceAffectingDeposits,
  calculateLifetimePerformance,
  calculateLifetimeSettledWithdrawals
} from "../lib/accounting-engine.js";
import { calculateAccountingPeriod } from "../lib/accounting-period-engine.js";

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

function moneyFormat(n) {
  return Number(n || 0).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

const INDEX_HTML = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
const runIndexPrevCommSnippet = (() => {
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
})();

/**
 * Executes the live index.html renderBreakdown prevRow commission attribution logic directly.
 */
function renderBreakdownPrevCommHtml(prevRow, currMonthName, isProjection = false) {
  if (!prevRow) return "";
  return runIndexPrevCommSnippet(
    prevRow,
    { month: currMonthName, year: prevRow.year || 2026, isProjection },
    moneyFormat
  );
}

function makeSepAndPriorHistory(invId, sepOpen, sepDep, sepWd, sepEnd, sepGross = 3.07) {
  return [
    {
      id: `syn_hist_${invId}_09`,
      investor_id: invId,
      year: 2026,
      month_number: 9,
      month: "September",
      opening_balance: sepOpen,
      deposits: sepDep,
      withdrawals: sepWd,
      gross_return_pct: sepGross,
      recurring_draw: 0,
      ending_balance: sepEnd,
      is_manual: false,
      locked: true
    }
  ];
}

async function runTests() {
  console.log("=== TRACK 2A: SANITIZED STRUCTURAL OCTOBER & ROLLOVER REGRESSION ===");

  // Force offline mode — ensure no production supabase client is needed
  process.env.DATA_SOURCE = "supabase";
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  const baseReturnsOpenOct = [
    { year: 2026, month_number: 9, month: "September", gross_return_pct: 3.07, locked: true },
    { year: 2026, month_number: 10, month: "October", gross_return_pct: 3.05, locked: false },
    { year: 2026, month_number: 11, month: "November", gross_return_pct: 0, locked: false },
    { year: 2026, month_number: 12, month: "December", gross_return_pct: 0, locked: false }
  ];

  // ---------------------------------------------------------------------------
  // CASE 1: Large-Balance Commission Recipient — Open Oct vs Half-Reverted vs Finalized
  // Structural analogue (pseudonymous): Sep End $3,389,465.67, Sep Comm $12,292.89,
  // Oct +$2,500 NEW_CASH, Oct -$70,000 Completed -> $3,334,258.56 * 3.05% = $101,694.89.
  // ---------------------------------------------------------------------------
  const mainInvestor = {
    id: "P_MAIN_S1",
    portal_username: "p_main_s1",
    first_name: "Sanitized",
    last_name: "RecipientOne",
    split_pct: 100,
    monthly_draw: 0,
    start_date: "2026-01-01",
    active: true
  };
  const mainAccount = {
    id: "P_ACC_S1",
    investor_id: "P_MAIN_S1",
    starting_capital: 2500000,
    status: "Active",
    is_commission: true,
    external_cash_provenance_status: "COMPLETE"
  };
  const smallInvestor = {
    id: "P_SMALL_S2",
    portal_username: "p_small_s2",
    first_name: "Sanitized",
    last_name: "SmallTwo",
    split_pct: 50,
    monthly_draw: 0,
    start_date: "2026-06-01",
    active: true
  };
  const smallAccount = {
    id: "P_ACC_S2",
    investor_id: "P_SMALL_S2",
    starting_capital: 2500,
    status: "Active",
    is_commission: false,
    external_cash_provenance_status: "COMPLETE"
  };

  const sepCommEarnings = [
    {
      id: "syn_comm_sep_1",
      recipient_id: "P_MAIN_S1",
      source_investor_id: "P_SMALL_S2",
      year: 2026,
      month_number: 9,
      amount: 12292.89,
      status: "ACTIVE",
      created_at: "2026-10-03T18:00:00Z"
    }
  ];

  const mainSepHist = makeSepAndPriorHistory("P_MAIN_S1", 3288508.46, 0, 0, 3389465.67, 3.07);
  const octCashDeposits = [
    { id: "syn_dep_sep_hist", investor_id: "P_MAIN_S1", account_id: "P_ACC_S1", amount: 1600000, date: "2026-01-01", effective_accounting_date: "2026-01-01", accounting_treatment: "HISTORICAL_PROVENANCE", status: "confirmed", is_commission: false },
    { id: "syn_dep_oct_1", investor_id: "P_MAIN_S1", account_id: "P_ACC_S1", amount: 2500, date: "2026-10-01", effective_accounting_date: "2026-10-01", accounting_treatment: "NEW_CASH", status: "confirmed", is_commission: false },
    { id: "syn_dep_nov_1", investor_id: "P_MAIN_S1", account_id: "P_ACC_S1", amount: 5000, date: "2026-11-01", effective_accounting_date: "2026-11-01", accounting_treatment: "NEW_CASH", status: "confirmed", is_commission: false }
  ];
  const octCashWithdrawals = [
    { id: "syn_wd_oct_1", investor_id: "P_MAIN_S1", account_id: "P_ACC_S1", amount: 70000, year: 2026, month_number: 10, request_date: "2026-10-01", effective_accounting_date: "2026-10-01", status: "Completed", is_draw: false },
    { id: "syn_wd_nov_1", investor_id: "P_MAIN_S1", account_id: "P_ACC_S1", amount: 20000, year: 2026, month_number: 11, request_date: "2026-11-01", effective_accounting_date: "2026-11-01", status: "Completed", is_draw: false }
  ];

  // 1A. Open October (monthly_returns locked=false, history locked=false, superseded M10 comm)
  {
    const dashOpen = await buildInvestorDashboard("P_MAIN_S1", {
      asOfDate: "2026-11-15T12:00:00Z",
      rawInvestors: [mainInvestor, smallInvestor],
      accounts: [mainAccount, smallAccount],
      returnsSheet: baseReturnsOpenOct,
      depositsSheet: octCashDeposits,
      withdrawalsSheet: octCashWithdrawals,
      historyTable: [
        ...mainSepHist,
        { id: "syn_hist_10_open", investor_id: "P_MAIN_S1", year: 2026, month_number: 10, month: "October", opening_balance: 3401758.56, deposits: 2500, withdrawals: 70000, gross_return_pct: 0, recurring_draw: 0, ending_balance: 3334258.56, is_manual: false, locked: false },
        { id: "syn_hist_11_open", investor_id: "P_MAIN_S1", year: 2026, month_number: 11, month: "November", opening_balance: 3334258.56, deposits: 5000, withdrawals: 20000, gross_return_pct: 0, recurring_draw: 0, ending_balance: 3319258.56, is_manual: false, locked: false }
      ],
      commissionEarningsTable: [
        ...sepCommEarnings,
        { id: "syn_comm_oct_sup", recipient_id: "P_MAIN_S1", source_investor_id: "P_SMALL_S2", year: 2026, month_number: 10, amount: 420.00, status: "SUPERSEDED", created_at: "2026-10-01T00:00:00Z" }
      ],
      commissionSharesTable: [],
      commissionRulesTable: [],
      cutovers: [],
      live: { today: "0%", week: "0%", month: "0%", year: "0%" }
    }, { asOfDate: "2026-11-15T12:00:00Z" });

    const sep = dashOpen.breakdown.find(r => r.monthNumber === 9);
    const oct = dashOpen.breakdown.find(r => r.monthNumber === 10);
    const nov = dashOpen.breakdown.find(r => r.monthNumber === 11);

    assert.strictEqual(sep.endingBalance, 3389465.67);
    assert.strictEqual(sep.displayCommissionsEarned, 12292.89);
    assert.strictEqual(oct.startingBalance, 3401758.56);
    assert.strictEqual(oct.adjustedStartingBalance, 3334258.56);
    // Open Oct shows pendingEffectiveReturnPct +3.05% and pendingGain $101,694.89 without settling
    assert.strictEqual(oct.performancePendingClose, true);
    assert.strictEqual(oct.pendingEffectiveReturnPct, 3.05);
    assert.strictEqual(oct.pendingGain, 101694.89);
    assert.strictEqual(oct.gain, 0);
    assert.strictEqual(oct.endingBalance, 3334258.56);
    assert.strictEqual(oct.activeCommissionsEarned, 0);
    assert.strictEqual(oct.commissionsUnavailable, true);
    assert.strictEqual(nov.startingBalance, 3334258.56);
    assert.strictEqual(nov.adjustedStartingBalance, 3319258.56);
    assert.strictEqual(dashOpen.summary.bookedCommissionsEarnedMonth, 0);
    assert.strictEqual(dashOpen.summary.commissionsEarnedMonth, null);
    assert.strictEqual(dashOpen.summary.commissionsUnavailable, true);
    assert.ok(renderBreakdownPrevCommHtml(oct, "November").includes("October Commission: Pending Verification"));
    console.log("  PASS [1A]: Open October shows pendingGain $101,694.89 cleanly without capitalizing into Nov; Booked Comm = $0.00.");
  }

  // Also verify October strictly in-progress (MonthState.CURRENT_OPEN, 2026-10-15 America/Los_Angeles)
  {
    const dashOctLive = await buildInvestorDashboard("P_MAIN_S1", {
      asOfDate: "2026-10-15T12:00:00Z",
      rawInvestors: [mainInvestor, smallInvestor],
      accounts: [mainAccount, smallAccount],
      returnsSheet: baseReturnsOpenOct.filter(r => r.month_number <= 10),
      depositsSheet: octCashDeposits,
      withdrawalsSheet: octCashWithdrawals,
      historyTable: mainSepHist,
      commissionEarningsTable: [
        ...sepCommEarnings,
        { id: "syn_comm_oct_inprog", recipient_id: "P_MAIN_S1", source_investor_id: "P_SMALL_S2", year: 2026, month_number: 10, amount: 15162.00, status: "ACTIVE", created_at: "2026-10-15T00:00:00Z" }
      ],
      commissionSharesTable: [],
      commissionRulesTable: [],
      cutovers: [],
      live: { today: "0%", week: "0%", month: "+3.05%", year: "0%" }
    }, { asOfDate: "2026-10-15T12:00:00Z" });
    const octLive = dashOctLive.breakdown.find(r => r.monthNumber === 10);
    const novLive = dashOctLive.breakdown.find(r => r.monthNumber === 11);
    assert.strictEqual(dashOctLive.summary.commMonthName, "September");
    assert.strictEqual(dashOctLive.summary.bookedCommissionsEarnedMonth, 12292.89);
    assert.strictEqual(octLive.displayCommissionsEarned, 0);
    assert.strictEqual(octLive.activeCommissionsEarned, 0);
    assert.strictEqual(octLive.commissionsEarned, 0);
    assert.strictEqual(novLive, undefined);
    assert.ok(!renderBreakdownPrevCommHtml(octLive, "November", true).includes("capitalized in November"));
    console.log("  PASS [1A-open]: During active October (2026-10-15), October commission never books or capitalizes into November.");
  }

  // 1B. Mixed / Superseded / Unverified States -> Fail Closed Consistently in API Summary & Breakdown UI
  {
    const returnsLockedOct = baseReturnsOpenOct.map(r =>
      r.month_number === 10 ? { ...r, locked: true } : r
    );
    const baseHalfRevertedData = {
      asOfDate: "2026-11-15T12:00:00Z",
      rawInvestors: [mainInvestor, smallInvestor],
      accounts: [mainAccount, smallAccount],
      returnsSheet: returnsLockedOct,
      depositsSheet: octCashDeposits,
      withdrawalsSheet: octCashWithdrawals,
      historyTable: [
        ...mainSepHist,
        { id: "syn_hist_10_unfin", investor_id: "P_MAIN_S1", year: 2026, month_number: 10, month: "October", opening_balance: 3401758.56, deposits: 2500, withdrawals: 70000, gross_return_pct: 3.05, recurring_draw: 0, ending_balance: 3334258.56, is_manual: false, locked: false },
        { id: "syn_hist_11_unfin", investor_id: "P_MAIN_S1", year: 2026, month_number: 11, month: "November", opening_balance: 3334258.56, deposits: 5000, withdrawals: 20000, gross_return_pct: 0, recurring_draw: 0, ending_balance: 3319258.56, is_manual: false, locked: false }
      ],
      commissionSharesTable: [],
      commissionRulesTable: [],
      cutovers: [],
      live: { today: "0%", week: "0%", month: "0%", year: "0%" }
    };

    // Subcase 1B-i: monthly_returns M10 locked=true, historyRow M10 unlocked zero-gain (unfinalized), ACTIVE M10 comm = $15,162
    const dashMixed1 = await buildInvestorDashboard("P_MAIN_S1", {
      ...baseHalfRevertedData,
      commissionEarningsTable: [
        ...sepCommEarnings,
        { id: "syn_comm_oct_act", recipient_id: "P_MAIN_S1", source_investor_id: "P_SMALL_S2", year: 2026, month_number: 10, amount: 15162.00, status: "ACTIVE", created_at: "2026-11-01T09:00:00Z" }
      ]
    }, { asOfDate: "2026-11-15T12:00:00Z" });

    const oct1 = dashMixed1.breakdown.find(r => r.monthNumber === 10);
    const nov1 = dashMixed1.breakdown.find(r => r.monthNumber === 11);
    assert.strictEqual(dashMixed1.summary.bookedCommissionsEarnedMonth, 0);
    assert.strictEqual(dashMixed1.summary.commissionsEarnedMonth, null);
    assert.strictEqual(dashMixed1.summary.commissionsUnavailable, true);
    assert.strictEqual(oct1.isUnfinalizedCompletedMonth, true);
    assert.strictEqual(oct1.displayCommissionsEarned, 0);
    assert.strictEqual(oct1.activeCommissionsEarned, 0);
    assert.strictEqual(oct1.commissionsEarned, 0);
    assert.strictEqual(oct1.commissionsUnavailable, true);
    assert.strictEqual(oct1.verificationStatus, "UNVERIFIED");
    assert.strictEqual(nov1.startingBalance, 3334258.56);
    const html1 = renderBreakdownPrevCommHtml(oct1, "November");
    assert.ok(html1.includes("October Commission: Pending Verification"));
    assert.ok(!html1.includes("capitalized in November"));
    assert.ok(!html1.includes("$15,162.00"));

    // Subcase 1B-ii: coexisting ACTIVE $15,162 + SUPERSEDED $420 on unlocked period -> both API summary & breakdown fail closed
    const dashMixed2 = await buildInvestorDashboard("P_MAIN_S1", {
      ...baseHalfRevertedData,
      commissionEarningsTable: [
        ...sepCommEarnings,
        { id: "syn_comm_oct_act", recipient_id: "P_MAIN_S1", source_investor_id: "P_SMALL_S2", year: 2026, month_number: 10, amount: 15162.00, status: "ACTIVE", created_at: "2026-11-01T09:00:00Z" },
        { id: "syn_comm_oct_sup_2", recipient_id: "P_MAIN_S1", source_investor_id: "P_SMALL_S2", year: 2026, month_number: 10, amount: 420.00, status: "SUPERSEDED", created_at: "2026-10-01T00:00:00Z" }
      ]
    }, { asOfDate: "2026-11-15T12:00:00Z" });

    const oct2 = dashMixed2.breakdown.find(r => r.monthNumber === 10);
    const nov2 = dashMixed2.breakdown.find(r => r.monthNumber === 11);
    assert.strictEqual(dashMixed2.summary.bookedCommissionsEarnedMonth, 0);
    assert.strictEqual(dashMixed2.summary.commissionsEarnedMonth, null);
    assert.strictEqual(dashMixed2.summary.commissionsUnavailable, true);
    assert.strictEqual(oct2.displayCommissionsEarned, 0);
    assert.strictEqual(oct2.activeCommissionsEarned, 0);
    assert.strictEqual(oct2.commissionsEarned, 0);
    assert.strictEqual(oct2.commissionsUnavailable, true);
    assert.strictEqual(oct2.verificationStatus, "UNVERIFIED");
    assert.strictEqual(nov2.startingBalance, 3334258.56);
    const html2 = renderBreakdownPrevCommHtml(oct2, "November");
    assert.ok(html2.includes("October Commission: Pending Verification"));
    assert.ok(!html2.includes("capitalized in November"));
    assert.ok(!html2.includes("$15,162.00"));

    // Subcase 1B-iii: mixed partial-lock state (return locked=true, non-manual history locked=false even with populated ending_balance) + superseded + ACTIVE $15,162
    const returnsLockedOctMix = baseReturnsOpenOct.map(r =>
      r.month_number === 10 ? { ...r, locked: true } : r
    );
    const dashMixed3 = await buildInvestorDashboard("P_MAIN_S1", {
      ...baseHalfRevertedData,
      returnsSheet: returnsLockedOctMix,
      historyTable: [
        ...mainSepHist,
        { id: "syn_hist_10_mix", investor_id: "P_MAIN_S1", year: 2026, month_number: 10, month: "October", opening_balance: 3401758.56, deposits: 2500, withdrawals: 70000, gross_return_pct: 3.05, recurring_draw: 0, ending_balance: 3435953.45, is_manual: false, locked: false },
        { id: "syn_hist_11_mix", investor_id: "P_MAIN_S1", year: 2026, month_number: 11, month: "November", opening_balance: 3435953.45, deposits: 5000, withdrawals: 20000, gross_return_pct: 0, recurring_draw: 0, ending_balance: 3420953.45, is_manual: false, locked: false }
      ],
      commissionEarningsTable: [
        ...sepCommEarnings,
        { id: "syn_comm_oct_sup_mix", recipient_id: "P_MAIN_S1", source_investor_id: "P_SMALL_S2", year: 2026, month_number: 10, amount: 420.00, status: "SUPERSEDED", created_at: "2026-11-01T08:00:00Z" },
        { id: "syn_comm_oct_act", recipient_id: "P_MAIN_S1", source_investor_id: "P_SMALL_S2", year: 2026, month_number: 10, amount: 15162.00, status: "ACTIVE", created_at: "2026-11-01T09:00:00Z" }
      ]
    }, { asOfDate: "2026-11-15T12:00:00Z" });

    const oct3 = dashMixed3.breakdown.find(r => r.monthNumber === 10);
    const nov3 = dashMixed3.breakdown.find(r => r.monthNumber === 11);
    assert.strictEqual(dashMixed3.summary.bookedCommissionsEarnedMonth, 0);
    assert.strictEqual(dashMixed3.summary.commissionsEarnedMonth, null);
    assert.strictEqual(dashMixed3.summary.commissionsUnavailable, true);
    assert.strictEqual(oct3.displayCommissionsEarned, 0);
    assert.strictEqual(oct3.activeCommissionsEarned, 0);
    assert.strictEqual(oct3.commissionsEarned, 0);
    assert.strictEqual(oct3.commissionsUnavailable, true);
    assert.strictEqual(oct3.verificationStatus, "UNVERIFIED");
    assert.strictEqual(nov3.startingBalance, 3435953.45);
    const html3 = renderBreakdownPrevCommHtml(oct3, "November");
    assert.ok(html3.includes("October Commission: Pending Verification"));
    assert.ok(!html3.includes("capitalized in November"));
    assert.ok(!html3.includes("$15,162.00"));
    console.log("  PASS [1B]: Mixed, unlocked, and superseded/unverified states fail closed consistently across API summary and index.html.");
  }

  // 1C. Cleanly Finalized October (including cleanly superseded historical audit rows) -> Nov $3,436,115.45 & Booked Comm = Nov Cap ($15,162)
  {
    const returnsLockedOct = baseReturnsOpenOct.map(r =>
      r.month_number === 10 ? { ...r, locked: true } : r
    );
    const dashFinalized = await buildInvestorDashboard("P_MAIN_S1", {
      asOfDate: "2026-11-15T12:00:00Z",
      rawInvestors: [mainInvestor, smallInvestor],
      accounts: [mainAccount, smallAccount],
      returnsSheet: returnsLockedOct,
      depositsSheet: octCashDeposits,
      withdrawalsSheet: octCashWithdrawals,
      historyTable: [
        ...mainSepHist,
        { id: "syn_hist_10_fin", investor_id: "P_MAIN_S1", year: 2026, month_number: 10, month: "October", opening_balance: 3401758.56, deposits: 2500, withdrawals: 70000, gross_return_pct: 3.05, recurring_draw: 0, ending_balance: 3435953.45, is_manual: false, locked: true },
        { id: "syn_hist_11_fin", investor_id: "P_MAIN_S1", year: 2026, month_number: 11, month: "November", opening_balance: 3451115.45, deposits: 5000, withdrawals: 20000, gross_return_pct: 0, recurring_draw: 0, ending_balance: 3436115.45, is_manual: false, locked: false }
      ],
      commissionEarningsTable: [
        ...sepCommEarnings,
        { id: "syn_comm_oct_sup_hist", recipient_id: "P_MAIN_S1", source_investor_id: "P_SMALL_S2", year: 2026, month_number: 10, amount: 420.00, status: "SUPERSEDED", created_at: "2026-10-01T00:00:00Z" },
        { id: "syn_comm_oct_fin", recipient_id: "P_MAIN_S1", source_investor_id: "P_SMALL_S2", year: 2026, month_number: 10, amount: 15162.00, status: "ACTIVE", created_at: "2026-11-01T09:00:00Z" }
      ],
      commissionSharesTable: [],
      commissionRulesTable: [],
      cutovers: [],
      live: { today: "0%", week: "0%", month: "0%", year: "0%" }
    }, { asOfDate: "2026-11-15T12:00:00Z" });

    const oct = dashFinalized.breakdown.find(r => r.monthNumber === 10);
    const nov = dashFinalized.breakdown.find(r => r.monthNumber === 11);

    assert.strictEqual(oct.adjustedStartingBalance, 3334258.56);
    assert.ok(Math.abs(oct.gain - 101694.88608) < 1e-8);
    assert.strictEqual(moneyFormat(oct.gain), "$101,694.89");
    assert.strictEqual(oct.endingBalance, 3435953.45);
    assert.strictEqual(oct.displayCommissionsEarned, 15162);
    assert.strictEqual(oct.activeCommissionsEarned, 15162);
    assert.strictEqual(oct.commissionsEarned, 15162);
    assert.strictEqual(oct.verificationStatus, "VERIFIED");
    assert.strictEqual(oct.commissionsUnavailable, false);
    assert.strictEqual(nov.startingBalance, 3451115.45);
    assert.strictEqual(nov.adjustedStartingBalance, 3436115.45);
    assert.strictEqual(dashFinalized.summary.bookedCommissionsEarnedMonth, 15162);
    assert.strictEqual(dashFinalized.summary.commissionsEarnedMonth, 15162);
    assert.strictEqual(dashFinalized.summary.commissionsUnavailable, false);
    assert.strictEqual(dashFinalized.summary.commMonthName, "October");
    const finNovHtml = renderBreakdownPrevCommHtml(oct, "November");
    assert.ok(finNovHtml.includes("+$15,162.00 October 2026 commission — capitalized in November"));
    assert.ok(!finNovHtml.includes("Pending Verification"));
    console.log("  PASS [1C]: Clean Finalized Oct reproduces Nov $3,436,115.45 & API Booked Comm ($15,162) agrees with Nov capitalization line.");
  }

  // ---------------------------------------------------------------------------
  // CASE 2: Small-Balance Rounding, Loss Month, Effective-Date Shares, Paired Transfer,
  //         Draw Single-Counting, Nov-1 Starter vs Mid-Month Starter
  // ---------------------------------------------------------------------------
  {
    const invSmallSrc = { id: "P_SRC_S3", portal_username: "p_src_s3", first_name: "Sanitized", last_name: "SmallSource", split_pct: 75, monthly_draw: 500, start_date: "2026-06-01", active: true };
    const accSmallSrc = { id: "P_ACC_S3", investor_id: "P_SRC_S3", starting_capital: 2500, status: "Active" };

    const invRec = { id: "P_REC_S4", portal_username: "p_rec_s4", first_name: "Sanitized", last_name: "RecipientTwo", split_pct: 100, monthly_draw: 0, start_date: "2026-06-01", active: true };
    const accRec = { id: "P_ACC_S4", investor_id: "P_REC_S4", starting_capital: 5000, status: "Active" };

    const invNovStart = { id: "P_NOV_S5", portal_username: "p_nov_s5", first_name: "Sanitized", last_name: "NovStarter", split_pct: 100, monthly_draw: 0, start_date: "2026-11-01", active: true };
    const accNovStart = { id: "P_ACC_S5", investor_id: "P_NOV_S5", starting_capital: 10000, status: "Active" };

    const invMidStart = { id: "P_MID_S6", portal_username: "p_mid_s6", first_name: "Sanitized", last_name: "MidStarter", split_pct: 100, monthly_draw: 0, start_date: "2026-10-15", active: true };
    const accMidStart = { id: "P_ACC_S6", investor_id: "P_MID_S6", starting_capital: 8000, status: "Active" };

    const shares = [
      // Expired Sep 30 -> excluded in Oct
      { id: "cs_expired", source_investor_id: "P_SRC_S3", recipient_investor_id: "P_REC_S4", commission_percent: 30, effective_start_date: "2026-06-01", effective_end_date: "2026-09-30", status: "ended" },
      // Active from Oct 1 -> included in Oct (25% -> total 75+25 = 100%)
      { id: "cs_active_oct", source_investor_id: "P_SRC_S3", recipient_investor_id: "P_REC_S4", commission_percent: 25, effective_start_date: "2026-10-01", effective_end_date: null, status: "active" },
      // Future Nov 1 rule on MidStarter -> excluded in Oct, active in Nov
      { id: "cs_future_nov", source_investor_id: "P_MID_S6", recipient_investor_id: "P_REC_S4", commission_percent: 50, effective_start_date: "2026-11-01", effective_end_date: null, status: "active" }
    ];

    const xferId = "00000000-0000-4000-8000-000000000201";
    const deposits = [
      { id: "syn_dep_ext_s3", investor_id: "P_SRC_S3", account_id: "P_ACC_S3", amount: 2500, status: "confirmed", date: "2026-06-01", effective_accounting_date: "2026-06-01", accounting_treatment: "HISTORICAL_PROVENANCE" },
      { id: "syn_dep_new_s3", investor_id: "P_SRC_S3", account_id: "P_ACC_S3", amount: 25, status: "confirmed", date: "2026-10-01", effective_accounting_date: "2026-10-01", accounting_treatment: "NEW_CASH" },
      // Paired transfer credit leg into P_REC_S4 on 2026-10-01 ($1,000)
      { id: "syn_dep_xfer", investor_id: "P_REC_S4", account_id: "P_ACC_S4", amount: 1000, type: "Internal Transfer", status: "confirmed", date: "2026-10-01", effective_accounting_date: "2026-10-01", accounting_treatment: "INTERNAL_TRANSFER", transfer_id: xferId }
    ];

    const withdrawals = [
      // Paired transfer debit leg from P_SRC_S3 on 2026-10-01 ($1,000)
      { id: "syn_wd_xfer", investor_id: "P_SRC_S3", account_id: "P_ACC_S3", amount: 1000, status: "Completed", request_date: "2026-10-01", effective_accounting_date: "2026-10-01", transfer_id: xferId, is_draw: false },
      // Draw fulfillment withdrawal ($500) matching contractual monthly_draw = $500 (must single-count!)
      { id: "syn_wd_draw", investor_id: "P_SRC_S3", account_id: "P_ACC_S3", amount: 500, status: "Completed", request_date: "2026-10-01", effective_accounting_date: "2026-10-01", is_draw: true }
    ];

    const monthlyHistory = [
      { investor_id: "P_SRC_S3", year: 2026, month_number: 9, ending_balance: 3000.00, locked: true },
      { investor_id: "P_REC_S4", year: 2026, month_number: 9, ending_balance: 5000.00, locked: true }
    ];

    const periodOct = calculateAccountingPeriod({
      year: 2026,
      month: 10,
      fundReturnPct: 3.01,
      investors: [invSmallSrc, invRec, invNovStart, invMidStart],
      accounts: [accSmallSrc, accRec, accNovStart, accMidStart],
      deposits,
      withdrawals,
      commissionShares: shares,
      monthlyHistory,
      commissionEarnings: [],
      monthlyReturns: [{ year: 2026, month_number: 10, gross_return_pct: 3.01, locked: true }],
      cutoverAdjustments: []
    });

    const rSrc = periodOct.investors.find(i => i.investorId === "P_SRC_S3");
    const rRec = periodOct.investors.find(i => i.investorId === "P_REC_S4");
    const rNov = periodOct.investors.find(i => i.investorId === "P_NOV_S5");
    const rMid = periodOct.investors.find(i => i.investorId === "P_MID_S6");

    // P_SRC_S3: Sep End $3,000 + $25 dep - $1,000 xfer wd - $500 draw wd = $1,525 eligible
    assert.strictEqual(rSrc.eligibleCapital, 1525);
    // Gross = 1525 * 3.01% = 45.9025 -> $45.90; Recipient 25% = 45.90 * 0.25 = 11.475 -> $11.48; Source gets remainder 45.90 - 11.48 = $34.42
    assert.strictEqual(rSrc.grossFundResult, 45.90);
    assert.strictEqual(rSrc.totalRecipientCommissions, 11.48);
    assert.strictEqual(rSrc.sourceGainLoss, 34.42);
    // Single-counting invariant: $500 draw already in withdrawals, so effectiveDrawToDeduct = $0
    assert.strictEqual(rSrc.effectiveDrawToDeduct, 0);
    assert.strictEqual(rSrc.endingBalance, 1559.42); // 1525 + 34.42

    // P_REC_S4: Sep End $5,000 + $1,000 xfer dep = $6,000 eligible; gross = $180.60 (0% split/100% self)
    assert.strictEqual(rRec.eligibleCapital, 6000);
    assert.strictEqual(rRec.grossFundResult, 180.60);
    assert.strictEqual(rRec.endingBalance, 6180.60);

    // Paired internal transfer -> external cash excludes INTERNAL_TRANSFER!
    const extCashS4 = calculateTotalExternalCash({ depositRows: deposits.filter(d => d.investor_id === "P_REC_S4") });
    assert.strictEqual(extCashS4.total, 0);
    const balDepS4 = calculateBalanceAffectingDeposits({ depositRows: deposits.filter(d => d.investor_id === "P_REC_S4"), targetYear: 2026, maxMonth: 10 });
    assert.strictEqual(balDepS4, 1000);

    // Duplicate transfer_id de-duplication check in calculateLifetimeSettledWithdrawals
    const wdDupCheck = calculateLifetimeSettledWithdrawals({
      withdrawalRows: [
        withdrawals[0],
        { ...withdrawals[0], id: "syn_wd_xfer_dup" }
      ],
      accountStartDate: "2026-06-01",
      asOfDate: "2026-10-31"
    });
    assert.strictEqual(wdDupCheck.total, 1000);
    assert.strictEqual(wdDupCheck.count, 1);

    // Nov-1 starter must be PRE_START ($0) in Oct
    assert.strictEqual(rNov.isPreStart, true);
    assert.strictEqual(rNov.eligibleCapital, 0);
    assert.strictEqual(rNov.endingBalance, 0);

    // Mid-month starter (2026-10-15) current engine policy: month-level start check (no proration), future Nov commission excluded in Oct
    assert.strictEqual(rMid.isPreStart, false);
    assert.strictEqual(rMid.eligibleCapital, 8000);
    assert.strictEqual(rMid.recipientAllocations.length, 0);
    assert.strictEqual(periodOct.summary.flaggedCount, 0);

    // Unfulfilled contractual draw (when no is_draw withdrawal exists) deducts once at ending
    const unfulfilledDrawCheck = calculateInvestorMonth({
      year: 2026,
      month: 10,
      investorId: "P_UNFULFILLED",
      startDate: "2026-06-01",
      priorEndingBalance: 10000,
      deposits: 0,
      withdrawals: 0,
      drawFulfillmentWithdrawals: 0,
      priorMonthIncomingCommissions: 0,
      fundReturnPct: 2.0,
      sourceSplitPct: 100,
      commissionShares: [],
      recurringDraw: 500
    });
    assert.strictEqual(unfulfilledDrawCheck.effectiveDrawToDeduct, 500);
    assert.strictEqual(unfulfilledDrawCheck.endingBalance, 9700); // 10000 + 200 - 500

    // Loss month test (-2.00% on 75% source split, 25% recipient share -> recipient strictly $0, source bears 75% of loss)
    const lossMonthCheck = calculateInvestorMonth({
      year: 2026,
      month: 10,
      investorId: "P_LOSS",
      startDate: "2026-06-01",
      priorEndingBalance: 10000,
      deposits: 0,
      withdrawals: 0,
      drawFulfillmentWithdrawals: 0,
      priorMonthIncomingCommissions: 0,
      fundReturnPct: -2.0,
      sourceSplitPct: 75,
      commissionShares: [{ id: "cs_1", recipient_investor_id: "P_REC", commission_percent: 25 }],
      recurringDraw: 0
    });
    assert.strictEqual(lossMonthCheck.resultType, "LOSS");
    assert.strictEqual(lossMonthCheck.grossFundResult, -200);
    assert.strictEqual(lossMonthCheck.totalRecipientCommissions, 0);
    assert.strictEqual(lossMonthCheck.sourceGainLoss, -150);
    assert.strictEqual(lossMonthCheck.endingBalance, 9850);

    console.log("  PASS [2]: Small-balance HALF_UP rounding, effective-date shares, transfer invariants, draw single-counting, loss split, and start-date rules verified.");
  }

  console.log("\nNOTE: Live historical DB comparison remains BLOCKED (no verified SELECT-only credentials in workspace).");
  console.log("TRACK 2A RESULT: PASS (offline sanitized mechanics)");
}

runTests().catch(err => {
  console.error("TRACK 2A FAILED:", err);
  process.exit(1);
});
