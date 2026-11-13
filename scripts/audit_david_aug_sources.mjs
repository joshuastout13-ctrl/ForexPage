import { sql } from './inspect_internal_transfer_rpc.mjs';
import Decimal from 'decimal.js';

async function main() {
  console.log('=== TASK 2 & 3: RECONSTRUCTING DAVID TOWNLEY AUGUST COMMISSIONS ===\n');

  // 1. Get David's August commission earnings rows
  const ceRows = await sql(`
    SELECT ce.id, ce.recipient_id, ce.source_investor_id, ce.source_account_id,
           ce.year, ce.month_number, ce.amount, ce.status, ce.created_at,
           ce.calculation_version, ce.superseded_at, ce.superseded_by_audit_id, ce.audit_notes,
           src.portal_username as src_portal, src.first_name as src_fn, src.last_name as src_ln,
           src.split_pct as src_split
    FROM commission_earnings ce
    LEFT JOIN investors src ON ce.source_investor_id = src.id
    WHERE ce.recipient_id = 'inv_4d52f6a4' AND ce.year = 2026 AND ce.month_number = 8
    ORDER BY ce.source_investor_id;
  `);

  console.log(`Found ${ceRows.data.length} August commission rows for David Townley:`);

  // 2. For each source, fetch their August history row
  const sourceIds = ceRows.data.map(r => r.source_investor_id);
  const srcHist = await sql(`
    SELECT h.investor_id, h.opening_balance, h.deposits, h.withdrawals,
           h.gross_return_pct, h.ending_balance, h.locked
    FROM investor_monthly_history h
    WHERE h.year = 2026 AND h.month_number = 8 AND h.investor_id IN ('${sourceIds.join("','")}')
    ORDER BY h.investor_id;
  `);
  const histMap = new Map();
  srcHist.data.forEach(h => histMap.set(h.investor_id, h));

  // 3. For each source, fetch their commission_shares rule for David
  const shares = await sql(`
    SELECT cs.*
    FROM commission_shares cs
    WHERE cs.recipient_investor_id = 'inv_4d52f6a4'
    ORDER BY cs.source_investor_id;
  `);
  const shareMap = new Map();
  shares.data.forEach(s => shareMap.set(s.source_investor_id, s));

  console.log('\nDetailed Breakdown of David Townley August Commission Rows:');
  console.log('---------------------------------------------------------------------------------------------------------------------------------------------------');
  console.log('Source ID | Portal | Name | Aug Opening | Aug Deps | Aug Wds | Trading Basis | Return% | Gross Profit | Share% | Calc Comm | DB Amount | Rule Eff Start | Status');
  console.log('---------------------------------------------------------------------------------------------------------------------------------------------------');

  let totalDb = new Decimal(0);
  let totalCalc = new Decimal(0);

  for (const r of ceRows.data) {
    const h = histMap.get(r.source_investor_id);
    const s = shareMap.get(r.source_investor_id);

    const open = new Decimal(h?.opening_balance || 0);
    const dep = new Decimal(h?.deposits || 0);
    const wd = new Decimal(h?.withdrawals || 0);
    const basis = open.add(dep).sub(wd);
    const retPct = new Decimal(h?.gross_return_pct || 3.03);
    const grossProfit = basis.mul(retPct.div(100));

    const sharePct = new Decimal(s?.commission_percent || 0);
    const calcAmt = grossProfit.mul(sharePct.div(100)).toFixed(2);

    const dbAmt = new Decimal(r.amount);
    totalDb = totalDb.add(dbAmt);
    totalCalc = totalCalc.add(new Decimal(calcAmt));

    console.log(`${r.source_investor_id} | ${r.src_portal.padEnd(10)} | ${(r.src_fn + ' ' + r.src_ln).padEnd(20)} | ${open.toFixed(2).padStart(11)} | ${dep.toFixed(2).padStart(8)} | ${wd.toFixed(2).padStart(7)} | ${basis.toFixed(2).padStart(13)} | ${retPct.toFixed(2)}% | ${grossProfit.toFixed(2).padStart(12)} | ${sharePct.toFixed(1).padStart(5)}% | ${calcAmt.padStart(9)} | ${dbAmt.toFixed(2).padStart(9)} | ${(s?.effective_start_date || 'N/A').padEnd(14)} | ${r.status}`);
  }

  console.log('---------------------------------------------------------------------------------------------------------------------------------------------------');
  console.log(`TOTALS: Calculated = $${totalCalc.toFixed(2)} | In Database = $${totalDb.toFixed(2)} | Discrepancy = $${totalCalc.sub(totalDb).toFixed(2)}`);
}

main().catch(console.error);
