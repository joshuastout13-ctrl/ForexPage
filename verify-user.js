import { readSheet } from './lib/sheets.js';
import { CONFIG } from './lib/config.js';

async function run() {
  try {
    const rows = await readSheet(CONFIG.tabs.investors);
    const active = rows.filter(r => (r.active ?? r.Active) === 'TRUE' || (r.active ?? r.Active) === '1');
    if (active.length === 0) {
      console.log("No active investors found.");
      return;
    }
    const testUser = active[0];
    console.log("TEST_USER_FOUND:");
    console.log(JSON.stringify({
      username: testUser.portalusername ?? testUser.username,
      password: testUser.temppassword ?? testUser.password ?? testUser.temppasswordprototypeonly,
      id: testUser.investorid ?? testUser.id ?? testUser.investorsinvestorid,
      name: testUser.firstname + " " + testUser.lastname,
      active: testUser.active
    }, null, 2));
  } catch (err) {
    console.error("Error fetching investors:", err.message);
  }
}

run();
