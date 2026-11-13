import { sql } from './inspect_internal_transfer_rpc.mjs';

async function main() {
  const trigs = await sql(`
    SELECT trigger_name, event_manipulation, event_object_table, action_statement
    FROM information_schema.triggers
    WHERE event_object_table IN ('deposits', 'withdrawals', 'investor_monthly_history', 'monthly_returns')
    ORDER BY event_object_table, trigger_name;
  `);
  console.log('Triggers:', JSON.stringify(trigs.data, null, 2));
}

main().catch(console.error);
