import { sql } from './inspect_internal_transfer_rpc.mjs';

async function main() {
  console.log('=== AUDITING AUGUST 2026 COMMISSION RECIPIENTS ===\n');

  // 1. Grouped earnings by recipient and status
  const ceSummary = await sql(`
    SELECT 
      recipient_id,
      status,
      count(*) as row_count,
      sum(amount) as total_amount
    FROM commission_earnings
    WHERE year = 2026 AND month_number = 8
    GROUP BY recipient_id, status
    ORDER BY recipient_id, status;
  `);

  console.log('--- Commission Earnings Summary (August 2026) ---');
  console.log(JSON.stringify(ceSummary.data, null, 2));

  // 2. Distinct recipients and total active / superseded
  const distinctRecipients = await sql(`
    SELECT 
      ce.recipient_id,
      inv.portal_username,
      inv.first_name,
      inv.last_name,
      inv.role,
      inv.active as inv_active,
      inv.split_pct as inv_split,
      acc.id as account_id,
      acc.name as account_name,
      acc.is_commission as acc_is_commission,
      acc.status as acc_status,
      acc.split_pct as acc_split,
      SUM(CASE WHEN ce.status = 'ACTIVE' OR ce.status IS NULL THEN ce.amount ELSE 0 END) as active_amount,
      SUM(CASE WHEN ce.status = 'ACTIVE' OR ce.status IS NULL THEN 1 ELSE 0 END) as active_count,
      SUM(CASE WHEN ce.status = 'SUPERSEDED' THEN ce.amount ELSE 0 END) as superseded_amount,
      SUM(CASE WHEN ce.status = 'SUPERSEDED' THEN 1 ELSE 0 END) as superseded_count
    FROM commission_earnings ce
    LEFT JOIN investors inv ON ce.recipient_id = inv.id
    LEFT JOIN investor_accounts acc ON ce.recipient_id = acc.investor_id
    WHERE ce.year = 2026 AND ce.month_number = 8
    GROUP BY ce.recipient_id, inv.portal_username, inv.first_name, inv.last_name, inv.role, inv.active, inv.split_pct, acc.id, acc.name, acc.is_commission, acc.status, acc.split_pct
    ORDER BY active_amount DESC;
  `);

  console.log('\n--- Distinct Recipients Details ---');
  console.log(JSON.stringify(distinctRecipients.data, null, 2));
}

main().catch(console.error);
