import { readSheet, filterInvestors } from "./lib/sheets.js";
import { CONFIG } from "./lib/config.js";

async function verifyFiltering() {
  try {
    const rawInvestors = await readSheet(CONFIG.tabs.investors);
    const filteredInvestors = filterInvestors(rawInvestors);

    console.log("=== RAW INVESTORS ===");
    rawInvestors.forEach(r => console.log(`- ${r.portalusername ?? r.username} (${r.investorsinvestorid ?? r.investorid ?? r.id})`));

    console.log("\n=== FILTERED INVESTORS ===");
    filteredInvestors.forEach(r => console.log(`- ${r.portalusername ?? r.username} (${r.investorsinvestorid ?? r.investorid ?? r.id})`));

    const testUser = filteredInvestors.find(r => (r.portalusername ?? r.username) === "jstout");
    if (testUser) {
      console.log("\n✅ Success: 'TRUE' (Stout001) is preserved for testing.");
    } else {
      console.log("\n❌ Error: 'TRUE' (Stout001) was filtered out.");
    }

    const adminUser = filteredInvestors.find(r => (r.portalusername ?? r.username) === "admin");
    const sampleUser = filteredInvestors.find(r => (r.portalusername ?? r.username) === "sample.investor");
    
    if (!adminUser && !sampleUser) {
      console.log("✅ Success: 'admin' and 'sample.investor' were correctly filtered out.");
    } else {
      console.log("❌ Error: 'admin' or 'sample.investor' are still present.");
    }

  } catch (err) {
    console.error("Verification failed:", err);
  }
}

verifyFiltering();
