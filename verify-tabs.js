import { readSheet } from './lib/sheets.js';
import { CONFIG } from './lib/config.js';

async function checkAllTabs() {
  const tabs = [
    'investors',
    'investorAccounts',
    'deposits',
    'withdrawals',
    'monthlyReturns',
    'livePerformance'
  ];

  console.log("=== CHECKING GOOGLE SHEET TABS ===");
  for (const key of tabs) {
    const tabName = CONFIG.tabs[key];
    try {
      const rows = await readSheet(tabName);
      console.log(`[PASS] Tab "${tabName}" read successfully: ${rows.length} rows.`);
    } catch (err) {
      console.log(`[FAIL] Tab "${tabName}" error: ${err.message}`);
    }
  }
}

checkAllTabs();
