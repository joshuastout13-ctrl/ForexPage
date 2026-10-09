import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import Decimal from 'decimal.js';
import { supabase } from '../lib/supabase.js';

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });
process.env.DATA_SOURCE = 'supabase';

async function checkSpecialCases() {
  console.log('=== INVESTIGATING SPECIAL CASES ===\n');

  // 1. Michele Jackson (inv_3eae6871)
  console.log('--- 1. MICHELE JACKSON (inv_3eae6871) ---');
  const { data: mjInv } = await supabase.from('investors').select('*').eq('id', 'inv_3eae6871');
  const { data: mjAcc } = await supabase.from('investor_accounts').select('*').eq('investor_id', 'inv_3eae6871');
  const { data: mjDeps } = await supabase.from('deposits').select('*').eq('investor_id', 'inv_3eae6871');
  const { data: mjHist } = await supabase.from('investor_monthly_history').select('*').eq('investor_id', 'inv_3eae6871').order('month_number', { ascending: true });
  console.log('Investor:', mjInv);
  console.log('Accounts:', mjAcc);
  console.log('Deposits:', mjDeps);
  console.log('Monthly History:', mjHist);

  // 2. Reagan Ruddell (inv_9a4326e7)
  console.log('\n--- 2. REAGAN RUDDELL (inv_9a4326e7) ---');
  const { data: rrInv } = await supabase.from('investors').select('*').eq('id', 'inv_9a4326e7');
  const { data: rrAcc } = await supabase.from('investor_accounts').select('*').eq('investor_id', 'inv_9a4326e7');
  const { data: rrDeps } = await supabase.from('deposits').select('*').eq('investor_id', 'inv_9a4326e7');
  const { data: rrHist } = await supabase.from('investor_monthly_history').select('*').eq('investor_id', 'inv_9a4326e7').order('month_number', { ascending: true });
  console.log('Investor:', rrInv);
  console.log('Accounts:', rrAcc);
  console.log('Deposits:', rrDeps);
  console.log('Monthly History:', rrHist);

  // 3. Sheryl Alvarado / Sheryl Ryan Dunnam (inv_7dc0fe9a)
  console.log('\n--- 3. SHERYL ALVARADO / DUNNAM (inv_7dc0fe9a) ---');
  const { data: saInv } = await supabase.from('investors').select('*').eq('id', 'inv_7dc0fe9a');
  const { data: saAcc } = await supabase.from('investor_accounts').select('*').eq('investor_id', 'inv_7dc0fe9a');
  const { data: saDeps } = await supabase.from('deposits').select('*').eq('investor_id', 'inv_7dc0fe9a');
  const { data: saHist } = await supabase.from('investor_monthly_history').select('*').eq('investor_id', 'inv_7dc0fe9a').order('month_number', { ascending: true });
  console.log('Investor:', saInv);
  console.log('Accounts:', saAcc);
  console.log('Deposits:', saDeps);
  console.log('Monthly History:', saHist);

  // 4. Dale Waite (inv_60ed0c32)
  console.log('\n--- 4. DALE WAITE (inv_60ed0c32) ---');
  const { data: dwWds } = await supabase.from('withdrawals').select('*').eq('investor_id', 'inv_60ed0c32').order('created_at', { ascending: true });
  const { data: dwHist } = await supabase.from('investor_monthly_history').select('*').eq('investor_id', 'inv_60ed0c32').order('month_number', { ascending: true });
  console.log('Withdrawals:');
  console.table(dwWds);
  console.log('Monthly History:');
  console.table(dwHist);

  // 5. Jean Harter / Harder (inv_bc1bcb0c)
  console.log('\n--- 5. JEAN HARTER / HARDER (inv_bc1bcb0c) ---');
  const { data: jhWds } = await supabase.from('withdrawals').select('*').eq('investor_id', 'inv_bc1bcb0c').order('created_at', { ascending: true });
  const { data: jhHist } = await supabase.from('investor_monthly_history').select('*').eq('investor_id', 'inv_bc1bcb0c').order('month_number', { ascending: true });
  console.log('Withdrawals:');
  console.table(jhWds);
  console.log('Monthly History:');
  console.table(jhHist);

  // 6. Theresa Kruger (inv_8cf28066)
  console.log('\n--- 6. THERESA KRUGER (inv_8cf28066) ---');
  const { data: tkInv } = await supabase.from('investors').select('*').eq('id', 'inv_8cf28066');
  const { data: tkWds } = await supabase.from('withdrawals').select('*').eq('investor_id', 'inv_8cf28066');
  const { data: tkHist } = await supabase.from('investor_monthly_history').select('*').eq('investor_id', 'inv_8cf28066').order('month_number', { ascending: true });
  console.log('Investor:', tkInv);
  console.log('Withdrawals:', tkWds);
  console.log('Monthly History:');
  console.table(tkHist);

  // 7. Josh Oviatt (inv_ce0675be)
  console.log('\n--- 7. JOSH OVIATT (inv_ce0675be) ---');
  const { data: joWds } = await supabase.from('withdrawals').select('*').eq('investor_id', 'inv_ce0675be');
  const { data: joHist } = await supabase.from('investor_monthly_history').select('*').eq('investor_id', 'inv_ce0675be').order('month_number', { ascending: true });
  console.log('Withdrawals:', joWds);
  console.log('Monthly History:');
  console.table(joHist);

  // 8. Whit Miller (inv_ea8b4eba)
  console.log('\n--- 8. WHIT MILLER (inv_ea8b4eba) ---');
  const { data: wmWds } = await supabase.from('withdrawals').select('*').eq('investor_id', 'inv_ea8b4eba');
  const { data: wmHist } = await supabase.from('investor_monthly_history').select('*').eq('investor_id', 'inv_ea8b4eba').order('month_number', { ascending: true });
  console.log('Withdrawals:', wmWds);
  console.log('Monthly History:');
  console.table(wmHist);

  // 9. Glenn Maddocks (inv_5a509c6a)
  console.log('\n--- 9. GLENN MADDOCKS (inv_5a509c6a) ---');
  const { data: gmInv } = await supabase.from('investors').select('*').eq('id', 'inv_5a509c6a');
  const { data: gmAcc } = await supabase.from('investor_accounts').select('*').eq('investor_id', 'inv_5a509c6a');
  const { data: gmDeps } = await supabase.from('deposits').select('*').eq('investor_id', 'inv_5a509c6a');
  const { data: gmHist } = await supabase.from('investor_monthly_history').select('*').eq('investor_id', 'inv_5a509c6a');
  console.log('Investor:', gmInv);
  console.log('Accounts:', gmAcc);
  console.log('Deposits:', gmDeps);
  console.log('Monthly History:', gmHist);

  // 10. Jack Fuller (inv_693b8042)
  console.log('\n--- 10. JACK FULLER (inv_693b8042) ---');
  const { data: jfInv } = await supabase.from('investors').select('*').eq('id', 'inv_693b8042');
  const { data: jfAcc } = await supabase.from('investor_accounts').select('*').eq('investor_id', 'inv_693b8042');
  const { data: jfDeps } = await supabase.from('deposits').select('*').eq('investor_id', 'inv_693b8042');
  const { data: jfHist } = await supabase.from('investor_monthly_history').select('*').eq('investor_id', 'inv_693b8042');
  console.log('Investor:', jfInv);
  console.log('Accounts:', jfAcc);
  console.log('Deposits:', jfDeps);
  console.log('Monthly History:', jfHist);

  // 11. Kathy Dodge (inv_a829dff6)
  console.log('\n--- 11. KATHY DODGE (inv_a829dff6) ---');
  const { data: kdInv } = await supabase.from('investors').select('*').eq('id', 'inv_a829dff6');
  const { data: kdAcc } = await supabase.from('investor_accounts').select('*').eq('investor_id', 'inv_a829dff6');
  const { data: kdDeps } = await supabase.from('deposits').select('*').eq('investor_id', 'inv_a829dff6');
  const { data: kdHist } = await supabase.from('investor_monthly_history').select('*').eq('investor_id', 'inv_a829dff6');
  console.log('Investor:', kdInv);
  console.log('Accounts:', kdAcc);
  console.log('Deposits:', kdDeps);
  console.log('Monthly History:', kdHist);

  // 12. Brad Holly (inv_5deeea21)
  console.log('\n--- 12. BRAD HOLLY (inv_5deeea21) ---');
  const { data: bhInv } = await supabase.from('investors').select('*').eq('id', 'inv_5deeea21');
  const { data: bhAcc } = await supabase.from('investor_accounts').select('*').eq('investor_id', 'inv_5deeea21');
  const { data: bhDeps } = await supabase.from('deposits').select('*').eq('investor_id', 'inv_5deeea21');
  const { data: bhHist } = await supabase.from('investor_monthly_history').select('*').eq('investor_id', 'inv_5deeea21');
  console.log('Investor:', bhInv);
  console.log('Accounts:', bhAcc);
  console.log('Deposits:', bhDeps);
  console.log('Monthly History:', bhHist);
}

checkSpecialCases().catch(console.error);
