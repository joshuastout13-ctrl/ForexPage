import { verifyAdminSession } from "../../../lib/adminAuth.js";
import { supabase } from "../../../lib/supabase.js";
import { calculateCommissionAllocation } from "../../../lib/commission-engine.js";
import Decimal from "decimal.js";
import ExcelJS from "exceljs";

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

function num(val) {
  if (val === null || val === undefined) return 0;
  return new Decimal(val).toNumber();
}

const MONTH_NAMES = [
  "", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

function getMonthDateBounds(year, monthNumber) {
  const mStr = String(monthNumber).padStart(2, '0');
  const lastDay = new Date(year, monthNumber, 0).getDate();
  const lStr = String(lastDay).padStart(2, '0');
  return {
    monthStartStr: `${year}-${mStr}-01`,
    monthEndStr: `${year}-${mStr}-${lStr}`
  };
}

export default async function handler(req, res) {
  try {
    // Admin-only session verification
    const session = verifyAdminSession(req);
    if (!session) return res.status(401).json({ error: "Unauthorized" });

    if (req.method !== "GET" && req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const query = req.method === "POST" ? req.body : req.query;
    const { sourceInvestorId, year: reqYear, month: reqMonth, all } = query;

    const year = Number(reqYear || new Date().getFullYear());
    const monthNumber = Number(reqMonth || 7);
    const isRunAll = String(all || "").toLowerCase() === "true" || String(all || "") === "1";

    // Batch Fetch Common Tables to avoid N+1 queries
    const { data: allInvestors } = await supabase.from("investors").select("*");
    const { data: allAccounts } = await supabase.from("investor_accounts").select("*");
    const { data: allHistory } = await supabase.from("investor_monthly_history").select("*").eq("year", year);
    const { data: allMonthlyReturns } = await supabase.from("monthly_returns").select("*").eq("year", year);
    const { data: allShares } = await supabase.from("commission_shares").select("*");
    const { data: allEarnings } = await supabase.from("commission_earnings").select("*").eq("year", year);

    if (isRunAll) {
      return handleRunAllAudit({
        req, res, query, year, monthNumber,
        allInvestors, allAccounts, allHistory, allMonthlyReturns, allShares, allEarnings
      });
    }

    if (!sourceInvestorId) {
      return res.status(400).json({ error: "Missing required parameter: sourceInvestorId" });
    }

    const report = calculateSingleAudit({
      sourceInvestorId, year, monthNumber,
      allInvestors, allAccounts, allHistory, allMonthlyReturns, allShares, allEarnings
    });

    if (!report) {
      return res.status(404).json({ error: `Source investor not found for "${sourceInvestorId}"` });
    }

    // CSV export format option
    if (query.format === "csv") {
      return generateSingleCsvExport(res, report);
    }

    // Excel workbook format option (.xlsx)
    if (query.format === "xlsx" || query.format === "excel") {
      return generateSingleExcelWorkbook(res, report);
    }

    return res.status(200).json(report);
  } catch (err) {
    console.error("[Audit Report API]", err);
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
}

/**
 * Calculate single source account audit report using strict business rules
 */
export function calculateSingleAudit({
  sourceInvestorId, year, monthNumber,
  allInvestors, allAccounts, allHistory, allMonthlyReturns, allShares, allEarnings
}) {
  const { monthStartStr, monthEndStr } = getMonthDateBounds(year, monthNumber);

  // 1. Find Source Investor Record
  const searchId = String(sourceInvestorId || "").trim().toLowerCase();
  const sourceInv = (allInvestors || []).find(i =>
    String(i.id || "").toLowerCase() === searchId ||
    String(i.portal_username || "").toLowerCase() === searchId ||
    String(i.email || "").toLowerCase() === searchId
  );

  if (!sourceInv) return null;

  const sourceIdSet = new Set([
    sourceInv.id,
    sourceInv.portal_username,
    sourceInv.email
  ].filter(Boolean).map(s => String(s).trim().toLowerCase()));

  const sourceName = [
    String(sourceInv.first_name || sourceInv.firstname || "").trim(),
    String(sourceInv.last_name || sourceInv.lastname || "").trim()
  ].filter(Boolean).join(" ") || String(sourceInv.portal_username || sourceInvestorId).trim();

  // 2. Source Accounts & Monthly History
  const sourceAccounts = (allAccounts || []).filter(a =>
    sourceIdSet.has(String(a.investor_id || a.id || "").trim().toLowerCase())
  );

  const sourceHistAllMonths = (allHistory || []).filter(h =>
    sourceIdSet.has(String(h.investor_id || h.investorid || "").trim().toLowerCase())
  );
  const sourceHist = sourceHistAllMonths.find(h => num(h.month_number) === monthNumber);

  let currentBalance = 0;
  if (sourceHistAllMonths.length > 0) {
    const sorted = [...sourceHistAllMonths].sort((a, b) => num(b.month_number) - num(a.month_number));
    currentBalance = num(sorted[0].ending_balance);
  }

  // 3. Monthly Return for Gross Return %
  const monthlyReturnObj = (allMonthlyReturns || []).find(r => num(r.month_number) === monthNumber);
  const grossReturnPct = monthlyReturnObj
    ? num(monthlyReturnObj.gross_return_pct || monthlyReturnObj.gross_return || monthlyReturnObj.return)
    : (sourceHist ? num(sourceHist.gross_return_pct || sourceHist.return_pct) : 0);

  let startingBalance = sourceHist ? num(sourceHist.opening_balance || sourceHist.starting_balance) : 0;
  let deposits = sourceHist ? num(sourceHist.deposits || sourceHist.cash_in) : 0;
  let withdrawals = sourceHist ? num(sourceHist.withdrawals) : 0;
  let adjustedStartingBalance = (sourceHist && num(sourceHist.adjusted_opening_balance || sourceHist.adjusted_starting_balance) > 0)
    ? num(sourceHist.adjusted_opening_balance || sourceHist.adjusted_starting_balance)
    : (startingBalance + deposits - withdrawals);

  if (startingBalance === 0 && sourceAccounts.length > 0) {
    startingBalance = sourceAccounts.reduce((sum, a) => sum + num(a.starting_capital || a.capital), 0);
    adjustedStartingBalance = startingBalance + deposits - withdrawals;
  }

  if (currentBalance === 0) {
    currentBalance = adjustedStartingBalance;
  }

  let grossProfit = new Decimal(adjustedStartingBalance).mul(grossReturnPct).div(100).toNumber();
  if (sourceHist && num(sourceHist.gross_gain || sourceHist.manual_gain_amount) > 0) {
    grossProfit = num(sourceHist.gross_gain || sourceHist.manual_gain_amount);
  }

  // 4. Source Split & Active Shares
  const sourceSplitPct = sourceInv.split_pct !== null && sourceInv.split_pct !== undefined ? num(sourceInv.split_pct) : 75;

  // 5. Recipient Allocation Rows (Excluding Voided/Cancelled)
  const sourceEarningsThisMonth = (allEarnings || []).filter(e =>
    sourceIdSet.has(String(e.source_investor_id || "").trim().toLowerCase()) &&
    num(e.month_number) === monthNumber &&
    e.status !== 'void' && e.status !== 'cancelled'
  );

  let recipientDataSource = "ledger";
  const creditMonthNumber = (monthNumber % 12) + 1;
  const creditYear = monthNumber === 12 ? year + 1 : year;
  let activeShares = [];

  if (sourceEarningsThisMonth.length > 0) {
    activeShares = sourceEarningsThisMonth.map(e => {
      const recId = String(e.recipient_id || e.recipient_investor_id || "").trim().toLowerCase();
      const recInv = (allInvestors || []).find(i =>
        String(i.id || "").toLowerCase() === recId ||
        String(i.portal_username || "").toLowerCase() === recId ||
        String(i.email || "").toLowerCase() === recId
      );
      const recName = recInv
        ? [String(recInv.first_name || "").trim(), String(recInv.last_name || "").trim()].filter(Boolean).join(" ") || recInv.portal_username
        : String(e.recipient_id || "Unknown");

      const share = (allShares || []).find(s =>
        sourceIdSet.has(String(s.source_investor_id || "").toLowerCase()) &&
        (String(s.recipient_investor_id || "").toLowerCase() === recId ||
         (recInv && String(s.recipient_investor_id || "").toLowerCase() === String(recInv.id || "").toLowerCase()))
      );
      const commPct = share ? num(share.commission_percent) : (grossProfit > 0 ? (num(e.amount) / grossProfit) * 100 : 0);

      return {
        id: e.id,
        recipient_investor_id: recInv ? recInv.id : e.recipient_id,
        recipient_name: recName,
        recipient_username: recInv ? recInv.portal_username : recId,
        commission_percent: commPct
      };
    });
  } else {
    recipientDataSource = "calculated_from_rules";
    activeShares = (allShares || []).filter(s => {
      const isSrc = sourceIdSet.has(String(s.source_investor_id || "").trim().toLowerCase());
      if (!isSrc) return false;
      if (s.status === 'cancelled') return false;
      const pct = num(s.commission_percent);
      if (pct <= 0) return false;

      const start = s.effective_start_date ? String(s.effective_start_date).substring(0, 10) : '';
      const end = s.effective_end_date ? String(s.effective_end_date).substring(0, 10) : '';

      if (start && start > monthEndStr) return false;
      if (end && end < monthStartStr) return false;

      return true;
    }).map(s => {
      const recId = String(s.recipient_investor_id || "").trim().toLowerCase();
      const recInv = (allInvestors || []).find(i =>
        String(i.id || "").toLowerCase() === recId ||
        String(i.portal_username || "").toLowerCase() === recId ||
        String(i.email || "").toLowerCase() === recId
      );
      const recName = recInv
        ? [String(recInv.first_name || "").trim(), String(recInv.last_name || "").trim()].filter(Boolean).join(" ") || recInv.portal_username
        : String(s.recipient_investor_id || "Unknown");

      return {
        id: s.id,
        recipient_investor_id: recInv ? recInv.id : s.recipient_investor_id,
        recipient_name: recName,
        recipient_username: recInv ? recInv.portal_username : recId,
        commission_percent: num(s.commission_percent)
      };
    });
  }

  // 6. Invoke Centralized Commission Engine (Model B)
  //    The engine now handles PROFIT/ZERO/LOSS result types and applies
  //    authoritative client business rules for each.
  const engineResult = calculateCommissionAllocation({
    grossProfit,
    sourceSplitPct,
    commissionShares: activeShares
  });

  const resultType = engineResult.resultType; // "PROFIT" | "ZERO" | "LOSS"
  const sourceKeptAmount = engineResult.sourceAmount;
  const totalRecipientAmount = engineResult.totalRecipientAmount;
  const totalDistributedAmount = engineResult.totalDistributedAmount;
  const unallocatedPoolAmount = engineResult.unallocatedAmount;
  const varianceAmount = engineResult.varianceAmount;
  const roundingAdjustment = engineResult.roundingAdjustment || 0;
  const isPass = engineResult.isPass;
  const status = engineResult.status;
  const flagReason = engineResult.flagReason;

  // For LOSS and ZERO months, the commission pool concept doesn't apply.
  // Only compute pool metrics for PROFIT months.
  const commissionPoolPct = 100 - sourceSplitPct;
  let grossPoolAmount = 0;
  let commissionPoolAllocationPct = 100;
  if (resultType === "PROFIT") {
    grossPoolAmount = new Decimal(grossProfit).mul(commissionPoolPct).div(100).toNumber();
    commissionPoolAllocationPct = grossPoolAmount > 0 ? (totalRecipientAmount / grossPoolAmount) * 100 : 100;
  }
  const grossAllocationPct = engineResult.totalConfiguredPct;

  const recipientBreakdown = engineResult.recipientBreakdown.map(r => ({
    recipientId: r.recipientId,
    recipientName: r.recipientName,
    recipientUsername: r.recipientUsername,
    commissionPctOfPool: r.commissionPercent,
    effectivePctOfGrossProfit: r.effectivePctOfGrossProfit,
    amountReceived: r.amountReceived,
    earnedMonth: `${MONTH_NAMES[monthNumber]} ${year}`,
    creditMonth: `${MONTH_NAMES[creditMonthNumber]} ${creditYear}`
  }));

  // Effective percentage breakdown
  let sourceEffectivePct, totalRecipientEffectivePct, unallocatedEffectivePct;
  if (resultType === "PROFIT" && grossProfit > 0) {
    sourceEffectivePct = (sourceKeptAmount / grossProfit) * 100;
    totalRecipientEffectivePct = (totalRecipientAmount / grossProfit) * 100;
    unallocatedEffectivePct = Math.max(0, 100 - (sourceEffectivePct + totalRecipientEffectivePct));
  } else if (resultType === "LOSS") {
    sourceEffectivePct = sourceSplitPct;
    totalRecipientEffectivePct = 0;
    unallocatedEffectivePct = 0;
  } else {
    sourceEffectivePct = sourceSplitPct;
    totalRecipientEffectivePct = 0;
    unallocatedEffectivePct = 0;
  }

  // 7. Month Net & YTD Detail
  const monthNet = new Decimal(grossProfit).sub(totalRecipientAmount).toNumber();
  let netYtd = new Decimal(0);
  const monthlyYtdDetails = [];

  for (let m = 1; m <= monthNumber; m++) {
    const mReturn = (allMonthlyReturns || []).find(r => num(r.month_number) === m);
    const mHist = sourceHistAllMonths.find(h => num(h.month_number) === m);

    let mGrossReturnPct = mReturn ? num(mReturn.gross_return_pct || mReturn.gross_return) : 0;
    let mStartBal = mHist ? num(mHist.opening_balance || mHist.starting_balance) : 0;
    let mDeps = mHist ? num(mHist.deposits) : 0;
    let mWds = mHist ? num(mHist.withdrawals) : 0;
    let mAdjStart = mStartBal + mDeps - mWds;

    if (mStartBal === 0 && m === 1 && sourceAccounts.length > 0) {
      mStartBal = sourceAccounts.reduce((sum, a) => sum + num(a.starting_capital || a.capital), 0);
      mAdjStart = mStartBal + mDeps - mWds;
    }

    let mGrossProfit = new Decimal(mAdjStart).mul(mGrossReturnPct).div(100).toNumber();
    if (mHist && num(mHist.gross_gain || mHist.manual_gain_amount) > 0) {
      mGrossProfit = num(mHist.gross_gain || mHist.manual_gain_amount);
    }

    const mEarnings = (allEarnings || []).filter(e =>
      sourceIdSet.has(String(e.source_investor_id || "").trim().toLowerCase()) &&
      num(e.month_number) === m && e.status !== 'void' && e.status !== 'cancelled'
    );
    const mTotalCommissions = mEarnings.reduce((sum, e) => sum + num(e.amount), 0);
    const mMonthNet = new Decimal(mGrossProfit).sub(mTotalCommissions).toNumber();
    netYtd = netYtd.add(mMonthNet);

    monthlyYtdDetails.push({
      monthNumber: m,
      monthName: MONTH_NAMES[m],
      startingBalance: mStartBal,
      grossReturnPct: mGrossReturnPct,
      grossProfit: mGrossProfit,
      commissionsPaid: mTotalCommissions,
      monthNet: mMonthNet,
      cumulativeYtd: netYtd.toNumber()
    });
  }

  return {
    auditTimestamp: new Date().toISOString(),
    recipientDataSource: recipientDataSource,
    sourceSummary: {
      sourceInvestorId: sourceInv.id,
      sourceUsername: sourceInv.portal_username,
      sourceName: sourceName,
      resultType: resultType,
      year: year,
      monthNumber: monthNumber,
      monthName: MONTH_NAMES[monthNumber],
      startingBalance: startingBalance,
      currentBalance: currentBalance,
      deposits: deposits,
      withdrawals: withdrawals,
      adjustedStartingBalance: adjustedStartingBalance,
      grossReturnPct: grossReturnPct,
      grossProfit: grossProfit,
      sourceInvestorSplitPct: sourceSplitPct,
      sourceInvestorKeptAmount: sourceKeptAmount,
      sourceEffectiveReturnPct: engineResult.sourceEffectiveReturnPct || 0,
      commissionPoolPct: commissionPoolPct,
      grossPoolAmount: grossPoolAmount,
      totalRecipientAmount: totalRecipientAmount,
      totalDistributedAmount: totalDistributedAmount,
      unallocatedPoolAmount: unallocatedPoolAmount,
      varianceAmount: varianceAmount,
      roundingAdjustment: roundingAdjustment,
      commissionPoolAllocationPct: commissionPoolAllocationPct,
      grossAllocationPct: grossAllocationPct,
      monthNet: monthNet,
      netYtd: netYtd.toNumber(),
      status: status,
      isPass: isPass,
      flagReason: flagReason
    },
    reconciliation100Pct: {
      sourceEffectivePct: sourceEffectivePct,
      totalRecipientEffectivePct: totalRecipientEffectivePct,
      unallocatedEffectivePct: unallocatedEffectivePct,
      sumEffectivePct: sourceEffectivePct + totalRecipientEffectivePct + unallocatedEffectivePct
    },
    recipientBreakdown: recipientBreakdown,
    monthlyYtdDetails: monthlyYtdDetails
  };
}

/**
 * Handle Run All Audit mode for entire month across all source accounts
 */
async function handleRunAllAudit({
  req, res, query, year, monthNumber,
  allInvestors, allAccounts, allHistory, allMonthlyReturns, allShares, allEarnings
}) {
  const activeInvestors = (allInvestors || []).filter(i => i.active !== false);

  const auditedAccounts = [];
  let totalGrossProfit = 0;
  let totalCommissionPool = 0;
  let totalRecipients = 0;
  let totalUnallocated = 0;
  let passCount = 0;
  let flaggedCount = 0;

  for (const inv of activeInvestors) {
    const report = calculateSingleAudit({
      sourceInvestorId: inv.id,
      year, monthNumber,
      allInvestors, allAccounts, allHistory, allMonthlyReturns, allShares, allEarnings
    });

    if (!report) continue;
    const s = report.sourceSummary;

    // Skip accounts with zero capital and zero return
    if (s.adjustedStartingBalance === 0 && s.grossProfit === 0) continue;

    if (s.isPass) {
      passCount++;
    } else {
      flaggedCount++;
    }

    totalGrossProfit += s.grossProfit;
    totalCommissionPool += s.grossPoolAmount;
    totalRecipients += s.totalRecipientAmount;
    totalUnallocated += s.unallocatedPoolAmount;

    auditedAccounts.push(report);
  }

  // Sort FLAGGED rows first for visual priority
  auditedAccounts.sort((a, b) => {
    if (a.sourceSummary.isPass === b.sourceSummary.isPass) return 0;
    return a.sourceSummary.isPass ? 1 : -1;
  });

  const runAllResult = {
    auditTimestamp: new Date().toISOString(),
    year,
    monthNumber,
    monthName: MONTH_NAMES[monthNumber],
    summary: {
      accountsAudited: auditedAccounts.length,
      passCount,
      flaggedCount,
      totalGrossProfit,
      totalCommissionPool,
      totalRecipients,
      totalUnallocated
    },
    accounts: auditedAccounts
  };

  // Excel export for Run All
  if (query.format === "xlsx" || query.format === "excel") {
    return generateRunAllExcelWorkbook(res, runAllResult);
  }

  return res.status(200).json(runAllResult);
}

/**
 * Generate Single Account Excel Workbook
 */
async function generateSingleExcelWorkbook(res, report) {
  const s = report.sourceSummary;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Stone & Company Forex Fund";
  workbook.created = new Date();

  // Sheet 1: Audit Summary
  const s1 = workbook.addWorksheet("Audit Summary");
  s1.views = [{ showGridLines: true }];

  s1.mergeCells("A1:D1");
  const titleCell = s1.getCell("A1");
  titleCell.value = "STONE AND COMPANY FOREX FUND - AUDIT REPORT";
  titleCell.font = { name: "Arial", size: 14, bold: true, color: { argb: "FFFFFFFF" } };
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F172A" } };
  titleCell.alignment = { vertical: "middle", horizontal: "center" };
  s1.getRow(1).height = 36;

  s1.addRow(["Generated At", new Date(report.auditTimestamp).toLocaleString()]);
  s1.addRow(["Data Source", report.recipientDataSource === "ledger" ? "Committed Ledger Entries" : "Calculated from Active Rules"]);
  s1.addRow([]);

  const sec1Header = s1.addRow(["ACCOUNT & RECONCILIATION SUMMARY"]);
  s1.getCell(`A${sec1Header.number}`).font = { bold: true, size: 11, color: { argb: "FF3B82F6" } };

  const summaryRows = [
    ["Account Holder", s.sourceName],
    ["Username / ID", s.sourceUsername],
    ["Earned Period", `${s.monthName} ${s.year}`],
    ["Starting Balance", s.startingBalance],
    ["Current Balance", s.currentBalance],
    ["Investor Share %", s.sourceInvestorSplitPct / 100],
    ["Net Deposits / Draw", s.deposits - s.withdrawals],
    ["Adjusted Capital Base", s.adjustedStartingBalance],
    ["Gross Return %", s.grossReturnPct / 100],
    ["Gross Profit $", s.grossProfit],
    ["Source Investor Kept $", s.sourceInvestorKeptAmount],
    ["Commission Pool $", s.grossPoolAmount],
    ["Commission Pool Allocated %", s.commissionPoolAllocationPct / 100],
    ["Total Distributed to Recipients $", s.totalRecipientAmount],
    ["Unallocated Pool $", s.unallocatedPoolAmount],
    ["Overall Allocation %", s.grossAllocationPct / 100],
    ["Total Distributed (Source + Recip) $", s.totalDistributedAmount],
    ["Month Net $", s.monthNet],
    ["Net YTD $", s.netYtd],
    ["Variance $", s.varianceAmount],
    ["Audit Status", s.status],
    ["Audit Message", s.flagReason || "100% Commission Pool Allocated cleanly."]
  ];

  summaryRows.forEach(([label, val]) => {
    const row = s1.addRow([label, val]);
    row.getCell(1).font = { bold: true };
    if (typeof val === 'number') {
      if (label.includes('%')) {
        row.getCell(2).numFmt = "0.00%";
      } else {
        row.getCell(2).numFmt = '"$"#,##0.00';
      }
    }
    if (label === "Audit Status") {
      const cell = row.getCell(2);
      const isPassVal = val === "PASS";
      cell.font = { bold: true, color: { argb: isPassVal ? "FF15803D" : "FFB91C1C" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: isPassVal ? "FFDCFCE7" : "FFFEE2E2" } };
      cell.alignment = { horizontal: "center" };
    }
  });

  s1.getColumn(1).width = 34;
  s1.getColumn(2).width = 35;

  // Sheet 2: Recipient Breakdown
  const s2 = workbook.addWorksheet("Recipient Breakdown");
  s2.views = [{ state: "frozen", ySplit: 1, showGridLines: true }];

  const hRow2 = s2.addRow([
    "Recipient Name", "Username / ID", "Share % of Pool",
    "Effective % of Gross", "Amount Received ($)", "Earned Month", "Credit Month"
  ]);
  hRow2.height = 26;
  hRow2.eachCell(cell => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E293B" } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
  });

  if (report.recipientBreakdown && report.recipientBreakdown.length > 0) {
    report.recipientBreakdown.forEach(b => {
      const row = s2.addRow([
        b.recipientName,
        b.recipientUsername,
        b.commissionPctOfPool / 100,
        b.effectivePctOfGrossProfit / 100,
        b.amountReceived,
        b.earnedMonth,
        b.creditMonth
      ]);
      row.getCell(3).numFmt = "0.0%";
      row.getCell(4).numFmt = "0.00%";
      row.getCell(5).numFmt = '"$"#,##0.00';
    });
  } else {
    s2.addRow(["No commission recipients for this period", "-", 0, 0, 0, `${s.monthName} ${s.year}`, "-"]);
  }

  [26, 20, 18, 22, 20, 18, 18].forEach((w, colIdx) => {
    s2.getColumn(colIdx + 1).width = w;
  });

  // Sheet 3: Monthly YTD Detail
  const s3 = workbook.addWorksheet("Monthly YTD Detail");
  s3.views = [{ state: "frozen", ySplit: 1, showGridLines: true }];

  const hRow3 = s3.addRow([
    "Month", "Starting Capital ($)", "Gross Return %",
    "Gross Profit ($)", "Commissions Paid ($)", "Month Net ($)", "Cumulative YTD ($)"
  ]);
  hRow3.height = 26;
  hRow3.eachCell(cell => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F172A" } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
  });

  (report.monthlyYtdDetails || []).forEach(m => {
    const row = s3.addRow([
      m.monthName,
      m.startingBalance,
      m.grossReturnPct / 100,
      m.grossProfit,
      m.commissionsPaid,
      m.monthNet,
      m.cumulativeYtd
    ]);
    row.getCell(2).numFmt = '"$"#,##0.00';
    row.getCell(3).numFmt = "0.00%";
    row.getCell(4).numFmt = '"$"#,##0.00';
    row.getCell(5).numFmt = '"$"#,##0.00';
    row.getCell(6).numFmt = '"$"#,##0.00';
    row.getCell(7).numFmt = '"$"#,##0.00';
  });

  [18, 22, 18, 18, 22, 18, 20].forEach((w, colIdx) => {
    s3.getColumn(colIdx + 1).width = w;
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const cleanUsername = String(s.sourceUsername || "account").replace(/[^a-z0-9_-]/gi, "_");
  const filename = `Audit_Report_${cleanUsername}_${s.year}_Month${s.monthNumber}.xlsx`;

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  return res.status(200).send(Buffer.from(buffer));
}

/**
 * Generate Run All Excel Workbook
 */
async function generateRunAllExcelWorkbook(res, runAllResult) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Stone & Company Forex Fund";
  workbook.created = new Date();

  // Sheet 1: Audit Summary
  const s1 = workbook.addWorksheet("Audit Summary");
  s1.views = [{ showGridLines: true }];

  s1.mergeCells("A1:D1");
  const titleCell = s1.getCell("A1");
  titleCell.value = `ALL ACCOUNTS AUDIT SUMMARY — ${runAllResult.monthName.toUpperCase()} ${runAllResult.year}`;
  titleCell.font = { name: "Arial", size: 14, bold: true, color: { argb: "FFFFFFFF" } };
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F172A" } };
  titleCell.alignment = { vertical: "middle", horizontal: "center" };
  s1.getRow(1).height = 36;

  s1.addRow(["Generated At", new Date(runAllResult.auditTimestamp).toLocaleString()]);
  s1.addRow([]);

  const secHeader = s1.addRow(["CONSOLIDATED MONTHLY RECONCILIATION"]);
  s1.getCell(`A${secHeader.number}`).font = { bold: true, size: 11, color: { argb: "FF3B82F6" } };

  const summaryRows = [
    ["Accounts Audited", runAllResult.summary.accountsAudited],
    ["PASS Count", runAllResult.summary.passCount],
    ["FLAGGED Count", runAllResult.summary.flaggedCount],
    ["Total Gross Profit", runAllResult.summary.totalGrossProfit],
    ["Total Commission Pool", runAllResult.summary.totalCommissionPool],
    ["Total Recipient Allocations", runAllResult.summary.totalRecipients],
    ["Total Unallocated Pool", runAllResult.summary.totalUnallocated]
  ];

  summaryRows.forEach(([label, val]) => {
    const row = s1.addRow([label, val]);
    row.getCell(1).font = { bold: true };
    if (typeof val === 'number') {
      if (label.includes('Count') || label.includes('Audited')) {
        row.getCell(2).numFmt = '#,##0';
      } else {
        row.getCell(2).numFmt = '"$"#,##0.00';
      }
    }
    if (label === "FLAGGED Count" && val > 0) {
      row.getCell(2).font = { bold: true, color: { argb: "FFB91C1C" } };
    }
  });

  s1.getColumn(1).width = 30;
  s1.getColumn(2).width = 25;

  // Sheet 2: All Accounts Audit
  const s2 = workbook.addWorksheet("All Accounts Audit");
  s2.views = [{ state: "frozen", ySplit: 1, showGridLines: true }];

  const hRow2 = s2.addRow([
    "Account Holder", "Username / ID", "Gross Profit ($)", "Source Split %",
    "Source Kept ($)", "Commission Pool ($)", "Recipients ($)", "Pool Allocated %",
    "Unallocated Pool ($)", "Total Distributed ($)", "Variance ($)", "Status", "Audit Message"
  ]);
  hRow2.height = 26;
  hRow2.eachCell(cell => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E293B" } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
  });

  runAllResult.accounts.forEach(acc => {
    const s = acc.sourceSummary;
    const row = s2.addRow([
      s.sourceName,
      s.sourceUsername,
      s.grossProfit,
      s.sourceInvestorSplitPct / 100,
      s.sourceInvestorKeptAmount,
      s.grossPoolAmount,
      s.totalRecipientAmount,
      s.commissionPoolAllocationPct / 100,
      s.unallocatedPoolAmount,
      s.totalDistributedAmount,
      s.varianceAmount,
      s.status,
      s.flagReason || "Fully Allocated"
    ]);

    row.getCell(3).numFmt = '"$"#,##0.00';
    row.getCell(4).numFmt = "0.00%";
    row.getCell(5).numFmt = '"$"#,##0.00';
    row.getCell(6).numFmt = '"$"#,##0.00';
    row.getCell(7).numFmt = '"$"#,##0.00';
    row.getCell(8).numFmt = "0.00%";
    row.getCell(9).numFmt = '"$"#,##0.00';
    row.getCell(10).numFmt = '"$"#,##0.00';
    row.getCell(11).numFmt = '"$"#,##0.00';

    const statusCell = row.getCell(12);
    const isPass = s.isPass;
    statusCell.font = { bold: true, color: { argb: isPass ? "FF15803D" : "FFB91C1C" } };
    statusCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: isPass ? "FFDCFCE7" : "FFFEE2E2" } };
    statusCell.alignment = { horizontal: "center" };
  });

  [26, 18, 18, 16, 18, 20, 18, 18, 20, 20, 16, 14, 40].forEach((w, colIdx) => {
    s2.getColumn(colIdx + 1).width = w;
  });

  // Sheet 3: Recipient Breakdown across All Source Accounts
  const s3 = workbook.addWorksheet("Recipient Breakdown");
  s3.views = [{ state: "frozen", ySplit: 1, showGridLines: true }];

  const hRow3 = s3.addRow([
    "Source Account", "Source Username", "Recipient Name", "Recipient Username / ID",
    "Share % of Pool", "Effective % of Gross", "Amount Received ($)", "Earned Month", "Credit Month"
  ]);
  hRow3.height = 26;
  hRow3.eachCell(cell => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F172A" } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
  });

  runAllResult.accounts.forEach(acc => {
    const s = acc.sourceSummary;
    if (acc.recipientBreakdown && acc.recipientBreakdown.length > 0) {
      acc.recipientBreakdown.forEach(b => {
        const row = s3.addRow([
          s.sourceName,
          s.sourceUsername,
          b.recipientName,
          b.recipientUsername,
          b.commissionPctOfPool / 100,
          b.effectivePctOfGrossProfit / 100,
          b.amountReceived,
          b.earnedMonth,
          b.creditMonth
        ]);
        row.getCell(5).numFmt = "0.0%";
        row.getCell(6).numFmt = "0.00%";
        row.getCell(7).numFmt = '"$"#,##0.00';
      });
    }
  });

  [26, 18, 26, 22, 18, 22, 20, 18, 18].forEach((w, colIdx) => {
    s3.getColumn(colIdx + 1).width = w;
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const filename = `Run_All_Audit_Report_${runAllResult.year}_Month${runAllResult.monthNumber}.xlsx`;

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  return res.status(200).send(Buffer.from(buffer));
}

function generateSingleCsvExport(res, report) {
  const s = report.sourceSummary;
  const formatCell = (val) => {
    if (val === null || val === undefined) return '""';
    const str = String(val).replace(/"/g, '""');
    return `"${str}"`;
  };

  let csvRows = [];
  const headers = [
    "Account Holder", "Username / ID", "Earned Month", "Earned Year", "Starting Balance",
    "Current Balance", "Investor Share %", "Net Deposits/Draw", "Adjusted Capital Base",
    "Gross Return %", "Gross Profit", "Source Kept ($)", "Commission Pool ($)",
    "Commission Pool Allocated %", "Month Net", "Net YTD", "Variance", "Audit Status", "Audit Message",
    "Recipient Name", "Recipient Username", "Share % of Pool", "Effective % of Gross",
    "Amount Received ($)", "Earned Month Period", "Credit Month Period"
  ];
  csvRows.push(headers.map(formatCell));

  const baseRow = [
    s.sourceName, s.sourceUsername, s.monthName, s.year,
    Number(s.startingBalance || 0).toFixed(2), Number(s.currentBalance || 0).toFixed(2),
    `${s.sourceInvestorSplitPct}%`, Number(s.deposits - s.withdrawals).toFixed(2),
    Number(s.adjustedStartingBalance || 0).toFixed(2), `${Number(s.grossReturnPct || 0).toFixed(2)}%`,
    Number(s.grossProfit || 0).toFixed(2), Number(s.sourceInvestorKeptAmount || 0).toFixed(2),
    Number(s.grossPoolAmount || 0).toFixed(2), `${Number(s.commissionPoolAllocationPct || 0).toFixed(2)}%`,
    Number(s.monthNet || 0).toFixed(2), Number(s.netYtd || 0).toFixed(2),
    Number(s.varianceAmount || 0).toFixed(2), s.status, s.flagReason || "Fully Allocated"
  ];

  if (report.recipientBreakdown && report.recipientBreakdown.length > 0) {
    report.recipientBreakdown.forEach(b => {
      csvRows.push([
        ...baseRow, b.recipientName, b.recipientUsername,
        `${Number(b.commissionPctOfPool || 0).toFixed(1)}%`,
        `${Number(b.effectivePctOfGrossProfit || 0).toFixed(2)}%`,
        Number(b.amountReceived || 0).toFixed(2), b.earnedMonth, b.creditMonth
      ].map(formatCell));
    });
  } else {
    csvRows.push([
      ...baseRow, "N/A", "N/A", "0.0%", "0.00%", "0.00", `${s.monthName} ${s.year}`, "-"
    ].map(formatCell));
  }

  const csvContent = "\uFEFF" + csvRows.map(row => row.join(",")).join("\r\n");
  const cleanUsername = String(s.sourceUsername || "account").replace(/[^a-z0-9_-]/gi, "_");
  const filename = `Audit_Report_${cleanUsername}_${s.year}_Month${s.monthNumber}.csv`;

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  return res.status(200).send(csvContent);
}
