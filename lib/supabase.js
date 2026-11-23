import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { getFundAccountingDate, evaluateMonthState, MonthState, FUND_ACCOUNTING_TIMEZONE } from "./month-state.js";

// Load local environment variables if we are not in a production environment (like Vercel)
if (process.env.NODE_ENV !== "production") {
  dotenv.config({ path: ".env.local" });
}

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  console.warn("Supabase credentials missing. Falling back to sheets or failing...");
}

export const supabase = (supabaseUrl && supabaseServiceRoleKey) 
  ? createClient(supabaseUrl, supabaseServiceRoleKey)
  : null;

/**
 * Returns true if Supabase is initialized and connected to authoritative production project.
 */
export function isAuthoritativeProductionDbConfigured() {
  const url = process.env.SUPABASE_URL || "";
  return Boolean(supabase && url.toLowerCase().includes("julhldzkiqdeuuoqmvlo"));
}

/**
 * Normalizes a field name for the dashboard logic, 
 * mapping a Supabase snake_case column to the app's keys.
 */
export function normalizeRow(row) {
  if (!row) return row;
  const newRow = { ...row };
  
  // 1. Generic alphanumeric normalization (matches lib/sheets.js normalizeKey)
  // This automatically handles most mappings by cleaning underscores
  Object.keys(row).forEach(key => {
    const cleanKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    newRow[cleanKey] = row[key];
  });

  // 2. Specific field aliases to maintain compatibility with legacy sheet-specifc keys
  // For most tables, "id" is the primary key and "investor_id" is the link.
  // We only map row.id to these long legacy aliases if they haven't been set yet.
  if (row.id) {
    if (!newRow.investorsinvestorid) newRow.investorsinvestorid = row.id;
    if (!newRow.investoraccountsaccountid) newRow.investoraccountsaccountid = row.id;
    if (!newRow.depositsdepositid) newRow.depositsdepositid = row.id;
    if (!newRow.withdrawalswithdrawalid) newRow.withdrawalswithdrawalid = row.id;
    if (!newRow.investormonthlysnapshotssnapshotid) newRow.investormonthlysnapshotssnapshotid = row.id;
  }
  
  if (row.split_pct !== undefined) newRow.investorsplit = row.split_pct;
  if (row.monthly_draw !== undefined) newRow.recurringmonthlydraw = row.monthly_draw;
  if (row.gross_return_pct !== undefined) {
    newRow.grossreturn = row.gross_return_pct;
    newRow.monthlyreturnsgrossfundreturnsbeforeinvestorsplityear = row.year; // mapping for return year
  }
  
  // Performance metric mapping
  if (row.metric) {
    newRow.liveperformancemyfxbookfeedormanualfallbackmetric = row.metric;
    newRow.value = row.value_pct;
  }

  return newRow;
}

const DEFAULT_PAGE_SIZE = 1000;
const MAX_PAGE_SIZE = 1000;
const DEFAULT_MAX_ROWS = 50000;
const DEFAULT_MAX_REQUESTS = 1000;

