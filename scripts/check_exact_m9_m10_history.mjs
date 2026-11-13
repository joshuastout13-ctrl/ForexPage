import { sql } from './inspect_internal_transfer_rpc.mjs';

async function main() {
  console.log('=== EXACT CURRENT DB STATE FOR ALL 14 RECIPIENTS ===\n');

  const recipientIds = [
    'inv_015f3774', // Stone & Co
    'inv_920b8af8', // Ross Wamsley
    'inv_e1d4f2af', // Josh Richards
    'stout001',     // Josh Stout
    'inv_d0f857c7', // Jacob Wamsley
    'inv_4d52f6a4', // David Townley
    'inv_df9fbf05', // David Valdes
    'inv_d2ab6da4', // Michael Beck
    'inv_a79798ca', // Ted Boardwalk
    'inv_d3ec0cf8', // Adam Richards
    'inv_57a1a49a', // Bill and Mary Kimball
    'inv_6a1b838a', // Val Taylor
    'inv_a7e429ce', // Jim Colby
    'inv_141417dc'  // Nelson Guyer
  ];

  const res = await sql(`
    SELECT 
      h.investor_id,
      inv.portal_username,
      inv.first_name || ' ' || inv.last_name as name,
      inv.split_pct,
      h.year,
      h.month_number,
      h.month,
      h.opening_balance,
      h.deposits,
      h.withdrawals,
      h.gross_return_pct,
      h.manual_gain_amount,
      h.ending_balance,
      h.locked,
      h.updated_at
    FROM investor_monthly_history h
    LEFT JOIN investors inv ON h.investor_id = inv.id
    WHERE h.investor_id IN ('${recipientIds.join("','")}')
      AND h.year = 2026 AND h.month_number IN (8, 9, 10)
    ORDER BY h.investor_id, h.month_number;
  `);

  console.log(JSON.stringify(res.data, null, 2));
}

main().catch(console.error);
