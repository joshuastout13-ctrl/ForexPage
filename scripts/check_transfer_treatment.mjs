import { sql } from './inspect_internal_transfer_rpc.mjs';

async function main() {
  const r = await sql(`
    SELECT id, transfer_id, accounting_treatment
    FROM deposits
    WHERE transfer_id IS NOT NULL AND accounting_treatment != 'INTERNAL_TRANSFER';
  `);
  console.log('Mismatched transfer deposits:', r.data);
}

main().catch(console.error);
