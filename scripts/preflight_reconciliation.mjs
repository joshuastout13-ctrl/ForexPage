import { sql } from './inspect_internal_transfer_rpc.mjs';

async function main() {
  console.log('=== PREFLIGHT RECONCILIATION: MAY - SEPTEMBER 2026 ===\n');

  console.log('--- 1. JERRY (jerrys001) ALL WITHDRAWALS ---');
  const jerryWds = await sql(`
    SELECT id, investor_id, account_id, request_date, effective_accounting_date, year, month_number, month, amount, status, notes, transfer_id, transfer_leg, created_at, updated_at, updated_by
    FROM withdrawals 
    WHERE account_id = 'jerrys001' OR investor_id = 'jerrys001'
    ORDER BY COALESCE(effective_accounting_date, request_date), created_at;
  `);
  console.log(JSON.stringify(jerryWds.data, null, 2));

  console.log('\n--- 2. STOUT (stout001 / jstout) ALL DEPOSITS ---');
  const stoutDeps = await sql(`
    SELECT id, investor_id, account_id, date, effective_accounting_date, amount, type, status, accounting_treatment, notes, transfer_id, transfer_leg, created_at, updated_at
    FROM deposits
    WHERE account_id = 'stout001' OR investor_id = 'stout001' OR investor_id = 'jstout'
    ORDER BY COALESCE(effective_accounting_date, date), created_at;
  `);
  console.log(JSON.stringify(stoutDeps.data, null, 2));

  console.log('\n--- 3. STOUT (stout001 / jstout) ALL WITHDRAWALS ---');
  const stoutWds = await sql(`
    SELECT id, investor_id, account_id, request_date, effective_accounting_date, amount, status, notes, transfer_id, transfer_leg
    FROM withdrawals
    WHERE account_id = 'stout001' OR investor_id = 'stout001' OR investor_id = 'jstout'
    ORDER BY COALESCE(effective_accounting_date, request_date), created_at;
  `);
  console.log(JSON.stringify(stoutWds.data, null, 2));

  console.log('\n--- 4. JERRY (jerrys001) ALL DEPOSITS ---');
  const jerryDeps = await sql(`
    SELECT id, investor_id, account_id, date, effective_accounting_date, amount, type, status, notes
    FROM deposits
    WHERE account_id = 'jerrys001' OR investor_id = 'jerrys001'
    ORDER BY date;
  `);
  console.log(JSON.stringify(jerryDeps.data, null, 2));
}

main().catch(console.error);
