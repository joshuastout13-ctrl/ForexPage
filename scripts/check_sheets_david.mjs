import { readSheet } from '../lib/sheets.js';
import { CONFIG } from '../lib/config.js';

async function main() {
  console.log('=== CHECKING GOOGLE SHEETS FOR DAVID TOWNLEY ===\n');

  for (const [tabKey, tabName] of Object.entries(CONFIG.tabs)) {
    try {
      const rows = await readSheet(tabName);
      const matched = rows.filter(r => JSON.stringify(r).toLowerCase().includes('townley') || JSON.stringify(r).toLowerCase().includes('dtownley'));
      console.log(`Tab: ${tabName} (${tabKey}): found ${matched.length} rows`);
      if (matched.length > 0) {
        console.log(JSON.stringify(matched, null, 2));
      }
    } catch (e) {
      console.log(`Tab ${tabName} error:`, e.message);
    }
  }
}

main().catch(console.error);
