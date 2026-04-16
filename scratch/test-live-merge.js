import { getMyfxbookLive } from "../lib/myfxbook.js";

async function test() {
  console.log("Fetching live data (Merged Sheets + API)...");
  try {
    const data = await getMyfxbookLive();
    console.log("\nFinal Merged Metrics:");
    console.log("- Today:", data.today);
    console.log("- Week:", data.week);
    console.log("- Month:", data.month);
    console.log("- Year:", data.year);
    console.log("- Total Gain:", data.gain);
    console.log("- Drawdown:", data.drawdown);
    console.log("- Source:", data.source);
    console.log("- Fetched At:", data.fetchedAt);
    
    if (data.today === data.gain && data.gain !== "0.00%") {
      console.warn("\nWARNING: Today metric matches total gain! This is what the user wants to avoid.");
    } else {
      console.log("\nSUCCESS: Today's metric is no longer pointing to the total gain by default.");
    }
  } catch (err) {
    console.error("Test failed:", err);
  }
}

test();