// Schema-verified primary and NOT NULL unique keys from checked-in repository SQL definitions:
// - supabase/schema.sql (investors, investor_accounts, deposits, withdrawals, monthly_returns,
//   live_performance, snapshots, investor_monthly_history)
// - supabase/schema_update_v2.sql (commission_rules, commission_earnings)
// - supabase/schema_update_v3.sql (commission_shares)
// - supabase/schema_update_v4.sql (audit_runs)
// - supabase/admin_email_logs.sql (admin_email_logs)
// - supabase/migrations/20261114_unified_cashflow_draw_and_close_protection.sql (payment_provider_events)
// - docs/production_accounting_migration.sql (accounting_periods, accounting_preview_runs)
// - docs/ACCOUNT_CUTOVER_MECHANISM_MIGRATION.sql (account_cutover_adjustments)
//
// Used to:
// 1. Provide deterministic default ordering backed solely by verified schema keys (never guessing "id").
// 2. Append missing verified unique tie-breaker column(s) when a caller supplies a non-unique order.
// 3. Detect repeated/overlapping/no-progress pages using only verified unique keys when present in
//    returned rows (never deduplicating by business-row equality).
// Tables without a verified entry here fail closed rather than claiming stable multi-page pagination.
const VERIFIED_TABLE_KEYS = Object.freeze({
  investors: Object.freeze({ primary: Object.freeze(["id"]), alternates: Object.freeze([]) }),
  investor_accounts: Object.freeze({ primary: Object.freeze(["id"]), alternates: Object.freeze([]) }),
  deposits: Object.freeze({ primary: Object.freeze(["id"]), alternates: Object.freeze([]) }),
  withdrawals: Object.freeze({ primary: Object.freeze(["id"]), alternates: Object.freeze([]) }),
  monthly_returns: Object.freeze({ primary: Object.freeze(["year", "month_number"]), alternates: Object.freeze([]) }),
  live_performance: Object.freeze({ primary: Object.freeze(["metric"]), alternates: Object.freeze([]) }),
  snapshots: Object.freeze({ primary: Object.freeze(["id"]), alternates: Object.freeze([]) }),
  investor_monthly_history: Object.freeze({ primary: Object.freeze(["id"]), alternates: Object.freeze([]) }),
  commission_rules: Object.freeze({ primary: Object.freeze(["id"]), alternates: Object.freeze([]) }),
  commission_earnings: Object.freeze({ primary: Object.freeze(["id"]), alternates: Object.freeze([]) }),
  commission_shares: Object.freeze({ primary: Object.freeze(["id"]), alternates: Object.freeze([]) }),
  audit_runs: Object.freeze({ primary: Object.freeze(["id"]), alternates: Object.freeze([]) }),
  admin_email_logs: Object.freeze({ primary: Object.freeze(["id"]), alternates: Object.freeze([]) }),
  account_cutover_adjustments: Object.freeze({ primary: Object.freeze(["id"]), alternates: Object.freeze([]) }),
  accounting_periods: Object.freeze({
    primary: Object.freeze(["year", "month_number"]),
    alternates: Object.freeze([Object.freeze(["id"])])
  }),
  accounting_preview_runs: Object.freeze({ primary: Object.freeze(["id"]), alternates: Object.freeze([]) }),
  payment_provider_events: Object.freeze({
    primary: Object.freeze(["id"]),
    alternates: Object.freeze([Object.freeze(["provider", "provider_event_id"])])
  })
});

function getVerifiedTableKeys(table) {
  if (!Object.prototype.hasOwnProperty.call(VERIFIED_TABLE_KEYS, table)) {
    throw new Error(
      `paginatedRead("${table}"): no schema-verified unique key is registered for deterministic pagination`
    );
  }
  return VERIFIED_TABLE_KEYS[table];
}

function assertPositiveSafeInteger(value, optionName, { max = Number.MAX_SAFE_INTEGER } = {}) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > max) {
    const rangeDesc =
      max < Number.MAX_SAFE_INTEGER
        ? `a finite integer between 1 and ${max}`
        : "a finite positive integer";
    throw new Error(`paginatedRead: ${optionName} must be ${rangeDesc}`);
  }
}

