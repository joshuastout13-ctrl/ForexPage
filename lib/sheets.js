import { CONFIG } from "./config.js";

function normalizeKey(key) {
  return String(key || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function cellValue(cell) {
  if (!cell) return "";
  if (cell.f != null) return cell.f;
  if (cell.v == null) return "";
  return cell.v;
}

export async function readSheet(tabName) {
  const url =
    `https://docs.google.com/spreadsheets/d/${CONFIG.googleSheetId}` +
    `/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(tabName)}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to load sheet tab: ${tabName}`);
  }

  const text = await res.text();
  const match = text.match(/google\.visualization\.Query\.setResponse\((.*)\);/s);
  if (!match) {
    throw new Error(`Could not parse Google Sheet tab: ${tabName}`);
  }

  const json = JSON.parse(match[1]);
  const cols = (json.table.cols || []).map((c) => c.label || "");
  const rows = (json.table.rows || []).map((r) => {
    const obj = {};
    cols.forEach((col, i) => {
      obj[col] = cellValue(r.c?.[i]);
      obj[normalizeKey(col)] = cellValue(r.c?.[i]);
    });
    return obj;
  });

  return rows;
}

export function numberValue(v, fallback = 0) {
  if (v == null || v === "") return fallback;
  const cleaned = String(v).replace(/[%,$]/g, "").trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : fallback;
}

export function truthy(v) {
  const s = String(v ?? "").trim().toLowerCase();
  return !["", "0", "false", "no", "inactive"].includes(s);
}

export function monthNumberFromRow(row) {
  const direct = numberValue(row.monthnumber, NaN);
  if (Number.isFinite(direct) && direct >= 1 && direct <= 12) return direct;

  const month = String(row.month || "").trim().toLowerCase();
  const map = {
    january: 1,
    february: 2,
    march: 3,
    april: 4,
    may: 5,
    june: 6,
    july: 7,
    august: 8,
    september: 9,
    october: 10,
    november: 11,
    december: 12
  };
  return map[month] || NaN;
}
