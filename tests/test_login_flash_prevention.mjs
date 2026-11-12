import assert from "node:assert";
import fs from "node:fs";

console.log("================================================================================");
console.log("TEST SUITE: HYDRATION & REFRESH LOGIN FLASH PREVENTION");
console.log("================================================================================\n");

const html = fs.readFileSync("c:/Users/USER/.gemini/antigravity-ide/scratch/ForexPage-commission-display/index.html", "utf8");

// Test 1: loginCard must have class="card hidden" in HTML markup
assert.ok(
  html.includes('<div id="loginCard" class="card hidden">'),
  "loginCard must have 'hidden' class in HTML markup so it never renders on initial paint"
);
console.log("✅ 1. loginCard contains 'hidden' class by default in HTML markup");

// Test 2: loadingCard exists and is not hidden initially
assert.ok(
  html.includes('id="loadingCard" class="card"'),
  "loadingCard must exist in HTML markup to provide smooth bootstrap state"
);
console.log("✅ 2. loadingCard exists in markup for smooth session verification");

// Test 3: VIEW_IDS includes loadingCard
assert.ok(
  html.includes('loading: "loadingCard"'),
  "VIEW_IDS dictionary must map 'loading' to 'loadingCard'"
);
console.log("✅ 3. VIEW_IDS includes 'loading: \"loadingCard\"'");

// Test 4: initializeApp invokes showView("loading") rather than showView("login")
assert.ok(
  html.includes('showView("loading");'),
  "initializeApp must invoke showView('loading') to avoid flash of unauthenticated login card"
);
assert.ok(
  !html.includes('showView("login");\r\n        await loadDashboard();') &&
  !html.includes('showView("login");\n        await loadDashboard();'),
  "initializeApp must NOT invoke showView('login') before loadDashboard"
);
console.log("✅ 4. initializeApp boots in loading state instead of flashing login card");

// Test 5: Verify @keyframes spin is present for loading indicator
assert.ok(
  html.includes('@keyframes spin'),
  "@keyframes spin must be defined for loading spinner"
);
console.log("✅ 5. @keyframes spin animation is present");

console.log("\n================================================================================");
console.log("ALL 5 LOGIN FLASH PREVENTION CHECKS PASSED (100%)");
console.log("================================================================================\n");

