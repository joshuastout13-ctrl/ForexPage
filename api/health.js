import { CONFIG } from "../lib/config.js";
import { readSheet } from "../lib/sheets.js";
import { getMyfxbookLive } from "../lib/myfxbook.js";

import { CONFIG } from "../lib/config.js";
import { readSheet } from "../lib/sheets.js";
import { supabase } from "../lib/supabase.js";
import { getMyfxbookLive } from "../lib/myfxbook.js";

export default async function handler(req, res) {
  const dataSource = process.env.DATA_SOURCE || "sheets";
  const result = {
    ok: true,
    dataSource,
    checks: {
      data: { ok: false },
      myfxbook: { ok: false }
    }
  };

  // 1. Check Data Source
  if (dataSource === "supabase") {
    try {
      if (!supabase) throw new Error("Supabase client not initialized (missing env vars)");
      const { data, error } = await supabase.from("investors").select("id").limit(1);
      if (error) throw error;
      result.checks.data = { ok: true, source: "Supabase" };
    } catch (err) {
      result.ok = false;
      result.checks.data = { ok: false, source: "Supabase", error: err.message };
    }
  } else {
    try {
      // Just check the main Investors tab for Sheets fallback
      const rows = await readSheet(CONFIG.tabs.investors);
      result.checks.data = { ok: true, source: "Google Sheets", rows: rows.length };
    } catch (err) {
      result.ok = false;
      result.checks.data = { ok: false, source: "Google Sheets", error: err.message };
    }
  }

  // 2. Check Myfxbook
  try {
    const live = await getMyfxbookLive();
    result.checks.myfxbook = { 
      ok: true, 
      source: live.source, 
      data: { today: live.today, week: live.week, month: live.month, year: live.year } 
    };
  } catch (err) {
    result.checks.myfxbook = { ok: false, error: err.message };
  }

  res.status(result.ok ? 200 : 500).json(result);
}
