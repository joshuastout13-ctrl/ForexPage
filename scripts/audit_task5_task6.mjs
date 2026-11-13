import { sql } from './inspect_internal_transfer_rpc.mjs';

async function main() {
  console.log('=== SYSTEMATIC AUDIT SCRIPT FOR ALL TASKS ===\n');

  // 1. Task 6 Invariants
  console.log('--- TASK 6: INVARIANTS CHECK ---');
  
  // September gross return
  const septReturn = await sql(`
    SELECT * FROM monthly_returns WHERE year = 2026 AND month_number = 9;
  `);
  console.log('September monthly_returns:', septReturn.data);

  // Josh September commission
  const joshSeptComm = await sql(`
    SELECT status, count(*), sum(amount) as total
    FROM commission_earnings
    WHERE recipient_id = 'stout001' AND year = 2026 AND month_number = 9
    GROUP BY status;
  `);
  console.log('Josh September commissions:', joshSeptComm.data);

  // Josh external cash & accounts
  const joshAcc = await sql(`
    SELECT id, starting_capital, total_cash_in, is_commission, status
    FROM investor_accounts
    WHERE investor_id IN ('stout001', 'jstout');
  `);
  console.log('Josh accounts:', joshAcc.data);

  // Ryan external cash
  const ryanAcc = await sql(`
    SELECT id, investor_id, starting_capital, total_cash_in, status
    FROM investor_accounts
    WHERE id = 'inv_7dc0fe9a' OR investor_id = 'inv_7dc0fe9a';
  `);
  console.log('Ryan accounts:', ryanAcc.data);

  // Sheryl September gain
  const sherylSept = await sql(`
    SELECT * FROM investor_monthly_history
    WHERE investor_id = 'inv_7dc0fe9a' AND year = 2026 AND month_number = 9;
  `);
  console.log('Sheryl September history:', sherylSept.data);

  // Stout May $7,500
  const stoutMay = await sql(`
    SELECT * FROM investor_monthly_history
    WHERE investor_id = 'stout001' AND year = 2026 AND month_number = 5;
  `);
  console.log('Stout May history:', stoutMay.data);

  // Jerry -> Stout transfers
  const jerryTransfers = await sql(`
    SELECT * FROM internal_transfers
    WHERE (source_investor_id = 'jerrys001' AND destination_investor_id = 'stout001')
       OR (source_investor_id = 'stout001' AND destination_investor_id = 'jerrys001');
  `);
  console.log('Jerry <-> Stout transfers:', jerryTransfers.data);

  // Total withdrawals check
  const wdCount = await sql(`
    SELECT count(*), sum(amount) as total FROM withdrawals;
  `);
  console.log('Withdrawals summary:', wdCount.data);

  // 2. Task 5: David Townley Verification
  console.log('\n--- TASK 5: DAVID TOWNLEY VERIFICATION ---');
  const davidHistory = await sql(`
    SELECT year, month_number, month, opening_balance, deposits, withdrawals, gross_return_pct, manual_gain_amount, ending_balance, locked, updated_at
    FROM investor_monthly_history
    WHERE investor_id = 'inv_4d52f6a4' AND year = 2026 AND month_number IN (8, 9, 10)
    ORDER BY month_number;
  `);
  console.log('David M8, M9, M10 history:', davidHistory.data);

  const davidComms = await sql(`
    SELECT year, month_number, status, count(*), sum(amount) as total
    FROM commission_earnings
    WHERE recipient_id = 'inv_4d52f6a4' AND year = 2026 AND month_number IN (8, 9, 10)
    GROUP BY year, month_number, status
    ORDER BY month_number, status;
  `);
  console.log('David commissions:', davidComms.data);

  // Check audit_runs or migrations to see what mutation was used for David
  const auditLogs = await sql(`
    SELECT table_name FROM information_schema.tables WHERE table_name LIKE '%audit%' OR table_name LIKE '%log%';
  `);
  console.log('Audit/log tables in DB:', auditLogs.data);
}

main().catch(console.error);
