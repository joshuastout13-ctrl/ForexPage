import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import Decimal from 'decimal.js';
import { supabase } from '../lib/supabase.js';
import { buildInvestorDashboard } from '../lib/dashboard.js';

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });
process.env.DATA_SOURCE = 'supabase';

const sourceTransactions = [
  { row: 1, name: 'Brad Holly', type: 'DEPOSIT', amount: 278000.00, date: '2026-10-01', investorId: 'inv_5deeea21', portal: 'bholly' },
  { row: 2, name: 'Jeff Bennion', type: 'WITHDRAWAL', amount: 21500.00, date: '2026-09-01', investorId: 'inv_65b7fbd9', portal: 'jbennion' },
  { row: 3, name: 'Steve Kimball', type: 'WITHDRAWAL', amount: 6000.00, date: '2026-10-01', investorId: 'inv_16a045fa', portal: 'skimbell' },
  { row: 4, name: 'Steve Kimball', type: 'DEPOSIT', amount: 175279.32, date: '2026-11-01', investorId: 'inv_16a045fa', portal: 'skimbell' },
  { row: 5, name: 'Mary Jo Harris', type: 'WITHDRAWAL', amount: 21000.00, date: '2026-09-01', investorId: 'inv_4c5c0ee6', portal: 'mharris' },
  { row: 6, name: 'Dale Waite', type: 'WITHDRAWAL', amount: 2000.00, date: '2026-08-01', investorId: 'inv_60ed0c32', portal: 'dwaite' },
  { row: 7, name: 'Dale Waite', type: 'WITHDRAWAL', amount: 2000.00, date: '2026-09-01', investorId: 'inv_60ed0c32', portal: 'dwaite' },
  { row: 8, name: 'Dale Waite', type: 'DEPOSIT', amount: 6500.00, date: '2026-10-01', investorId: 'inv_60ed0c32', portal: 'dwaite' },
  { row: 9, name: 'Theresa Kruger', type: 'WITHDRAWAL', amount: 1696.33, date: '2026-09-01', investorId: 'inv_8cf28066', portal: 'tkruger' },
  { row: 10, name: 'Josh Oviatt', type: 'WITHDRAWAL', amount: 795.00, date: '2026-09-01', investorId: 'inv_ce0675be', portal: 'joviatt' },
  { row: 11, name: 'Beth Beck', type: 'DEPOSIT', amount: 1000.00, date: '2026-10-01', investorId: 'inv_3dc85bea', portal: 'bbeck' },
  { row: 12, name: 'Adam Richards', type: 'WITHDRAWAL', amount: 3000.00, date: '2026-09-01', investorId: 'inv_d3ec0cf8', portal: 'arichards' },
  { row: 13, name: 'Doug Patterson', type: 'WITHDRAWAL', amount: 150.00, date: '2026-09-01', investorId: 'inv_d5761f42', portal: 'dpatterson' },
  { row: 14, name: 'Doug Patterson', type: 'DEPOSIT', amount: 5000.00, date: '2026-11-01', investorId: 'inv_d5761f42', portal: 'dpatterson' },
  { row: 15, name: 'Whit Miller', type: 'WITHDRAWAL', amount: 700.00, date: '2026-09-01', investorId: 'inv_ea8b4eba', portal: 'wmiller' },
  { row: 16, name: 'Michelle Jackson', type: 'DEPOSIT', amount: 10000.00, date: '2026-09-01', investorId: 'inv_3eae6871', portal: 'mjackson' },
  { row: 17, name: 'Jack Fuller', type: 'DEPOSIT', amount: 148582.25, date: '2026-10-01', investorId: 'inv_693b8042', portal: 'jfuller' },
  { row: 18, name: 'Tiffany Llewellyn', type: 'DEPOSIT', amount: 4000.00, date: '2026-10-01', investorId: 'inv_e1797067', portal: 'tllewellyn' },
  { row: 19, name: 'April Stone', type: 'DEPOSIT', amount: 1800.00, date: '2026-10-01', investorId: 'inv_5537a3f8', portal: 'astone' },
  { row: 20, name: 'Reagan Ruddell', type: 'DEPOSIT', amount: 2000.00, date: '2026-09-01', investorId: 'inv_9a4326e7', portal: 'rruddell' },
  { row: 21, name: 'Josh Stout', type: 'WITHDRAWAL', amount: 20000.00, date: '2026-10-01', investorId: 'stout001', portal: 'jstout' },
  { row: 22, name: 'Glenn Maddock', type: 'DEPOSIT', amount: 568277.00, date: '2026-10-01', investorId: 'inv_5a509c6a', portal: 'gmaddocks' },
  { row: 23, name: 'Blaine Ray', type: 'WITHDRAWAL', amount: 76910.97, date: '2026-09-01', investorId: 'inv_81b6661d', portal: 'bray' },
  { row: 24, name: 'Tami Clemensen', type: 'DEPOSIT', amount: 60000.00, date: '2026-10-01', investorId: 'inv_f596c657', portal: 'fclemensen' },
  { row: 25, name: 'Jeremy Evans', type: 'WITHDRAWAL', amount: 9000.00, date: '2026-09-01', investorId: 'inv_6ba53bbe', portal: 'jevans' },
  { row: 26, name: 'Kathy Dodge', type: 'DEPOSIT', amount: 10530.00, date: '2026-10-01', investorId: 'inv_a829dff6', portal: 'kdodge' },
  { row: 27, name: 'Kathy Dodge', type: 'DEPOSIT', amount: 39470.00, date: '2026-11-01', investorId: 'inv_a829dff6', portal: 'kdodge' },
  { row: 28, name: 'Jean Harder', type: 'WITHDRAWAL', amount: 1500.00, date: '2026-09-01', investorId: 'inv_bc1bcb0c', portal: 'jharder' },
  { row: 29, name: 'Jean Harder', type: 'WITHDRAWAL', amount: 1500.00, date: '2026-08-01', investorId: 'inv_bc1bcb0c', portal: 'jharder' },
  { row: 30, name: 'Nelson Guyer', type: 'WITHDRAWAL', amount: 15000.00, date: '2026-09-01', investorId: 'inv_141417dc', portal: 'nguyer' },
  { row: 31, name: 'Sheryl Alvarado', type: 'DEPOSIT', amount: 60000.00, date: '2026-09-01', investorId: 'inv_7dc0fe9a', portal: 'salvarado' }
];

