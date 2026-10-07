process.env.DATA_SOURCE = 'supabase';
import { supabase } from '../lib/supabase.js';
import Decimal from 'decimal.js';

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

/**
 * PREPARED AUDITED CORRECTION SCRIPT: TED BOARDWALK (inv_a79798ca)
 * 
 * Status: PREPARED — DO NOT EXECUTE UNTIL EXPLICITLY AUTHORIZED
 * 
 * Scope:
 * 1. Honors existing cutover: cutover_inv_a79798ca_2026_9 ($0.00 September 1 basis)
 * 2. September 2026: Opening $0.00, Gain $0.00, Ending $0.00, Locked TRUE
 * 3. October 2026: Opening $1,702.78 (September commission earned), Ending $1,702.78
 * 4. Zero mutation to withdrawals ledger (June $5,000 withdrawal remains intact).
 */

async function main() {
  console.log('================================================================================');
  console.log('TED BOARDWALK AUDITED CORRECTION PREFLIGHT');
  console.log('================================================================================\n');

  // 1. Verify existing cutover record
  const { data: cutover, error: cutErr } = await supabase
    .from('account_cutover_adjustments')
    .select('*')
    .eq('id', '9baab26d-a7fe-4cbc-869e-9a0a67766c27')
    .single();

  if (cutErr || !cutover) {
    throw new Error(`Cutover record cutover_inv_a79798ca_2026_9 missing: ${cutErr?.message}`);
  }
  console.log('✓ Found Authoritative Cutover Record:');
  console.log(`  ID:           ${cutover.id}`);
  console.log(`  Key:          ${cutover.idempotency_key}`);
  console.log(`  Auth Ref:     ${cutover.authorization_reference}`);
  console.log(`  Basis Reset:  $${Number(cutover.authorized_opening_balance).toFixed(2)} effective ${cutover.effective_date}`);

  // 2. Verify September Commission Earned
  const { data: sepComm, error: commErr } = await supabase
    .from('commission_earnings')
    .select('amount, status')
    .eq('recipient_id', 'inv_a79798ca')
    .eq('year', 2026)
    .eq('month_number', 9);

  if (commErr) throw commErr;
  const activeSepComm = sepComm.filter(r => !r.status || r.status.toUpperCase() !== 'SUPERSEDED').reduce((sum, r) => sum + Number(r.amount), 0);
  console.log(`✓ September Active Commission: $${activeSepComm.toFixed(2)} across ${sepComm.length} rows`);

  if (Math.abs(activeSepComm - 1702.78) > 0.01) {
    throw new Error(`September commission is $${activeSepComm}, expected $1,702.78`);
  }

  // 3. Current Live State
  const { data: hist } = await supabase
    .from('investor_monthly_history')
    .select('*')
    .eq('investor_id', 'inv_a79798ca')
    .eq('year', 2026)
    .in('month_number', [9, 10]);

  const m9 = hist.find(h => h.month_number === 9);
  const m10 = hist.find(h => h.month_number === 10);

  console.log('\n--- CURRENT LIVE STATE (DEFICIT ROLLFORWARD) ---');
  console.log(`  September: Open=$${Number(m9?.opening_balance).toFixed(2)}, End=$${Number(m9?.ending_balance).toFixed(2)}`);
  console.log(`  October:   Open=$${Number(m10?.opening_balance).toFixed(2)}, End=$${Number(m10?.ending_balance).toFixed(2)}`);

  console.log('\n--- TARGET CANONICAL STATE (POST-AUDITED CORRECTION) ---');
  console.log(`  September: Open=$0.00, Gain=$0.00, End=$0.00, Locked=TRUE`);
  console.log(`  October:   Open=$1,702.78, Gain=$0.00, End=$1,702.78, Locked=FALSE`);

  console.log('\n================================================================================');
  console.log('PREFLIGHT VERIFIED. EXECUTION READY AWAITING USER COMMAND.');
  console.log('================================================================================');
}

main().catch(console.error);
