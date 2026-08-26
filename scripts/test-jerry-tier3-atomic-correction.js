/**
 * JERRY'S ROGUE JETS TIER 3 AUGUST WITHDRAWAL ATOMIC CORRECTION TEST SUITE
 * Simulates production schema, Package B functions, and Tier 3 atomic correction logic.
 */

import Decimal from "decimal.js";

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

// In-Memory Database Fixture mimicking PostgreSQL tables
class MockDatabase {
  constructor() {
    this.reset();
  }

  reset() {
    this.investors = [
      {
        id: "jerrys001",
        portal_username: "jerrys",
        start_date: "2026-05-01",
        split_pct: 70.00,
        status: "Active"
      }
    ];

    this.investor_accounts = [
      {
        id: "jerrys001",
        investor_id: "jerrys001",
        open_date: "2026-05-01",
        starting_capital: 514124.14,
        status: "Active"
      }
    ];

    this.deposits = [];

    this.withdrawals = [
      {
        id: "wd_2eeb5318",
        investor_id: "jerrys001",
        account_id: "jerrys001",
        amount: 7500.00,
        status: "Cancelled",
        year: 2026,
        month_number: 5,
        effective_accounting_date: null
      },
      {
        id: "wd_5614f2b2",
        investor_id: "jerrys001",
        account_id: "jerrys001",
        amount: 2500.00,
        status: "Completed",
        year: 2026,
        month_number: 5,
        effective_accounting_date: null
      },
      {
        id: "wd_e380829e",
        investor_id: "jerrys001",
        account_id: "jerrys001",
        amount: 2500.00,
        status: "Completed",
        year: 2026,
        month_number: 7,
        effective_accounting_date: null
      }
    ];

    this.commission_earnings = [];

    this.investor_monthly_history = [
      {
        id: "hist_mar",
        investor_id: "jerrys001",
        year: 2026,
        month_number: 3,
        opening_balance: 514124.14,
        deposits: 0,
        withdrawals: 0,
        gross_return_pct: 3.18,
        ending_balance: 514124.14,
        is_manual: false,
        locked: false
      },
      {
        id: "hist_apr",
        investor_id: "jerrys001",
        year: 2026,
        month_number: 4,
        opening_balance: 514124.14,
        deposits: 0,
        withdrawals: 0,
        gross_return_pct: 3.15,
        ending_balance: 514124.14,
        is_manual: false,
        locked: false
      },
      {
        id: "hist_may",
        investor_id: "jerrys001",
        year: 2026,
        month_number: 5,
        opening_balance: 514124.14,
        deposits: 0,
        withdrawals: 2500.00,
        gross_return_pct: 3.31,
        ending_balance: 523478.4713238,
        is_manual: false,
        locked: true
      },
      {
        id: "hist_jun",
        investor_id: "jerrys001",
        year: 2026,
        month_number: 6,
        opening_balance: 523478.4713238,
        deposits: 0,
        withdrawals: 0,
        gross_return_pct: 3.67,
        ending_balance: 536926.6332521,
        is_manual: false,
        locked: true
      },
      {
        id: "hist_jul",
        investor_id: "jerrys001",
        year: 2026,
        month_number: 7,
        opening_balance: 536926.6332521,
        deposits: 0,
        withdrawals: 2500.00,
        gross_return_pct: 3.13,
        ending_balance: 546135.9207867,
        is_manual: false,
        locked: true
      },
      {
        id: "hist_aug",
        investor_id: "jerrys001",
        year: 2026,
        month_number: 8,
        opening_balance: 546135.9207867,
        deposits: 0,
        withdrawals: 0,
        gross_return_pct: 0,
        ending_balance: 546135.9207867,
        is_manual: false,
        locked: false
      }
    ];

    this.locks = new Set();
  }

