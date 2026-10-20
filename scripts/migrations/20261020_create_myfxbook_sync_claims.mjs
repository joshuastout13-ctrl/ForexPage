import { sql } from '../inspect_internal_transfer_rpc.mjs';

async function migrate() {
  const ddl = `
    CREATE TABLE IF NOT EXISTS myfxbook_sync_claims (
      pacific_date DATE PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'CLAIMED',
      claimed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      completed_at TIMESTAMP WITH TIME ZONE,
      claimed_by TEXT,
      window_type TEXT NOT NULL,
      attempts INTEGER DEFAULT 1,
      data_hash TEXT,
      metrics JSONB,
      source TEXT,
      error_message TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_myfxbook_sync_claims_status ON myfxbook_sync_claims(status, claimed_at);
  `;

  console.log('Applying myfxbook_sync_claims DDL to julhldzkiqdeuuoqmvlo...');
  const res = await sql(ddl);
  console.log('Result:', res);
}

migrate().catch(console.error);
