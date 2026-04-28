-- Commission Distribution System - Schema Update

-- 1. Commission Rules Table
CREATE TABLE IF NOT EXISTS commission_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  investor_id TEXT REFERENCES investors(id) ON DELETE CASCADE,
  recipient_id TEXT REFERENCES investors(id) ON DELETE CASCADE,
  percent NUMERIC(5, 2) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Commission Earnings Tracking Table
CREATE TABLE IF NOT EXISTS commission_earnings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id TEXT REFERENCES investors(id) ON DELETE CASCADE,
  source_investor_id TEXT REFERENCES investors(id) ON DELETE CASCADE,
  year INTEGER NOT NULL,
  month_number INTEGER NOT NULL,
  amount NUMERIC(15, 2) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE commission_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE commission_earnings ENABLE ROW LEVEL SECURITY;
