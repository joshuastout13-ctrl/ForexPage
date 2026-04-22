import { verifyAdminSession } from "../../../lib/adminAuth.js";
import { supabase } from "../../../lib/supabase.js";

export default async function handler(req, res) {
  const session = verifyAdminSession(req);
  if (!session) return res.status(401).json({ error: "Unauthorized" });

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { rows } = req.body; // Array of monthly record objects
    if (!Array.isArray(rows)) return res.status(400).json({ error: "Invalid payload: rows must be an array" });

    const results = [];
    for (const row of rows) {
      const { data, error } = await supabase
        .from("investor_monthly_history")
        .upsert({
          ...row,
          updated_at: new Date()
        }, { onConflict: 'investor_id,year,month_number' })
        .select()
        .single();
      
      if (error) {
        results.push({ success: false, error: error.message, row });
      } else {
        results.push({ success: true, id: data.id });
      }
    }

    const successCount = results.filter(r => r.success).length;
    return res.status(200).json({ success: true, importedCount: successCount, total: rows.length, details: results });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}
