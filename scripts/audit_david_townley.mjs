import { sql } from './inspect_internal_transfer_rpc.mjs';

async function main() {
  console.log('=== SEARCHING INVESTORS AND ACCOUNTS FOR DAVID TOWNLEY ===');

  const invCols = await sql(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'investors' 
    ORDER BY ordinal_position;
  `);
  console.log('investors columns:', invCols.data.map(c => c.column_name));

  const accCols = await sql(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'investor_accounts' 
    ORDER BY ordinal_position;
  `);
  console.log('investor_accounts columns:', accCols.data.map(c => c.column_name));

  // Search across all text columns in investors
  const invSearch = await sql(`
    SELECT * 
    FROM investors 
    WHERE to_jsonb(investors)::text ILIKE '%Townley%' 
       OR to_jsonb(investors)::text ILIKE '%David%';
  `);
  console.log('\nMatching investors:');
  console.log(JSON.stringify(invSearch.data, null, 2));

  // Search across all text columns in investor_accounts
  const accSearch = await sql(`
    SELECT * 
    FROM investor_accounts 
    WHERE to_jsonb(investor_accounts)::text ILIKE '%Townley%' 
       OR to_jsonb(investor_accounts)::text ILIKE '%David%';
  `);
  console.log('\nMatching investor_accounts:');
  console.log(JSON.stringify(accSearch.data, null, 2));
}

main().catch(console.error);
