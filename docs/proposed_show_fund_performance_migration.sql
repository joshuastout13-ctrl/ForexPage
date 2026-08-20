-- Migration: Add show_fund_performance boolean to investors table
-- Default: FALSE for all existing and new accounts (display-only)
ALTER TABLE investors ADD COLUMN IF NOT EXISTS show_fund_performance BOOLEAN NOT NULL DEFAULT FALSE;

-- Ensure all existing investor accounts are backfilled to FALSE
UPDATE investors SET show_fund_performance = FALSE WHERE show_fund_performance IS NULL;

COMMENT ON COLUMN investors.show_fund_performance IS 'Controls visibility of the Fund Performance sidebar card on the investor dashboard. Default FALSE. Display-only setting.';
