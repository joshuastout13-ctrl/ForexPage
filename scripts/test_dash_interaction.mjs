import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { buildInvestorDashboard } from '../lib/dashboard.js';
import { supabase, readSupabaseTable, normalizeRow } from '../lib/supabase.js';

async function test() {
  process.env.DATA_SOURCE = 'supabase';
  const dashBefore = await buildInvestorDashboard('bholly', null, { mustBeAuthoritative: true });
  console.log('Brad Holly currentBalance Live:', dashBefore.summary.currentBalance);

  // Fetch tables
  const [rawInvestors, accounts, returnsSheet, depositsSheet, withdrawalsSheet, historyTable, commissionEarningsTable, commissionSharesTable, commissionRulesTable] = await Promise.all([
    readSupabaseTable('investors'),
    readSupabaseTable('investor_accounts'),
    readSupabaseTable('monthly_returns'),
    readSupabaseTable('deposits', { queryModifier: q => q.eq('investor_id', 'inv_5deeea21') }),
    readSupabaseTable('withdrawals', { queryModifier: q => q.eq('investor_id', 'inv_5deeea21') }),
    readSupabaseTable('investor_monthly_history', { queryModifier: q => q.eq('investor_id', 'inv_5deeea21') }),
    readSupabaseTable('commission_earnings', { queryModifier: q => q.eq('recipient_id', 'inv_5deeea21') }),
    readSupabaseTable('commission_shares'),
    readSupabaseTable('commission_rules')
  ]);

  // Case A: Add new deposit to depositsSheet only
  const newDep = {
    id: 'test_dep',
    investor_id: 'inv_5deeea21',
    account_id: 'bholly',
    amount: 278000,
    date: '2026-10-01',
    effective_accounting_date: '2026-10-01',
    status: 'confirmed',
    accounting_treatment: 'NEW_CASH',
    type: 'Wire'
  };

  const preloadedA = {
    rawInvestors, accounts, returnsSheet,
    depositsSheet: [...depositsSheet, normalizeRow(newDep)],
    withdrawalsSheet,
    historyTable: [...historyTable],
    commissionEarningsTable, commissionSharesTable, commissionRulesTable
  };

  const dashA = await buildInvestorDashboard('bholly', preloadedA);
  console.log('Case A (new deposit in depositsSheet, historyTable has deposits=0):', dashA.summary.currentBalance);

  // Case B: Add new deposit AND update October historyTable row
  const updatedHistory = historyTable.map(h => {
    if (h.year === 2026 && h.month_number === 10) {
      return {
        ...h,
        deposits: (Number(h.deposits) || 0) + 278000,
        ending_balance: (Number(h.opening_balance) || 0) + (Number(h.deposits) || 0) + 278000 - (Number(h.withdrawals) || 0)
      };
    }
    return h;
  });

  const preloadedB = {
    rawInvestors, accounts, returnsSheet,
    depositsSheet: [...depositsSheet, normalizeRow(newDep)],
    withdrawalsSheet,
    historyTable: updatedHistory,
    commissionEarningsTable, commissionSharesTable, commissionRulesTable
  };

  const dashB = await buildInvestorDashboard('bholly', preloadedB);
  console.log('Case B (new deposit in depositsSheet, historyTable updated):', dashB.summary.currentBalance);
}

test().catch(console.error);
