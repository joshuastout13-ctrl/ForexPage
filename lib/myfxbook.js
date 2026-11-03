import { CONFIG } from "./config.js";
import { readSheet, num } from "./sheets.js";

/**
 * Cached Myfxbook API session token.
 * Sessions last 1 month and are IP-bound.
 * We refresh every 24h to be safe.
 */
let cachedSession = null;
let sessionExpiry = 0;

const MYFXBOOK_API = "https://www.myfxbook.com/api";

/**
 * Logs into the Myfxbook API and returns a session token.
 */
async function myfxbookLogin() {
  const { myfxbookEmail, myfxbookPassword } = CONFIG;

  if (!myfxbookEmail || !myfxbookPassword) {
    throw new Error("MYFXBOOK_EMAIL and MYFXBOOK_PASSWORD env vars are required");
  }

  // Reuse cached session if still valid
  if (cachedSession && Date.now() < sessionExpiry) {
    return cachedSession;
  }

  const url = `${MYFXBOOK_API}/login.json?email=${encodeURIComponent(myfxbookEmail)}&password=${encodeURIComponent(myfxbookPassword)}`;
  const res = await fetch(url);
  const data = await res.json();

  if (data.error) {
    throw new Error(`Myfxbook login failed: ${data.message}`);
  }

  // The API returns the session already URL-encoded; store it as-is for direct use in URLs
  cachedSession = data.session;
  // Cache for 24 hours (sessions last 1 month, but we refresh daily)
  sessionExpiry = Date.now() + 24 * 60 * 60 * 1000;

  console.log("[Myfxbook API] Login successful, session cached");
  return cachedSession;
}

/**
 * Fetches ForEx Investment Tracker data from Myfxbook's watched accounts.
 * The account must be in the user's watchlist on Myfxbook.
 *
 * API returns: { id, name, gain, drawdown, demo, change }
 */
async function fetchWatchedAccount(session) {
  const url = `${MYFXBOOK_API}/get-watched-accounts.json?session=${session}`;
  const res = await fetch(url);
  const data = await res.json();

  if (data.error) {
    // Session might be expired, clear cache
    cachedSession = null;
    sessionExpiry = 0;
    throw new Error(`Myfxbook get-watched-accounts failed: ${data.message}`);
  }

  const accounts = data.accounts || [];
  if (accounts.length === 0) {
    throw new Error("No watched accounts found. Please add the fund account to your Myfxbook watchlist.");
  }

  // Find the fund by name or configured account ID
  const targetId = CONFIG.myfxbookAccountId;
  let account;

  if (targetId) {
    account = accounts.find((a) => String(a.id) === String(targetId));
  }

  if (!account) {
    // Try matching by name
    account = accounts.find((a) =>
      (a.name || "").toLowerCase().includes("stone")
    );
  }

  // Fallback to first watched account
  if (!account) {
    account = accounts[0];
  }

  return account;
}

/**
 * Fetches live performance metrics from Myfxbook API (watched accounts).
 * Falls back to Google Sheets' "Live_Performance" tab if API fails.
 *
 * The watched-accounts API provides: gain (total %), drawdown (%), change.
 * We map these to the format the dashboard expects.
 */
