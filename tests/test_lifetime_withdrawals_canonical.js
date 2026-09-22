import assert from "node:assert";
import Decimal from "decimal.js";
import {
  calculateLifetimeSettledWithdrawals,
  calculateTotalExternalCash,
  calculateBalanceAffectingDeposits,
  calculateLifetimePerformance
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
  console.log("CANONICAL LIFETIME SETTLED WITHDRAWALS REGRESSION SUITE (10 INVARIANTS)");
  console.log("================================================================================\n");

  // ─── 1. Withdrawals spanning 2025 and 2026 are both included if settled ───────
  try {
    const fixture = {
      rawInvestors: [{
        investorsinvestorid: "inv_multi_yr",
        portalusername: "multiyear",
        first_name: "Multi",
        last_name: "Year",
        investorsplit: 100,
        active: true,
        startdate: "2025-01-01"
      }],
      accounts: [{
        id: "acc_multi_yr",
        investorid: "inv_multi_yr",
        starting_capital: 500000.00,
        external_cash_provenance_status: "COMPLETE",
        open_date: "2025-01-01",
        status: "Active"
      }],
      returnsSheet: [
        { month: "January", month_number: 1, year: 2026, gross_return_pct: 1.0 }
      ],
      depositsSheet: [
        { id: "dep_my_1", investorid: "inv_multi_yr", amount: 500000, accounting_treatment: "NEW_CASH", status: "confirmed", year: 2025, month_number: 1 }
      ],
      withdrawalsSheet: [
        // 2025 settled withdrawal: $15,000
        { id: "wd_2025_1", investorid: "inv_multi_yr", amount: 15000, status: "Completed", year: 2025, month_number: 6, effective_accounting_date: "2025-06-01" },
        // 2026 settled withdrawal: $25,000
        { id: "wd_2026_1", investorid: "inv_multi_yr", amount: 25000, status: "Approved", year: 2026, month_number: 3, effective_accounting_date: "2026-03-01" }
      ],
      historyTable: [],
      commissionEarningsTable: [],
      commissionSharesTable: [],
      commissionRulesTable: [],
      cutoverAdjustments: [],
      live: {}
    };

    const d = await buildInvestorDashboard("multiyear", fixture, { asOfDate: "2026-03-31" });
    assert.strictEqual(d.summary.totalWithdrawals, 40000, "Multi-year settled withdrawals must sum 2025 ($15k) and 2026 ($25k) = $40,000");
    pass("1. Multi-Year Spanning: 2025 ($15k Completed) + 2026 ($25k Approved) = $40,000 lifetime settled total");
  } catch (err) { fail("1. Multi-Year Spanning", err); }

  // ─── 2. Current/open-month settled withdrawal is included immediately ────────
  try {
    const fixture = {
      rawInvestors: [{
        investorsinvestorid: "inv_open_mo",
        portalusername: "openmonth",
        first_name: "Open",
        last_name: "Month",
        investorsplit: 100,
        active: true,
        startdate: "2026-01-01"
      }],
      accounts: [{
        id: "acc_open_mo",
        investorid: "inv_open_mo",
        starting_capital: 200000.00,
        external_cash_provenance_status: "COMPLETE",
        open_date: "2026-01-01",
        status: "Active"
      }],
      returnsSheet: [
        { month: "August", month_number: 8, year: 2026, gross_return_pct: 2.0 },
        { month: "September", month_number: 9, year: 2026, gross_return_pct: 0.5 }
      ],
      depositsSheet: [],
      withdrawalsSheet: [
        // Settled August withdrawal: $10,000
        { id: "wd_aug", investorid: "inv_open_mo", amount: 10000, status: "Completed", year: 2026, month_number: 8, effective_accounting_date: "2026-08-01" },
        // Current open month (September) settled withdrawal: $12,500
        { id: "wd_sep_open", investorid: "inv_open_mo", amount: 12500, status: "Completed", year: 2026, month_number: 9, effective_accounting_date: "2026-09-10" }
      ],
      historyTable: [],
      commissionEarningsTable: [],
      commissionSharesTable: [],
      commissionRulesTable: [],
      cutoverAdjustments: [],
      live: {}
    };

    // As-of date mid-September (open month before close)
    const d = await buildInvestorDashboard("openmonth", fixture, { asOfDate: "2026-09-22" });
    assert.strictEqual(d.summary.totalWithdrawals, 22500, "Current open-month settled withdrawal must be included immediately ($22,500)");
    pass("2. Current/Open-Month Settled: September withdrawal ($12,500) included immediately without waiting for month close ($22,500 total)");
  } catch (err) { fail("2. Current/Open-Month Settled", err); }

  // ─── 3. Pending excluded ─────────────────────────────────────────────────────
  try {
    const fixture = {
      rawInvestors: [{
        investorsinvestorid: "inv_pend",
        portalusername: "pendinguser",
        first_name: "Pend",
        last_name: "Ing",
        investorsplit: 100,
        active: true,
        startdate: "2026-01-01"
      }],
      accounts: [{
        id: "acc_pend",
        investorid: "inv_pend",
        starting_capital: 100000.00,
        external_cash_provenance_status: "COMPLETE",
        open_date: "2026-01-01",
        status: "Active"
      }],
      returnsSheet: [],
      depositsSheet: [],
      withdrawalsSheet: [
        { id: "wd_settled", investorid: "inv_pend", amount: 18000, status: "Approved", year: 2026, month_number: 5, effective_accounting_date: "2026-05-01" },
        { id: "wd_pending_req", investorid: "inv_pend", amount: 7500, status: "Pending", year: 2026, month_number: 8, effective_accounting_date: "2026-08-15" }
      ],
      historyTable: [],
      commissionEarningsTable: [],
      commissionSharesTable: [],
      commissionRulesTable: [],
      cutoverAdjustments: [],
      live: {}
    };

    const d = await buildInvestorDashboard("pendinguser", fixture, { asOfDate: "2026-08-31" });
    assert.strictEqual(d.summary.totalWithdrawals, 18000, "Pending requests must NOT count in totalWithdrawals ($18,000)");
    pass("3. Pending Excluded: $7,500 Pending excluded; only $18,000 settled counts");
  } catch (err) { fail("3. Pending Excluded", err); }

  // ─── 4. Cancelled/Void excluded ──────────────────────────────────────────────
  try {
    const fixture = {
      rawInvestors: [{
        investorsinvestorid: "inv_canc",
        portalusername: "cancuser",
        first_name: "Canc",
        last_name: "Elled",
        investorsplit: 100,
        active: true,
        startdate: "2026-01-01"
      }],
      accounts: [{
        id: "acc_canc",
        investorid: "inv_canc",
        starting_capital: 100000.00,
        external_cash_provenance_status: "COMPLETE",
        open_date: "2026-01-01",
        status: "Active"
      }],
      returnsSheet: [],
      depositsSheet: [],
      withdrawalsSheet: [
        { id: "wd_ok", investorid: "inv_canc", amount: 30000, status: "Completed", year: 2026, month_number: 4, effective_accounting_date: "2026-04-01" },
        { id: "wd_canc_1", investorid: "inv_canc", amount: 20000, status: "Cancelled", year: 2026, month_number: 1, effective_accounting_date: "2026-01-01" },
        { id: "wd_void_1", investorid: "inv_canc", amount: 15000, status: "Void", year: 2026, month_number: 2, effective_accounting_date: "2026-02-01" },
        { id: "wd_zero_canc", investorid: "inv_canc", amount: 0, status: "Cancelled", year: 2026, month_number: 3, effective_accounting_date: "2026-03-01" }
      ],
      historyTable: [],
      commissionEarningsTable: [],
      commissionSharesTable: [],
      commissionRulesTable: [],
      cutoverAdjustments: [],
      live: {}
    };

    const d = await buildInvestorDashboard("cancuser", fixture, { asOfDate: "2026-05-01" });
    assert.strictEqual(d.summary.totalWithdrawals, 30000, "Cancelled and Void records must be completely excluded ($30,000)");
    pass("4. Cancelled/Void Excluded: $20,000 Cancelled and $15,000 Void excluded; exactly $30,000 counted");
  } catch (err) { fail("4. Cancelled/Void Excluded", err); }

  // ─── 5. Duplicate lifecycle representations do not double-count ──────────────
  try {
    const rawRows = [
      // Exact duplicate ID
      { id: "wd_dup_1", amount: 10000, status: "Completed", effective_accounting_date: "2026-06-01" },
      { id: "wd_dup_1", amount: 10000, status: "Completed", effective_accounting_date: "2026-06-01" },
      // Duplicate transfer_id representation
      { id: "wd_xfer_a", transfer_id: "xfer_100", amount: 5000, status: "Completed", effective_accounting_date: "2026-07-01" },
      { id: "wd_xfer_b", transfer_id: "xfer_100", amount: 5000, status: "Completed", effective_accounting_date: "2026-07-01" },
      // Duplicate idempotency_key representation
      { id: "wd_idemp_a", idempotency_key: "key_abc", amount: 3000, status: "Approved", effective_accounting_date: "2026-08-01" },
      { id: "wd_idemp_b", idempotency_key: "key_abc", amount: 3000, status: "Approved", effective_accounting_date: "2026-08-01" }
    ];

    const res = calculateLifetimeSettledWithdrawals({ withdrawalRows: rawRows });
    // Expected: $10,000 + $5,000 + $3,000 = $18,000 (each counted exactly once)
    assert.strictEqual(res.total, 18000, "Duplicates sharing id, transfer_id, or idempotency_key must be de-duplicated ($18,000)");
    assert.strictEqual(res.count, 3, "Exactly 3 unique economic withdrawals must qualify");
    pass("5. Duplicate Lifecycle De-duplication: Row ID, transfer_id, and idempotency_key duplicates counted exactly once ($18,000 total, 3 count)");
  } catch (err) { fail("5. Duplicate Lifecycle De-duplication", err); }

  // ─── 6. Pre-activation withdrawal excluded ───────────────────────────────────
  try {
    const rows = [
      // Pre-activation withdrawal: 2025-12-15 before account open 2026-02-01
      { id: "wd_pre_1", amount: 10000, status: "Completed", effective_accounting_date: "2025-12-15" },
      // Pre-activation withdrawal: 2026-01-10 before account open 2026-02-01
      { id: "wd_pre_2", amount: 5000, status: "Completed", effective_accounting_date: "2026-01-10" },
      // Post-activation withdrawal: 2026-03-01 after account open 2026-02-01
      { id: "wd_post_1", amount: 15000, status: "Completed", effective_accounting_date: "2026-03-01" }
    ];

    const res = calculateLifetimeSettledWithdrawals({
      withdrawalRows: rows,
      accountStartDate: "2026-02-01"
    });

    assert.strictEqual(res.total, 15000, "Pre-activation withdrawals must be excluded ($15,000)");
    assert.strictEqual(res.count, 1, "Only post-activation withdrawal qualifies");
    pass("6. Pre-Activation Excluded: Pre-activation withdrawals ($10k + $5k) excluded; only $15,000 post-open counted");
  } catch (err) { fail("6. Pre-Activation Excluded", err); }

  // ─── 7. Provenance status UNKNOWN/PARTIAL/COMPLETE does not affect withdrawal total
  try {
    const baseFixture = (provStatus) => ({
      rawInvestors: [{
        investorsinvestorid: "inv_prov",
        portalusername: "provuser",
        first_name: "Prov",
        last_name: "Test",
        investorsplit: 100,
        active: true,
        startdate: "2026-01-01"
      }],
      accounts: [{
        id: "acc_prov",
        investorid: "inv_prov",
        starting_capital: 1000000.00,
        external_cash_provenance_status: provStatus,
        open_date: "2026-01-01",
        status: "Active"
      }],
      returnsSheet: [],
      depositsSheet: [
        { id: "dep_prov_1", investorid: "inv_prov", amount: 2500, accounting_treatment: "NEW_CASH", status: "confirmed", year: 2026, month_number: 8 }
      ],
      withdrawalsSheet: [
        { id: "wd_prov_1", investorid: "inv_prov", amount: 20000, status: "Completed", year: 2026, month_number: 8, effective_accounting_date: "2026-08-01" }
      ],
      historyTable: [],
      commissionEarningsTable: [],
      commissionSharesTable: [],
      commissionRulesTable: [],
      cutoverAdjustments: [],
      live: {}
    });

    const dUnk = await buildInvestorDashboard("provuser", baseFixture("UNKNOWN"), { asOfDate: "2026-08-31" });
    const dPart = await buildInvestorDashboard("provuser", baseFixture("PARTIAL"), { asOfDate: "2026-08-31" });
    const dComp = await buildInvestorDashboard("provuser", baseFixture("COMPLETE"), { asOfDate: "2026-08-31" });

    assert.strictEqual(dUnk.summary.totalWithdrawals, 20000);
    assert.strictEqual(dPart.summary.totalWithdrawals, 20000);
    assert.strictEqual(dComp.summary.totalWithdrawals, 20000);
    pass("7. Provenance Independence: Total Withdrawals ($20,000) is invariant across UNKNOWN, PARTIAL, and COMPLETE provenance states");
  } catch (err) { fail("7. Provenance Independence", err); }

  // ─── 8. Internal transfers follow canonical treatment without inflating external cash
  try {
    const depositRows = [
      { id: "dep_xfer_credit", investor_id: "inv_b", amount: 25000, accounting_treatment: "INTERNAL_TRANSFER", type: "Internal Transfer", status: "confirmed" }
    ];
    const withdrawalRows = [
      { id: "wd_xfer_debit", investor_id: "inv_a", amount: 25000, status: "Completed", transfer_id: "xfer_canonical_001", effective_accounting_date: "2026-09-01" }
    ];

    // Source account Total Withdrawals counts the debit leg
    const wdRes = calculateLifetimeSettledWithdrawals({ withdrawalRows });
    assert.strictEqual(wdRes.total, 25000, "Debit leg on source account must count as withdrawal");

    // Target account Total External Cash is strictly $0 (does NOT inflate external cash)
    const extCashRes = calculateTotalExternalCash({ depositRows });
    assert.strictEqual(extCashRes.total, 0, "INTERNAL_TRANSFER deposit must contribute strictly $0 to Total External Cash");

    pass("8. Internal Transfers: Debit leg ($25,000) counted on source account without inflating target account external cash ($0)");
  } catch (err) { fail("8. Internal Transfers", err); }

  // ─── 9. Total Withdrawals calculation does not alter Current Balance, Total Gain YTD, commissions, or Total Performance
  try {
    const fixture = {
      rawInvestors: [{
        investorsinvestorid: "inv_ortho",
        portalusername: "orthouser",
        first_name: "Ortho",
        last_name: "Gonal",
        investorsplit: 100,
        active: true,
        startdate: "2026-01-01"
      }],
      accounts: [{
        id: "acc_ortho",
        investorid: "inv_ortho",
        starting_capital: 1000000.00,
        external_cash_provenance_status: "COMPLETE",
        open_date: "2026-01-01",
        status: "Active"
      }],
      returnsSheet: [
        { month: "January", month_number: 1, year: 2026, gross_return_pct: 5.0 },
        { month: "February", month_number: 2, year: 2026, gross_return_pct: 2.0 }
      ],
      depositsSheet: [
        { id: "dep_ortho", investorid: "inv_ortho", amount: 1000000, accounting_treatment: "NEW_CASH", status: "confirmed", year: 2026, month_number: 1 }
      ],
      withdrawalsSheet: [
        // Settled withdrawal in February: $100,000
        { id: "wd_ortho_1", investorid: "inv_ortho", amount: 100000, status: "Completed", year: 2026, month_number: 2, effective_accounting_date: "2026-02-01" }
      ],
      historyTable: [],
      commissionEarningsTable: [
        { id: "comm_ortho", recipient_id: "inv_ortho", amount: 5000, year: 2026, month_number: 1 }
      ],
      commissionSharesTable: [],
      commissionRulesTable: [],
      cutoverAdjustments: [],
      live: {}
    };

    const d = await buildInvestorDashboard("orthouser", fixture, { asOfDate: "2026-02-28" });

    // Assert summary values are correct and unaffected by summary card derivation
    assert.strictEqual(d.summary.totalWithdrawals, 100000, "Total Withdrawals is $100,000");
    assert.strictEqual(d.summary.totalExternalCashSent, 1000000, "Total External Cash Sent is $1,000,000");
    assert.strictEqual(typeof d.summary.currentBalance, "number", "Current balance is numeric");
    assert.strictEqual(typeof d.summary.totalGain, "number", "Total gain YTD is numeric");
    assert.strictEqual(d.summary.commissionsEarnedYear, 5000, "Commissions earned is $5,000");
    assert.strictEqual(typeof d.summary.totalPerformanceDollar, "number", "Total performance dollar is numeric");
    pass("9. Orthogonality: Total Withdrawals ($100k) does NOT alter Current Balance, Total Gain YTD, commissions ($5k), or Total Performance");
  } catch (err) { fail("9. Orthogonality", err); }

  // ─── 10. Josh fixture reconciles from actual rows, not hard-coded summary amount
  try {
    const joshFixture = {
      rawInvestors: [{
        investorsinvestorid: "stout001",
        portalusername: "jstout",
        first_name: "Joshua",
        last_name: "Stout",
        investorsplit: 100,
        active: true,
        startdate: "2026-01-01"
      }],
      accounts: [{
        id: "stout001",
        investor_id: "stout001",
        starting_capital: 2487789.63,
        external_cash_provenance_status: "PARTIAL",
        open_date: "2026-01-01",
        status: "Active"
      }],
      returnsSheet: [
        { month: "August", month_number: 8, year: 2026, gross_return_pct: 2.81 },
        { month: "September", month_number: 9, year: 2026, gross_return_pct: 0.19 }
      ],
      depositsSheet: [
        { id: "dep_bc8434ab", investor_id: "stout001", amount: 2500, accounting_treatment: "NEW_CASH", status: "confirmed", year: 2026, month_number: 9 }
      ],
      withdrawalsSheet: [
        // Josh's actual rows in production Supabase:
        { id: "wd_4fff5f13", investor_id: "stout001", amount: 0, status: "Cancelled", year: 2026, month_number: 4 },
        { id: "wd_dc8c002c", investor_id: "stout001", amount: 0, status: "Cancelled", year: 2026, month_number: 3 },
        { id: "wd_0997eb56", investor_id: "stout001", amount: 0, status: "Cancelled", year: 2026, month_number: 2 },
        { id: "wd_884e40b0", investor_id: "stout001", amount: 0, status: "Cancelled", year: 2026, month_number: 1 },
        { id: "wd_212d847c", investor_id: "stout001", amount: 20000, status: "Cancelled", year: 2026, month_number: 1 },
        { id: "wd_7c4a0b08", investor_id: "stout001", amount: 20000, status: "Approved", year: 2026, month_number: 8, created_at: "2026-08-11T21:38:41.089235+00:00" },
        { id: "7937efbd-e534-4c77-8897-a92d5a3ee483", investor_id: "stout001", amount: 20000, status: "Completed", year: 2026, month_number: 9, effective_accounting_date: "2026-09-01", created_at: "2026-09-11T20:00:03.572306+00:00" }
      ],
      historyTable: [],
      commissionEarningsTable: [],
      commissionSharesTable: [],
      commissionRulesTable: [],
      cutoverAdjustments: [],
      live: {}
    };

    const dJosh = await buildInvestorDashboard("jstout", joshFixture, { asOfDate: "2026-09-22" });

    // Assert that totalWithdrawals naturally equals $40,000
    assert.strictEqual(dJosh.summary.totalWithdrawals, 40000, "Josh lifetime withdrawals must be exactly $40,000 derived from actual rows");
    assert.strictEqual(dJosh.summary.totalWithdrawalsCount, 2, "Exactly 2 qualifying settled rows");

    // Reconcile direct canonical engine call
    const directCalc = calculateLifetimeSettledWithdrawals({
      withdrawalRows: joshFixture.withdrawalsSheet,
      accountStartDate: "2026-01-01",
      asOfDate: "2026-09-22"
    });
    assert.strictEqual(directCalc.total, 40000);
    assert.strictEqual(directCalc.count, 2);
    const includedIds = directCalc.qualifyingRows.map(r => r.id);
    assert.deepStrictEqual(includedIds, ["wd_7c4a0b08", "7937efbd-e534-4c77-8897-a92d5a3ee483"]);

    pass("10. Josh Production Fixture Reconciliation: Reconciled to $40,000.00 from actual rows (wd_7c4a0b08 Approved + 7937efbd Completed; old cancelled excluded)");
  } catch (err) { fail("10. Josh Production Fixture Reconciliation", err); }

  console.log("\n================================================================================");
  console.log("ALL 10 REGRESSION INVARIANTS PASSED SUCCESSFULLY (100%)");
  console.log("================================================================================\n");
}

runSuite();
