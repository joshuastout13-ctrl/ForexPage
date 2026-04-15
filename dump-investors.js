import { readSheet } from "./lib/sheets.js";
import { CONFIG } from "./lib/config.js";

async function dumpInvestors() {
  try {
    const investors = await readSheet(CONFIG.tabs.investors);
    console.log(`=== INVESTORS TAB (Total rows: ${investors.length}) ===`);
    investors.forEach((r, i) => {
      console.log(`Row ${i}:`, {
        username: r.portalusername ?? r.username,
        id: r.investorsinvestorid ?? r.investorid ?? r.id,
        name: r.name ?? (r.firstname + " " + r.lastname),
        active: r.active ?? r.Active
      });
    });
  } catch (err) {
    console.error(err);
  }
}

dumpInvestors();
