import assert from "node:assert";
import Decimal from "decimal.js";
import { buildInvestorDashboard } from "../lib/dashboard.js";

async function verifyJstoutExactScreenshot() {
  console.log("=== JOSHUA STOUT EXACT SCREENSHOT VERIFICATION ===");

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
    status: "active"
  }];

  // August ending balance before September was $3,293,591.25.
  // Plus August commission credited Sept 1 ($11,183.58) => $3,304,774.83.
  const jstoutHistory = [
    {
      id: "h_jstout_7",
      investor_id: "stout001",
      year: 2026,
      month_number: 7,
      month: "July",
      opening_balance: 3107634.54,
      deposits: 54219.35,
      withdrawals: 0,
      gross_return_pct: 3.13,
      manual_gain_amount: 97268.96,
      ending_balance: 3204903.50,
      is_manual: true
    },
    {
      id: "h_jstout_8",
      investor_id: "stout001",
      year: 2026,
      month_number: 8,
      month: "August",
      opening_balance: 3214239.08,
      deposits: 2500.00,
      withdrawals: 20000.00,
      gross_return_pct: 3.03,
      manual_gain_amount: 96860.93,
      ending_balance: 3293591.25,
      is_manual: true
    }
  ];

  const jstoutCommissions = [
    { id: "c_jul", recipient_id: "stout001", year: 2026, month_number: 7, amount: 9326.82 },
    { id: "c_aug", recipient_id: "stout001", year: 2026, month_number: 8, amount: 11183.58 },
    { id: "c_sep", recipient_id: "stout001", year: 2026, month_number: 9, amount: 715.76 } // Open accrual
  ];

  const preloaded = {
    rawInvestors: jstoutInvestors,
    accounts: jstoutAccounts,
    returnsSheet: [
      { id: "r_7", year: 2026, month_number: 7, month: "July", gross_return_pct: 3.13 },
      { id: "r_8", year: 2026, month_number: 8, month: "August", gross_return_pct: 3.03 },
      { id: "r_9", year: 2026, month_number: 9, month: "September", gross_return_pct: 0.19 }
    ],
    depositsSheet: [
      { id: "dep_7", investorid: "stout001", year: 2026, month_number: 7, amount: 54219.35 },
      { id: "dep_8", investorid: "stout001", year: 2026, month_number: 8, amount: 2500.00 }
    ],
    withdrawalsSheet: [
      { id: "wd_8", investorid: "stout001", year: 2026, month_number: 8, amount: 20000.00, status: "completed" }
    ],
    historyTable: jstoutHistory,
    commissionEarningsTable: jstoutCommissions,
    commissionSharesTable: [],
    commissionRulesTable: [],
    cutoverAdjustments: [],
    live: {
      today: "+0.05%",
      week: "+0.10%",
      month: "+0.19%",
      lastMonth: "+3.03%",
      year: "+29.82%"
    }
  };

  const d = await buildInvestorDashboard("jstout", preloaded);

  console.log("Current Balance:           $", d.summary.currentBalance.toLocaleString('en-US', { minimumFractionDigits: 2 }));
  console.log("Total Gain YTD:            $", d.summary.totalGain.toLocaleString('en-US', { minimumFractionDigits: 2 }));
  console.log("Total Performance Dollar:  $", d.summary.totalPerformanceDollar.toLocaleString('en-US', { minimumFractionDigits: 2 }));
  console.log("Total Performance %:       ", d.summary.totalPerformancePct.toFixed(2) + "%");
  console.log("Live 'This Month' Net Return:", d.accountPerformance.month.netReturnPct + "%");
  console.log("Live 'This Month' Net Dollar: $", d.accountPerformance.month.netDollar.toLocaleString('en-US', { minimumFractionDigits: 2 }));
  console.log("Commission Card Label:     Comm.", d.summary.commMonthName);
  console.log("Commission Card Month:     $", d.summary.commissionsEarnedMonth.toLocaleString('en-US', { minimumFractionDigits: 2 }));
  console.log("Commission Card Year:      $", d.summary.commissionsEarnedYear.toLocaleString('en-US', { minimumFractionDigits: 2 }));

  const sepRow = d.breakdown.find(r => r.monthNumber === 9);
  console.log("September Breakdown Row:   Net Return: " + sepRow.effectiveReturnPct + "%, Net Gain: $" + sepRow.gain.toFixed(2) + ", Starting: $" + sepRow.adjustedStartingBalance.toFixed(2));

  // Assertions:
  // 1. Current Balance excludes September $6,279.07 gain
  assert.strictEqual(d.summary.currentBalance, sepRow.adjustedStartingBalance);
  // 2. September breakdown shows 0.00% and $0.00
  assert.strictEqual(sepRow.effectiveReturnPct, 0);
  assert.strictEqual(sepRow.gain, 0);
  // 3. Live card shows live +0.19% and live dollar gain
  assert.strictEqual(d.accountPerformance.month.netReturnPct, 0.19);
  assert(d.accountPerformance.month.netDollar > 0);
  // 4. Commission card shows August ($11,183.58)
  assert.strictEqual(d.summary.commMonthName, "August");
  assert.strictEqual(d.summary.commissionsEarnedMonth, 11183.58);
  // 5. Commission year excludes September ($715.76)
  assert.strictEqual(d.summary.commissionsEarnedYear, 9326.82 + 11183.58);

  console.log("\n✓ ALL JOSHUA STOUT SCREENSHOT RECONCILIATIONS MATCH PERFECTLY!");
}

verifyJstoutExactScreenshot().catch(console.error);