function normalizeOrderSpecs(table, rawOrderBy, defaultAscending, keyMeta) {
  if (rawOrderBy === undefined) {
    return keyMeta.primary.map((column) => ({ column, ascending: defaultAscending }));
  }

  const normalizeEntry = (entry) => {
    if (typeof entry === "string") {
      const col = entry.trim();
      if (!col) {
        throw new Error("paginatedRead: orderBy column name must be a non-empty string");
      }
      return { column: col, ascending: defaultAscending };
    }
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      if (typeof entry.column !== "string" || !entry.column.trim()) {
        throw new Error("paginatedRead: orderBy spec object must have a non-empty string column");
      }
      if (entry.ascending !== undefined && typeof entry.ascending !== "boolean") {
        throw new Error("paginatedRead: orderBy spec ascending must be a boolean when provided");
      }
      return {
        column: entry.column.trim(),
        ascending: entry.ascending !== undefined ? entry.ascending : defaultAscending
      };
    }
    throw new Error("paginatedRead: orderBy must be a column name, order spec object, or non-empty array of them");
  };

  let callerSpecs;
  if (Array.isArray(rawOrderBy)) {
    if (rawOrderBy.length === 0) {
      throw new Error("paginatedRead: orderBy array must not be empty");
    }
    callerSpecs = rawOrderBy.map(normalizeEntry);
  } else {
    callerSpecs = [normalizeEntry(rawOrderBy)];
  }

  // Ensure every caller-supplied order forms a deterministic total order by appending
  // any missing columns from the table's schema-verified primary key when the caller's
  // order does not already cover a verified unique key. Already-present columns and their
  // explicit directions are preserved without duplication.
  const presentColumns = new Set(callerSpecs.map((spec) => spec.column.toLowerCase()));
  const allVerifiedKeys = [keyMeta.primary, ...keyMeta.alternates];
  const alreadyCoversUniqueKey = allVerifiedKeys.some((keyCols) =>
    keyCols.every((col) => presentColumns.has(col.toLowerCase()))
  );
  if (alreadyCoversUniqueKey) {
    return callerSpecs;
  }

  const stabilized = callerSpecs.slice();
  for (const keyCol of keyMeta.primary) {
    if (!presentColumns.has(keyCol.toLowerCase())) {
      stabilized.push({ column: keyCol, ascending: true });
      presentColumns.add(keyCol.toLowerCase());
    }
  }
  return stabilized;
}

function extractPageVerifiedKeys(rows, keyCols) {
  const pageKeys = [];
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const parts = [];
    for (let k = 0; k < keyCols.length; k += 1) {
      const col = keyCols[k];
      const val = row[col];
      if (val === undefined || val === null) {
        return null;
      }
      parts.push([typeof val, String(val)]);
    }
    pageKeys.push(JSON.stringify(parts));
  }
  return pageKeys;
}

/**
 * Canonical Paginated Read Utility for Supabase/PostgREST.
 * Deterministically retrieves all rows using ordered `.range()` pagination.
 *
 * Contract & safety invariants:
 * - Defaults: `pageSize = 1000` (1..1000), `maxRows = 50000`,
 *   `maxRequests = Math.max(1000, Math.ceil(maxRows / pageSize) + 1)` (alias `maxPages`).
 *   Explicitly supplied invalid values (`null`, strings, floats, `NaN`, `Infinity`, `0`, negatives)
 *   throw instead of silently falling back to defaults.
 * - Schema-verified deterministic ordering: Every table read must have a schema-verified unique
 *   key in `VERIFIED_TABLE_KEYS` (unverified tables fail closed rather than guessing `"id"`).
 *   Default ordering uses the verified key (`monthly_returns` and `accounting_periods` use
 *   `["year", "month_number"]`, `live_performance` uses `["metric"]`, `id`-keyed tables use `["id"]`).
 *   Caller-supplied single-column or composite `orderBy` preserves explicit directions and appends
 *   any missing verified primary-key column(s) (`ascending: true`) on every page without duplicating
 *   already-present columns or altering the caller's `select` projection.
 * - EOF & short pages: Advances offset by `data.length` and continues after short, nonempty pages
 *   when the server caps page size below `pageSize`. Only an empty array (`[]`) signals EOF.
 * - Fail-closed: Throws (never returning partial results) on query errors, malformed/null/non-array
 *   responses, non-object row entries, row-limit overflow (allows up to exact `maxRows` once EOF
 *   is confirmed by a subsequent empty page; any additional row throws), and request-limit overflow
 *   before EOF is established.
 * - Repeated-page / no-progress detection: Enabled strictly when returned rows carry all columns of
 *   a schema-verified unique key for `table`; never deduplicates by business-row equality, so
 *   legitimate duplicate business rows in non-keyed projections are preserved.
 *
 * Snapshot / offset-drift limitation:
 * - Independent `.range()` page requests do NOT execute inside a single consistent database snapshot.
 * - If rows are inserted, deleted, or updated in ways that change filter membership while pagination
 *   is running, offset drift can still occur: deletions/exclusions before the current offset may skip
 *   rows undetected, while insertions before the current offset may shift previously seen rows into a
 *   subsequent page (rejected fail-closed when verified unique keys are present in returned rows).
 */
