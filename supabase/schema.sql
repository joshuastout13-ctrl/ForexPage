-- Stone and Company Forex Fund - Supabase Schema

-- 1. Investors
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
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Investor Accounts
CREATE TABLE IF NOT EXISTS investor_accounts (
  id TEXT PRIMARY KEY,
  investor_id TEXT REFERENCES investors(id),
  name TEXT,
  starting_capital NUMERIC(15, 2) DEFAULT 0.00,
  total_cash_in NUMERIC(15, 2) DEFAULT 0.00,
  open_date DATE,
  status TEXT DEFAULT 'Active',
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Deposits
CREATE TABLE IF NOT EXISTS deposits (
  id TEXT PRIMARY KEY,
  investor_id TEXT REFERENCES investors(id),
  account_id TEXT REFERENCES investor_accounts(id),
  date DATE,
  amount NUMERIC(15, 2) NOT NULL,
  type TEXT DEFAULT 'Wire',
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. Withdrawals
CREATE TABLE IF NOT EXISTS withdrawals (
  id TEXT PRIMARY KEY,
  investor_id TEXT REFERENCES investors(id),
  account_id TEXT REFERENCES investor_accounts(id),
  request_date DATE,
  year INTEGER,
  month_number INTEGER,
  month TEXT,
  amount NUMERIC(15, 2) NOT NULL,
  status TEXT DEFAULT 'Completed',
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. Monthly Returns (Fund-level)
CREATE TABLE IF NOT EXISTS monthly_returns (
  year INTEGER,
  month_number INTEGER,
  month TEXT,
  gross_return_pct NUMERIC(5, 2) NOT NULL,
  source TEXT,
  notes TEXT,
  locked BOOLEAN DEFAULT FALSE,
  last_updated TEXT,
  PRIMARY KEY (year, month_number),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 6. Live Performance (Myfxbook fallback)
CREATE TABLE IF NOT EXISTS live_performance (
  metric TEXT PRIMARY KEY,
  value_pct TEXT,
  source TEXT,
  last_updated TEXT,
  is_override BOOLEAN DEFAULT FALSE,
  notes TEXT,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 7. Investor Monthly Snapshots (Audit Log)
CREATE TABLE IF NOT EXISTS snapshots (
  id TEXT PRIMARY KEY,
  investor_id TEXT REFERENCES investors(id),
  account_id TEXT REFERENCES investor_accounts(id),
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

-- 8. Historical Monthly Data (Manual Overrides)
CREATE TABLE IF NOT EXISTS investor_monthly_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  investor_id TEXT REFERENCES investors(id),
  account_id TEXT REFERENCES investor_accounts(id),
  year INTEGER,
  month_number INTEGER,
  month TEXT,
  opening_balance NUMERIC(15, 2),
  deposits NUMERIC(15, 2) DEFAULT 0,
  withdrawals NUMERIC(15, 2) DEFAULT 0,
  gross_return_pct NUMERIC(5, 2) DEFAULT 0,
  manual_gain_amount NUMERIC(15, 2),
  manual_return_pct NUMERIC(5, 2),
  recurring_draw NUMERIC(12, 2) DEFAULT 0,
  ending_balance NUMERIC(15, 2),
  is_manual BOOLEAN DEFAULT FALSE,
  notes TEXT,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(investor_id, year, month_number)
);

-- Enable Row Level Security (RLS)
-- For this first phase, we'll keep it simple as requested: service role for backend, 
-- but we can add policies later if needed.
ALTER TABLE investors ENABLE ROW LEVEL SECURITY;
ALTER TABLE investor_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE deposits ENABLE ROW LEVEL SECURITY;
ALTER TABLE withdrawals ENABLE ROW LEVEL SECURITY;
ALTER TABLE monthly_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE live_performance ENABLE ROW LEVEL SECURITY;
ALTER TABLE snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE investor_monthly_history ENABLE ROW LEVEL SECURITY;

-- Note: Since we are using service_role for the API, we don't need complex policies yet.
