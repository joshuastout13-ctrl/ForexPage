/**
 * ADVERSARIAL CERTIFICATION SCRIPT (FULL PAGINATION)
 * Deep inspection of all candidate missing earnings and platform integrity with complete paginated data loading.
 * READ-ONLY. Zero mutations.
 */

const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const Decimal = require('decimal.js');
const fs = require('fs');

dotenv.config({ path: '.env.local' });
Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
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

async function fetchAllRows(tableName) {
  let allData = [];
  let page = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await supabase.from(tableName).select('*').range(page * pageSize, (page + 1) * pageSize - 1);
    if (error) throw error;
    allData = allData.concat(data);
    if (data.length < pageSize) break;
    page++;
  }
  return allData;
}

async function runAdversarialAudit() {
  console.log('Loading all production tables with full pagination...');
  const [
    investors,
    accounts,
    commShares,
    commEarnings,
    commRules,
    history,
    monthlyReturns,
    livePerf,
    deposits,
    withdrawals
  ] = await Promise.all([
    fetchAllRows('investors'),
    fetchAllRows('investor_accounts'),
    fetchAllRows('commission_shares'),
    fetchAllRows('commission_earnings'),
    fetchAllRows('commission_rules'),
    fetchAllRows('investor_monthly_history'),
    fetchAllRows('monthly_returns'),
    fetchAllRows('live_performance'),
    fetchAllRows('deposits'),
    fetchAllRows('withdrawals')
  ]);

  console.log(`Loaded rows:`);
  console.log(`  investors: ${investors.length}`);
  console.log(`  accounts: ${accounts.length}`);
  console.log(`  commission_shares: ${commShares.length}`);
  console.log(`  commission_earnings: ${commEarnings.length}`);
  console.log(`  history: ${history.length}`);
  console.log(`  monthlyReturns: ${monthlyReturns.length}`);

  // Build identity maps
  const invById = new Map();
  const invByUsername = new Map();
  const invByAnyKey = new Map();

  for (const inv of investors) {
    const id = String(inv.id || '').trim().toLowerCase();
    const uname = String(inv.portal_username || '').trim().toLowerCase();
    if (id) invById.set(id, inv);
    if (uname) invByUsername.set(uname, inv);
    if (id) invByAnyKey.set(id, inv);
    if (uname) invByAnyKey.set(uname, inv);
  }

  function resolveInvestor(key) {
    if (!key) return null;
    const clean = String(key).trim().toLowerCase();
    return invByAnyKey.get(clean) || null;
  }

  function getAliases(inv) {
    if (!inv) return new Set();
    const s = new Set();
    if (inv.id) s.add(String(inv.id).trim().toLowerCase());
    if (inv.portal_username) s.add(String(inv.portal_username).trim().toLowerCase());
    return s;
  }

  const fundReturns = {};
  for (const r of monthlyReturns) {
    if (toNum(r.year) === YEAR) {
      fundReturns[toNum(r.month_number)] = toNum(r.gross_return_pct);
    }
  }

  let latestFundMonth = 0;
  for (const r of monthlyReturns) {
    if (toNum(r.year) === YEAR && toNum(r.gross_return_pct) !== 0) {
      const m = toNum(r.month_number);
      if (m > latestFundMonth) latestFundMonth = m;
    }
  }

  const activeRules = commShares.filter(s => String(s.status || '').toLowerCase() !== 'cancelled');

  // Step 1: Re-evaluate all candidate monthly obligations across all active rules
  const allObligations = [];
  const candidates199 = [];

  for (const rule of activeRules) {
    const srcId = String(rule.source_investor_id || '').toLowerCase();
    const recId = String(rule.recipient_investor_id || '').toLowerCase();
    const srcInv = resolveInvestor(srcId);
    const recInv = resolveInvestor(recId);
    const startDate = rule.effective_start_date;
    const endDate = rule.effective_end_date;

    if (srcInv && recInv) {
      for (let month = 1; month <= latestFundMonth; month++) {
        const periodStart = `${YEAR}-${String(month).padStart(2, '0')}-01`;
        const lastDay = new Date(Date.UTC(YEAR, month, 0)).getUTCDate();
        const periodEnd = `${YEAR}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

        const ruleStart = String(startDate || '2000-01-01');
        const ruleEnd = endDate ? String(endDate) : null;

        if (ruleStart > periodEnd) continue;
        if (ruleEnd !== null && ruleEnd < periodStart) continue;

        const grossReturnPct = fundReturns[month] || 0;
        if (grossReturnPct <= 0) continue;

        // How the naive unpaginated script checked:
        const naiveEarnings = commEarnings.slice(0, 1000).filter(e =>
          String(e.source_investor_id || '').toLowerCase() === srcId &&
          String(e.recipient_id || '').toLowerCase() === recId &&
          toNum(e.year) === YEAR &&
          toNum(e.month_number) === month
        );

        if (naiveEarnings.length === 0) {
          candidates199.push({
            rule,
            srcInv,
            recInv,
            month,
            grossReturnPct
          });
        }
      }
    }
  }

  console.log(`\nRe-verified candidate count from prior unpaginated sweep: ${candidates199.length}`);

  // Now, classify each of these candidates with complete paginated evidence!
  const classificationCounts = {
    TRUE_MISSING_EARNING: 0,
    EXPECTED_ZERO_OR_NO_PROFIT: 0,
    RULE_NOT_EFFECTIVE: 0,
    PERIOD_NOT_FINALIZED: 0,
    PRE_LEDGER_CUTOVER: 0,
    EMBEDDED_IN_BASELINE: 0,
    DUPLICATE_ALTERNATE_RECORD: 0,
    IDENTIFIER_MISMATCH: 0,
    INSUFFICIENT_EVIDENCE: 0
  };

  const classifiedList = [];

  for (const cand of candidates199) {
    const { rule, srcInv, recInv, month, grossReturnPct } = cand;
    const srcAliases = getAliases(srcInv);
    const recAliases = getAliases(recInv);

    // 1. Check if record actually exists in the full 1056 rows (was truncated by 1000 limit or alias mismatch)!
    const matchingEarnings = commEarnings.filter(e => {
      const eSrc = String(e.source_investor_id || '').toLowerCase();
      const eRec = String(e.recipient_id || '').toLowerCase();
      return srcAliases.has(eSrc) && recAliases.has(eRec) &&
        toNum(e.year) === YEAR && toNum(e.month_number) === month;
    });

    if (matchingEarnings.length > 0) {
      const e = matchingEarnings[0];
      const isExactMatch = String(e.recipient_id).toLowerCase() === String(rule.recipient_investor_id).toLowerCase();
      const item = {
        cand,
        classification: isExactMatch ? 'DUPLICATE_ALTERNATE_RECORD' : 'IDENTIFIER_MISMATCH',
        details: `Earning exists in production DB (ID: ${e.id}, amount: $${e.amount}) but was truncated by the 1000-row query limit or had alias difference.`,
        amount: toNum(e.amount)
      };
      classifiedList.push(item);
      if (isExactMatch) {
        classificationCounts.DUPLICATE_ALTERNATE_RECORD++;
      } else {
        classificationCounts.IDENTIFIER_MISMATCH++;
      }
      continue;
    }

    // 2. Check source investor history in that month (did source have active capital / positive profit?)
    const srcHistoryRows = history.filter(h =>
      srcAliases.has(String(h.investor_id || '').toLowerCase()) &&
      toNum(h.year) === YEAR &&
      toNum(h.month_number) === month
    );

    const srcHistory = srcHistoryRows[0];
    const srcStartDate = srcInv.start_date ? String(srcInv.start_date) : null;
    const periodStart = `${YEAR}-${String(month).padStart(2, '0')}-01`;
    const lastDay = new Date(Date.UTC(YEAR, month, 0)).getUTCDate();
    const periodEnd = `${YEAR}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    if (!srcHistory && srcStartDate && srcStartDate > periodEnd) {
      const item = {
        cand,
        classification: 'RULE_NOT_EFFECTIVE',
        details: `Source investor start_date (${srcStartDate}) is after month ${month} periodEnd (${periodEnd})`,
        amount: 0
      };
      classifiedList.push(item);
      classificationCounts.RULE_NOT_EFFECTIVE++;
      continue;
    }

    if (!srcHistory) {
      const item = {
        cand,
        classification: 'EXPECTED_ZERO_OR_NO_PROFIT',
        details: `Source investor had no history/capital in month ${month}`,
        amount: 0
      };
      classifiedList.push(item);
      classificationCounts.EXPECTED_ZERO_OR_NO_PROFIT++;
      continue;
    }

    const openBal = toNum(srcHistory.opening_balance);
    const deps = toNum(srcHistory.deposits);
    const wds = toNum(srcHistory.withdrawals);
    const eligibleCapital = openBal + deps - wds;

    if (eligibleCapital <= 0) {
      const item = {
        cand,
        classification: 'EXPECTED_ZERO_OR_NO_PROFIT',
        details: `Source investor eligible capital was $${eligibleCapital.toFixed(2)} in month ${month}`,
        amount: 0
      };
      classifiedList.push(item);
      classificationCounts.EXPECTED_ZERO_OR_NO_PROFIT++;
      continue;
    }

    // Calculate gross profit and expected commission
    const grossProfit = roundMoney(toDec(eligibleCapital).mul(grossReturnPct).div(100)).toNumber();
    const commPct = toNum(rule.commission_percent);
    const expectedCommission = roundMoney(toDec(grossProfit).mul(commPct).div(100)).toNumber();

    if (expectedCommission <= 0) {
      const item = {
        cand,
        classification: 'EXPECTED_ZERO_OR_NO_PROFIT',
        details: `Expected commission calculated to $0.00 (grossProfit=$${grossProfit})`,
        amount: 0
      };
      classifiedList.push(item);
      classificationCounts.EXPECTED_ZERO_OR_NO_PROFIT++;
      continue;
    }

    // 3. Check if month is Jan-Apr (Pre-ledger cutover / embedded in baseline)
    if (month < 5) {
      const item = {
        cand,
        classification: 'PRE_LEDGER_CUTOVER',
        details: `Month ${month} is prior to May 2026 automated commission cutover. Expected=$${expectedCommission.toFixed(2)}`,
        amount: expectedCommission
      };
      classifiedList.push(item);
      classificationCounts.PRE_LEDGER_CUTOVER++;
      continue;
    }

    // 4. Month 5-7 (May, June, July): Check if period was finalized without this commission
    const anyMonthEarnings = commEarnings.filter(e => toNum(e.year) === YEAR && toNum(e.month_number) === month);
    
    if (anyMonthEarnings.length > 0) {
      const item = {
        cand,
        classification: 'TRUE_MISSING_EARNING',
        details: `Month ${month} finalized, rule active (${commPct}%), source gross profit=$${grossProfit.toFixed(2)}, expected=$${expectedCommission.toFixed(2)}`,
        amount: expectedCommission,
        grossProfit,
        eligibleCapital,
        rulePct: commPct
      };
      classifiedList.push(item);
      classificationCounts.TRUE_MISSING_EARNING++;
    } else {
      const item = {
        cand,
        classification: 'PERIOD_NOT_FINALIZED',
        details: `Month ${month} has no finalized commission earnings across the platform`,
        amount: expectedCommission
      };
      classifiedList.push(item);
      classificationCounts.PERIOD_NOT_FINALIZED++;
    }
  }

  console.log('\nFINAL CERTIFIED CLASSIFICATION COUNTS (across 199 candidates):');
  console.log(JSON.stringify(classificationCounts, null, 2));

  // Compute sums by classification
  const totalsByClass = {};
  for (const item of classifiedList) {
    totalsByClass[item.classification] = (totalsByClass[item.classification] || new Decimal(0)).add(item.amount || 0);
  }
  console.log('\nTOTALS BY CLASSIFICATION ($):');
  for (const [k, v] of Object.entries(totalsByClass)) {
    console.log(`  ${k}: $${v.toFixed(2)}`);
  }

  fs.writeFileSync('./scratch/final-certified-classification.json', JSON.stringify({
    counts: classificationCounts,
    totals: Object.fromEntries(Object.entries(totalsByClass).map(([k, v]) => [k, v.toNumber()])),
    classifiedList: classifiedList.map(c => ({
      month: c.cand.month,
      source: `${c.cand.srcInv.first_name} ${c.cand.srcInv.last_name} (${c.cand.srcInv.portal_username})`,
      recipient: `${c.cand.recInv.first_name} ${c.cand.recInv.last_name} (${c.cand.recInv.portal_username})`,
      rulePct: c.cand.rule.commission_percent,
      ruleStart: c.cand.rule.effective_start_date,
      ruleEnd: c.cand.rule.effective_end_date,
      classification: c.classification,
      amount: c.amount,
      details: c.details
    }))
  }, null, 2));

  console.log('\nSaved final-certified-classification.json');
}

runAdversarialAudit().catch(console.error);
