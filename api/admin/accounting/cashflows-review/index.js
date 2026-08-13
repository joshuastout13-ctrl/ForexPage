import { verifyAdminSession } from "../../../../lib/adminAuth.js";
import { supabase } from "../../../../lib/supabase.js";

/**
 * READ-ONLY Admin Endpoint for Cashflows Review & Effective Accounting Date Inspection.
 * Lists current August deposits and withdrawals with proposed effective accounting dates.
 * Performs ZERO financial writes.
 */
export default async function handler(req, res) {
  const auth = verifyAdminSession(req);
  if (!auth) {
    return res.status(401).json({ error: "Unauthorized", message: "Admin authentication required." });
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const year = Number(req.query?.year || 2026);
    const month = Number(req.query?.month || 8);
    const prefix = `${year}-${String(month).padStart(2, '0')}`;

    // Parallel fetch deposits, withdrawals, and investors
    const [
      { data: deposits },
      { data: withdrawals },
      { data: investors }
    ] = await Promise.all([
      supabase.from("deposits").select("*").not("type", "ilike", "VOID"),
      supabase.from("withdrawals").select("*").in("status", ["Approved", "Completed", "pending"]),
      supabase.from("investors").select("*")
    ]);

    const investorMap = {};
    (investors || []).forEach(i => {
      investorMap[i.id] = `${i.first_name || ''} ${i.last_name || ''}`.trim() || i.portal_username || i.id;
      if (i.portal_username) investorMap[i.portal_username] = investorMap[i.id];
    });

    // Proposed default effective date for the target accounting month (Day 1)
    const proposedEffectiveDate = `${prefix}-01`;

    // Filter August deposits
    const periodDeposits = (deposits || []).filter(d => {
      const dateStr = String(d.date || d.created_at || '');
      return dateStr.startsWith(prefix);
    }).map(d => ({
      id: d.id,
      cashflowType: "DEPOSIT",
      investorId: d.investor_id,
      investorName: investorMap[d.investor_id] || d.investor_id,
      amount: Number(d.amount || 0),
      entryRecordedDate: d.date || d.created_at,
      currentEffectiveAccountingDate: d.effective_accounting_date || null,
      proposedEffectiveAccountingDate: d.effective_accounting_date || proposedEffectiveDate,
      isFirstDay: d.effective_accounting_date ? d.effective_accounting_date.endsWith("-01") : new Date(d.date).getUTCDate() === 1,
      reviewStatus: d.effective_accounting_date ? "CONFIRMED" : "PROPOSED_UNAPPLIED"
    }));

    // Filter August withdrawals
    const periodWithdrawals = (withdrawals || []).filter(w => {
      const ws = String(w.request_date || w.date || w.created_at || '');
      const yr = w.year || (ws ? new Date(ws).getUTCFullYear() : null);
      const m = w.month_number || (ws ? new Date(ws).getUTCMonth() + 1 : null);
      return (yr === year && m === month) || ws.startsWith(prefix);
    }).map(w => ({
      id: w.id,
      cashflowType: "WITHDRAWAL",
      investorId: w.investor_id,
      investorName: investorMap[w.investor_id] || w.investor_id,
      amount: Number(w.amount || 0),
      entryRecordedDate: w.request_date || w.date || w.created_at,
      currentEffectiveAccountingDate: w.effective_accounting_date || null,
      proposedEffectiveAccountingDate: w.effective_accounting_date || proposedEffectiveDate,
      isFirstDay: w.effective_accounting_date ? w.effective_accounting_date.endsWith("-01") : new Date(w.request_date || w.date).getUTCDate() === 1,
      reviewStatus: w.effective_accounting_date ? "CONFIRMED" : "PROPOSED_UNAPPLIED"
    }));

    const totalDepositAmount = periodDeposits.reduce((s, d) => s + d.amount, 0);
    const totalWithdrawalAmount = periodWithdrawals.reduce((s, w) => s + w.amount, 0);

    return res.status(200).json({
      status: "SUCCESS_READ_ONLY",
      period: prefix,
      defaultProposedEffectiveDate: proposedEffectiveDate,
      summary: {
        totalDepositsCount: periodDeposits.length,
        totalDepositAmount: Number(totalDepositAmount.toFixed(2)),
        totalWithdrawalsCount: periodWithdrawals.length,
        totalWithdrawalAmount: Number(totalWithdrawalAmount.toFixed(2)),
        allProposedDatesAreDay1: periodDeposits.every(d => d.proposedEffectiveAccountingDate.endsWith("-01")) && periodWithdrawals.every(w => w.proposedEffectiveAccountingDate.endsWith("-01"))
      },
      deposits: periodDeposits,
      withdrawals: periodWithdrawals,
      note: "Proposed effective dates require admin review before writing to production columns."
    });

  } catch (err) {
    console.error("[CashflowsReview] Error listing cashflows review:", err);
    return res.status(500).json({ error: "CASHFLOWS_REVIEW_FAILED", message: err.message });
  }
}
