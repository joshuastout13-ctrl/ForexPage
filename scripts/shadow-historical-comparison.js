import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { calculateAccountingPeriod } from "../lib/accounting-period-engine.js";

dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function runHistoricalShadowComparison() {
  console.log("\n==================================================");
  console.log("READ-ONLY HISTORICAL SHADOW COMPARISON (JAN - JUL 2026)");
  console.log("==================================================\n");

  const [
    { data: investors },
    { data: accounts },
    { data: deposits },
    { data: withdrawals },
    { data: commissionShares },
    { data: monthlyHistory },
    { data: commissionEarnings },
    { data: monthlyReturns }
  ] = await Promise.all([
    supabase.from("investors").select("*"),
    supabase.from("investor_accounts").select("*"),
    supabase.from("deposits").select("*").not("type", "ilike", "VOID"),
    supabase.from("withdrawals").select("*").in("status", ["Approved", "Completed"]),
    supabase.from("commission_shares").select("*"),
    supabase.from("investor_monthly_history").select("*"),
    supabase.from("commission_earnings").select("*"),
    supabase.from("monthly_returns").select("*")
  ]);

  const monthNames = ["", "January", "February", "March", "April", "May", "June", "July"];
  const year = 2026;

  const monthReports = [];
  const globalMismatches = [];

  for (let m = 1; m <= 7; m++) {
    const periodResult = calculateAccountingPeriod({
      year,
      month: m,
      investors: investors || [],
      accounts: accounts || [],
      deposits: deposits || [],
      withdrawals: withdrawals || [],
      commissionShares: commissionShares || [],
      monthlyHistory: monthlyHistory || [],
      commissionEarnings: commissionEarnings || [],
      monthlyReturns: monthlyReturns || []
    });

    let accountsCompared = 0;
    let exactMatches = 0;
    let centMatches = 0;
    let mismatches = 0;
    let missingData = 0;

    periodResult.investors.forEach(calcInv => {
      accountsCompared++;

      // Find stored historical record
      const storedHist = (monthlyHistory || []).find(
        h => (String(h.investor_id).toLowerCase() === calcInv.investorId.toLowerCase() ||
              String(h.investor_id).toLowerCase() === calcInv.username.toLowerCase()) &&
             h.year === year && h.month_number === m
      );

      if (!storedHist) {
        missingData++;
        return;
      }

      const storedEnd = Number(storedHist.ending_balance || 0);
      const calcEnd = calcInv.endingBalance;
      const diff = Math.abs(calcEnd - storedEnd);

      if (diff === 0) {
        exactMatches++;
      } else if (diff <= 0.02) {
        centMatches++;
      } else {
        mismatches++;

        // Categorize Mismatch Cause
        let category = "UNKNOWN";
        if (storedHist.is_manual || storedHist.ismanual) {
          category = "MANUAL_HISTORY";
        } else if (calcInv.incomingCommissionCredit > 0 && storedHist.opening_balance === storedHist.ending_balance) {
          category = "COMMISSION_LEDGER_TIMING";
        } else if (storedHist.deposits !== calcInv.deposits || storedHist.withdrawals !== calcInv.withdrawals) {
          category = "INPUT_DATA_DIFFERENCE";
        } else {
          category = "CALCULATION_DIFFERENCE";
        }

        globalMismatches.push({
          month: monthNames[m],
          investor: calcInv.name,
          username: calcInv.username,
          calculatedEnding: calcEnd,
          storedEnding: storedEnd,
          difference: (calcEnd - storedEnd).toFixed(2),
          category
        });
      }
    });

    monthReports.push({
      month: monthNames[m],
      accountsCompared,
      exactMatches,
      centMatches,
      mismatches,
      missingData
    });
  }

  console.table(monthReports);

  console.log("\n==================================================");
  console.log("MISMATCH CATEGORIZATION ANALYSIS");
  console.log("==================================================\n");

  const catCounts = {};
  globalMismatches.forEach(m => {
    catCounts[m.category] = (catCounts[m.category] || 0) + 1;
  });

  console.log("Mismatch Breakdown by Category:");
  console.table(catCounts);

  if (globalMismatches.length > 0) {
    console.log(`\nSample Mismatches (showing first 10 of ${globalMismatches.length}):`);
    console.table(globalMismatches.slice(0, 10));
  } else {
    console.log("✨ Perfect alignment! 0 mismatches found across Jan-Jul 2026.");
  }
}

runHistoricalShadowComparison().catch(console.error);
