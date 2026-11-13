import { sql } from './inspect_internal_transfer_rpc.mjs';

async function main() {
  console.log('=== TRACING DAVID TOWNLEY MONTHLY HISTORY VS COMMISSIONS ===\n');

  const history = await sql(`
    SELECT * 
    FROM investor_monthly_history 
    WHERE investor_id = 'inv_4d52f6a4'
    ORDER BY year, month_number;
  `);

  const earnings = await sql(`
    SELECT year, month_number, sum(amount) as total_comm, count(*) as cnt
    FROM commission_earnings
    WHERE recipient_id = 'inv_4d52f6a4' AND status = 'ACTIVE'
    GROUP BY year, month_number
    ORDER BY year, month_number;
  `);

  const commMap = {};
  earnings.data.forEach(e => {
    commMap[`${e.year}-${e.month_number}`] = Number(e.total_comm);
  });

  console.log('Month | Opening | Deps | Wds | Return% | Trading Gain | Ending | Prev End | Delta (End - PrevEnd) | Comm Earned in Prev Month | Comm Earned in This Month');
  console.log('-----------------------------------------------------------------------------------------------------------------------------------------------------');

  let prevEnd = null;
  for (const h of history.data) {
    const open = Number(h.opening_balance);
    const deps = Number(h.deposits);
    const wds = Number(h.withdrawals);
    const ret = Number(h.gross_return_pct);
    const end = Number(h.ending_balance);
    
    // Trading gain = (open + deps - wds) * (ret / 100) * split_pct
    // Note: David's split is 75%
    const basis = open + deps - wds;
    const gain75 = basis * (ret / 100) * 0.75;
    const gain100 = basis * (ret / 100);

    const prevMonthKey = h.month_number === 1 ? `${h.year - 1}-12` : `${h.year}-${h.month_number - 1}`;
    const thisMonthKey = `${h.year}-${h.month_number}`;
    const prevComm = commMap[prevMonthKey] || 0;
    const thisComm = commMap[thisMonthKey] || 0;

    const delta = prevEnd !== null ? (open - prevEnd) : 0;

    console.log(`${String(h.month_number).padStart(2, ' ')} (${h.month.padEnd(9)}) | ${open.toFixed(2).padStart(10)} | ${deps.toFixed(2).padStart(6)} | ${wds.toFixed(2).padStart(6)} | ${ret.toFixed(2).padStart(6)}% | ${gain75.toFixed(2).padStart(10)} (75%) | ${end.toFixed(2).padStart(10)} | ${prevEnd !== null ? prevEnd.toFixed(2).padStart(10) : '      N/A '} | Delta=${delta.toFixed(2).padStart(8)} | PrevComm=${prevComm.toFixed(2).padStart(8)} | ThisComm=${thisComm.toFixed(2).padStart(8)}`);
    prevEnd = end;
  }
}

main().catch(console.error);
