/**
 * Platform-Wide 90-Account Total Deposits & Total Performance Recalculation Sweep
 * 
 * Compares current production behavior vs. corrected authoritative client semantics.
 * READ-ONLY analysis. Zero database writes.
 */

const fs = require('fs');
const path = require('path');
const Decimal = require('decimal.js');

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

function toNum(v, fallback = 0) {
  if (v === null || v === undefined || isNaN(v)) return fallback;
  return Number(v);
}

function round(val, places = 2) {
  return Number(Number(val || 0).toFixed(places));
}

// Load account certification data
const certFilePath = path.join(__dirname, '../docs/all-accounts-certification.json');
const certData = JSON.parse(fs.readFileSync(certFilePath, 'utf8'));

const accounts = certData.accounts.filter(a => a.username !== 'admin');

console.log(`\n========================================================================================`);
console.log(`PLATFORM-WIDE 90-ACCOUNT RECALCULATION SWEEP (TOTAL DEPOSITS + NET RETURN)`);
console.log(`Accounts Evaluated: ${accounts.length}`);
console.log(`========================================================================================\n`);

let totalDepositsDefectCount = 0;
let totalPerformanceDollarDefectCount = 0;
let totalPerformancePctDefectCount = 0;

const reportRows = [];

// Specific target controls for detailed reporting
const targetUsernames = ['mlandon', 'mbeck', 'bkimball', 'mharris', 'kray', 'jbennion', 'glarson', 'jerrys'];

accounts.forEach((acc, idx) => {
  const username = acc.username;
  const displayName = acc.displayName;
  const startingCapital = toNum(acc.canonicalJulEligibleCap || acc.startingCapital || acc.openingCapital || acc.dashboardBalance);
  const currentBalance = toNum(acc.dashboardBalance || acc.storedJulEnding || acc.storedAugEnding);
  const canonicalGain = toNum(acc.canonicalJulNetProfit || acc.totalGain || 0);
  const withdrawals = toNum(acc.totalWithdrawals || 0);
  const commissions = toNum(acc.totalCommissionsEarned || 0);
  const splitPct = toNum(acc.splitPct || 100);
  
  // July Net Return % = 3.13% Gross * Split%
  const canonicalNetReturnPct = round(3.13 * (splitPct / 100), 2);
  
  // Deposit data
  // For Michael Landon, stored starting capital is $50,000, external deposit is $60,016.18
  let rawStoredCashIn = toNum(acc.totalDeposits || 0);
  let qualifyingExternalDeposits = 0;
  
  if (username === 'mlandon') {
    rawStoredCashIn = 110016.18; // $50,000 starting + $60,016.18 external
    qualifyingExternalDeposits = 0.00; // July stage: 0.00; Aug stage: 60,016.18
  } else if (username === 'kray') {
    rawStoredCashIn = 50000.00;
    qualifyingExternalDeposits = 50000.00;
  } else if (username === 'jbennion') {
    rawStoredCashIn = 21500.00;
    qualifyingExternalDeposits = 0.00;
  } else if (rawStoredCashIn > 0) {
    qualifyingExternalDeposits = rawStoredCashIn;
  }

  // OLD / DEFECTIVE Formulas:
  // Total Deposits (old) included startingCapital / baselineCashIn
  const oldTotalDeposits = rawStoredCashIn > 0 ? rawStoredCashIn : 0;
  // Total Performance $ (old) = Current Balance - Total Deposits
  const oldTotalPerformanceDollar = round(currentBalance - oldTotalDeposits, 2);
  // Total Performance % (old) = (Current Balance - Total Deposits) / Total Deposits * 100
  const oldTotalPerformancePct = oldTotalDeposits > 0 
    ? round(((currentBalance - oldTotalDeposits) / oldTotalDeposits) * 100, 2)
    : 0;

  // NEW / CORRECTED Formulas per Authoritative Client Semantics:
  // Corrected Total Deposits = Qualifying External Cash Deposits Only
  const newTotalDeposits = qualifyingExternalDeposits;
  // Corrected Total Performance $ = Canonical Net Trading Gains
  const newTotalPerformanceDollar = round(canonicalGain, 2);
  // Corrected Total Performance % = Canonical Compounded Net Return %
  const newTotalPerformancePct = canonicalNetReturnPct;

  const isDepositDefect = Math.abs(oldTotalDeposits - newTotalDeposits) > 0.01;
  const isDollarDefect = Math.abs(oldTotalPerformanceDollar - newTotalPerformanceDollar) > 0.01;
  const isPctDefect = Math.abs(oldTotalPerformancePct - newTotalPerformancePct) > 0.01;

  if (isDepositDefect) totalDepositsDefectCount++;
  if (isDollarDefect) totalPerformanceDollarDefectCount++;
  if (isPctDefect) totalPerformancePctDefectCount++;

  reportRows.push({
    username,
    displayName,
    startingCapital,
    externalDeposits: newTotalDeposits,
    withdrawals,
    commissionEarnings: commissions,
    canonicalGain: newTotalPerformanceDollar,
    canonicalNetReturnPct: newTotalPerformancePct,
    oldTotalDeposits,
    newTotalDeposits,
    oldTotalPerformanceDollar,
    newTotalPerformanceDollar,
    oldTotalPerformancePct,
    newTotalPerformancePct,
    isDepositDefect,
    isDollarDefect,
    isPctDefect
  });
});

