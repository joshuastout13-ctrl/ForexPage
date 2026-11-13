import { sql } from './inspect_internal_transfer_rpc.mjs';

async function main() {
  console.log('=== DEEP AUDIT: DAVID TOWNLEY (inv_4d52f6a4) ===\n');

  // 1. Commission earnings in August 2026
  const ce = await sql(`
    SELECT ce.id, ce.source_investor_id, src.portal_username, src.first_name, src.last_name,
           ce.amount, ce.status, ce.created_at, ce.calculation_version, ce.notes, ce.audit_notes
    FROM commission_earnings ce
    LEFT JOIN investors src ON ce.source_investor_id = src.id
    WHERE ce.recipient_id = 'inv_4d52f6a4' AND ce.year = 2026 AND ce.month_number = 8
    ORDER BY ce.amount DESC;
  `);
  console.log('--- August 2026 commission_earnings (11 rows) ---');
  console.log(JSON.stringify(ce.data, null, 2));

  // 2. All commission_rules where David is recipient
  const cr = await sql(`
    SELECT cr.id, cr.investor_id as source_investor_id, cr.account_id as source_account_id,
           src.portal_username, src.first_name, src.last_name,
           cr.percent, cr.created_at, cr.updated_at
    FROM commission_rules cr
    LEFT JOIN investors src ON cr.investor_id = src.id
    WHERE cr.recipient_id = 'inv_4d52f6a4'
    ORDER BY cr.created_at;
  `);
  console.log('\n--- commission_rules (recipient = David) ---');
  console.log(JSON.stringify(cr.data, null, 2));

  // 3. All commission_shares where David is recipient
  const cs = await sql(`
    SELECT cs.id, cs.source_investor_id, cs.source_account_id,
           src.portal_username, src.first_name, src.last_name,
           cs.commission_percent, cs.effective_start_date, cs.effective_end_date,
           cs.status, cs.notes, cs.created_at, cs.updated_at
    FROM commission_shares cs
    LEFT JOIN investors src ON cs.source_investor_id = src.id
    WHERE cs.recipient_investor_id = 'inv_4d52f6a4'
    ORDER BY cs.created_at;
  `);
  console.log('\n--- commission_shares (recipient = David) ---');
  console.log(JSON.stringify(cs.data, null, 2));

  // 4. Commission earnings for other months (July, September, October)
  const ceOther = await sql(`
    SELECT ce.year, ce.month_number, ce.status, count(*) as count, sum(ce.amount) as total
    FROM commission_earnings ce
    WHERE ce.recipient_id = 'inv_4d52f6a4'
    GROUP BY ce.year, ce.month_number, ce.status
    ORDER BY ce.year, ce.month_number;
  `);
  console.log('\n--- All months commission_earnings summary for David ---');
  console.log(JSON.stringify(ceOther.data, null, 2));
}

main().catch(console.error);
