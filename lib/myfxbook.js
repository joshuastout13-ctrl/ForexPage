// lib/myfxbook.js
// Thin wrapper around the MyFXBook REST API.
//
// Required env vars:
//   MYFXBOOK_EMAIL    – your MyFXBook account email
//   MYFXBOOK_PASSWORD – your MyFXBook account password
//
// The session token obtained from /api/login is cached for the lifetime of the
// serverless function invocation.  Because Vercel keeps function instances warm
// for a short time, the token may be reused across nearby requests.

'use strict';

const fetch = require('node-fetch');
const config = require('./config');

// Module-level cache so warm instances don't re-login on every request.
let cachedSession = null;

/**
 * Log in to MyFXBook and return a session token.
 * @returns {Promise<string>} session token
 */
async function login() {
  const url = `${config.MYFXBOOK_API_BASE}/login.json` +
    `?email=${encodeURIComponent(config.MYFXBOOK_EMAIL)}` +
    `&password=${encodeURIComponent(config.MYFXBOOK_PASSWORD)}`;

  const res = await fetch(url);
  const data = await res.json();

  if (!data || data.error) {
    throw new Error(`MyFXBook login failed: ${data?.message || 'unknown error'}`);
  }

  return data.session;
}

/**
 * Get (or create) a valid MyFXBook session token.
 * @returns {Promise<string>}
 */
async function getSession() {
  if (!cachedSession) {
    cachedSession = await login();
  }
  return cachedSession;
}

/**
 * Fetch all trading accounts for the authenticated user.
 * @returns {Promise<Array>}
 */
async function getAccounts() {
  const session = await getSession();
  const url = `${config.MYFXBOOK_API_BASE}/get-my-accounts.json` +
    `?session=${encodeURIComponent(session)}`;

  const res = await fetch(url);
  const data = await res.json();

  if (!data || data.error) {
    // Session may have expired – reset and retry once.
    cachedSession = null;
    const freshSession = await getSession();
    const retryRes = await fetch(
      `${config.MYFXBOOK_API_BASE}/get-my-accounts.json` +
      `?session=${encodeURIComponent(freshSession)}`
    );
    const retryData = await retryRes.json();
    if (!retryData || retryData.error) {
      throw new Error(`MyFXBook getAccounts failed: ${retryData?.message || 'unknown error'}`);
    }
    return retryData.accounts || [];
  }

  return data.accounts || [];
}

/**
 * Fetch open orders/positions for a given account.
 * @param {string|number} accountId
 * @returns {Promise<Array>}
 */
async function getOpenOrders(accountId) {
  const session = await getSession();
  const url = `${config.MYFXBOOK_API_BASE}/get-open-orders.json` +
    `?session=${encodeURIComponent(session)}` +
    `&id=${encodeURIComponent(accountId)}`;

  const res = await fetch(url);
  const data = await res.json();

  if (!data || data.error) {
    throw new Error(`MyFXBook getOpenOrders failed: ${data?.message || 'unknown error'}`);
  }

  return data.openOrders || [];
}

/**
 * Fetch trade history for a given account.
 * @param {string|number} accountId
 * @param {string} [start] YYYY-MM-DD
 * @param {string} [end]   YYYY-MM-DD
 * @returns {Promise<Array>}
 */
async function getHistory(accountId, start, end) {
  const session = await getSession();
  let url = `${config.MYFXBOOK_API_BASE}/get-history.json` +
    `?session=${encodeURIComponent(session)}` +
    `&id=${encodeURIComponent(accountId)}`;

  if (start) url += `&start=${encodeURIComponent(start)}`;
  if (end) url += `&end=${encodeURIComponent(end)}`;

  const res = await fetch(url);
  const data = await res.json();

  if (!data || data.error) {
    throw new Error(`MyFXBook getHistory failed: ${data?.message || 'unknown error'}`);
  }

  return data.history || [];
}

module.exports = { getAccounts, getOpenOrders, getHistory };
