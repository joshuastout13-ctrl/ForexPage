import { CONFIG } from "../lib/config.js";
import { readSheet } from "../lib/sheets.js";
import { getMyfxbookLive } from "../lib/myfxbook.js";

export default async function handler(req, res) {
  const result = {
    ok: true,
    sheetId: CONFIG.googleSheetId,
    tabs: {},
    myfxbook: { ok: false }
  };

  // 1. Check all required Google Sheet tabs
  try {
    const tabsToCheck = Object.entries(CONFIG.tabs);
    await Promise.all(tabsToCheck.map(async ([key, tabName]) => {
      try {
        const rows = await readSheet(tabName);
        result.tabs[key] = { tabName, rows: rows.length, ok: true };
      } catch (err) {
        result.ok = false;
        result.tabs[key] = { tabName, ok: false, error: err.message };
      }
    }));
  } catch (err) {
    result.ok = false;
    result.error = err.message;
  }

  // 2. Check Myfxbook Scraper
  try {
    const live = await getMyfxbookLive();
    result.myfxbook = { 
      ok: true, 
      source: live.source, 
      data: { today: live.today, week: live.week, month: live.month, year: live.year } 
    };
  } catch (err) {
    // We don't necessarily fail the whole health check if scraper fails (since fallback exists)
    // but we report it.
    result.myfxbook = { ok: false, error: err.message };
  }

  res.status(result.ok ? 200 : 500).json(result);
}
