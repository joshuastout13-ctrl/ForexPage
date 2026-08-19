import { supabase, paginatedRead } from './supabase.js';

export { paginatedRead };

/**
 * Batch-loads all financial tables needed by the accounting engine,
 * using paginated reads for tables that may exceed 1,000 rows.
 *
 * This is the canonical entry point for finalization, preview,
 * historical audit, and shadow-health endpoints.
 *
 * @param {object} [filters] - Optional filters.
 * @param {function} [filters.depositFilter] - Modifier for deposits query.
 * @param {function} [filters.withdrawalFilter] - Modifier for withdrawals query.
 * @returns {Promise<object>} All accounting reference data.
 */
export async function loadAccountingData(filters = {}) {
  const depositMod = filters.depositFilter || (q => q.not('type', 'ilike', 'VOID'));
  const withdrawalMod = filters.withdrawalFilter || (q => q.in('status', ['Approved', 'Completed', 'pending']));

  const [
    investors,
    accounts,
    deposits,
    withdrawals,
    commissionShares,
    monthlyHistory,
    commissionEarnings,
    monthlyReturns
  ] = await Promise.all([
    // Tables safely under 1,000 rows — use direct read for performance
    supabase.from('investors').select('*').then(r => { if (r.error) throw r.error; return r.data; }),
    supabase.from('investor_accounts').select('*').then(r => { if (r.error) throw r.error; return r.data; }),
    (() => {
      let q = supabase.from('deposits').select('*');
      q = depositMod(q);
      return q.then(r => { if (r.error) throw r.error; return r.data; });
    })(),
    (() => {
      let q = supabase.from('withdrawals').select('*');
      q = withdrawalMod(q);
      return q.then(r => { if (r.error) throw r.error; return r.data; });
    })(),
    supabase.from('commission_shares').select('*').then(r => { if (r.error) throw r.error; return r.data; }),

    // Tables exceeding 1,000 rows — MUST paginate
    paginatedRead('investor_monthly_history'),
    paginatedRead('commission_earnings'),

    // Small lookup table
    supabase.from('monthly_returns').select('*').then(r => { if (r.error) throw r.error; return r.data; })
  ]);

  return {
    investors: investors || [],
    accounts: accounts || [],
    deposits: deposits || [],
    withdrawals: withdrawals || [],
    commissionShares: commissionShares || [],
    monthlyHistory: monthlyHistory || [],
    commissionEarnings: commissionEarnings || [],
    monthlyReturns: monthlyReturns || []
  };
}
