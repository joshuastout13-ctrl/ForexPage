import { CONFIG } from "../lib/config.js";
import { readSheet } from "../lib/sheets.js";

export default async function handler(req, res) {
  const result = {
    ok: true,
    sheetId: CONFIG.googleSheetId,
    tabs: {}
  };

  try {
    for (const [name, tab] of Object.entries(CONFIG.tabs)) {
      try {
        const rows = await readSheet(tab);
        result.tabs[name] = { tab, rows: rows.length, ok: true };
      } catch (err) {
        result.ok = false;
        result.tabs[name] = { tab, ok: false, error: err.message };
      }
    }
  } catch (err) {
    result.ok = false;
    result.error = err.message;
  }

  res.status(result.ok ? 200 : 500).json(result);
}
