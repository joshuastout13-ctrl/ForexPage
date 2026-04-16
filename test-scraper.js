// Test: Myfxbook API - check watched accounts + try get-gain with public account ID
const EMAIL = "Josh@roww.org";
const PASS = "Test123";
const API = "https://www.myfxbook.com/api";
const PUBLIC_ACCOUNT_ID = "11915183"; // Stone & Company from URL

async function test() {
  console.log("1. Logging in...");
  const loginRes = await fetch(`${API}/login.json?email=${encodeURIComponent(EMAIL)}&password=${encodeURIComponent(PASS)}`);
  const loginData = await loginRes.json();
  if (loginData.error) { console.error("Login FAILED"); return; }
  const session = loginData.session;
  console.log("Login OK, session obtained");

  // Test: get-watched-accounts
  console.log("\n2. Get watched accounts...");
  const watchRes = await fetch(`${API}/get-watched-accounts.json?session=${session}`);
  const watchData = await watchRes.json();
  console.log("Watched accounts:", JSON.stringify(watchData, null, 2));

  // Test: get-gain for the public account ID
  console.log("\n3. Get gain for public account 11915183...");
  try {
    const gainUrl = `${API}/get-gain.json?session=${session}&id=${PUBLIC_ACCOUNT_ID}&start=2026-01-01&end=2026-12-31`;
    const gainRes = await fetch(gainUrl);
    const gainData = await gainRes.json();
    console.log("Gain response:", JSON.stringify(gainData, null, 2));
  } catch (e) { console.error("Gain error:", e.message); }

  // Test: get-daily-gain
  console.log("\n4. Get daily gain for public account...");
  try {
    const dgUrl = `${API}/get-daily-gain.json?session=${session}&id=${PUBLIC_ACCOUNT_ID}&start=2026-04-01&end=2026-04-16`;
    const dgRes = await fetch(dgUrl);
    const dgData = await dgRes.json();
    console.log("Daily gain response:", JSON.stringify(dgData, null, 2));
  } catch (e) { console.error("Daily gain error:", e.message); }

  // Test: get-data-daily
  console.log("\n5. Get data daily for public account...");
  try {
    const ddUrl = `${API}/get-data-daily.json?session=${session}&id=${PUBLIC_ACCOUNT_ID}&start=2026-04-01&end=2026-04-16`;
    const ddRes = await fetch(ddUrl);
    const ddData = await ddRes.json();
    console.log("Data daily response:", JSON.stringify(ddData, null, 2));
  } catch (e) { console.error("Data daily error:", e.message); }

  await fetch(`${API}/logout.json?session=${session}`);
  console.log("\n6. Logged out.");
}

test().catch(console.error);
