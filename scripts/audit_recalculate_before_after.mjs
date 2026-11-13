process.env.DATA_SOURCE = 'supabase';
import fs from 'fs';
import { supabase } from '../lib/supabase.js';

async function main() {
  console.log('=== AUDITING BEFORE -> AFTER OF RECALCULATE-ALL (03:50:05 UTC) ===\n');

  // Parse step6 SQL to get pre-recalculation September values
  const step6Content = fs.readFileSync('supabase/artifacts/step6_upsert_september_history.sql', 'utf8');
  const step6Regex = /\('([^']+)',\s*2026,\s*9,\s*'September',\s*([0-9.-]+),\s*([0-9.-]+),\s*([0-9.-]+),\s*([0-9.-]+),\s*(NULL|[0-9.-]+),\s*(NULL|[0-9.-]+),\s*([0-9.-]+),\s*([0-9.-]+),\s*(TRUE|FALSE),\s*(TRUE|FALSE)/gi;
  
  const step6Map = new Map();
  let match;
  while ((match = step6Regex.exec(step6Content)) !== null) {
    step6Map.set(match[1], {
      opening: Number(match[2]),
      deps: Number(match[3]),
      wds: Number(match[4]),
      grossRet: Number(match[5]),
      ending: Number(match[10])
    });
  }

  // Parse step7 SQL to get pre-recalculation October values
  const step7Content = fs.readFileSync('supabase/artifacts/step7_upsert_october_history.sql', 'utf8');
  const step7Regex = /\('([^']+)',\s*2026,\s*10,\s*'October',\s*([0-9.-]+),\s*([0-9.-]+),\s*([0-9.-]+),\s*([0-9.-]+),\s*(NULL|[0-9.-]+),\s*(NULL|[0-9.-]+),\s*([0-9.-]+),\s*([0-9.-]+),\s*(TRUE|FALSE),\s*(TRUE|FALSE)/gi;
  
  const step7Map = new Map();
  while ((match = step7Regex.exec(step7Content)) !== null) {
    step7Map.set(match[1], {
      opening: Number(match[2]),
      deps: Number(match[3]),
      wds: Number(match[4]),
      grossRet: Number(match[5]),
      ending: Number(match[10])
    });
  }

  // Fetch current database state for month 9 and month 10
  const { data: dbHistory } = await supabase
    .from('investor_monthly_history')
    .select('*')
    .eq('year', 2026)
    .in('month_number', [9, 10]);

  const dbM9Map = new Map(dbHistory.filter(h => h.month_number === 9).map(h => [h.investor_id, h]));
  const dbM10Map = new Map(dbHistory.filter(h => h.month_number === 10).map(h => [h.investor_id, h]));

  const { data: investors } = await supabase.from('investors').select('id, portal_username, first_name, last_name, split_pct');
  const invMap = new Map((investors || []).map(i => [i.id, i]));

  // Compare September
  const septChanges = [];
  for (const [invId, before] of step6Map.entries()) {
    const after = dbM9Map.get(invId);
    if (!after) continue;

    const openDiff = Number((Number(after.opening_balance) - before.opening).toFixed(2));
    const endDiff = Number((Number(after.ending_balance) - before.ending).toFixed(2));

    if (Math.abs(openDiff) > 0.05 || Math.abs(endDiff) > 0.05) {
      const inv = invMap.get(invId);
      septChanges.push({
        id: invId,
        username: inv?.portal_username || invId,
        name: `${inv?.first_name || ''} ${inv?.last_name || ''}`.trim(),
        before_open: before.opening,
        after_open: Number(Number(after.opening_balance).toFixed(2)),
        open_diff: openDiff,
        before_end: before.ending,
        after_end: Number(Number(after.ending_balance).toFixed(2)),
        end_diff: endDiff,
        updated_at: after.updated_at
      });
    }
  }

  // Compare October
  const octChanges = [];
  for (const [invId, before] of step7Map.entries()) {
    const after = dbM10Map.get(invId);
    if (!after) continue;

    const openDiff = Number((Number(after.opening_balance) - before.opening).toFixed(2));
    const endDiff = Number((Number(after.ending_balance) - before.ending).toFixed(2));

    if (Math.abs(openDiff) > 0.05 || Math.abs(endDiff) > 0.05) {
      const inv = invMap.get(invId);
      octChanges.push({
        id: invId,
        username: inv?.portal_username || invId,
        name: `${inv?.first_name || ''} ${inv?.last_name || ''}`.trim(),
        before_open: before.opening,
        after_open: Number(Number(after.opening_balance).toFixed(2)),
        open_diff: openDiff,
        before_end: before.ending,
        after_end: Number(Number(after.ending_balance).toFixed(2)),
        end_diff: endDiff,
        updated_at: after.updated_at
      });
    }
  }

  console.log(`Total September accounts in baseline: ${step6Map.size}`);
  console.log(`September accounts changed by recalculate-all: ${septChanges.length}`);
  console.log('\n--- SEPTEMBER CHANGES (BEFORE -> AFTER) ---');
  console.log(JSON.stringify(septChanges, null, 2));

  console.log(`\nTotal October accounts in baseline: ${step7Map.size}`);
  console.log(`October accounts changed by recalculate-all: ${octChanges.length}`);
  console.log('\n--- OCTOBER CHANGES (BEFORE -> AFTER) ---');
  console.log(JSON.stringify(octChanges, null, 2));

  // Also check commission_earnings: did ANY row change or get updated at 03:50:05?
  const { data: ceCheck } = await supabase
    .from('commission_earnings')
    .select('id, recipient_id, year, month_number, created_at, status')
    .gte('created_at', '2026-10-06T00:00:00Z');
  console.log('\n--- COMMISSION EARNINGS WRITTEN IN LAST 2 DAYS ---');
  console.log(`Rows created in commission_earnings in last 2 days: ${ceCheck?.length || 0}`);
}

main().catch(console.error);
