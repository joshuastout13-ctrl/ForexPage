import fs from 'fs';
import Decimal from 'decimal.js';
import { supabase } from '../lib/supabase.js';

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

async function main() {
  console.log('=== GENERATING STEP 3 AND STEP 4 (AND 5-7) SQL STATEMENTS ===');

  // 1. STEP 3: Recovered August commission rows
  const recoveredAug = JSON.parse(fs.readFileSync('supabase/artifacts/recovered_august_commission_rows.json', 'utf8'));
  const augSum = recoveredAug.reduce((acc, r) => acc.add(new Decimal(r.amount)), new Decimal(0));
  console.log(`August Recovered: ${recoveredAug.length} rows, Sum: $${augSum.toFixed(2)}`);

  const step3Values = recoveredAug.map(r => {
    return `  ('stout001', '${r.source}', NULL, 2026, 8, ${Number(r.amount).toFixed(2)}, '2.0.0_recovered', 'ACTIVE', NOW())`;
  }).join(',\n');

  const step3Sql = `-- =============================================================================
-- STEP 3: INSERT EXACT 75 RECOVERED AUGUST 2026 COMMISSION ROWS FOR JOSH STOUT
-- Target: commission_earnings
-- Total amount: $11,153.73 | Status: ACTIVE | Recipient: stout001
-- =============================================================================
INSERT INTO commission_earnings (
  recipient_id, source_investor_id, source_account_id,
  year, month_number, amount,
  calculation_version, status, created_at
) VALUES
${step3Values};
`;

  // 2. STEP 4: Compute authoritative September 2026 commissions
  const { data: investors } = await supabase.from('investors').select('*');
  const invMap = new Map(investors.map(i => [i.id, i]));
  const { data: accounts } = await supabase.from('investor_accounts').select('*').eq('status', 'Active');
  const { data: augHist } = await supabase.from('investor_monthly_history').select('*').eq('year', 2026).eq('month_number', 8);
  const augEndingMap = new Map(augHist.map(h => [h.investor_id, Number(h.ending_balance || 0)]));

  const { data: deps } = await supabase.from('deposits').select('*');
  const { data: wds } = await supabase.from('withdrawals').select('*');

  const sepDepsByInv = {};
  deps.forEach(d => {
    const dt = d.effective_accounting_date || d.date;
    if (dt >= '2026-09-01' && dt <= '2026-09-30' && (!d.status || !d.status.toLowerCase().includes('void'))) {
      sepDepsByInv[d.investor_id] = (sepDepsByInv[d.investor_id] || new Decimal(0)).add(new Decimal(d.amount));
    }
  });

  const sepWdsByInv = {};
  wds.forEach(w => {
    const dt = w.effective_accounting_date || w.request_date;
    if (dt >= '2026-09-01' && dt <= '2026-09-30' && ['approved', 'completed'].includes(String(w.status).toLowerCase())) {
      sepWdsByInv[w.investor_id] = (sepWdsByInv[w.investor_id] || new Decimal(0)).add(new Decimal(w.amount));
    }
  });

  const sepReturn = new Decimal('3.07').div(100);

  const sourceProfits = {};
  for (const acc of accounts) {
    const inv = invMap.get(acc.investor_id);
    if (!inv || (inv.start_date && inv.start_date > '2026-09-30')) continue;

    let openBal = new Decimal(augEndingMap.get(acc.investor_id) || acc.starting_capital || 0);
    if (acc.open_date && acc.open_date >= '2026-09-01' && acc.open_date <= '2026-09-30') {
      openBal = new Decimal(acc.starting_capital || 0);
    }
    const d = sepDepsByInv[acc.investor_id] || new Decimal(0);
    const w = sepWdsByInv[acc.investor_id] || new Decimal(0);
    const adjBasis = openBal.add(d).sub(w);

    if (adjBasis.gt(0)) {
      sourceProfits[acc.investor_id] = {
        name: `${inv.first_name} ${inv.last_name}`,
        adjBasis,
        grossProfit: adjBasis.mul(sepReturn)
      };
    }
  }

  const { data: allShares } = await supabase.from('commission_shares').select('*');

  // Case A: Strictly Authoritative September-period rules (created <= 2026-09-30)
  const caseAShares = allShares.filter(s => {
    if (s.created_at >= '2026-10-01T00:00:00Z') return false;
    const start = s.effective_start_date || '2000-01-01';
    const end = s.effective_end_date || '9999-12-31';
    if (start > '2026-09-30' || end < '2026-09-01') return false;
    if (s.status === 'cancelled') {
      return s.updated_at >= '2026-10-01T00:00:00Z' && end >= '2026-09-30';
    }
    return s.status === 'active';
  });

  const sepCommRows = [];
  let totalSepComm = new Decimal(0);
  let joshSepComm = new Decimal(0);
  let joshRowCount = 0;

  for (const s of caseAShares) {
    const src = sourceProfits[s.source_investor_id];
    if (!src || src.grossProfit.lte(0)) continue;

    const commPct = new Decimal(s.commission_percent).div(100);
    const amt = src.grossProfit.mul(commPct);
    const rounded = new Decimal(amt.toFixed(2));

    if (rounded.gt(0)) {
      totalSepComm = totalSepComm.add(rounded);
      sepCommRows.push({
        recipient_id: s.recipient_investor_id,
        source_investor_id: s.source_investor_id,
        source_account_id: s.source_account_id || null,
        year: 2026,
        month_number: 9,
        amount: Number(rounded.toFixed(2)),
        commission_percent_snapshot: s.commission_percent,
        commission_share_rule_id: s.id,
        calculation_version: '2.0.0_authoritative',
        status: 'ACTIVE'
      });

      if (s.recipient_investor_id === 'stout001') {
        joshSepComm = joshSepComm.add(rounded);
        joshRowCount++;
      }
    }
  }

  console.log(`September Commissions: ${sepCommRows.length} rows, Sum: $${totalSepComm.toFixed(2)}`);
  console.log(`Josh September Commissions: ${joshRowCount} rows, Sum: $${joshSepComm.toFixed(2)}`);

  const step4Values = sepCommRows.map(r => {
    const acc = r.source_account_id ? `'${r.source_account_id}'` : 'NULL';
    const rule = r.commission_share_rule_id ? `'${r.commission_share_rule_id}'` : 'NULL';
    const pct = r.commission_percent_snapshot !== null ? r.commission_percent_snapshot : 'NULL';
    return `  ('${r.recipient_id}', '${r.source_investor_id}', ${acc}, 2026, 9, ${r.amount.toFixed(2)}, ${pct}, ${rule}, '2.0.0_authoritative', 'ACTIVE', NOW())`;
  }).join(',\n');

  const step4Sql = `-- =============================================================================
-- STEP 4: INSERT EXACT 303 AUTHORITATIVE SEPTEMBER 2026 COMMISSION ROWS
-- Target: commission_earnings
-- Total amount: $${totalSepComm.toFixed(2)} across ${sepCommRows.length} rows
-- Josh Stout portion: $${joshSepComm.toFixed(2)} across ${joshRowCount} rows
-- Status: ACTIVE
-- =============================================================================
INSERT INTO commission_earnings (
  recipient_id, source_investor_id, source_account_id,
  year, month_number, amount,
  commission_percent_snapshot, commission_share_rule_id,
  calculation_version, status, created_at
) VALUES
${step4Values};
`;

  // Write out steps 3 and 4 to files for review and execution
  fs.writeFileSync('supabase/artifacts/step3_restore_august_commissions.sql', step3Sql);
  fs.writeFileSync('supabase/artifacts/step4_insert_september_commissions.sql', step4Sql);
  fs.writeFileSync('supabase/artifacts/step3_and_step4_commissions.sql', `${step3Sql}\n\n${step4Sql}`);

  console.log('Successfully written step3 and step4 SQL files to supabase/artifacts/');
}

main().catch(console.error);