async function run() {
  const { data: investors } = await supabase.from('investors').select('*');
  const { data: accounts } = await supabase.from('investor_accounts').select('*');
  const { data: deposits } = await supabase.from('deposits').select('*');
  const { data: withdrawals } = await supabase.from('withdrawals').select('*');
  const { data: history } = await supabase.from('investor_monthly_history').select('*');

  console.log('=== FULL ANALYSIS OF 31 TRANSACTIONS ===\n');

  const rowsAnalysis = [];

  for (const item of sourceTransactions) {
    const inv = investors.find(i => i.id === item.investorId || (item.investorId === 'stout001' && (i.id === 'stout001' || i.portal_username === 'jstout')));
    const accList = accounts.filter(a => a.investor_id === item.investorId || (item.investorId === 'stout001' && (a.id === 'stout001' || a.investor_id === 'inv_9e9a4bb0')));
    const acc = accList[0] || null;

    const investorName = inv ? `${inv.first_name} ${inv.last_name}` : item.name;
    const accountId = acc ? acc.id : (item.portal || null);
    const splitPct = inv ? Number(inv.split_pct || 0) : 50;

    let classification = 'UNKNOWN';
    let matchingTxId = null;
    let existingStatus = 'N/A';
    let proposedAction = '';
    let expectedBalanceImpact = 0;
    let notes = '';

    // Check if deposit matches starting capital
    const isStartingCapitalMatch = acc && Math.abs(Number(acc.starting_capital) - item.amount) < 0.01 && acc.open_date === item.date;

    if (item.type === 'DEPOSIT') {
      const userDeps = deposits.filter(d => 
        (d.investor_id === item.investorId || d.account_id === accountId || (item.investorId === 'stout001' && (d.investor_id === 'inv_9e9a4bb0' || d.investor_id === 'stout001')))
      );

      const exactMatch = userDeps.find(d => {
        const dDate = d.effective_accounting_date || d.date;
        return Math.abs(Number(d.amount) - item.amount) < 0.01 && dDate === item.date && (!d.status || d.status.toLowerCase() !== 'void');
      });

      if (exactMatch) {
        classification = 'ALREADY RECORDED';
        matchingTxId = exactMatch.id;
        existingStatus = exactMatch.status;
        proposedAction = 'None (ignore, already posted)';
        expectedBalanceImpact = 0;
        notes = `Active deposit ${exactMatch.id} exists (${exactMatch.type}, ${exactMatch.accounting_treatment}).`;
      } else if (isStartingCapitalMatch) {
        classification = 'NEEDS REVIEW (ALREADY EMBEDDED IN STARTING CAPITAL)';
        matchingTxId = `account:${acc.id}:starting_capital`;
        existingStatus = 'Active Starting Capital';
        proposedAction = 'Do not post as new cash. Document as historical funding or leave as starting capital.';
        expectedBalanceImpact = 0;
        notes = `Amount matches initial starting_capital ($${acc.starting_capital}) on open_date ${acc.open_date}. Adding deposit would duplicate economic capital.`;
      } else if (item.date > '2026-10-31') {
        classification = 'FUTURE-DATED (MISSING FOR NOVEMBER)';
        matchingTxId = null;
        existingStatus = 'Not recorded';
        proposedAction = 'Hold for November 2026 posting cycle (do not apply to October settled balance).';
        expectedBalanceImpact = 0;
        notes = `Future-dated effective 2026-11-01. Current October settled balance impact is $0.00.`;
      } else {
        classification = 'MISSING';
        matchingTxId = null;
        existingStatus = 'Not recorded';
        proposedAction = 'Post upon Josh Stout explicit authorization (NEW_CASH).';
        expectedBalanceImpact = item.amount;
        notes = `Genuine missing deposit effective ${item.date}. Increases October settled balance by +$${item.amount.toLocaleString()}.`;
      }
    } else if (item.type === 'WITHDRAWAL') {
      const userWds = withdrawals.filter(w => 
        (w.investor_id === item.investorId || w.account_id === accountId || (item.investorId === 'stout001' && (w.investor_id === 'inv_9e9a4bb0' || w.investor_id === 'stout001')))
      );

      const exactMatch = userWds.find(w => {
        const wDate = w.effective_accounting_date || w.request_date || w.date;
        return Math.abs(Number(w.amount) - item.amount) < 0.01 && wDate === item.date && (!w.status || w.status.toLowerCase() !== 'cancelled');
      });

      // Special check: August withdrawal recorded with August request date (e.g. Dale Waite wd_042e2363 on 2026-08-11, Jean Harder wd_9eb4d3a0 on 2026-08-12)
      const augMatch = userWds.find(w => {
        return Math.abs(Number(w.amount) - item.amount) < 0.01 && w.month_number === 8 && w.year === 2026 && item.date === '2026-08-01' && (!w.status || w.status.toLowerCase() !== 'cancelled');
      });

      // Special check for Theresa Kruger $1.00 discrepancy
      const tkMatch = (item.name === 'Theresa Kruger') ? userWds.find(w => Math.abs(Number(w.amount) - 1697.33) < 0.01 && (w.effective_accounting_date === '2026-09-01' || w.request_date === '2026-09-01')) : null;

      if (exactMatch) {
        classification = 'ALREADY RECORDED';
        matchingTxId = exactMatch.id;
        existingStatus = exactMatch.status;
        proposedAction = 'None (ignore, already posted)';
        expectedBalanceImpact = 0;
        notes = `Active withdrawal ${exactMatch.id} exists (${exactMatch.status}).`;
      } else if (augMatch) {
        classification = 'ALREADY RECORDED';
        matchingTxId = augMatch.id;
        existingStatus = augMatch.status;
        proposedAction = 'None (ignore, already accounted for in August history)';
        expectedBalanceImpact = 0;
        notes = `Recorded as ${augMatch.id} (request_date ${augMatch.request_date}, status ${augMatch.status}). Deducted in August monthly history.`;
      } else if (tkMatch) {
        classification = 'NEEDS REVIEW (ALREADY RECORDED WITH $1.00 DISCREPANCY)';
        matchingTxId = tkMatch.id;
        existingStatus = tkMatch.status;
        proposedAction = 'Confirm $1.00 difference with Josh. Do not create duplicate withdrawal.';
        expectedBalanceImpact = 0;
        notes = `Production recorded $1,697.33 (id: ${tkMatch.id}) in September batch. Screenshot shows $1,696.33. Difference is exactly $1.00.`;
      } else if (item.date === '2026-09-01') {
        classification = 'MISSING (SEPTEMBER LOCKED PERIOD)';
        matchingTxId = null;
        existingStatus = 'Not recorded';
        proposedAction = 'Requires explicit audited historical override for September 2026.';
        expectedBalanceImpact = -item.amount;
        notes = `Missing withdrawal in locked September 2026. Affects September trading basis and carryforward balance.`;
      } else {
        classification = 'MISSING';
        matchingTxId = null;
        existingStatus = 'Not recorded';
        proposedAction = 'Post upon Josh Stout explicit authorization.';
        expectedBalanceImpact = -item.amount;
        notes = `Genuine missing withdrawal effective ${item.date}. Deducts from October settled balance.`;
      }
    }

    rowsAnalysis.push({
      row: item.row,
      name: item.name,
      investorName,
      investorId: item.investorId,
      accountId,
      type: item.type,
      amount: item.amount,
      effectiveDate: item.date,
      classification,
      matchingTxId,
      existingStatus,
      proposedAction,
      expectedBalanceImpact,
      notes
    });
  }

  console.log(JSON.stringify(rowsAnalysis, null, 2));
}

run().catch(console.error);
