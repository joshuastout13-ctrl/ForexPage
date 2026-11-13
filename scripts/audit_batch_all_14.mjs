process.env.DATA_SOURCE = 'supabase';
import { supabase } from '../lib/supabase.js';
import Decimal from 'decimal.js';

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

async function main() {
  console.log('=== FAST BATCH AUDIT OF ALL 14 RECIPIENTS ===\n');

  const recipientIds = [
    'inv_4d52f6a4', // David Townley
    'stout001',     // Joshua Stout
    'inv_015f3774', // Stone & Co Owners
    'inv_920b8af8', // Ross Wamsley
    'inv_e1d4f2af', // Josh Richards
    'inv_d0f857c7', // Jacob Wamsley
    'inv_df9fbf05', // David Valdes
    'inv_d2ab6da4', // Michael Beck
    'inv_a79798ca', // Ted Boardwalk
    'inv_d3ec0cf8', // Adam Richards
    'inv_57a1a49a', // Bill and Mary Kimball
    'inv_6a1b838a', // Val Taylor
    'inv_a7e429ce', // Jim Colby
    'inv_141417dc'  // Nelson Guyer
  ];

  const [
    { data: investors },
    { data: accounts },
    { data: commEarnings },
    { data: history },
    { data: deposits },
    { data: withdrawals }
  ] = await Promise.all([
    supabase.from('investors').select('*').in('id', recipientIds),
    supabase.from('investor_accounts').select('*').in('investor_id', recipientIds),
    supabase.from('commission_earnings').select('*').in('recipient_id', recipientIds).eq('year', 2026).in('month_number', [8, 9]),
    supabase.from('investor_monthly_history').select('*').in('investor_id', recipientIds).eq('year', 2026).in('month_number', [8, 9, 10]),
    supabase.from('deposits').select('*').in('investor_id', recipientIds).gte('date', '2026-09-01').lte('date', '2026-09-30'),
    supabase.from('withdrawals').select('*').in('investor_id', recipientIds).gte('date', '2026-09-01').lte('date', '2026-09-30')
  ]);

  const invMap = new Map((investors || []).map(i => [i.id, i]));
  const accMap = new Map((accounts || []).map(a => [a.investor_id, a]));

  const results = [];

  for (const id of recipientIds) {
    const inv = invMap.get(id);
    const acc = accMap.get(id);

    const ceM8Active = (commEarnings || []).filter(e => e.recipient_id === id && e.month_number === 8 && (!e.status || e.status.toUpperCase() === 'ACTIVE'));
    const ceM8Superseded = (commEarnings || []).filter(e => e.recipient_id === id && e.month_number === 8 && e.status && e.status.toUpperCase() === 'SUPERSEDED');
    const ceM9Active = (commEarnings || []).filter(e => e.recipient_id === id && e.month_number === 9 && (!e.status || e.status.toUpperCase() === 'ACTIVE'));

    const augComm = ceM8Active.reduce((sum, r) => sum.add(new Decimal(r.amount || 0)), new Decimal(0)).toNumber();
    const augCommSuper = ceM8Superseded.reduce((sum, r) => sum.add(new Decimal(r.amount || 0)), new Decimal(0)).toNumber();
    const septComm = ceM9Active.reduce((sum, r) => sum.add(new Decimal(r.amount || 0)), new Decimal(0)).toNumber();

    const hM8 = (history || []).find(h => h.investor_id === id && h.month_number === 8);
    const hM9 = (history || []).find(h => h.investor_id === id && h.month_number === 9);
    const hM10 = (history || []).find(h => h.investor_id === id && h.month_number === 10);

    const augEnding = hM8 ? Number(hM8.ending_balance) : 0;
    const actualSeptOpen = hM9 ? Number(hM9.opening_balance) : 0;
    const septDeps = hM9 ? Number(hM9.deposits) : 0;
    const septWds = hM9 ? Number(hM9.withdrawals) : 0;
    const actualSeptGain = hM9 ? (hM9.manual_gain_amount !== null && hM9.manual_gain_amount !== undefined ? Number(hM9.manual_gain_amount) : Number((new Decimal(actualSeptOpen).add(septDeps).sub(septWds)).mul(hM9.gross_return_pct || 0).div(100).mul(acc?.split_pct ?? inv?.split_pct ?? 100).div(100).toFixed(2))) : 0;
    const actualSeptEnd = hM9 ? Number(hM9.ending_balance) : 0;
    const actualOctOpen = hM10 ? Number(hM10.opening_balance) : 0;

    // Expected September opening:
    // Expected September opening = August ending + August commission earned
    const commCapitalizedIntoSept = actualSeptOpen - augEnding;
    const expectedSeptOpen = augEnding + augComm;
    const openingDelta = actualSeptOpen - expectedSeptOpen;

    const splitPct = Number(acc?.split_pct ?? inv?.split_pct ?? 100);
    const grossReturn = 3.07;
    const correctSeptGain = Number((new Decimal(expectedSeptOpen).add(septDeps).sub(septWds)).mul(grossReturn).div(100).mul(splitPct).div(100).toFixed(2));
    const correctSeptEnd = Number((new Decimal(expectedSeptOpen).add(septDeps).sub(septWds)).add(correctSeptGain).toFixed(2));
    const septEndingDelta = Number(new Decimal(correctSeptEnd).sub(actualSeptEnd).toFixed(2));

    const correctOctOpen = Number(new Decimal(correctSeptEnd).add(septComm).toFixed(2));
    const finalCorrection = Number(new Decimal(correctOctOpen).sub(actualOctOpen).toFixed(2));

    let classification = 'AMBIGUOUS';
    if (Math.abs(openingDelta) < 0.05) {
      classification = 'CORRECT';
    } else if (openingDelta < -0.05) {
      classification = 'UNDERSTATED';
    } else if (openingDelta > 0.05) {
      classification = 'OVERSTATED';
    }

    results.push({
      recipient_id: id,
      name: `${inv?.first_name || ''} ${inv?.last_name || ''}`.trim(),
      portal_username: inv?.portal_username,
      account_id: acc?.id,
      account_name: acc?.name,
      is_commission: acc?.is_commission,
      split_pct: splitPct,
      aug_comm_earned: augComm,
      active_row_count: ceM8Active.length,
      superseded_row_count: ceM8Superseded.length,
      aug_ending_balance: augEnding,
      actual_sept_opening: actualSeptOpen,
      comm_capitalized_into_sept: Number(commCapitalizedIntoSept.toFixed(2)),
      expected_sept_opening: Number(expectedSeptOpen.toFixed(2)),
      opening_delta: Number(openingDelta.toFixed(2)),
      classification,
      sept_cashflows: { deposits: septDeps, withdrawals: septWds },
      actual_sept_gain: actualSeptGain,
      correct_sept_gain: correctSeptGain,
      actual_sept_ending: actualSeptEnd,
      correct_sept_ending: correctSeptEnd,
      sept_ending_delta: septEndingDelta,
      sept_comm_earned: septComm,
      actual_oct_opening: actualOctOpen,
      correct_oct_opening: correctOctOpen,
      final_correction_required: finalCorrection,
      m9_updated_at: hM9?.updated_at
    });
  }

  console.log(JSON.stringify(results, null, 2));
}

main().catch(console.error);
