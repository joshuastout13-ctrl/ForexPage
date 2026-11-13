import { sql } from './inspect_internal_transfer_rpc.mjs';

async function main() {
  const { data } = await sql(`
    SELECT proname, prosrc 
    FROM pg_proc 
    WHERE proname = 'adopt_legacy_internal_transfer_atomic';
  `);
  console.log('Function definition:');
  console.log(data[0]?.prosrc);
}

main().catch(console.error);
