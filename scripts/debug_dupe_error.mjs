import { sql } from '../scripts/inspect_internal_transfer_rpc.mjs';

async function main() {
  const r = await sql(`
    DO $$
    DECLARE
      v_err text;
    BEGIN
      INSERT INTO deposits (id, investor_id, account_id, amount, date, effective_accounting_date, accounting_treatment, status)
      VALUES ('test_dupe_deposit', 'stout001', 'stout001', 2500.00, '2026-09-01', '2026-09-01', 'INTERNAL_TRANSFER', 'confirmed');
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
      RAISE EXCEPTION 'CAUGHT_ERROR: %', v_err;
    END $$;
  `);
  console.log('Result:', r);
}

main().catch(console.error);
