-- Commission Distribution System - V3 Schema Update (Commission Shares with Effective Dates)

CREATE TABLE IF NOT EXISTS commission_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
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

ALTER TABLE commission_shares ENABLE ROW LEVEL SECURITY;
