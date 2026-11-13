import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildInvestorDashboard } from "../lib/dashboard.js";
import { calculateAccountingPeriod } from "../lib/accounting-period-engine.js";

process.env.DATA_SOURCE = "supabase";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November"
];

function makeBaseReturns() {
  return MONTHS.map((m, idx) => ({
    year: 2026,
    month_number: idx + 1,
    month: m,
    gross_return_pct: idx < 9 ? 2.0 : 0.5,
    locked: idx < 9
  }));
}

function makeLockedHistory(invId, balances) {
  return balances.map((b, idx) => ({
    id: `hist_${invId}_${idx + 1}`,
    investor_id: invId,
    year: 2026,
    month_number: idx + 1,
    month: MONTHS[idx],
    opening_balance: b.open,
    deposits: b.dep ?? 0,
    withdrawals: b.wd ?? 0,
    recurring_draw: 0,
    ending_balance: b.end,
    is_manual: false,
    locked: idx < 9,
    notes: idx >= 9 ? (b.notes ?? null) : null
  }));
}

async function runTests() {
  console.log("=== P0 NOVEMBER 2026 STARTING BALANCE REGRESSION TESTS ===");

  // 1. nwaite M10 confirmed post-placeholder deposit ($1,900) flows to M11 start,
  //    while settled M7 backdated withdrawal ($107,500) in deposits/withdrawals does NOT alter settled M7-M9 history.
  {
    const returnsSheet = makeBaseReturns();
    const historyTable = makeLockedHistory("inv_nwaite", [
      { open: 500000, end: 505000 },
      { open: 505000, end: 510050 },
      { open: 510050, end: 515150.5 },
      { open: 515150.5, end: 520302 },
      { open: 520302, end: 525505.02 },
      { open: 525505.02, end: 530760.07 },
      { open: 530760.07, end: 536067.67 },
      { open: 536067.67, end: 541428.35 },
      { open: 541428.35, end: 548166.25 },
      // M10 stale placeholder only recorded $6,500 deposit, missing $1,900 added later
      { open: 548166.25, dep: 6500, end: 554666.25, notes: "PROJECTION_VOIDED" },
      // M11 placeholder also stale AND notes === null (worst case without PROJECTION_VOIDED prefix)
      { open: 554666.25, dep: 0, end: 554666.25, notes: null }
    ]);

    const preloaded = {
      asOfDate: "2026-11-13T20:00:00Z",
      rawInvestors: [{
        id: "inv_nwaite",
        portal_username: "nwaite",
        first_name: "Neal",
        last_name: "Waite",
        split_pct: 50,
        monthly_draw: 0,
        start_date: "2026-01-01",
        active: true
      }],
      accounts: [{ id: "acc_nwaite", investor_id: "inv_nwaite", starting_capital: 500000, status: "Active" }],
      returnsSheet,
      depositsSheet: [
        { id: "dep_oct_1", investor_id: "inv_nwaite", date: "2026-10-01", effective_accounting_date: "2026-10-01", amount: 6500, status: "confirmed", accounting_treatment: "NEW_CASH" },
        { id: "dep_2d443d76", investor_id: "inv_nwaite", date: "2026-10-01", effective_accounting_date: "2026-10-01", amount: 1900, status: "confirmed", accounting_treatment: "NEW_CASH" }
      ],
      withdrawalsSheet: [
        // Backdated July completed withdrawal that must NOT retroactively rewrite locked M7-M9 history
        { id: "wd_backdated_m7", investor_id: "inv_nwaite", request_date: "2026-07-01", effective_accounting_date: "2026-07-01", year: 2026, month_number: 7, amount: 107500, status: "Completed" }
      ],
      historyTable,
      commissionEarningsTable: [],
      commissionSharesTable: [],
      commissionRulesTable: [],
      cutovers: [],
      live: { today: "0%", week: "0%", month: "0%", year: "0%" }
    };

    const res = await buildInvestorDashboard("inv_nwaite", preloaded, { asOfDate: "2026-11-13T20:00:00Z" });
    const m9 = res.breakdown.find(r => r.monthNumber === 9);
    const m10 = res.breakdown.find(r => r.monthNumber === 10);
    const m11 = res.breakdown.find(r => r.monthNumber === 11);

    assert.strictEqual(m9.endingBalance, 548166.25, "Settled M9 ending must remain untouched ($548,166.25)");
    assert.strictEqual(m10.deposits, 8400, "M10 breakdown deposits must equal $8,400");
    assert.strictEqual(m10.adjustedStartingBalance, 556566.25, "M10 adjustedStart must reflect full $8,400 Oct deposits");
    assert.strictEqual(m10.endingBalance, 556566.25, "M10 ending must reflect full $8,400 Oct deposits");
    assert.strictEqual(m11.startingBalance, 556566.25, "M11 opening must roll forward $556,566.25 even if h11.notes is null");
    assert.strictEqual(m11.adjustedStartingBalance, 556566.25, "M11 adjusted starting balance must be $556,566.25");
    assert.strictEqual(res.summary.currentBalance, 556566.25, "Summary currentBalance must be $556,566.25");
    console.log("  PASS 1: M10 post-placeholder deposit flows to M11 while locked M7-M9 stays untouched.");
  }

  // 2. Future-start investor (2026-12-01 viewed in Nov 2026, even with spurious M11 placeholder & M12 return row)
  {
    const returnsWithDec = [
      ...makeBaseReturns(),
      { year: 2026, month_number: 12, month: "December", gross_return_pct: 0, locked: false }
    ];
    const preloaded = {
      asOfDate: "2026-11-13T20:00:00Z",
      rawInvestors: [{
        id: "inv_jefuller",
        portal_username: "jefuller",
        first_name: "J",
        last_name: "Fuller",
        split_pct: 50,
        monthly_draw: 0,
        start_date: "2026-12-01",
        active: true
      }],
      accounts: [{ id: "acc_jefuller", investor_id: "inv_jefuller", starting_capital: 150000, status: "Active" }],
      returnsSheet: returnsWithDec,
      depositsSheet: [],
      withdrawalsSheet: [],
      historyTable: [{
        id: "hist_jefuller_11",
        investor_id: "inv_jefuller",
        year: 2026,
        month_number: 11,
        month: "November",
        opening_balance: 150000,
        deposits: 0,
        withdrawals: 0,
        recurring_draw: 0,
        ending_balance: 150000,
        is_manual: false,
        locked: false,
        notes: null
      }],
      commissionEarningsTable: [],
      commissionSharesTable: [],
      commissionRulesTable: [],
      cutovers: [],
      live: { today: "0%", week: "0%", month: "0%", year: "0%" }
    };

    const res = await buildInvestorDashboard("inv_jefuller", preloaded, { asOfDate: "2026-11-13T20:00:00Z" });
    const m11 = res.breakdown.find(r => r.monthNumber === 11);
    assert.strictEqual(m11.startingBalance, 0, "Future Dec-1 starter must have $0 M11 startingBalance");
    assert.strictEqual(m11.endingBalance, 0, "Future Dec-1 starter must have $0 M11 endingBalance");
    assert.strictEqual(res.summary.currentBalance, 0, "Future Dec-1 starter must have $0 summary.currentBalance");
    assert.strictEqual(res.summary.netChange, 0, "Future Dec-1 starter must have $0 summary.netChange");
    console.log("  PASS 2: Future Dec-1 starter shows $0 M11 startingBalance and $0 summary.currentBalance.");
  }

  // 3. Nov-1 starter with spurious M10 pre-start row + M11 live deposit + cutoverAdjustments destructuring
  {
    const returnsSheet = makeBaseReturns();
    const preloaded = {
      asOfDate: "2026-11-13T20:00:00Z",
      rawInvestors: [
        {
          id: "inv_nov1",
          portal_username: "dheiner",
          split_pct: 50,
          monthly_draw: 0,
          start_date: "2026-11-01",
          active: true
        },
        {
          id: "inv_cut",
          portal_username: "cuttest",
          split_pct: 50,
          monthly_draw: 0,
          start_date: "2026-08-01",
          active: true
        }
      ],
      accounts: [
        { id: "acc_nov1", investor_id: "inv_nov1", starting_capital: 20000, status: "Active" },
        { id: "acc_cut", investor_id: "inv_cut", starting_capital: 10000, status: "Active" }
      ],
      returnsSheet,
      depositsSheet: [
        { id: "dep_m11", investor_id: "inv_nov1", date: "2026-11-01", effective_accounting_date: "2026-11-01", amount: 5000, status: "confirmed", accounting_treatment: "NEW_CASH" }
      ],
      withdrawalsSheet: [],
      historyTable: [
        { id: "h_nov1_10", investor_id: "inv_nov1", year: 2026, month_number: 10, opening_balance: 20000, deposits: 0, withdrawals: 0, ending_balance: 20000, is_manual: false, locked: false },
        { id: "h_nov1_11", investor_id: "inv_nov1", year: 2026, month_number: 11, opening_balance: 20000, deposits: 0, withdrawals: 0, ending_balance: 20000, is_manual: false, locked: false },
        { id: "h_cut_10", investor_id: "inv_cut", year: 2026, month_number: 10, opening_balance: 25000, deposits: 0, withdrawals: 0, ending_balance: 25000, is_manual: false, locked: false },
        { id: "h_cut_11", investor_id: "inv_cut", year: 2026, month_number: 11, opening_balance: 25000, deposits: 0, withdrawals: 0, ending_balance: 25000, is_manual: false, locked: false }
      ],
      commissionEarningsTable: [],
      commissionSharesTable: [],
      commissionRulesTable: [],
      cutoverAdjustments: [
        { id: "cut_10", investor_id: "inv_cut", year: 2026, month_number: 10, authorized_opening_balance: 30000 }
      ],
      live: { today: "0%", week: "0%", month: "0%", year: "0%" }
    };

    const nov1Res = await buildInvestorDashboard("inv_nov1", preloaded, { asOfDate: "2026-11-13T20:00:00Z" });
    const nov1M10 = nov1Res.breakdown.find(r => r.monthNumber === 10);
    const nov1M11 = nov1Res.breakdown.find(r => r.monthNumber === 11);
    assert.strictEqual(nov1M10.endingBalance, 0, "Nov-1 starter must report $0 in pre-start M10 despite pre-start history row");
    assert.strictEqual(nov1M11.startingBalance, 20000, "Nov-1 starter M11 startingBalance must be $20,000");
    assert.strictEqual(nov1M11.adjustedStartingBalance, 25000, "Nov-1 starter M11 adjustedStart must include $5,000 Nov deposit");
    assert.strictEqual(nov1Res.summary.currentBalance, 25000, "Nov-1 starter summary.currentBalance must be $25,000");

    const cutRes = await buildInvestorDashboard("inv_cut", preloaded, { asOfDate: "2026-11-13T20:00:00Z" });
    const cutM10 = cutRes.breakdown.find(r => r.monthNumber === 10);
    assert.strictEqual(cutM10.startingBalance, 30000, "preloadedData.cutoverAdjustments must still apply when preloadedData.cutovers is omitted");

    const legacyCutRes = await buildInvestorDashboard("inv_cut", {
      ...preloaded,
      cutoverAdjustments: [
        { id: "cut_10_legacy", investor_id: "inv_cut", year: 2026, month_number: 10, cutover_opening_balance: 31000 },
        { id: "cut_11_null", investor_id: "inv_cut", year: 2026, month_number: 11 }
      ]
    }, { asOfDate: "2026-11-13T20:00:00Z" });
    assert.strictEqual(legacyCutRes.breakdown.find(r => r.monthNumber === 10).startingBalance, 31000, "legacy cutover_opening_balance alias must resolve cleanly");
    assert.strictEqual(legacyCutRes.breakdown.find(r => r.monthNumber === 11).startingBalance, 31000, "cutover row missing opening balance must fall back safely without throwing DecimalError");
    console.log("  PASS 3: Nov-1 pre-start suppression, M11 live deposit, and cutoverAdjustments fallback verified.");
  }

  // 4. Period preview engine must exclude HISTORICAL_PROVENANCE, status=VOID/CANCELLED, and commission deposits
  {
    const preview = calculateAccountingPeriod({
      year: 2026,
      month: 10,
      fundReturnPct: 0,
      returnStatus: "OPEN",
      investors: [{ id: "inv_stout", portal_username: "jstout", split_pct: 100, monthly_draw: 0, active: true }],
      accounts: [{ id: "acc_stout", investor_id: "inv_stout", status: "Active" }],
      deposits: [
        { id: "d1", investor_id: "inv_stout", effective_accounting_date: "2026-10-01", amount: 2500, status: "confirmed", accounting_treatment: "INTERNAL_TRANSFER" },
        { id: "d2", investor_id: "inv_stout", effective_accounting_date: "2026-10-01", amount: 6500, type: "Deposit", status: "void", accounting_treatment: "NEW_CASH" },
        { id: "d3", investor_id: "inv_stout", effective_accounting_date: "2026-10-01", amount: 1606090, type: "Historical Outside Cash", status: "confirmed", accounting_treatment: "HISTORICAL_PROVENANCE" },
        { id: "d4", investor_id: "inv_stout", effective_accounting_date: "2026-10-01", amount: 500, status: "confirmed", accounting_treatment: "NEW_CASH", is_commission: true }
      ],
      withdrawals: [],
      commissionShares: [],
      monthlyHistory: [{ investor_id: "inv_stout", year: 2026, month_number: 9, ending_balance: 3331758.56, locked: true }],
      commissionEarnings: [],
      monthlyReturns: [{ year: 2026, month_number: 9, locked: true }]
    });
    const inv = preview.investors[0];
    assert.strictEqual(inv.deposits, 2500, "Period engine must exclude status=void, HISTORICAL_PROVENANCE, and commission deposits");
    console.log("  PASS 4: Period preview engine excludes HISTORICAL_PROVENANCE ($1,606,090) and status=void deposits.");
  }

  // 5. Static source verification: paginatedRead in admin accounts & accounting-consistency endpoints
  {
    const accountsSrc = fs.readFileSync(path.resolve("api/admin/accounts/index.js"), "utf8");
    const consistencySrc = fs.readFileSync(path.resolve("api/admin/accounting-consistency/index.js"), "utf8");
    assert(accountsSrc.includes('paginatedRead("investor_monthly_history")'), "api/admin/accounts must paginate investor_monthly_history");
    assert(accountsSrc.includes('paginatedRead("commission_earnings")'), "api/admin/accounts must paginate commission_earnings");
    assert(accountsSrc.includes('paginatedRead("commission_shares")'), "api/admin/accounts must paginate commission_shares");
    assert(accountsSrc.includes('paginatedRead("account_cutover_adjustments")'), "api/admin/accounts must read cutovers");
    assert(accountsSrc.includes("cutovers:"), "api/admin/accounts must forward cutovers in preloadedData");
    assert(consistencySrc.includes('paginatedRead("investor_monthly_history"'), "api/admin/accounting-consistency must paginate investor_monthly_history");
    assert(consistencySrc.includes('paginatedRead("commission_earnings"'), "api/admin/accounting-consistency must paginate commission_earnings");
    console.log("  PASS 5: Admin accounts and consistency endpoints use paginatedRead and forward cutovers/shares.");
  }

  console.log("=== ALL 5 P0 NOVEMBER REGRESSION TESTS PASSED ===");
}

runTests().catch(err => {
  console.error("TEST FAILED:", err);
  process.exit(1);
});
