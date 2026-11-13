import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  console.log('Querying Supabase project:', SUPABASE_URL);

  // 1. live_performance
  const { data: livePerf, error: liveErr } = await supabase
    .from('live_performance')
    .select('*')
    .order('last_updated', { ascending: false })
    .limit(5);

  console.log('\n--- LIVE PERFORMANCE (Top 5) ---');
  if (liveErr) console.error('live_performance error:', liveErr);
  else console.log(JSON.stringify(livePerf, null, 2));

  // 2. monthly_returns
  const { data: monthlyReturns, error: monthErr } = await supabase
    .from('monthly_returns')
    .select('*')
    .order('year', { ascending: false })
    .order('month', { ascending: false })
    .limit(5);

  console.log('\n--- MONTHLY RETURNS (Top 5) ---');
  if (monthErr) console.error('monthly_returns error:', monthErr);
  else console.log(JSON.stringify(monthlyReturns, null, 2));

  // 3. myfxbook_sync_claims
  const { data: claims, error: claimsErr } = await supabase
    .from('myfxbook_sync_claims')
    .select('*')
    .order('pacific_date', { ascending: false })
    .limit(5);

  console.log('\n--- MYFXBOOK SYNC CLAIMS ---');
  if (claimsErr) console.error('myfxbook_sync_claims error:', claimsErr);
  else console.log(JSON.stringify(claims, null, 2));

  // 4. audit_runs
  const { data: auditRuns, error: auditErr } = await supabase
    .from('audit_runs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(5);

  console.log('\n--- AUDIT RUNS (Top 5) ---');
  if (auditErr) console.error('audit_runs error:', auditErr);
  else console.log(JSON.stringify(auditRuns, null, 2));

  // 5. admin_email_logs
  const { data: emailLogs, error: emailErr } = await supabase
    .from('admin_email_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(5);

  console.log('\n--- ADMIN EMAIL LOGS (Top 5) ---');
  if (emailErr) console.error('admin_email_logs error:', emailErr);
  else console.log(JSON.stringify(emailLogs, null, 2));
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
