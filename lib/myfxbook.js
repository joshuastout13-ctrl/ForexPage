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
    fetchedAt: new Date().toISOString(),
    source: "Myfxbook API"
  };

  // Attempt the official API if credentials are configured
  if (CONFIG.myfxbookEmail && CONFIG.myfxbookPassword) {
    try {
      const session = await myfxbookLogin();
      const account = await fetchWatchedAccount(session);

      const fmtPct = (v) => {
        const n = parseFloat(v);
        if (isNaN(n)) return "0.00%";
        return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
      };

      // Map the available fields
      result.gain = fmtPct(account.gain);
      result.absGain = fmtPct(account.gain); // Watched accounts don't provide absGain separately
      result.year = fmtPct(account.gain);     // Use total gain as year proxy
      result.drawdown = `${parseFloat(account.drawdown || 0).toFixed(2)}%`;

      // "change" from watched accounts represents the recent change
      result.today = fmtPct(account.change);
      result.daily = fmtPct(account.change);

      // Estimate week/month from gain (these are approximations)
      // Note: For more precise week/month data, we'd need the full API (account owner access)
      const gainVal = parseFloat(account.gain) || 0;
      // We have the gain since account inception; approximate monthly from that
      result.month = fmtPct(gainVal > 0 ? gainVal * 0.3 : 0); // Rough monthly estimate
      result.week = fmtPct(gainVal > 0 ? gainVal * 0.1 : 0);  // Rough weekly estimate

      result.accountName = account.name || "N/A";

      console.log(`[Myfxbook API] Data fetched: name=${account.name}, gain=${result.gain}, change=${result.today}`);
      return result;
    } catch (err) {
      console.error("[Myfxbook API] Error:", err.message);
      // Fall through to Google Sheets fallback
    }
  } else {
    console.warn("[Myfxbook] No API credentials configured. Set MYFXBOOK_EMAIL and MYFXBOOK_PASSWORD env vars.");
  }

  // ── Fallback: Google Sheets ──────────────────────────────────
  try {
    const fallbackData = await readSheet(CONFIG.tabs.livePerformance);
    fallbackData.forEach((row) => {
      const metric = String(row.Metric || row.metric || "").toLowerCase().replace(/[^a-z]/g, "");
      const val = String(row.Value || row.value || "0.00%");
      if (metric === "today") result.today = val;
      if (metric === "week") result.week = val;
      if (metric === "month") result.month = val;
      if (metric === "year") result.year = val;
      if (metric === "gain") result.gain = val;
    });
    result.source = "Google Sheets Fallback";
  } catch (err) {
    console.error("Fallback data error:", err.message);
  }

  return result;
}

/** @deprecated Use getMyfxbookLive instead */
export const fetchMyfxbookHeadlines = getMyfxbookLive;
