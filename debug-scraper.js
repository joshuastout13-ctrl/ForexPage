import { CONFIG } from './lib/config.js';
import fs from 'fs';

async function run() {
  console.log('Fetching from scrape.do...');
  const params = new URLSearchParams({
    token: CONFIG.scrapedotdoToken,
    url: CONFIG.myfxbookUrl + '?t=' + Date.now(),
    super: "true",
    render: "true",
    playwrightWait: "5000"
  });

  const url = `https://api.scrape.do?${params.toString()}`;
  const res = await fetch(url);
  const text = await res.text();
  fs.writeFileSync('scrape.html', text);
  console.log('Saved to scrape.html');
}

run();
