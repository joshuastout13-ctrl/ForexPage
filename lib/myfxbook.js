/**
 * Myfxbook scraping has been removed — it was unreliable because the site
 * blocks server-side requests and changes its HTML structure frequently.
 *
 * This stub is kept for backward compatibility but always returns zeroed values.
 * Live performance data can be added later via a proper API integration.
 */
export async function getMyfxbookLive() {
  return {
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
}

/** @deprecated Use getMyfxbookLive instead */
export const fetchMyfxbookHeadlines = getMyfxbookLive;
