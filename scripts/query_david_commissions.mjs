import { sql } from './inspect_internal_transfer_rpc.mjs';

async function main() {
  console.log('=== COMMISSIONS AUDIT FOR DAVID TOWNLEY ===\n');

  // 1. Check commission_rules
  const rules = await sql(`
    SELECT cr.*, 
           src.portal_username as src_portal, src.first_name as src_fn, src.last_name as src_ln,
           rec.portal_username as rec_portal, rec.first_name as rec_fn, rec.last_name as rec_ln
    FROM commission_rules cr
    LEFT JOIN investors src ON cr.investor_id = src.id
    LEFT JOIN investors rec ON cr.recipient_id = rec.id
    WHERE cr.recipient_id IN ('inv_4d52f6a4', 'dtownley')
       OR cr.investor_id IN ('inv_4d52f6a4', 'dtownley')
    ORDER BY cr.created_at;
  `);
  console.log('--- commission_rules (where David is recipient or source) ---');
  console.log(JSON.stringify(rules.data, null, 2));

  // 2. Check commission_shares
  const shares = await sql(`
    SELECT cs.*,
           src.portal_username as src_portal, src.first_name as src_fn, src.last_name as src_ln,
           rec.portal_username as rec_portal, rec.first_name as rec_fn, rec.last_name as rec_ln
    FROM commission_shares cs
    LEFT JOIN investors src ON cs.source_investor_id = src.id
    LEFT JOIN investors rec ON cs.recipient_investor_id = rec.id
    WHERE cs.recipient_investor_id IN ('inv_4d52f6a4', 'dtownley')
       OR cs.source_investor_id IN ('inv_4d52f6a4', 'dtownley')
    ORDER BY cs.created_at;
  `);
  console.log('--- commission_shares (where David is recipient or source) ---');
  console.log(JSON.stringify(shares.data, null, 2));

  // 3. Check commission_earnings where David is recipient
  const earnings = await sql(`
    SELECT ce.*,
           src.portal_username as src_portal, src.first_name as src_fn, src.last_name as src_ln
    FROM commission_earnings ce
    LEFT JOIN investors src ON ce.source_investor_id = src.id
    WHERE ce.recipient_id IN ('inv_4d52f6a4', 'dtownley')
    ORDER BY ce.year, ce.month_number, ce.created_at;
  `);
  console.log('--- commission_earnings (where David is recipient) ---');
  console.log(JSON.stringify(earnings.data, null, 2));

  // 4. Check all distinct recipients in commission_earnings for August 2026 (month 8)
  const augRecipients = await sql(`
    SELECT ce.recipient_id, 
           coalesce(inv.portal_username, ce.recipient_id) as recipient_portal,
           coalesce(inv.first_name || ' ' || inv.last_name, 'Unknown') as recipient_name,
           ce.status,
           COUNT(*) as row_count,
           SUM(ce.amount) as total_amount,
           MIN(ce.created_at) as min_created,
           MAX(ce.created_at) as max_created
    FROM commission_earnings ce
    LEFT JOIN investors inv ON ce.recipient_id = inv.id
    WHERE ce.year = 2026 AND ce.month_number = 8
    GROUP BY ce.recipient_id, inv.portal_username, inv.first_name, inv.last_name, ce.status
    ORDER BY ce.recipient_id, ce.status;
  `);
  console.log('\n--- August 2026 commission_earnings by recipient and status (TASK 7 BLAST RADIUS) ---');
  console.log(JSON.stringify(augRecipients.data, null, 2));
}

main().catch(console.error);
