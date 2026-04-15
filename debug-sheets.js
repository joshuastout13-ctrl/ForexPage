import { CONFIG } from "./lib/config.js";
import { readSheet } from "./lib/sheets.js";

async function debug() {
  const tabs = ["Investors", "Investor_Accounts", "Deposits", "Withdrawals", "Monthly_Returns", "Live_Performance"];
  for (const tab of tabs) {
    try {
      const url = `https://docs.google.com/spreadsheets/d/${CONFIG.googleSheetId}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(tab)}`;
      const res = await fetch(url);
      const text = await res.text();
      console.log(`--- TAB: ${tab} ---`);
      console.log(text.substring(0, 100)); // Show beginning of response
      const match = text.match(/google\.visualization\.Query\.setResponse\(([\s\S]*?)\);/);
      if (!match) {
        console.log("NO MATCH");
      } else {
        try {
          JSON.parse(match[1]);
          console.log("JSON OK");
        } catch (e) {
          console.log("JSON FAIL:", e.message);
          console.log("Snippet:", match[1].substring(0, 100));
        }
      }
    } catch (err) {
      console.log(`ERROR for ${tab}:`, err.message);
    }
  }
}

debug();
