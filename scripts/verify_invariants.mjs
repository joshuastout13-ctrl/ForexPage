process.env.DATA_SOURCE = 'supabase';
import { supabase } from '../lib/supabase.js';
import { buildInvestorDashboard } from '../lib/dashboard.js';

async function main() {
  console.log('=== VERIFYING SEPTEMBER RECOVERY INVARIANTS ===\n');

  // 1. September fund return
  const { data: ret } = await supabase
    .from('monthly_returns')
    .select('*')
    .eq('year', 2026)
    .eq('month_number', 9)
    .single();
  console.log(`1. September Return: ${ret.gross_return_pct}% | Locked: ${ret.locked} | Source: "${ret.source}"`);

  // 2. Josh September commission
  const { data: jcomm } = await supabase
    .from('commission_earnings')
    .select('amount')
    .eq('recipient_id', 'stout001')
    .eq('year', 2026)
    .eq('month_number', 9)
    .eq('status', 'ACTIVE');
  const totalJcomm = jcomm.reduce((sum, r) => sum + Number(r.amount), 0);
  console.log(`2. Josh September Commission: $${totalJcomm.toFixed(2)} across ${jcomm.length} rows`);

  // 3. Josh Stout Dashboard (provenance & balance)
  const dJosh = await buildInvestorDashboard('jstout', null, { mustBeAuthoritative: true });
  console.log(`3. Josh Stout Provenance: $${dJosh.summary.totalExternalCashSent.toLocaleString()} | Status: ${dJosh.summary.provenanceCompletenessStatus} | Balance: $${dJosh.summary.currentBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);

  // 4. Ryan Ringer Dashboard (provenance & balance)
  const dRyan = await buildInvestorDashboard('inv_1f9ab366', null, { mustBeAuthoritative: true });
  console.log(`4. Ryan Ringer Provenance: $${dRyan.summary.totalExternalCashSent.toLocaleString()} | Status: ${dRyan.summary.provenanceCompletenessStatus} | Balance: $${dRyan.summary.currentBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
}

main().catch(console.error);
