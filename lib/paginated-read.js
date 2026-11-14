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
  const client = filters.supabaseClient || supabase;
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
    monthlyReturns,
    cutoverAdjustments,
    commissionRules
  ] = await Promise.all([
    paginatedRead('investors', { client }),
    paginatedRead('investor_accounts', { client }),
    paginatedRead('deposits', { queryModifier: depositMod, client }),
    paginatedRead('withdrawals', { queryModifier: withdrawalMod, client }),
    paginatedRead('commission_shares', { client }),
    paginatedRead('investor_monthly_history', { client }),
    paginatedRead('commission_earnings', { client }),
    paginatedRead('monthly_returns', { client }),
    paginatedRead('account_cutover_adjustments', { client }).catch(() => []),
    paginatedRead('commission_rules', { client }).catch(() => [])
  ]);

  return {
    investors: investors || [],
    accounts: accounts || [],
    deposits: deposits || [],
    withdrawals: withdrawals || [],
    commissionShares: commissionShares || [],
    monthlyHistory: monthlyHistory || [],
    commissionEarnings: commissionEarnings || [],
    monthlyReturns: monthlyReturns || [],
    cutoverAdjustments: cutoverAdjustments || [],
    commissionRules: commissionRules || []
  };
}
