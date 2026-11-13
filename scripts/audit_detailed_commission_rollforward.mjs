import { sql } from './inspect_internal_transfer_rpc.mjs';

async function audit() {
  console.log('=== DEEP AUDIT OF ALL 14 RECIPIENTS ===\n');

  const recipientIds = [
    'inv_015f3774', // Stone and Co Owners Account
    'inv_920b8af8', // Ross Wamsley
    'inv_e1d4f2af', // josh richards
    'stout001',     // Joshua Stout
    'inv_d0f857c7', // Jacob Wamsley
    'inv_4d52f6a4', // David Townley
    'inv_df9fbf05', // David Valdes
    'inv_d2ab6da4', // Michael Beck
    'inv_a79798ca', // ted Boardwalk
    'inv_d3ec0cf8', // Adam Richards
    'inv_57a1a49a', // Bill and Mary Kimball
    'inv_6a1b838a', // Val Taylor
    'inv_a7e429ce', // Jim Colby
    'inv_141417dc'  // Nelson Guyer
  ];

  // 1. Investor profile and accounts
  const investors = await sql(`
    SELECT id, portal_username, first_name, last_name, role, active, split_pct, monthly_draw, notes
    FROM investors
    WHERE id IN ('${recipientIds.join("','")}');
  `);

  const accounts = await sql(`
    SELECT id, investor_id, name, starting_capital, total_cash_in, is_commission, status, split_pct
    FROM investor_accounts
    WHERE investor_id IN ('${recipientIds.join("','")}');
  `);

  // 2. Monthly history for 2026 M8, M9, M10
  const history = await sql(`
    SELECT investor_id, year, month_number, month, opening_balance, deposits, withdrawals, gross_return_pct, manual_gain_amount, ending_balance, locked, updated_at
    FROM investor_monthly_history
    WHERE investor_id IN ('${recipientIds.join("','")}')
      AND year = 2026 AND month_number IN (8, 9, 10)
    ORDER BY investor_id, month_number;
  `);

  // 3. Commission earnings by month (M8, M9, M10) and status
  const commissions = await sql(`
    SELECT recipient_id, year, month_number, status, count(*) as cnt, sum(amount) as total
    FROM commission_earnings
    WHERE recipient_id IN ('${recipientIds.join("','")}')
      AND year = 2026 AND month_number IN (8, 9, 10)
    GROUP BY recipient_id, year, month_number, status
    ORDER BY recipient_id, year, month_number, status;
  `);

  // 4. Actual deposits in deposits table for M8, M9, M10
  const deps = await sql(`
    SELECT investor_id, account_id, date, amount, type, notes
    FROM deposits
    WHERE investor_id IN ('${recipientIds.join("','")}')
      AND date >= '2026-08-01' AND date <= '2026-10-31'
    ORDER BY investor_id, date;
  `);

  // 5. Actual withdrawals in withdrawals table for M8, M9, M10
  const wds = await sql(`
    SELECT investor_id, account_id, date, amount, type, status, notes
    FROM withdrawals
    WHERE investor_id IN ('${recipientIds.join("','")}')
      AND date >= '2026-08-01' AND date <= '2026-10-31'
    ORDER BY investor_id, date;
  `);

  // Output structured comparison
  console.log('=== INVESTORS ===');
  console.log(JSON.stringify(investors.data, null, 2));

  console.log('\n=== ACCOUNTS ===');
  console.log(JSON.stringify(accounts.data, null, 2));

  console.log('\n=== MONTHLY HISTORY ===');
  console.log(JSON.stringify(history.data, null, 2));

  console.log('\n=== COMMISSIONS ===');
  console.log(JSON.stringify(commissions.data, null, 2));

  console.log('\n=== DEPOSITS ===');
  console.log(JSON.stringify(deps.data, null, 2));

  console.log('\n=== WITHDRAWALS ===');
  console.log(JSON.stringify(wds.data, null, 2));
}

audit().catch(console.error);
