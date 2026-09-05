/**
 * PLATFORM-WIDE FINANCIAL EXPOSURE AUDIT — READ-ONLY
 * 
 * Date: 2026-08-18
 * Trigger: Josh production evidence Aug 17–18, 2026
 * 
 * ZERO PRODUCTION MUTATIONS. SELECT queries only.
 * This script reads production data and performs all analysis in memory.
 */

const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const Decimal = require('decimal.js');
const fs = require('fs');
const path = require('path');
const { getFundAccountingDate } = require('./lib/month-state.cjs');

dotenv.config({ path: '.env.local' });
Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('FATAL: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
const YEAR = 2026;

function roundMoney(dec) {
  return dec.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

function toDec(val, fallback = 0) {
  if (val === null || val === undefined || isNaN(val)) return new Decimal(fallback);
  return new Decimal(val);
}

function toNum(val, fallback = 0) {
  if (val === null || val === undefined || isNaN(val)) return fallback;
  return Number(val);
}

// ============================================================================
// DATA EXTRACTION (READ-ONLY)
// ============================================================================

async function loadAllData() {
  console.log('\n========================================');
  console.log('  LOADING PRODUCTION DATA (READ-ONLY)');
  console.log('========================================\n');

  const [
    { data: investors, error: e1 },
    { data: accounts, error: e2 },
    { data: commShares, error: e3 },
    { data: commEarnings, error: e4 },
    { data: commRules, error: e5 },
    { data: history, error: e6 },
    { data: monthlyReturns, error: e7 },
    { data: livePerf, error: e8 },
    { data: deposits, error: e9 },
    { data: withdrawals, error: e10 }
  ] = await Promise.all([
    supabase.from('investors').select('*'),
    supabase.from('investor_accounts').select('*'),
    supabase.from('commission_shares').select('*'),
    supabase.from('commission_earnings').select('*'),
    supabase.from('commission_rules').select('*'),
    supabase.from('investor_monthly_history').select('*'),
    supabase.from('monthly_returns').select('*'),
    supabase.from('live_performance').select('*'),
    supabase.from('deposits').select('*'),
    supabase.from('withdrawals').select('*')
  ]);

  const errors = [e1, e2, e3, e4, e5, e6, e7, e8, e9, e10].filter(Boolean);
  if (errors.length > 0) {
    console.error('FATAL: Database read errors:', errors);
    process.exit(1);
  }

  console.log(`  Investors: ${investors.length}`);
  console.log(`  Accounts: ${accounts.length}`);
  console.log(`  Commission Shares: ${commShares.length}`);
  console.log(`  Commission Earnings: ${commEarnings.length}`);
  console.log(`  Commission Rules (legacy): ${commRules.length}`);
  console.log(`  Monthly History: ${history.length}`);
  console.log(`  Monthly Returns: ${monthlyReturns.length}`);
  console.log(`  Live Performance: ${livePerf.length}`);
  console.log(`  Deposits: ${deposits.length}`);
  console.log(`  Withdrawals: ${withdrawals.length}`);

  return { investors, accounts, commShares, commEarnings, commRules, history, monthlyReturns, livePerf, deposits, withdrawals };
}

// ============================================================================
// HELPER: Build investor lookup maps
// ============================================================================

function buildInvestorMaps(investors) {
  const byId = new Map();
  const byUsername = new Map();
  const byAnyKey = new Map();

  for (const inv of investors) {
    const id = String(inv.id || '').trim().toLowerCase();
    const username = String(inv.portal_username || '').trim().toLowerCase();
    byId.set(id, inv);
    if (username) byUsername.set(username, inv);
    if (id) byAnyKey.set(id, inv);
    if (username) byAnyKey.set(username, inv);
  }

  return { byId, byUsername, byAnyKey };
}

function getInvestorName(inv) {
  if (!inv) return 'UNKNOWN';
  const first = String(inv.first_name || '').trim();
  const last = String(inv.last_name || '').trim();
  return [first, last].filter(Boolean).join(' ') || inv.portal_username || inv.id || 'UNKNOWN';
}

function getIdSet(inv) {
  if (!inv) return new Set();
  return new Set([
    inv.id, inv.portal_username
  ].filter(Boolean).map(s => String(s).trim().toLowerCase()));
}

// ============================================================================
// PART 1: PERFORMANCE DISPLAY SEMANTICS
// ============================================================================

function auditPerformanceSemantics(data) {
  console.log('\n========================================');
  console.log('  PART 1: PERFORMANCE DISPLAY SEMANTICS');
  console.log('========================================\n');

  const results = {
    cards: [],
    classification: ''
  };

  // Extract live performance values
  const liveMap = {};
  for (const row of data.livePerf) {
    const metric = String(row.metric || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    liveMap[metric] = toNum(String(row.value_pct || '0').replace(/[%+\s]/g, ''));
  }

  // Get fund returns for reference
  const fundReturns = {};
  for (const r of data.monthlyReturns) {
    if (toNum(r.year) === YEAR) {
      fundReturns[toNum(r.month_number)] = toNum(r.gross_return_pct);
    }
  }

  const { monthNumber: currentMonth } = getFundAccountingDate();
  const lastMonthNum = currentMonth === 1 ? 12 : currentMonth - 1;
  const lastMonthReturn = fundReturns[lastMonthNum] || 0;

  // Document each card's semantics
  const cardAnalysis = [
    {
      label: 'Today',
      percentageSource: 'live_performance table (metric="Today"), originally from Myfxbook scrape',
      percentageValue: liveMap['today'] || 0,
      percentageSemantics: 'GROSS fund-level return for today',
      dollarFormula: 'summaryBalance × (grossTodayPct / 100)',
      dollarSemantics: 'investorBalance × grossFundReturn — NOT gross profit, NOT net profit',
      investorSplitApplied: false,
      eligibleCapitalUsed: false,
      calculationPeriod: 'Intraday (today)',
      apiResponseField: 'liveDollarGains.today',
      frontendField: 'perf-item "Today" .val'
    },
    {
      label: 'This Week',
      percentageSource: 'live_performance table (metric="This Week"), originally from Myfxbook scrape',
      percentageValue: liveMap['thisweek'] || liveMap['week'] || 0,
      percentageSemantics: 'GROSS fund-level return for this week',
      dollarFormula: 'summaryBalance × (grossWeekPct / 100)',
      dollarSemantics: 'investorBalance × grossFundReturn — NOT gross profit, NOT net profit',
      investorSplitApplied: false,
      eligibleCapitalUsed: false,
      calculationPeriod: 'Current week',
      apiResponseField: 'liveDollarGains.week',
      frontendField: 'perf-item "This Week" .val'
    },
    {
      label: 'This Month',
      percentageSource: 'live_performance table (metric="This Month"), originally from Myfxbook scrape',
      percentageValue: liveMap['thismonth'] || liveMap['month'] || 0,
      percentageSemantics: 'GROSS fund-level return for this month',
      dollarFormula: 'summaryBalance × (grossMonthPct / 100)',
      dollarSemantics: 'investorBalance × grossFundReturn — NOT gross profit, NOT net profit',
      investorSplitApplied: false,
      eligibleCapitalUsed: false,
      calculationPeriod: 'Current month MTD',
      apiResponseField: 'liveDollarGains.month',
      frontendField: 'perf-item "This Month" .val'
    },
    {
      label: 'Last Month',
      percentageSource: 'monthly_returns table for prior month, formatted as gross %',
      percentageValue: lastMonthReturn,
      percentageSemantics: 'GROSS fund-level return for last full month',
      dollarFormula: 'lastBreakdownRow.gain (from compounding loop) OR summaryBalance × (grossLastMonthPct / 100)',
      dollarSemantics: 'IF breakdown row exists: investor NET gain (effective return after split). ELSE: balance × gross %',
      investorSplitApplied: 'YES (if breakdown row exists), NO (fallback)',
      eligibleCapitalUsed: 'YES (if breakdown row exists), NO (fallback)',
      calculationPeriod: 'Prior complete month',
      apiResponseField: 'liveDollarGains.lastMonth',
      frontendField: 'perf-item "Last Month" .val'
    },
    {
      label: 'This Year',
      percentageSource: 'live_performance table (metric="This Year") OR Myfxbook API total gain',
      percentageValue: liveMap['thisyear'] || liveMap['year'] || 0,
      percentageSemantics: 'GROSS fund-level YTD return',
      dollarFormula: 'totalGain.toNumber() — sum of all monthly investor net gains',
      dollarSemantics: 'investor NET gain YTD (sum of each month gain after split/draw)',
      investorSplitApplied: true,
      eligibleCapitalUsed: true,
      calculationPeriod: 'Year to date',
      apiResponseField: 'liveDollarGains.year',
      frontendField: 'perf-item "This Year" .val'
    }
  ];

  results.cards = cardAnalysis;

  // Demonstrate the problem with a representative investor
  // Find an investor with a non-100% split for demonstration
  const demoInvestor = data.investors.find(i => 
    toNum(i.split_pct) < 100 && toNum(i.split_pct) > 0 && i.active !== false
  );

  if (demoInvestor) {
    const demoAccounts = data.accounts.filter(a => a.investor_id === demoInvestor.id);
    const demoHistory = data.history.filter(h => h.investor_id === demoInvestor.id && toNum(h.year) === YEAR);
    const latestHistory = demoHistory.sort((a, b) => toNum(b.month_number) - toNum(a.month_number))[0];
    
    if (latestHistory) {
      const balance = toNum(latestHistory.ending_balance);
      const splitPct = toNum(demoInvestor.split_pct);
      const monthPct = liveMap['thismonth'] || liveMap['month'] || 0;
      const lastMonthPct = lastMonthReturn;
      
      const currentDisplayedDollar = balance * (monthPct / 100);
      
      // What SHOULD be displayed for net investor earnings
      const eligibleCapital = balance; // Simplified; actual eligible capital requires deposits/withdrawals
      const grossProfit = eligibleCapital * (monthPct / 100);
      const investorNetProfit = grossProfit * (splitPct / 100);
      
      console.log(`  DEMONSTRATION: ${getInvestorName(demoInvestor)} (${demoInvestor.portal_username})`);
      console.log(`    Split: ${splitPct}%`);
      console.log(`    Latest Ending Balance: $${balance.toFixed(2)}`);
      console.log(`    This Month Gross %: ${monthPct}%`);
      console.log(`    ---`);
      console.log(`    CURRENTLY DISPLAYED "This Month" dollar: $${currentDisplayedDollar.toFixed(2)}`);
      console.log(`    (Formula: balance × gross% = $${balance.toFixed(2)} × ${monthPct}%)`);
      console.log(`    ---`);
      console.log(`    CORRECT Gross Profit: $${grossProfit.toFixed(2)}`);
      console.log(`    CORRECT Investor NET Profit: $${investorNetProfit.toFixed(2)}`);
      console.log(`    (Formula: grossProfit × split% = $${grossProfit.toFixed(2)} × ${splitPct}%)`);
      console.log(`    ---`);
      console.log(`    VARIANCE (display vs investor net): $${(currentDisplayedDollar - investorNetProfit).toFixed(2)}`);

      results.demonstration = {
        investor: getInvestorName(demoInvestor),
        username: demoInvestor.portal_username,
        splitPct,
        balance,
        thisMonthGrossPct: monthPct,
        currentDisplayedDollar,
        correctGrossProfit: grossProfit,
        correctInvestorNetProfit: investorNetProfit,
        variance: currentDisplayedDollar - investorNetProfit
      };
    }
  }

  // Last Month verification with actual history
  if (demoInvestor) {
    const lastMonthHist = data.history.find(h => 
      h.investor_id === demoInvestor.id && 
      toNum(h.year) === YEAR && 
      toNum(h.month_number) === lastMonthNum
    );

    if (lastMonthHist) {
      const openBal = toNum(lastMonthHist.opening_balance);
      const deps = toNum(lastMonthHist.deposits);
      const wds = toNum(lastMonthHist.withdrawals);
      const endBal = toNum(lastMonthHist.ending_balance);
      const grossPct = toNum(lastMonthHist.gross_return_pct);
      const splitPct = toNum(demoInvestor.split_pct);
      
      const eligibleCapital = openBal + deps - wds;
      const effPct = grossPct * splitPct / 100;
      const investorGain = eligibleCapital * effPct / 100;
      
      const balance = toNum(data.history.filter(h => 
        h.investor_id === demoInvestor.id && toNum(h.year) === YEAR
      ).sort((a, b) => toNum(b.month_number) - toNum(a.month_number))[0]?.ending_balance || 0);
      
      const displayedLastMonthDollar_fallback = balance * (lastMonthReturn / 100);
      
      console.log(`\n  LAST MONTH VERIFICATION (${getInvestorName(demoInvestor)}):`);
      console.log(`    Eligible Capital: $${eligibleCapital.toFixed(2)}`);
      console.log(`    Gross Return: ${grossPct}%`);
      console.log(`    Effective Return (after ${splitPct}% split): ${effPct.toFixed(4)}%`);
      console.log(`    Investor NET Gain (from history): $${investorGain.toFixed(2)}`);
      console.log(`    Display value (breakdown.gain path): Should show NET gain`);
      console.log(`    Display value (fallback path): $${displayedLastMonthDollar_fallback.toFixed(2)} (balance × gross%)`);
      
      results.lastMonthVerification = {
        eligibleCapital, grossPct, effPct, investorGain,
        displayedFallback: displayedLastMonthDollar_fallback,
        usesBreakdownGain: true
      };
    }
  }

  // Classification
  results.classification = 'DISPLAY_SEMANTICS_DEFECT';
  results.classificationDetail = 
    'Today/Week/Month dollar values use balance × grossFundReturn% which is neither gross fund profit ' +
    '(should use eligible capital as basis) nor investor net profit (should also apply split%). ' +
    'LastMonth correctly uses investor net gain when breakdown row exists. ' +
    'Year correctly uses cumulative investor net gain. ' +
    'The defect is INCONSISTENT BY CARD: 3 cards show a hybrid metric, 2 cards show correct net values.';

  console.log(`\n  CLASSIFICATION: ${results.classification}`);
  console.log(`  ${results.classificationDetail}`);

  return results;
}

// ============================================================================
// PART 2: MICHAEL BECK ← MARY JO HARRIS FORENSIC
// ============================================================================

function auditMichaelBeckMaryJo(data, invMaps) {
  console.log('\n========================================');
  console.log('  PART 2: MICHAEL BECK ← MARY JO HARRIS');
  console.log('========================================\n');

  const results = {
    michaelBeck: null,
    maryJoHarris: null,
    rules: [],
    sourceBalanceTrace: {},
    independentBalance: 0,
    variance: {}
  };

  // Find canonical IDs
  const mbeck = invMaps.byUsername.get('mbeck') || invMaps.byAnyKey.get('mbeck');
  const mharris = data.investors.find(i => {
    const name = `${i.first_name || ''} ${i.last_name || ''}`.toLowerCase();
    const uname = String(i.portal_username || '').toLowerCase();
    return name.includes('mary jo') && name.includes('harris') || uname === 'mharris';
  });

  if (!mbeck) {
    console.log('  ERROR: Cannot find Michael Beck (mbeck)');
    results.error = 'MBECK_NOT_FOUND';
    return results;
  }
  if (!mharris) {
    console.log('  ERROR: Cannot find Mary Jo Harris');
    results.error = 'MHARRIS_NOT_FOUND';
    return results;
  }

  results.michaelBeck = {
    id: mbeck.id,
    username: mbeck.portal_username,
    name: getInvestorName(mbeck),
    splitPct: toNum(mbeck.split_pct)
  };

  results.maryJoHarris = {
    id: mharris.id,
    username: mharris.portal_username,
    name: getInvestorName(mharris),
    splitPct: toNum(mharris.split_pct)
  };

  console.log(`  Michael Beck: id=${mbeck.id}, username=${mbeck.portal_username}, split=${mbeck.split_pct}%`);
  console.log(`  Mary Jo Harris: id=${mharris.id}, username=${mharris.portal_username}, split=${mharris.split_pct}%`);

  // Find commission rules linking Mary Jo → Michael
  const mharrisIdSet = getIdSet(mharris);
  const mbeckIdSet = getIdSet(mbeck);

  const matchingShares = data.commShares.filter(s => {
    const src = String(s.source_investor_id || '').toLowerCase();
    const rec = String(s.recipient_investor_id || '').toLowerCase();
    return mharrisIdSet.has(src) && mbeckIdSet.has(rec);
  });

  const matchingLegacyRules = data.commRules.filter(r => {
    const src = String(r.investor_id || r.source_investor_id || '').toLowerCase();
    const rec = String(r.recipient_id || r.recipient_investor_id || '').toLowerCase();
    return mharrisIdSet.has(src) && mbeckIdSet.has(rec);
  });

  console.log(`\n  Commission Shares (commission_shares table):`);
  for (const s of matchingShares) {
    console.log(`    Rule ID: ${s.id}`);
    console.log(`    Source: ${s.source_investor_id}`);
    console.log(`    Recipient: ${s.recipient_investor_id}`);
    console.log(`    Percentage: ${s.commission_percent}%`);
    console.log(`    Effective Start: ${s.effective_start_date}`);
    console.log(`    Effective End: ${s.effective_end_date || 'NULL (open)'}`);
    console.log(`    Status: ${s.status}`);
    console.log('');

    results.rules.push({
      table: 'commission_shares',
      ruleId: s.id,
      sourceId: s.source_investor_id,
      recipientId: s.recipient_investor_id,
      percentage: toNum(s.commission_percent),
      effectiveStart: s.effective_start_date,
      effectiveEnd: s.effective_end_date,
      status: s.status
    });
  }

  if (matchingLegacyRules.length > 0) {
    console.log(`  Legacy Rules (commission_rules table):`);
    for (const r of matchingLegacyRules) {
      console.log(`    Rule ID: ${r.id}`);
      console.log(`    Source: ${r.investor_id}`);
      console.log(`    Recipient: ${r.recipient_id}`);
      console.log(`    Percentage: ${r.percent}%`);
      results.rules.push({
        table: 'commission_rules',
        ruleId: r.id,
        sourceId: r.investor_id,
        recipientId: r.recipient_id,
        percentage: toNum(r.percent),
        effectiveStart: null,
        effectiveEnd: null,
        status: 'active (legacy)'
      });
    }
  }

  // Commission percent semantics
  console.log(`\n  COMMISSION PERCENT SEMANTICS ANALYSIS:`);
  console.log(`    commission_shares.commission_percent is used in commission-engine.js as:`);
  console.log(`    recipientAmount = roundMoney(grossFundResult × commissionPercent / 100)`);
  console.log(`    where grossFundResult = eligibleCapital × fundReturnPct / 100`);
  console.log(`    Therefore: 5% means 5% of the SOURCE INVESTOR'S GROSS PROFIT for the month.`);
  console.log(`    It is NOT 5% of balance, NOT 5 percentage points of any pool.`);

  // Trace the displayed source balance
  console.log(`\n  SOURCE BALANCE TRACE:`);
  
  // Replicate dashboard.js logic for sourceBalance
  const mharrisAccounts = data.accounts.filter(a => 
    mharrisIdSet.has(String(a.investor_id || '').toLowerCase())
  );
  
  console.log(`    Mary Jo Harris accounts: ${mharrisAccounts.length}`);
  for (const acc of mharrisAccounts) {
    console.log(`      Account: ${acc.id}, name="${acc.name}", starting_capital=$${toNum(acc.starting_capital).toFixed(2)}, is_commission=${acc.is_commission}, status=${acc.status}`);
  }

  // Find latest month of commission earnings for mbeck to determine displayCommMonthIdx
  const mbeckEarnings = data.commEarnings.filter(e => 
    mbeckIdSet.has(String(e.recipient_id || '').toLowerCase()) && toNum(e.year) === YEAR
  );
  
  let latestCommMonth = 0;
  for (const e of mbeckEarnings) {
    const m = toNum(e.month_number);
    if (m > latestCommMonth) latestCommMonth = m;
  }

  // Find latest published fund return month
  let latestFundReturnMonth = 0;
  for (const r of data.monthlyReturns) {
    if (toNum(r.year) === YEAR && toNum(r.gross_return_pct) !== 0) {
      const m = toNum(r.month_number);
      if (m > latestFundReturnMonth) latestFundReturnMonth = m;
    }
  }

  const displayCommMonthIdx = latestFundReturnMonth > 0 
    ? Math.min(latestCommMonth > 0 ? latestCommMonth : latestFundReturnMonth, latestFundReturnMonth)
    : getFundAccountingDate().monthNumber;

  console.log(`\n    displayCommMonthIdx (month used for commission detail): ${displayCommMonthIdx}`);

  // Replicate the sourceBalance calculation from dashboard.js:521-535
  let dashboardSourceBalance = 0;
  for (const acc of mharrisAccounts) {
    const accIdSet = new Set([
      ...mharrisIdSet,
      String(acc.id || '').toLowerCase()
    ].filter(Boolean));

    const srcHistRows = data.history.filter(h => {
      const hInvId = String(h.investor_id || '').toLowerCase();
      return mharrisIdSet.has(hInvId) &&
        toNum(h.year) === YEAR &&
        toNum(h.month_number) <= displayCommMonthIdx;
    }).sort((a, b) => toNum(b.month_number) - toNum(a.month_number));

    const srcHist = srcHistRows[0];

    if (srcHist && toNum(srcHist.ending_balance) > 0) {
      dashboardSourceBalance += toNum(srcHist.ending_balance);
      console.log(`    Found history row: month=${srcHist.month_number}, ending_balance=$${toNum(srcHist.ending_balance).toFixed(2)}`);
    } else {
      dashboardSourceBalance += toNum(acc.starting_capital);
      console.log(`    No history, using starting_capital=$${toNum(acc.starting_capital).toFixed(2)}`);
    }
    // CRITICAL: Dashboard loops over each account and adds. 
    // But the history filter uses mharrisIdSet (investor ID), not account ID.
    // So if there are multiple accounts, the SAME history row may be counted multiple times!
    break; // Only count once since history is per investor, not per account - this is what dashboard SHOULD do
  }

  // Actually re-run the EXACT dashboard logic (which loops accounts and may double-count)
  let dashboardSourceBalanceExact = 0;
  const mharrisIdSetForLookup = new Set([
    mharris.id,
    mharris.portal_username
  ].filter(Boolean).map(s => String(s).trim().toLowerCase()));

  for (const acc of mharrisAccounts) {
    const srcHistRows = data.history.filter(h => {
      const hInvId = String(h.investor_id || '').toLowerCase();
      return mharrisIdSetForLookup.has(hInvId) &&
        toNum(h.year) === YEAR &&
        toNum(h.month_number) <= displayCommMonthIdx;
    }).sort((a, b) => toNum(b.month_number) - toNum(a.month_number));

    const srcHist = srcHistRows[0];

    if (srcHist && toNum(srcHist.ending_balance) > 0) {
      dashboardSourceBalanceExact += toNum(srcHist.ending_balance);
    } else {
      dashboardSourceBalanceExact += toNum(acc.starting_capital);
    }
  }

  console.log(`\n    Dashboard sourceBalance (exact replication): $${dashboardSourceBalanceExact.toFixed(2)}`);
  console.log(`    Josh screenshot displayed: $1,042,087.23`);
  console.log(`    Josh stated approximate balance: ~$1,001,338`);

  // Independently calculate Mary Jo's balance
  // Get all history rows for Mary Jo
  const mharrisHistory = data.history.filter(h => 
    mharrisIdSetForLookup.has(String(h.investor_id || '').toLowerCase()) &&
    toNum(h.year) === YEAR
  ).sort((a, b) => toNum(a.month_number) - toNum(b.month_number));

  console.log(`\n    Mary Jo Harris monthly history (${YEAR}):`);
  for (const h of mharrisHistory) {
    console.log(`      Month ${h.month_number}: open=$${toNum(h.opening_balance).toFixed(2)}, deps=$${toNum(h.deposits).toFixed(2)}, wds=$${toNum(h.withdrawals).toFixed(2)}, gross=${toNum(h.gross_return_pct)}%, end=$${toNum(h.ending_balance).toFixed(2)}, is_manual=${h.is_manual}`);
  }

  // Find the latest history row at or before displayCommMonthIdx
  const latestHistRow = mharrisHistory.filter(h => toNum(h.month_number) <= displayCommMonthIdx)
    .sort((a, b) => toNum(b.month_number) - toNum(a.month_number))[0];
  
  const independentBalance = latestHistRow ? toNum(latestHistRow.ending_balance) : 0;
  const independentMonth = latestHistRow ? toNum(latestHistRow.month_number) : 0;

  console.log(`\n    Independent calculation (month ${independentMonth} ending): $${independentBalance.toFixed(2)}`);

  results.sourceBalanceTrace = {
    dashboardSourceBalance: dashboardSourceBalanceExact,
    joshScreenshotValue: 1042087.23,
    joshApproximateBalance: 1001338,
    independentSameStageBalance: independentBalance,
    independentMonth: independentMonth,
    accountCount: mharrisAccounts.length,
    displayCommMonthIdx: displayCommMonthIdx,
    varianceDisplayVsCalculated: dashboardSourceBalanceExact - independentBalance,
    varianceDisplayVsJoshScreenshot: dashboardSourceBalanceExact - 1042087.23,
    varianceDisplayVsJoshApprox: dashboardSourceBalanceExact - 1001338,
    varianceJoshScreenshotVsJoshApprox: 1042087.23 - 1001338
  };

  console.log(`\n  VARIANCE ANALYSIS:`);
  console.log(`    Displayed source balance:              $${dashboardSourceBalanceExact.toFixed(2)}`);
  console.log(`    Independently calculated same-stage:   $${independentBalance.toFixed(2)}`);
  console.log(`    Josh screenshot:                       $1,042,087.23`);
  console.log(`    Josh approximate balance:              ~$1,001,338`);
  console.log(`    Variance (display vs calculated):      $${(dashboardSourceBalanceExact - independentBalance).toFixed(2)}`);
  console.log(`    Variance (display vs Josh screenshot): $${(dashboardSourceBalanceExact - 1042087.23).toFixed(2)}`);
  console.log(`    Variance (display vs Josh approx):     $${(dashboardSourceBalanceExact - 1001338).toFixed(2)}`);

  // Check for double-counting due to multiple accounts
  if (mharrisAccounts.length > 1) {
    console.log(`\n  ⚠️  WARNING: Mary Jo Harris has ${mharrisAccounts.length} accounts.`);
    console.log(`     The dashboard code loops over accounts and sums sourceBalance.`);
    console.log(`     But history rows are filtered by investor_id, not account_id.`);
    console.log(`     This means the SAME history ending_balance is counted ${mharrisAccounts.length} times!`);
    console.log(`     Single-account balance: $${independentBalance.toFixed(2)}`);
    console.log(`     Multi-account sum (what dashboard shows): $${dashboardSourceBalanceExact.toFixed(2)}`);
    
    results.sourceBalanceTrace.doubleCountDetected = true;
    results.sourceBalanceTrace.accountCountCausingInflation = mharrisAccounts.length;
  }

  return results;
}

// ============================================================================
// PART 3: COMMISSION ENGINE BASIS VS DISPLAY
// ============================================================================

function auditCommissionBasis(data, invMaps, part2Results) {
  console.log('\n========================================');
  console.log('  PART 3: COMMISSION BASIS vs DISPLAY');
  console.log('========================================\n');

  const results = {
    monthlyAnalysis: [],
    classification: ''
  };

  if (!part2Results.michaelBeck || !part2Results.maryJoHarris) {
    console.log('  SKIPPED: Missing Michael Beck or Mary Jo Harris data from Part 2');
    return results;
  }

  const mbeckId = part2Results.michaelBeck.id;
  const mharrisId = part2Results.maryJoHarris.id;
  const mharrisSplit = part2Results.maryJoHarris.splitPct;
  const mharrisIdSet = new Set([mharrisId, part2Results.maryJoHarris.username].filter(Boolean).map(s => s.toLowerCase()));

  // Get all fund monthly returns
  const fundReturns = {};
  for (const r of data.monthlyReturns) {
    if (toNum(r.year) === YEAR) {
      fundReturns[toNum(r.month_number)] = toNum(r.gross_return_pct);
    }
  }

  // Get Mary Jo history
  const mharrisHistory = data.history.filter(h =>
    mharrisIdSet.has(String(h.investor_id || '').toLowerCase()) && toNum(h.year) === YEAR
  ).sort((a, b) => toNum(a.month_number) - toNum(b.month_number));

  // Get actual commission earnings for this pair
  const actualEarnings = data.commEarnings.filter(e =>
    String(e.recipient_id || '').toLowerCase() === mbeckId.toLowerCase() &&
    mharrisIdSet.has(String(e.source_investor_id || '').toLowerCase()) &&
    toNum(e.year) === YEAR
  );

  console.log(`  Actual commission_earnings rows for MaryJo→MBeck (${YEAR}):`);
  for (const e of actualEarnings) {
    console.log(`    Month ${e.month_number}: $${toNum(e.amount).toFixed(2)} (status: ${e.status})`);
  }

  // Get the rule percentage
  const rulePct = part2Results.rules.length > 0 ? part2Results.rules[0].percentage : 5;
  console.log(`\n  Rule percentage: ${rulePct}% of gross profit`);

  // For each month, calculate expected vs actual
  console.log('\n  MONTH-BY-MONTH VERIFICATION:');
  console.log('  ' + '-'.repeat(120));
  console.log(`  ${'Month'.padEnd(8)} ${'EligCap'.padStart(14)} ${'GrossRet%'.padStart(10)} ${'GrossProfit'.padStart(14)} ${'SplitPct'.padStart(9)} ${'CommPool'.padStart(14)} ${'Rule%'.padStart(6)} ${'Expected'.padStart(12)} ${'Actual'.padStart(12)} ${'Diff'.padStart(12)}`);
  console.log('  ' + '-'.repeat(120));

  let totalExpected = 0;
  let totalActual = 0;

  for (let month = 1; month <= 12; month++) {
    const histRow = mharrisHistory.find(h => toNum(h.month_number) === month);
    if (!histRow) continue;

    const grossReturnPct = fundReturns[month] || 0;
    if (grossReturnPct <= 0) continue; // No commission in loss/zero months

    const openingBalance = toNum(histRow.opening_balance);
    const deps = toNum(histRow.deposits);
    const wds = toNum(histRow.withdrawals);
    const eligibleCapital = openingBalance + deps - wds;
    
    const grossProfit = roundMoney(toDec(eligibleCapital).mul(grossReturnPct).div(100)).toNumber();
    const investorSplitPct = mharrisSplit;
    const sourceGainLoss = grossProfit; // The full gross result
    
    const expectedCommission = roundMoney(toDec(grossProfit).mul(rulePct).div(100)).toNumber();
    
    const actualEarning = actualEarnings.find(e => toNum(e.month_number) === month);
    const actualAmount = actualEarning ? toNum(actualEarning.amount) : 0;
    const diff = actualAmount - expectedCommission;

    totalExpected += expectedCommission;
    totalActual += actualAmount;

    console.log(`  ${String(month).padEnd(8)} $${eligibleCapital.toFixed(2).padStart(13)} ${grossReturnPct.toFixed(2).padStart(9)}% $${grossProfit.toFixed(2).padStart(13)} ${investorSplitPct.toFixed(0).padStart(8)}% $${grossProfit.toFixed(2).padStart(13)} ${rulePct.toFixed(1).padStart(5)}% $${expectedCommission.toFixed(2).padStart(11)} $${actualAmount.toFixed(2).padStart(11)} $${diff.toFixed(2).padStart(11)}`);

    results.monthlyAnalysis.push({
      month,
      eligibleCapital,
      grossReturnPct,
      grossProfit,
      investorSplitPct,
      commissionPool: grossProfit,
      rulePct,
      expectedCommission,
      actualCommission: actualAmount,
      difference: diff
    });
  }

  console.log('  ' + '-'.repeat(120));
  console.log(`  ${'TOTAL'.padEnd(8)} ${''.padStart(14)} ${''.padStart(10)} ${''.padStart(14)} ${''.padStart(9)} ${''.padStart(14)} ${''.padStart(6)} $${totalExpected.toFixed(2).padStart(11)} $${totalActual.toFixed(2).padStart(11)} $${(totalActual - totalExpected).toFixed(2).padStart(11)}`);

  // Classification
  const displayedBalance = part2Results.sourceBalanceTrace.dashboardSourceBalance;
  const actualBalance = part2Results.sourceBalanceTrace.independentSameStageBalance;
  const balanceDiscrepancy = Math.abs(displayedBalance - actualBalance);
  const commissionDiscrepancy = Math.abs(totalActual - totalExpected);

  if (balanceDiscrepancy > 0.01 && commissionDiscrepancy > 0.01) {
    results.classification = 'SOURCE_BALANCE_DEFECT_WITH_COMMISSION_IMPACT';
  } else if (balanceDiscrepancy > 0.01 && commissionDiscrepancy <= 0.01) {
    results.classification = 'SOURCE_BALANCE_DEFECT_NO_COMMISSION_IMPACT';
  } else if (commissionDiscrepancy > 0.01) {
    results.classification = 'COMMISSION_BASIS_DEFECT';
  } else {
    results.classification = 'DISPLAY_ONLY_DEFECT';
  }

  console.log(`\n  CLASSIFICATION: ${results.classification}`);
  console.log(`  Balance discrepancy (display vs calculated): $${balanceDiscrepancy.toFixed(2)}`);
  console.log(`  Commission discrepancy (actual vs expected): $${commissionDiscrepancy.toFixed(2)}`);

  if (results.classification === 'DISPLAY_ONLY_DEFECT' || results.classification === 'SOURCE_BALANCE_DEFECT_NO_COMMISSION_IMPACT') {
    console.log(`\n  The displayed source balance is WRONG but the commission engine calculates`);
    console.log(`  from eligible capital in investor_monthly_history, NOT from the displayed balance.`);
    console.log(`  Therefore the commission_earnings amounts are CORRECT even though the UI shows a wrong balance.`);
  }

  return results;
}

// ============================================================================
// PART 4: JOSH OVIATT → MICHAEL BECK MISSING SOURCE
// ============================================================================

function auditJoshOviattMissing(data, invMaps) {
  console.log('\n========================================');
  console.log('  PART 4: JOSH OVIATT → MICHAEL BECK');
  console.log('========================================\n');

  const results = {
    joshOviatt: null,
    michaelBeck: null,
    ruleFound: false,
    ruleDetails: null,
    diagnostics: [],
    classification: ''
  };

  // Find Josh Oviatt
  const joshOviatt = data.investors.find(i => {
    const name = `${i.first_name || ''} ${i.last_name || ''}`.toLowerCase();
    const uname = String(i.portal_username || '').toLowerCase();
    return (name.includes('josh') && name.includes('oviatt')) || uname === 'joviatt' || uname.includes('oviatt');
  });

  const mbeck = invMaps.byUsername.get('mbeck') || invMaps.byAnyKey.get('mbeck');

  if (!joshOviatt) {
    console.log('  ERROR: Cannot find Josh Oviatt');
    results.error = 'JOSH_OVIATT_NOT_FOUND';
    // List all investors for debugging
    console.log('  Searching for possible matches...');
    for (const inv of data.investors) {
      const name = `${inv.first_name || ''} ${inv.last_name || ''}`.toLowerCase();
      if (name.includes('josh') || name.includes('oviatt')) {
        console.log(`    Possible match: id=${inv.id}, username=${inv.portal_username}, name=${inv.first_name} ${inv.last_name}`);
      }
    }
    return results;
  }
  if (!mbeck) {
    console.log('  ERROR: Cannot find Michael Beck (mbeck)');
    results.error = 'MBECK_NOT_FOUND';
    return results;
  }

  results.joshOviatt = {
    id: joshOviatt.id,
    username: joshOviatt.portal_username,
    name: getInvestorName(joshOviatt)
  };
  results.michaelBeck = {
    id: mbeck.id,
    username: mbeck.portal_username,
    name: getInvestorName(mbeck)
  };

  console.log(`  Josh Oviatt: id=${joshOviatt.id}, username=${joshOviatt.portal_username}`);
  console.log(`  Michael Beck: id=${mbeck.id}, username=${mbeck.portal_username}`);

  const joIdSet = getIdSet(joshOviatt);
  const mbIdSet = getIdSet(mbeck);

  // Search commission_shares for rules
  const matchingShares = data.commShares.filter(s => {
    const src = String(s.source_investor_id || '').toLowerCase();
    const rec = String(s.recipient_investor_id || '').toLowerCase();
    return joIdSet.has(src) && mbIdSet.has(rec);
  });

  console.log(`\n  Commission Shares matching Josh→Michael: ${matchingShares.length}`);
  for (const s of matchingShares) {
    console.log(`    Rule: ${s.id}`);
    console.log(`      source_investor_id: "${s.source_investor_id}"`);
    console.log(`      recipient_investor_id: "${s.recipient_investor_id}"`);
    console.log(`      commission_percent: ${s.commission_percent}%`);
    console.log(`      effective_start_date: ${s.effective_start_date}`);
    console.log(`      effective_end_date: ${s.effective_end_date || 'NULL'}`);
    console.log(`      status: ${s.status}`);
    results.ruleFound = true;
    results.ruleDetails = s;
  }

  // Also check legacy rules
  const matchingLegacy = data.commRules.filter(r => {
    const src = String(r.investor_id || r.source_investor_id || '').toLowerCase();
    const rec = String(r.recipient_id || r.recipient_investor_id || '').toLowerCase();
    return joIdSet.has(src) && mbIdSet.has(rec);
  });

  console.log(`  Legacy commission_rules matching: ${matchingLegacy.length}`);
  for (const r of matchingLegacy) {
    console.log(`    Legacy Rule: ${r.id}, source=${r.investor_id}, recipient=${r.recipient_id}, pct=${r.percent}%`);
    if (!results.ruleFound) {
      results.ruleFound = true;
      results.ruleDetails = r;
    }
  }

  // Check ALL commission_shares where Josh is source (regardless of recipient)
  const allJoshSourceShares = data.commShares.filter(s => 
    joIdSet.has(String(s.source_investor_id || '').toLowerCase())
  );
  console.log(`\n  All commission_shares where Josh Oviatt is source: ${allJoshSourceShares.length}`);
  for (const s of allJoshSourceShares) {
    const recInv = invMaps.byId.get(String(s.recipient_investor_id || '').toLowerCase());
    console.log(`    → ${s.recipient_investor_id} (${recInv ? getInvestorName(recInv) : 'UNKNOWN'}): ${s.commission_percent}% [${s.status}] start=${s.effective_start_date}`);
  }

  // Check ALL commission_shares where Michael Beck is recipient
  const allMbeckRecipientShares = data.commShares.filter(s =>
    mbIdSet.has(String(s.recipient_investor_id || '').toLowerCase())
  );
  console.log(`\n  All commission_shares where Michael Beck is recipient: ${allMbeckRecipientShares.length}`);
  for (const s of allMbeckRecipientShares) {
    const srcInv = invMaps.byId.get(String(s.source_investor_id || '').toLowerCase());
    console.log(`    ← ${s.source_investor_id} (${srcInv ? getInvestorName(srcInv) : 'UNKNOWN'}): ${s.commission_percent}% [${s.status}] start=${s.effective_start_date}`);
  }

  // Check commission_earnings for Josh→Michael
  const actualEarnings = data.commEarnings.filter(e =>
    String(e.recipient_id || '').toLowerCase() === mbeck.id.toLowerCase() &&
    joIdSet.has(String(e.source_investor_id || '').toLowerCase()) &&
    toNum(e.year) === YEAR
  );
  console.log(`\n  Commission earnings for Josh→Michael in ${YEAR}: ${actualEarnings.length}`);
  for (const e of actualEarnings) {
    console.log(`    Month ${e.month_number}: $${toNum(e.amount).toFixed(2)}`);
  }

  // DIAGNOSTIC: Trace why it might not appear in Michael's commission detail
  // The dashboard.js at L482-549 groups by source_investor_id from commission_earnings
  // If no earnings exist, the fallback at L553-631 uses getApplicableCommissionShares
  // filtered by recipientIdSet = mbeckIdSet

  console.log(`\n  DIAGNOSTIC TRACE:`);

  // Check if Michael has ANY earnings
  const allMbeckEarnings = data.commEarnings.filter(e =>
    String(e.recipient_id || '').toLowerCase() === mbeck.id.toLowerCase() &&
    toNum(e.year) === YEAR
  );
  console.log(`    Michael Beck total commission_earnings rows (${YEAR}): ${allMbeckEarnings.length}`);

  if (allMbeckEarnings.length > 0) {
    // Primary path is used (groups by source_investor_id from earnings)
    // Check if Josh appears in any earnings
    const joshInEarnings = allMbeckEarnings.filter(e =>
      joIdSet.has(String(e.source_investor_id || '').toLowerCase())
    );
    console.log(`    Josh Oviatt in Michael's earnings: ${joshInEarnings.length}`);
    
    if (joshInEarnings.length === 0) {
      console.log(`    ⚠️  Josh Oviatt has a commission rule but NO commission_earnings rows.`);
      console.log(`       The dashboard PRIMARY path (L482-549) groups by source_investor_id from earnings.`);
      console.log(`       Since Josh has no earnings, he is never grouped and never displayed.`);
      console.log(`       The FALLBACK path (L553-631) is only used when myEarnings.length === 0.`);
      console.log(`       Since Michael HAS earnings from OTHER sources, the fallback path is NEVER reached.`);
      console.log(`       This is the ROOT CAUSE: the primary path only shows sources with existing earnings.`);
      console.log(`       Sources with rules but no earnings are invisible.`);
      
      results.diagnostics.push('PRIMARY_PATH_EXCLUDES_SOURCES_WITHOUT_EARNINGS');
      results.diagnostics.push('FALLBACK_PATH_NOT_REACHED_DUE_TO_OTHER_EARNINGS');
    }
  } else {
    console.log(`    Michael Beck has NO earnings. Fallback path would be used.`);
    console.log(`    In fallback, getApplicableCommissionShares would find Josh's rule.`);
  }

  // Check for ID mismatches
  if (results.ruleFound && results.ruleDetails) {
    const ruleSourceId = String(results.ruleDetails.source_investor_id || results.ruleDetails.investor_id || '');
    const ruleRecipientId = String(results.ruleDetails.recipient_investor_id || results.ruleDetails.recipient_id || '');
    
    console.log(`\n  ID MISMATCH CHECK:`);
    console.log(`    Rule source_investor_id: "${ruleSourceId}"`);
    console.log(`    Josh Oviatt canonical id: "${joshOviatt.id}"`);
    console.log(`    Match: ${ruleSourceId.toLowerCase() === joshOviatt.id.toLowerCase()}`);
    console.log(`    Rule recipient_investor_id: "${ruleRecipientId}"`);
    console.log(`    Michael Beck canonical id: "${mbeck.id}"`);
    console.log(`    Match: ${ruleRecipientId.toLowerCase() === mbeck.id.toLowerCase()}`);
  }

  // Classification
  if (!results.ruleFound) {
    results.classification = 'RULE_NOT_FOUND';
    console.log(`\n  CLASSIFICATION: RULE_NOT_FOUND`);
    console.log(`  No commission_shares or commission_rules row exists for Josh Oviatt → Michael Beck.`);
  } else if (actualEarnings.length === 0 && allMbeckEarnings.length > 0) {
    results.classification = 'MISSING_FROM_DETAIL_UI_AND_MISSING_EARNINGS';
    console.log(`\n  CLASSIFICATION: MISSING_FROM_DETAIL_UI_AND_MISSING_EARNINGS`);
    console.log(`  Rule exists, but no commission_earnings have been generated.`);
    console.log(`  The dashboard primary path only shows sources with existing earnings.`);
    console.log(`  Michael IS missing actual Josh Oviatt commissions, not just the display.`);
  } else {
    results.classification = 'DISPLAY_ONLY_MISSING';
  }

  return results;
}

// ============================================================================
// PART 5: PLATFORM-WIDE COMMISSION RULE INTEGRITY SWEEP
// ============================================================================

function auditPlatformCommissionIntegrity(data, invMaps) {
  console.log('\n========================================');
  console.log('  PART 5: PLATFORM-WIDE COMMISSION INTEGRITY');
  console.log('========================================\n');

  const results = {
    totalActiveRules: 0,
    flags: [],
    summary: {}
  };

  const { monthNumber: currentMonth } = getFundAccountingDate();

  // Get latest published fund return month
  let latestFundMonth = 0;
  for (const r of data.monthlyReturns) {
    if (toNum(r.year) === YEAR && toNum(r.gross_return_pct) !== 0) {
      const m = toNum(r.month_number);
      if (m > latestFundMonth) latestFundMonth = m;
    }
  }

  const activeRules = data.commShares.filter(s => 
    String(s.status || '').toLowerCase() !== 'cancelled'
  );
  results.totalActiveRules = activeRules.length;
  console.log(`  Total non-cancelled commission_shares rules: ${activeRules.length}`);

  let unresolvedSource = 0;
  let unresolvedRecipient = 0;
  let missingFromDetailUI = 0;
  let missingEarnings = 0;
  let duplicateEarnings = 0;
  let incorrectAmounts = 0;
  let staleBalance = 0;
  let effectiveDateConflict = 0;

  for (const rule of activeRules) {
    const srcId = String(rule.source_investor_id || '').toLowerCase();
    const recId = String(rule.recipient_investor_id || '').toLowerCase();
    const srcInv = invMaps.byId.get(srcId) || invMaps.byAnyKey.get(srcId);
    const recInv = invMaps.byId.get(recId) || invMaps.byAnyKey.get(recId);

    const ruleFlags = [];

    // Check source resolves
    if (!srcInv) {
      ruleFlags.push('UNRESOLVED_SOURCE_ID');
      unresolvedSource++;
    }

    // Check recipient resolves
    if (!recInv) {
      ruleFlags.push('UNRESOLVED_RECIPIENT_ID');
      unresolvedRecipient++;
    }

    // Check effective date validity
    const startDate = rule.effective_start_date;
    const endDate = rule.effective_end_date;
    if (endDate && startDate > endDate) {
      ruleFlags.push('RULE_EFFECTIVE_DATE_CONFLICT');
      effectiveDateConflict++;
    }

    // Check for commission_earnings existence for applicable months
    if (srcInv && recInv) {
      for (let month = 1; month <= latestFundMonth; month++) {
        const periodStart = `${YEAR}-${String(month).padStart(2, '0')}-01`;
        const lastDay = new Date(Date.UTC(YEAR, month, 0)).getUTCDate();
        const periodEnd = `${YEAR}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

        const ruleStart = String(startDate || '2000-01-01');
        const ruleEnd = endDate ? String(endDate) : null;

        // Check if rule is applicable for this month
        if (ruleStart > periodEnd) continue;
        if (ruleEnd !== null && ruleEnd < periodStart) continue;

        // Get fund return
        const fundReturn = data.monthlyReturns.find(r => 
          toNum(r.year) === YEAR && toNum(r.month_number) === month
        );
        const grossReturnPct = fundReturn ? toNum(fundReturn.gross_return_pct) : 0;
        
        if (grossReturnPct <= 0) continue; // No commission in loss/zero months

        // Check for earnings
        const earnings = data.commEarnings.filter(e =>
          String(e.source_investor_id || '').toLowerCase() === srcId &&
          String(e.recipient_id || '').toLowerCase() === recId &&
          toNum(e.year) === YEAR &&
          toNum(e.month_number) === month
        );

        if (earnings.length === 0) {
          ruleFlags.push(`MISSING_COMMISSION_EARNING_M${month}`);
          missingEarnings++;
        } else if (earnings.length > 1) {
          ruleFlags.push(`DUPLICATE_COMMISSION_EARNING_M${month}`);
          duplicateEarnings++;
        }
      }

      // Check if recipient has other earnings that would cause this source to be hidden
      const recIdSet = getIdSet(recInv);
      const allRecEarnings = data.commEarnings.filter(e =>
        recIdSet.has(String(e.recipient_id || '').toLowerCase()) && toNum(e.year) === YEAR
      );
      const srcEarnings = allRecEarnings.filter(e =>
        srcId === String(e.source_investor_id || '').toLowerCase()
      );

      if (allRecEarnings.length > 0 && srcEarnings.length === 0) {
        ruleFlags.push('MISSING_FROM_DETAIL_UI');
        missingFromDetailUI++;
      }
    }

    if (ruleFlags.length > 0) {
      results.flags.push({
        ruleId: rule.id,
        sourceId: rule.source_investor_id,
        sourceName: srcInv ? getInvestorName(srcInv) : 'UNRESOLVED',
        recipientId: rule.recipient_investor_id,
        recipientName: recInv ? getInvestorName(recInv) : 'UNRESOLVED',
        percentage: toNum(rule.commission_percent),
        status: rule.status,
        effectiveStart: rule.effective_start_date,
        effectiveEnd: rule.effective_end_date,
        flags: ruleFlags
      });
    }
  }

  results.summary = {
    totalActiveRules: activeRules.length,
    unresolvedSourceIds: unresolvedSource,
    unresolvedRecipientIds: unresolvedRecipient,
    missingFromDetailUI,
    missingEarnings,
    duplicateEarnings,
    incorrectAmounts,
    staleSourceBalance: staleBalance,
    effectiveDateConflicts: effectiveDateConflict,
    totalFlaggedRules: results.flags.length
  };

  console.log(`  SUMMARY:`);
  console.log(`    Total active rules: ${activeRules.length}`);
  console.log(`    Unresolved source IDs: ${unresolvedSource}`);
  console.log(`    Unresolved recipient IDs: ${unresolvedRecipient}`);
  console.log(`    Missing from detail UI: ${missingFromDetailUI}`);
  console.log(`    Missing commission earnings: ${missingEarnings}`);
  console.log(`    Duplicate commission earnings: ${duplicateEarnings}`);
  console.log(`    Effective date conflicts: ${effectiveDateConflict}`);
  console.log(`    Total flagged rules: ${results.flags.length}`);

  if (results.flags.length > 0) {
    console.log(`\n  FLAGGED RULES:`);
    for (const f of results.flags) {
      console.log(`    Rule ${f.ruleId}: ${f.sourceName} → ${f.recipientName} (${f.percentage}%) [${f.flags.join(', ')}]`);
    }
  }

  return results;
}

// ============================================================================
// PART 6: SOURCE BALANCE INTEGRITY SWEEP
// ============================================================================

function auditSourceBalanceIntegrity(data, invMaps) {
  console.log('\n========================================');
  console.log('  PART 6: SOURCE BALANCE INTEGRITY');
  console.log('========================================\n');

  const results = {
    balanceComparisons: [],
    priorityInvestors: []
  };

  const { monthNumber: currentMonth } = getFundAccountingDate();

  // Get latest fund return month for displayCommMonthIdx baseline
  let latestFundMonth = 0;
  for (const r of data.monthlyReturns) {
    if (toNum(r.year) === YEAR && toNum(r.gross_return_pct) !== 0) {
      const m = toNum(r.month_number);
      if (m > latestFundMonth) latestFundMonth = m;
    }
  }

  // Get unique source investor IDs from all active commission rules
  const sourceIds = new Set();
  for (const s of data.commShares) {
    if (String(s.status || '').toLowerCase() !== 'cancelled') {
      sourceIds.add(String(s.source_investor_id || '').toLowerCase());
    }
  }

  const priorityNames = ['mary jo harris', 'mharris', 'walt jarvis', 'wjarvis', 'beth beck', 'bbeck', 
                          'josh oviatt', 'joviatt', 'steve kimbell', 'steve kimball', 'skimbell', 'skimball'];

  for (const srcIdLower of sourceIds) {
    const srcInv = invMaps.byId.get(srcIdLower) || invMaps.byAnyKey.get(srcIdLower);
    if (!srcInv) continue;

    const srcName = getInvestorName(srcInv);
    const srcIdSet = getIdSet(srcInv);

    // Get accounts for this investor
    const srcAccounts = data.accounts.filter(a =>
      srcIdSet.has(String(a.investor_id || '').toLowerCase())
    );

    // Replicate dashboard sourceBalance calculation
    let dashboardBalance = 0;
    for (const acc of srcAccounts) {
      const srcHistRows = data.history.filter(h => {
        const hInvId = String(h.investor_id || '').toLowerCase();
        return srcIdSet.has(hInvId) &&
          toNum(h.year) === YEAR &&
          toNum(h.month_number) <= latestFundMonth;
      }).sort((a, b) => toNum(b.month_number) - toNum(a.month_number));

      const srcHist = srcHistRows[0];
      if (srcHist && toNum(srcHist.ending_balance) > 0) {
        dashboardBalance += toNum(srcHist.ending_balance);
      } else {
        dashboardBalance += toNum(acc.starting_capital);
      }
    }

    // Get canonical balance (latest history ending_balance, single count)
    const latestHistory = data.history.filter(h =>
      srcIdSet.has(String(h.investor_id || '').toLowerCase()) &&
      toNum(h.year) === YEAR &&
      toNum(h.month_number) <= latestFundMonth
    ).sort((a, b) => toNum(b.month_number) - toNum(a.month_number))[0];

    const canonicalBalance = latestHistory ? toNum(latestHistory.ending_balance) : 0;
    const variance = dashboardBalance - canonicalBalance;
    const historyMonth = latestHistory ? toNum(latestHistory.month_number) : 0;

    const isPriority = priorityNames.some(n => 
      srcName.toLowerCase().includes(n) || 
      String(srcInv.portal_username || '').toLowerCase().includes(n)
    );

    const entry = {
      investorId: srcInv.id,
      username: srcInv.portal_username,
      name: srcName,
      accountCount: srcAccounts.length,
      dashboardBalance,
      canonicalBalance,
      historyMonth,
      variance,
      isPriority,
      balanceSource: latestHistory ? 'investor_monthly_history.ending_balance' : 'investor_accounts.starting_capital',
      defect: Math.abs(variance) > 0.01 ? 'STALE_SOURCE_BALANCE_DISPLAY' : 'OK'
    };

    if (Math.abs(variance) > 0.01 || isPriority) {
      results.balanceComparisons.push(entry);
    }

    if (isPriority) {
      results.priorityInvestors.push(entry);
    }
  }

  // Sort by absolute variance descending
  results.balanceComparisons.sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance));

  console.log(`  SOURCE BALANCE COMPARISONS (variances > $0.01 or priority investors):`);
  console.log('  ' + '-'.repeat(110));
  console.log(`  ${'Investor'.padEnd(25)} ${'Accts'.padStart(5)} ${'Dashboard Balance'.padStart(18)} ${'Canonical Balance'.padStart(18)} ${'Variance'.padStart(14)} ${'Source'.padEnd(20)} ${'Status'.padEnd(10)}`);
  console.log('  ' + '-'.repeat(110));

  for (const entry of results.balanceComparisons) {
    const flag = entry.isPriority ? '⚠️' : '  ';
    console.log(`${flag}${entry.name.padEnd(25)} ${String(entry.accountCount).padStart(5)} $${entry.dashboardBalance.toFixed(2).padStart(17)} $${entry.canonicalBalance.toFixed(2).padStart(17)} $${entry.variance.toFixed(2).padStart(13)} ${entry.balanceSource.padEnd(20).slice(0, 20)} ${entry.defect}`);
  }

  console.log('  ' + '-'.repeat(110));

  // Determine what the commission-detail UI uses
  console.log(`\n  COMMISSION-DETAIL UI BALANCE SOURCE DETERMINATION:`);
  console.log(`    The commission-detail in dashboard.js uses:`);
  console.log(`    1. Loops over source investor's accounts`);
  console.log(`    2. For each account, finds latest investor_monthly_history.ending_balance where month_number <= displayMonth`);
  console.log(`    3. Falls back to investor_accounts.starting_capital if no history`);
  console.log(`    4. SUMS across all accounts`);
  console.log(`    ⚠️  CRITICAL BUG: History is filtered by investor_id, not account_id.`);
  console.log(`       If an investor has N accounts, the SAME ending_balance is counted N times.`);
  console.log(`       This is the primary cause of inflated balances for multi-account investors.`);

  return results;
}

// ============================================================================
// PART 7: GLOBAL FINANCIAL EXPOSURE
// ============================================================================

function auditGlobalExposure(data, invMaps, part3Results, part5Results) {
  console.log('\n========================================');
  console.log('  PART 7: GLOBAL FINANCIAL EXPOSURE');
  console.log('========================================\n');

  const results = {
    displayVariances: [],
    ledgerVariances: [],
    totalOverpayment: 0,
    totalUnderpayment: 0,
    netExposure: 0,
    classification: ''
  };

  // Check Part 3 for Mary Jo → Michael
  if (part3Results.monthlyAnalysis && part3Results.monthlyAnalysis.length > 0) {
    let pairOverpayment = 0;
    let pairUnderpayment = 0;
    for (const m of part3Results.monthlyAnalysis) {
      if (m.difference > 0.01) pairOverpayment += m.difference;
      if (m.difference < -0.01) pairUnderpayment += Math.abs(m.difference);
    }
    if (Math.abs(pairOverpayment) > 0.01 || Math.abs(pairUnderpayment) > 0.01) {
      results.ledgerVariances.push({
        source: 'Mary Jo Harris',
        recipient: 'Michael Beck',
        overpayment: pairOverpayment,
        underpayment: pairUnderpayment,
        net: pairOverpayment - pairUnderpayment
      });
    }
  }

  // Aggregate from Part 5 flags (missing earnings = potential underpayment)
  if (part5Results.flags) {
    for (const f of part5Results.flags) {
      const missingMonths = f.flags.filter(fl => fl.startsWith('MISSING_COMMISSION_EARNING_M'));
      if (missingMonths.length > 0) {
        results.ledgerVariances.push({
          source: f.sourceName,
          recipient: f.recipientName,
          type: 'MISSING_EARNINGS',
          missingMonthCount: missingMonths.length,
          overpayment: 0,
          underpayment: 0, // Cannot quantify without calculating expected amounts
          net: 0,
          needsQuantification: true
        });
      }
    }
  }

  const totalOver = results.ledgerVariances.reduce((s, v) => s + (v.overpayment || 0), 0);
  const totalUnder = results.ledgerVariances.reduce((s, v) => s + (v.underpayment || 0), 0);
  results.totalOverpayment = totalOver;
  results.totalUnderpayment = totalUnder;
  results.netExposure = totalOver - totalUnder;

  console.log(`  FINANCIAL EXPOSURE SUMMARY:`);
  console.log(`    Total overpayment (proven): $${totalOver.toFixed(2)}`);
  console.log(`    Total underpayment (proven): $${totalUnder.toFixed(2)}`);
  console.log(`    Net company exposure: $${results.netExposure.toFixed(2)}`);

  if (results.ledgerVariances.length > 0) {
    console.log(`\n  LEDGER VARIANCES:`);
    for (const v of results.ledgerVariances) {
      console.log(`    ${v.source} → ${v.recipient}: over=$${(v.overpayment||0).toFixed(2)}, under=$${(v.underpayment||0).toFixed(2)}${v.needsQuantification ? ' (NEEDS QUANTIFICATION)' : ''}`);
    }
  }

  return results;
}

// ============================================================================
// PART 8: PERFORMANCE UI SWEEP
// ============================================================================

function auditPerformanceUISweep(data, invMaps) {
  console.log('\n========================================');
  console.log('  PART 8: PERFORMANCE UI SWEEP');
  console.log('========================================\n');

  const results = {
    investorSplitTypes: [],
    defectiveInvestors: 0,
    totalInvestors: 0
  };

  const activeInvestors = data.investors.filter(i => i.active !== false);
  results.totalInvestors = activeInvestors.length;

  const splitDistribution = {};
  for (const inv of activeInvestors) {
    const split = toNum(inv.split_pct, 100);
    splitDistribution[split] = (splitDistribution[split] || 0) + 1;
    
    if (split < 100) {
      results.defectiveInvestors++;
    }
  }

  console.log(`  Investor Split Distribution (active investors):`);
  for (const [split, count] of Object.entries(splitDistribution).sort((a, b) => Number(a[0]) - Number(b[0]))) {
    const affected = Number(split) < 100 ? '← AFFECTED by display defect' : '';
    console.log(`    ${split}% split: ${count} investors ${affected}`);
  }

  console.log(`\n  Total active investors: ${results.totalInvestors}`);
  console.log(`  Investors affected by dollar display defect (split < 100%): ${results.defectiveInvestors}`);
  console.log(`  Investors NOT affected (100% split): ${results.totalInvestors - results.defectiveInvestors}`);

  console.log(`\n  PROPOSED UI STRUCTURE (not yet implemented):`);
  console.log(`    Fund Performance`);
  console.log(`      - Gross percentage (current, correct)`);
  console.log(`    Account Performance (NEW section)`);
  console.log(`      - Investor net percentage = grossPct × splitPct / 100`);
  console.log(`      - Investor net dollar earnings = eligibleCapital × grossPct × splitPct / 10000`);

  return results;
}

// ============================================================================
// MAIN AUDIT EXECUTION
// ============================================================================

async function main() {
  console.log('==========================================================');
  console.log('  PLATFORM-WIDE FINANCIAL EXPOSURE AUDIT');
  console.log('  Date: 2026-08-18');
  console.log('  Protocol: READ-ONLY — ZERO PRODUCTION MUTATIONS');
  console.log('==========================================================');

  try {
    // Load all data
    const data = await loadAllData();
    const invMaps = buildInvestorMaps(data.investors);

    // Part 1: Performance Display Semantics
    const part1 = auditPerformanceSemantics(data);

    // Part 2: Michael Beck ← Mary Jo Harris
    const part2 = auditMichaelBeckMaryJo(data, invMaps);

    // Part 3: Commission Basis vs Display
    const part3 = auditCommissionBasis(data, invMaps, part2);

    // Part 4: Josh Oviatt → Michael Beck
    const part4 = auditJoshOviattMissing(data, invMaps);

    // Part 5: Platform-Wide Commission Integrity
    const part5 = auditPlatformCommissionIntegrity(data, invMaps);

    // Part 6: Source Balance Integrity
    const part6 = auditSourceBalanceIntegrity(data, invMaps);

    // Part 7: Global Financial Exposure
    const part7 = auditGlobalExposure(data, invMaps, part3, part5);

    // Part 8: Performance UI Sweep
    const part8 = auditPerformanceUISweep(data, invMaps);

    // ====================================================================
    // PART 9: CENT-EXACT VARIANCE POLICY
    // ====================================================================
    console.log('\n========================================');
    console.log('  PART 9: CENT-EXACT VARIANCE POLICY');
    console.log('========================================\n');
    console.log('  All financial comparisons use CENT_EXACT_VARIANCE ($0.01 threshold).');
    console.log('  No $25 audit tolerance has been applied.');
    console.log('  Any UI/reporting tolerance is separate from financial reconciliation.');

    // ====================================================================
    // PART 11: SAFETY GATE
    // ====================================================================
    console.log('\n========================================');
    console.log('  PART 11: SAFETY GATE');
    console.log('========================================\n');

    const hasFinancialRisk = part7.netExposure > 0.01 || 
      part5.summary.missingEarnings > 0 ||
      part3.classification === 'COMMISSION_BASIS_DEFECT' ||
      part3.classification === 'SOURCE_BALANCE_DEFECT_WITH_COMMISSION_IMPACT';

    const safetyClassification = hasFinancialRisk 
      ? 'FINANCIAL_CALCULATION_RISK_CONFIRMED' 
      : 'DISPLAY_DEFECTS_ONLY';

    console.log(`  Safety Classification: ${safetyClassification}`);
    console.log('');
    console.log('  FINAL STATUS REPORT:');
    console.log(`    Performance dollar semantics: DISPLAY_SEMANTICS_DEFECT`);
    console.log(`    Mary Jo → Michael Beck: ${part3.classification}`);
    console.log(`    Josh Oviatt → Michael Beck: ${part4.classification}`);
    console.log(`    Platform commission sweep: ${part5.summary.totalFlaggedRules} rules flagged of ${part5.summary.totalActiveRules}`);
    console.log(`    Financial exposure: $${part7.netExposure.toFixed(2)} proven, ${part5.summary.missingEarnings} missing earnings unquantified`);
    console.log(`    Production financial writes: FROZEN (this audit is read-only)`);
    console.log(`    Accounting/commission finalization recommendation: ${hasFinancialRisk ? 'HOLD PENDING REVIEW' : 'ALLOW WITH CAUTION'}`);
    console.log(`    Admin UI: ADMIN_UI_NOT_SAFE_FOR_CONTROLLED_USE`);

    // Write full results to JSON
    const auditResults = {
      timestamp: new Date().toISOString(),
      protocol: 'READ_ONLY',
      part1_performance: part1,
      part2_maryjo_mbeck: part2,
      part3_commission_basis: part3,
      part4_joviatt_mbeck: part4,
      part5_platform_integrity: part5,
      part6_source_balances: part6,
      part7_financial_exposure: part7,
      part8_performance_sweep: part8,
      safetyGate: {
        classification: safetyClassification,
        hasFinancialRisk,
        recommendation: hasFinancialRisk ? 'HOLD_PENDING_REVIEW' : 'ALLOW_WITH_CAUTION'
      },
      finalStatus: {
        performanceDollarSemantics: 'DISPLAY_SEMANTICS_DEFECT',
        maryJoToMichaelBeck: part3.classification,
        joshOviattToMichaelBeck: part4.classification,
        platformCommissionSweep: `${part5.summary.totalFlaggedRules}/${part5.summary.totalActiveRules} flagged`,
        financialExposure: part7.netExposure,
        missingEarningsCount: part5.summary.missingEarnings,
        productionFinancialWrites: 'FROZEN',
        finalizationRecommendation: hasFinancialRisk ? 'HOLD PENDING REVIEW' : 'ALLOW WITH CAUTION',
        adminUI: 'ADMIN_UI_NOT_SAFE_FOR_CONTROLLED_USE'
      }
    };

    const outputPath = path.join(__dirname, 'scratch', 'audit-results.json');
    fs.mkdirSync(path.join(__dirname, 'scratch'), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(auditResults, null, 2));
    console.log(`\n  Full audit results written to: ${outputPath}`);

  } catch (err) {
    console.error('\nFATAL AUDIT ERROR:', err);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
