import { verifyAdminSession } from "../../../../lib/adminAuth.js";
import { supabase } from "../../../../lib/supabase.js";
import { calculateAccountingPeriod } from "../../../../lib/accounting-period-engine.js";
import { loadAccountingData } from "../../../../lib/paginated-read.js";
import { getFundAccountingDate } from "../../../../lib/month-state.js";

export default async function handler(req, res) {
  try {
    // 1. Enforce Admin Authentication
    const session = verifyAdminSession(req);
    if (!session) {
      return res.status(401).json({ error: "Unauthorized: Admin access required." });
    }

    if (req.method !== "GET" && req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const query = req.method === "POST" ? req.body : req.query;
    // Default year/month use authoritative fund accounting timezone (America/Los_Angeles)
    const asOfDate = query.asOfDate || null;
    const { year: fundYear, monthNumber: fundMonth } = getFundAccountingDate(asOfDate);
    const year = Number(query.year || fundYear);
    const month = Number(query.month || fundMonth);
    const fundReturnPctOverride = query.fundReturnPct !== undefined && query.fundReturnPct !== null
      ? Number(query.fundReturnPct)
      : null;

    if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
      return res.status(400).json({ error: "Invalid year or month parameter." });
    }

    // 2. Batch load all reference data using canonical paginated read
    //    (investor_monthly_history and commission_earnings exceed 1,000 rows)
    const {
      investors, accounts, deposits, withdrawals,
      commissionShares, monthlyHistory, commissionEarnings, monthlyReturns
    } = await loadAccountingData();

    // 3. Perform In-Memory Accounting Period Calculation (Pure Preview - ZERO DB WRITES)
    const previewResult = calculateAccountingPeriod({
      year,
      month,
      fundReturnPct: fundReturnPctOverride,
      investors: investors || [],
      accounts: accounts || [],
      deposits: deposits || [],
      withdrawals: withdrawals || [],
      commissionShares: commissionShares || [],
      monthlyHistory: monthlyHistory || [],
      commissionEarnings: commissionEarnings || [],
      monthlyReturns: monthlyReturns || []
    });

    return res.status(200).json(previewResult);
  } catch (err) {
    console.error("[Accounting Preview API] Unhandled error:", err);
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
}
