import { verifyAdminSession } from "../../../../lib/adminAuth.js";
import { supabase } from "../../../../lib/supabase.js";
import { calculateAccountingPeriod } from "../../../../lib/accounting-period-engine.js";

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
    const year = Number(query.year || new Date().getFullYear());
    const month = Number(query.month || new Date().getMonth() + 1);
    const fundReturnPctOverride = query.fundReturnPct !== undefined && query.fundReturnPct !== null
      ? Number(query.fundReturnPct)
      : null;

    if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
      return res.status(400).json({ error: "Invalid year or month parameter." });
    }

    // 2. Batch load all reference data from Supabase in parallel (Zero N+1 queries)
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
      const dbErr = errInv || errAcc || errDep || errWd || errShares || errHist || errEarn || errRet;
      console.error("[Accounting Preview API] Database error:", dbErr);
      return res.status(500).json({ error: `Database fetch failed: ${dbErr.message}` });
    }

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
