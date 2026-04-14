// lib/auth.js
// JWT-based authentication helpers.
// Tokens are stored in an HttpOnly cookie so they are never accessible from JS.

'use strict';

const jwt = require('jsonwebtoken');
const cookie = require('cookie');
const config = require('./config');

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: 'Strict',
  path: '/',
  maxAge: 8 * 60 * 60, // 8 hours in seconds
};

/**
 * Create a signed JWT for the given username.
 * @param {string} username
 * @returns {string} signed JWT
 */
function createToken(username) {
  return jwt.sign({ sub: username }, config.JWT_SECRET, {
    expiresIn: config.JWT_EXPIRES_IN,
  });
}

/**
 * Verify a JWT string. Returns the decoded payload or null if invalid/expired.
 * @param {string} token
 * @returns {object|null}
 */
function verifyToken(token) {
  try {
    return jwt.verify(token, config.JWT_SECRET);
  } catch {
    return null;
  }
}

/**
 * Build the Set-Cookie header value that stores the session token.
 * @param {string} token
 * @returns {string}
 */
function buildSessionCookie(token) {
  return cookie.serialize(config.COOKIE_NAME, token, COOKIE_OPTIONS);
}

/**
 * Build the Set-Cookie header value that clears the session cookie.
 * @returns {string}
 */
function clearSessionCookie() {
  return cookie.serialize(config.COOKIE_NAME, '', {
    ...COOKIE_OPTIONS,
    maxAge: 0,
  });
}

/**
 * Extract and verify the session token from an incoming request's Cookie header.
 * @param {import('http').IncomingMessage} req
 * @returns {object|null} decoded JWT payload, or null if missing/invalid
 */
function getSessionFromRequest(req) {
  const cookieHeader = req.headers.cookie || '';
  const cookies = cookie.parse(cookieHeader);
  const token = cookies[config.COOKIE_NAME];
  if (!token) return null;
  return verifyToken(token);
}

module.exports = {
  createToken,
  verifyToken,
  buildSessionCookie,
  clearSessionCookie,
  getSessionFromRequest,
};