export async function getMyfxbookLive({ previewMode = false, skipScraper = false } = {}) {
  const result = {
    today: "0.00%",
    week: "0.00%",
    month: "0.00%",
    year: "0.00%",
    gain: "0.00%",
    absGain: "0.00%",
    daily: "0.00%",
    monthly: "0.00%",
    drawdown: "0.00%",
    fetchedAt: new Date().toISOString(),
    source: "Hybrid (Sheets + API)",
    isLiveScraped: false,
    scrapeErrors: []
  };

  // 1. Fetch Performance Overrides (Source of Truth for Today, Week, Month, Year)
  const useSupabase = process.env.DATA_SOURCE === "supabase";
  const sourceName = useSupabase ? "Supabase" : "Google Sheets";

  try {
    let sourceData = [];
    if (useSupabase) {
      const { readSupabaseTable } = await import("./supabase.js");
      sourceData = await readSupabaseTable("live_performance");
    } else {
      sourceData = await readSheet(CONFIG.tabs.livePerformance);
    }

    const fmt = (v) => {
      const n = parseFloat(String(v).replace(/[%\s]/g, ""));
      if (isNaN(n)) return "0.00%";
      return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
    };

    sourceData.forEach((row) => {
      // Normalize metric name (e.g. "This Week" -> "thisweek")
      const metric = String(
        row.metric ||
        row.Metric ||
        row.liveperformancemyfxbookfeedormanualfallbackmetric ||
        row["Live Performance (Myfxbook feed or manual fallback) Metric"] ||
        ""
      ).toLowerCase().replace(/[^a-z0-9]/g, "");

      const val = fmt(
        row.value !== undefined ? row.value :
        row.Value !== undefined ? row.Value :
        row.valuepct !== undefined ? row.valuepct :
        row.value_pct !== undefined ? row.value_pct :
        row["Value %"] !== undefined ? row["Value %"] :
        "0.00%"
      );
      
      if (metric === "today") result.today = val;
      if (metric === "thisweek" || metric === "week") result.week = val;
      if (metric === "thismonth" || metric === "month") result.month = val;
      if (metric === "thisyear" || metric === "year") result.year = val;
      if (metric === "gain") result.gain = val;
    });
    console.log(`[Myfxbook] Initialized metrics from ${sourceName}: today=${result.today}, week=${result.week}, month=${result.month}, year=${result.year}`);
  } catch (err) {
    console.error(`[Myfxbook] ${sourceName} performance fetch failed:`, err.message);
  }

  // 2. Fetch Myfxbook API Data (Best source for real-time total Gain and Drawdown)
  if (CONFIG.myfxbookEmail && CONFIG.myfxbookPassword) {
    try {
      const session = await myfxbookLogin();
      const account = await fetchWatchedAccount(session);

      const fmtPct = (v) => {
        const n = parseFloat(v);
        if (isNaN(n)) return "0.00%";
        return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
      };

      // Real-time Gain and Drawdown from API
      result.gain = fmtPct(account.gain);
      result.absGain = fmtPct(account.gain);
      result.drawdown = `${parseFloat(account.drawdown || 0).toFixed(2)}%`;
      result.accountName = account.name || "N/A";

      // Do NOT reuse account.gain for result.year (period metrics must remain strictly isolated).

      // We explicitly DO NOT use account.change as daily gain here, 
      // as the Myfxbook "watched accounts" API often returns the total gain in the change field.
      // The daily/weekly/monthly metrics should come from the Google Sheet for accuracy.

      console.log(`[Myfxbook API] Real-time total gain merged: ${result.gain}`);
    } catch (err) {
      console.error("[Myfxbook API] Error fetching real-time gain:", err.message);
      result.source = "Google Sheets (Final Fallback)";
    }
  }
  
  // 3. Scrape.do Metrics (High-fidelity data for Today, Week, Month, Year)
  if (CONFIG.scrapedotdoToken && !skipScraper) {
    try {
      const scraperData = await fetchScrapeDoMetrics();
      
      const updateIfValid = (key, val) => {
        if (val !== null && val !== undefined && val !== "" && val !== "N/A" && val !== "NOT FOUND") {
          result[key] = val;
        }
      };

      updateIfValid("today", scraperData.today);
      updateIfValid("week", scraperData.week);
      updateIfValid("month", scraperData.month);
      updateIfValid("year", scraperData.year);

      result.source = "Myfxbook (Scrape.do)";
      result.isLiveScraped = true;
      
      // PERSIST TO DATABASE (skip in preview mode)
      if (!previewMode) {
        const { updateLivePerformance, syncOpenMonthlyReturn } = await import("./supabase.js");
        await updateLivePerformance(scraperData);
        if (scraperData.month) {
          await syncOpenMonthlyReturn(scraperData.month);
        }
        console.log("[Myfxbook] Real-time periodic metrics merged and synced to Supabase via Scrape.do");
      } else {
        console.log("[Myfxbook] Preview mode — skipping Supabase write");
      }
    } catch (err) {
      console.error("[Myfxbook] Scrape.do scraper failed:", err.message);
      result.scrapeErrors.push(`Scrape.do: ${err.message}`);
    }
  } 
  
  if (CONFIG.zenrowsApiKey && (!CONFIG.scrapedotdoToken || result.source !== "Myfxbook (Scrape.do)") && !skipScraper) {
    // Fallback to ZenRows if configured
    try {
      const zenrowsData = await fetchZenRowsMetrics();
      const updateIfValid = (key, val) => {
        if (val !== null && val !== undefined && val !== "" && val !== "N/A" && val !== "NOT FOUND") {
          result[key] = val;
        }
      };

      updateIfValid("today", zenrowsData.today);
      updateIfValid("week", zenrowsData.week);
      updateIfValid("month", zenrowsData.month);
      updateIfValid("year", zenrowsData.year);

      result.source = "Myfxbook (ZenRows)";
      result.isLiveScraped = true;

      // PERSIST TO DATABASE (skip in preview mode)
      if (!previewMode) {
        const { updateLivePerformance, syncOpenMonthlyReturn } = await import("./supabase.js");
        await updateLivePerformance(zenrowsData);
        if (zenrowsData.month) {
          await syncOpenMonthlyReturn(zenrowsData.month);
        }
        console.log("[Myfxbook] Real-time periodic metrics merged and synced to Supabase via ZenRows");
      } else {
        console.log("[Myfxbook] Preview mode — skipping Supabase write");
      }
    } catch (err) {
      console.error("[Myfxbook] ZenRows fallback failed:", err.message);
      result.scrapeErrors.push(`ZenRows: ${err.message}`);
    }
  }

  return result;
}

