import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import Decimal from 'decimal.js';
import { supabase, isAuthoritativeProductionDbConfigured } from '../lib/supabase.js';

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });
process.env.DATA_SOURCE = 'supabase';

const sourceTransactions = [
  { row: 1, name: 'Brad Holly', type: 'DEPOSIT', amount: 278000.00, date: '2026-10-01' },
  { row: 2, name: 'Jeff Bennion', type: 'WITHDRAWAL', amount: 21500.00, date: '2026-09-01' },
  { row: 3, name: 'Steve Kimball', type: 'WITHDRAWAL', amount: 6000.00, date: '2026-10-01' },
  { row: 4, name: 'Steve Kimball', type: 'DEPOSIT', amount: 175279.32, date: '2026-11-01' },
  { row: 5, name: 'Mary Jo Harris', type: 'WITHDRAWAL', amount: 21000.00, date: '2026-09-01' },
  { row: 6, name: 'Dale Waite', type: 'WITHDRAWAL', amount: 2000.00, date: '2026-08-01' },
  { row: 7, name: 'Dale Waite', type: 'WITHDRAWAL', amount: 2000.00, date: '2026-09-01' },
  { row: 8, name: 'Dale Waite', type: 'DEPOSIT', amount: 6500.00, date: '2026-10-01' },
  { row: 9, name: 'Theresa Kruger', type: 'WITHDRAWAL', amount: 1696.33, date: '2026-09-01' },
  { row: 10, name: 'Josh Oviatt', type: 'WITHDRAWAL', amount: 795.00, date: '2026-09-01' },
  { row: 11, name: 'Beth Beck', type: 'DEPOSIT', amount: 1000.00, date: '2026-10-01' },
  { row: 12, name: 'Adam Richards', type: 'WITHDRAWAL', amount: 3000.00, date: '2026-09-01' },
  { row: 13, name: 'Doug Patterson', type: 'WITHDRAWAL', amount: 150.00, date: '2026-09-01' },
  { row: 14, name: 'Doug Patterson', type: 'DEPOSIT', amount: 5000.00, date: '2026-11-01' },
  { row: 15, name: 'Whit Miller', type: 'WITHDRAWAL', amount: 700.00, date: '2026-09-01' },
  { row: 16, name: 'Michelle Jackson', type: 'DEPOSIT', amount: 10000.00, date: '2026-09-01' },
  { row: 17, name: 'Jack Fuller', type: 'DEPOSIT', amount: 148582.25, date: '2026-10-01' },
  { row: 18, name: 'Tiffany Llewellyn', type: 'DEPOSIT', amount: 4000.00, date: '2026-10-01' },
  { row: 19, name: 'April Stone', type: 'DEPOSIT', amount: 1800.00, date: '2026-10-01' },
  { row: 20, name: 'Reagan Ruddell', type: 'DEPOSIT', amount: 2000.00, date: '2026-09-01' },
  { row: 21, name: 'Josh Stout', type: 'WITHDRAWAL', amount: 20000.00, date: '2026-10-01' },
  { row: 22, name: 'Glenn Maddock', type: 'DEPOSIT', amount: 568277.00, date: '2026-10-01' },
  { row: 23, name: 'Blaine Ray', type: 'WITHDRAWAL', amount: 76910.97, date: '2026-09-01' },
  { row: 24, name: 'Tami Clemensen', type: 'DEPOSIT', amount: 60000.00, date: '2026-10-01' },
  { row: 25, name: 'Jeremy Evans', type: 'WITHDRAWAL', amount: 9000.00, date: '2026-09-01' },
  { row: 26, name: 'Kathy Dodge', type: 'DEPOSIT', amount: 10530.00, date: '2026-10-01' },
  { row: 27, name: 'Kathy Dodge', type: 'DEPOSIT', amount: 39470.00, date: '2026-11-01' },
  { row: 28, name: 'Jean Harder', type: 'WITHDRAWAL', amount: 1500.00, date: '2026-09-01' },
  { row: 29, name: 'Jean Harder', type: 'WITHDRAWAL', amount: 1500.00, date: '2026-08-01' },
  { row: 30, name: 'Nelson Guyer', type: 'WITHDRAWAL', amount: 15000.00, date: '2026-09-01' },
  { row: 31, name: 'Sheryl Alvarado', type: 'DEPOSIT', amount: 60000.00, date: '2026-09-01' }
];

async function main() {
  console.log('=== 4XTRACK: RECONCILE JOSH NEW TRANSACTION BATCH ===');
  if (!isAuthoritativeProductionDbConfigured()) {
    throw new Error('FAIL CLOSED: Authoritative production db julhldzkiqdeuuoqmvlo not configured!');
  }

  // 1. Fetch all investors and accounts
  const { data: investors } = await supabase.from('investors').select('*');
  const { data: accounts } = await supabase.from('investor_accounts').select('*');
  const { data: deposits } = await supabase.from('deposits').select('*');
  const { data: withdrawals } = await supabase.from('withdrawals').select('*');
  const { data: transfers } = await supabase.from('internal_transfers').select('*');

  console.log(`Fetched ${investors.length} investors, ${accounts.length} accounts, ${deposits.length} deposits, ${withdrawals.length} withdrawals, ${transfers.length} transfers.`);

  // Function to search investor by name
  function findInvestor(name) {
    const n = name.toLowerCase().trim();
    // exact or partial matching
    const matches = investors.filter(inv => {
      const full1 = `${inv.first_name || ''} ${inv.last_name || ''}`.toLowerCase().trim();
      const user = (inv.portal_username || '').toLowerCase().trim();
      const email = (inv.email || '').toLowerCase().trim();
      if (full1 === n || user === n) return true;
      if (full1.includes(n) || n.includes(full1)) return true;
      // name parts
      const parts = n.split(' ');
      if (parts.length >= 2) {
        const first = parts[0];
        const last = parts[parts.length - 1];
        if ((inv.first_name || '').toLowerCase().includes(first) && (inv.last_name || '').toLowerCase().includes(last)) return true;
      }
      return false;
    });
    return matches;
  }

  console.log('\n--- MATCHING INVESTORS ---');
  for (const item of sourceTransactions) {
    const matched = findInvestor(item.name);
    console.log(`Row ${item.row}: ${item.name} (${item.type} $${item.amount} on ${item.date}) -> Matched ${matched.length}: ${matched.map(m => `${m.first_name} ${m.last_name} (${m.id} / ${m.portal_username})`).join('; ')}`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
