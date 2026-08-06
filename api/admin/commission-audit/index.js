import { verifyAdminSession } from "../../../lib/adminAuth.js";
import { supabase } from "../../../lib/supabase.js";
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
    const { sourceInvestorId, year: reqYear, month: reqMonth } = query;

    if (!sourceInvestorId) {
      return res.status(400).json({ error: "Missing required parameter: sourceInvestorId" });
    }

    const year = Number(reqYear || new Date().getFullYear());
    const monthNumber = Number(reqMonth || 7);
    const { monthStartStr, monthEndStr } = getMonthDateBounds(year, monthNumber);

    // 1. Fetch Source Investor Record
    const { data: sourceInv, error: invErr } = await supabase
      .from("investors")
      .select("*")
      .or(`id.ilike.${sourceInvestorId},portal_username.ilike.${sourceInvestorId},email.ilike.${sourceInvestorId}`)
      .maybeSingle();

    if (invErr || !sourceInv) {
      return res.status(404).json({ error: `Source investor not found for "${sourceInvestorId}"` });
    }

    const sourceIdSet = new Set([
      sourceInv.id,
      sourceInv.portal_username,
      sourceInv.email
    ].filter(Boolean).map(s => String(s).trim().toLowerCase()));

    const sourceName = [
      String(sourceInv.first_name || sourceInv.firstname || "").trim(),
      String(sourceInv.last_name || sourceInv.lastname || "").trim()
    ].filter(Boolean).join(" ") || String(sourceInv.portal_username || sourceInvestorId).trim();

    // 2. Fetch Source Investor Accounts & Monthly History
    const { data: accounts } = await supabase
      .from("investor_accounts")
      .select("*");

    const sourceAccounts = (accounts || []).filter(a =>
      sourceIdSet.has(String(a.investor_id || a.id || "").trim().toLowerCase())
    );

    const { data: allHistoryData } = await supabase
      .from("investor_monthly_history")
      .select("*")
      .eq("year", year);

    const sourceHistAllMonths = (allHistoryData || []).filter(h =>
      sourceIdSet.has(String(h.investor_id || h.investorid || "").trim().toLowerCase())
    );
    const sourceHist = sourceHistAllMonths.find(h => num(h.month_number) === monthNumber);

    let currentBalance = 0;
    if (sourceHistAllMonths.length > 0) {
      const sorted = [...sourceHistAllMonths].sort((a, b) => num(b.month_number) - num(a.month_number));
      currentBalance = num(sorted[0].ending_balance);
    }

    // 3. Fetch Monthly Return for Gross Return %
    const { data: monthlyReturns } = await supabase
      .from("monthly_returns")
      .select("*")
      .eq("year", year)
      .eq("month_number", monthNumber)
      .maybeSingle();

    const { data: allMonthlyReturns } = await supabase
      .from("monthly_returns")
      .select("*")
      .eq("year", year);

    const grossReturnPct = monthlyReturns
      ? num(monthlyReturns.gross_return_pct || monthlyReturns.gross_return || monthlyReturns.return)
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

    // 4. Source Investor Split & Pool
    const sourceSplitPct = num(sourceInv.split_pct || 75);
    const sourceKeptAmount = new Decimal(grossProfit).mul(sourceSplitPct).div(100).toNumber();
    const commissionPoolPct = 100 - sourceSplitPct;
    const grossPoolAmount = new Decimal(grossProfit).mul(commissionPoolPct).div(100).toNumber();

    // 5. Fetch All Investors, Shares & Earnings
    const { data: allInvestors } = await supabase.from("investors").select("*");
    const { data: allShares } = await supabase.from("commission_shares").select("*");
    const { data: earningsData } = await supabase.from("commission_earnings").select("*").eq("year", year);

    // 6. Build Recipient Breakdown Rows (Excluding Voided/Cancelled)
    let sourceEarningsThisMonth = (earningsData || []).filter(e =>
      sourceIdSet.has(String(e.source_investor_id || "").trim().toLowerCase()) &&
      num(e.month_number) === monthNumber &&
      e.status !== 'void' && e.status !== 'cancelled'
    );

    let recipientBreakdown = [];
    const creditMonthNumber = (monthNumber % 12) + 1;
    const creditYear = monthNumber === 12 ? year + 1 : year;

    if (sourceEarningsThisMonth.length > 0) {
      recipientBreakdown = sourceEarningsThisMonth.map(e => {
        const recId = String(e.recipient_id || e.recipient_investor_id || "").trim().toLowerCase();
        const recInv = (allInvestors || []).find(i =>
          String(i.id || "").toLowerCase() === recId ||
          String(i.portal_username || "").toLowerCase() === recId ||
          String(i.email || "").toLowerCase() === recId
        );

        const recName = recInv
          ? [String(recInv.first_name || "").trim(), String(recInv.last_name || "").trim()].filter(Boolean).join(" ") || recInv.portal_username
          : String(e.recipient_id || "Unknown");

        const amt = num(e.amount);
        const effectivePct = grossProfit > 0 ? (amt / grossProfit) * 100 : 0;
        const share = (allShares || []).find(s =>
          sourceIdSet.has(String(s.source_investor_id || "").toLowerCase()) &&
          (String(s.recipient_investor_id || "").toLowerCase() === recId ||
           (recInv && String(s.recipient_investor_id || "").toLowerCase() === String(recInv.id || "").toLowerCase()))
        );
        const commPctOfPool = share ? num(share.commission_percent) : (commissionPoolPct > 0 ? (amt / grossPoolAmount) * 100 : 0);

        return {
          recipientId: recInv ? recInv.id : e.recipient_id,
          recipientName: recName,
          recipientUsername: recInv ? recInv.portal_username : recId,
          commissionPctOfPool: commPctOfPool,
          effectivePctOfGrossProfit: effectivePct,
          amountReceived: amt,
          earnedMonth: `${MONTH_NAMES[monthNumber]} ${year}`,
          creditMonth: `${MONTH_NAMES[creditMonthNumber]} ${creditYear}`
        };
      });
    } else if (commissionPoolPct > 0) {
      // Dynamic Fallback: Reconcile from active commission_shares rules if static earnings rows haven't been committed yet
      const activeShares = (allShares || []).filter(s => {
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
      });

      recipientBreakdown = activeShares.map(s => {
        const recId = String(s.recipient_investor_id || "").trim().toLowerCase();
        const recInv = (allInvestors || []).find(i =>
          String(i.id || "").toLowerCase() === recId ||
          String(i.portal_username || "").toLowerCase() === recId ||
          String(i.email || "").toLowerCase() === recId
        );

        const recName = recInv
          ? [String(recInv.first_name || "").trim(), String(recInv.last_name || "").trim()].filter(Boolean).join(" ") || recInv.portal_username
          : String(s.recipient_investor_id || "Unknown");

        const commPctOfPool = num(s.commission_percent);
        const amt = new Decimal(grossPoolAmount).mul(commPctOfPool).div(100).toNumber();
        const effectivePct = grossProfit > 0 ? (amt / grossProfit) * 100 : 0;

        return {
          recipientId: recInv ? recInv.id : s.recipient_investor_id,
          recipientName: recName,
          recipientUsername: recInv ? recInv.portal_username : recId,
          commissionPctOfPool: commPctOfPool,
          effectivePctOfGrossProfit: effectivePct,
          amountReceived: amt,
          earnedMonth: `${MONTH_NAMES[monthNumber]} ${year}`,
          creditMonth: `${MONTH_NAMES[creditMonthNumber]} ${creditYear}`
        };
      });
    }

    // 7. Full Reconciliation Equation
    const totalRecipientAmount = recipientBreakdown.reduce((sum, r) => sum + r.amountReceived, 0);
    const unallocatedPoolAmount = Math.max(0, new Decimal(grossPoolAmount).sub(totalRecipientAmount).toNumber());
    const totalDistributedAmount = new Decimal(sourceKeptAmount).add(totalRecipientAmount).add(unallocatedPoolAmount).toNumber();
    const varianceAmount = new Decimal(grossProfit).sub(totalDistributedAmount).toNumber();

    const isPass = Math.abs(varianceAmount) <= 25.00;
    const status = isPass ? "PASS" : "FLAGGED";

    const sourceEffectivePct = grossProfit > 0 ? (sourceKeptAmount / grossProfit) * 100 : sourceSplitPct;
    const totalRecipientEffectivePct = grossProfit > 0 ? (totalRecipientAmount / grossProfit) * 100 : 0;
    const unallocatedEffectivePct = Math.max(0, 100 - (sourceEffectivePct + totalRecipientEffectivePct));

    // 8. Month Net & YTD Detail
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

      const mEarnings = (earningsData || []).filter(e =>
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

    const report = {
      auditTimestamp: new Date().toISOString(),
      sourceSummary: {
        sourceInvestorId: sourceInv.id,
        sourceUsername: sourceInv.portal_username,
        sourceName: sourceName,
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
        commissionPoolPct: commissionPoolPct,
        grossPoolAmount: grossPoolAmount,
        totalRecipientAmount: totalRecipientAmount,
        totalDistributedAmount: totalDistributedAmount,
        unallocatedPoolAmount: unallocatedPoolAmount,
        varianceAmount: varianceAmount,
        monthNet: monthNet,
        netYtd: netYtd.toNumber(),
        status: status,
        isPass: isPass
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

    // CSV format option
    if (query.format === "csv") {
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
        "Month Net", "Net YTD", "Variance", "Audit Status", "Recipient Name",
        "Recipient Username", "Share % of Pool", "Effective % of Gross", "Amount Received ($)",
        "Earned Month Period", "Credit Month Period"
      ];
      csvRows.push(headers.map(formatCell));

      const baseRow = [
        sourceName, sourceInv.portal_username, MONTH_NAMES[monthNumber], year,
        Number(startingBalance || 0).toFixed(2), Number(currentBalance || 0).toFixed(2),
        `${sourceSplitPct}%`, Number(deposits - withdrawals).toFixed(2),
        Number(adjustedStartingBalance || 0).toFixed(2), `${Number(grossReturnPct || 0).toFixed(2)}%`,
        Number(grossProfit || 0).toFixed(2), Number(sourceKeptAmount || 0).toFixed(2),
        Number(grossPoolAmount || 0).toFixed(2), Number(monthNet || 0).toFixed(2),
        Number(netYtd.toNumber() || 0).toFixed(2), Number(varianceAmount || 0).toFixed(2),
        status
      ];

      if (recipientBreakdown && recipientBreakdown.length > 0) {
        recipientBreakdown.forEach(b => {
          csvRows.push([
            ...baseRow, b.recipientName, b.recipientUsername,
            `${Number(b.commissionPctOfPool || 0).toFixed(1)}%`,
            `${Number(b.effectivePctOfGrossProfit || 0).toFixed(2)}%`,
            Number(b.amountReceived || 0).toFixed(2), b.earnedMonth, b.creditMonth
          ].map(formatCell));
        });
      } else {
        csvRows.push([
          ...baseRow, "N/A", "N/A", "0.0%", "0.00%", "0.00", `${MONTH_NAMES[monthNumber]} ${year}`, "-"
        ].map(formatCell));
      }

      const csvContent = "\uFEFF" + csvRows.map(row => row.join(",")).join("\r\n");
      const cleanUsername = String(sourceInv.portal_username || "account").replace(/[^a-z0-9_-]/gi, "_");
      const filename = `Audit_Report_${cleanUsername}_${year}_Month${monthNumber}.csv`;

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      return res.status(200).send(csvContent);
    }

    // TRUE EXCEL WORKBOOK EXPORT (.xlsx)
    if (query.format === "xlsx" || query.format === "excel") {
      const workbook = new ExcelJS.Workbook();
      workbook.creator = "Stone & Company Forex Fund";
      workbook.created = new Date();

      // Sheet 1: Audit Summary
      const s1 = workbook.addWorksheet("Audit Summary");
      s1.views = [{ showGridLines: true }];

      // Header Banner
      s1.mergeCells("A1:D1");
      const titleCell = s1.getCell("A1");
      titleCell.value = "STONE AND COMPANY FOREX FUND - AUDIT REPORT";
      titleCell.font = { name: "Arial", size: 14, bold: true, color: { argb: "FFFFFFFF" } };
      titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F172A" } };
      titleCell.alignment = { vertical: "middle", horizontal: "center" };
      s1.getRow(1).height = 36;

      s1.addRow(["Generated At", new Date(report.auditTimestamp).toLocaleString()]);
      s1.addRow([]);

      const sec1Header = s1.addRow(["ACCOUNT & RECONCILIATION SUMMARY"]);
      s1.getCell(`A${sec1Header.number}`).font = { bold: true, size: 11, color: { argb: "FF3B82F6" } };

      const summaryRows = [
        ["Account Holder", sourceName],
        ["Username / ID", sourceInv.portal_username],
        ["Earned Period", `${MONTH_NAMES[monthNumber]} ${year}`],
        ["Starting Balance", startingBalance],
        ["Current Balance", currentBalance],
        ["Investor Share %", sourceSplitPct / 100],
        ["Net Deposits / Draw", deposits - withdrawals],
        ["Adjusted Capital Base", adjustedStartingBalance],
        ["Gross Return %", grossReturnPct / 100],
        ["Gross Profit $", grossProfit],
        ["Source Investor Kept $", sourceKeptAmount],
        ["Commission Pool $", grossPoolAmount],
        ["Total Distributed to Recipients $", totalRecipientAmount],
        ["Unallocated Pool $", unallocatedPoolAmount],
        ["Total Reconciled Amount $", totalDistributedAmount],
        ["Month Net $", monthNet],
        ["Net YTD $", netYtd.toNumber()],
        ["Variance $", varianceAmount],
        ["Audit Status", status]
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

      s1.getColumn(1).width = 32;
      s1.getColumn(2).width = 28;

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

      if (recipientBreakdown && recipientBreakdown.length > 0) {
        recipientBreakdown.forEach(b => {
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
        s2.addRow(["No commission recipients for this period", "-", 0, 0, 0, `${MONTH_NAMES[monthNumber]} ${year}`, "-"]);
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

      monthlyYtdDetails.forEach(m => {
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
      const cleanUsername = String(sourceInv.portal_username || "account").replace(/[^a-z0-9_-]/gi, "_");
      const filename = `Audit_Report_${cleanUsername}_${year}_Month${monthNumber}.xlsx`;

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      return res.status(200).send(Buffer.from(buffer));
    }

    return res.status(200).json(report);
  } catch (err) {
    console.error("[Audit Report API]", err);
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
}