  // Package B Available Equity Calculation
  calculate_available_withdrawal_equity_sql(investor_id, account_id, effective_date, exclude_withdrawal_id = null) {
    const inv = this.investors.find(i => i.id === investor_id);
    if (!inv) throw new Error("INVESTOR_NOT_FOUND");

    const acc = this.investor_accounts.find(a => a.investor_id === investor_id);
    if (!acc) throw new Error("ACCOUNT_NOT_FOUND");

    const effDate = new Date(effective_date);
    const targetYear = effDate.getUTCFullYear();
    const targetMonth = effDate.getUTCMonth() + 1;

    // Start date check
    const startYear = parseInt(acc.open_date.slice(0, 4), 10);
    const startMonth = parseInt(acc.open_date.slice(5, 7), 10);
    const invStartYear = parseInt(inv.start_date.slice(0, 4), 10);
    const invStartMonth = parseInt(inv.start_date.slice(5, 7), 10);

    if (startYear !== invStartYear || startMonth !== invStartMonth) {
      throw new Error(`ACCOUNT_START_DATE_CONFLICT: Account open period (${startYear}-${startMonth}) conflicts with investor start period (${invStartYear}-${invStartMonth}).`);
    }

    const isFirstPeriod = (targetYear === startYear && targetMonth === startMonth);
    let priorEnding = new Decimal(0);

    if (isFirstPeriod) {
      priorEnding = new Decimal(acc.starting_capital);
    } else {
      const priorMonth = targetMonth === 1 ? 12 : targetMonth - 1;
      const priorYear = targetMonth === 1 ? targetYear - 1 : targetYear;
      const hist = this.investor_monthly_history.find(h => h.investor_id === investor_id && h.year === priorYear && h.month_number === priorMonth);
      if (!hist) throw new Error(`ACCOUNTING_HISTORY_INCOMPLETE: Prior month ${priorYear}-${priorMonth} missing`);
      priorEnding = new Decimal(hist.ending_balance);
    }

    // Active other withdrawals
    const activeWds = this.withdrawals.filter(w => {
      if (w.investor_id !== investor_id) return false;
      if (exclude_withdrawal_id && w.id === exclude_withdrawal_id) return false;
      if (!["pending", "approved", "completed"].includes((w.status || "").toLowerCase())) return false;
      return (w.year === targetYear && w.month_number === targetMonth);
    });

    const sumOtherWds = activeWds.reduce((acc, w) => acc.plus(w.amount), new Decimal(0));
    const available = priorEnding.minus(sumOtherWds);
    return Decimal.max(0, available).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
  }

