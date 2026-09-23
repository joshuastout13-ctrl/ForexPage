import { supabase } from '../lib/supabase.js';

async function run() {
  const { data: withdrawals, error } = await supabase
    .from('withdrawals')
    .select('*')
    .or('investor_id.eq.stout001,account_id.eq.stout001')
    .order('created_at', { ascending: true });

  if (error) {
    console.error(error);
    process.exit(1);
  }

  console.log(`Found ${withdrawals.length} withdrawals for stout001:`);
  withdrawals.forEach((w, i) => {
    console.log(`\n--- Withdrawal #${i + 1} ---`);
    console.log(`ID:                        ${w.id}`);
    console.log(`Amount:                    $${Number(w.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    console.log(`Request Date:              ${w.request_date}`);
    console.log(`Effective Accounting Date: ${w.effective_accounting_date}`);
    console.log(`Year / Month Number:       ${w.year} / ${w.month_number} (${w.month})`);
    console.log(`Status:                    ${w.status}`);
    console.log(`Notes:                     ${w.notes}`);
    console.log(`Created At:                ${w.created_at}`);
    console.log(`Created By:                ${w.created_by}`);
    console.log(`Updated At:                ${w.updated_at}`);
    console.log(`Updated By:                ${w.updated_by}`);
    console.log(`Idempotency Key:           ${w.idempotency_key}`);
  });
}

run().catch(console.error);
