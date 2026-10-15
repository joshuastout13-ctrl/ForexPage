import { sql } from './inspect_internal_transfer_rpc.mjs';

async function main() {
  console.log('=== VERIFYING THREE NOVEMBER 1 UNPOSTED DEPOSITS ===');
  const r = await sql(`
    SELECT id, investor_id, account_id, amount, date, effective_accounting_date, status, accounting_treatment
    FROM deposits
    WHERE amount IN (175279.32, 5000.00, 39470.00)
    ORDER BY amount;
  `);
  console.log('Deposits table entries:', r.data);

  // Check if any of these are active in October
  const r2 = await sql(`
    SELECT id, investor_id, amount, effective_accounting_date, status
    FROM deposits
    WHERE amount IN (175279.32, 5000.00, 39470.00)
      AND effective_accounting_date < '2026-11-01'
      AND status = 'confirmed';
  `);
  console.log('Prematurely active October deposits (MUST BE EMPTY):', r2.data);
}

main().catch(console.error);