  // Tier 3 Atomic Correction Execution
  apply_jerry_august_withdrawal_correction_atomic(payload) {
    const {
      p_investor_id = "jerrys001",
      p_account_id = "jerrys001",
      p_amount = 2500.00,
      p_effective_date = "2026-08-01",
      p_idempotency_key,
      p_created_by = "admin_correction"
    } = payload;

    // 1. Lock
    if (this.locks.has(p_investor_id)) {
      throw new Error("LOCK_BUSY: Resource is locked by concurrent transaction.");
    }
    this.locks.add(p_investor_id);

    try {
      // 2. Idempotency check FIRST (Idempotent Replay)
      if (p_idempotency_key) {
        const existing = this.withdrawals.find(w => w.idempotency_key === p_idempotency_key);
        if (existing) {
          if (existing.amount === p_amount && existing.effective_accounting_date === p_effective_date) {
            return {
              status: "IDEMPOTENT_REPLAY",
              withdrawal_id: existing.id,
              amount: existing.amount,
              history_aligned: true
            };
          } else {
            throw new Error("IDEMPOTENCY_KEY_PAYLOAD_MISMATCH: Key already used for different payload");
          }
        }
      }

      // 3. CAS Assertions
      const inv = this.investors.find(i => i.id === p_investor_id);
      if (!inv || inv.start_date !== "2026-05-01") throw new Error("CAS_FAILURE: Investor baseline mismatch");

      const acc = this.investor_accounts.find(a => a.id === p_account_id && a.investor_id === p_investor_id);
      if (!acc || acc.open_date !== "2026-05-01" || acc.starting_capital !== 514124.14) {
        throw new Error("CAS_FAILURE: Account baseline mismatch");
      }

      // August history pre-state CAS
      const augHist = this.investor_monthly_history.find(h => h.investor_id === p_investor_id && h.year === 2026 && h.month_number === 8);
      if (!augHist || augHist.withdrawals !== 0 || augHist.locked === true) {
        throw new Error("CAS_FAILURE: August history pre-state mismatch");
      }

      // Available equity check
      const equity = this.calculate_available_withdrawal_equity_sql(p_investor_id, p_account_id, p_effective_date);
      if (p_amount > equity) {
        throw new Error(`WITHDRAWAL_EXCEEDS_AVAILABLE_EQUITY: Requested ${p_amount} exceeds ${equity}`);
      }

      // Duplicate check
      const dups = this.withdrawals.filter(w => 
        w.investor_id === p_investor_id && 
        w.year === 2026 && 
        w.month_number === 8 && 
        ["pending", "approved", "completed"].includes(w.status.toLowerCase())
      );
      if (dups.length > 0) {
        throw new Error("DUPLICATE_AUGUST_WITHDRAWAL_EXISTS");
      }

      // 3. Atomic Mutation Pair
      const newWdId = "wd_jerrys_20260801_" + Math.random().toString(36).substring(2, 10);
      const newWd = {
        id: newWdId,
        investor_id: p_investor_id,
        account_id: p_account_id,
        amount: p_amount,
        status: "Approved",
        request_date: p_effective_date,
        effective_accounting_date: p_effective_date,
        year: 2026,
        month_number: 8,
        idempotency_key: p_idempotency_key,
        created_by: p_created_by,
        notes: "Client authorized recurring August withdrawal per Josh workbook instruction (Cell T273)"
      };
      this.withdrawals.push(newWd);

      // Align August history row
      const preEnding = new Decimal(augHist.opening_balance).plus(augHist.deposits);
      augHist.withdrawals = p_amount;
      augHist.ending_balance = preEnding.minus(p_amount).toNumber();

      return {
        status: "SUCCESS",
        withdrawal_id: newWdId,
        available_equity_before: equity,
        available_equity_after: equity - p_amount,
        august_history_withdrawals: augHist.withdrawals,
        august_history_ending: augHist.ending_balance
      };
    } finally {
      this.locks.delete(p_investor_id);
    }
  }

  // Atomic Reversal
  reverse_jerry_august_withdrawal_atomic(withdrawal_id) {
    const wd = this.withdrawals.find(w => w.id === withdrawal_id);
    if (!wd) throw new Error("WITHDRAWAL_NOT_FOUND");

    if (wd.status === "Cancelled") {
      return { status: "ALREADY_CANCELLED", withdrawal_id };
    }

    if (wd.status !== "Approved" && wd.status !== "Pending") {
      throw new Error(`ILLEGAL_REVERSAL: Cannot reverse status ${wd.status}`);
    }

    const augHist = this.investor_monthly_history.find(h => h.investor_id === wd.investor_id && h.year === 2026 && h.month_number === 8);
    if (!augHist) throw new Error("HISTORY_ROW_NOT_FOUND");

    // Atomic Reversal
    wd.status = "Cancelled";
    wd.notes = (wd.notes || "") + " [Reversed per audit]";

    const preEnding = new Decimal(augHist.opening_balance).plus(augHist.deposits);
    augHist.withdrawals = 0.00;
    augHist.ending_balance = preEnding.toNumber();

    return {
      status: "SUCCESS",
      withdrawal_id,
      withdrawal_status: "Cancelled",
      august_history_withdrawals: 0.00,
      august_history_ending: augHist.ending_balance
    };
  }
}

