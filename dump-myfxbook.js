import { CONFIG } from "./lib/config.js";

async function dumpHtml() {
  const res = await fetch(CONFIG.myfxbookUrl, {
    headers: { "User-Agent": "Mozilla/5.0 (Vercel Serverless)" }
  });
  const html = await res.text();
  console.log(html.substring(0, 2000)); // Sample to see the structure
}

dumpHtml();
