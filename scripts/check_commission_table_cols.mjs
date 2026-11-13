import { sql } from './inspect_internal_transfer_rpc.mjs';

async function checkCols() {
  for (const t of ['commission_rules', 'commission_shares', 'commission_earnings']) {
    const cols = await sql(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = '${t}' 
      ORDER BY ordinal_position;
    `);
    console.log(`=== ${t} columns ===`);
    console.log(cols.data.map(c => c.column_name));
  }
}

checkCols().catch(console.error);
