process.env.DATA_SOURCE = 'supabase';
import { supabase } from '../lib/supabase.js';
import { buildInvestorDashboard } from '../lib/dashboard.js';

async function verifyRecovery() {
  console.log('====================================================');
  console.log('VERIFYING SEPTEMBER 2026 & OCTOBER 2026 RECOVERY STATE');
  console.log('====================================================\n');

  // 1. Inspect monthly_returns
  console.log('--- 1. monthly_returns ---');
  const { data: mReturns, error: mErr } = await supabase
    .from('monthly_returns')
    .select('*')
    .eq('year', 2026)
    .in('month_number', [9, 10])
    .order('month_number');
  if (mErr) console.error('Error fetching monthly_returns:', mErr);
  else console.log(JSON.stringify(mReturns, null, 2));

  // 2. Inspect September investor_monthly_history
  console.log('\n--- 2. September 2026 investor_monthly_history ---');
  const { data: septHist, count: septCount, error: septErr } = await supabase
    .from('investor_monthly_history')
    .select('*', { count: 'exact' })
    .eq('year', 2026)
    .eq('month_number', 9);
  
  if (septErr) console.error('Error fetching September history:', septErr);
  else {
    console.log(`Total September history rows: ${septCount}`);
    const lockedCount = septHist.filter(r => r.locked === true).length;
    console.log(`Locked September history rows: ${lockedCount}`);
    
    // Check Josh Stout
    const joshSept = septHist.find(r => r.investor_id === 'stout001' || r.investor_id === 'jstout');
    console.log('\nJosh Stout September History:');
    console.log(JSON.stringify(joshSept, null, 2));

    // Check Sheryl Ryan Dunnam
    const sherylSept = septHist.find(r => r.investor_id === 'inv_7dc0fe9a' || r.investor_id === 'sryan');
    console.log('\nSheryl Ryan Dunnam September History:');
    console.log(JSON.stringify(sherylSept, null, 2));
  }

  // 3. Inspect October investor_monthly_history
  console.log('\n--- 3. October 2026 investor_monthly_history ---');
  const { data: octHist, count: octCount, error: octErr } = await supabase
    .from('investor_monthly_history')
    .select('*', { count: 'exact' })
    .eq('year', 2026)
    .eq('month_number', 10);
  
  if (octErr) console.error('Error fetching October history:', octErr);
  else {
    console.log(`Total October history rows: ${octCount}`);
    const unlockedCount = octHist.filter(r => r.locked === false).length;
    console.log(`Unlocked October history rows (locked=false): ${unlockedCount}`);
    
    // Check Josh Stout
    const joshOct = octHist.find(r => r.investor_id === 'stout001' || r.investor_id === 'jstout');
    console.log('\nJosh Stout October History:');
    console.log(JSON.stringify(joshOct, null, 2));

    // Check Sheryl Ryan Dunnam
    const sherylOct = octHist.find(r => r.investor_id === 'inv_7dc0fe9a' || r.investor_id === 'sryan');
    console.log('\nSheryl Ryan Dunnam October History:');
    console.log(JSON.stringify(sherylOct, null, 2));
  }

  // 4. Trace Josh Stout live dashboard
  console.log('\n--- 4. Live Dashboard Presentation for Josh Stout (jstout) ---');
  try {
    const dJosh = await buildInvestorDashboard('jstout', null, { mustBeAuthoritative: true });
    console.log('SUMMARY:');
    console.log(JSON.stringify(dJosh.summary, null, 2));

    console.log('\nMONTHLY BREAKDOWN (Aug, Sept, Oct):');
    dJosh.breakdown
      .filter(b => b.monthNumber >= 8 && b.monthNumber <= 10)
      .forEach(b => {
        const comm = b.commissionAdded != null ? Number(b.commissionAdded).toLocaleString() : '0.00';
        console.log(`Month ${b.monthNumber} (${b.month}): Starting=$${Number(b.startingBalance).toLocaleString()}, Deps=$${Number(b.deposits).toLocaleString()}, Wds=$${Number(b.oneTimeWithdrawal).toLocaleString()}, CommAdded=$${comm}, Gain=$${Number(b.gain).toLocaleString()}, End=$${Number(b.endingBalance).toLocaleString()}, HistComp=${b.isHistoricalCompleted}, Open=${b.isOpenMonth}, Proj=${b.isProjection}`);
      });
  } catch (err) {
    console.error('Error building Josh dashboard:', err);
  }

  // 5. Trace Sheryl Ryan Dunnam live dashboard
  console.log('\n--- 5. Live Dashboard Presentation for Sheryl Ryan Dunnam ---');
  try {
    // Look up portal username for inv_7dc0fe9a
    const { data: invProfile } = await supabase
      .from('investor_accounts')
      .select('id, portal_username, display_name')
      .eq('id', 'inv_7dc0fe9a')
      .single();
    console.log('Sheryl account profile:', invProfile);
    const username = invProfile?.portal_username || 'inv_7dc0fe9a';

    const dSheryl = await buildInvestorDashboard(username, null, { mustBeAuthoritative: true });
    console.log('SUMMARY:');
    console.log(JSON.stringify(dSheryl.summary, null, 2));

    console.log('\nMONTHLY BREAKDOWN (Aug, Sept, Oct):');
    dSheryl.breakdown
      .filter(b => b.monthNumber >= 8 && b.monthNumber <= 10)
      .forEach(b => {
        const comm = b.commissionAdded != null ? Number(b.commissionAdded).toLocaleString() : '0.00';
        console.log(`Month ${b.monthNumber} (${b.month}): Starting=$${Number(b.startingBalance).toLocaleString()}, Deps=$${Number(b.deposits).toLocaleString()}, Wds=$${Number(b.oneTimeWithdrawal).toLocaleString()}, CommAdded=$${comm}, Gain=$${Number(b.gain).toLocaleString()}, End=$${Number(b.endingBalance).toLocaleString()}, HistComp=${b.isHistoricalCompleted}, Open=${b.isOpenMonth}, Proj=${b.isProjection}`);
      });
  } catch (err) {
    console.error('Error building Sheryl dashboard:', err);
  }
}

verifyRecovery().catch(console.error);
