import { verifyAdminSession } from "../../../../../lib/adminAuth.js";
import { supabase } from "../../../../../lib/supabase.js";

/**
 * Return Freeze API Endpoint
 * POST /api/admin/accounting/return/freeze
 * 
 * Protects freezing of completed monthly performance return behind ACCOUNTING_RETURN_FREEZE_ENABLED feature flag.
 * Performs ZERO investor history or commission ledger writes.
 */
export default async function handler(req, res) {
  // 1. Verify Admin Session
  const auth = verifyAdminSession(req);
  if (!auth || !auth.adminId) {
    return res.status(401).json({ error: "Unauthorized", message: "Admin authentication required." });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // 2. Feature Flag Protection (Default: OFF)
  const freezeEnabled = process.env.ACCOUNTING_RETURN_FREEZE_ENABLED === "true";
  if (!freezeEnabled) {
    return res.status(503).json({
      error: "RETURN_FREEZE_DISABLED",
      message: "Return freeze functionality is locked by feature flag (ACCOUNTING_RETURN_FREEZE_ENABLED=false)."
    });
  }

  const {
    year,
    month,
    grossReturnPct,
    source = "MYFXBOOK_COMPLETED_MONTH",
    capturedAt = new Date().toISOString()
  } = req.body || {};

  if (!year || !month || grossReturnPct === undefined || grossReturnPct === null) {
    return res.status(400).json({ error: "Missing required parameters: year, month, grossReturnPct" });
  }

  const yr = Number(year);
  const m = Number(month);
  const returnVal = parseFloat(grossReturnPct);

  if (isNaN(returnVal)) {
    return res.status(400).json({ error: "Invalid grossReturnPct number" });
  }

  // 3. Strict Source Qualification — Only completed Myfxbook historical month percentage qualifies
  if (source !== "MYFXBOOK_COMPLETED_MONTH") {
    return res.status(422).json({
      error: "UNAPPROVED_RETURN_SOURCE",
      message: "Only completed Myfxbook historical month data (MYFXBOOK_COMPLETED_MONTH) qualifies for freeze. Live estimate cannot be frozen."
    });
  }

  try {
    // 4. Update monthly_returns table in Supabase
    const { data, error } = await supabase
      .from("monthly_returns")
      .upsert({
        year: yr,
        month_number: m,
        month: new Date(Date.UTC(yr, m - 1, 1)).toLocaleString("default", { month: "long" }),
        gross_return_pct: returnVal,
        source: "MYFXBOOK_COMPLETED_MONTH",
        status: "FINAL_RETURN_CAPTURED",
        locked: true,
        captured_at: capturedAt,
        notes: `Frozen by Admin session at ${new Date().toISOString()}`
      }, { onConflict: "year,month_number" })
      .select();

    if (error) {
      throw new Error(`Failed to freeze monthly return: ${error.message}`);
    }

    return res.status(200).json({
      success: true,
      message: `August ${yr} return of ${returnVal.toFixed(2)}% frozen successfully as FINAL_RETURN_CAPTURED.`,
      actionRequired: "Generate a NEW final accounting preview and inputHash prior to finalization.",
      frozenReturn: data[0]
    });
  } catch (err) {
    console.error("[Return Freeze Error]:", err.message);
    return res.status(500).json({ error: "Internal Server Error", message: err.message });
  }
}
