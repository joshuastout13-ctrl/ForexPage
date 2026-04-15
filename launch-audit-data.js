import { readSheet } from './lib/sheets.js';
import { CONFIG } from './lib/config.js';

async function scan() {
  console.log("=== SCANNING FOR SAMPLE/DEMO DATA ===");
  try {
    const investors = await readSheet(CONFIG.tabs.investors);
    const sampleRows = investors.filter(r => {
      const combined = JSON.stringify(r).toLowerCase();
      return combined.includes("sample") || 
             combined.includes("test") || 
             combined.includes("demo") || 
             combined.includes("example");
    });

    if (sampleRows.length > 0) {
      console.log(`FOUND ${sampleRows.length} SAMPLE ROWS:`);
      sampleRows.forEach((r, i) => {
        console.log(`[${i}] ${r.portalusername} (${r.firstname} ${r.lastname}) - Notes: ${r.notes}`);
      });
    } else {
      console.log("No sample data found in Investors tab.");
    }

    const accounts = await readSheet(CONFIG.tabs.investorAccounts);
    const sampleAccounts = accounts.filter(r => {
      const combined = JSON.stringify(r).toLowerCase();
      // Also check if any found sample investor IDs match these accounts
      const isLinkedToSample = sampleRows.some(sr => {
        const sid = String(sr.investorsinvestorid ?? sr.investorid ?? sr.id ?? sr.portalusername ?? "");
        const aid = String(r.investorid ?? r.id ?? "");
        return sid && aid && sid === aid;
      });
      return combined.includes("sample") || combined.includes("test") || combined.includes("demo") || isLinkedToSample;
    });

    if (sampleAccounts.length > 0) {
      console.log(`FOUND ${sampleAccounts.length} SAMPLE ACCOUNTS:`);
      sampleAccounts.forEach((r, i) => {
        console.log(`[${i}] ID: ${r.investorid} - Account: ${r.accountname} - Status: ${r.status}`);
      });
    } else {
      console.log("No sample data found in Investor_Accounts tab.");
    }

  } catch (err) {
    console.error("Scan error:", err.message);
  }
}

scan();
