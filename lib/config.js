// lib/config.js
// Centralised configuration loaded from environment variables.
// Set these in your Vercel project settings (or a local .env file for `vercel dev`).

'use strict';

if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable must be set');
}
if (!process.env.ADMIN_PASSWORD) {
  throw new Error('ADMIN_PASSWORD environment variable must be set');
}

module.exports = {
  // ── Auth ──────────────────────────────────────────────────────────────────
  JWT_SECRET: process.env.JWT_SECRET,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '8h',
  COOKIE_NAME: 'forex_session',

  // ── Admin credentials (single-user setup) ────────────────────────────────
  // Store a bcrypt hash of the password in ADMIN_PASSWORD.
  // Generate one with: node -e "require('bcryptjs').hash('yourpass',12).then(console.log)"
  ADMIN_USERNAME: process.env.ADMIN_USERNAME || 'admin',
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,

  // ── Google Sheets ─────────────────────────────────────────────────────────
  // The service-account JSON key stored as a single env-var string.
  GOOGLE_SERVICE_ACCOUNT_JSON: process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '',
  SPREADSHEET_ID: process.env.SPREADSHEET_ID || '',
  SHEETS_DATA_RANGE: process.env.SHEETS_DATA_RANGE || 'Sheet1!A1:Z1000',

  // ── MyFXBook ──────────────────────────────────────────────────────────────
  MYFXBOOK_EMAIL: process.env.MYFXBOOK_EMAIL || '',
  MYFXBOOK_PASSWORD: process.env.MYFXBOOK_PASSWORD || '',
  MYFXBOOK_API_BASE: 'https://www.myfxbook.com/api',
};
