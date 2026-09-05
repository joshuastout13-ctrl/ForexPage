import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

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

/**
 * Canonical Paginated Read Utility for Supabase/PostgREST
 * Deterministically retrieves all rows using .range() pagination.
 */
export async function paginatedRead(table, options = {}) {
  const defaultOrderMap = {
    monthly_returns: "year",
    live_performance: "metric"
  };

  const {
    queryModifier = null,
    orderBy = defaultOrderMap[table] || "id",
    ascending = true,
    pageSize = 1000,
    maxRows = 50000,
    select = "*"
  } = options;

  if (!supabase) throw new Error("Supabase client not initialized");
  if (pageSize < 1 || pageSize > 1000) throw new Error("pageSize must be between 1 and 1000");

  const allRows = [];
  let from = 0;
  const maxPages = Math.ceil(maxRows / pageSize);

  for (let page = 0; page < maxPages; page++) {
    let query = supabase.from(table).select(select);

    if (queryModifier) {
      query = queryModifier(query);
    }

    query = query.order(orderBy, { ascending });
    query = query.range(from, from + pageSize - 1);

    const { data, error } = await query;

    if (error) {
      throw new Error(`paginatedRead("${table}") page ${page} failed: ${error.message}`);
    }

    if (!data || data.length === 0) break;

    allRows.push(...data);

    if (data.length < pageSize) break;

    from += pageSize;

    if (allRows.length >= maxRows) {
      throw new Error(`paginatedRead("${table}") exceeded maxRows safety limit (${maxRows})`);
    }
  }

  return allRows;
}

/**
 * Unified data fetcher for Supabase, 
 * now paginated to ensure complete-table semantics (>1000 rows supported).
 */
export async function readSupabaseTable(tableName, options = {}) {
  if (!supabase) throw new Error("Supabase client not initialized");
  
  const data = await paginatedRead(tableName, options);
  return data.map(normalizeRow);
}

/**
 * Updates the live_performance table with new metrics.
 * Skips any metrics that have is_override: true.
 * 
 * @param {Object} metrics - { today, week, month, year }
 */
export async function updateLivePerformance(metrics) {
  if (!supabase) return;

  const mapping = [
    { key: "today", metric: "Today" },
    { key: "week", metric: "This Week" },
    { key: "month", metric: "This Month" },
    { key: "year", metric: "This Year" }
  ];

  try {
    // 1. Fetch current overrides to respect them
    const { data: currentRows } = await supabase
      .from("live_performance")
      .select("metric, is_override");

    const overrides = new Set(
      (currentRows || [])
        .filter(r => r.is_override === true || r.is_override === "TRUE")
        .map(r => r.metric)
    );

    const updates = mapping
      .filter(m => !overrides.has(m.metric))
      .map(m => {
        const rawVal = metrics[m.key] || "0.00%";
        const cleanVal = rawVal.replace(/[+%\s]/g, "");
        
        return {
          metric: m.metric,
          value_pct: cleanVal,
          source: "Myfxbook (Scrape.do)",
          last_updated: new Date().toISOString()
        };
      });

    if (updates.length === 0) return;

    const { error } = await supabase
      .from("live_performance")
      .upsert(updates, { onConflict: "metric" });

    if (error) throw error;
    console.log(`[Supabase] Live performance synced for ${updates.length} metrics`);
  } catch (err) {
    console.error("[Supabase] Failed to update live performance:", err.message);
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
export async function syncOpenMonthlyReturn(grossMonthPctStr) {
  if (!supabase) return;
  if (!grossMonthPctStr || grossMonthPctStr === "N/A" || grossMonthPctStr === "NOT FOUND") return;

  const rawVal = String(grossMonthPctStr).replace(/[+%\s]/g, "");
  const numVal = parseFloat(rawVal);
  if (isNaN(numVal)) return;

  const monthNames = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  
  // Use fund accounting timezone (America/Los_Angeles)
  const ptString = new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" });
  const nowPt = new Date(ptString);
  const currentMonthIdx = nowPt.getMonth() + 1; // 1-12
  const currentYear = nowPt.getFullYear();

  try {
    // Check existing row for lock / manual override protection
    const { data: existingRows, error: fetchErr } = await supabase
      .from("monthly_returns")
      .select("*")
      .eq("year", currentYear)
      .eq("month_number", currentMonthIdx);

    if (fetchErr) throw fetchErr;

    const existing = existingRows?.[0];
    if (existing) {
      if (existing.locked === true || existing.locked === "TRUE") {
        console.log(`[Supabase] Skipping monthly_returns sync for ${monthNames[currentMonthIdx]} ${currentYear}: Month is locked/finalized.`);
        return;
      }
      if (existing.source === "Manual" || existing.is_override === true || existing.is_override === "TRUE") {
        console.log(`[Supabase] Skipping monthly_returns sync for ${monthNames[currentMonthIdx]} ${currentYear}: Manual override preserved.`);
        return;
      }
    }

    const payload = {
      year: currentYear,
      month_number: currentMonthIdx,
      month: monthNames[currentMonthIdx],
      gross_return_pct: numVal,
      source: "Myfxbook (Auto Sync)",
      locked: false,
      last_updated: new Date().toISOString()
    };

    const { error: upsertErr } = await supabase
      .from("monthly_returns")
      .upsert(payload, { onConflict: "year,month_number" });

    if (upsertErr) throw upsertErr;
    console.log(`[Supabase] Synced open monthly_returns for ${monthNames[currentMonthIdx]} ${currentYear}: ${numVal >= 0 ? "+" : ""}${numVal.toFixed(2)}%`);
  } catch (err) {
    console.error(`[Supabase] Failed to sync monthly_returns for month ${currentMonthIdx}:`, err.message);
  }
}
