// api/me.js
// GET /api/me
// Returns the current user's identity and dashboard data if authenticated.
// Returns 401 if the session cookie is missing or invalid.

'use strict';

const { getSessionFromRequest } = require('../lib/auth');
const { getDashboardData } = require('../lib/dashboard');

function send(res, status, body) {
  res.setHeader('Content-Type', 'application/json');
  res.status(status).end(JSON.stringify(body));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return send(res, 405, { error: 'Method Not Allowed' });
  }

  const session = getSessionFromRequest(req);
  if (!session) {
    return send(res, 401, { error: 'Unauthorized' });
  }

  try {
    const dashboardData = await getDashboardData();
    return send(res, 200, {
      username: session.sub,
      ...dashboardData,
    });
  } catch (err) {
    console.error('[me] error fetching dashboard data:', err.message);
    return send(res, 500, { error: 'Failed to load dashboard data' });
  }
};
