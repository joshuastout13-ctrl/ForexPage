import { supabase } from "../../lib/supabase.js";
import { loadAccountingData } from "../../lib/paginated-read.js";
import { verifyAdminSession } from "../../lib/adminAuth.js";
import { getFundAccountingDate, evaluateMonthState, MonthState } from "../../lib/month-state.js";
import { dispatchAdministratorAlert } from "../../lib/financial-alert-dispatcher.js";
import { executePeriodFinalizationWorkflow } from "../admin/accounting/finalize/index.js";

function isQualifiedMyfxbookSource(source) {
  const s = String(source || "").trim().toUpperCase();
  return s.includes("MYFXBOOK") || s === "MYFXBOOK_COMPLETED_MONTH";
}

/**
 * Vercel Cron / Scheduled Month-End Close Endpoint
 *
 * Triggered on the 1st of each month (`0 10 1 * *`) after Myfxbook daily sync
 * settles in America/Los_Angeles.
 * - Fails closed on missing return, non-settled period, or flagged preview anomalies.
 * - When AUTO_MONTH_END_CLOSE_ENABLED !== "true" or ACCOUNTING_FINALIZATION_ENABLED !== "true",
 *   runs in SHADOW_PREVIEW_ONLY mode (zero writes) and dispatches a P2 readiness alert.
 * - When both flags are "true", freezes verified Myfxbook return (if not already locked) and
 *   executes atomic finalization via finalize_monthly_accounting_v2.
 */
