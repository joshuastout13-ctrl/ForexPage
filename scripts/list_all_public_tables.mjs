import { sql } from './inspect_internal_transfer_rpc.mjs';

async function main() {
  const r = await sql(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
    ORDER BY table_name;
  `);
  console.log('Public tables:', r.data.map(t => t.table_name));

  // Check audit_runs schema
  const r2 = await sql(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'audit_runs'
    ORDER BY ordinal_position;
  `);
  console.log('audit_runs schema:', r2.data);

  // Check admin_email_logs if it exists
  const r3 = await sql(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'admin_email_logs'
    ORDER BY ordinal_position;
  `);
  console.log('admin_email_logs schema:', r3.data);
}

main().catch(console.error);
