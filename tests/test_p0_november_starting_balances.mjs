import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildInvestorDashboard } from "../lib/dashboard.js";
import { calculateAccountingPeriod } from "../lib/accounting-period-engine.js";
import recalculateAllHandler from "../api/admin/historical-data/recalculate-all.js";
import recalculateHandler from "../api/admin/historical-data/recalculate.js";
import { createSession } from "../lib/auth.js";

process.env.DATA_SOURCE = "supabase";
process.env.SESSION_SECRET = process.env.SESSION_SECRET || "test-session-secret";

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

  // 6. Accounting period engine regression: Nov 1 & Dec 1 starters ignore $0 PRE_START prior month rows
  {
    const novPeriod = calculateAccountingPeriod({
      year: 2026,
      month: 11,
      fundReturnPct: 1.25,
      returnSource: "MYFXBOOK_COMPLETED_MONTH",
      returnStatus: "FINAL_RETURN_CAPTURED",
      investors: [
        { id: "inv_nov1", portal_username: "nov1user", first_name: "Nov", last_name: "Starter", split_pct: 75, monthly_draw: 0, start_date: "2026-11-01", active: true }
      ],
      accounts: [
        { id: "acc_nov1", investor_id: "inv_nov1", starting_capital: 20000, status: "Active" }
      ],
      deposits: [],
      withdrawals: [],
      commissionShares: [
        { id: "cs_nov1", source_investor_id: "inv_nov1", recipient_investor_id: "inv_stout", commission_percent: 25, effective_start_date: "2026-11-01", status: "active" }
      ],
      monthlyHistory: [
        { investor_id: "inv_nov1", year: 2026, month_number: 10, opening_balance: 0, ending_balance: 0, locked: true, notes: "PRE_START" },
        { investor_id: "inv_nov1", year: 2026, month_number: 11, opening_balance: 0, ending_balance: 0, locked: false, notes: "OPEN_PLACEHOLDER" }
      ],
      commissionEarnings: [],
      monthlyReturns: [{ year: 2026, month_number: 10, gross_return_pct: 1.84, locked: true }]
    });
    const novInv = novPeriod.investors[0];
    assert.strictEqual(novInv.priorEndingBalance, 20000, "Nov 1 starter must seed $20,000 priorEndingBalance despite $0 PRE_START Oct row");
    assert.strictEqual(novInv.endingBalance, 20187.5, "Nov 1 starter must earn +1.25% * 75% split -> $20,187.50");

    const decPeriod = calculateAccountingPeriod({
      year: 2026,
      month: 12,
      fundReturnPct: 3.0,
      returnSource: "MYFXBOOK_COMPLETED_MONTH",
      returnStatus: "FINAL_RETURN_CAPTURED",
      investors: [
        { id: "inv_dec1", portal_username: "dec1user", first_name: "Dec", last_name: "Starter", split_pct: 50, monthly_draw: 0, start_date: "2026-12-01", active: true }
      ],
      accounts: [
        { id: "acc_dec1", investor_id: "inv_dec1", starting_capital: 150000, status: "Active" }
      ],
      deposits: [],
      withdrawals: [],
      commissionShares: [
        { id: "cs_dec1", source_investor_id: "inv_dec1", recipient_investor_id: "inv_stout", commission_percent: 50, effective_start_date: "2026-12-01", status: "active" }
      ],
      monthlyHistory: [
        { investor_id: "inv_dec1", year: 2026, month_number: 11, opening_balance: 0, ending_balance: 0, locked: true, notes: "PRE_START" },
        { investor_id: "inv_dec1", year: 2026, month_number: 12, opening_balance: 0, ending_balance: 0, locked: false, notes: "OPEN_PLACEHOLDER" }
      ],
      commissionEarnings: [],
      monthlyReturns: [{ year: 2026, month_number: 11, gross_return_pct: 1.25, locked: true }]
    });
    const decInv = decPeriod.investors[0];
    assert.strictEqual(decInv.priorEndingBalance, 150000, "Dec 1 starter must seed $150,000 priorEndingBalance despite $0 PRE_START Nov row");
    assert.strictEqual(decInv.endingBalance, 152250, "Dec 1 starter must earn +3.0% * 50% split -> $152,250.00");
    console.log("  PASS 6: Accounting period engine seeds Nov 1 & Dec 1 starters across $0 PRE_START prior rows.");
  }

  // 7. Year-boundary rollover regression: 2026-12 -> 2027-01 capitalized commissions, draws, cashflows, and Jan 2027 starters
  {
    const returns2026And2027 = [
      ...MONTHS.map((m, idx) => ({
        year: 2026, month_number: idx + 1, month: m, gross_return_pct: 1.0, locked: true
      })),
      { year: 2026, month_number: 12, month: "December", gross_return_pct: 3.0, locked: true },
      { year: 2027, month_number: 1, month: "January", gross_return_pct: 0, locked: false }
    ];
    const decLockedHist = [
      ...makeLockedHistory("inv_rec", Array(11).fill(95000)),
      { investor_id: "inv_rec", year: 2026, month_number: 12, opening_balance: 98000, deposits: 0, withdrawals: 0, gross_return_pct: 3.0, recurring_draw: 1000, ending_balance: 100000, locked: true },
      { investor_id: "inv_rec", year: 2027, month_number: 1, opening_balance: 100500, deposits: 2500, withdrawals: 0, recurring_draw: 1000, ending_balance: 102000, locked: false }
    ];
    const preloaded = {
      rawInvestors: [
        { id: "inv_rec", portal_username: "recuser", first_name: "Rec", last_name: "User", split_pct: 100, monthly_draw: 1000, start_date: "2026-01-01", active: true },
        { id: "inv_jan27", portal_username: "jan27", first_name: "Jan27", last_name: "Starter", split_pct: 100, monthly_draw: 0, start_date: "2027-01-01", active: true }
      ],
      accounts: [
        { id: "acc_rec", investor_id: "inv_rec", starting_capital: 95000, status: "Active", is_commission: true },
        { id: "acc_jan27", investor_id: "inv_jan27", starting_capital: 50000, status: "Active" }
      ],
      returnsSheet: returns2026And2027,
      depositsSheet: [
        { id: "d_aug26", investor_id: "inv_rec", date: "2026-08-01", effective_accounting_date: "2026-08-01", amount: 10000, status: "confirmed", accounting_treatment: "NEW_CASH" },
        { id: "d_jan27", investor_id: "inv_rec", date: "2027-01-01", effective_accounting_date: "2027-01-01", amount: 2500, status: "confirmed", accounting_treatment: "NEW_CASH" }
      ],
      withdrawalsSheet: [],
      historyTable: decLockedHist,
      commissionEarningsTable: [
        { recipient_id: "inv_rec", source_investor_id: "inv_src", year: 2026, month_number: 12, amount: 500, status: "ACTIVE", created_at: "2027-01-01T00:05:00Z" }
      ],
      commissionSharesTable: [],
      commissionRulesTable: [],
      cutovers: [],
      live: { today: "+0.50%", week: "+0.50%", month: "+0.50%", year: "+0.50%" }
    };

    const recJan = await buildInvestorDashboard("inv_rec", preloaded, { asOfDate: "2027-01-02T20:00:00Z" });
    assert.strictEqual(recJan.summary.currentBalance, 102000, "Jan 2027 currentBalance must capitalize Dec commission (+500), add Jan deposit (+2500), and deduct Jan draw (-1000)");
    assert.strictEqual(recJan.summary.commissionsEarnedMonth, 500, "Jan 2027 must report Dec 2026 earned commissions as last completed month");
    assert.strictEqual(recJan.summary.externalDepositsYtd, 10000, "Jan 2027 must keep full 2026 YTD deposits (not truncate maxMonth to 1)");
    assert.strictEqual(recJan.live.lastMonth, "+3.00%", "Jan 2027 must report Dec 2026 as lastMonth");
    assert.strictEqual(recJan.liveDollarGains.month, 515, "Jan 2027 live gain base must equal $103,000 (opening $100,500 + $2,500 deposit) * 0.50%");

    const jan27Before = await buildInvestorDashboard("inv_jan27", preloaded, { asOfDate: "2026-12-15T20:00:00Z" });
    assert.strictEqual(jan27Before.summary.currentBalance, 0, "Jan 2027 starter must be $0 in Dec 2026");

    const jan27Open = await buildInvestorDashboard("inv_jan27", preloaded, { asOfDate: "2027-01-02T20:00:00Z" });
    assert.strictEqual(jan27Open.summary.currentBalance, 50000, "Jan 2027 starter must report $50,000 once Jan 2027 opens");
    console.log("  PASS 7: Year-boundary 2026-12 -> 2027-01 dashboard rollover & Jan 2027 starter logic verified.");
  }

  // 8. Nov-1 starter (jgeisler $150k, locked M10 $0, corrupted open M11/M12 $0) & Dec-1 starter vs fail-closed unfinalized Oct-1
  {
    const returnsJanToDec = Array.from({ length: 12 }, (_, idx) => ({
      year: 2026,
      month_number: idx + 1,
      month: [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
      ][idx],
      gross_return_pct: idx < 10 ? 1.5 : 0,
      locked: idx < 10
    }));

    const jgeislerHistoryCorrupted = [
      {
        id: "hist_jg_10",
        investor_id: "inv_85d68e7f",
        year: 2026,
        month_number: 10,
        month: "October",
        opening_balance: 0,
        deposits: 0,
        withdrawals: 0,
        recurring_draw: 0,
        ending_balance: 0,
        is_manual: false,
        locked: true,
        notes: null
      },
      {
        id: "hist_jg_11",
        investor_id: "inv_85d68e7f",
        year: 2026,
        month_number: 11,
        month: "November",
        opening_balance: 0,
        deposits: 0,
        withdrawals: 0,
        recurring_draw: 0,
        ending_balance: 0,
        is_manual: false,
        locked: false,
        updated_at: "2026-11-19T15:32:55.052Z",
        notes: null
      },
      {
        id: "hist_jg_12",
        investor_id: "inv_85d68e7f",
        year: 2026,
        month_number: 12,
        month: "December",
        opening_balance: 0,
        deposits: 0,
        withdrawals: 0,
        recurring_draw: 0,
        ending_balance: 0,
        is_manual: false,
        locked: false,
        updated_at: "2026-11-19T15:32:55.052Z",
        notes: null
      }
    ];

    const decStarterHistoryCorrupted = [
      {
        id: "hist_dm_10",
        investor_id: "inv_dmehringer",
        year: 2026,
        month_number: 10,
        month: "October",
        opening_balance: 0,
        deposits: 0,
        withdrawals: 0,
        recurring_draw: 0,
        ending_balance: 0,
        is_manual: false,
        locked: true,
        notes: null
      },
      {
        id: "hist_dm_11",
        investor_id: "inv_dmehringer",
        year: 2026,
        month_number: 11,
        month: "November",
        opening_balance: 0,
        deposits: 0,
        withdrawals: 0,
        recurring_draw: 0,
        ending_balance: 0,
        is_manual: false,
        locked: false,
        notes: null
      },
      {
        id: "hist_dm_12",
        investor_id: "inv_dmehringer",
        year: 2026,
        month_number: 12,
        month: "December",
        opening_balance: 0,
        deposits: 0,
        withdrawals: 0,
        recurring_draw: 0,
        ending_balance: 0,
        is_manual: false,
        locked: false,
        notes: null
      }
    ];

    const preloaded = {
      asOfDate: "2026-11-19T20:00:00Z",
      rawInvestors: [
        {
          id: "inv_85d68e7f",
          portal_username: "jgeisler",
          first_name: "Jason",
          last_name: "Geisler",
          split_pct: 50,
          monthly_draw: 0,
          start_date: "2026-11-01",
          active: true,
          show_fund_performance: false
        },
        {
          id: "inv_dmehringer",
          portal_username: "dmehringer",
          first_name: "D",
          last_name: "Mehringer",
          split_pct: 50,
          monthly_draw: 0,
          start_date: "2026-12-01",
          active: true,
          show_fund_performance: false
        },
        {
          id: "inv_oct_unfinal",
          portal_username: "octunfinal",
          first_name: "O",
          last_name: "Pending",
          split_pct: 50,
          monthly_draw: 0,
          start_date: "2026-10-01",
          active: true,
          show_fund_performance: true
        }
      ],
      accounts: [
        { id: "acc_jg", investor_id: "inv_85d68e7f", starting_capital: 150000, split_pct: 50, status: "Active" },
        { id: "acc_dm", investor_id: "inv_dmehringer", starting_capital: 5000, split_pct: 50, status: "Active" },
        { id: "acc_oct", investor_id: "inv_oct_unfinal", starting_capital: 25000, split_pct: 50, status: "Active" }
      ],
      returnsSheet: returnsJanToDec,
      depositsSheet: [],
      withdrawalsSheet: [],
      historyTable: [...jgeislerHistoryCorrupted, ...decStarterHistoryCorrupted],
      commissionEarningsTable: [],
      commissionSharesTable: [],
      commissionRulesTable: [],
      cutovers: [],
      live: { today: "+0.24%", week: "+0.88%", month: "+2.12%", year: "+36.15%" }
    };

    const jgDash = await buildInvestorDashboard("jgeisler", preloaded, { asOfDate: "2026-11-19T20:00:00Z" });
    const jgNov = jgDash.breakdown.find(r => r.monthNumber === 11);
    const jgDec = jgDash.breakdown.find(r => r.monthNumber === 12);
    assert.strictEqual(jgNov.startingBalance, 150000, "jgeisler November starting balance must self-heal to $150,000");
    assert.strictEqual(jgNov.endingBalance, 150000, "jgeisler November ending balance must self-heal to $150,000");
    assert.strictEqual(jgDec.startingBalance, 150000, "jgeisler December projection starting balance must self-heal to $150,000");
    assert.strictEqual(jgDash.summary.currentBalance, 150000, "jgeisler summary currentBalance must be $150,000");
    assert.strictEqual(jgDash.liveDollarGains.today, 180, "jgeisler Today gain must be $180 ($150k * 0.24% * 50%)");
    assert.strictEqual(jgDash.liveDollarGains.week, 660, "jgeisler This Week gain must be $660 ($150k * 0.88% * 50%)");
    assert.strictEqual(jgDash.liveDollarGains.month, 1590, "jgeisler This Month gain must be $1,590 ($150k * 2.12% * 50%)");
    assert.strictEqual(jgDash.summary.totalGainUnavailable, false, "jgeisler first open month must not show YTD as unavailable");
    assert.strictEqual(jgDash.summary.totalGain, 0, "jgeisler YTD settled gain in first open month must be $0");
    assert.strictEqual(jgDash.summary.totalGainVerificationStatus, "OPEN_FIRST_PERIOD");
    assert.strictEqual(jgDash.summary.totalGainScopeLabel, "First month open (November 2026)");
    assert.ok(!jgDash.accountPerformance.year.unavailable, "jgeisler accountPerformance.year must not be unavailable");
    assert.strictEqual(jgDash.accountPerformance.year.netDollar, 0);
    assert.strictEqual(jgDash.accountPerformance.year.netReturnPct, 0);
    assert.strictEqual(jgDash.accountPerformance.year.scopeLabel, "First month open (November 2026)");

    const dmDash = await buildInvestorDashboard("dmehringer", preloaded, { asOfDate: "2026-11-19T20:00:00Z" });
    const dmNov = dmDash.breakdown.find(r => r.monthNumber === 11);
    const dmDec = dmDash.breakdown.find(r => r.monthNumber === 12);
    assert.strictEqual(dmDash.summary.currentBalance, 0, "Dec 1 starter current balance must stay $0 in November");
    assert.strictEqual(dmNov.startingBalance, 0, "Dec 1 starter November starting balance must stay $0");
    assert.strictEqual(dmDec.startingBalance, 5000, "Dec 1 starter December projection starting balance must be $5,000");
    assert.strictEqual(dmDash.summary.totalGainUnavailable, false);
    assert.strictEqual(dmDash.summary.totalGainScopeLabel, "Starts December 2026");

    // Contrast: Oct 1 starter viewed when Oct return is UNLOCKED and has no locked history must still fail closed on YTD
    const preloadedOctUnlocked = {
      ...preloaded,
      historyTable: [],
      returnsSheet: returnsJanToDec.map(r => r.month_number === 10 ? { ...r, locked: false } : r)
    };
    const octFailClosed = await buildInvestorDashboard("octunfinal", preloadedOctUnlocked, { asOfDate: "2026-11-19T20:00:00Z" });
    assert.strictEqual(octFailClosed.summary.totalGainUnavailable, true, "Unfinalized completed active month must still fail closed on YTD");
    assert.strictEqual(octFailClosed.accountPerformance.year.unavailable, true);
    assert.strictEqual(octFailClosed.fundPerformance.year.unavailable, true);
    assert.strictEqual(octFailClosed.summary.totalGainStatusText, "Temporarily unavailable while being verified");
    console.log("  PASS 8: jgeisler Nov-1 healing, OPEN_FIRST_PERIOD YTD labeling, Dec-1 future start, and fail-closed guard verified.");
  }

  // 9. recalculateAllHandler & recalculateHandler preserve locked $0 pre-start months and seed active start capital
  {
    function createMockSupabase(initialTables) {
      const tables = Object.fromEntries(
        Object.entries(initialTables).map(([k, v]) => [k, v.map(row => ({ ...row }))])
      );

      function buildQuery(tableName) {
        const filters = [];
        let orderCol = null;
        let orderAsc = true;
        let isSingle = false;

        function matchFilter(row, f) {
          if (f.type === "eq") return String(row[f.col]) === String(f.val);
          if (f.type === "in") return f.vals.map(v => String(v).toLowerCase()).includes(String(row[f.col] ?? "").toLowerCase());
          if (f.type === "not_ilike") return String(row[f.col] ?? "").toLowerCase() !== String(f.val).toLowerCase();
          if (f.type === "or") {
            const parts = f.expr.split(",");
            return parts.some(part => {
              const firstDot = part.indexOf(".");
              const secondDot = part.indexOf(".", firstDot + 1);
              const col = part.slice(0, firstDot);
              const op = part.slice(firstDot + 1, secondDot);
              const val = part.slice(secondDot + 1);
              if (op === "eq") return String(row[col] ?? "") === String(val);
              if (op === "ilike") return String(row[col] ?? "").toLowerCase() === String(val).toLowerCase();
              return false;
            });
          }
          return true;
        }

        function runSelect() {
          let rows = (tables[tableName] || []).filter(r => filters.every(f => matchFilter(r, f))).map(r => ({ ...r }));
          if (orderCol) {
            rows.sort((a, b) => {
              const av = Number(a[orderCol] ?? 0);
              const bv = Number(b[orderCol] ?? 0);
              return orderAsc ? av - bv : bv - av;
            });
          }
          if (isSingle) {
            return { data: rows[0] || null, error: rows[0] ? null : new Error(`Not found in ${tableName}`) };
          }
          return { data: rows, error: null };
        }

        const q = {
          _pendingUpsert: null,
          select() { return q; },
          eq(col, val) { filters.push({ type: "eq", col, val }); return q; },
          in(col, vals) { filters.push({ type: "in", col, vals }); return q; },
          not(col, op, val) {
            if (op === "ilike") filters.push({ type: "not_ilike", col, val });
            return q;
          },
          or(expr) { filters.push({ type: "or", expr }); return q; },
          order(col, opts = {}) { orderCol = col; orderAsc = opts.ascending !== false; return q; },
          single() { isSingle = true; return q; },
          upsert(payload) {
            const items = Array.isArray(payload) ? payload : [payload];
            const store = tables[tableName] || (tables[tableName] = []);
            const written = items.map(item => {
              const idx = store.findIndex(r =>
                r.investor_id === item.investor_id &&
                Number(r.year) === Number(item.year) &&
                Number(r.month_number) === Number(item.month_number)
              );
              const merged = idx >= 0 ? { ...store[idx], ...item } : { ...item };
              if (idx >= 0) store[idx] = merged;
              else store.push(merged);
              return merged;
            });
            q._pendingUpsert = Array.isArray(payload) ? written : written[0];
            return q;
          },
          then(resolve, reject) {
            try {
              if (q._pendingUpsert !== null) {
                resolve({ data: q._pendingUpsert, error: null });
              } else {
                resolve(runSelect());
              }
            } catch (err) {
              if (reject) reject(err);
              else throw err;
            }
          }
        };
        return q;
      }

      return {
        tables,
        client: { from: (t) => buildQuery(t) },
        paginatedRead: async (t, opts = {}) => {
          const q = buildQuery(t);
          if (opts.queryModifier) opts.queryModifier(q);
          const { data } = await q;
          return data || [];
        }
      };
    }

    function createMockRes() {
      const res = { statusCode: 200, payload: null };
      res.status = (code) => { res.statusCode = code; return res; };
      res.json = (body) => { res.payload = body; return res; };
      return res;
    }

    const adminToken = createSession({ adminId: "admin_1", role: "admin" });
    const returnsLockedOct = Array.from({ length: 12 }, (_, idx) => ({
      year: 2026,
      month_number: idx + 1,
      gross_return_pct: idx < 10 ? 1.5 : 0,
      locked: idx < 10
    }));

    const mockEnv = createMockSupabase({
      investors: [
        { id: "inv_85d68e7f", portal_username: "jgeisler", email: "jg@example.com", split_pct: 50, monthly_draw: 0, start_date: "2026-11-01", active: true, role: "investor" },
        { id: "inv_dm", portal_username: "dmehringer", email: "dm@example.com", split_pct: 50, monthly_draw: 0, start_date: "2026-12-01", active: true, role: "investor" }
      ],
      investor_accounts: [
        { id: "acc_jg", investor_id: "inv_85d68e7f", starting_capital: 150000, split_pct: 50, status: "Active" },
        { id: "acc_dm", investor_id: "inv_dm", starting_capital: 5000, split_pct: 50, status: "Active" }
      ],
      investor_monthly_history: [
        { id: "h_jg_10", investor_id: "inv_85d68e7f", year: 2026, month_number: 10, month: "October", opening_balance: 0, ending_balance: 0, locked: true },
        { id: "h_jg_11", investor_id: "inv_85d68e7f", year: 2026, month_number: 11, month: "November", opening_balance: 0, ending_balance: 0, locked: false },
        { id: "h_jg_12", investor_id: "inv_85d68e7f", year: 2026, month_number: 12, month: "December", opening_balance: 0, ending_balance: 0, locked: false },
        { id: "h_dm_10", investor_id: "inv_dm", year: 2026, month_number: 10, month: "October", opening_balance: 0, ending_balance: 0, locked: true }
      ],
      deposits: [],
      withdrawals: [],
      monthly_returns: returnsLockedOct,
      accounting_periods: [],
      commission_shares: [],
      commission_rules: [],
      commission_earnings: [],
      account_cutover_adjustments: []
    });

    const resAll = createMockRes();
    await recalculateAllHandler(
      {
        method: "POST",
        headers: { cookie: `scff_admin_session=${adminToken}` },
        body: { year: 2026, asOfDate: "2026-11-19T20:00:00Z" }
      },
      resAll,
      { supabase: mockEnv.client, paginatedRead: mockEnv.paginatedRead }
    );
    assert.strictEqual(resAll.statusCode, 200, "recalculateAllHandler must succeed");
    const jgM10 = mockEnv.tables.investor_monthly_history.find(r => r.investor_id === "inv_85d68e7f" && r.month_number === 10);
    const jgM11 = mockEnv.tables.investor_monthly_history.find(r => r.investor_id === "inv_85d68e7f" && r.month_number === 11);
    const jgM12 = mockEnv.tables.investor_monthly_history.find(r => r.investor_id === "inv_85d68e7f" && r.month_number === 12);
    assert.strictEqual(jgM10.ending_balance, 0, "Locked Oct $0 pre-start row must remain preserved");
    assert.strictEqual(jgM11.opening_balance, 150000, "recalculate-all must seed jgeisler Nov opening_balance to $150,000");
    assert.strictEqual(jgM11.ending_balance, 150000, "recalculate-all must set jgeisler Nov ending_balance to $150,000");
    assert.strictEqual(jgM12.opening_balance, 150000, "recalculate-all must carry $150,000 into Dec projection");

    // Simulate Nov 30 close for Dec-1 starter (locked M11 $0 must not zero out Dec opening)
    const dmM11 = mockEnv.tables.investor_monthly_history.find(r => r.investor_id === "inv_dm" && r.month_number === 11);
    assert.strictEqual(dmM11.opening_balance, 0, "Dec-1 starter Nov pre-start must stay $0");
    assert.strictEqual(mockEnv.tables.investor_monthly_history.find(r => r.investor_id === "inv_dm" && r.month_number === 12).opening_balance, 5000);
    dmM11.locked = true;
    const resSingle = createMockRes();
    await recalculateHandler(
      {
        method: "POST",
        headers: { cookie: `scff_admin_session=${adminToken}` },
        body: { investorId: "inv_dm", year: 2026, asOfDate: "2026-12-01T20:00:00Z" }
      },
      resSingle,
      { supabase: mockEnv.client }
    );
    assert.strictEqual(resSingle.statusCode, 200, "recalculateHandler must succeed for Dec-1 starter");
    const dmM12AfterClose = mockEnv.tables.investor_monthly_history.find(r => r.investor_id === "inv_dm" && r.month_number === 12);
    assert.strictEqual(dmM12AfterClose.opening_balance, 5000, "recalculateHandler must seed Dec-1 starting_capital ($5,000) even when Nov is locked $0");

    // Verify single-investor recalculation for jgeisler from month 11
    mockEnv.tables.investor_monthly_history.find(r => r.investor_id === "inv_85d68e7f" && r.month_number === 11).opening_balance = 0;
    const resJgSingle = createMockRes();
    await recalculateHandler(
      {
        method: "POST",
        headers: { cookie: `scff_admin_session=${adminToken}` },
        body: { investorId: "jgeisler", year: 2026, startMonthNumber: 11, asOfDate: "2026-11-19T20:00:00Z" }
      },
      resJgSingle,
      { supabase: mockEnv.client }
    );
    assert.strictEqual(resJgSingle.statusCode, 200);
    assert.strictEqual(
      mockEnv.tables.investor_monthly_history.find(r => r.investor_id === "inv_85d68e7f" && r.month_number === 11).opening_balance,
      150000,
      "recalculateHandler for jgeisler must seed $150,000 even when M10 is locked $0"
    );
    console.log("  PASS 9: recalculateAllHandler & recalculateHandler pre-start transition seeding verified.");
  }

  console.log("=== ALL 9 P0 NOVEMBER & YEAR-ROLLOVER REGRESSION TESTS PASSED ===");
}

runTests().catch(err => {
  console.error("TEST FAILED:", err);
  process.exit(1);
});
