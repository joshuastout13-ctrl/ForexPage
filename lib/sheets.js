// lib/sheets.js
// Reads trading data from a Google Spreadsheet using a service account.
//
// Required env vars:
//   GOOGLE_SERVICE_ACCOUNT_JSON  – full JSON key file contents (stringified)
//   SPREADSHEET_ID               – the spreadsheet ID from its URL
//   SHEETS_DATA_RANGE            – A1 notation range, e.g. "Sheet1!A1:Z1000"

'use strict';

const { google } = require('googleapis');
const config = require('./config');

/**
 * Build an authenticated Google Sheets client using the service-account key
 * stored in the GOOGLE_SERVICE_ACCOUNT_JSON environment variable.
 * @returns {import('googleapis').sheets_v4.Sheets}
 */
function getSheetsClient() {
  if (!config.GOOGLE_SERVICE_ACCOUNT_JSON) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON env var is not set');
  }

  const credentials = JSON.parse(config.GOOGLE_SERVICE_ACCOUNT_JSON);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });

  return google.sheets({ version: 'v4', auth });
}

/**
 * Fetch all rows from the configured spreadsheet range.
 * The first row is treated as a header row and used as object keys.
 *
 * @returns {Promise<Array<Record<string, string>>>} array of row objects
 */
async function getTradingData() {
  const sheets = getSheetsClient();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: config.SPREADSHEET_ID,
    range: config.SHEETS_DATA_RANGE,
  });

  const rows = response.data.values || [];
  if (rows.length === 0) return [];

  const [headers, ...dataRows] = rows;
  return dataRows.map((row) => {
    const obj = {};
    headers.forEach((header, i) => {
      obj[header] = row[i] !== undefined ? row[i] : '';
    });
    return obj;
  });
}

module.exports = { getTradingData };
