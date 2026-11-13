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
      
      const rules = await paginatedRead("commission_rules", {
        queryModifier: q => q.not("account_id", "is", null)
      }).catch(() => []);
      if (rules) {
        accounts.forEach(acc => {
          acc.commissionRules = rules.filter(r => r.account_id === acc.id);
        });
      }

      try {
        const { buildInvestorDashboard } = await import("../../../lib/dashboard.js");
        const { getMyfxbookLive } = await import("../../../lib/myfxbook.js");
        
        const [rawInvestors, returnsSheet, depositsSheet, withdrawalsSheet, historyTable, commissionEarningsTable, commissionSharesTable, commissionRulesTable, cutovers, live] = await Promise.all([
          paginatedRead("investors"),
          paginatedRead("monthly_returns"),
          paginatedRead("deposits"),
          paginatedRead("withdrawals"),
          paginatedRead("investor_monthly_history"),
          paginatedRead("commission_earnings"),
          paginatedRead("commission_shares"),
          paginatedRead("commission_rules").catch(() => []),
          paginatedRead("account_cutover_adjustments").catch(() => []),
          getMyfxbookLive({ skipScraper: true })
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
          commissionRulesTable: commissionRulesTable || [],
          cutovers: cutovers || [],
          live
        };

        // Calculate balances using preloaded data
        for (let acc of accounts) {
          try {
            const res = await buildInvestorDashboard(acc.investor_id, preloadedData);
            acc.current_balance = res.summary.currentBalance;
          } catch(e) {
            acc.current_balance = acc.starting_capital;
          }
        }
      } catch (err) {
        console.error("Failed to calculate account balances:", err);
      }

      return res.status(200).json({ accounts });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === "POST") {
    try {
      const body = req.body || {};
      
      const newId = body.id || `acc_${crypto.randomBytes(4).toString("hex")}`;
      const splitPct = Number(body.splitPct !== undefined ? body.splitPct : 100);
      const commissionRules = Array.isArray(body.commissionRules) ? body.commissionRules : [];

      const payload = {
        id: newId,
        investor_id: body.investorId,
        name: body.name || "Main Account",
        starting_capital: Number(body.startingCapital || 0),
        total_cash_in: Number(body.totalCashIn || 0),
        open_date: body.openDate || new Date().toISOString().split('T')[0],
        status: body.status || "Active",
        is_commission: body.isCommission === true || body.isCommission === "true",
        split_pct: splitPct,
        notes: body.notes || ""
      };

      if (!payload.investor_id) throw new Error("Missing required field: investorId");

      const { data, error } = await supabase.from("investor_accounts").insert([payload]).select();
      if (error) throw error;

      // Save commission rules
      if (commissionRules.length > 0) {
        const rulesPayload = commissionRules.map(rule => ({
          investor_id: body.investorId,
          account_id: newId,
          recipient_id: rule.recipientId,
          percent: Number(rule.percent)
        }));
        await supabase.from("commission_rules").insert(rulesPayload);
      }

      return res.status(200).json({ success: true, account: data[0] });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  res.status(405).json({ error: "Method not allowed" });
}