export async function paginatedRead(table, options = {}) {
  if (typeof table !== "string" || !table.trim()) {
    throw new Error("paginatedRead: table must be a non-empty string");
  }
  if (options !== undefined && (options === null || typeof options !== "object" || Array.isArray(options))) {
    throw new Error("paginatedRead: options must be an object");
  }

  const opts = options || {};

  if (opts.queryModifier !== undefined && opts.queryModifier !== null && typeof opts.queryModifier !== "function") {
    throw new Error("paginatedRead: queryModifier must be a function when provided");
  }
  if (opts.ascending !== undefined && typeof opts.ascending !== "boolean") {
    throw new Error("paginatedRead: ascending must be a boolean when provided");
  }
  if (opts.select !== undefined && (typeof opts.select !== "string" || !opts.select.trim())) {
    throw new Error("paginatedRead: select must be a non-empty string when provided");
  }
  if (opts.client !== undefined && opts.client !== null && typeof opts.client.from !== "function") {
    throw new Error("paginatedRead: client must provide a from() method when provided");
  }

  const pageSize = opts.pageSize === undefined ? DEFAULT_PAGE_SIZE : opts.pageSize;
  assertPositiveSafeInteger(pageSize, "pageSize", { max: MAX_PAGE_SIZE });

  const maxRows = opts.maxRows === undefined ? DEFAULT_MAX_ROWS : opts.maxRows;
  assertPositiveSafeInteger(maxRows, "maxRows");

  if (opts.maxRequests !== undefined) {
    assertPositiveSafeInteger(opts.maxRequests, "maxRequests");
  }
  if (opts.maxPages !== undefined) {
    assertPositiveSafeInteger(opts.maxPages, "maxPages");
  }
  if (opts.maxRequests !== undefined && opts.maxPages !== undefined && opts.maxRequests !== opts.maxPages) {
    throw new Error("paginatedRead: conflicting maxRequests and maxPages options");
  }

  const minFullPagesWithEof = Math.ceil(maxRows / pageSize) + 1;
  const defaultRequestBound = Number.isSafeInteger(minFullPagesWithEof)
    ? Math.max(DEFAULT_MAX_REQUESTS, minFullPagesWithEof)
    : DEFAULT_MAX_REQUESTS;
  const maxRequests =
    opts.maxRequests !== undefined
      ? opts.maxRequests
      : opts.maxPages !== undefined
        ? opts.maxPages
        : defaultRequestBound;

  const queryModifier = opts.queryModifier || null;
  const ascending = opts.ascending === undefined ? true : opts.ascending;
  const select = opts.select === undefined ? "*" : opts.select;
  const keyMeta = getVerifiedTableKeys(table);
  const orderSpecs = normalizeOrderSpecs(table, opts.orderBy, ascending, keyMeta);

  const db = opts.client !== undefined && opts.client !== null ? opts.client : supabase;
  if (!db || typeof db.from !== "function") {
    throw new Error("Supabase client not initialized");
  }

  const candidateUniqueKeys = [keyMeta.primary, ...keyMeta.alternates];
  let activeDetectionKeyCols = null;
  const seenUniqueKeys = new Set();
  const seenPageKeySignatures = new Set();

  const allRows = [];
  let from = 0;
  let pageRequests = 0;
  let reachedEnd = false;

  while (true) {
    if (pageRequests >= maxRequests) {
      throw new Error(
        `paginatedRead("${table}") exceeded maxRequests safety limit (${maxRequests}) at offset ${from} after ${allRows.length} rows`
      );
    }
    pageRequests += 1;

    const rangeStart = from;
    const rangeEnd = from + pageSize - 1;
    if (!Number.isSafeInteger(rangeStart) || !Number.isSafeInteger(rangeEnd) || rangeEnd < rangeStart) {
      throw new Error(
        `paginatedRead("${table}") computed invalid range [${rangeStart}, ${rangeEnd}] on request ${pageRequests}`
      );
    }

    let response;
    let data;
    let error;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      let query = db.from(table).select(select);

      if (queryModifier) {
        query = queryModifier(query);
        if (!query || typeof query.order !== "function") {
          throw new Error(`paginatedRead("${table}") queryModifier did not return a valid query builder`);
        }
      }

      for (const spec of orderSpecs) {
        query = query.order(spec.column, { ascending: spec.ascending });
      }
      if (!query || typeof query.range !== "function") {
        throw new Error(`paginatedRead("${table}") query builder does not provide range()`);
      }
      query = query.range(rangeStart, rangeEnd);

      response = await query;
      if (!response || typeof response !== "object" || Array.isArray(response)) {
        throw new Error(
          `paginatedRead("${table}") request ${pageRequests} (offset ${rangeStart}) returned malformed response`
        );
      }

      ({ data, error } = response);
      if (!error) break;
      const errMsg = typeof error === "object" && error !== null && error.message !== undefined
        ? String(error.message)
        : String(error);
      const transient = /fetch failed|econnreset|etimedout|timeout/i.test(errMsg);
      if (!transient || attempt === 2) break;
      await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
    }

    if (error) {
      const errMsg = typeof error === "object" && error !== null && error.message !== undefined
        ? String(error.message)
        : String(error);
      throw new Error(`paginatedRead("${table}") request ${pageRequests} (offset ${rangeStart}) failed: ${errMsg}`);
    }

    if (!Array.isArray(data)) {
      const receivedType = data === null ? "null" : typeof data;
      throw new Error(
        `paginatedRead("${table}") request ${pageRequests} (offset ${rangeStart}) returned non-array data (${receivedType})`
      );
    }

    // Only an empty array signals end-of-data.
    // Short, nonempty pages continue so smaller server-side page caps do not truncate results.
    if (data.length === 0) {
      reachedEnd = true;
      break;
    }

    for (let i = 0; i < data.length; i += 1) {
      const row = data[i];
      if (!row || typeof row !== "object" || Array.isArray(row)) {
        throw new Error(
          `paginatedRead("${table}") request ${pageRequests} (offset ${rangeStart}) returned malformed row at index ${i}`
        );
      }
    }

    // Safe repeated-page / no-progress detection using only schema-verified unique keys
    // when all columns of a verified key are present on returned rows (never business-row equality).
    let pendingPageSignature = null;
    let pendingPageKeySet = null;
    let pageKeys = null;

    if (activeDetectionKeyCols) {
      pageKeys = extractPageVerifiedKeys(data, activeDetectionKeyCols);
      if (pageKeys === null) {
        throw new Error(
          `paginatedRead("${table}") request ${pageRequests} (offset ${rangeStart}) returned missing/null verified key column (${activeDetectionKeyCols.join(", ")})`
        );
      }
    } else if (pageRequests === 1) {
      for (const keyCols of candidateUniqueKeys) {
        const extracted = extractPageVerifiedKeys(data, keyCols);
        if (extracted !== null) {
          activeDetectionKeyCols = keyCols;
          pageKeys = extracted;
          break;
        }
      }
    }

    if (pageKeys !== null && activeDetectionKeyCols !== null) {
      const pageSignature = JSON.stringify(pageKeys);
      if (seenPageKeySignatures.has(pageSignature)) {
        throw new Error(
          `paginatedRead("${table}") request ${pageRequests} (offset ${rangeStart}) returned a repeated page for verified key (${activeDetectionKeyCols.join(", ")})`
        );
      }

      const currentPageKeySet = new Set();
      let newKeysCount = 0;
      let duplicateInPage = null;
      let overlappingAcrossPages = null;

      for (let i = 0; i < pageKeys.length; i += 1) {
        const key = pageKeys[i];
        if (currentPageKeySet.has(key)) {
          duplicateInPage = key;
        } else {
          currentPageKeySet.add(key);
          if (seenUniqueKeys.has(key)) {
            overlappingAcrossPages = key;
          } else {
            newKeysCount += 1;
          }
        }
      }

      if (newKeysCount === 0) {
        throw new Error(
          `paginatedRead("${table}") request ${pageRequests} (offset ${rangeStart}) made no progress (all verified keys were already seen)`
        );
      }
      if (duplicateInPage !== null) {
        throw new Error(
          `paginatedRead("${table}") request ${pageRequests} (offset ${rangeStart}) returned duplicate verified key within page`
        );
      }
      if (overlappingAcrossPages !== null) {
        throw new Error(
          `paginatedRead("${table}") request ${pageRequests} (offset ${rangeStart}) returned already-seen verified key (possible offset drift or range-ignoring response)`
        );
      }

      pendingPageSignature = pageSignature;
      pendingPageKeySet = currentPageKeySet;
    }

    // Allow up to exact maxRows; throw if total rows would exceed maxRows.
    // Reaching exact maxRows continues to the next request to confirm an empty EOF page.
    if (allRows.length + data.length > maxRows) {
      throw new Error(
        `paginatedRead("${table}") exceeded maxRows safety limit (${maxRows}) on request ${pageRequests} (offset ${rangeStart})`
      );
    }

    if (pendingPageSignature !== null && pendingPageKeySet !== null) {
      seenPageKeySignatures.add(pendingPageSignature);
      for (const key of pendingPageKeySet) {
        seenUniqueKeys.add(key);
      }
    }

    allRows.push(...data);

    const nextFrom = from + data.length;
    if (!Number.isSafeInteger(nextFrom) || nextFrom <= from) {
      throw new Error(
        `paginatedRead("${table}") request ${pageRequests} made no pagination progress at offset ${from}`
      );
    }
    from = nextFrom;
  }

  if (!reachedEnd) {
    throw new Error(`paginatedRead("${table}") terminated before reaching empty EOF page`);
  }

  return allRows;
}