/**
 * Extracts a single periodic metric ("Today", "This Week", "This Month", "This Year")
 * from Myfxbook HTML strictly within its own table row/cell.
 * Never tunnels across </tr> or subsequent <td> cells when Myfxbook renders "-" on rollover.
 */
export function extractMyfxbookPeriodMetric(html, label) {
  if (!html || !label) return null;
  const escapedLabel = String(label).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const cellRegex = new RegExp(
    `<td[^>]*>\\s*${escapedLabel}\\s*<\\/td>(?:(?!<\\/tr>|<td\\b)[\\s\\S])*?<td[^>]*>((?:(?!<\\/td>|<\\/tr>)[\\s\\S])*?)<\\/td>`,
    "i"
  );
  const cellMatch = html.match(cellRegex);
  if (!cellMatch) return null;

  const cellHtml = cellMatch[1];
  const pctMatch =
    cellHtml.match(/<span[^>]*>\s*([+-]?[0-9]*\.?[0-9]+)\s*%/i) ||
    cellHtml.match(/([+-]?[0-9]+\.?[0-9]*)\s*%/);
  if (pctMatch) {
    const n = parseFloat(pctMatch[1]);
    return isNaN(n) ? null : `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
  }

  const strippedText = cellHtml.replace(/<[^>]+>/g, "").trim();
  if (/^[-—–]+$/.test(strippedText)) {
    return "+0.00%";
  }

  return null;
}

/**
 * Scrapes detailed periodic metrics from the Myfxbook public page using Scrape.do.
 */
async function fetchScrapeDoMetrics() {
  const params = new URLSearchParams({
    token: CONFIG.scrapedotdoToken,
    url: CONFIG.myfxbookUrl,
    super: "true",
    render: "true"
  });

  const url = `https://api.scrape.do?${params.toString()}`;
  const res = await fetch(url);
  
  if (!res.ok) {
    throw new Error(`Scrape.do API error: ${res.status}`);
  }

  const html = await res.text();

  return {
    today: extractMyfxbookPeriodMetric(html, "Today"),
    week: extractMyfxbookPeriodMetric(html, "This Week"),
    month: extractMyfxbookPeriodMetric(html, "This Month"),
    year: extractMyfxbookPeriodMetric(html, "This Year")
  };
}

/**
 * Scrapes detailed periodic metrics from the Myfxbook public page using ZenRows.
 * @deprecated Use fetchScrapeDoMetrics instead
 */
async function fetchZenRowsMetrics() {
  const params = new URLSearchParams({
    url: CONFIG.myfxbookUrl,
    apikey: CONFIG.zenrowsApiKey,
    js_render: "true",
    premium_proxy: "true",
    antibot: "true"
  });

  const url = `https://api.zenrows.com/v1/?${params.toString()}`;
  const res = await fetch(url);
  
  if (!res.ok) {
    throw new Error(`ZenRows API error: ${res.status}`);
  }

  const html = await res.text();

  return {
    today: extractMyfxbookPeriodMetric(html, "Today") || "0.00%",
    week: extractMyfxbookPeriodMetric(html, "This Week") || "0.00%",
    month: extractMyfxbookPeriodMetric(html, "This Month") || "0.00%",
    year: extractMyfxbookPeriodMetric(html, "This Year") || "0.00%"
  };
}

/** @deprecated Use getMyfxbookLive instead */
export const fetchMyfxbookHeadlines = getMyfxbookLive;
