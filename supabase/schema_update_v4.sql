-- Schema Update V4: Force Password Change + Audit Runs Log
-- Run this migration in Supabase SQL Editor

-- 1. Add force_password_change flag to investors table
ALTER TABLE investors ADD COLUMN IF NOT EXISTS force_password_change BOOLEAN DEFAULT FALSE;

-- 2. Audit Runs log table (optional, for saving audit report snapshots)
CREATE TABLE IF NOT EXISTS audit_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id TEXT,
  source_investor_id TEXT REFERENCES investors(id) ON DELETE SET NULL,
  year INTEGER NOT NULL,
  month_number INTEGER NOT NULL,
  report_json JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE audit_runs ENABLE ROW LEVEL SECURITY;
