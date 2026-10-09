import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import Decimal from 'decimal.js';
import { supabase, isAuthoritativeProductionDbConfigured } from '../lib/supabase.js';

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

async function main() {
  console.log('=== DEEP RECONCILIATION OF 31 TRANSACTIONS ===\n');

  // Load all data
  const { data: investors } = await supabase.from('investors').select('*');
  const { data: accounts } = await supabase.from('investor_accounts').select('*');
  const { data: allDeposits } = await supabase.from('deposits').select('*');
  const { data: allWithdrawals } = await supabase.from('withdrawals').select('*');
  const { data: allTransfers } = await supabase.from('internal_transfers').select('*');
  const { data: allHistory } = await supabase.from('investor_monthly_history').select('*');

  const results = [];

  for (const item of sourceTransactions) {
    const inv = investors.find(i => i.id === item.investorId || (item.investorId === 'stout001' && (i.id === 'stout001' || i.portal_username === 'jstout')));
    const accList = accounts.filter(a => a.investor_id === item.investorId || (item.investorId === 'stout001' && (a.id === 'stout001' || a.investor_id === 'inv_9e9a4bb0')));
    const acc = accList[0] || null;

    const investorName = inv ? `${inv.first_name} ${inv.last_name}` : item.name;
    const accountId = acc ? acc.id : (item.portal || null);

    // Look for matching deposits or withdrawals
    let matchedTx = null;
    let matchType = 'NONE';
    let candidates = [];

    if (item.type === 'DEPOSIT') {
      const userDeps = allDeposits.filter(d => 
        (d.investor_id === item.investorId || d.account_id === accountId || (item.investorId === 'stout001' && (d.investor_id === 'inv_9e9a4bb0' || d.investor_id === 'stout001')))
      );

      // Check exact amount
      candidates = userDeps.filter(d => Math.abs(Number(d.amount) - item.amount) < 0.01);
      
      // Match on date if multiple
      const dateMatch = candidates.find(d => {
        const dDate = d.effective_accounting_date || d.date;
        return dDate === item.date;
      });

      if (dateMatch) {
        matchedTx = dateMatch;
        matchType = 'EXACT';
      } else if (candidates.length === 1) {
        matchedTx = candidates[0];
        matchType = 'AMOUNT_ONLY';
      }
    } else if (item.type === 'WITHDRAWAL') {
      const userWds = allWithdrawals.filter(w => 
        (w.investor_id === item.investorId || w.account_id === accountId || (item.investorId === 'stout001' && (w.investor_id === 'inv_9e9a4bb0' || w.investor_id === 'stout001')))
      );

      candidates = userWds.filter(w => Math.abs(Number(w.amount) - item.amount) < 0.01);

      const dateMatch = candidates.find(w => {
        const wDate = w.effective_accounting_date || w.request_date || w.date;
        return wDate === item.date;
      });

      if (dateMatch) {
        matchedTx = dateMatch;
        matchType = 'EXACT';
      } else if (candidates.length === 1) {
        matchedTx = candidates[0];
        matchType = 'AMOUNT_ONLY';
      }
    }

    results.push({
      row: item.row,
      name: item.name,
      investorName,
      investorId: item.investorId,
      accountId,
      type: item.type,
      amount: item.amount,
      effectiveDate: item.date,
      matchedTx,
      matchType,
      candidates
    });
  }

  for (const r of results) {
    console.log(`--------------------------------------------------------------------------------`);
    console.log(`ROW ${r.row}: ${r.name} | ${r.type} | $${r.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })} | Effective: ${r.effectiveDate}`);
    console.log(`  Investor: ${r.investorName} (${r.investorId}) | Account: ${r.accountId}`);
    if (r.matchedTx) {
      const tx = r.matchedTx;
      const txDate = tx.effective_accounting_date || tx.request_date || tx.date;
      console.log(`  [MATCHED: ${r.matchType}] ID: ${tx.id} | Amount: $${Number(tx.amount).toFixed(2)} | Date: ${txDate} | Status: ${tx.status} | Type: ${tx.type || 'N/A'}`);
      console.log(`    Treatment: ${tx.accounting_treatment || 'N/A'} | Idempotency: ${tx.idempotency_key || 'N/A'} | Notes: "${tx.notes || ''}"`);
    } else {
      console.log(`  [NOT FOUND] No matching transaction found. (Candidates with same amount: ${r.candidates.length})`);
      if (r.candidates.length > 0) {
        r.candidates.forEach(c => {
          const cDate = c.effective_accounting_date || c.request_date || c.date;
          console.log(`    Candidate ID: ${c.id} | Amount: $${c.amount} | Date: ${cDate} | Status: ${c.status}`);
        });
      }
    }
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
