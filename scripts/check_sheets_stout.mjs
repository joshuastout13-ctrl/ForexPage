import { readSheet } from '../lib/sheets.js';
import { CONFIG } from '../lib/config.js';

async function run() {
  console.log('=== CHECKING GOOGLE SHEETS FOR STOUT001 ===');
  console.log('Google Sheet ID:', CONFIG.googleSheetId);

  try {
    const wds = await readSheet(CONFIG.tabs.withdrawals);
    const stoutWds = wds.filter(r => JSON.stringify(r).toLowerCase().includes('stout'));
    console.log('\nGoogle Sheets Withdrawals for stout:', JSON.stringify(stoutWds, null, 2));
  } catch (err) {
    console.log('Error reading withdrawals from Sheets:', err.message);
  }

  try {
    const deps = await readSheet(CONFIG.tabs.deposits);
    const stoutDeps = deps.filter(r => JSON.stringify(r).toLowerCase().includes('stout'));
    console.log('\nGoogle Sheets Deposits for stout:', JSON.stringify(stoutDeps, null, 2));
  } catch (err) {
    console.log('Error reading deposits from Sheets:', err.message);
  }

  try {
    const accs = await readSheet(CONFIG.tabs.investorAccounts);
    const stoutAccs = accs.filter(r => JSON.stringify(r).toLowerCase().includes('stout'));
    console.log('\nGoogle Sheets Accounts for stout:', JSON.stringify(stoutAccs, null, 2));
  } catch (err) {
    console.log('Error reading accounts from Sheets:', err.message);
  }
}

run().catch(console.error);
