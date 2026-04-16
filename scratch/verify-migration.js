import { buildInvestorDashboard } from "../lib/dashboard.js";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

async function verify() {
  const testInvestor = "jstout";
  console.log(`--- Starting Migration Verification for: ${testInvestor} ---`);
  
  process.env.DATA_SOURCE = "supabase";
  console.log("Fetching from Supabase...");
  const supabaseData = await buildInvestorDashboard(testInvestor);

  process.env.DATA_SOURCE = "sheets";
  console.log("Fetching from Google Sheets...");
  const sheetsData = await buildInvestorDashboard(testInvestor);

  console.log("\nResults Comparison:");
  console.log(`- Starting Capital: Supabase=$${supabaseData.summary.startingCapital}, Sheets=$${sheetsData.summary.startingCapital}`);
  console.log(`- Current Balance: Supabase=$${supabaseData.summary.currentBalance.toFixed(2)}, Sheets=$${sheetsData.summary.currentBalance.toFixed(2)}`);
  console.log(`- Total Gain: Supabase=$${supabaseData.summary.totalGain.toFixed(2)}, Sheets=$${sheetsData.summary.totalGain.toFixed(2)}`);
  
  const balanceMatch = Math.abs(supabaseData.summary.currentBalance - sheetsData.summary.currentBalance) < 0.01;
  const gainMatch = Math.abs(supabaseData.summary.totalGain - sheetsData.summary.totalGain) < 0.01;

  if (balanceMatch && gainMatch) {
    console.log("\n✅ SUCCESS: Supabase data matches Google Sheets exactly.");
  } else {
    console.error("\n❌ DISCREPANCY FOUND: Data does not match between backends.");
  }
}

verify().catch(console.error);