export default async function handler(req, res, deps = {}) {
  const authHeader = req.headers?.authorization;
  const isVercelCron = req.headers?.["x-vercel-cron"] === "1";
  const cronSecret = process.env.CRON_SECRET;
  const isSecretMatch = Boolean(cronSecret && authHeader === `Bearer ${cronSecret}`);
  const adminSession = verifyAdminSession(req);

  if (!isVercelCron && !isSecretMatch && !adminSession) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const db = deps.supabase || supabase;
  if (!db) {
    return res.status(503).json({ error: "DATABASE_UNAVAILABLE" });
  }

  const accountingDataLoader = deps.loadAccountingData || loadAccountingData;
  const alertDispatcher = deps.dispatchAdministratorAlert || dispatchAdministratorAlert;

  try {
    const asOfDate = req.query?.asOfDate || req.body?.asOfDate || null;
    const fundDate = getFundAccountingDate(asOfDate);

    const reqYear = req.query?.year ?? req.body?.year;
    const reqMonth = req.query?.month ?? req.body?.month;

    const targetMonth = reqMonth
      ? Number(reqMonth)
      : (fundDate.monthNumber === 1 ? 12 : fundDate.monthNumber - 1);
    const targetYear = reqYear
      ? Number(reqYear)
      : (fundDate.monthNumber === 1 ? fundDate.year - 1 : fundDate.year);

    if (!Number.isInteger(targetYear) || !Number.isInteger(targetMonth) || targetMonth < 1 || targetMonth > 12) {
      return res.status(400).json({ error: "INVALID_PERIOD", message: "Invalid target year or month." });
    }

    const monthState = evaluateMonthState(targetYear, targetMonth, asOfDate);
    if (monthState !== MonthState.HISTORICAL_SETTLED) {
      return res.status(422).json({
        error: "PERIOD_NOT_HISTORICAL_SETTLED",
        message: `Refusing auto-close for ${targetYear}-${String(targetMonth).padStart(2, "0")}: period state is ${monthState}.`
      });
    }

    // 1. Idempotency check against accounting_periods
    const { data: existingPeriods, error: apErr } = await db
      .from("accounting_periods")
      .select("id,year,month_number,status")
      .eq("year", targetYear)
      .eq("month_number", targetMonth);
    if (apErr) throw apErr;

    const alreadyFinalized = (existingPeriods || []).some(
      (p) => String(p.status || "").trim().toUpperCase() === "FINALIZED"
    );
    if (alreadyFinalized) {
      return res.status(200).json({
        success: true,
        skipped: true,
        reason: "ALREADY_FINALIZED",
        targetYear,
        targetMonth
      });
    }

    // 2. Fetch completed month return row
    const { data: retRows, error: retErr } = await db
      .from("monthly_returns")
      .select("*")
      .eq("year", targetYear)
      .eq("month_number", targetMonth);
    if (retErr) throw retErr;

    const retRow = retRows?.[0] || null;
    if (!retRow || retRow.gross_return_pct === null || retRow.gross_return_pct === undefined || isNaN(Number(retRow.gross_return_pct))) {
      await alertDispatcher({
        severity: "P0",
        subject: `[4XTRACK] Month-End Close Blocked: Missing Return for ${targetYear}-${String(targetMonth).padStart(2, "0")}`,
        body: `Scheduled month-end close could not find a numeric monthly_returns entry for ${targetYear}-${String(targetMonth).padStart(2, "0")}. No database writes were made.`
      }).catch(() => {});

      return res.status(422).json({
        success: false,
        error: "MISSING_COMPLETED_MONTH_RETURN",
        targetYear,
        targetMonth
      });
    }

    const autoCloseEnabled = process.env.AUTO_MONTH_END_CLOSE_ENABLED === "true";
    const finalizationEnabled = process.env.ACCOUNTING_FINALIZATION_ENABLED === "true";
    const freezeEnabled = process.env.ACCOUNTING_RETURN_FREEZE_ENABLED === "true";
    const isReturnLocked = retRow.locked === true || String(retRow.locked).toLowerCase() === "true";

    // 3. Always run in-memory dry-run validation first to verify zero flags & get authoritative inputHash
    const previewOutcome = await executePeriodFinalizationWorkflow({
      db,
      accountingDataLoader,
      yr: targetYear,
      m: targetMonth,
      dryRun: true,
      finalizationEnabled: false,
      allowOpenReturn: !isReturnLocked,
      adminId: adminSession?.adminId || "cron_month_end_close"
    });

    if (previewOutcome.statusCode !== 200) {
      await alertDispatcher({
        severity: "P0",
        subject: `[4XTRACK] Month-End Close Validation Failed (${targetYear}-${String(targetMonth).padStart(2, "0")})`,
        body: `Dry-run validation failed with ${previewOutcome.payload?.error}: ${previewOutcome.payload?.message}`,
        details: previewOutcome.payload
      }).catch(() => {});
      return res.status(previewOutcome.statusCode).json(previewOutcome.payload);
    }

    // If automated finalization is gated OFF, stop cleanly in SHADOW_PREVIEW_ONLY mode
    if (!autoCloseEnabled || !finalizationEnabled) {
      await alertDispatcher({
        severity: "P2",
        subject: `[4XTRACK] Month-End Close Preview Ready (${targetYear}-${String(targetMonth).padStart(2, "0")})`,
        body: `Monthly close preview passed cleanly (0 flags). Automatic close is disabled; review and finalize in Admin -> Accounting Preview.`,
        details: previewOutcome.payload?.manifest
      }).catch(() => {});

      return res.status(200).json({
        success: true,
        mode: "SHADOW_PREVIEW_ONLY",
        targetYear,
        targetMonth,
        ...previewOutcome.payload
      });
    }

    // 4. Freeze verified Myfxbook return if not yet locked
    if (!isReturnLocked) {
      if (!freezeEnabled || !isQualifiedMyfxbookSource(retRow.source)) {
        await alertDispatcher({
          severity: "P0",
          subject: `[4XTRACK] Month-End Close Blocked: Unfrozen/Unverified Return (${targetYear}-${String(targetMonth).padStart(2, "0")})`,
          body: `Monthly return is unlocked and either return freeze is disabled or source "${retRow.source || ""}" is not a verified Myfxbook feed.`
        }).catch(() => {});

        return res.status(422).json({
          success: false,
          error: "RETURN_NOT_FROZEN",
          source: retRow.source || null,
          targetYear,
          targetMonth
        });
      }

      const { error: freezeErr } = await db
        .from("monthly_returns")
        .update({
          locked: true,
          source: "MYFXBOOK_COMPLETED_MONTH",
          last_updated: new Date().toISOString(),
          notes: `Auto-frozen by month-end cron at ${new Date().toISOString()}`
        })
        .eq("year", targetYear)
        .eq("month_number", targetMonth);
      if (freezeErr) throw freezeErr;
    }

    // 5. Execute live atomic finalization + rollover
    const inputHash = previewOutcome.payload?.manifest?.inputHash || null;
    const liveOutcome = await executePeriodFinalizationWorkflow({
      db,
      accountingDataLoader,
      yr: targetYear,
      m: targetMonth,
      inputHash,
      dryRun: false,
      finalizationEnabled: true,
      allowOpenReturn: false,
      adminId: adminSession?.adminId || "cron_month_end_close"
    });

    if (liveOutcome.statusCode !== 200) {
      await alertDispatcher({
        severity: "P0",
        subject: `[CRITICAL 4XTRACK] Month-End Close Execution Failed (${targetYear}-${String(targetMonth).padStart(2, "0")})`,
        body: `Month-end finalization failed with ${liveOutcome.payload?.error}: ${liveOutcome.payload?.message}`,
        details: liveOutcome.payload
      }).catch(() => {});
      return res.status(liveOutcome.statusCode).json(liveOutcome.payload);
    }

    await alertDispatcher({
      severity: "P2",
      subject: `[4XTRACK] Month-End Close Completed (${targetYear}-${String(targetMonth).padStart(2, "0")})`,
      body: liveOutcome.payload?.message || "Completed.",
      details: liveOutcome.payload?.manifest
    }).catch(() => {});

    return res.status(200).json({
      success: true,
      mode: "AUTO_FINALIZED",
      targetYear,
      targetMonth,
      ...liveOutcome.payload
    });
  } catch (err) {
    console.error("[Cron Month-End Close ERROR]:", err);
    await alertDispatcher({
      severity: "P0",
      subject: "[CRITICAL 4XTRACK] Month-End Close Cron Exception",
      body: `Month-end close cron threw an exception: ${err.message}`
    }).catch(() => {});
    return res.status(500).json({ error: "MONTH_END_CLOSE_FAILED", message: err.message });
  }
}
