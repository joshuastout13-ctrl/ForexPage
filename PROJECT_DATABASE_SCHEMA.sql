-- =============================================================================
-- STONE & COMPANY FOREX FUND — FULL SANITIZED POSTGRESQL DATABASE SCHEMA
-- Target Database: Supabase PostgreSQL
-- Document Version: 1.0.0
-- =============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================================================
-- 1. INVESTORS TABLE
-- Identity, authentication status, investor split %, and recurring draws
-- =============================================================================
CREATE TABLE IF NOT EXISTS investors (
  id TEXT PRIMARY KEY,
  first_name TEXT,
  last_name TEXT,
  email TEXT,
  portal_username TEXT UNIQUE,
  temp_password TEXT,
  active BOOLEAN DEFAULT TRUE,
  split_pct NUMERIC(5, 2) DEFAULT 100.00,
  monthly_draw NUMERIC(12, 2) DEFAULT 0.00,
  start_date DATE,
  role TEXT DEFAULT 'investor',
  force_password_change BOOLEAN DEFAULT FALSE,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- 2. INVESTOR ACCOUNTS TABLE
-- Financial ledger accounts belonging to investors
-- =============================================================================
CREATE TABLE IF NOT EXISTS investor_accounts (
  id TEXT PRIMARY KEY,
  investor_id TEXT REFERENCES investors(id) ON DELETE CASCADE,
  name TEXT,
  starting_capital NUMERIC(15, 2) DEFAULT 0.00,
  total_cash_in NUMERIC(15, 2) DEFAULT 0.00,
  open_date DATE,
  status TEXT DEFAULT 'Active',
  is_commission BOOLEAN DEFAULT FALSE,
  split_pct NUMERIC(5, 2) DEFAULT 100.00,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- 3. DEPOSITS TABLE
-- Capital addition records
-- =============================================================================
CREATE TABLE IF NOT EXISTS deposits (
  id TEXT PRIMARY KEY,
  investor_id TEXT REFERENCES investors(id) ON DELETE CASCADE,
  account_id TEXT REFERENCES investor_accounts(id) ON DELETE CASCADE,
  date DATE,
  amount NUMERIC(15, 2) NOT NULL,
  type TEXT DEFAULT 'Wire',
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- 4. WITHDRAWALS TABLE
-- Capital withdrawal and profit draw records
-- =============================================================================
CREATE TABLE IF NOT EXISTS withdrawals (
  id TEXT PRIMARY KEY,
  investor_id TEXT REFERENCES investors(id) ON DELETE CASCADE,
  account_id TEXT REFERENCES investor_accounts(id) ON DELETE CASCADE,
  request_date DATE,
  year INTEGER,
  month_number INTEGER,
  month TEXT,
  amount NUMERIC(15, 2) NOT NULL,
  status TEXT DEFAULT 'Completed',
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- 5. MONTHLY RETURNS TABLE
-- Master fund-level gross trading returns per month
-- =============================================================================
CREATE TABLE IF NOT EXISTS monthly_returns (
  year INTEGER NOT NULL,
  month_number INTEGER NOT NULL,
  month TEXT,
  gross_return_pct NUMERIC(5, 2) NOT NULL,
  source TEXT,
  notes TEXT,
  locked BOOLEAN DEFAULT FALSE,
  last_updated TEXT,
  PRIMARY KEY (year, month_number),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- 6. LIVE PERFORMANCE TABLE
-- Headline feed performance table displayed on investor sidebar
-- =============================================================================
CREATE TABLE IF NOT EXISTS live_performance (
  metric TEXT PRIMARY KEY,
  value_pct TEXT,
  source TEXT,
  last_updated TEXT,
  is_override BOOLEAN DEFAULT FALSE,
  notes TEXT,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- 7. INVESTOR MONTHLY HISTORY TABLE
-- Authoritative historical monthly balances and manual overrides
-- =============================================================================
CREATE TABLE IF NOT EXISTS investor_monthly_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  investor_id TEXT REFERENCES investors(id) ON DELETE CASCADE,
  account_id TEXT REFERENCES investor_accounts(id) ON DELETE CASCADE,
  year INTEGER NOT NULL,
  month_number INTEGER NOT NULL,
  month TEXT,
  opening_balance NUMERIC(15, 2),
  deposits NUMERIC(15, 2) DEFAULT 0.00,
  withdrawals NUMERIC(15, 2) DEFAULT 0.00,
  gross_return_pct NUMERIC(5, 2) DEFAULT 0.00,
  manual_gain_amount NUMERIC(15, 2),
  manual_return_pct NUMERIC(5, 2),
  recurring_draw NUMERIC(12, 2) DEFAULT 0.00,
  ending_balance NUMERIC(15, 2),
  is_manual BOOLEAN DEFAULT FALSE,
  notes TEXT,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT unique_investor_year_month UNIQUE (investor_id, year, month_number)
);

-- =============================================================================
-- 8. COMMISSION SHARES TABLE (V3 Schema with Effective Date Ranges)
-- Active commission pool allocation rules mapping source investors to recipients
-- =============================================================================
CREATE TABLE IF NOT EXISTS commission_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_investor_id TEXT REFERENCES investors(id) ON DELETE CASCADE,
  source_account_id TEXT REFERENCES investor_accounts(id) ON DELETE CASCADE,
  recipient_investor_id TEXT REFERENCES investors(id) ON DELETE CASCADE,
  commission_percent NUMERIC(5, 2) NOT NULL,
  effective_start_date DATE NOT NULL,
  effective_end_date DATE,
  status TEXT DEFAULT 'active',
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- 9. COMMISSION EARNINGS TABLE
-- Committed historical ledger of commission payouts received by recipients
-- =============================================================================
CREATE TABLE IF NOT EXISTS commission_earnings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id TEXT REFERENCES investors(id) ON DELETE CASCADE,
  source_investor_id TEXT REFERENCES investors(id) ON DELETE CASCADE,
  year INTEGER NOT NULL,
  month_number INTEGER NOT NULL,
  amount NUMERIC(15, 2) NOT NULL,
  status TEXT DEFAULT 'completed',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- 10. COMMISSION RULES TABLE (Legacy Schema maintained for compatibility)
-- =============================================================================
CREATE TABLE IF NOT EXISTS commission_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  investor_id TEXT REFERENCES investors(id) ON DELETE CASCADE,
  recipient_id TEXT REFERENCES investors(id) ON DELETE CASCADE,
  percent NUMERIC(5, 2) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- 11. SNAPSHOTS TABLE
-- Historical audit trail snapshots of investor monthly calculations
-- =============================================================================
CREATE TABLE IF NOT EXISTS snapshots (
  id TEXT PRIMARY KEY,
  investor_id TEXT REFERENCES investors(id) ON DELETE CASCADE,
  account_id TEXT REFERENCES investor_accounts(id) ON DELETE CASCADE,
  year INTEGER,
  month_number INTEGER,
  month TEXT,
  opening_balance NUMERIC(15, 2),
  deposit_amount NUMERIC(15, 2),
  gross_return_pct NUMERIC(5, 2),
  split_pct NUMERIC(5, 2),
  effective_return_pct NUMERIC(5, 2),
  gain_amount NUMERIC(15, 2),
  monthly_draw NUMERIC(12, 2),
  withdrawal_amount NUMERIC(15, 2),
  ending_balance NUMERIC(15, 2),
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- 12. AUDIT RUNS TABLE
-- Log table storing generated audit reports
-- =============================================================================
CREATE TABLE IF NOT EXISTS audit_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id TEXT,
  source_investor_id TEXT REFERENCES investors(id) ON DELETE SET NULL,
  year INTEGER NOT NULL,
  month_number INTEGER NOT NULL,
  report_json JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- 13. ADMIN EMAIL LOGS TABLE
-- History log for mass email broadcasts
-- =============================================================================
CREATE TABLE IF NOT EXISTS admin_email_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  recipient_count INTEGER DEFAULT 0,
  recipient_emails TEXT[],
  status TEXT DEFAULT 'success',
  sent_by TEXT DEFAULT 'admin',
  is_test BOOLEAN DEFAULT FALSE,
  error_message TEXT,
  details JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW())
);

-- =============================================================================
-- INDEXES FOR QUERY OPTIMIZATION
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_investor_accounts_investor_id ON investor_accounts(investor_id);
CREATE INDEX IF NOT EXISTS idx_deposits_investor_id ON deposits(investor_id);
CREATE INDEX IF NOT EXISTS idx_withdrawals_investor_id ON withdrawals(investor_id);
CREATE INDEX IF NOT EXISTS idx_history_investor_year_month ON investor_monthly_history(investor_id, year, month_number);
CREATE INDEX IF NOT EXISTS idx_shares_source ON commission_shares(source_investor_id);
CREATE INDEX IF NOT EXISTS idx_shares_recipient ON commission_shares(recipient_investor_id);
CREATE INDEX IF NOT EXISTS idx_earnings_recipient_year_month ON commission_earnings(recipient_id, year, month_number);
CREATE INDEX IF NOT EXISTS idx_earnings_source_year_month ON commission_earnings(source_investor_id, year, month_number);

-- =============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- Service role bypasses RLS for API handlers, custom policies defined below
-- =============================================================================
ALTER TABLE investors ENABLE ROW LEVEL SECURITY;
ALTER TABLE investor_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE deposits ENABLE ROW LEVEL SECURITY;
ALTER TABLE withdrawals ENABLE ROW LEVEL SECURITY;
ALTER TABLE monthly_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE live_performance ENABLE ROW LEVEL SECURITY;
ALTER TABLE snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE investor_monthly_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE commission_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE commission_earnings ENABLE ROW LEVEL SECURITY;
ALTER TABLE commission_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_email_logs ENABLE ROW LEVEL SECURITY;

-- Allow service role full access
CREATE POLICY "Allow service role full access" ON admin_email_logs FOR ALL USING (true) WITH CHECK (true);
