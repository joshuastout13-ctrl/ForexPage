import { CONFIG } from "./config.js";

// Normalize a column header to a simple lookup key
function normalizeKey(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Extract the best value from a gviz cell (prefer formatted string, then raw value)
function cellValue(cell) {
  if (!cell) return "";
  if (cell.f != null) return cell.f;
  if (cell.v == null) return "";
  return cell.v;
}

// Fetch and parse a named tab from the configured Google Sheet.
// The sheet must be publicly readable ("Anyone with the link can view").
export async function readSheet(tabName) {
  const url =
    `https://docs.google.com/spreadsheets/d/${CONFIG.googleSheetId}` +
    `/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(tabName)}`;

  let res;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new Error(`Network error fetching sheet "${tabName}": ${err.message}`);
  }

  if (!res.ok) {
    throw new Error(
      `Google Sheets returned HTTP ${res.status} for tab "${tabName}". ` +
      "Make sure the spreadsheet is shared as 'Anyone with the link can view'."
    );
  }

  const text = await res.text();
  const match = text.match(/google\.visualization\.Query\.setResponse\(([\s\S]*?)\);/);
  if (!match) {
    throw new Error(
      `Could not parse response for sheet tab "${tabName}". ` +
      "The sheet may be private or the tab name may be wrong."
    );
  }

  let json;
  try {
    json = JSON.parse(match[1]);
  } catch {
    throw new Error(`Invalid JSON from sheet tab "${tabName}"`);
  }

  const cols = (json.table?.cols || []).map((c) => c.label || "");
  return (json.table?.rows || []).map((r) => {
    const obj = {};
    cols.forEach((col, i) => {
      const val = cellValue(r.c?.[i]);
      obj[col] = val;
      obj[normalizeKey(col)] = val;
    });
    return obj;
  });
}

// Parse a number from a cell value, stripping common formatting characters.
export function num(v, fallback = 0) {
  if (v == null || v === "") return fallback;
  const n = Number(String(v).replace(/[%,$\s]/g, "").trim());
  return Number.isFinite(n) ? n : fallback;
}

// Backward-compatible alias
export const numberValue = num;

// Return true unless the value is clearly falsy/inactive.
export function bool(v) {
  const s = String(v ?? "").trim().toLowerCase();
  return !["", "0", "false", "no", "inactive", "n"].includes(s);
}

// Backward-compatible alias
export const truthy = bool;

// Derive a month number (1–12) from a row object.
// Tries a "MonthNumber" column first, then parses the "Month" column as a name.
export function monthNum(row) {
  const direct = num(row.monthnumber ?? row.monthno, NaN);
  if (Number.isFinite(direct) && direct >= 1 && direct <= 12) return direct;

  const name = String(row.month || "").trim().toLowerCase();
  const map = {
    january: 1, february: 2, march: 3, april: 4,
    may: 5, june: 6, july: 7, august: 8,
    september: 9, october: 10, november: 11, december: 12
  };
  return map[name] || NaN;
}

// Backward-compatible alias
export const monthNumberFromRow = monthNum;
