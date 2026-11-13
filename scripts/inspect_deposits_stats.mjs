import { sql } from './inspect_internal_transfer_rpc.mjs';

async function main() {
  const r = await sql(`
    SELECT 
      count(*) as total_deposits,
      count(idempotency_key) as non_null_idempotency,
      count(*) - count(idempotency_key) as null_idempotency
    FROM deposits;
  `);
  console.log('Deposits idempotency stats:', r.data);

  const r2 = await sql(`
    SELECT 
      count(*) as total_withdrawals,
      count(idempotency_key) as non_null_idempotency,
      count(*) - count(idempotency_key) as null_idempotency
    FROM withdrawals;
  `);
  console.log('Withdrawals idempotency stats:', r2.data);

  // Check if there are any existing duplicates in deposits right now
  const r3 = await sql(`
    SELECT investor_id, account_id, amount, effective_accounting_date, accounting_treatment, status, count(*)
    FROM deposits
    WHERE status = 'confirmed'
    GROUP BY investor_id, account_id, amount, effective_accounting_date, accounting_treatment, status
    HAVING count(*) > 1;
  `);
  console.log('Active confirmed duplicate deposits in DB:', r3.data);

  // Let's also check all deposits grouped by investor, account, amount, date
  const r4 = await sql(`
    SELECT investor_id, account_id, amount, date, status, count(*)
    FROM deposits
    GROUP BY investor_id, account_id, amount, date, status
    HAVING count(*) > 1;
  `);
  console.log('Any duplicates on exact date in DB:', r4.data);
}

main().catch(console.error);
