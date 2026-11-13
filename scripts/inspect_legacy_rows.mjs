import { sql } from './inspect_internal_transfer_rpc.mjs';

async function main() {
  const r = await sql(`
    SELECT id, investor_id, account_id, amount, date, effective_accounting_date, accounting_treatment, status, idempotency_key, notes
    FROM deposits
    WHERE investor_id IN ('stout001', 'inv_3c86fcfb') AND amount IN (2500, 50000);
  `);
  console.log('Unverified legacy duplicate rows:', r.data);
}

main().catch(console.error);
