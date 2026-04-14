// api/health.js
// GET /api/health
// Simple liveness check — returns 200 with basic status info.

'use strict';

function send(res, status, body) {
  res.setHeader('Content-Type', 'application/json');
  res.status(status).end(JSON.stringify(body));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return send(res, 405, { error: 'Method Not Allowed' });
  }

  return send(res, 200, {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
};
