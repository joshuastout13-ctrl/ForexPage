-- SQL Schema Migration for Stone & Company Forex Fund Admin Email Center
-- Run this in your Supabase SQL Editor if the tables do not exist yet.

CREATE TABLE IF NOT EXISTS admin_email_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject text NOT NULL,
  body text NOT NULL,
  recipient_count integer DEFAULT 0,
  recipient_emails text[],
  status text DEFAULT 'success', -- 'success', 'partial', 'failed'
  sent_by text DEFAULT 'admin',
  is_test boolean DEFAULT false,
  error_message text,
  details jsonb,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now())
);

-- Enable RLS
ALTER TABLE admin_email_logs ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS, but if custom policies are needed:
CREATE POLICY "Allow service role full access to admin_email_logs" 
  ON admin_email_logs 
  FOR ALL 
  USING (true) 
  WITH CHECK (true);
