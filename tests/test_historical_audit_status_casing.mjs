import assert from "node:assert/strict";
import { runFullHistoricalAudit } from "../lib/historical-audit-engine.js";

function buildAuditInput(withdrawals = []) {
  return {
    startYear: 2026,
    startMonth: 6,
    endYear: 2026,
    endMonth: 6,
    investors: [
      {
        id: "inv_case_1",
        portal_username: "caseuser",
        full_name: "Case User",
        active: true,
        split_pct: 70,
        start_date: "2026-01-01"
      }
    ],
    accounts: [
      {
        id: "acc_case_1",
        investor_id: "inv_case_1",
        starting_capital: 10000,
        status: "Active",
        open_date: "2026-01-01"
      }
    ],
    deposits: [],
    withdrawals,
    monthlyReturns: [
      { year: 2026, month_number: 5, gross_return_pct: 2.0, locked: true },
      { year: 2026, month_number: 6, gross_return_pct: 3.0, locked: true }
    ],
    monthlyHistory: [
      {
        investor_id: "inv_case_1",
        year: 2026,
        month_number: 5,
        opening_balance: 10000,
        deposits: 0,
        withdrawals: 0,
        ending_balance: 10000
      },
      {
        investor_id: "inv_case_1",
        year: 2026,
        month_number: 6,
        opening_balance: 10000,
        deposits: 0,
        withdrawals: 0,
        ending_balance: 10210
      }
    ],
    commissionShares: [],
    commissionEarnings: []
  };
}

function getDuplicateWithdrawals(auditRes) {
  return (auditRes.dataQualityIssues || []).filter(i => i.type === "DUPLICATE_WITHDRAWAL");
}

