async function testMyfxbookFetch() {
  const url = "https://www.myfxbook.com/members/PCSplus/stone-company/11915183";
  const userAgents = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  ];

  for (const ua of userAgents) {
    console.log(`Testing UA: ${ua}`);
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": ua }
      });
      console.log(`Status: ${res.status}`);
      if (res.ok) {
        const text = await res.text();
        console.log(`Length: ${text.length}`);
        if (text.includes("Today")) {
            console.log("Success! Found 'Today' in HTML.");
            return;
        }
      }
    } catch (err) {
      console.error(`Error: ${err.message}`);
    }
  }
}

testMyfxbookFetch();
