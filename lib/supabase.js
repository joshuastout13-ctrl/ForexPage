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
  
  // Mapping logic to preserve existing property names if needed
  // This helps avoid refactoring every single line of dashboard.js
  if (row.id) {
    newRow.investorsinvestorid = row.id;
    newRow.investorid = row.id;
    newRow.id = row.id;
  }
  if (row.split_pct) newRow.investorsplit = row.split_pct;
  if (row.monthly_draw) newRow.recurringmonthlydraw = row.monthly_draw;
  if (row.start_date) newRow.startdate = row.start_date;
  if (row.portal_username) newRow.portalusername = row.portal_username;
  if (row.temp_password) newRow.temp_password_prototype_only = row.temp_password;

  // Account mappings
  if (row.starting_capital) newRow.startingcapital = row.starting_capital;
  if (row.open_date) newRow.opendate = row.open_date;

  // Monthly returns mapping
  if (row.gross_return_pct) newRow.grossreturn = row.gross_return_pct;
  if (row.month_number) newRow.monthnumber = row.month_number;

  // Withdrawals/Deposits mapping
  if (row.amount) newRow.amount = row.amount;

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
