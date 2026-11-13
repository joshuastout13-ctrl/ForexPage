import { sql } from './inspect_internal_transfer_rpc.mjs';
import Decimal from 'decimal.js';

async function main() {
  console.log('=== TASK 7: BLAST RADIUS AUDIT — ALL COMMISSION RECIPIENTS ===\n');

  // 1. Get all recipients who had August 2026 commissions
  const augComms = await sql(`
    SELECT ce.recipient_id,
           coalesce(inv.portal_username, ce.recipient_id) as portal_username,
           coalesce(inv.first_name || ' ' || inv.last_name, 'Unknown') as name,
           sum(ce.amount) as total_aug_comm,
           count(*) as row_count
    FROM commission_earnings ce
    LEFT JOIN investors inv ON ce.recipient_id = inv.id
    WHERE ce.year = 2026 AND ce.month_number = 8 AND ce.status = 'ACTIVE'
    GROUP BY ce.recipient_id, inv.portal_username, inv.first_name, inv.last_name
    ORDER BY total_aug_comm DESC;
  `);

  console.log(`Found ${augComms.data.length} active commission recipients in August 2026:`);

  // 2. Fetch their August ending balance and September opening balance
  const recipientIds = augComms.data.map(r => r.recipient_id);
  const histRows = await sql(`
    SELECT h.investor_id, h.month_number, h.opening_balance, h.ending_balance, h.deposits, h.withdrawals
    FROM investor_monthly_history h
    WHERE h.year = 2026 AND h.month_number IN (8, 9) AND h.investor_id IN ('${recipientIds.join("','")}')
    ORDER BY h.investor_id, h.month_number;
  `);

  const histByInv = new Map();
  histRows.data.forEach(h => {
    if (!histByInv.has(h.investor_id)) histByInv.set(h.investor_id, {});
    histByInv.get(h.investor_id)[h.month_number] = h;
  });

  // Also check external deposits and withdrawals in September
  const sepDeps = await sql(`
    SELECT investor_id, sum(amount) as total_dep
    FROM deposits
    WHERE year = 2026 AND month_number = 9
    GROUP BY investor_id;
  `);
  const depMap = new Map();
  if (Array.isArray(sepDeps.data)) {
    sepDeps.data.forEach(d => depMap.set(d.investor_id, Number(d.total_dep)));
  }

  const sepWds = await sql(`
    SELECT investor_id, sum(amount) as total_wd
    FROM withdrawals
    WHERE year = 2026 AND month_number = 9
    GROUP BY investor_id;
  `);
  const wdMap = new Map();
  if (Array.isArray(sepWds.data)) {
    sepWds.data.forEach(w => wdMap.set(w.investor_id, Number(w.total_wd)));
  }

  console.log('\nRecipients August Commission vs September Opening Rollforward:');
  console.log('----------------------------------------------------------------------------------------------------------------------------------------');
  console.log('Recipient ID | Portal | Name | Aug Comm | Aug Ending | Sep Opening | Net Sep Cashflow | Delta (SepOpen - AugEnd) | Comm Added to Sep?');
  console.log('----------------------------------------------------------------------------------------------------------------------------------------');

  for (const r of augComms.data) {
    const invId = r.recipient_id;
    const h = histByInv.get(invId) || {};
    const augEnd = h[8] ? Number(h[8].ending_balance) : null;
    const sepOpen = h[9] ? Number(h[9].opening_balance) : null;
    const augComm = Number(r.total_aug_comm);

    const dep = depMap.get(invId) || 0;
    const wd = wdMap.get(invId) || 0;
    const netCash = dep - wd;

    let delta = null;
    let commStatus = 'UNKNOWN';

    if (augEnd !== null && sepOpen !== null) {
      delta = sepOpen - augEnd;
      // Is delta close to augComm + netCash?
      const expectedDelta = augComm + netCash;
      if (Math.abs(delta - expectedDelta) < 0.05) {
        commStatus = '✅ CAPITALIZED FULLY';
      } else if (Math.abs(delta - netCash) < 0.05) {
        commStatus = '❌ COMPLETELY OMITTED ($0 added)';
      } else {
        commStatus = `⚠️ PARTIAL/DIFF (Delta=${delta.toFixed(2)}, Exp=${expectedDelta.toFixed(2)})`;
      }
    } else {
      commStatus = '⚠️ NO HISTORY ROW (Account may not have history)';
    }

    console.log(`${invId} | ${r.portal_username.padEnd(10)} | ${r.name.padEnd(20)} | ${augComm.toFixed(2).padStart(9)} | ${(augEnd !== null ? augEnd.toFixed(2) : 'N/A').padStart(11)} | ${(sepOpen !== null ? sepOpen.toFixed(2) : 'N/A').padStart(11)} | ${netCash.toFixed(2).padStart(8)} | ${(delta !== null ? delta.toFixed(2) : 'N/A').padStart(10)} | ${commStatus}`);
  }
}

main().catch(console.error);
