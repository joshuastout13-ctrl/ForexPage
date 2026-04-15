import { readSheet } from '../lib/sheets.js';
import { CONFIG } from '../lib/config.js';

async function dumpTrue() {
  const rows = await readSheet(CONFIG.tabs.investors);
  const user = rows.find(r => (r.portalusername ?? r.username) === "TRUE");
  console.log(JSON.stringify(user, null, 2));
}
dumpTrue();
