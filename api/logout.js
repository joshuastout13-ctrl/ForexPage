// api/logout.js
// POST /api/logout
// Clears the session cookie.

'use strict';

const { clearSessionCookie } = require('../lib/auth');

function send(res, status, body) {
  res.setHeader('Content-Type', 'application/json');
  res.status(status).end(JSON.stringify(body));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return send(res, 405, { error: 'Method Not Allowed' });
  }

  res.setHeader('Set-Cookie', clearSessionCookie());
  return send(res, 200, { ok: true });
};
