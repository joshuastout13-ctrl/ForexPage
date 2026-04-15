import { CONFIG } from "./config.js";

const TIMEOUT_MS = 12_000;

function stripHtml(html) {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function extractText(html, pattern) {
  const m = html.match(pattern);
  return m ? stripHtml(m[1]).trim() : null;
}

function fmtPct(raw) {
  if (raw == null) return "0.00%";
  const s = String(raw).trim();
  return s.includes("%") ? s : `${s}%`;
}

/**
 * Fetches live performance stats from the public Myfxbook account page.
 * Returns { today, week, month, year, gain, absGain, daily, monthly, fetchedAt }.
 */
export async function getMyfxbookLive() {
  const result = {
    today: "0.00%",
    week: "0.00%",
    month: "0.00%",
    year: "0.00%",
    gain: "0.00%",
    absGain: "0.00%",
    daily: "0.00%",
    monthly: "0.00%",
    fetchedAt: new Date().toISOString()
  };

  const res = await fetch(CONFIG.myfxbookUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9"
    },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });

  if (!res.ok) {
    throw new Error(`Myfxbook HTTP ${res.status}`);
  }

  const html = await res.text();

  const tryExtract = (key, patterns) => {
    for (const re of patterns) {
      const val = extractText(html, re);
      if (val) {
        result[key] = fmtPct(val);
        return;
      }
    }
  };

  tryExtract("gain", [
    /id="contentGain"[^>]*>([\s\S]*?)<\//i,
    /"gain"\s*:\s*"([+-]?[\d.]+)"/i,
    /Gain[^<]{0,30}<[^>]+>([\s\S]*?)<\//i
  ]);

  tryExtract("absGain", [
    /id="contentAbsGain"[^>]*>([\s\S]*?)<\//i,
    /"absGain"\s*:\s*"([+-]?[\d.]+)"/i
  ]);

  tryExtract("daily", [
    /id="contentDaily"[^>]*>([\s\S]*?)<\//i,
    /"daily"\s*:\s*"([+-]?[\d.]+)"/i
  ]);

  tryExtract("monthly", [
    /id="contentMonthly"[^>]*>([\s\S]*?)<\//i,
    /"monthly"\s*:\s*"([+-]?[\d.]+)"/i
  ]);

  tryExtract("today", [
    /[Tt]oday[^<]{0,60}<[^>]+>([\s\S]*?)<\//,
    /"today"\s*:\s*"([+-]?[\d.]+)"/i
  ]);

  tryExtract("week", [
    /[Tt]his\s+[Ww]eek[^<]{0,60}<[^>]+>([\s\S]*?)<\//,
    /[Ww]eek[^<]{0,60}<[^>]+>([\s\S]*?)<\//,
    /"week"\s*:\s*"([+-]?[\d.]+)"/i
  ]);

  tryExtract("month", [
    /[Tt]his\s+[Mm]onth[^<]{0,60}<[^>]+>([\s\S]*?)<\//,
    /[Mm]onth[^<]{0,60}<[^>]+>([\s\S]*?)<\//,
    /"month"\s*:\s*"([+-]?[\d.]+)"/i
  ]);

  tryExtract("year", [
    /[Tt]his\s+[Yy]ear[^<]{0,60}<[^>]+>([\s\S]*?)<\//,
    /[Yy]ear[^<]{0,60}<[^>]+>([\s\S]*?)<\//,
    /"year"\s*:\s*"([+-]?[\d.]+)"/i
  ]);

  return result;
}

/** @deprecated Use getMyfxbookLive instead */
export const fetchMyfxbookHeadlines = getMyfxbookLive;
