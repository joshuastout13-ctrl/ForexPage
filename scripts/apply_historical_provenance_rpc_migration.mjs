import fs from 'fs';
import { sql } from './inspect_internal_transfer_rpc.mjs';

async function main() {
  console.log('=== APPLYING HISTORICAL PROVENANCE RPC MIGRATION TO PRODUCTION ===');
  const migrationSql = fs.readFileSync('scripts/migrations/20261001_record_historical_provenance_deposit_rpc.sql', 'utf8');
  
  const res = await sql(migrationSql);
  console.log('Migration response status:', res.status);
  console.log('Migration response data:', JSON.stringify(res.data, null, 2));

  if (res.status === 200 || res.status === 201) {
    console.log('✅ Canonical historical provenance RPC migration successfully applied to production!');
  } else {
    console.error('❌ Migration failed to apply:', res);
    process.exit(1);
  }
}

main().catch(console.error);
