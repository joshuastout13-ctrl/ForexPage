import { sql } from './inspect_internal_transfer_rpc.mjs';

async function main() {
  const c = await sql(`
    SELECT c.conname, cl.relname, pg_get_constraintdef(c.oid) as def
    FROM pg_constraint c
    JOIN pg_class cl ON c.conrelid = cl.oid
    WHERE cl.relname IN ('deposits', 'withdrawals', 'investor_monthly_history')
    ORDER BY cl.relname, c.conname;
  `);
  console.log('=== Constraints ===');
  console.log(JSON.stringify(c.data, null, 2));

  const indexes = await sql(`
    SELECT indexname, tablename, indexdef
    FROM pg_indexes
    WHERE tablename IN ('deposits', 'withdrawals', 'investor_monthly_history')
    ORDER BY tablename, indexname;
  `);
  console.log('=== Indexes ===');
  console.log(JSON.stringify(indexes.data, null, 2));
}

main().catch(console.error);
