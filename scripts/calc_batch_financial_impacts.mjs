import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import Decimal from 'decimal.js';
import { supabase } from '../lib/supabase.js';
import { buildInvestorDashboard } from '../lib/dashboard.js';

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });
process.env.DATA_SOURCE = 'supabase';

async function main() {
  console.log('=== CENT-ACCURATE FINANCIAL IMPACT OF MISSING TRANSACTIONS ===\n');

  // List of accounts with missing transactions
  const accountsToAnalyze = [
    { name: 'Brad Holly', id: 'inv_5deeea21', portal: 'bholly', octDep: 278000.00 },
    { name: 'Steve Kimball', id: 'inv_16a045fa', portal: 'skimbell', octWd: 6000.00, novDep: 175279.32 },
    { name: 'Dale Waite', id: 'inv_60ed0c32', portal: 'dwaite', octDep: 6500.00 },
    { name: 'Josh Stout', id: 'stout001', portal: 'jstout', octWd: 20000.00 },
    { name: 'Glenn Maddocks', id: 'inv_5a509c6a', portal: 'gmaddocks', octDep: 568277.00 },
    { name: 'Josh Oviatt', id: 'inv_ce0675be', portal: 'joviatt', sepWd: 795.00 },
    { name: 'Whit Miller', id: 'inv_ea8b4eba', portal: 'wmiller', sepWd: 700.00 },
    { name: 'Jean Harder', id: 'inv_bc1bcb0c', portal: 'jharder', sepWd: 1500.00 }
  ];

  const septFundReturn = new Decimal('0.0307');

  for (const acc of accountsToAnalyze) {
    const dash = await buildInvestorDashboard(acc.portal, null, { mustBeAuthoritative: true });
    const currentBal = new Decimal(dash.summary.currentBalance);

    const { data: inv } = await supabase.from('investors').select('*').eq('id', acc.id === 'stout001' ? 'stout001' : acc.id).single();
    const splitPct = new Decimal(inv?.split_pct || 50).div(100);

    const { data: septHist } = await supabase.from('investor_monthly_history').select('*').eq('investor_id', acc.id).eq('year', 2026).eq('month_number', 9).single();
    const { data: octHist } = await supabase.from('investor_monthly_history').select('*').eq('investor_id', acc.id).eq('year', 2026).eq('month_number', 10).single();

    console.log(`--------------------------------------------------------------------------------`);
    console.log(`${acc.name} (${acc.portal} / ${acc.id}) | Split: ${(splitPct.mul(100)).toFixed(1)}%`);
    console.log(`  Current Settled Balance BEFORE: $${currentBal.toFixed(2)}`);

    if (acc.sepWd) {
      const wd = new Decimal(acc.sepWd);
      const sOpen = new Decimal(septHist.opening_balance);
      const sDep = new Decimal(septHist.deposits);
      const sWdOld = new Decimal(septHist.withdrawals);
      const sWdNew = sWdOld.add(wd);

      const basisOld = sOpen.add(sDep).sub(sWdOld);
      const basisNew = sOpen.add(sDep).sub(sWdNew);

      const gainOld = basisOld.mul(septFundReturn).mul(splitPct);
      const gainNew = basisNew.mul(septFundReturn).mul(splitPct);

      const endOld = basisOld.add(gainOld);
      const endNew = basisNew.add(gainNew);

      const diffGain = gainOld.sub(gainNew);
      const diffEnd = endOld.sub(endNew);

      console.log(`  [September Locked Withdrawal: -$${wd.toFixed(2)}]`);
      console.log(`    September Opening:        $${sOpen.toFixed(2)}`);
      console.log(`    September Withdrawals:    BEFORE: $${sWdOld.toFixed(2)} | AFTER: $${sWdNew.toFixed(2)}`);
      console.log(`    September Trading Basis:  BEFORE: $${basisOld.toFixed(2)} | AFTER: $${basisNew.toFixed(2)}`);
      console.log(`    September Gain:           BEFORE: $${gainOld.toFixed(2)} | AFTER: $${gainNew.toFixed(2)} (diff: -$${diffGain.toFixed(2)})`);
      console.log(`    September Ending:         BEFORE: $${endOld.toFixed(2)} | AFTER: $${endNew.toFixed(2)} (diff: -$${diffEnd.toFixed(2)})`);
      console.log(`    October Carryforward AFTER: $${endNew.toFixed(2)}`);
    }

    if (acc.octDep) {
      const dep = new Decimal(acc.octDep);
      const newBal = currentBal.add(dep);
      console.log(`  [October Settled Deposit: +$${dep.toFixed(2)}]`);
      console.log(`    Expected Current Settled Balance AFTER: $${newBal.toFixed(2)} (+${dep.toFixed(2)})`);
    }

    if (acc.octWd) {
      const wd = new Decimal(acc.octWd);
      const newBal = currentBal.sub(wd);
      console.log(`  [October Settled Withdrawal: -$${wd.toFixed(2)}]`);
      console.log(`    Expected Current Settled Balance AFTER: $${newBal.toFixed(2)} (-${wd.toFixed(2)})`);
    }

    if (acc.novDep) {
      const dep = new Decimal(acc.novDep);
      console.log(`  [November Future Deposit: +$${dep.toFixed(2)}]`);
      console.log(`    October Settled Balance Impact: $0.00 (Future-dated, applies in November)`);
    }
  }
}

main().catch(console.error);
