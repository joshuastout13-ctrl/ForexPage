import { verifyAdminSession } from "../../../lib/adminAuth.js";
import { supabase, paginatedRead } from "../../../lib/supabase.js";
import crypto from "node:crypto";

export default async function handler(req, res) {
  const session = verifyAdminSession(req);
  if (!session) return res.status(401).json({ error: "Unauthorized" });

  if (req.method === "GET") {
    try {
      const accounts = await paginatedRead("investor_accounts");
      accounts.sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));

      const { buildInvestorDashboard } = await import("../../../lib/dashboard.js");
      const { getMyfxbookLive } = await import("../../../lib/myfxbook.js");

      const [rawInvestors, returnsSheet, depositsSheet, withdrawalsSheet, historyTable, commissionEarningsTable, commissionSharesTable, cutovers, live] = await Promise.all([
        paginatedRead("investors"),
        paginatedRead("monthly_returns"),
        paginatedRead("deposits"),
        paginatedRead("withdrawals"),
        paginatedRead("investor_monthly_history"),
        paginatedRead("commission_earnings"),
        paginatedRead("commission_shares"),
        paginatedRead("account_cutover_adjustments"),
        getMyfxbookLive({ skipScraper: true }).catch((err) => {
          console.error("Failed to fetch live performance feed:", err);
          return null;
        })
      ]);

      const preloadedData = {
        rawInvestors: rawInvestors || [],
        accounts: accounts, // already fetched
        returnsSheet: returnsSheet || [],
        depositsSheet: depositsSheet || [],
        withdrawalsSheet: withdrawalsSheet || [],
        historyTable: historyTable || [],
        commissionEarningsTable: commissionEarningsTable || [],
        commissionSharesTable: commissionSharesTable || [],
        cutovers: cutovers || [],
        live
      };

      // Calculate balances using preloaded data (fail closed on any calculation error)
      for (let acc of accounts) {
        const dashboardRes = await buildInvestorDashboard(acc.investor_id, preloadedData);
        const currentBalance = dashboardRes?.summary?.currentBalance;
        if (typeof currentBalance !== "number" || !Number.isFinite(currentBalance)) {
          throw new Error(`Failed to compute finite current_balance for account "${acc.id}"`);
        }
        acc.current_balance = currentBalance;
      }

      return res.status(200).json({ accounts });
    } catch (err) {
      console.error("Failed to load admin accounts:", err);
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === "POST") {
    try {
      const body = req.body || {};
      
      const newId = body.id || `acc_${crypto.randomBytes(4).toString("hex")}`;
      const splitPct = Number(body.splitPct !== undefined ? body.splitPct : 100);
      const commissionRules = Array.isArray(body.commissionRules) ? body.commissionRules : [];
      if (commissionRules.length > 0) {
        return res.status(400).json({
          error: "LEGACY_COMMISSION_RULES_DEPRECATED: Manage commission shares via /api/admin/commission-shares instead of commissionRules.",
          code: "LEGACY_COMMISSION_RULES_DEPRECATED"
        });
      }

      let defaultOpenDate = body.openDate;
      if (!defaultOpenDate && body.investorId) {
        const { data: invRow } = await supabase
          .from("investors")
          .select("start_date")
          .eq("id", body.investorId)
          .maybeSingle();
        if (invRow?.start_date) {
          defaultOpenDate = invRow.start_date;
        }
      }

      const payload = {
        id: newId,
        investor_id: body.investorId,
        name: body.name || "Main Account",
        starting_capital: Number(body.startingCapital || 0),
        total_cash_in: Number(body.totalCashIn || 0),
        open_date: defaultOpenDate || new Date().toISOString().split('T')[0],
        status: body.status || "Active",
        is_commission: body.isCommission === true || body.isCommission === "true",
        split_pct: splitPct,
        notes: body.notes || ""
      };

      if (!payload.investor_id) throw new Error("Missing required field: investorId");

      const { data, error } = await supabase.from("investor_accounts").insert([payload]).select();
      if (error) throw error;

      return res.status(200).json({ success: true, account: data[0] });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  res.status(405).json({ error: "Method not allowed" });
}
