import ExcelJS from "exceljs";

/**
 * Generates Excel Workbook (.xlsx) for Full Historical Audit Report
 * 
 * Sheets:
 * 1. Executive Summary
 * 2. Monthly Summary
 * 3. Investor Summary
 * 4. Investor-Month Detail
 * 5. Commission Reconciliation
 * 6. Data Quality Issues
 */
export async function generateFullHistoricalAuditExcel(auditResult) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "ForEx Investment Tracker Accounting Engine 2.0";
  wb.lastModifiedBy = "Admin System Audit";
  wb.created = new Date();

  const numFmt = "$#,##0.00;($#,##0.00);\"-\"";
  const pctFmt = "0.00%";

  // --------------------------------------------------
  // 1. EXECUTIVE SUMMARY SHEET
  // --------------------------------------------------
  const wsExec = wb.addWorksheet("Executive Summary");
  wsExec.columns = [
    { header: "Metric / Dimension", key: "metric", width: 40 },
    { header: "Value", key: "value", width: 30 },
    { header: "Status", key: "status", width: 25 }
  ];

  wsExec.addRow({ metric: "CERTIFICATION STATUS", value: auditResult.certificationBanner, status: auditResult.certified ? "CERTIFIED" : "REQUIRES REVIEW" });
  wsExec.addRow({ metric: "Audited Period Range", value: auditResult.summaryCards.periodAudited, status: "COMPLETED" });
  wsExec.addRow({ metric: "Total Investors Audited", value: auditResult.summaryCards.investorsAudited, status: "PASS" });
  wsExec.addRow({ metric: "Total Months Audited", value: auditResult.summaryCards.monthsAudited, status: "PASS" });
  wsExec.addRow({ metric: "Total Investor-Month Calculations", value: auditResult.summaryCards.investorMonthCalculations, status: "PASS" });
  wsExec.addRow({ metric: "Reconciled Accounts (Exact Match)", value: auditResult.summaryCards.reconciled, status: "PASS" });
  wsExec.addRow({ metric: "Cent Match Differences (<= $0.01)", value: auditResult.summaryCards.centMatch, status: "PASS" });
  wsExec.addRow({ metric: "Legacy Manual Differences", value: auditResult.summaryCards.legacyDifferences, status: "REVIEW_ITEM" });
  wsExec.addRow({ metric: "Rule Allocation Issues", value: auditResult.summaryCards.ruleIssues, status: auditResult.summaryCards.ruleIssues === 0 ? "PASS" : "WARN" });
  wsExec.addRow({ metric: "Ledger Comparison Issues", value: auditResult.summaryCards.ledgerIssues, status: auditResult.summaryCards.ledgerIssues === 0 ? "PASS" : "WARN" });
  wsExec.addRow({ metric: "Engine Calculation Bugs", value: auditResult.summaryCards.engineBugs, status: auditResult.summaryCards.engineBugs === 0 ? "PASS" : "FAIL" });
  wsExec.addRow({ metric: "Unknown Discrepancies", value: auditResult.summaryCards.unknownDiscrepancies, status: auditResult.summaryCards.unknownDiscrepancies === 0 ? "PASS" : "FAIL" });
  wsExec.addRow({ metric: "Privacy Violations", value: auditResult.summaryCards.privacyViolations, status: auditResult.summaryCards.privacyViolations === 0 ? "PASS" : "FAIL" });
  wsExec.addRow({ metric: "Data Quality Scan Issues", value: auditResult.summaryCards.dataQualityIssuesCount, status: auditResult.summaryCards.dataQualityIssuesCount === 0 ? "PASS" : "WARN" });

  // --------------------------------------------------
  // 2. MONTHLY SUMMARY SHEET
  // --------------------------------------------------
  const wsMonth = wb.addWorksheet("Monthly Summary");
  wsMonth.columns = [
    { header: "Year", key: "year", width: 10 },
    { header: "Month", key: "monthName", width: 15 },
    { header: "Gross Return %", key: "grossReturnPct", width: 15, style: { numFmt: pctFmt } },
    { header: "Return Source", key: "returnSource", width: 30 },
    { header: "Accounts Evaluated", key: "accountsEvaluated", width: 20 },
    { header: "Reconciled", key: "reconciledCount", width: 15 },
    { header: "Legacy Diff", key: "legacyDiffCount", width: 15 },
    { header: "Engine Bugs", key: "engineBugCount", width: 15 },
    { header: "Unknown", key: "unknownCount", width: 15 },
    { header: "Rule Issues", key: "ruleIssueCount", width: 15 }
  ];

  auditResult.monthlySummaries.forEach(m => {
    wsMonth.addRow({
      year: m.year,
      monthName: m.monthName,
      grossReturnPct: m.grossReturnPct / 100,
      returnSource: m.returnSource,
      accountsEvaluated: m.accountsEvaluated,
      reconciledCount: m.reconciledCount,
      legacyDiffCount: m.legacyDiffCount,
      engineBugCount: m.engineBugCount,
      unknownCount: m.unknownCount,
      ruleIssueCount: m.ruleIssueCount
    });
  });

  // --------------------------------------------------
  // 3. INVESTOR SUMMARY SHEET
  // --------------------------------------------------
  const wsInv = wb.addWorksheet("Investor Summary");
  wsInv.columns = [
    { header: "Investor Username", key: "username", width: 25 },
    { header: "Full Name", key: "fullName", width: 30 },
    { header: "Months Checked", key: "monthsChecked", width: 18 },
    { header: "Reconciled", key: "reconciled", width: 15 },
    { header: "Legacy Diff", key: "legacy", width: 15 },
    { header: "Warnings", key: "warnings", width: 15 },
    { header: "Blocking", key: "blocking", width: 15 },
    { header: "Overall Status", key: "overallStatus", width: 20 }
  ];

  auditResult.investorSummaries.forEach(inv => {
    wsInv.addRow(inv);
  });

  // --------------------------------------------------
  // 4. INVESTOR-MONTH DETAIL SHEET
  // --------------------------------------------------
  const wsDetail = wb.addWorksheet("Investor-Month Detail");
  wsDetail.columns = [
    { header: "Year", key: "year", width: 8 },
    { header: "Month", key: "month", width: 8 },
    { header: "Username", key: "username", width: 20 },
    { header: "Investor Name", key: "name", width: 25 },
    { header: "Opening Balance", key: "openingBalance", width: 18, style: { numFmt: numFmt } },
    { header: "Deposits", key: "deposits", width: 15, style: { numFmt: numFmt } },
    { header: "Withdrawals", key: "withdrawals", width: 15, style: { numFmt: numFmt } },
    { header: "Comm Credit", key: "commissionCredit", width: 15, style: { numFmt: numFmt } },
    { header: "Eligible Capital", key: "eligibleCapital", width: 18, style: { numFmt: numFmt } },
    { header: "Return %", key: "grossReturnPct", width: 12, style: { numFmt: pctFmt } },
    { header: "Source Split %", key: "sourceSplitPct", width: 15 },
    { header: "Gross Result", key: "grossResult", width: 18, style: { numFmt: numFmt } },
    { header: "Source Gain/Loss", key: "sourceGainLoss", width: 18, style: { numFmt: numFmt } },
    { header: "Recipient Comm", key: "recipientCommissions", width: 18, style: { numFmt: numFmt } },
    { header: "Calculated Ending", key: "calculatedEnding", width: 18, style: { numFmt: numFmt } },
    { header: "Stored Ending", key: "storedEnding", width: 18, style: { numFmt: numFmt } },
    { header: "Difference", key: "difference", width: 15, style: { numFmt: numFmt } },
    { header: "Classification", key: "classification", width: 22 },
    { header: "Audit Notes", key: "clientDescription", width: 45 }
  ];

  auditResult.investorMonthDetails.forEach(d => {
    wsDetail.addRow({
      year: d.year,
      month: d.month,
      username: d.username,
      name: d.name,
      openingBalance: d.openingBalance,
      deposits: d.deposits,
      withdrawals: d.withdrawals,
      commissionCredit: d.commissionCredit,
      eligibleCapital: d.eligibleCapital,
      grossReturnPct: d.grossReturnPct / 100,
      sourceSplitPct: `${d.sourceSplitPct}%`,
      grossResult: d.grossResult,
      sourceGainLoss: d.sourceGainLoss,
      recipientCommissions: d.recipientCommissions,
      calculatedEnding: d.calculatedEnding,
      storedEnding: d.storedEnding !== null ? d.storedEnding : "N/A",
      difference: d.difference,
      classification: d.classification,
      clientDescription: d.clientDescription
    });
  });

  // --------------------------------------------------
  // 5. DATA QUALITY ISSUES SHEET
  // --------------------------------------------------
  const wsDataQ = wb.addWorksheet("Data Quality Issues");
  wsDataQ.columns = [
    { header: "Issue Type", key: "type", width: 30 },
    { header: "Details", key: "detail", width: 60 }
  ];

  if (auditResult.dataQualityIssues.length === 0) {
    wsDataQ.addRow({ type: "NONE", detail: "Zero data quality issues detected." });
  } else {
    auditResult.dataQualityIssues.forEach(dq => {
      wsDataQ.addRow(dq);
    });
  }

  const buffer = await wb.xlsx.writeBuffer();
  return buffer;
}
