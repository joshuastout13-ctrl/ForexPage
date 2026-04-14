// lib/dashboard.js
// Aggregates data from Google Sheets and MyFXBook into a single dashboard payload.

'use strict';

const { getTradingData } = require('./sheets');
const { getAccounts, getOpenOrders, getHistory } = require('./myfxbook');

/**
 * Build the full dashboard payload sent to the frontend.
 *
 * @returns {Promise<{
 *   accounts: Array,
 *   openOrders: Array,
 *   history: Array,
 *   tradingLog: Array,
 *   updatedAt: string
 * }>}
 */
async function getDashboardData() {
  const [tradingLog, accounts] = await Promise.all([
    getTradingData().catch((err) => {
      console.error('[dashboard] sheets error:', err.message);
      return [];
    }),
    getAccounts().catch((err) => {
      console.error('[dashboard] myfxbook accounts error:', err.message);
      return [];
    }),
  ]);

  // Fetch open orders and recent history for the first account (if available).
  let openOrders = [];
  let history = [];

  if (accounts.length > 0) {
    const primaryAccountId = accounts[0].id;
    const today = new Date();
    const thirtyDaysAgo = new Date(today);
    thirtyDaysAgo.setDate(today.getDate() - 30);

    const toISO = (d) => d.toISOString().slice(0, 10);

    [openOrders, history] = await Promise.all([
      getOpenOrders(primaryAccountId).catch((err) => {
        console.error('[dashboard] open orders error:', err.message);
        return [];
      }),
      getHistory(primaryAccountId, toISO(thirtyDaysAgo), toISO(today)).catch((err) => {
        console.error('[dashboard] history error:', err.message);
        return [];
      }),
    ]);
  }

  return {
    accounts,
    openOrders,
    history,
    tradingLog,
    updatedAt: new Date().toISOString(),
  };
}

module.exports = { getDashboardData };