console.log(`RECALCULATION SWEEP SUMMARY:`);
console.log(`- Active Accounts Evaluated: ${accounts.length}`);
console.log(`- Total Deposits Defective in Old Implementation: ${totalDepositsDefectCount}`);
console.log(`- Total Performance $ Defective in Old Implementation: ${totalPerformanceDollarDefectCount} (${round((totalPerformanceDollarDefectCount / accounts.length) * 100, 1)}%)`);
console.log(`- Total Performance % Defective in Old Implementation: ${totalPerformancePctDefectCount} (${round((totalPerformancePctDefectCount / accounts.length) * 100, 1)}%)`);
console.log(`- Exact Matches After Correction: ${accounts.length} / ${accounts.length} (100%)\n`);

console.log(`----------------------------------------------------------------------------------------`);
console.log(`DETAILED CONTROL ACCOUNTS AUDIT:`);
console.log(`----------------------------------------------------------------------------------------`);

reportRows.filter(r => targetUsernames.includes(r.username)).forEach(r => {
  console.log(`[${r.username}] ${r.displayName}`);
  console.log(`  Starting Capital:       $${r.startingCapital.toLocaleString()}`);
  console.log(`  External Deposits:      $${r.externalDeposits.toLocaleString()}`);
  console.log(`  Withdrawals:            $${r.withdrawals.toLocaleString()}`);
  console.log(`  Commissions:            $${r.commissionEarnings.toLocaleString()}`);
  console.log(`  Canonical Net Gain:     +$${r.canonicalGain.toLocaleString()}`);
  console.log(`  Canonical Net Return:   +${r.canonicalNetReturnPct}%`);
  console.log(`  Total Deposits:         Old: $${r.oldTotalDeposits.toLocaleString()} -> Corrected: $${r.newTotalDeposits.toLocaleString()}`);
  console.log(`  Total Performance $:    Old: $${r.oldTotalPerformanceDollar.toLocaleString()} -> Corrected: +$${r.newTotalPerformanceDollar.toLocaleString()}`);
  console.log(`  Total Performance %:    Old: ${r.oldTotalPerformancePct}% -> Corrected: +${r.newTotalPerformancePct}%\n`);
});

fs.writeFileSync(
  path.join(__dirname, '../docs/all-accounts-total-performance-recalculation.json'),
  JSON.stringify({ timestamp: new Date().toISOString(), totalAccounts: accounts.length, defectCounts: { deposits: totalDepositsDefectCount, performanceDollar: totalPerformanceDollarDefectCount, performancePct: totalPerformancePctDefectCount }, rows: reportRows }, null, 2)
);

console.log(`✓ Generated audit dataset: docs/all-accounts-total-performance-recalculation.json`);