// Run Test Matrix
async function runTests() {
  console.log("=== RUNNING JERRY TIER 3 ATOMIC CORRECTION TEST SUITE ===");
  const db = new MockDatabase();
  let passed = 0;
  let total = 0;

  function assert(condition, name) {
    total++;
    if (condition) {
      console.log(`PASS [${total}]: ${name}`);
      passed++;
    } else {
      console.error(`FAIL [${total}]: ${name}`);
      throw new Error(`Test failed: ${name}`);
    }
  }

  // Test 1: Baseline Pre-Equity
  const eq = db.calculate_available_withdrawal_equity_sql("jerrys001", "jerrys001", "2026-08-01");
  assert(eq === 546135.92, "Initial available equity matches July ending balance $546,135.92");

  // Test 2: Successful Atomic Execution
  const res = db.apply_jerry_august_withdrawal_correction_atomic({
    p_idempotency_key: "idemp_test_001"
  });
  assert(res.status === "SUCCESS", "Atomic correction executes successfully");
  assert(res.available_equity_after === 543635.92, "Available equity after withdrawal is $543,635.92");
  assert(res.august_history_withdrawals === 2500.00, "August history withdrawals aligned to $2,500.00");
  assert(res.august_history_ending === 543635.9207867, "August history ending balance aligned to $543,635.92");

  // Test 3: Idempotent Replay (Same Key, Same Payload)
  const replay = db.apply_jerry_august_withdrawal_correction_atomic({
    p_idempotency_key: "idemp_test_001",
    p_amount: 2500.00
  });
  assert(replay.status === "IDEMPOTENT_REPLAY", "Same-key replay returns IDEMPOTENT_REPLAY with 0 new mutations");
  assert(db.withdrawals.length === 4, "Withdrawal count remains exactly 4 (no duplicate inserted)");

  // Test 4: Idempotency Key Conflict (Same Key, Different Payload)
  let threwMismatch = false;
  try {
    db.apply_jerry_august_withdrawal_correction_atomic({
      p_idempotency_key: "idemp_test_001",
      p_amount: 5000.00
    });
  } catch (e) {
    threwMismatch = e.message.includes("IDEMPOTENCY_KEY_PAYLOAD_MISMATCH");
  }
  assert(threwMismatch, "Different payload with same key throws IDEMPOTENCY_KEY_PAYLOAD_MISMATCH");

  // Test 5: Overdraw Rejection
  db.reset();
  let threwOverdraw = false;
  try {
    db.apply_jerry_august_withdrawal_correction_atomic({
      p_amount: 600000.00,
      p_idempotency_key: "idemp_overdraw"
    });
  } catch (e) {
    threwOverdraw = e.message.includes("WITHDRAWAL_EXCEEDS_AVAILABLE_EQUITY");
  }
  assert(threwOverdraw, "Overdraw amount correctly rejected by Package B equity check");

  // Test 6: CAS Mismatch Rejection (Metadata altered)
  db.reset();
  db.investor_accounts[0].open_date = "2026-03-01";
  let threwCas = false;
  try {
    db.apply_jerry_august_withdrawal_correction_atomic({
      p_idempotency_key: "idemp_cas_test"
    });
  } catch (e) {
    threwCas = e.message.includes("CAS_FAILURE");
  }
  assert(threwCas, "CAS mismatch (e.g. open_date 2026-03-01) aborts execution with 0 mutations");

  // Test 7: Atomic Reversal
  db.reset();
  const execRes = db.apply_jerry_august_withdrawal_correction_atomic({
    p_idempotency_key: "idemp_reversal_test"
  });
  const revRes = db.reverse_jerry_august_withdrawal_atomic(execRes.withdrawal_id);
  assert(revRes.status === "SUCCESS", "Atomic reversal executes cleanly");
  assert(revRes.withdrawal_status === "Cancelled", "Withdrawal status transitioned to Cancelled");
  assert(revRes.august_history_withdrawals === 0.00, "August history withdrawals restored to $0.00");
  assert(revRes.august_history_ending === 546135.9207867, "August history ending balance restored to $546,135.92");

  // Test 8: Post-Reversal Available Equity
  const postRevEq = db.calculate_available_withdrawal_equity_sql("jerrys001", "jerrys001", "2026-08-01");
  assert(postRevEq === 546135.92, "Post-reversal available equity restored to $546,135.92");

  console.log(`\nALL ${passed}/${total} TEST CASES PASSED SUCCESSFULLY.`);
}

runTests();
