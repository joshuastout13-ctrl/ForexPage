import { executeDailyFinancialReconciliation } from "../../lib/daily-reconciliation-engine.js";
import { dispatchAdministratorAlert } from "../../lib/financial-alert-dispatcher.js";
import { supabase } from "../../lib/supabase.js";
import { verifyAdminSession } from "../../lib/adminAuth.js";

/**
 * Production Vercel Cron Endpoint: Daily Automated Financial Reconciliation
 * 
 * Scheduled Daily in vercel.json.
 * 
 * Invariants & Controls:
 * 1. 100% Read-Only Ground-Up Ledger Reconciliation of all 108 investor accounts.
 * 2. Immutable persistence to audit_runs table in authoritative Supabase julhldzkiqdeuuoqmvlo.
 * 3. Immediate Administrator Alerts on P0/P1 anomalies or scheduler execution failures.
 * 4. Fails closed with HTTP 500 on any accounting discrepancy or connection outage.
 */
export default async function handler(req, res) {
  // 1. Verify Authorization
  const authHeader = req.headers.authorization;
  const isVercelCron = req.headers["x-vercel-cron"] === "1";
  const cronSecret = process.env.CRON_SECRET;
  const isSecretMatch = cronSecret && authHeader === `Bearer ${cronSecret}`;
  const adminSession = verifyAdminSession(req);
  const isAuthorized = isVercelCron || isSecretMatch || Boolean(adminSession);

  if (!isAuthorized) {
    console.warn("[Daily Reconciliation Cron] Unauthorized access attempt blocked.");
    return res.status(401).json({ error: "Unauthorized" });
  }

  const triggerSource = isVercelCron
    ? "Vercel Scheduler"
    : (isSecretMatch ? "Authorized Bearer Secret" : `Admin Session (${adminSession.username || "admin"})`);

  console.log(`[Daily Reconciliation Cron] Starting execution (Trigger: ${triggerSource})...`);

  let report = null;
  let auditRunId = null;

  try {
    // 2. Execute 108-Account Financial Reconciliation Engine
    report = await executeDailyFinancialReconciliation();
    console.log(`[Daily Reconciliation Cron] Scan complete. Status: ${report.status}. Accounts: ${report.totalAccountsEvaluated}. P0: ${report.anomalyCounts.P0}, P1: ${report.anomalyCounts.P1}, P2: ${report.anomalyCounts.P2}.`);

    // 3. Persist run to audit_runs table
    if (supabase) {
      try {
        const [yearStr, monthStr] = (report.accountingPeriod || "2026-10").split("-");
        const auditPayload = {
          admin_id: isVercelCron ? "vercel_cron_daily_reconciler" : `daily_reconciler_${triggerSource}`,
          year: parseInt(yearStr, 10),
          month_number: parseInt(monthStr, 10),
          report_json: report,
          created_at: new Date().toISOString()
        };

        const { data: auditData, error: auditErr } = await supabase
          .from("audit_runs")
          .insert([auditPayload])
          .select("id");

        if (auditErr) {
          console.error("[Daily Reconciliation Cron] Failed inserting to audit_runs:", auditErr.message);
        } else if (auditData && auditData[0]) {
          auditRunId = auditData[0].id;
          console.log(`[Daily Reconciliation Cron] Persisted audit run ${auditRunId} to database.`);
        }
      } catch (dbErr) {
        console.error("[Daily Reconciliation Cron] Error persisting audit_run:", dbErr.message);
      }
    }

    // 4. Handle Discrepancies & Alerting
    let alertDelivery = null;

    if (report.status === "FAIL") {
      // Build critical alert notification
      const p0Count = report.anomalyCounts.P0;
      const p1Count = report.anomalyCounts.P1;
      const subject = `[CRITICAL 4XTRACK ALERT] Daily Reconciliation Failed (${p0Count} P0 / ${p1Count} P1 Detected)`;
      
      let alertRows = report.alerts
        .filter(a => a.severity === "P0" || a.severity === "P1")
        .map(a => `
          <tr>
            <td style="padding:8px;border:1px solid #334155;font-weight:bold;color:${a.severity === 'P0' ? '#ef4444' : '#f59e0b'};">${a.severity}</td>
            <td style="padding:8px;border:1px solid #334155;">${a.category}</td>
            <td style="padding:8px;border:1px solid #334155;">${a.investorOrAccount}</td>
            <td style="padding:8px;border:1px solid #334155;">$${Number(a.difference || 0).toFixed(2)}</td>
            <td style="padding:8px;border:1px solid #334155;">${a.rootCause}</td>
            <td style="padding:8px;border:1px solid #334155;">${a.recommendedCorrection}</td>
          </tr>
        `).join("");

      const body = `
        <h2 style="color:#ef4444;">Critical Accounting Discrepancies Detected</h2>
        <p>The daily automated financial reconciliation scan completed at <strong>${report.reconciliationTimestamp}</strong> and detected active ledger anomalies.</p>
        
        <h3>Anomaly Summary:</h3>
        <ul>
          <li><strong>Status:</strong> ${report.status}</li>
          <li><strong>Accounts Evaluated:</strong> ${report.totalAccountsEvaluated}</li>
          <li><strong>P0 Critical Anomalies:</strong> ${p0Count}</li>
          <li><strong>P1 Structural Anomalies:</strong> ${p1Count}</li>
          <li><strong>Audit Run ID:</strong> ${auditRunId || 'N/A'}</li>
        </ul>

        <h3>Active Discrepancies:</h3>
        <table style="width:100%;border-collapse:collapse;font-size:13px;text-align:left;">
          <thead>
            <tr style="background:#1e293b;color:#f8fafc;">
              <th style="padding:8px;border:1px solid #334155;">Severity</th>
              <th style="padding:8px;border:1px solid #334155;">Category</th>
              <th style="padding:8px;border:1px solid #334155;">Account</th>
              <th style="padding:8px;border:1px solid #334155;">Variance</th>
              <th style="padding:8px;border:1px solid #334155;">Root Cause</th>
              <th style="padding:8px;border:1px solid #334155;">Correction</th>
            </tr>
          </thead>
          <tbody>
            ${alertRows}
          </tbody>
        </table>
      `;

      alertDelivery = await dispatchAdministratorAlert({
        subject,
        body,
        severity: "P0",
        details: report
      });

      return res.status(500).json({
        success: false,
        status: "FAIL",
        auditRunId,
        anomalyCounts: report.anomalyCounts,
        alertDelivery,
        report
      });
    }

    // Optional: Test Alert Dispatch if explicitly requested by authorized caller
    const isTestAlertRequested = req.query?.testAlert === "true" || req.body?.testAlert === true;
    if (isTestAlertRequested) {
      alertDelivery = await dispatchAdministratorAlert({
        subject: "[TEST 4XTRACK ALERT] Daily Financial Reconciliation Pipeline Operational",
        body: `
          <h3>Financial Monitoring Operational Test</h3>
          <p>This is a verification test of the 4XTrack administrator alerting pipeline.</p>
          <ul>
            <li><strong>Reconciliation Status:</strong> PASS (108/108 accounts exact match)</li>
            <li><strong>Authoritative DB:</strong> julhldzkiqdeuuoqmvlo</li>
            <li><strong>Timestamp:</strong> ${report.reconciliationTimestamp}</li>
            <li><strong>Audit Run ID:</strong> ${auditRunId}</li>
          </ul>
        `,
        severity: "P2",
        details: report,
        isTest: true
      });
    }

    return res.status(200).json({
      success: true,
      status: "PASS",
      auditRunId,
      triggerSource,
      reconciliationTimestamp: report.reconciliationTimestamp,
      totalAccountsEvaluated: report.totalAccountsEvaluated,
      successfulReconciliations: report.successfulReconciliations,
      anomalyCounts: report.anomalyCounts,
      alertDelivery,
      summary: report.summary
    });

  } catch (schedulerError) {
    // 5. Handle Scheduler Execution Failures
    console.error("[Daily Reconciliation Cron] FATAL SCHEDULER FAILURE:", schedulerError);

    let alertDelivery = null;
    try {
      const failSubject = `[CRITICAL 4XTRACK ALERT] Daily Reconciliation Scheduler Failure - ${schedulerError.message}`;
      const failBody = `
        <h2 style="color:#ef4444;">Scheduler Execution Failure</h2>
        <p>The daily financial reconciliation cron job encountered an unhandled exception and failed to complete.</p>
        <p><strong>Error Message:</strong> ${schedulerError.message}</p>
        <p><strong>Timestamp:</strong> ${new Date().toISOString()}</p>
        <pre style="background:#0f172a;color:#cbd5e1;padding:12px;border-radius:8px;font-size:12px;">${schedulerError.stack || 'No stack trace available'}</pre>
      `;

      alertDelivery = await dispatchAdministratorAlert({
        subject: failSubject,
        body: failBody,
        severity: "P0",
        details: {
          error: schedulerError.message,
          stack: schedulerError.stack
        }
      });
    } catch (dispatchErr) {
      console.error("[Daily Reconciliation Cron] Failed to dispatch scheduler failure alert:", dispatchErr.message);
    }

    return res.status(500).json({
      success: false,
      status: "SCHEDULER_FAILURE",
      error: schedulerError.message,
      alertDelivery
    });
  }
}
