import { readSheet } from "../lib/sheets.js";
import { CONFIG } from "../lib/config.js";
import fs from "fs";
import path from "path";

async function backup() {
  const tabs = [
    "Investors",
    "Investor_Accounts",
    "Deposits", 
    "Withdrawals",
    "Monthly_Returns",
    "Live_Performance",
    "Investor_Monthly_Snapshots"
  ];

  const backupDir = path.join(process.cwd(), "scratch", "backup_" + Date.now());
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

  console.log("Starting Backup to:", backupDir);

  for (const tab of tabs) {
    console.log(`Fetching tab: ${tab}...`);
    try {
      const data = await readSheet(tab);
      const filePath = path.join(backupDir, `${tab}.json`);
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
      console.log(`  - Saved ${data.length} rows to ${tab}.json`);
      
      if (data.length > 0) {
        console.log(`  - Headers sample:`, Object.keys(data[0]).filter(k => !k.match(/^[a-z0-9]+$/)));
      }
    } catch (err) {
      console.error(`  - Failed to fetch ${tab}:`, err.message);
    }
  }

  console.log("\nBackup complete.");
}

backup().catch(console.error);
