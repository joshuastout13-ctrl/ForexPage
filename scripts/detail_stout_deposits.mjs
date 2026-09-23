import { supabase } from '../lib/supabase.js';

async function run() {
  const { data: deposits, error } = await supabase
    .from('deposits')
    .select('*')
    .or('investor_id.eq.stout001,account_id.eq.stout001')
    .order('created_at', { ascending: true });

  if (error) {
    console.error(error);
    process.exit(1);
  }

  console.log(`Found ${deposits.length} deposits for stout001:`);
  deposits.forEach((d, i) => {
    console.log(`\n--- Deposit #${i + 1} ---`);
    console.log(`ID:                        ${d.id}`);
    console.log(`Amount:                    $${Number(d.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    console.log(`Date:                      ${d.date}`);
    console.log(`Effective Accounting Date: ${d.effective_accounting_date}`);
    console.log(`Status:                    ${d.status}`);
    console.log(`Type:                      ${d.type}`);
    console.log(`Accounting Treatment:      ${d.accounting_treatment}`);
    console.log(`Notes:                     ${d.notes}`);
    console.log(`Created At:                ${d.created_at}`);
    console.log(`Created By:                ${d.created_by}`);
    console.log(`Void State:                voided_at=${d.voided_at}, voided_by=${d.voided_by}, void_reason=${d.void_reason}`);
    console.log(`Idempotency Key:           ${d.idempotency_key}`);
  });
}

run().catch(console.error);
