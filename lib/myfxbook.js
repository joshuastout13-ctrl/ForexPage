import { CONFIG } from "./config.js";

const TIMEOUT_MS = 12_000;

/**
 * Fetches headline stats from the public Myfxbook account page.
 * Returns whatever metrics can be parsed; partial results are fine.
 */
export async function fetchMyfxbookHeadlines() {
  const result = { fetchedAt: new Date().toISOString() };

  try {
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
      result.error = `HTTP ${res.status}`;
      return result;
    }

    const html = await res.text();

    // Each metric: try a list of patterns in order, take first match
    extract(result, html, "gain", [
      /id="contentGain"[^>]*>\s*([+-]?[\d,.]+\s*%?)/i,
      /"gain"\s*:\s*"([+-]?[\d.]+)"/i,
      /Gain[^<]{0,30}<[^>]+>\s*([+-]?[\d,.]+\s*%?)/i
    ]);

    extract(result, html, "drawdown", [
      /id="contentDrawdown"[^>]*>\s*([\d,.]+\s*%?)/i,
      /"drawdown"\s*:\s*"([\d.]+)"/i,
      /Drawdown[^<]{0,30}<[^>]+>\s*([\d,.]+\s*%?)/i
    ]);

    extract(result, html, "trades", [
      /id="contentTrades"[^>]*>\s*([\d,]+)/i,
      /"trades"\s*:\s*(\d+)/i
    ]);

    extract(result, html, "winRate", [
      /id="contentWon"[^>]*>\s*([\d.]+\s*%?)/i,
      /"won"\s*:\s*"([\d.]+)"/i,
      /Won[^<]{0,30}<[^>]+>\s*([\d.]+\s*%?)/i
    ]);

    extract(result, html, "balance", [
      /id="contentBalance"[^>]*>\s*([^\s<][^<]{0,30})/i,
      /"balance"\s*:\s*"([^"]+)"/i
    ]);

    extract(result, html, "profit", [
      /id="contentProfit"[^>]*>\s*([^\s<][^<]{0,30})/i,
      /"profit"\s*:\s*"([^"]+)"/i
    ]);

    extract(result, html, "pips", [
      /id="contentPips"[^>]*>\s*([+-]?[\d,.]+)/i,
      /"pips"\s*:\s*"([+-]?[\d.]+)"/i
    ]);
  } catch (err) {
    result.error = err.message ?? String(err);
  }

  return result;
}

function extract(out, html, key, patterns) {
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) {
      out[key] = m[1].trim();
      return;
    }
  }
}
