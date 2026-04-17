import { verifyAdminSession } from "../../lib/adminAuth.js";
import { supabase } from "../../lib/supabase.js";

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

  if (req.method === "POST") {
    try {
      const body = req.body || {};
      
      const payload = {
        year: Number(body.year),
        month_number: Number(body.monthNumber),
        month: body.month,
        gross_return_pct: Number(body.grossReturnPct || 0),
        source: body.source || "Manual",
        notes: body.notes || "",
        locked: body.locked === true
        // created_at is default
      };

      if (!payload.year || !payload.month_number || !payload.month) throw new Error("Year, month_number, and month are required");

      const { data, error } = await supabase.from("monthly_returns").insert([payload]).select();
      if (error) throw error;

      return res.status(200).json({ success: true, monthlyReturn: data[0] });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === "PATCH") {
    try {
      const body = req.body || {};
      const { year, monthNumber } = body;
      if (!year || !monthNumber) throw new Error("year and monthNumber are required for update");

      const updates = {};
      if (body.grossReturnPct !== undefined) updates.gross_return_pct = Number(body.grossReturnPct);
      if (body.source !== undefined) updates.source = body.source;
      if (body.notes !== undefined) updates.notes = body.notes;
      if (body.locked !== undefined) updates.locked = Boolean(body.locked);
      updates.last_updated = new Date().toISOString();

      const { data, error } = await supabase.from("monthly_returns").update(updates).eq("year", Number(year)).eq("month_number", Number(monthNumber)).select();
      if (error) throw error;

      return res.status(200).json({ success: true, monthlyReturn: data[0] });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  res.status(405).json({ error: "Method not allowed" });
}
