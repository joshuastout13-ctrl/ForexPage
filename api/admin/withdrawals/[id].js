import { verifyAdminSession } from "../../../lib/adminAuth.js";
import { supabase } from "../../../lib/supabase.js";
import { calculateAvailableWithdrawalEquity } from "../../../lib/withdrawal-validation.js";

export default async function handler(req, res) {
  const session = verifyAdminSession(req);
  if (!session) return res.status(401).json({ error: "Unauthorized" });

  const { id } = req.query;

  if (req.method === "PATCH" || req.method === "PUT") {
    try {
      const body = req.body || {};
      const updates = {};
      if (body.amount !== undefined) updates.amount = parseFloat(body.amount);
      if (body.status !== undefined) updates.status = body.status;
      if (body.notes !== undefined) updates.notes = body.notes;
      if (body.month !== undefined) updates.month = body.month;
      if (body.year !== undefined) updates.year = parseInt(body.year, 10);
      if (body.accountId !== undefined || body.account_id !== undefined) updates.account_id = body.accountId || body.account_id;
      if (body.investorId !== undefined || body.investor_id !== undefined) updates.investor_id = body.investorId || body.investor_id;

      if (!supabase) {
        return res.status(503).json({
          error: "PACKAGE_B_RPC_UNAVAILABLE: Database client is not configured. Raw financial mutation blocked."
        });
      }

      // 1. Authoritative Save Path: Invoke Atomic Database RPC (Under Investor Advisory Lock)
      try {
        const { data: rpcData, error: rpcError } = await supabase.rpc("update_withdrawal_atomic", {
          p_withdrawal_id: id,
          p_amount: updates.amount !== undefined ? updates.amount : null,
          p_status: updates.status !== undefined ? updates.status : null,
          p_notes: updates.notes !== undefined ? updates.notes : null,
          p_updated_by: body.updated_by || (session?.adminId || "admin")
        });

        if (!rpcError && rpcData) {
          return res.status(200).json({
            status: "SUCCESS",
            withdrawal: rpcData.withdrawal,
            availableEquityBefore: rpcData.available_equity_before,
            availableEquityAfter: rpcData.available_equity_after
          });
        }

        if (rpcError) {
          const msg = rpcError.message || "";
          if (msg.includes("WITHDRAWAL_EXCEEDS_AVAILABLE_EQUITY") ||
              msg.includes("INVALID_WITHDRAWAL_STATUS") ||
              msg.includes("INVALID_STATUS_TRANSITION") ||
              msg.includes("INVALID_AMOUNT")) {
            return res.status(400).json({ error: msg });
          }
          if (msg.includes("WITHDRAWAL_NOT_FOUND")) {
            return res.status(404).json({ error: msg });
          }

          const isMissingRpc = !msg || 
            msg.includes("does not exist") || 
            msg.includes("schema cache") || 
            msg.includes("Could not find the function") || 
            rpcError.code === "42883" || 
            rpcError.code === "PGRST202";

          if (isMissingRpc) {
            return res.status(503).json({
              error: "PACKAGE_B_RPC_UNAVAILABLE: Database concurrency control function (update_withdrawal_atomic) is not installed or unavailable in the target database. Raw financial update is blocked."
            });
          }

          return res.status(400).json({ error: msg });
        }
      } catch (rpcEx) {
        const exMsg = rpcEx.message || "";
        const isMissingRpc = exMsg.includes("does not exist") || 
          exMsg.includes("schema cache") || 
          exMsg.includes("Could not find the function") || 
          rpcEx.code === "42883" || 
          rpcEx.code === "PGRST202";

        if (isMissingRpc) {
          return res.status(503).json({
            error: "PACKAGE_B_RPC_UNAVAILABLE: Database concurrency control function (update_withdrawal_atomic) is not installed or unavailable in the target database. Raw financial update is blocked."
          });
        }

        return res.status(400).json({ error: exMsg || "Withdrawal update failed." });
      }

      return res.status(503).json({
        error: "PACKAGE_B_RPC_UNAVAILABLE: Unable to complete atomic withdrawal update."
      });
    } catch (error) {
      console.error("Error updating withdrawal:", error);
      return res.status(400).json({ error: error.message || "Withdrawal update failed." });
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