function runTests() {
  console.log("=== Historical Audit Engine: Withdrawal Status Casing Offline Suite ===");

  // 1. All intended case variants of approved, completed, and pending trigger DUPLICATE_WITHDRAWAL
  {
    const qualifyingPairs = [
      { amt: 101, date: "2026-06-01", statuses: ["Pending", "Pending"] },
      { amt: 102, date: "2026-06-02", statuses: ["pending", "pending"] },
      { amt: 103, date: "2026-06-03", statuses: ["PENDING", "PENDING"] },
      { amt: 104, date: "2026-06-04", statuses: ["PeNdInG", "pEnDiNg"] },
      { amt: 105, date: "2026-06-05", statuses: ["Pending", "pending"] },
      { amt: 201, date: "2026-06-06", statuses: ["Approved", "Approved"] },
      { amt: 202, date: "2026-06-07", statuses: ["approved", "approved"] },
      { amt: 203, date: "2026-06-08", statuses: ["APPROVED", "APPROVED"] },
      { amt: 204, date: "2026-06-09", statuses: ["Approved", "aPpRoVeD"] },
      { amt: 301, date: "2026-06-10", statuses: ["Completed", "Completed"] },
      { amt: 302, date: "2026-06-11", statuses: ["completed", "completed"] },
      { amt: 303, date: "2026-06-12", statuses: ["COMPLETED", "COMPLETED"] },
      { amt: 304, date: "2026-06-13", statuses: ["Completed", "cOmPlEtEd"] }
    ];

    const withdrawals = [];
    qualifyingPairs.forEach((pair, idx) => {
      withdrawals.push(
        { id: `w_${idx}_a`, investor_id: "inv_case_1", amount: pair.amt, request_date: pair.date, status: pair.statuses[0] },
        { id: `w_${idx}_b`, investor_id: "inv_case_1", amount: pair.amt, request_date: pair.date, status: pair.statuses[1] }
      );
    });

    const res = runFullHistoricalAudit(buildAuditInput(withdrawals));
    const dups = getDuplicateWithdrawals(res);
    assert.strictEqual(dups.length, qualifyingPairs.length, `Expected ${qualifyingPairs.length} duplicate warnings, got ${dups.length}`);
    assert.strictEqual(res.summaryCards.dataQualityIssuesCount, res.dataQualityIssues.length);
    for (const pair of qualifyingPairs) {
      assert(
        dups.some(d => d.detail.includes(`$${pair.amt}`) && d.detail.includes("inv_case_1")),
        `Expected DUPLICATE_WITHDRAWAL warning for $${pair.amt} (${pair.statuses.join("/")})`
      );
    }
    console.log("  PASS [1]: Case variants of approved, completed, and pending are recognized");
  }

  // 2. Null, missing, empty, whitespace-only, whitespace-padded, unexpected, and non-string statuses stay excluded
  {
    const nonQualifyingCases = [
      { label: "null", makeRow: (id, amt, date) => ({ id, investor_id: "inv_case_1", amount: amt, request_date: date, status: null }) },
      { label: "missing", makeRow: (id, amt, date) => ({ id, investor_id: "inv_case_1", amount: amt, request_date: date }) },
      { label: "undefined", makeRow: (id, amt, date) => ({ id, investor_id: "inv_case_1", amount: amt, request_date: date, status: undefined }) },
      { label: "empty", makeRow: (id, amt, date) => ({ id, investor_id: "inv_case_1", amount: amt, request_date: date, status: "" }) },
      { label: "spaces-only", makeRow: (id, amt, date) => ({ id, investor_id: "inv_case_1", amount: amt, request_date: date, status: "   " }) },
      { label: "tab-newline", makeRow: (id, amt, date) => ({ id, investor_id: "inv_case_1", amount: amt, request_date: date, status: "\t\n" }) },
      { label: "leading-space-Pending", makeRow: (id, amt, date) => ({ id, investor_id: "inv_case_1", amount: amt, request_date: date, status: " Pending" }) },
      { label: "trailing-space-Pending", makeRow: (id, amt, date) => ({ id, investor_id: "inv_case_1", amount: amt, request_date: date, status: "Pending " }) },
      { label: "padded-pending", makeRow: (id, amt, date) => ({ id, investor_id: "inv_case_1", amount: amt, request_date: date, status: " pending " }) },
      { label: "padded-Approved", makeRow: (id, amt, date) => ({ id, investor_id: "inv_case_1", amount: amt, request_date: date, status: " Approved " }) },
      { label: "tab-approved", makeRow: (id, amt, date) => ({ id, investor_id: "inv_case_1", amount: amt, request_date: date, status: "\tapproved" }) },
      { label: "newline-Completed", makeRow: (id, amt, date) => ({ id, investor_id: "inv_case_1", amount: amt, request_date: date, status: "Completed\n" }) },
      { label: "padded-completed", makeRow: (id, amt, date) => ({ id, investor_id: "inv_case_1", amount: amt, request_date: date, status: " completed " }) },
      { label: "Cancelled", makeRow: (id, amt, date) => ({ id, investor_id: "inv_case_1", amount: amt, request_date: date, status: "Cancelled" }) },
      { label: "cancelled", makeRow: (id, amt, date) => ({ id, investor_id: "inv_case_1", amount: amt, request_date: date, status: "cancelled" }) },
      { label: "Void", makeRow: (id, amt, date) => ({ id, investor_id: "inv_case_1", amount: amt, request_date: date, status: "Void" }) },
      { label: "voided", makeRow: (id, amt, date) => ({ id, investor_id: "inv_case_1", amount: amt, request_date: date, status: "Voided" }) },
      { label: "Rejected", makeRow: (id, amt, date) => ({ id, investor_id: "inv_case_1", amount: amt, request_date: date, status: "Rejected" }) },
      { label: "Failed", makeRow: (id, amt, date) => ({ id, investor_id: "inv_case_1", amount: amt, request_date: date, status: "Failed" }) },
      { label: "Draft", makeRow: (id, amt, date) => ({ id, investor_id: "inv_case_1", amount: amt, request_date: date, status: "Draft" }) },
      { label: "Paid", makeRow: (id, amt, date) => ({ id, investor_id: "inv_case_1", amount: amt, request_date: date, status: "Paid" }) },
      { label: "Unknown", makeRow: (id, amt, date) => ({ id, investor_id: "inv_case_1", amount: amt, request_date: date, status: "Unknown" }) },
      { label: "number", makeRow: (id, amt, date) => ({ id, investor_id: "inv_case_1", amount: amt, request_date: date, status: 123 }) },
      { label: "boolean", makeRow: (id, amt, date) => ({ id, investor_id: "inv_case_1", amount: amt, request_date: date, status: true }) },
      { label: "object-toString", makeRow: (id, amt, date) => ({ id, investor_id: "inv_case_1", amount: amt, request_date: date, status: { toString: () => "Pending" } }) }
    ];

    const withdrawals = [];
    nonQualifyingCases.forEach((c, idx) => {
      const amt = 500 + idx;
      const date = `2026-06-${String((idx % 28) + 1).padStart(2, "0")}`;
      withdrawals.push(
        c.makeRow(`nq_${idx}_a`, amt, date),
        c.makeRow(`nq_${idx}_b`, amt, date)
      );
    });

    const res = runFullHistoricalAudit(buildAuditInput(withdrawals));
    const dups = getDuplicateWithdrawals(res);
    assert.strictEqual(
      dups.length,
      0,
      `Expected 0 duplicate warnings for excluded/null/whitespace-padded/unexpected statuses, got ${JSON.stringify(dups)}`
    );
    console.log("  PASS [2]: Null, missing, empty, whitespace-only, whitespace-padded, unexpected, and non-string statuses remain excluded");
  }

  // 3. A single qualifying withdrawal does not create a duplicate warning
  {
    const singleWithdrawals = [
      { id: "s1", investor_id: "inv_case_1", amount: 111, request_date: "2026-06-01", status: "Pending" },
      { id: "s2", investor_id: "inv_case_1", amount: 222, request_date: "2026-06-02", status: "pending" },
      { id: "s3", investor_id: "inv_case_1", amount: 333, request_date: "2026-06-03", status: "Approved" },
      { id: "s4", investor_id: "inv_case_1", amount: 444, request_date: "2026-06-04", status: "approved" },
      { id: "s5", investor_id: "inv_case_1", amount: 555, request_date: "2026-06-05", status: "Completed" },
      { id: "s6", investor_id: "inv_case_1", amount: 666, request_date: "2026-06-06", status: "completed" }
    ];
    const res = runFullHistoricalAudit(buildAuditInput(singleWithdrawals));
    assert.strictEqual(getDuplicateWithdrawals(res).length, 0);
    assert.strictEqual(res.dataQualityIssues.length, 0);
    assert.strictEqual(res.summaryCards.dataQualityIssuesCount, 0);
    console.log("  PASS [3]: Single qualifying withdrawals create zero duplicate warnings");
  }

  // 4. Read-only behavior on an actually audited closed month: preserves input statuses and accounting outputs
  {
    const pairs = [
      ["Pending", "pending"],
      ["Approved", "approved"],
      ["Completed", "completed"]
    ];
    for (const [titleStatus, lowerStatus] of pairs) {
      const wdTitle = [{ id: "w_t", investor_id: "inv_case_1", amount: 1000, request_date: "2026-06-01", effective_accounting_date: "2026-06-01", status: titleStatus }];
      const wdLower = [{ id: "w_l", investor_id: "inv_case_1", amount: 1000, request_date: "2026-06-01", effective_accounting_date: "2026-06-01", status: lowerStatus }];

      const resTitle = runFullHistoricalAudit(buildAuditInput(wdTitle));
      const resLower = runFullHistoricalAudit(buildAuditInput(wdLower));

      assert.strictEqual(resTitle.monthlySummaries.length, 1, "June 2026 closed month must be audited");
      assert.strictEqual(resTitle.investorMonthDetails.length, 1);
      assert.strictEqual(wdTitle[0].status, titleStatus, "Audit scan must not mutate withdrawal status");
      assert.strictEqual(wdLower[0].status, lowerStatus, "Audit scan must not mutate withdrawal status");
      assert.deepStrictEqual(resTitle.investorMonthDetails, resLower.investorMonthDetails);
      assert.strictEqual(resTitle.certified, resLower.certified);
    }
    console.log("  PASS [4]: Closed-month accounting calculations and original withdrawal statuses remain untouched");
  }

  console.log("\n=== ALL HISTORICAL AUDIT STATUS CASING TESTS PASSED (4/4) ===");
}

runTests();
