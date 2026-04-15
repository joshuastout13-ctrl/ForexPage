import { getMyfxbookLive } from "./lib/myfxbook.js";

async function testScraper() {
  try {
    const live = await getMyfxbookLive();
    console.log("Scraped Data:", JSON.stringify(live, null, 2));
  } catch (err) {
    console.error("Scraper Test Failed:", err);
  }
}

testScraper();
