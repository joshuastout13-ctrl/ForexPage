import { sql } from './inspect_internal_transfer_rpc.mjs';

async function main() {
  console.log('=== AUDITING COMMISSION CAPITALIZATION TREATMENT HISTORY ===\n');

  const recipients = [
    { id: 'inv_015f3774', name: 'Stone & Co Owners' },
    { id: 'inv_920b8af8', name: 'Ross Wamsley' },
    { id: 'inv_e1d4f2af', name: 'Josh Richards' },
    { id: 'inv_4d52f6a4', name: 'David Townley' },
    { id: 'stout001',     name: 'Joshua Stout' },
    { id: 'inv_d0f857c7', name: 'Jacob Wamsley' },
    { id: 'inv_df9fbf05', name: 'David Valdes' },
    { id: 'inv_d2ab6da4', name: 'Michael Beck' },
    { id: 'inv_a79798ca', name: 'Ted Boardwalk' },
    { id: 'inv_d3ec0cf8', name: 'Adam Richards' },
    { id: 'inv_57a1a49a', name: 'Bill and Mary Kimball' },
    { id: 'inv_6a1b838a', name: 'Val Taylor' },
    { id: 'inv_a7e429ce', name: 'Jim Colby' },
    { id: 'inv_141417dc', name: 'Nelson Guyer' }
  ];

  for (const r of recipients) {
    console.log(`\n======================================================`);
    console.log(`RECIPIENT: ${r.name} (${r.id})`);
    console.log(`======================================================`);

    // Investor details
    const invRes = await sql(`SELECT * FROM investors WHERE id = '${r.id}';`);
    const inv = invRes.data[0];
    console.log(`Investor Profile: role=${inv?.role}, active=${inv?.active}, split_pct=${inv?.split_pct}, start_date=${inv?.start_date}`);

    // Accounts
    const accRes = await sql(`SELECT * FROM investor_accounts WHERE investor_id = '${r.id}';`);
    console.log(`Accounts:`, accRes.data.map(a => ({
      id: a.id,
      name: a.name,
      is_commission: a.is_commission,
      status: a.status,
      starting_capital: a.starting_capital,
      total_cash_in: a.total_cash_in,
      split_pct: a.split_pct
    })));

    // Monthly history for months 5, 6, 7, 8, 9, 10
    const histRes = await sql(`
      SELECT month_number, month, opening_balance, deposits, withdrawals, gross_return_pct, ending_balance, locked, is_manual
      FROM investor_monthly_history
      WHERE investor_id = '${r.id}' AND year = 2026 AND month_number >= 5
      ORDER BY month_number;
    `);

    // Commission earnings for months 5, 6, 7, 8, 9, 10 (ACTIVE)
    const commRes = await sql(`
      SELECT month_number, count(*) as cnt, sum(amount) as total
      FROM commission_earnings
      WHERE recipient_id = '${r.id}' AND year = 2026 AND month_number >= 5 AND (status = 'ACTIVE' OR status IS NULL)
      GROUP BY month_number
      ORDER BY month_number;
    `);

    const commMap = {};
    (commRes.data || []).forEach(c => {
      commMap[c.month_number] = Number(c.total);
    });

    console.log('Month | Opening | Prev End | Delta (Open - PrevEnd) | Prev Month Comm | Match?');
    let prevEnd = null;
    for (const h of (histRes.data || [])) {
      const open = Number(h.opening_balance);
      const end = Number(h.ending_balance);
      const prevComm = commMap[h.month_number - 1] || 0;
      const delta = prevEnd !== null ? open - prevEnd : 0;
      const diffFromComm = prevEnd !== null ? delta - prevComm : 0;
      const match = prevEnd !== null ? (Math.abs(diffFromComm) < 0.05 ? 'YES' : `NO (diff=${diffFromComm.toFixed(2)})`) : 'N/A';

      console.log(`M${h.month_number} (${h.month.padEnd(9)}) | Open: ${open.toFixed(2).padStart(11)} | PrevEnd: ${prevEnd !== null ? prevEnd.toFixed(2).padStart(11) : '        N/A'} | Delta: ${delta.toFixed(2).padStart(10)} | PrevComm: ${prevComm.toFixed(2).padStart(10)} | Match: ${match}`);
      prevEnd = end;
    }
  }
}

main().catch(console.error);
