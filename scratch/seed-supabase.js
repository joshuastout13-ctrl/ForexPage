import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing Supabase credentials in .env.local");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const BACKUP_DIR = "scratch/backup_1776373578275";

function num(v) {
  if (v == null || v === "") return 0;
  const n = parseFloat(String(v).replace(/[$,%,\s]/g, ""));
  return isNaN(n) ? 0 : n;
}

function bool(v) {
  const s = String(v ?? "").trim().toLowerCase();
  return !["", "0", "false", "no", "inactive", "n"].includes(s);
}

function cleanId(id, fallback) {
  const s = String(id ?? "").trim().toLowerCase();
  const f = String(fallback ?? "").trim().toLowerCase();
  return s || f;
}

async function seed() {
  console.log("--- Starting Fresh Migration Seeding ---");

  // Helper to clear table safely
  const clearTable = async (table) => {
    console.log(`Clearing table: ${table}...`);
    const { error } = await supabase.from(table).delete().neq("id", "placeholder_to_force_unconditional_delete");
    if (error && error.code !== "PGRST116") { // Ignore if table empty or strange error
        // For tables without 'id' column (like monthly_returns), we use a different criteria
        if (table === "monthly_returns") {
            await supabase.from(table).delete().neq("year", 0);
        } else if (table === "live_performance") {
            await supabase.from(table).delete().neq("metric", "");
        } else {
            console.error(`  - Partial failure clearing ${table}:`, error.message);
        }
    }
  };

  // Clear in order of dependencies (Children first)
  await clearTable("snapshots");
  await clearTable("withdrawals");
  await clearTable("deposits");
  await clearTable("investor_accounts");
  await clearTable("investors");
  await clearTable("monthly_returns");
  await clearTable("live_performance");

  console.log("\nTables cleared. Importing fresh data...\n");

  // 1. Investors
  const investorsData = JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, "Investors.json")));
  const investors = investorsData.map((r, i) => ({
    id: cleanId(r["Investors Investor ID"] || r.id, r["Portal Username"] || `INV_${i}`),
    first_name: r["First Name"],
    last_name: r["Last Name"],
    email: r["Email"],
    portal_username: r["Portal Username"],
    temp_password: r["Temp Password (prototype only)"],
    active: bool(r["Active"]),
    split_pct: num(r["Investor Split %"] || 100),
    monthly_draw: num(r["Recurring Monthly Draw ($)"]),
    start_date: r["Start Date"] || null,
    role: r["Role"] || "investor",
    notes: r["Notes"]
  }));
  console.log(`Investors: Inserting ${investors.length} rows...`);
  const { error: err1 } = await supabase.from("investors").insert(investors);
  if (err1) throw new Error("Investors insert failed: " + err1.message);

  // 2. Accounts
  const accountsData = JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, "Investor_Accounts.json")));
  const accounts = accountsData.map((r, i) => ({
    id: cleanId(r["Investor Accounts Account ID"] || r.id, r["Investor ID"] || `ACC_${i}`),
    investor_id: cleanId(r["Investor ID"]),
    name: r["Account Name"],
    starting_capital: num(r["Starting Capital ($)"]),
    open_date: r["Open Date"] || null,
    status: r["Status"] || "Active",
    notes: r["Notes"]
  }));
  console.log(`Accounts: Inserting ${accounts.length} rows...`);
  const { error: err2 } = await supabase.from("investor_accounts").insert(accounts);
  if (err2) throw new Error("Accounts insert failed: " + err2.message);

  // 3. Deposits
  const depositsData = JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, "Deposits.json")));
  const deposits = depositsData.map((r, i) => ({
    id: cleanId(r["Deposits Deposit ID"] || r.id, `DEP_${r["Investor ID"]}_${i}`),
    investor_id: cleanId(r["Investor ID"]),
    account_id: cleanId(r["Account ID"], r["Investor ID"]),
    date: r["Date"] || null,
    amount: num(r["Amount ($)"]),
    type: r["Type"] || "Deposit",
    notes: r["Notes"]
  }));
  console.log(`Deposits: Inserting ${deposits.length} rows...`);
  const { error: err3 } = await supabase.from("deposits").insert(deposits);
  if (err3) console.error("Deposits warning:", err3.message);

  // 4. Withdrawals
  const wdsData = JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, "Withdrawals.json")));
  const withdrawals = wdsData.map((r, i) => ({
    id: cleanId(r["Withdrawals Withdrawal ID"] || r.id, `WD_${r["Investor ID"]}_${i}`),
    investor_id: cleanId(r["Investor ID"]),
    account_id: cleanId(r["Account ID"], r["Investor ID"]),
    request_date: r["Request Date"] || null,
    year: parseInt(r["Effective Year"]) || null,
    month_number: parseInt(r["Effective Month Number"]) || null,
    month: r["Effective Month"],
    amount: num(r["Amount ($)"]),
    status: r["Status"] || "Completed",
    notes: r["Notes"]
  }));
  console.log(`Withdrawals: Inserting ${withdrawals.length} rows...`);
  const { error: err4 } = await supabase.from("withdrawals").insert(withdrawals);
  if (err4) console.error("Withdrawals warning:", err4.message);

  // 5. Monthly Returns
  const returnsData = JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, "Monthly_Returns.json")));
  const returns = returnsData.map(r => ({
    year: parseInt(r["Monthly Returns (gross fund returns before investor split) Year"] || r.year),
    month_number: parseInt(r["Month Number"] || r.month_number),
    month: r["Month"],
    gross_return_pct: num(r["Gross Return %"]),
    source: r["Source"],
    notes: r["Notes"],
    locked: bool(r["Locked"]),
    last_updated: r["Last Updated"]
  }));
  console.log(`Monthly Returns: Inserting ${returns.length} rows...`);
  const { error: err5 } = await supabase.from("monthly_returns").insert(returns);
  if (err5) console.error("Returns warning:", err5.message);

  // 6. Live Performance
  const liveData = JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, "Live_Performance.json")));
  const live = liveData.map(r => ({
    metric: r["Live Performance (Myfxbook feed or manual fallback) Metric"] || r.metric,
    value_pct: r["Value %"],
    source: r["Source"],
    last_updated: r["Last Updated"],
    is_override: bool(r["Override?"]),
    notes: r["Notes"]
  }));
  console.log(`Live Performance: Inserting ${live.length} rows...`);
  const { error: err6 } = await supabase.from("live_performance").insert(live);
  if (err6) console.error("Live Performance warning:", err6.message);

  // 7. Snapshots
  const snapshotsData = JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, "Investor_Monthly_Snapshots.json")));
  const snapshots = snapshotsData.map((r, i) => ({
    id: cleanId(r["Investor Monthly Snapshots Snapshot ID"] || r.id, `SNAP_${r["Investor ID"]}_${i}`),
    investor_id: cleanId(r["Investor ID"]),
    account_id: cleanId(r["Account ID"], r["Investor ID"]),
    year: parseInt(r["Year"]),
    month_number: parseInt(r["Month Number"]),
    month: r["Month"],
    opening_balance: num(r["Opening Balance ($)"]),
    deposit_amount: num(r["Deposit Amount ($)"]),
    gross_return_pct: num(r["Gross Return %"]),
    split_pct: num(r["Investor Split %"]),
    effective_return_pct: num(r["Effective Return %"]),
    gain_amount: num(r["Gain Amount ($)"]),
    monthly_draw: num(r["Recurring Draw ($)"]),
    withdrawal_amount: num(r["One-Time Withdrawal ($)"]),
    ending_balance: num(r["Ending Balance ($)"]),
    notes: r["Notes"]
  }));
  console.log(`Snapshots: Inserting ${snapshots.length} rows...`);
  const { error: err7 } = await supabase.from("snapshots").insert(snapshots);
  if (err7) console.error("Snapshots warning:", err7.message);

  console.log("\n--- Seeding Complete! DATA IS NOW LIVE IN SUPABASE ---");
}

seed().catch(console.error);
