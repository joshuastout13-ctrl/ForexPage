import { sql } from './inspect_internal_transfer_rpc.mjs';

async function main() {
  const t = await sql(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
    ORDER BY table_name;
  `);
  console.log(t.data.map(r => r.table_name));
}

main().catch(console.error);
