import { extractSheetId } from '../lib/sheets.js';

const testCases = [
  { input: "1uV2CmudSQtmHRaIZTqYDGjWLlmMOcYBCdA1uaL7iMVg", expected: "1uV2CmudSQtmHRaIZTqYDGjWLlmMOcYBCdA1uaL7iMVg" },
  { input: "https://docs.google.com/spreadsheets/d/1uV2CmudSQtmHRaIZTqYDGjWLlmMOcYBCdA1uaL7iMVg/edit", expected: "1uV2CmudSQtmHRaIZTqYDGjWLlmMOcYBCdA1uaL7iMVg" },
  { input: "https://docs.google.com/spreadsheets/d/1uV2CmudSQtmHRaIZTqYDGjWLlmMOcYBCdA1uaL7iMVg/view", expected: "1uV2CmudSQtmHRaIZTqYDGjWLlmMOcYBCdA1uaL7iMVg" },
  { input: "https://docs.google.com/spreadsheets/d/1uV2CmudSQtmHRaIZTqYDGjWLlmMOcYBCdA1uaL7iMVg", expected: "1uV2CmudSQtmHRaIZTqYDGjWLlmMOcYBCdA1uaL7iMVg" },
  { input: "  1uV2CmudSQtmHRaIZTqYDGjWLlmMOcYBCdA1uaL7iMVg  ", expected: "1uV2CmudSQtmHRaIZTqYDGjWLlmMOcYBCdA1uaL7iMVg" }
];

console.log("=== Testing extractSheetId ===");
let allPassed = true;

testCases.forEach((tc, i) => {
  const result = extractSheetId(tc.input);
  if (result === tc.expected) {
    console.log(`Test ${i + 1}: PASS`);
  } else {
    console.log(`Test ${i + 1}: FAIL! Expected "${tc.expected}", got "${result}"`);
    allPassed = false;
  }
});

if (allPassed) {
  console.log("\n✅ ALL TESTS PASSED");
} else {
  console.log("\n❌ SOME TESTS FAILED");
  process.exit(1);
}
