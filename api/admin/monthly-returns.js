import { verifyAdminSession } from "../../lib/adminAuth.js";
import { supabase } from "../../lib/supabase.js";

const MONTH_MAP = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12
};

export default async function handler(req, res) {
  const session = verifyAdminSession(req);
  if (!session) return res.status(401).json({ error: "Unauthorized" });

  if (req.method === "GET") {
    try {
      const { data, error } = await supabase.from("monthly_returns").select("*").order("year", { ascending: false }).order("month_number", { ascending: false });
      if (error) throw error;
      return res.status(200).json({ monthlyReturns: data });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === "POST" || req.method === "PUT" || req.method === "PATCH") {
    try {
      const body = req.body || {};
      const year = Number(body.year);
      const monthStr = String(body.month || "").trim();
      const monthNumber = Number(body.monthNumber || body.month_number || MONTH_MAP[monthStr.toLowerCase()] || 0);

      if (!year || !monthNumber) {
        throw new Error("Year and valid Month are required");
      }

      const grossReturnPct = Number(body.grossReturnPct ?? body.gross_return_pct ?? 0);

      const updates = {
        year,
        month_number: monthNumber,
        month: monthStr || Object.keys(MONTH_MAP).find(k => MONTH_MAP[k] === monthNumber) || "Unknown",
        gross_return_pct: grossReturnPct,
        last_updated: new Date().toISOString()
      };

      if (body.source !== undefined) updates.source = body.source;
      if (body.notes !== undefined) updates.notes = body.notes;
      if (body.locked !== undefined) updates.locked = Boolean(body.locked);

      const { data, error } = await supabase
        .from("monthly_returns")
        .upsert(updates, { onConflict: "year,month_number" })
        .select();

      if (error) throw error;

      return res.status(200).json({ success: true, monthlyReturn: data[0] });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  res.status(405).json({ error: "Method not allowed" });
}

