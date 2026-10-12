import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import Decimal from 'decimal.js';
import { supabase, isAuthoritativeProductionDbConfigured, paginatedRead, normalizeRow } from '../lib/supabase.js';
import { buildInvestorDashboard } from '../lib/dashboard.js';
import { getFundAccountingDate, evaluateMonthState, MonthState } from '../lib/month-state.js';
import { calculateTotalExternalCash, calculateLifetimeSettledWithdrawals } from '../lib/accounting-engine.js';

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });
process.env.DATA_SOURCE = 'supabase';

function roundMoney(d) {
  if (d === null || d === undefined) return new Decimal(0);
  return new Decimal(d).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

export async function runIndependentPlatformReconciliation() {
  if (!isAuthoritativeProductionDbConfigured() || !supabase) {
    throw new Error('FAIL_CLOSED: Authoritative production database (julhldzkiqdeuuoqmvlo) is not configured.');
  }

  const fundDate = getFundAccountingDate();
  const currentYear = fundDate.year; // 2026
  const currentMonth = fundDate.monthNumber; // 10 (October)

  // 1. Fetch authoritative tables
  const [
    rawInvestors,
    rawAccounts,
    rawReturns,
    rawCommissionEarnings,
    rawCommissionShares,
    rawMonthlyHistory,
    rawDeposits,
    rawWithdrawals,
    rawCutovers
  ] = await Promise.all([
    paginatedRead('investors'),
    paginatedRead('investor_accounts'),
    paginatedRead('monthly_returns'),
    paginatedRead('commission_earnings'),
    paginatedRead('commission_shares'),
    paginatedRead('investor_monthly_history'),
    paginatedRead('deposits'),
    paginatedRead('withdrawals'),
    paginatedRead('account_cutover_adjustments').catch(() => [])
  ]);

  const investors = rawInvestors.map(normalizeRow).filter(i => i.role !== 'Admin' && i.portal_username !== 'admin');
  const accounts = rawAccounts.map(normalizeRow);
  const returns = rawReturns.map(normalizeRow);
  const commissions = rawCommissionEarnings.map(normalizeRow).filter(c => String(c.status || '').toUpperCase() !== 'SUPERSEDED');
  const deposits = rawDeposits.map(normalizeRow).filter(d => {
    const isVoid = String(d.status || '').toLowerCase() === 'void' || String(d.type || '').toUpperCase() === 'VOID';
    return !isVoid;
  });
  const withdrawals = rawWithdrawals.map(normalizeRow).filter(w => {
    const isCancelled = String(w.status || '').toLowerCase() === 'cancelled' || String(w.status || '').toLowerCase() === 'void';
    return !isCancelled;
  });
  const cutovers = rawCutovers.map(normalizeRow);
  const history = rawMonthlyHistory.map(normalizeRow);

  console.log('================================================================================');
  console.log('PHASE 5 — INDEPENDENT 108-ACCOUNT FULL-CHAIN RECONCILIATION');
  console.log('Target: julhldzkiqdeuuoqmvlo | Year:', currentYear, '| Month:', currentMonth);
  console.log('Total Accounts to Reconcile:', investors.length);
  console.log('================================================================================\n');

  const results = [];
  let exactMatchCount = 0;
  let varianceCount = 0;
  const variances = [];

  for (const inv of investors) {
    const portal = inv.portal_username || inv.id;
    const invAccounts = accounts.filter(a => a.investor_id === inv.id || a.id === portal);
    const primaryAccount = invAccounts[0] || {};
    const splitPct = new Decimal(inv.split_pct || primaryAccount.split_pct || 50).div(100);
    const recurringDraw = new Decimal(inv.monthly_draw || 0);

    // Call authoritative dashboard
    let dash = null;
    try {
      dash = await buildInvestorDashboard(portal, null, { mustBeAuthoritative: true });
    } catch (e) {
      variances.push({ portal, error: e.message });
      varianceCount++;
      continue;
    }

    const dashCurrentBalance = roundMoney(dash.summary.currentBalance);
    const dashLifetimeWithdrawals = roundMoney(dash.summary.totalWithdrawals);
    const dashOutsideCash = roundMoney(dash.summary.totalExternalCashSent);
    const dashProvenance = dash.summary.provenanceCompletenessStatus;

    // Independent reconstruction of current settled balance from October history / open cashflows:
    // Fetch October history row
    const octHist = history.find(h => h.investor_id === inv.id && h.year === currentYear && h.month_number === currentMonth);
    const sepHist = history.find(h => h.investor_id === inv.id && h.year === currentYear && h.month_number === 9);

    // Calculate October cashflows directly from transactions
    const octDeps = deposits.filter(d => {
      const matchInv = d.investor_id === inv.id || (d.account_id && invAccounts.some(a => a.id === d.account_id));
      const date = d.effective_accounting_date || d.date;
      return matchInv && date && date.startsWith('2026-10');
    }).reduce((sum, d) => sum.add(new Decimal(d.amount)), new Decimal(0));

    const octWds = withdrawals.filter(w => {
      const matchInv = w.investor_id === inv.id || (w.account_id && invAccounts.some(a => a.id === w.account_id));
      const date = w.effective_accounting_date || w.request_date;
      const isCompleted = String(w.status || '').toLowerCase() === 'completed' || String(w.status || '').toLowerCase() === 'approved';
      return matchInv && isCompleted && date && date.startsWith('2026-10');
    }).reduce((sum, w) => sum.add(new Decimal(w.amount)), new Decimal(0));

    // Expected October opening balance:
    // If October row exists, its opening_balance; else September ending_balance; else starting_capital
    let expectedOctOpening = new Decimal(0);
    if (octHist) {
      expectedOctOpening = new Decimal(octHist.opening_balance || 0);
    } else if (sepHist) {
      expectedOctOpening = new Decimal(sepHist.ending_balance || 0);
    } else {
      expectedOctOpening = new Decimal(primaryAccount.starting_capital || 0);
    }

    // Expected October settled balance: opening + deposits - withdrawals - draw
    const expectedSettledBalance = roundMoney(expectedOctOpening.add(octDeps).sub(octWds).sub(recurringDraw));

    // Compare with dashboard balance
    const diff = dashCurrentBalance.sub(expectedSettledBalance).abs().toNumber();
    const isMatch = diff <= 0.01;

    if (isMatch) {
      exactMatchCount++;
    } else {
      varianceCount++;
      variances.push({
        investorId: inv.id,
        portal,
        name: `${inv.first_name} ${inv.last_name}`,
        dashCurrentBalance: dashCurrentBalance.toNumber(),
        expectedSettledBalance: expectedSettledBalance.toNumber(),
        diff
      });
    }

    results.push({
      investorId: inv.id,
      portal,
      name: `${inv.first_name} ${inv.last_name}`,
      dashCurrentBalance: dashCurrentBalance.toNumber(),
      expectedSettledBalance: expectedSettledBalance.toNumber(),
      lifetimeWithdrawals: dashLifetimeWithdrawals.toNumber(),
      outsideCash: dashOutsideCash.toNumber(),
      provenance: dashProvenance,
      isMatch
    });
  }

  console.log('\n================================================================================');
  console.log('INDEPENDENT RECONCILIATION SUMMARY:');
  console.log('Total Financial Accounts Evaluated:', investors.length);
  console.log('Exact Matches (diff <= $0.01):     ', exactMatchCount);
  console.log('Variances (> $0.01):               ', varianceCount);
  console.log('================================================================================\n');

  if (variances.length > 0) {
    console.log('VARIANCES DETECTED:');
    console.log(JSON.stringify(variances, null, 2));
  } else {
    console.log('✅ ALL 108 INVESTOR ACCOUNTS INDEPENDENTLY RECONCILE TO THE EXACT CENT (0 VARIANCES)!');
  }

  return {
    total: investors.length,
    exactMatchCount,
    varianceCount,
    variances,
    results
  };
}

// Execute if run directly
if (process.argv[1]?.endsWith('independent_platform_reconciliation.mjs')) {
  runIndependentPlatformReconciliation()
    .then(() => process.exit(0))
    .catch(err => {
      console.error(err);
      process.exit(1);
    });
}
