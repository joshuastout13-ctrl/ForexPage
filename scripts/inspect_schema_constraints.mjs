import { sql } from './inspect_internal_transfer_rpc.mjs';

async function check() {
  const itCols = await sql(`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'internal_transfers'
    ORDER BY ordinal_position;
  `);
  console.log('=== internal_transfers columns ===');
  console.log(JSON.stringify(itCols.data, null, 2));

  const depCols = await sql(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'deposits'
    ORDER BY ordinal_position;
  `);
  console.log('=== deposits columns ===');
  console.log(depCols.data.map(c => `${c.column_name} (${c.data_type})`));

  const wdCols = await sql(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'withdrawals'
    ORDER BY ordinal_position;
  `);
  console.log('=== withdrawals columns ===');
  console.log(wdCols.data.map(c => `${c.column_name} (${c.data_type})`));

  const constraints = await sql(`
    SELECT c.conname, cl.relname, pg_get_constraintdef(c.oid) as def
    FROM pg_constraint c
    JOIN pg_class cl ON c.conrelid = cl.oid
    WHERE cl.relname IN ('deposits', 'withdrawals', 'internal_transfers')
    ORDER BY cl.relname, c.conname;
  `);
  console.log('=== Constraints ===');
  console.log(JSON.stringify(constraints.data, null, 2));
}

check().catch(console.error);
