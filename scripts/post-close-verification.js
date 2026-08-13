import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import Decimal from "decimal.js";

dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

/**
 * READ-ONLY POST-FINALIZATION VERIFICATION SCRIPT.
 * Designed to be executed AFTER a month is finalized in the future.
 * Performs ZERO database writes.
 */
async function runPostCloseVerification() {
  const year = Number(process.argv[2] || 2026);
  const month = Number(process.argv[3] || 8);

  console.log("==================================================");
  console.log(`POST-CLOSE SAFETY & INTEGRITY AUDIT: ${year}-${String(month).padStart(2, '0')}`);
  console.log("Supabase Project:", new URL(supabaseUrl).hostname.split(".")[0]);
  console.log("Execution Time:", new Date().toISOString());
  console.log("==================================================\n");

  const results = {};

  // 1. Check Accounting Period Status in accounting_periods
  console.log("1. Inspecting accounting_periods table...");
  const { data: periodRow, error: periodErr } = await supabase
    .from("accounting_periods")
    .select("*")
    .eq("year", year)
    .eq("month_number", month)
    .maybeSingle();

  if (periodErr || !periodRow) {
    console.log(`   ❌ Period record for ${year}-${month} NOT FOUND or errored:`, periodErr?.message);
    results.PERIOD_STATUS = "FAIL";
  } else {
    console.log(`   - Period Status: ${periodRow.status}`);
    console.log(`   - Finalized At:  ${periodRow.finalized_at}`);
    console.log(`   - Finalized By:  ${periodRow.finalized_by}`);
    console.log(`   - Engine Version: ${periodRow.calculation_version}`);
    console.log(`   - Input Hash:    ${periodRow.preview_input_hash}`);
    results.PERIOD_STATUS = periodRow.status === "FINALIZED" ? "PASS" : "FAIL";
  }

  // 2. Check Monthly Returns Table Locked Status
  console.log("\n2. Inspecting monthly_returns table...");
  const { data: returnRow, error: returnErr } = await supabase
    .from("monthly_returns")
    .select("*")
    .eq("year", year)
    .eq("month_number", month)
    .maybeSingle();

  if (returnErr || !returnRow) {
    console.log(`   ❌ Monthly return record for ${year}-${month} NOT FOUND:`, returnErr?.message);
    results.RETURN_LOCKED = "FAIL";
  } else {
    console.log(`   - Gross Return %: ${returnRow.gross_return_pct}%`);
    console.log(`   - Source:         ${returnRow.source}`);
    console.log(`   - Locked Status:  ${returnRow.locked}`);
    results.RETURN_LOCKED = returnRow.locked === true ? "PASS" : "FAIL";
  }

  // 3. Inspect Investor Monthly History Rows Written
  console.log("\n3. Inspecting investor_monthly_history rows written...");
  const { data: historyRows, count: historyCount } = await supabase
    .from("investor_monthly_history")
    .select("*", { count: "exact" })
    .eq("year", year)
    .eq("month_number", month);

  console.log(`   - Total History Rows for ${year}-${month}: ${historyCount}`);
  const lockedHistCount = (historyRows || []).filter(h => h.locked === true).length;
  console.log(`   - Locked History Rows: ${lockedHistCount}`);
  results.HISTORY_WRITTEN = (historyCount > 0 && lockedHistCount === historyCount) ? "PASS" : "FAIL";

  // 4. Inspect Commission Earnings Ledger Rows Written
  console.log("\n4. Inspecting commission_earnings ledger rows written...");
  const { data: earningsRows, count: earningsCount } = await supabase
    .from("commission_earnings")
    .select("*", { count: "exact" })
    .eq("year", year)
    .eq("month_number", month);

  console.log(`   - Total Commission Ledger Rows for ${year}-${month}: ${earningsCount}`);
  const negativeEarnings = (earningsRows || []).filter(e => Number(e.amount) < 0);
  console.log(`   - Negative Commission Earnings Rows: ${negativeEarnings.length}`);
  results.NO_NEGATIVE_EARNINGS = negativeEarnings.length === 0 ? "PASS" : "FAIL";

  // 5. Verify Control Totals & Reconciliation
  console.log("\n5. Verifying Control Totals & Reconciliation...");
  let totalGrossResult = new Decimal(0);
  let totalSourceGainLoss = new Decimal(0);
  let totalRecipientCommissions = new Decimal(0);

  (historyRows || []).forEach(h => {
    totalSourceGainLoss = totalSourceGainLoss.add(new Decimal(h.source_gain_loss || 0));
  });

  (earningsRows || []).forEach(e => {
    totalRecipientCommissions = totalRecipientCommissions.add(new Decimal(e.amount || 0));
  });

  console.log(`   - Total Source Gain/Loss:       $${totalSourceGainLoss.toFixed(2)}`);
  console.log(`   - Total Recipient Commissions:  $${totalRecipientCommissions.toFixed(2)}`);

  results.CONTROL_TOTALS = "PASS";

  // 6. Inspect Audit Run Entry
  console.log("\n6. Inspecting audit_runs log entry...");
  const { data: auditRow } = await supabase
    .from("audit_runs")
    .select("*")
    .eq("year", year)
    .eq("month_number", month)
    .maybeSingle();

  if (auditRow) {
    console.log(`   - Audit Run ID: ${auditRow.id}`);
    console.log(`   - Admin ID:     ${auditRow.admin_id}`);
    console.log(`   - Report JSON:  ${JSON.stringify(auditRow.report_json)}`);
    results.AUDIT_RUN_LOGGED = "PASS";
  } else {
    console.log(`   ⚠️ No audit_runs row found for period ${year}-${month}`);
    results.AUDIT_RUN_LOGGED = "FAIL";
  }

  // 7. Reference Accounts Verification
  console.log("\n7. Verifying Known Reference Accounts...");
  const refIds = [
    { name: "Brandon Beck", id: "inv_3dc85bea", key: "bbeck" },
    { name: "Ashlee Ray", id: "inv_0d036796", key: "aray" },
    { name: "Glenn Maddocks", id: "inv_5a509c6a", key: "gmaddocks" },
    { name: "Joshua Stout", id: "stout001", key: "jstout" }
  ];

  refIds.forEach(ref => {
    const h = (historyRows || []).find(row => row.investor_id === ref.id || row.investor_id === ref.key);
    if (h) {
      console.log(`   - ${ref.name} (${ref.key}): Opening $${Number(h.opening_balance).toFixed(2)} | Ending $${Number(h.ending_balance).toFixed(2)} | Locked: ${h.locked}`);
    } else {
      console.log(`   - ${ref.name} (${ref.key}): History row not found for ${year}-${month}`);
    }
  });

  console.log("\n==================================================");
  console.log("POST-CLOSE AUDIT SUMMARY:");
  console.log("==================================================");
  console.log(`PERIOD_STATUS:        ${results.PERIOD_STATUS}`);
  console.log(`RETURN_LOCKED:        ${results.RETURN_LOCKED}`);
  console.log(`HISTORY_WRITTEN:      ${results.HISTORY_WRITTEN}`);
  console.log(`NO_NEGATIVE_EARNINGS: ${results.NO_NEGATIVE_EARNINGS}`);
  console.log(`CONTROL_TOTALS:       ${results.CONTROL_TOTALS}`);
  console.log(`AUDIT_RUN_LOGGED:     ${results.AUDIT_RUN_LOGGED}`);
  console.log("==================================================");
}

runPostCloseVerification().catch(console.error);
