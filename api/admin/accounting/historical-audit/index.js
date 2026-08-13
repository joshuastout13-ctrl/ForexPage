import { verifyAdminSession } from "../../../../lib/adminAuth.js";
import { supabase } from "../../../../lib/supabase.js";
import { runFullHistoricalAudit } from "../../../../lib/historical-audit-engine.js";
import { generateFullHistoricalAuditExcel } from "../../../../lib/historical-audit-excel.js";

/**
 * FULL HISTORICAL SYSTEM AUDIT API ENDPOINT
 * GET /api/admin/accounting/historical-audit
 * 
 * 100% READ ONLY. Performs zero database writes.
 */
export default async function handler(req, res) {
  // 1. Verify Admin Session
  const auth = verifyAdminSession(req);
  if (!auth || !auth.adminId) {
    return res.status(401).json({ error: "Unauthorized", message: "Admin authentication required." });
  }

  const {
    startYear = 2026,
    startMonth = 1,
    endYear = 2026,
    endMonth = 7,
    format = "json",
    export: exportType = ""
  } = req.query || req.body || {};

  try {
    // 2. Batch read all production data in memory (READ ONLY)
    const [
      { data: investors, error: errInv },
      { data: accounts, error: errAcc },
      { data: deposits, error: errDep },
      { data: withdrawals, error: errWd },
      { data: commissionShares, error: errShares },
      { data: monthlyHistory, error: errHist },
      { data: commissionEarnings, error: errEarn },
      { data: monthlyReturns, error: errRet }
    ] = await Promise.all([
      supabase.from("investors").select("*"),
      supabase.from("investor_accounts").select("*"),
      supabase.from("deposits").select("*").not("type", "ilike", "VOID"),
      supabase.from("withdrawals").select("*").in("status", ["Approved", "Completed", "pending"]),
      supabase.from("commission_shares").select("*"),
      supabase.from("investor_monthly_history").select("*"),
      supabase.from("commission_earnings").select("*"),
      supabase.from("monthly_returns").select("*")
    ]);

    if (errInv || errAcc || errDep || errWd || errShares || errHist || errEarn || errRet) {
      const err = errInv || errAcc || errDep || errWd || errShares || errHist || errEarn || errRet;
      throw new Error(`Database batch fetch error: ${err.message}`);
    }

    // 3. Execute Full Historical Audit in Memory
    const auditResult = runFullHistoricalAudit({
      startYear: Number(startYear),
      startMonth: Number(startMonth),
      endYear: Number(endYear),
      endMonth: Number(endMonth),
      investors: investors || [],
      accounts: accounts || [],
      deposits: deposits || [],
      withdrawals: withdrawals || [],
      commissionShares: commissionShares || [],
      monthlyHistory: monthlyHistory || [],
      commissionEarnings: commissionEarnings || [],
      monthlyReturns: monthlyReturns || []
    });

    // 4. Return Excel file if format=excel or export=excel
    if (format === "excel" || exportType === "excel") {
      const buffer = await generateFullHistoricalAuditExcel(auditResult);
      const filename = `Full_Historical_Accounting_Audit_${startYear}_M${startMonth}_to_${endYear}_M${endMonth}.xlsx`;
      
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      return res.send(buffer);
    }

    // 5. Default JSON Response
    return res.status(200).json({
      success: true,
      readOnlyBadge: "READ ONLY AUDIT — NO FINANCIAL RECORDS ARE MODIFIED",
      auditResult
    });

  } catch (err) {
    console.error("[Full Historical Audit API Error]:", err.message);
    return res.status(500).json({ error: "Internal Server Error", message: err.message });
  }
}
