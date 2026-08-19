import { verifyAdminSession } from "../../../../lib/adminAuth.js";
import { supabase } from "../../../../lib/supabase.js";
import { runFullHistoricalAudit } from "../../../../lib/historical-audit-engine.js";
import { loadAccountingData } from "../../../../lib/paginated-read.js";
import { generateFullHistoricalAuditExcel, generateFlaggedAccountsExcel } from "../../../../lib/historical-audit-excel.js";

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
    export: exportType = "",
    flagged = "false"
  } = req.query || req.body || {};

  try {
    // 2. Load all reference data using canonical paginated read
    const {
      investors, accounts, deposits, withdrawals,
      commissionShares, monthlyHistory, commissionEarnings, monthlyReturns
    } = await loadAccountingData();

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

    // 4. Return Excel file if format=excel or export=excel or export=flagged
    if (format === "excel" || exportType === "excel" || exportType === "flagged" || flagged === "true") {
      const investorFilter = req.query.investor || "ALL";
      const statusFilter = req.query.status || "ALL";
      const monthFilter = req.query.month || "ALL";
      const searchTerm = req.query.search || "";
      const isFlaggedOnly = flagged === "true" || exportType === "flagged";

      let buffer;
      let filename;

      if (isFlaggedOnly) {
        buffer = await generateFlaggedAccountsExcel(auditResult, {
          investorFilter,
          searchTerm
        });
        filename = "Stone_and_Company_Flagged_Accounts_Jan-Jul_2026.xlsx";
      } else {
        buffer = await generateFullHistoricalAuditExcel(auditResult, {
          investorFilter,
          statusFilter,
          monthFilter,
          searchTerm
        });

        filename = "Stone_and_Company_Accounting_Comparison_Jan-Jul_2026.xlsx";
        if (statusFilter === "FLAGGED") {
          filename = "Stone_and_Company_Audit_FLAGGED_Jan-Jul_2026.xlsx";
        } else if (investorFilter !== "ALL") {
          const cleanInvName = investorFilter.replace(/[^a-zA-Z0-9_]/g, "_");
          filename = `Stone_and_Company_Audit_${cleanInvName}_Jan-Jul_2026.xlsx`;
        }
      }

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
