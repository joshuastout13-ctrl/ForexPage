import { sql } from './inspect_internal_transfer_rpc.mjs';

async function main() {
  const { data } = await sql(`
    SELECT event_object_table, trigger_name, action_statement, action_timing, event_manipulation
    FROM information_schema.triggers
    WHERE event_object_table IN ('withdrawals', 'deposits', 'internal_transfers');
  `);
  console.log('Triggers:');
  console.log(JSON.stringify(data, null, 2));
}

main().catch(console.error);
