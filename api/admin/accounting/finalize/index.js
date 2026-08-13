import { verifyAdminSession } from "../../../../lib/adminAuth.js";
import { supabase } from "../../../../lib/supabase.js";
import { calculateAccountingPeriod } from "../../../../lib/accounting-period-engine.js";

export const ACCOUNTING_ENGINE_VERSION = "2.0.0";

export default async function handler(req, res) {
  // 1. Verify Admin Authentication
  const auth = verifyAdminSession(req);
  if (!auth || !auth.adminId) {
    return res.status(401).json({ error: "Unauthorized", message: "Admin authentication required." });
  }

  // 2. Feature Flag Check — Default: DISABLED
  const finalizationEnabled = process.env.ACCOUNTING_FINALIZATION_ENABLED === "true";
  
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const {
    year,
    month,
    previewRunId,
    inputHash,
    dryRun = true, // Default to dryRun safety
    fundReturnPct = null
  } = req.body || {};

  if (!year || !month) {
    return res.status(400).json({ error: "Missing required parameters: year, month" });
  }

  // 3. If Feature Flag is OFF and dryRun is not explicitly false, allow dry-run certification, but block real finalization with 503
  if (!finalizationEnabled && dryRun === false) {
    return res.status(503).json({
      error: "FINALIZATION_DISABLED",
      message: "Monthly accounting finalization is not enabled in this environment."
    });
  }

  try {
    const yr = Number(year);
    const m = Number(month);

    // 4. Batch fetch current Supabase inputs for authoritative server-side recalculation
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
      return res.status(500).json({ error: "DATABASE_FETCH_FAILED", message: "Failed to load accounting data." });
    }

    // 5. Server-side authoritative recalculation
    const currentRun = calculateAccountingPeriod({
      year: yr,
      month: m,
      fundReturnPct,
      investors: investors || [],
      accounts: accounts || [],
      deposits: deposits || [],
      withdrawals: withdrawals || [],
      commissionShares: commissionShares || [],
      monthlyHistory: monthlyHistory || [],
      commissionEarnings: commissionEarnings || [],
      monthlyReturns: monthlyReturns || []
    });

    // 6. Stale Preview Protection (Check inputHash match)
    if (inputHash && currentRun.inputHash !== inputHash) {
      return res.status(409).json({
        error: "STALE_PREVIEW",
        message: "Financial inputs changed after preview was generated. Please refresh preview.",
        previewHash: inputHash,
        currentHash: currentRun.inputHash
      });
    }

    // 7. Validation Gate Check
    if (!currentRun.canFinalize || currentRun.summary.flaggedCount > 0) {
      return res.status(422).json({
        error: "VALIDATION_FAILED",
        message: "Period cannot be finalized because validation anomalies exist.",
        flaggedCount: currentRun.summary.flaggedCount,
        flags: currentRun.investors.filter(i => i.status === "FLAGGED").map(i => ({ investor: i.name, reason: i.flagReason }))
      });
    }

    // 8. Require Frozen Return State (Not OPEN or actively changing)
    if (currentRun.returnStatus === "OPEN" && process.env.ALLOW_OPEN_RETURN_FINALIZATION !== "true") {
      return res.status(422).json({
        error: "RETURN_NOT_FROZEN",
        message: "Monthly return must be captured and frozen before finalization can proceed.",
        returnStatus: currentRun.returnStatus
      });
    }

    // 9. Total Control Equation Verification
    const grossCap = currentRun.summary.grossEligibleCapital;
    const grossResult = currentRun.summary.totalGrossFundResult;
    const sourceGain = currentRun.summary.totalSourceGainLoss;
    const recipientComm = currentRun.summary.totalRecipientCommissions;
    
    // 10. Construct whatWouldChange Manifest
    const historyRowsToCreate = [];
    const historyRowsToUpdate = [];
    const commissionRowsToCreate = [];
    let totalIncomingCreditsNextMonth = 0;

    currentRun.investors.forEach(inv => {
      const existingHist = (monthlyHistory || []).find(
        h => String(h.investor_id).toLowerCase() === inv.investorId.toLowerCase() &&
             h.year === yr && h.month_number === m
      );

      const histRow = {
        investor_id: inv.investorId,
        account_id: inv.investorId,
        year: yr,
        month_number: m,
        opening_balance: inv.priorEndingBalance,
        deposits: inv.deposits,
        withdrawals: inv.withdrawals,
        eligible_capital: inv.eligibleCapital,
        gross_return_pct: inv.fundReturnPct,
        source_gain_loss: inv.sourceGainLoss,
        ending_balance: inv.endingBalance,
        calculation_version: ACCOUNTING_ENGINE_VERSION,
        is_manual: false
      };

      if (existingHist) {
        if (existingHist.is_manual || existingHist.ismanual) {
          throw new Error(`MANUAL_HISTORY_COLLISION: Manual history record exists for ${inv.name} in period ${yr}-${m}. Manual records cannot be overwritten automatically.`);
        }
        historyRowsToUpdate.push(histRow);
      } else {
        historyRowsToCreate.push(histRow);
      }

      // Recipient commissions for profit months
      inv.recipientAllocations.forEach(rec => {
        if (rec.amount > 0) {
          totalIncomingCreditsNextMonth += rec.amount;
          commissionRowsToCreate.push({
            recipient_id: rec.recipientId,
            source_investor_id: inv.investorId,
            year: yr,
            month_number: m,
            amount: rec.amount,
            commission_percent_snapshot: rec.commissionPercent,
            calculation_version: ACCOUNTING_ENGINE_VERSION
          });
        }
      });
    });

    const manifest = {
      previewStatus: "SHADOW_ONLY",
      isDryRun: true,
      engineVersion: ACCOUNTING_ENGINE_VERSION,
      inputHash: currentRun.inputHash,
      previewRunId: previewRunId || currentRun.previewRunId,
      period: currentRun.period,
      returnMetadata: {
        returnPct: currentRun.fundReturnPct,
        source: currentRun.returnSource,
        status: currentRun.returnStatus,
        capturedAt: currentRun.returnCapturedAt
      },
      controlEquations: {
        grossEligibleCapital: grossCap,
        totalGrossFundResult: grossResult,
        totalSourceGainLoss: sourceGain,
        totalRecipientCommissions: recipientComm,
        controlCheck: Math.abs(grossResult - (sourceGain + recipientComm)) < 0.05 ? "RECONCILED" : "DISCREPANCY"
      },
      nextMonthIncomingCommissionCreditsManifest: {
        targetYear: m === 12 ? yr + 1 : yr,
        targetMonth: m === 12 ? 1 : m + 1,
        totalIncomingCredits: Number(totalIncomingCreditsNextMonth.toFixed(2))
      },
      whatWouldChange: {
        monthlyHistoryRowsToCreate: historyRowsToCreate.length,
        monthlyHistoryRowsToUpdate: historyRowsToUpdate.length,
        commissionEarningsRowsToCreate: commissionRowsToCreate.length,
        accountingPeriodStatusChange: `OPEN -> FINALIZED (${yr}-${m})`,
        auditRunRow: 1,
        totalDatabaseWritesPerformed: 0
      }
    };

    // If dryRun is true OR feature flag is disabled, return manifest with ZERO database writes
    return res.status(200).json({
      status: "SUCCESS_DRY_RUN",
      message: "Dry run finalization completed successfully with ZERO database writes.",
      manifest
    });

  } catch (error) {
    if (error.message.startsWith("MANUAL_HISTORY_COLLISION")) {
      return res.status(409).json({ error: "MANUAL_HISTORY_COLLISION", message: error.message });
    }
    return res.status(500).json({ error: "FINALIZATION_FAILED", message: error.message });
  }
}
