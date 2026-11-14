import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { hashPassword, isBcryptHash } from "../../lib/password.js";
import { paginatedRead } from "../../lib/supabase.js";

const localEnv = path.resolve(process.cwd(), ".env.local");
const fallbackEnv = "C:/Users/Shilley Pc/ForexPage/.env.local";
dotenv.config({ path: fs.existsSync(localEnv) ? localEnv : fallbackEnv });

const isApply = process.argv.includes("--apply");

function monthStartFromDate(dateStr) {
  if (!dateStr) return null;
  const s = String(dateStr).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return `${s.slice(0, 7)}-01`;
}

function deterministicBackfillKey(prefix, row) {
  const hash = crypto
    .createHash("sha256")
    .update(`${prefix}:${row.id}:${row.investor_id || ""}:${row.amount || 0}`)
    .digest("hex")
    .slice(0, 16);
  return `${prefix}_backfill_${row.id}_${hash}`;
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  }

  const supabase = createClient(url, key);

  const [investors, accounts, deposits, withdrawals, monthlyReturns, historyRows, commissionShares, accountingPeriods] = await Promise.all([
    paginatedRead("investors", { client: supabase, select: "id, portal_username, active, split_pct, start_date, role, temp_password" }),
    paginatedRead("investor_accounts", { client: supabase, select: "id, investor_id, status" }),
    paginatedRead("deposits", { client: supabase, select: "id, investor_id, amount, type, status, date, effective_accounting_date, accounting_treatment, idempotency_key" }),
    paginatedRead("withdrawals", { client: supabase, select: "id, investor_id, amount, status, request_date, effective_accounting_date, year, month_number, is_draw, idempotency_key" }),
    paginatedRead("monthly_returns", { client: supabase, select: "year, month_number, month, gross_return_pct, source, locked" }),
    paginatedRead("investor_monthly_history", { client: supabase, select: "id, investor_id, year, month_number, locked, opening_balance, deposits, withdrawals, ending_balance" }),
    paginatedRead("commission_shares", { client: supabase, select: "id, source_investor_id, recipient_investor_id, commission_percent, effective_start_date, effective_end_date, status" }),
    paginatedRead("accounting_periods", { client: supabase, select: "id, year, month_number, status, finalized_by" })
  ]);

  const invMap = new Map(investors.map(i => [i.id, i]));

  // Plan items (strictly safe, non-balance-altering data hygiene + blocked items flagged for owner sign-off)
  const plan = {
    voidZeroDeposits: deposits.filter(d => Number(d.amount || 0) <= 0 && String(d.status || "").toLowerCase() !== "void"),
    backfillDepositEffDates: deposits.filter(d => !d.effective_accounting_date && monthStartFromDate(d.date)),
    backfillDepositKeys: deposits.filter(d => !d.idempotency_key),
    backfillWithdrawalKeys: withdrawals.filter(w => !w.idempotency_key),
    cancelStaleQaPendingWds: withdrawals.filter(w => {
      const inv = invMap.get(w.investor_id);
      return String(w.status || "").toLowerCase() === "pending" && inv && inv.active === false && Number(w.year) <= 2023;
    }),
    deactivateInactiveInvestorAccounts: accounts.filter(a => {
      const inv = invMap.get(a.investor_id);
      return inv && inv.active === false && String(a.status || "").toLowerCase() === "active";
    }),
    cancelOverlappingShareIds: [
      // Duplicate active valdes rule (effective 2026-07-01..2026-07-01 overlapping open active 16.7% rule)
      "f6add723-8d74-4dd4-abb3-af08f89fc023",
      // Ended rule overlapping active 9.6% rule on inv_1f9ab366::inv_920b8af8
      "1a7b0437-7581-4e3a-a8d1-a8cf99a137e1"
    ].filter(targetId => commissionShares.some(s => s.id === targetId && String(s.status || "").toLowerCase() !== "cancelled")),
    lockCompletedReturns2026: monthlyReturns.filter(r => r.year === 2026 && r.month_number <= 10 && !r.locked),
    lockHistoryRowsM1toM10: historyRows.filter(h => h.year === 2026 && h.month_number <= 10 && !h.locked),
    synthetic2099TestPeriods: accountingPeriods.filter(p => p.year === 2099 && p.finalized_by === "TEST"),
    synthetic2099TestReturns: monthlyReturns.filter(r => r.year === 2099 && r.source === "TEST"),
    plaintextPasswords: investors.filter(i => i.temp_password && !isBcryptHash(i.temp_password))
  };

  console.log(`\n=== LIVE HYGIENE RECONCILIATION (${isApply ? "APPLY" : "DRY-RUN"}) ===`);
  console.log(`1. Zero-dollar deposits to mark void:            ${plan.voidZeroDeposits.length}`);
  console.log(`2. Deposits missing effective_accounting_date:   ${plan.backfillDepositEffDates.length}`);
  console.log(`3. Deposits missing idempotency_key:             ${plan.backfillDepositKeys.length}`);
  console.log(`4. Withdrawals missing idempotency_key:          ${plan.backfillWithdrawalKeys.length}`);
  console.log(`5. Stale 2023 Pending QA withdrawals to Cancel:  ${plan.cancelStaleQaPendingWds.length}`);
  console.log(`6. Inactive investors with Active accounts:      ${plan.deactivateInactiveInvestorAccounts.length}`);
  console.log(`7. Overlapping commission_shares to cancel:      ${plan.cancelOverlappingShareIds.length}`);
  console.log(`8. Completed 2026 returns (M1..M10) to lock:     ${plan.lockCompletedReturns2026.length}`);
  console.log(`9. Completed 2026 history rows (M1..M10) lock:   ${plan.lockHistoryRowsM1toM10.length}`);
  console.log(`10. Synthetic 2099-1 TEST periods/returns:       ${plan.synthetic2099TestPeriods.length} / ${plan.synthetic2099TestReturns.length}`);
  console.log(`11. Plaintext investor passwords to bcrypt-hash: ${plan.plaintextPasswords.length}`);

  console.log("\n=== EXPLICIT OWNER DETERMINATIONS REQUIRED (NEVER AUTO-MODIFIED) ===");
  const jefuller = invMap.get("inv_1e88ff0c");
  const jefullerShares = commissionShares.filter(s => s.source_investor_id === "inv_1e88ff0c" && String(s.status || "").toLowerCase() === "active");
  if (jefuller && Number(jefuller.split_pct) < 100 && jefullerShares.length === 0) {
    console.log(" - ACTION REQUIRED: Jerry Fuller (inv_1e88ff0c / jefuller, starts 2026-12-01, $150,000, split_pct=50%) has 0% commission_shares recipients configured (50% unallocated).");
  }
  console.log(" - ACTION REQUIRED: Confirm whether Jeff Bennion's M9 September 2026 locked history ($2,751,548.78) needs an authorized M11 cutover adjustment or stays anchored to September locked close.");

  if (!isApply) {
    console.log("\nDry-run finished cleanly. Zero database mutations performed.");
    return;
  }

  for (const dep of plan.voidZeroDeposits) {
    const { error } = await supabase.from("deposits").update({ status: "void", type: "VOID", void_reason: "Zero-dollar empty record cleanup" }).eq("id", dep.id);
    if (error) throw new Error(`voidZeroDeposits ${dep.id}: ${error.message}`);
  }

  for (const dep of plan.backfillDepositEffDates) {
    const eff = monthStartFromDate(dep.date);
    const { error } = await supabase.from("deposits").update({ effective_accounting_date: eff }).eq("id", dep.id);
    if (error) throw new Error(`backfillDepositEffDates ${dep.id}: ${error.message}`);
  }

  for (const dep of plan.backfillDepositKeys) {
    const { error } = await supabase.from("deposits").update({ idempotency_key: deterministicBackfillKey("dep", dep) }).eq("id", dep.id);
    if (error) throw new Error(`backfillDepositKeys ${dep.id}: ${error.message}`);
  }

  for (const wd of plan.backfillWithdrawalKeys) {
    const { error } = await supabase.from("withdrawals").update({ idempotency_key: deterministicBackfillKey("wd", wd) }).eq("id", wd.id);
    if (error) throw new Error(`backfillWithdrawalKeys ${wd.id}: ${error.message}`);
  }

  for (const wd of plan.cancelStaleQaPendingWds) {
    const { error } = await supabase.from("withdrawals").update({ status: "Cancelled", notes: "Stale 2023 QA test row cancelled during 2026-11-14 hygiene" }).eq("id", wd.id);
    if (error) throw new Error(`cancelStaleQaPendingWds ${wd.id}: ${error.message}`);
  }

  for (const acc of plan.deactivateInactiveInvestorAccounts) {
    const { error } = await supabase.from("investor_accounts").update({ status: "Inactive" }).eq("id", acc.id);
    if (error) throw new Error(`deactivateInactiveInvestorAccounts ${acc.id}: ${error.message}`);
  }

  for (const shareId of plan.cancelOverlappingShareIds) {
    const { error } = await supabase.from("commission_shares").update({ status: "cancelled", notes: "Duplicate/overlapping share cancelled during 2026-11-14 hygiene" }).eq("id", shareId);
    if (error) throw new Error(`cancelOverlappingShareIds ${shareId}: ${error.message}`);
  }

  for (const ret of plan.lockCompletedReturns2026) {
    const { error } = await supabase.from("monthly_returns").update({ locked: true }).eq("year", ret.year).eq("month_number", ret.month_number);
    if (error) throw new Error(`lockCompletedReturns2026 ${ret.year}-${ret.month_number}: ${error.message}`);
  }

  for (const h of plan.lockHistoryRowsM1toM10) {
    const { error } = await supabase.from("investor_monthly_history").update({ locked: true }).eq("id", h.id);
    if (error) throw new Error(`lockHistoryRowsM1toM10 ${h.id}: ${error.message}`);
  }

  for (const ret of plan.synthetic2099TestReturns) {
    const { error } = await supabase.from("monthly_returns").delete().eq("year", ret.year).eq("month_number", ret.month_number);
    if (error) console.warn(`Could not delete synthetic monthly_returns 2099-1 (trigger protected?): ${error.message}`);
  }

  for (const p of plan.synthetic2099TestPeriods) {
    const { error } = await supabase.from("accounting_periods").delete().eq("id", p.id);
    if (error) console.warn(`Could not delete synthetic accounting_periods 2099-1 (trigger protected?): ${error.message}`);
  }

  for (const inv of plan.plaintextPasswords) {
    const { error } = await supabase.from("investors").update({ temp_password: hashPassword(inv.temp_password) }).eq("id", inv.id);
    if (error) throw new Error(`plaintextPasswords ${inv.id}: ${error.message}`);
  }

  console.log("\nHygiene apply completed cleanly.");
}

main().catch(err => {
  console.error("Hygiene reconciliation failed:", err.message);
  process.exit(1);
});
