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
 * Normalizes a field name for the dashboard logic, 
 * mapping a Supabase snake_case column to the app's keys.
 */
function normalizeRow(row) {
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
 * Unified data fetcher for Supabase, 
 * mimicking the readSheet response format where possible.
 */
export async function readSupabaseTable(tableName) {
  if (!supabase) throw new Error("Supabase client not initialized");
  
  const { data, error } = await supabase.from(tableName).select("*");
  if (error) throw error;
  
  return data.map(normalizeRow);
}
