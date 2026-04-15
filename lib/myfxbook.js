import { CONFIG } from "./config.js";
import { readSheet, num } from "./sheets.js";

/**
 * Parses a simple percentage from a string (e.g. "+1.23%" -> 1.23)
 */
function parsePct(s) {
  if (!s) return 0;
  const match = s.match(/([+-]?\d+\.\d+)%/);
  return match ? parseFloat(match[1]) : 0;
}

/**
 * Fetches live performance metrics from Myfxbook public page.
 * Falls back to Google Sheets' "Live_Performance" tab if scraping fails.
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
    source: "Myfxbook Scraper"
  };

  if (CONFIG.myfxbookUrl) {
    try {
      const res = await fetch(CONFIG.myfxbookUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (Vercel Serverless)" }
      });
      if (res.ok) {
        const html = await res.text();
        
        // Basic scraper logic: search for "Today", "This Week", etc.
        // We look for the label, followed by optional whitespace/tags/colon,
        // then the next percentage value.
        const extract = (label) => {
          // Match the label (case insensitive) followed by anything until a percentage value
          // We look for patterns like:
          // <td>Today</td> <td class="text-right"><span class="green">+0.10%</span></td>
          // or <td>This Week:</td> <td>1.23%</td>
          const regex = new RegExp(`${label}\\s*[:\-]?[^<]*<(?:[^>]+)>\\s*(?:<(?:[^>]+)>)?\\s*([+-]?\\d+\\.\\d+%)`, "i");
          const match = html.match(regex);
          
          if (!match) {
            // Fallback second attempt: simple text-based search if the complex regex fails
            const simpleRegex = new RegExp(`${label}\\s*[:\-]?[\\s\\w]*([+-]?\\d+\\.\\d+%)`, "i");
            const simpleMatch = html.match(simpleRegex);
            return simpleMatch ? simpleMatch[1] : null;
          }
          return match[1];
        };

        result.today = extract("Today") || result.today;
        result.week = extract("This Week") || extract("Week") || result.week;
        result.month = extract("This Month") || extract("Month") || result.month;
        result.year = extract("This Year") || extract("Year") || result.year;
        
        // Also look for headline values (Gain, Drawdown, etc.) if they exist in standard spans
        const gainMatch = html.match(/id="gain"[^>]*>([+-]?\\d+\\.\\d+%)<\/span>/i);
        const gainMatch2 = html.match(/Gain\s*:\s*(?:<[^>]+>\s*)*([+-]?\d+\.\d+%)/i);
        if (gainMatch) result.gain = gainMatch[1];
        else if (gainMatch2) result.gain = gainMatch2[1];

        // If we found any data, return it
        if (result.today !== "0.00%" || result.week !== "0.00%" || result.gain !== "0.00%") {
          return result;
        }

      }
    } catch (err) {
      console.error("Myfxbook scraping error:", err.message);
    }
  }

  // Fallback to Google Sheets
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