/**
 * Unified data fetcher for Supabase,
 * paginated via `paginatedRead` to ensure complete-table semantics (>1000 rows supported).
 * Note: Like `paginatedRead`, independent `.range()` requests do not share one database snapshot
 * and can experience offset drift if underlying records change concurrently.
 */
export async function readSupabaseTable(tableName, options = {}) {
  if (options !== undefined && (options === null || typeof options !== "object" || Array.isArray(options))) {
    throw new Error("readSupabaseTable: options must be an object");
  }
  const db = options && options.client !== undefined && options.client !== null ? options.client : supabase;
  if (!db) throw new Error("Supabase client not initialized");

  const data = await paginatedRead(tableName, options);
  return data.map(normalizeRow);
}

/**
 * Updates the live_performance table with new metrics.
 * Skips any metrics that have is_override: true.
 * Never overwrites This Month / This Year with 0.00% when missing/null,
 * and during intraday sync preserves existing stored values for null ("-") cells.
 *
 * @param {Object} metrics - { today, week, month, year }
 * @param {Object} [options={}]
 */
export async function updateLivePerformance(metrics, options = {}) {
  const client = options.customClient || supabase;
  if (!client) return { skipped: true, reason: "NO_CLIENT" };

  const preserveAllMissing = Boolean(options.preserveMissing);
  const sourceLabel = options.source || "Myfxbook (Scrape.do)";

  const mapping = [
    { key: "today", metric: "Today", allowZeroResetOnMissing: !preserveAllMissing },
    { key: "week", metric: "This Week", allowZeroResetOnMissing: !preserveAllMissing },
    { key: "month", metric: "This Month", allowZeroResetOnMissing: false },
    { key: "year", metric: "This Year", allowZeroResetOnMissing: false }
  ];

  try {
    // 1. Fetch current overrides to respect them
    const { data: currentRows } = await client
      .from("live_performance")
      .select("metric, is_override");

    const overrides = new Set(
      (currentRows || [])
        .filter(r => r.is_override === true || r.is_override === "TRUE")
        .map(r => r.metric)
    );

    const nowIso = new Date().toISOString();
    const updates = [];
    for (const m of mapping) {
      if (overrides.has(m.metric)) continue;
      const raw = metrics?.[m.key];
      const hasValidRaw = raw !== null && raw !== undefined && raw !== "" && raw !== "N/A" && raw !== "NOT FOUND";
      if (!hasValidRaw && !m.allowZeroResetOnMissing) {
        continue;
      }
      const rawVal = hasValidRaw ? String(raw) : "0.00%";
      const cleanVal = rawVal.replace(/[+%\s]/g, "");
      if (cleanVal === "" || isNaN(Number(cleanVal))) continue;

      updates.push({
        metric: m.metric,
        value_pct: cleanVal,
        source: sourceLabel,
        last_updated: nowIso,
        updated_at: nowIso
      });
    }

    if (updates.length === 0) return { success: true, updatedCount: 0 };

    const { error } = await client
      .from("live_performance")
      .upsert(updates, { onConflict: "metric" });

    if (error) throw error;
    console.log(`[Supabase] Live performance synced for ${updates.length} metrics (${sourceLabel})`);
    return { success: true, updatedCount: updates.length };
  } catch (err) {
    console.error("[Supabase] Failed to update live performance:", err.message);
    return { error: err.message };
  }
}

