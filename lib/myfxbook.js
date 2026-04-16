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
 * Fetches Stone & Company data from Myfxbook's watched accounts.
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
    throw new Error("No watched accounts found. Please add Stone & Company to your Myfxbook watchlist.");
  }

  // Find Stone & Company by name or configured account ID
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
    drawdown: "0.00%",
    fetchedAt: new Date().toISOString(),
    source: "Hybrid (Sheets + API)"
  };

  // 1. Fetch Google Sheets Data first (Source of Truth for Today, Week, Month, Year)
  try {
    const sheetData = await readSheet(CONFIG.tabs.livePerformance);
    const fmt = (v) => {
      const n = parseFloat(String(v).replace(/[%\s]/g, ""));
      if (isNaN(n)) return "0.00%";
      return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
    };

    sheetData.forEach((row) => {
      const metric = String(row.Metric || row.metric || "").toLowerCase().replace(/[^a-z]/g, "");
      const val = fmt(row.Value || row.value || "0.00%");
      
      if (metric === "today") result.today = val;
      if (metric === "thisweek" || metric === "week") result.week = val;
      if (metric === "thismonth" || metric === "month") result.month = val;
      if (metric === "thisyear" || metric === "year") result.year = val;
      if (metric === "gain") result.gain = val;
    });
    console.log("[Myfxbook] Initialized metrics from Google Sheets");
  } catch (err) {
    console.error("[Myfxbook] Google Sheets fetch failed:", err.message);
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

      // If the sheet hasn't provided a specific performance year, fallback to the API total gain
      if (result.year === "0.00%") {
        result.year = fmtPct(account.gain);
      }

      // We explicitly DO NOT use account.change as daily gain here, 
      // as the Myfxbook "watched accounts" API often returns the total gain in the change field.
      // The daily/weekly/monthly metrics should come from the Google Sheet for accuracy.

      console.log(`[Myfxbook API] Real-time total gain merged: ${result.gain}`);
    } catch (err) {
      console.error("[Myfxbook API] Error fetching real-time gain:", err.message);
      result.source = "Google Sheets (Final Fallback)";
    }
  }

  return result;
}

/** @deprecated Use getMyfxbookLive instead */
export const fetchMyfxbookHeadlines = getMyfxbookLive;
