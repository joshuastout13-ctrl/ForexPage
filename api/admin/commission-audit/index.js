import { verifyAdminSession } from "../../../lib/adminAuth.js";
import { supabase } from "../../../lib/supabase.js";
import Decimal from "decimal.js";
Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

function num(val) {
  if (val === null || val === undefined) return 0;
  return new Decimal(val).toNumber();
}

const MONTH_NAMES = [
  "", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

export default async function handler(req, res) {
  try {
    // Admin-only — no bypass auth
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

    // 2. Fetch Source Investor Accounts & Monthly History (all months for YTD)
    const { data: accounts } = await supabase
      .from("investor_accounts")
      .select("*");

    const sourceAccounts = (accounts || []).filter(a =>
      sourceIdSet.has(String(a.investor_id || a.id || "").trim().toLowerCase())
    );

    // Fetch all history rows for this year (needed for YTD)
    const { data: allHistoryData } = await supabase
      .from("investor_monthly_history")
      .select("*")
      .eq("year", year);

    // Get the history row for the requested month
    const sourceHistAllMonths = (allHistoryData || []).filter(h =>
      sourceIdSet.has(String(h.investor_id || h.investorid || "").trim().toLowerCase())
    );
    const sourceHist = sourceHistAllMonths.find(h => num(h.month_number) === monthNumber);

    // Current balance: latest ending_balance from history
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

    // Fetch ALL monthly returns for the year (for YTD calculation)
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

    // 5. Fetch Commission Ledger Rows generated by this Source
    const { data: earningsData } = await supabase
      .from("commission_earnings")
      .select("*")
      .eq("year", year);

    const sourceEarningsThisMonth = (earningsData || []).filter(e =>
      sourceIdSet.has(String(e.source_investor_id || "").trim().toLowerCase()) &&
      num(e.month_number) === monthNumber
    );

    // 6. Fetch All Investors & Shares for metadata
    const { data: allInvestors } = await supabase
      .from("investors")
      .select("*");

    const { data: allShares } = await supabase
      .from("commission_shares")
      .select("*");

    // 7. Build Recipient Breakdown Rows
    const creditMonthNumber = (monthNumber % 12) + 1;
    const creditYear = monthNumber === 12 ? year + 1 : year;

    const recipientBreakdown = sourceEarningsThisMonth.map(e => {
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

      // Find matching rule for commission_percent of pool
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

    // 8. Reconciliation & Totals
    const totalRecipientAmount = recipientBreakdown.reduce((sum, r) => sum + r.amountReceived, 0);
    const totalDistributedAmount = new Decimal(sourceKeptAmount).add(totalRecipientAmount).toNumber();
    const unallocatedPoolAmount = Math.max(0, new Decimal(grossPoolAmount).sub(totalRecipientAmount).toNumber());
    const varianceAmount = new Decimal(grossProfit).sub(totalDistributedAmount).toNumber();

    const isPass = Math.abs(varianceAmount) <= 25.00;
    const status = isPass ? "PASS" : "FLAGGED";

    const sourceEffectivePct = grossProfit > 0 ? (sourceKeptAmount / grossProfit) * 100 : sourceSplitPct;
    const totalRecipientEffectivePct = grossProfit > 0 ? (totalRecipientAmount / grossProfit) * 100 : 0;
    const unallocatedEffectivePct = Math.max(0, 100 - (sourceEffectivePct + totalRecipientEffectivePct));

    // 9. Month Net & Net YTD
    const monthNet = new Decimal(grossProfit).sub(totalRecipientAmount).toNumber();

    // Calculate Net YTD: sum of (grossProfit - totalCommissions) for each month 1..monthNumber
    let netYtd = new Decimal(0);
    for (let m = 1; m <= monthNumber; m++) {
      // Get gross return for this month
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

      // Commission payouts for this month
      const mEarnings = (earningsData || []).filter(e =>
        sourceIdSet.has(String(e.source_investor_id || "").trim().toLowerCase()) &&
        num(e.month_number) === m
      );
      const mTotalCommissions = mEarnings.reduce((sum, e) => sum + num(e.amount), 0);

      netYtd = netYtd.add(new Decimal(mGrossProfit).sub(mTotalCommissions));
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
      recipientBreakdown: recipientBreakdown
    };

    return res.status(200).json(report);
  } catch (err) {
    console.error("[Audit Report API]", err);
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
}
