process.env.DATA_SOURCE = 'supabase';
import { supabase } from '../lib/supabase.js';
import Decimal from 'decimal.js';

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

async function verifyAll() {
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
    { data: deps },
    { data: wds }
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

  console.log('| Account | Recipient Name | Username | Aug Ending | Aug Comm (Active) | Aug Comm (Super) | Actual Sept Open | Expected Sept Open | Open Delta | Actual Sept Gain | Correct Sept Gain | Actual Sept End | Correct Sept End | Sept Comm | Actual Oct Open | Correct Oct Open | Status |');
  console.log('|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|:---:|');

  let totalMissingComm = 0;
  let totalCompoundingImpact = 0;
  let totalCorrection = 0;
  let affectedCount = 0;

  for (const id of recipientIds) {
    const inv = invMap.get(id);
    const acc = accMap.get(id);

    const ceM8Active = (commEarnings || []).filter(e => e.recipient_id === id && e.month_number === 8 && (!e.status || e.status.toUpperCase() === 'ACTIVE'));
    const ceM8Super = (commEarnings || []).filter(e => e.recipient_id === id && e.month_number === 8 && e.status && e.status.toUpperCase() === 'SUPERSEDED');
    const ceM9Active = (commEarnings || []).filter(e => e.recipient_id === id && e.month_number === 9 && (!e.status || e.status.toUpperCase() === 'ACTIVE'));

    const augComm = ceM8Active.reduce((sum, r) => sum.add(new Decimal(r.amount || 0)), new Decimal(0)).toNumber();
    const augCommSuper = ceM8Super.reduce((sum, r) => sum.add(new Decimal(r.amount || 0)), new Decimal(0)).toNumber();
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

    const expectedSeptOpen = augEnding + augComm;
    const openDelta = actualSeptOpen - expectedSeptOpen;

    const splitPct = Number(acc?.split_pct ?? inv?.split_pct ?? 100);
    const grossReturn = 3.07;
    const correctSeptGain = Number((new Decimal(expectedSeptOpen).add(septDeps).sub(septWds)).mul(grossReturn).div(100).mul(splitPct).div(100).toFixed(2));
    const correctSeptEnd = Number((new Decimal(expectedSeptOpen).add(septDeps).sub(septWds)).add(correctSeptGain).toFixed(2));
    const correctOctOpen = Number(new Decimal(correctSeptEnd).add(septComm).toFixed(2));
    const finalCorrection = Number(new Decimal(correctOctOpen).sub(actualOctOpen).toFixed(2));

    const status = Math.abs(openDelta) < 0.05 ? 'CORRECT' : (openDelta < -0.05 ? 'UNDERSTATED' : 'OVERSTATED');

    if (status !== 'CORRECT') {
      affectedCount++;
      totalMissingComm += (expectedSeptOpen - actualSeptOpen);
      totalCompoundingImpact += (correctSeptGain - actualSeptGain);
      totalCorrection += finalCorrection;
    }

    console.log(`| \`${id}\` | ${inv?.first_name} ${inv?.last_name} | \`${inv?.portal_username}\` | $${augEnding.toFixed(2)} | $${augComm.toFixed(2)} | $${augCommSuper.toFixed(2)} | $${actualSeptOpen.toFixed(2)} | $${expectedSeptOpen.toFixed(2)} | $${openDelta.toFixed(2)} | $${actualSeptGain.toFixed(2)} | $${correctSeptGain.toFixed(2)} | $${actualSeptEnd.toFixed(2)} | $${correctSeptEnd.toFixed(2)} | $${septComm.toFixed(2)} | $${actualOctOpen.toFixed(2)} | $${correctOctOpen.toFixed(2)} | **${status}** |`);
  }

  console.log('\n--- TOTALS ---');
  console.log(`Proven affected accounts count: ${affectedCount}`);
  console.log(`Total missing August commission capitalization: $${totalMissingComm.toFixed(2)}`);
  console.log(`Total September compounding impact: $${totalCompoundingImpact.toFixed(2)}`);
  console.log(`Total October/current balance correction: $${totalCorrection.toFixed(2)}`);
}

verifyAll().catch(console.error);
