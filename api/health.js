import { CONFIG } from "../lib/config.js";
import { readSheet } from "../lib/sheets.js";
import { getMyfxbookLive } from "../lib/myfxbook.js";

export default async function handler(req, res) {
  const result = {
    ok: true,
    sheetId: CONFIG.googleSheetId,
    tabs: {},
    myfxbook: null
  };

  try {
    for (const [name, tab] of Object.entries(CONFIG.tabs)) {
      const rows = await readSheet(tab);
      result.tabs[name] = { tab, rows: rows.length, ok: true };
    }
  } catch (error) {
    result.ok = false;
    result.tabs.error = error.message;
  }

  try {
    result.myfxbook = await getMyfxbookLive();
  } catch (error) {
    result.ok = false;
    result.myfxbook = { error: error.message };
  }

  res.status(result.ok ? 200 : 500).json(result);
}
