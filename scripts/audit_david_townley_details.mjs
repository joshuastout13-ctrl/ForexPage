import { sql } from './inspect_internal_transfer_rpc.mjs';

async function auditDavid() {
  console.log('=== AUDITING DAVID TOWNLEY (inv_4d52f6a4 / dtownley) ===\n');

  // 1. Commission rules & shares
  const rules = await sql(`
    SELECT * 
    FROM commission_rules 
    WHERE recipient_investor_id = 'inv_4d52f6a4' 
       OR recipient_investor_id = 'dtownley'
       OR recipient_account_id = 'dtownley'
       OR source_investor_id = 'inv_4d52f6a4'
       OR source_account_id = 'dtownley';
  `);
  console.log('--- commission_rules ---');
  console.log(JSON.stringify(rules.data, null, 2));

  const shares = await sql(`
    SELECT * 
    FROM commission_shares 
    WHERE recipient_investor_id = 'inv_4d52f6a4' 
       OR recipient_investor_id = 'dtownley'
       OR recipient_account_id = 'dtownley'
       OR source_investor_id = 'inv_4d52f6a4'
       OR source_account_id = 'dtownley';
  `);
  console.log('--- commission_shares ---');
  console.log(JSON.stringify(shares.data, null, 2));

  // 2. Commission earnings across all months
  const earnings = await sql(`
    SELECT * 
    FROM commission_earnings 
    WHERE recipient_investor_id = 'inv_4d52f6a4' 
       OR recipient_investor_id = 'dtownley'
       OR recipient_account_id = 'dtownley'
    ORDER BY year, month_number, source_investor_id, created_at;
  `);
  console.log('--- commission_earnings (all) ---');
  console.log(JSON.stringify(earnings.data, null, 2));

  // 3. investor_monthly_history
  const history = await sql(`
    SELECT * 
    FROM investor_monthly_history 
    WHERE investor_id = 'inv_4d52f6a4' 
       OR investor_id = 'dtownley'
    ORDER BY year, month_number;
  `);
  console.log('--- investor_monthly_history ---');
  console.log(JSON.stringify(history.data, null, 2));

  // 4. Deposits and withdrawals
  const deposits = await sql(`
    SELECT * 
    FROM deposits 
    WHERE investor_id = 'inv_4d52f6a4' 
       OR investor_id = 'dtownley'
       OR account_id = 'dtownley'
    ORDER BY effective_accounting_date, created_at;
  `);
  console.log('--- deposits ---');
  console.log(JSON.stringify(deposits.data, null, 2));

  const withdrawals = await sql(`
    SELECT * 
    FROM withdrawals 
    WHERE investor_id = 'inv_4d52f6a4' 
       OR investor_id = 'dtownley'
       OR account_id = 'dtownley'
    ORDER BY effective_accounting_date, created_at;
  `);
  console.log('--- withdrawals ---');
  console.log(JSON.stringify(withdrawals.data, null, 2));
}

auditDavid().catch(console.error);
