import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import Decimal from 'decimal.js';
import { supabase, isAuthoritativeProductionDbConfigured } from '../lib/supabase.js';
import { buildInvestorDashboard } from '../lib/dashboard.js';

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

function round2(val) {
  if (val === null || val === undefined || isNaN(Number(val))) return 0;
  return new Decimal(val).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
}

process.env.DATA_SOURCE = 'supabase';

async function main() {
  console.log('=== VERIFYING CONTROLS AND EXACT CALCS ===');

  // 1. Commissions for Stout and Boardwalk
  const { data: comms } = await supabase
    .from('commission_earnings')
    .select('*')
    .eq('year', 2026)
    .eq('month_number', 9);

  const stoutComm = (comms || [])
    .filter(c => (c.recipient_id === 'stout001' || c.recipient_id === 'inv_9e9a4bb0') && (!c.status || c.status === 'ACTIVE'))
    .reduce((acc, c) => acc.add(new Decimal(c.amount)), new Decimal(0));

  const tboardComm = (comms || [])
    .filter(c => c.recipient_id === 'inv_a79798ca' && (!c.status || c.status === 'ACTIVE'))
    .reduce((acc, c) => acc.add(new Decimal(c.amount)), new Decimal(0));

  const dtownleyComm = (comms || [])
    .filter(c => c.recipient_id === 'inv_4d52f6a4' && (!c.status || c.status === 'ACTIVE'))
    .reduce((acc, c) => acc.add(new Decimal(c.amount)), new Decimal(0));

  console.log('September Commission Earnings (Active):');
  console.log(`  Josh Stout (stout001):   $${stoutComm.toFixed(2)}`);
  console.log(`  Ted Boardwalk (inv_a79798ca): $${tboardComm.toFixed(2)}`);
  console.log(`  David Townley (inv_4d52f6a4): $${dtownleyComm.toFixed(2)}`);

  // 2. Sheryl Ryan Dunnam History
  const { data: sherylHist } = await supabase
    .from('investor_monthly_history')
    .select('*')
    .eq('investor_id', 'inv_7dc0fe9a')
    .eq('year', 2026)
    .eq('month_number', 9)
    .single();

  const sherylOpen = new Decimal(sherylHist.opening_balance);
  const sherylEnd = new Decimal(sherylHist.ending_balance);
  const sherylGain = sherylEnd.sub(sherylOpen).sub(new Decimal(sherylHist.deposits)).add(new Decimal(sherylHist.withdrawals));
  console.log('\nSheryl Ryan Dunnam September 2026:');
  console.log(`  Opening Balance: $${sherylOpen.toFixed(2)}`);
  console.log(`  Ending Balance:  $${sherylEnd.toFixed(2)}`);
  console.log(`  Gain:            $${sherylGain.toFixed(2)}`);

  // 3. Independent Recalculation for Kevin Rucker
  console.log('\n--- KEVIN RUCKER RECALCULATION ---');
  // Opening: 197722.50220046195
  // Current deposits: 10,000 (dep_29b84085 + dep_10f79b13)
  // Correct deposits: 5,000 (dep_10f79b13 preserved, dep_29b84085 voided)
  // Withdrawals: 0
  // Monthly draw: 0
  // Gross return: 3.07% (0.0307)
  // Profit split: 50% (0.50)
  const kOpen = new Decimal('197722.50220046195');
  const kGrossRet = new Decimal('0.0307');
  const kSplit = new Decimal('0.50');

  // BEFORE
  const kDepBefore = new Decimal('10000.00');
  const kBasisBefore = kOpen.add(kDepBefore);
  const kGainBefore = kBasisBefore.mul(kGrossRet).mul(kSplit);
  const kEndBefore = kBasisBefore.add(kGainBefore);

  // AFTER
  const kDepAfter = new Decimal('5000.00');
  const kBasisAfter = kOpen.add(kDepAfter);
  const kGainAfter = kBasisAfter.mul(kGrossRet).mul(kSplit);
  const kEndAfter = kBasisAfter.add(kGainAfter);

  const kDiffDep = kDepBefore.sub(kDepAfter);
  const kDiffGain = kGainBefore.sub(kGainAfter);
  const kDiffEnd = kEndBefore.sub(kEndAfter);

  console.log('Kevin Rucker (inv_7e7dcda2):');
  console.log(`  September Opening:     $${kOpen.toFixed(4)} (stored: $197,722.50)`);
  console.log(`  Deposits BEFORE:       $${kDepBefore.toFixed(2)}`);
  console.log(`  Deposits AFTER:        $${kDepAfter.toFixed(2)}`);
  console.log(`  Trading Basis BEFORE:  $${kBasisBefore.toFixed(4)}`);
  console.log(`  Trading Basis AFTER:   $${kBasisAfter.toFixed(4)}`);
  console.log(`  Trading Gain BEFORE:   $${kGainBefore.toFixed(4)} (cents: $${kGainBefore.toFixed(2)})`);
  console.log(`  Trading Gain AFTER:    $${kGainAfter.toFixed(4)} (cents: $${kGainAfter.toFixed(2)})`);
  console.log(`  Ending Balance BEFORE: $${kEndBefore.toFixed(4)} (cents: $${kEndBefore.toFixed(2)})`);
  console.log(`  Ending Balance AFTER:  $${kEndAfter.toFixed(4)} (cents: $${kEndAfter.toFixed(2)})`);
  console.log(`  October Opening BEFORE: $${kEndBefore.toFixed(2)}`);
  console.log(`  October Opening AFTER:  $${kEndAfter.toFixed(2)}`);
  console.log(`  October Settled Cashflows: $0.00`);
  console.log(`  October Current Settled Balance BEFORE: $${kEndBefore.toFixed(2)}`);
  console.log(`  October Current Settled Balance AFTER:  $${kEndAfter.toFixed(2)}`);
  console.log(`  Exact Balance Correction: -$${kDiffEnd.toFixed(2)} (-$5,000 principal - $${kDiffGain.toFixed(2)} trading gain)`);

  // 4. Independent Recalculation for Neal Waite
  console.log('\n--- NEAL WAITE RECALCULATION ---');
  // Opening: 534279.1025795467
  // Current deposits: 25,200 (dep_d75d7f29 + dep_576913ae)
  // Correct deposits: 12,600 (dep_576913ae preserved, dep_d75d7f29 voided)
  // Withdrawals: 7,000
  // Monthly draw: 0
  // Gross return: 3.07% (0.0307)
  // Profit split: 50% (0.50)
  const nOpen = new Decimal('534279.1025795467');
  const nWd = new Decimal('7000.00');
  const nGrossRet = new Decimal('0.0307');
  const nSplit = new Decimal('0.50');

  // BEFORE
  const nDepBefore = new Decimal('25200.00');
  const nBasisBefore = nOpen.add(nDepBefore).sub(nWd);
  const nGainBefore = nBasisBefore.mul(nGrossRet).mul(nSplit);
  const nEndBefore = nBasisBefore.add(nGainBefore);

  // AFTER
  const nDepAfter = new Decimal('12600.00');
  const nBasisAfter = nOpen.add(nDepAfter).sub(nWd);
  const nGainAfter = nBasisAfter.mul(nGrossRet).mul(nSplit);
  const nEndAfter = nBasisAfter.add(nGainAfter);

  const nDiffDep = nDepBefore.sub(nDepAfter);
  const nDiffGain = nGainBefore.sub(nGainAfter);
  const nDiffEnd = nEndBefore.sub(nEndAfter);

  console.log('Neal Waite (inv_d8b5ab06):');
  console.log(`  September Opening:     $${nOpen.toFixed(4)} (stored: $534,279.10)`);
  console.log(`  Deposits BEFORE:       $${nDepBefore.toFixed(2)}`);
  console.log(`  Deposits AFTER:        $${nDepAfter.toFixed(2)}`);
  console.log(`  Withdrawals:           $${nWd.toFixed(2)}`);
  console.log(`  Trading Basis BEFORE:  $${nBasisBefore.toFixed(4)}`);
  console.log(`  Trading Basis AFTER:   $${nBasisAfter.toFixed(4)}`);
  console.log(`  Trading Gain BEFORE:   $${nGainBefore.toFixed(4)} (cents: $${nGainBefore.toFixed(2)})`);
  console.log(`  Trading Gain AFTER:    $${nGainAfter.toFixed(4)} (cents: $${nGainAfter.toFixed(2)})`);
  console.log(`  Ending Balance BEFORE: $${nEndBefore.toFixed(4)} (cents: $${nEndBefore.toFixed(2)})`);
  console.log(`  Ending Balance AFTER:  $${nEndAfter.toFixed(4)} (cents: $${nEndAfter.toFixed(2)})`);
  console.log(`  October Opening BEFORE: $${nEndBefore.toFixed(2)}`);
  console.log(`  October Opening AFTER:  $${nEndAfter.toFixed(2)}`);
  console.log(`  October Settled Cashflows: $0.00`);
  console.log(`  October Current Settled Balance BEFORE: $${nEndBefore.toFixed(2)}`);
  console.log(`  October Current Settled Balance AFTER:  $${nEndAfter.toFixed(2)}`);
  console.log(`  Exact Balance Correction: -$${nDiffEnd.toFixed(2)} (-$12,600 principal - $${nDiffGain.toFixed(2)} trading gain)`);

  // Combined
  const totalPrincipal = kDiffDep.add(nDiffDep);
  const totalGain = kDiffGain.add(nDiffGain);
  const totalCorrection = kDiffEnd.add(nDiffEnd);
  console.log('\n--- COMBINED TOTALS ---');
  console.log(`  Total Duplicate Principal: $${totalPrincipal.toFixed(2)}`);
  console.log(`  Total Gain Correction:     $${totalGain.toFixed(2)}`);
  console.log(`  Total Settled Correction:  $${totalCorrection.toFixed(2)}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
