import { verifyAdminSession } from "../../../../lib/adminAuth.js";
import { supabase } from "../../../../lib/supabase.js";
import { calculateAccountingPeriod } from "../../../../lib/accounting-period-engine.js";
import { loadAccountingData } from "../../../../lib/paginated-read.js";
import { getMyfxbookLive } from "../../../../lib/myfxbook.js";

export const ACCOUNTING_ENGINE_VERSION = "2.0.0";

/**
 * READ-ONLY Admin Endpoint for Daily Shadow Health Monitoring.
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

    // Fetch live Myfxbook return estimate
    let myfxbookLive = null;
    let fundReturnPct = 2.81;
    let capturedAt = new Date().toISOString();
    let returnSource = "MYFXBOOK_LIVE";

    try {
      myfxbookLive = await getMyfxbookLive();
      if (myfxbookLive?.month) {
        fundReturnPct = Number(myfxbookLive.month);
      }
    } catch (e) {
      console.warn("[ShadowHealth] Could not fetch live Myfxbook feed, using latest DB return:", e.message);
    }

    // Parallel fetch current accounting tables using canonical paginated reads
    const {
      investors, accounts, deposits, withdrawals,
      commissionShares, monthlyHistory: monthlyHistory, commissionEarnings, monthlyReturns
    } = await loadAccountingData();

    // Check if a frozen return exists in monthly_returns for this period
    const periodReturnRow = (monthlyReturns || []).find(
      r => r.year === year && r.month_number === month
    );
    if (periodReturnRow) {
      fundReturnPct = Number(periodReturnRow.gross_return_pct || fundReturnPct);
      returnSource = periodReturnRow.source || returnSource;
      capturedAt = periodReturnRow.last_updated || periodReturnRow.created_at || capturedAt;
    }

    // Run central accounting engine preview
    const periodRun = calculateAccountingPeriod({
      year,
      month,
      fundReturnPct,
      returnSource,
      returnStatus: periodReturnRow?.locked ? "FROZEN" : "OPEN",
      capturedAt,
      investors: investors || [],
      accounts: accounts || [],
      deposits: deposits || [],
      withdrawals: withdrawals || [],
      commissionShares: commissionShares || [],
      monthlyHistory: monthlyHistory || [],
      commissionEarnings: commissionEarnings || [],
      monthlyReturns: monthlyReturns || []
    });

    // Reference accounts detailed breakdown
    const refUsernames = [
      { key: "bbeck", id: "inv_3dc85bea", name: "Brandon Beck" },
      { key: "aray", id: "inv_0d036796", name: "Ashlee Ray" },
      { key: "gmaddocks", id: "inv_5a509c6a", name: "Glenn Maddocks" },
      { key: "jstout", id: "stout001", name: "Joshua Stout" }
    ];

    const referenceAccounts = refUsernames.map(ref => {
      const inv = periodRun.investors.find(
        i => i.investorId === ref.id || i.username.toLowerCase() === ref.key
      );
      return {
        key: ref.key,
        id: ref.id,
        name: inv ? inv.name : ref.name,
        priorEndingBalance: inv ? inv.priorEndingBalance : 0,
        deposits: inv ? inv.deposits : 0,
        withdrawals: inv ? inv.withdrawals : 0,
        incomingCommissionCredit: inv ? inv.incomingCommissionCredit : 0,
        eligibleCapital: inv ? inv.eligibleCapital : 0,
        currentReturnPct: fundReturnPct,
        sourceGainLoss: inv ? inv.sourceGainLoss : 0,
        recipientCommissions: inv ? inv.totalRecipientCommissions : 0,
        proposedEndingBalance: inv ? inv.endingBalance : 0,
        status: inv ? inv.status : "NOT_FOUND"
      };
    });

    // Rule integrity audit for positive months
    const activeRules = (commissionShares || []).filter(s => s.status !== "cancelled" && s.status !== "void");
    const ruleAnomalies = [];
    
    // Group rules by source
    const rulesBySource = {};
    activeRules.forEach(r => {
      const src = r.source_investor_id || r.source_id;
      if (!rulesBySource[src]) rulesBySource[src] = [];
      rulesBySource[src].push(r);
    });

    Object.keys(rulesBySource).forEach(src => {
      const srcRules = rulesBySource[src];
      const totalPct = srcRules.reduce((sum, r) => sum + Number(r.commission_percent || 0), 0);
      const srcInvestor = (investors || []).find(i => i.id === src || i.portal_username === src);
      const srcSplit = Number(srcInvestor?.split_pct || 70);
      const expectedPool = 100 - srcSplit;

      if (Math.abs(totalPct - expectedPool) > 0.01) {
        ruleAnomalies.push({
          sourceInvestorId: src,
          sourceName: srcInvestor ? `${srcInvestor.first_name} ${srcInvestor.last_name}` : src,
          sourceSplitPct: srcSplit,
          expectedPoolPct: expectedPool,
          actualRulesTotalPct: totalPct,
          anomaly: totalPct > expectedPool ? "OVER_ALLOCATED" : "UNDER_ALLOCATED"
        });
      }
    });

    return res.status(200).json({
      status: "SUCCESS_READ_ONLY",
      engineVersion: ACCOUNTING_ENGINE_VERSION,
      period: `${year}-${String(month).padStart(2, '0')}`,
      returnMetadata: {
        currentReturnPct: fundReturnPct,
        returnSource,
        returnStatus: periodReturnRow?.locked ? "FROZEN" : "OPEN (LIVE ESTIMATE)",
        capturedAt
      },
      summary: {
        investorsEvaluated: periodRun.summary.investorsCalculated,
        passCount: periodRun.summary.passCount,
        flaggedCount: periodRun.summary.flaggedCount,
        grossEligibleCapital: Number(periodRun.summary.grossEligibleCapital.toFixed(2)),
        totalGrossFundResult: Number(periodRun.summary.totalGrossFundResult.toFixed(2)),
        totalSourceGainLoss: Number(periodRun.summary.totalSourceGainLoss.toFixed(2)),
        totalRecipientCommissions: Number(periodRun.summary.totalRecipientCommissions.toFixed(2)),
        controlCheck: Math.abs(periodRun.summary.totalGrossFundResult - (periodRun.summary.totalSourceGainLoss + periodRun.summary.totalRecipientCommissions)) < 0.05 ? "RECONCILED" : "DISCREPANCY"
      },
      securityAndLocking: {
        finalizationEnabled: process.env.ACCOUNTING_FINALIZATION_ENABLED === "true",
        canFinalizeGate: periodRun.canFinalize,
        databaseWritesPerformed: 0
      },
      inputHash: periodRun.inputHash,
      previewRunId: periodRun.previewRunId,
      referenceAccounts,
      ruleIntegrity: {
        activeRulesCount: activeRules.length,
        anomaliesCount: ruleAnomalies.length,
        anomalies: ruleAnomalies
      },
      flaggedInvestors: periodRun.investors.filter(i => i.status === "FLAGGED").map(i => ({
        investorId: i.investorId,
        name: i.name,
        flags: i.flags,
        flagReason: i.flagReason
      }))
    });

  } catch (err) {
    console.error("[ShadowHealth] Error executing shadow health check:", err);
    return res.status(500).json({ error: "SHADOW_HEALTH_FAILED", message: err.message });
  }
}
