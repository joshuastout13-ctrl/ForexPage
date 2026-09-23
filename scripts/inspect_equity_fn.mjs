import { sql } from './inspect_internal_transfer_rpc.mjs';

async function main() {
  const res = await sql(`
    SELECT proname, pg_get_function_arguments(p.oid) as args, prosecdef, n.nspname 
    FROM pg_proc p 
    JOIN pg_namespace n ON p.pronamespace = n.oid 
    WHERE proname = 'calculate_available_withdrawal_equity_sql';
  `);
  console.log('calculate_available_withdrawal_equity_sql:', JSON.stringify(res.data, null, 2));
}

main().catch(console.error);
