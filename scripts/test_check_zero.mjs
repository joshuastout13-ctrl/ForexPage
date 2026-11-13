import Decimal from 'decimal.js';
import { supabase } from '../lib/supabase.js';

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

async function checkZero() {
  const { data: investors } = await supabase.from('investors').select('*');
  const invMap = new Map(investors.map(i => [i.id, i]));
  const { data: accounts } = await supabase.from('investor_accounts').select('*').eq('status', 'Active');
  const { data: augHist } = await supabase.from('investor_monthly_history').select('*').eq('year', 2026).eq('month_number', 8);
  const augEndingMap = new Map(augHist.map(h => [h.investor_id, Number(h.ending_balance || 0)]));
  const { data: deps } = await supabase.from('deposits').select('*');
  const { data: wds } = await supabase.from('withdrawals').select('*');

  const sepDepsByInv = {};
  deps.forEach(d => {
    const dt = d.effective_accounting_date || d.date;
    if (dt >= '2026-09-01' && dt <= '2026-09-30' && (!d.status || !d.status.toLowerCase().includes('void'))) {
      sepDepsByInv[d.investor_id] = (sepDepsByInv[d.investor_id] || new Decimal(0)).add(new Decimal(d.amount));
    }
  });

  const sepWdsByInv = {};
  wds.forEach(w => {
    const dt = w.effective_accounting_date || w.request_date;
    if (dt >= '2026-09-01' && dt <= '2026-09-30' && ['approved', 'completed'].includes(String(w.status).toLowerCase())) {
      sepWdsByInv[w.investor_id] = (sepWdsByInv[w.investor_id] || new Decimal(0)).add(new Decimal(w.amount));
    }
  });

  const sepReturn = new Decimal('3.07').div(100);
  const sourceProfits = {};
  for (const acc of accounts) {
    const inv = invMap.get(acc.investor_id);
    if (!inv || (inv.start_date && inv.start_date > '2026-09-30')) continue;
    let openBal = new Decimal(augEndingMap.get(acc.investor_id) || acc.starting_capital || 0);
    if (acc.open_date && acc.open_date >= '2026-09-01' && acc.open_date <= '2026-09-30') {
      openBal = new Decimal(acc.starting_capital || 0);
    }
    const d = sepDepsByInv[acc.investor_id] || new Decimal(0);
    const w = sepWdsByInv[acc.investor_id] || new Decimal(0);
    const adjBasis = openBal.add(d).sub(w);
    if (adjBasis.gt(0)) {
      sourceProfits[acc.investor_id] = { name: `${inv.first_name} ${inv.last_name}`, adjBasis, grossProfit: adjBasis.mul(sepReturn) };
    }
  }

  const { data: allShares } = await supabase.from('commission_shares').select('*');
  const caseAShares = allShares.filter(s => {
    if (s.created_at >= '2026-10-01T00:00:00Z') return false;
    const start = s.effective_start_date || '2000-01-01';
    const end = s.effective_end_date || '9999-12-31';
    if (start > '2026-09-30' || end < '2026-09-01') return false;
    if (s.status === 'cancelled') {
      return s.updated_at >= '2026-10-01T00:00:00Z' && end >= '2026-09-30';
    }
    return s.status === 'active';
  });

  console.log('Case A shares count:', caseAShares.length);
  let zeroCount = 0;
  let matchCount = 0;
  const missingSources = [];
  for (const s of caseAShares) {
    const src = sourceProfits[s.source_investor_id];
    if (src) {
      matchCount++;
      const amt = src.grossProfit.mul(new Decimal(s.commission_percent).div(100));
      if (amt.toFixed(2) === '0.00') {
        console.log('Zero amount share:', s.recipient_investor_id, s.source_investor_id, s.commission_percent, 'basis:', src.adjBasis.toString());
        zeroCount++;
      }
    } else {
      missingSources.push(s);
    }
  }
  console.log('Shares with matching source profit:', matchCount, 'Zero count:', zeroCount);
  console.log('Missing sources count:', missingSources.length);
  missingSources.forEach(s => console.log('  Missing source:', s.recipient_investor_id, s.source_investor_id, s.id));
}
checkZero().catch(console.error);
