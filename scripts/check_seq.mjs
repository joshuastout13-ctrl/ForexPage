import { sql } from './inspect_internal_transfer_rpc.mjs';

async function main() {
  const { data } = await sql('SELECT id, transfer_number, idempotency_key FROM internal_transfers;');
  console.log('internal_transfers in DB:', data);
  const seq = await sql("SELECT last_value, is_called FROM internal_transfer_seq;");
  console.log('Sequence status:', seq.data);
}

main().catch(console.error);
