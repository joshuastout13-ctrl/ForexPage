import { sql } from './inspect_internal_transfer_rpc.mjs';

async function main() {
  const { data } = await sql(`
    SELECT year, month_number, month, opening_balance, deposits, withdrawals, ending_balance, notes
    FROM investor_monthly_history
    WHERE investor_id = 'jerrys001' AND year = 2026 AND month_number >= 9
    ORDER BY month_number;
  `);
  console.log('Jerry History Sep-Dec:');
  console.log(JSON.stringify(data, null, 2));

  const { data: stoutData } = await sql(`
    SELECT year, month_number, month, opening_balance, deposits, withdrawals, ending_balance, notes
    FROM investor_monthly_history
    WHERE investor_id = 'stout001' AND year = 2026 AND month_number >= 9
    ORDER BY month_number;
  `);
  console.log('Stout History Sep-Dec:');
  console.log(JSON.stringify(stoutData, null, 2));
}

main().catch(console.error);
