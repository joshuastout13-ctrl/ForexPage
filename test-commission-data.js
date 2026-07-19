import { readSupabaseTable } from "./lib/supabase.js";
import { normalizeRow } from "./lib/supabase.js";

async function test() {
  const rows = await readSupabaseTable("commission_earnings");
  console.log("Found rows:", rows.length);
  if (rows.length > 0) {
    console.log("First 3 rows:");
    console.log(rows.slice(0, 3).map(normalizeRow));
  }
}
test();
