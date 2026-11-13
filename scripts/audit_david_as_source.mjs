import { sql } from './inspect_internal_transfer_rpc.mjs';

async function main() {
  console.log('=== COMMISSIONS WHERE DAVID IS SOURCE ===\n');

  const cr = await sql(`
    SELECT cr.*, rec.portal_username, rec.first_name, rec.last_name
    FROM commission_rules cr
    LEFT JOIN investors rec ON cr.recipient_id = rec.id
    WHERE cr.investor_id = 'inv_4d52f6a4';
  `);
  console.log('commission_rules (David is source):', JSON.stringify(cr.data, null, 2));

  const cs = await sql(`
    SELECT cs.*, rec.portal_username, rec.first_name, rec.last_name
    FROM commission_shares cs
    LEFT JOIN investors rec ON cs.recipient_investor_id = rec.id
    WHERE cs.source_investor_id = 'inv_4d52f6a4';
  `);
  console.log('commission_shares (David is source):', JSON.stringify(cs.data, null, 2));

  const ce = await sql(`
    SELECT ce.*, rec.portal_username, rec.first_name, rec.last_name
    FROM commission_earnings ce
    LEFT JOIN investors rec ON ce.recipient_id = rec.id
    WHERE ce.source_investor_id = 'inv_4d52f6a4'
    ORDER BY ce.year, ce.month_number;
  `);
  console.log('commission_earnings (David is source):', JSON.stringify(ce.data, null, 2));
}

main().catch(console.error);
