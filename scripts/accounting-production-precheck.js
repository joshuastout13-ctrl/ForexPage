import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function runProductionPrecheck() {
  console.log("==================================================");
  console.log("READ-ONLY PRODUCTION PRE-MIGRATION CHECK");
  console.log("Target Supabase URL:", new URL(supabaseUrl).hostname);
  console.log("==================================================\n");

  // 1. PROJECT ID CHECK
  const hostname = new URL(supabaseUrl).hostname;
  const isProd = hostname.includes("julhldzkiqdeuuoqmvlo");
  console.log(`1. Production Project Verification: ${isProd ? 'CONFIRMED' : 'NON-PRODUCTION'}`);

  // 2. CHECK FEATURE FLAG STATUS
  const featureFlag = process.env.ACCOUNTING_FINALIZATION_ENABLED === 'true';
  console.log(`2. ACCOUNTING_FINALIZATION_ENABLED Feature Flag: ${featureFlag ? 'ENABLED' : 'DISABLED (SAFE)'}`);

  // 3. READ-ONLY SCHEMA & TABLE CHECKS
  console.log("\n3. Inspecting Existing Production Tables...");
  const [
    { data: investors },
    { data: accounts },
    { data: returns },
    { data: history },
    { data: earnings }
  ] = await Promise.all([
    supabase.from("investors").select("id").limit(5),
    supabase.from("investor_accounts").select("id").limit(5),
    supabase.from("monthly_returns").select("*").eq("year", 2026).eq("month_number", 8),
    supabase.from("investor_monthly_history").select("*").eq("year", 2026).eq("month_number", 8),
    supabase.from("commission_earnings").select("*").eq("year", 2026).eq("month_number", 7)
  ]);

  console.log(`   - Investors Table: Accessible (${investors ? investors.length : 0} sample rows)`);
  console.log(`   - Investor Accounts Table: Accessible (${accounts ? accounts.length : 0} sample rows)`);
  console.log(`   - August 2026 Return Status: ${returns && returns.length > 0 ? `Return ${returns[0].gross_return_pct}%` : 'Not Set'}`);
  console.log(`   - August 2026 History Row Count: ${history ? history.length : 0}`);
  console.log(`   - July 2026 Commission Ledger Count: ${earnings ? earnings.length : 0}`);

  // 4. DUPLICATE LEDGER CHECK
  console.log("\n4. Checking July Commission Ledger for Duplicate Keys...");
  const { data: allJulyEarnings } = await supabase.from("commission_earnings").select("*").eq("year", 2026).eq("month_number", 7);
  const seenKeys = new Set();
  let duplicateCount = 0;

  (allJulyEarnings || []).forEach(e => {
    const key = `${e.year}_${e.month_number}_${e.source_investor_id}_${e.source_account_id || 'DEFAULT'}_${e.recipient_id}`;
    if (seenKeys.has(key)) {
      duplicateCount++;
    } else {
      seenKeys.add(key);
    }
  });

  console.log(`   - Total July Ledger Rows: ${allJulyEarnings ? allJulyEarnings.length : 0}`);
  console.log(`   - Duplicate Ledger Keys: ${duplicateCount}`);

  // 5. MANUAL HISTORY COUNT CHECK
  console.log("\n5. Checking Manual History Rows...");
  const { data: manualRows } = await supabase.from("investor_monthly_history").select("id").eq("is_manual", true);
  console.log(`   - Total Manual History Rows in Database: ${manualRows ? manualRows.length : 0}`);

  console.log("\n==================================================");
  console.log("PRECHECK SUMMARY: 0 WRITES EXECUTED | READY FOR REVIEW");
  console.log("==================================================");
}

runProductionPrecheck().catch(console.error);
