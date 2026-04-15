import { CONFIG } from "./config.js";
import { readSheet, numberValue } from "./sheets.js";

function stripHtml(html) {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function pctString(raw) {
  const s = stripHtml(String(raw || "")).trim();
  if (!s || s === "N/A") return "N/A";
  const m = s.match(/-?[\d.]+/);
  if (!m) return s;
  const n = Number(m[0]);
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

export async function fetchLiveStats() {
  try {
    const rows = await readSheet(CONFIG.tabs.livePerformance);
    const byKey = {};
    for (const row of rows) {
      const stat = String(row.stat || row.Stat || "").trim().toLowerCase().replace(/\s+/g, "");
      const value = String(row.value || row.Value || "").trim();
      if (stat) byKey[stat] = value;
    }

    return {
      gain: pctString(byKey.gain),
      absGain: byKey.absgain || byKey.absolutegain || byKey.absgain || "N/A",
      daily: pctString(byKey.daily),
      monthly: pctString(byKey.monthly),
      today: pctString(byKey.today),
      week: pctString(byKey.week || byKey.thisweek),
      month: pctString(byKey.month || byKey.thismonth),
      year: pctString(byKey.year || byKey.thisyear || byKey.ytd),
      fetchedAt: Date.now()
    };
  } catch {
    return {
      gain: "N/A",
      absGain: "N/A",
      daily: "N/A",
      monthly: "N/A",
      today: "N/A",
      week: "N/A",
      month: "N/A",
      year: "N/A",
      fetchedAt: Date.now()
    };
  }
}

export function parseLivePct(s) {
  const m = String(s || "").match(/-?[\d.]+/);
  return m ? Number(m[0]) : 0;
}
