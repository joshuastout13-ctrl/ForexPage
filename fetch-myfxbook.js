import { CONFIG } from './lib/config.js';
import fs from 'fs';

async function run() {
  const url = `https://api.scrape.do?token=${CONFIG.scrapedotdoToken}&url=${CONFIG.myfxbookUrl}`;
  const res = await fetch(url);
  const text = await res.text();
  fs.writeFileSync('scrape.html', text);
}
run();
