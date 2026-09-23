import { sql } from './inspect_internal_transfer_rpc.mjs';

async function main() {
  const privs = await sql(`
    SELECT routine_name, grantee, privilege_type 
    FROM information_schema.routine_privileges 
    WHERE routine_name IN ('execute_internal_transfer_atomic', 'void_internal_transfer_atomic', 'adopt_legacy_internal_transfer_atomic') 
    ORDER BY routine_name, grantee;
  `);
  console.log('Routine privileges:');
  console.log(JSON.stringify(privs.data, null, 2));

  const procs = await sql(`
    SELECT p.proname, p.prosecdef, pg_get_function_arguments(p.oid) as args, p.proacl
    FROM pg_proc p
    WHERE p.proname IN ('execute_internal_transfer_atomic', 'void_internal_transfer_atomic', 'adopt_legacy_internal_transfer_atomic');
  `);
  console.log('Procs:');
  console.log(JSON.stringify(procs.data, null, 2));
}

main().catch(console.error);
