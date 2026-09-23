import fs from 'fs';
import { sql } from './inspect_internal_transfer_rpc.mjs';

async function main() {
  console.log('=== APPLYING LEGACY ADOPTION RPC MIGRATION TO PRODUCTION ===');
  const migrationSql = fs.readFileSync('scripts/migrations/20260923_adopt_legacy_internal_transfer_rpc.sql', 'utf8');
  
  const res = await sql(migrationSql);
  console.log('Migration response status:', res.status);
  console.log('Migration response data:', JSON.stringify(res.data, null, 2));

  if (res.status === 200 || res.status === 201) {
    console.log('✅ Legacy adoption RPC migration successfully applied to production!');
  } else {
    console.error('❌ Migration failed to apply:', res);
    process.exit(1);
  }
}

main().catch(console.error);
