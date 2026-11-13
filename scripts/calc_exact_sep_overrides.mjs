import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import Decimal from 'decimal.js';
import { supabase } from '../lib/supabase.js';

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

async function calcExact() {
  console.log('=== EXACT RECALCULATION OF SEPTEMBER 2026 OVERRIDES ===\n');

  const septFundReturn = new Decimal('0.0307'); // +3.07%

  const sepAccounts = [
    { name: 'Josh Oviatt', invId: 'inv_ce0675be', accId: 'joviatt', wdAmount: new Decimal('795.00') },
    { name: 'Whit Miller', invId: 'inv_ea8b4eba', accId: 'wmiller', wdAmount: new Decimal('700.00') },
    { name: 'Jean Harder', invId: 'inv_bc1bcb0c', accId: 'jharder', wdAmount: new Decimal('1500.00') }
  ];

  for (const item of sepAccounts) {
    const { data: inv } = await supabase.from('investors').select('*').eq('id', item.invId).single();
    const splitPct = new Decimal(inv.split_pct).div(100);

    const { data: sepHist } = await supabase
      .from('investor_monthly_history')
      .select('*')
      .eq('investor_id', item.invId)
      .eq('year', 2026)
      .eq('month_number', 9)
      .single();

    const { data: octHist } = await supabase
      .from('investor_monthly_history')
      .select('*')
      .eq('investor_id', item.invId)
      .eq('year', 2026)
      .eq('month_number', 10)
      .single();

    // Check commissions capitalized in September or October
    const { data: commsSep } = await supabase
      .from('commission_earnings')
      .select('*')
      .eq('recipient_id', item.invId)
      .eq('year', 2026)
      .eq('month_number', 9);

    const { data: commsAug } = await supabase
      .from('commission_earnings')
      .select('*')
      .eq('recipient_id', item.invId)
      .eq('year', 2026)
      .eq('month_number', 8);

    console.log(`--------------------------------------------------------------------------------`);
    console.log(`${item.name} (${item.invId})`);
    console.log(`  Split: ${(splitPct.mul(100)).toFixed(1)}%`);
    console.log(`  Commissions: Aug=${commsAug?.length || 0}, Sep=${commsSep?.length || 0}`);

    const sOpen = new Decimal(sepHist.opening_balance);
    const sDep = new Decimal(sepHist.deposits || 0);
    const sWdOld = new Decimal(sepHist.withdrawals || 0);
    const sWdNew = sWdOld.add(item.wdAmount);

    const basisOld = sOpen.add(sDep).sub(sWdOld);
    const basisNew = sOpen.add(sDep).sub(sWdNew);

    const gainOld = basisOld.mul(septFundReturn).mul(splitPct);
    const gainNew = basisNew.mul(septFundReturn).mul(splitPct);

    const endOld = basisOld.add(gainOld);
    const endNew = basisNew.add(gainNew);

    const diffWd = item.wdAmount;
    const diffGain = gainOld.sub(gainNew);
    const diffEnd = endOld.sub(endNew);

    console.log(`  September Opening:         $${sOpen.toFixed(10)}`);
    console.log(`  September Deposits:        $${sDep.toFixed(2)}`);
    console.log(`  September Withdrawals:     BEFORE: $${sWdOld.toFixed(2)} | AFTER: $${sWdNew.toFixed(2)}`);
    console.log(`  September Trading Basis:   BEFORE: $${basisOld.toFixed(10)} | AFTER: $${basisNew.toFixed(10)}`);
    console.log(`  September Gain:            BEFORE: $${gainOld.toFixed(10)} ($${gainOld.toFixed(2)}) | AFTER: $${gainNew.toFixed(10)} ($${gainNew.toFixed(2)})`);
    console.log(`  Gain Reduction:            -$${diffGain.toFixed(10)} (-$${diffGain.toFixed(2)})`);
    console.log(`  September Ending Balance:  BEFORE: $${endOld.toFixed(10)} ($${endOld.toFixed(2)}) | AFTER: $${endNew.toFixed(10)} ($${endNew.toFixed(2)})`);
    console.log(`  Total Balance Reduction:   -$${diffEnd.toFixed(10)} (-$${diffEnd.toFixed(2)})`);
    console.log(`  Stored Sep Ending in DB:   $${new Decimal(sepHist.ending_balance).toFixed(10)}`);
    console.log(`  Stored Oct Opening in DB:  $${new Decimal(octHist.opening_balance).toFixed(10)}`);
    console.log(`  Stored Oct Ending in DB:   $${new Decimal(octHist.ending_balance).toFixed(10)}`);

    // Let's verify October carryforward
    const octOpenNew = endNew;
    const octDep = new Decimal(octHist.deposits || 0);
    const octWd = new Decimal(octHist.withdrawals || 0);
    const octEndNew = octOpenNew.add(octDep).sub(octWd); // In open month October, settled gain is 0

    console.log(`  New October Opening:       $${octOpenNew.toFixed(10)} ($${octOpenNew.toFixed(2)})`);
    console.log(`  New October Ending:        $${octEndNew.toFixed(10)} ($${octEndNew.toFixed(2)})`);
  }
}

calcExact().catch(console.error);
