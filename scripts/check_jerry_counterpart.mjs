import { sql } from './inspect_internal_transfer_rpc.mjs';

async function main() {
  const dep = await sql("SELECT * FROM deposits WHERE id = 'dep_bc8434ab';");
  console.log('=== dep_bc8434ab ===');
  console.log(JSON.stringify(dep.data, null, 2));

  const jerryAcc = await sql("SELECT id, investor_id, name, status, starting_capital FROM investor_accounts WHERE id ILIKE '%jerry%' OR investor_id ILIKE '%jerry%' OR name ILIKE '%jerry%';");
  console.log('=== Jerry Accounts ===');
  console.log(JSON.stringify(jerryAcc.data, null, 2));

  const jerryWds = await sql("SELECT id, investor_id, account_id, request_date, effective_accounting_date, year, month_number, month, amount, status, notes, transfer_id, transfer_leg, created_at FROM withdrawals WHERE investor_id ILIKE '%jerry%' OR account_id ILIKE '%jerry%' ORDER BY request_date, created_at;");
  console.log('=== Jerry Withdrawals (ALL) ===');
  console.log(JSON.stringify(jerryWds.data, null, 2));

  // Also check if there are ANY withdrawals in September 2026 for $2,500 across ALL accounts
  const allSep2500Wds = await sql("SELECT id, investor_id, account_id, request_date, effective_accounting_date, amount, status, notes, transfer_id FROM withdrawals WHERE amount = 2500 AND (month_number = 9 OR effective_accounting_date >= '2026-09-01' OR request_date >= '2026-09-01');");
  console.log('=== All September 2026 $2,500 Withdrawals ===');
  console.log(JSON.stringify(allSep2500Wds.data, null, 2));
}

main().catch(console.error);