/**
 * Safely synchronizes the current in-progress monthly gross return from Myfxbook
 * into the monthly_returns table.
 * 
 * Safety & Accounting Rules:
 * 1. Only updates if the target monthly_returns row is NOT locked (locked !== true).
 * 2. Only updates if the row was NOT manually entered (source !== 'Manual' and is_override !== true).
 * 3. Uses fund accounting timezone (America/Los_Angeles) to determine the active calendar month.
 * 4. Month remains OPEN / IN PROGRESS (locked is kept false).
 * 5. Uses idempotent upsert on conflict (year, month_number).
 */
export async function syncOpenMonthlyReturn(grossMonthPctStr, asOfDate = null, customClient = null) {
  const client = customClient || supabase;
  if (!client) return { skipped: true, reason: "NO_CLIENT" };
  if (!grossMonthPctStr || grossMonthPctStr === "N/A" || grossMonthPctStr === "NOT FOUND") {
    return { skipped: true, reason: "INVALID_STRING" };
  }

  const rawVal = String(grossMonthPctStr).replace(/[+%\s]/g, "");
  const numVal = parseFloat(rawVal);
  if (isNaN(numVal)) return { skipped: true, reason: "NAN_VALUE" };

  const monthNames = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  
  const evalDate = asOfDate ? new Date(asOfDate) : new Date();
  if (isNaN(evalDate.getTime())) {
    throw new Error(`INVALID_DATE: Cannot parse asOfDate: ${asOfDate}`);
  }

  // 1. Upstream rollover race condition guard:
  // Upstream providers (e.g. Myfxbook) operate on UTC or broker time (UTC+2/UTC+3).
  // At the month boundary (e.g. 2026-10-01T05:42:26Z), upstream has already rolled over
  // to the new month (October), reporting 0.00% or early new-month returns, while
  // fund accounting in America/Los_Angeles is still in the prior month (September 30 22:42 PDT).
  // Applying an upstream feed that has already rolled over would catastrophically overwrite
  // the prior accounting month with the new month's feed.
  const utcYear = evalDate.getUTCFullYear();
  const utcMonth = evalDate.getUTCMonth() + 1;
  const utcPeriod = utcYear * 12 + utcMonth;

  // Use fund accounting timezone (America/Los_Angeles) — authoritative source
  const { monthNumber: currentMonthIdx, year: currentYear } = getFundAccountingDate(evalDate);
  const ptPeriod = currentYear * 12 + currentMonthIdx;

  if (utcPeriod > ptPeriod) {
    console.warn(
      `[Supabase] Upstream feed rollover race detected at ${evalDate.toISOString()}: ` +
      `Upstream calendar is ${utcYear}-${utcMonth}, but fund accounting (${FUND_ACCOUNTING_TIMEZONE}) ` +
      `is still ${currentYear}-${currentMonthIdx}. Preventing overwrite of closing month ${monthNames[currentMonthIdx]} ${currentYear}.`
    );
    return { skipped: true, reason: "UPSTREAM_ROLLOVER_RACE" };
  }

  // 2. Settled Period Protection:
  // syncOpenMonthlyReturn is STRICTLY for the active in-progress month (CURRENT_OPEN).
  // It must NEVER mutate a historical settled accounting period.
  const monthState = evaluateMonthState(currentYear, currentMonthIdx, evalDate);
  if (monthState === MonthState.HISTORICAL_SETTLED) {
    console.warn(
      `[Supabase] Skipping monthly_returns sync for ${monthNames[currentMonthIdx]} ${currentYear}: ` +
      `Period is HISTORICAL_SETTLED. Settled months are immutable to live feed synchronization.`
    );
    return { skipped: true, reason: "PERIOD_SETTLED" };
  }

  try {
    // 3. Check existing row for lock / finalization / manual override protection
    const { data: existingRows, error: fetchErr } = await client
      .from("monthly_returns")
      .select("*")
      .eq("year", currentYear)
      .eq("month_number", currentMonthIdx);

    if (fetchErr) throw fetchErr;

    const existing = existingRows?.[0];
    if (existing) {
      if (
        existing.locked === true || 
        existing.locked === "TRUE" || 
        existing.is_finalized === true || 
        existing.is_finalized === "TRUE" ||
        String(existing.status || "").toUpperCase() === "FINALIZED" ||
        String(existing.status || "").toUpperCase() === "SETTLED"
      ) {
        console.log(`[Supabase] Skipping monthly_returns sync for ${monthNames[currentMonthIdx]} ${currentYear}: Month is locked/finalized.`);
        return { skipped: true, reason: "MONTH_LOCKED" };
      }
      if (existing.source === "Manual" || existing.is_override === true || existing.is_override === "TRUE") {
        console.log(`[Supabase] Skipping monthly_returns sync for ${monthNames[currentMonthIdx]} ${currentYear}: Manual override preserved.`);
        return { skipped: true, reason: "MANUAL_OVERRIDE" };
      }
    }

    // 4. Note on 0.00%:
    // A gross return of 0.00% is mathematically valid and NOT blacklisted.
    // The protection above relies strictly on period state, rollover race detection, and finalization/locks.
    const payload = {
      year: currentYear,
      month_number: currentMonthIdx,
      month: monthNames[currentMonthIdx],
      gross_return_pct: numVal,
      source: "Myfxbook (Auto Sync)",
      locked: false,
      last_updated: new Date().toISOString()
    };

    const { error: upsertErr } = await client
      .from("monthly_returns")
      .upsert(payload, { onConflict: "year,month_number" });

    if (upsertErr) throw upsertErr;
    console.log(`[Supabase] Synced open monthly_returns for ${monthNames[currentMonthIdx]} ${currentYear}: ${numVal >= 0 ? "+" : ""}${numVal.toFixed(2)}%`);
    return { success: true, updated: true, payload };
  } catch (err) {
    console.error(`[Supabase] Failed to sync monthly_returns for month ${currentMonthIdx}:`, err.message);
    return { error: err.message };
  }
}
