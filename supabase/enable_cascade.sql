-- Run this in your Supabase SQL Editor to enable cascading updates.
-- This ensures that if you change an Investor ID or Account ID, 
-- all linked records (Deposits, Withdrawals, History) will update automatically.

-- 1. Update Investor Accounts references to Investors
ALTER TABLE investor_accounts 
  DROP CONSTRAINT IF EXISTS investor_accounts_investor_id_fkey,
  ADD CONSTRAINT investor_accounts_investor_id_fkey 
  FOREIGN KEY (investor_id) REFERENCES investors(id) ON UPDATE CASCADE;

-- 2. Update Deposits references
ALTER TABLE deposits 
  DROP CONSTRAINT IF EXISTS deposits_investor_id_fkey,
  DROP CONSTRAINT IF EXISTS deposits_account_id_fkey,
  ADD CONSTRAINT deposits_investor_id_fkey FOREIGN KEY (investor_id) REFERENCES investors(id) ON UPDATE CASCADE,
  ADD CONSTRAINT deposits_account_id_fkey FOREIGN KEY (account_id) REFERENCES investor_accounts(id) ON UPDATE CASCADE;

-- 3. Update Withdrawals references
ALTER TABLE withdrawals 
  DROP CONSTRAINT IF EXISTS withdrawals_investor_id_fkey,
  DROP CONSTRAINT IF EXISTS withdrawals_account_id_fkey,
  ADD CONSTRAINT withdrawals_investor_id_fkey FOREIGN KEY (investor_id) REFERENCES investors(id) ON UPDATE CASCADE,
  ADD CONSTRAINT withdrawals_account_id_fkey FOREIGN KEY (account_id) REFERENCES investor_accounts(id) ON UPDATE CASCADE;

-- 4. Update Snapshots references
ALTER TABLE snapshots 
  DROP CONSTRAINT IF EXISTS snapshots_investor_id_fkey,
  DROP CONSTRAINT IF EXISTS snapshots_account_id_fkey,
  ADD CONSTRAINT snapshots_investor_id_fkey FOREIGN KEY (investor_id) REFERENCES investors(id) ON UPDATE CASCADE,
  ADD CONSTRAINT snapshots_account_id_fkey FOREIGN KEY (account_id) REFERENCES investor_accounts(id) ON UPDATE CASCADE;

-- 5. Update Monthly History references
ALTER TABLE investor_monthly_history 
  DROP CONSTRAINT IF EXISTS investor_monthly_history_investor_id_fkey,
  DROP CONSTRAINT IF EXISTS investor_monthly_history_account_id_fkey,
  ADD CONSTRAINT investor_monthly_history_investor_id_fkey FOREIGN KEY (investor_id) REFERENCES investors(id) ON UPDATE CASCADE,
  ADD CONSTRAINT investor_monthly_history_account_id_fkey FOREIGN KEY (account_id) REFERENCES investor_accounts(id) ON UPDATE CASCADE;
