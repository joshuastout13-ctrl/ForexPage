// api/login.js
// POST /api/login  { username, password }
// Validates credentials and sets an HttpOnly session cookie on success.

'use strict';

const config = require('../lib/config');
const { createToken, buildSessionCookie } = require('../lib/auth');

function send(res, status, body) {
  res.setHeader('Content-Type', 'application/json');
  res.status(status).end(JSON.stringify(body));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return send(res, 405, { error: 'Method Not Allowed' });
  }

  let body = req.body;

  // When the body hasn't been parsed (raw serverless), parse it manually.
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return send(res, 400, { error: 'Invalid JSON body' });
    }
  }

  const { username, password } = body || {};

  if (!username || !password) {
    return send(res, 400, { error: 'username and password are required' });
  }

  // Simple single-user credential check.
  // For production, compare a bcrypt hash stored in ADMIN_PASSWORD.
  if (
    username !== config.ADMIN_USERNAME ||
    password !== config.ADMIN_PASSWORD
  ) {
    return send(res, 401, { error: 'Invalid credentials' });
  }

  const token = createToken(username);
  res.setHeader('Set-Cookie', buildSessionCookie(token));
  return send(res, 200, { ok: true, username });
};
