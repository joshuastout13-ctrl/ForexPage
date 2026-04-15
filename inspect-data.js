import { readSheet } from './lib/sheets.js';
import { CONFIG } from './lib/config.js';

async function inspect() {
  console.log("=== INSPECTING DEPOSITS ===");
  const deposits = await readSheet(CONFIG.tabs.deposits);
  if (deposits.length > 0) console.log("Columns:", Object.keys(deposits[0]));

  console.log("\n=== INSPECTING WITHDRAWALS ===");
  const withdrawals = await readSheet(CONFIG.tabs.withdrawals);
  if (withdrawals.length > 0) console.log("Columns:", Object.keys(withdrawals[0]));
}

inspect();
