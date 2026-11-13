import { sql } from './inspect_internal_transfer_rpc.mjs';

async function main() {
  const indexQuery = `
    SELECT tablename, indexname, indexdef
    FROM pg_indexes
    WHERE tablename IN ('deposits', 'withdrawals')
    ORDER BY tablename, indexname;
  `;
  const constrQuery = `
    SELECT conrelid::regclass AS table_name, conname, contype, pg_get_constraintdef(oid) as def
    FROM pg_constraint
    WHERE conrelid IN ('deposits'::regclass, 'withdrawals'::regclass)
    ORDER BY table_name, conname;
  `;
  const trigQuery = `
    SELECT event_object_table, trigger_name, action_statement, action_orientation, action_timing
    FROM information_schema.triggers
    WHERE event_object_table IN ('deposits', 'withdrawals')
    ORDER BY event_object_table, trigger_name;
  `;

  console.log('--- INDEXES ---');
  const idxRes = await sql(indexQuery);
  console.log(JSON.stringify(idxRes.data, null, 2));

  console.log('--- CONSTRAINTS ---');
  const conRes = await sql(constrQuery);
  console.log(JSON.stringify(conRes.data, null, 2));

  console.log('--- TRIGGERS ---');
  const trgRes = await sql(trigQuery);
  console.log(JSON.stringify(trgRes.data, null, 2));
}

main().catch(console.error);
