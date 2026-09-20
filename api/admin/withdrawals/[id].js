import { verifyAdminSession } from "../../../lib/adminAuth.js";
import { supabase } from "../../../lib/supabase.js";
import { calculateAvailableWithdrawalEquity, canonicalizeWithdrawalPeriod } from "../../../lib/withdrawal-validation.js";
import { assertAuthoritativeProductionDb, assertAuditActor } from "../../../lib/financial-mutation-guard.js";

export default async function handler(req, res) {
  const session = verifyAdminSession(req);
  if (!session) return res.status(401).json({ error: "Unauthorized" });

  const { id } = req.query;

  if (req.method === "PATCH" || req.method === "PUT") {
    try {
      await assertAuthoritativeProductionDb("update_withdrawal");
      const auditActor = assertAuditActor(session?.adminId || session?.userId || req.body?.updated_by, "update_withdrawal");

      const body = req.body || {};
      const updates = {};
      if (body.amount !== undefined) updates.amount = parseFloat(body.amount);
      if (body.status !== undefined) updates.status = body.status;
      if (body.notes !== undefined) updates.notes = body.notes;
      if (body.month !== undefined) updates.month = body.month;
      if (body.year !== undefined) updates.year = parseInt(body.year, 10);
      if (body.accountId !== undefined || body.account_id !== undefined) updates.account_id = body.accountId || body.account_id;
      if (body.investorId !== undefined || body.investor_id !== undefined) updates.investor_id = body.investorId || body.investor_id;

      let period = null;
      const hasPeriodUpdate = body.month !== undefined || body.year !== undefined ||
                              body.effective_accounting_date !== undefined || body.effectiveAccountingDate !== undefined ||
                              body.effectiveDate !== undefined || body.month_number !== undefined;

      if (hasPeriodUpdate) {
        try {
          period = canonicalizeWithdrawalPeriod(body);
        } catch (dateErr) {
          return res.status(400).json({ error: dateErr.message || "INVALID_EFFECTIVE_DATE" });
        }
      }

      if (!supabase) {
        return res.status(503).json({
          error: "PACKAGE_B_RPC_UNAVAILABLE: Database client is not configured. Raw financial mutation blocked."
        });
      }

      // 1. Authoritative Save Path: Invoke Atomic Database RPC (Under Investor Advisory Lock)
      try {
        const rpcArgs = {
          p_withdrawal_id: id,
          p_amount: updates.amount !== undefined ? updates.amount : null,
          p_status: updates.status !== undefined ? updates.status : null,
          p_notes: updates.notes !== undefined ? updates.notes : null,
          p_updated_by: auditActor
        };

        if (period) {
          rpcArgs.p_effective_date = period.effectiveDate;
          rpcArgs.p_year = period.year;
          rpcArgs.p_month_number = period.monthNumber;
          rpcArgs.p_month = period.monthName;
        }

        let { data: rpcData, error: rpcError } = await supabase.rpc("update_withdrawal_atomic", rpcArgs);

        if (!rpcError && rpcData) {
          return res.status(200).json({
            status: "SUCCESS",
            withdrawal: rpcData.withdrawal,
            availableEquityBefore: rpcData.available_equity_before,
            availableEquityAfter: rpcData.available_equity_after
          });
        }

        if (rpcError) {
          console.error("[api/admin/withdrawals/[id]] RPC execution error:", JSON.stringify(rpcError));
          const msg = rpcError.message || "";
          const code = rpcError.code || "";

          if (msg.includes("WITHDRAWAL_EXCEEDS_AVAILABLE_EQUITY") ||
              msg.includes("INVALID_WITHDRAWAL_STATUS") ||
              msg.includes("INVALID_STATUS_TRANSITION") ||
              msg.includes("INVALID_EFFECTIVE_DATE") ||
              msg.includes("INVALID_AMOUNT")) {
            return res.status(400).json({ error: msg, code });
          }
          if (msg.includes("WITHDRAWAL_NOT_FOUND")) {
            return res.status(404).json({ error: msg, code });
          }

          if (code === "42501") {
            return res.status(403).json({
              error: `PERMISSION_DENIED: Database role lacks execute permission on update_withdrawal_atomic (${msg})`,
              code
            });
          }

          if (code === "42725") {
            return res.status(500).json({
              error: `OVERLOAD_AMBIGUITY: Multiple conflicting signatures for update_withdrawal_atomic (${msg})`,
              code
            });
          }

          const isMissingRpc = code === "42883" || 
            code === "PGRST202" || 
            msg.includes("Could not find the function") ||
            (msg.includes("schema cache") && msg.includes("function"));

          if (isMissingRpc) {
            return res.status(503).json({
              error: "PACKAGE_B_RPC_UNAVAILABLE: Database concurrency control function (update_withdrawal_atomic) is not installed or unavailable with required parameter support in the target database. Raw financial update is blocked.",
              code,
              details: rpcError.details || null
            });
          }

          return res.status(400).json({ error: msg, code, details: rpcError.details, hint: rpcError.hint });
        }
      } catch (rpcEx) {
        console.error("[api/admin/withdrawals/[id]] RPC exception:", rpcEx);
        const exMsg = rpcEx.message || "";
        const exCode = rpcEx.code || "";
        const isMissingRpc = exCode === "42883" || 
          exCode === "PGRST202" || 
          exMsg.includes("Could not find the function") ||
          (exMsg.includes("schema cache") && exMsg.includes("function"));

        if (isMissingRpc) {
          return res.status(503).json({
            error: "PACKAGE_B_RPC_UNAVAILABLE: Database concurrency control function (update_withdrawal_atomic) is not installed or unavailable with required parameter support in the target database. Raw financial update is blocked.",
            code: exCode,
            details: rpcEx.details || null
          });
        }

        return res.status(400).json({ error: exMsg || "Withdrawal update failed.", code: exCode });
      }

      return res.status(503).json({
        error: "PACKAGE_B_RPC_UNAVAILABLE: Unable to complete atomic withdrawal update."
      });
    } catch (error) {
      console.error("Error updating withdrawal:", error);
      const isAuthDbUnavailable = String(error?.message || "").includes("AUTHORITATIVE_PRODUCTION_DB_UNAVAILABLE");
      return res.status(isAuthDbUnavailable ? 503 : 400).json({ error: error.message || "Withdrawal update failed." });
    }
  }

  if (req.method === "DELETE") {
    res.setHeader("Allow", ["PATCH", "PUT"]);
    return res.status(405).json({
      error: "METHOD_NOT_ALLOWED: Physical deletion of financial withdrawal records is permanently disabled to preserve audit integrity. Transition the record to 'Cancelled' or 'Void' status via PATCH /api/admin/withdrawals/[id]."
    });
  }

  res.setHeader("Allow", ["PATCH", "PUT"]);
  return res.status(405).json({ error: "Method not allowed" });
}
