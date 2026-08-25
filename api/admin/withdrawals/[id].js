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

          if (!isMissingRpc) {
            throw rpcError;
          }
        }
      } catch (rpcEx) {
        const exMsg = rpcEx.message || "";
        const isMissingRpc = exMsg.includes("does not exist") || 
          exMsg.includes("schema cache") || 
          exMsg.includes("Could not find the function") || 
          rpcEx.code === "42883" || 
          rpcEx.code === "PGRST202";

        if (!isMissingRpc) {
          throw rpcEx;
        }
      }

      // 2. Application-Level Fallback (when RPC is not yet installed in target database)
      const { data: currentWd, error: fetchErr } = await supabase
        .from("withdrawals")
        .select("*")
        .eq("id", id)
        .single();

      if (fetchErr || !currentWd) {
        return res.status(404).json({ error: `WITHDRAWAL_NOT_FOUND: Withdrawal ${id} not found.` });
      }

      const invId = updates.investor_id || currentWd.investor_id;
      const accId = updates.account_id || currentWd.account_id;
      const effDate = currentWd.effective_accounting_date || currentWd.request_date || `${currentWd.year}-${String(currentWd.month_number).padStart(2, '0')}-01`;
      const targetAmount = updates.amount !== undefined ? updates.amount : currentWd.amount;
      const targetStatus = updates.status !== undefined ? updates.status : currentWd.status;

      // Status Transition Rules for fallback
      if (updates.status && updates.status !== currentWd.status) {
        if (currentWd.status === "Completed") {
          return res.status(400).json({ error: `INVALID_STATUS_TRANSITION: Completed withdrawals cannot transition to ${updates.status}.` });
        }
        if (currentWd.status === "Cancelled" || currentWd.status === "Void") {
          return res.status(400).json({ error: `INVALID_STATUS_TRANSITION: Cannot transition terminal withdrawal status (${currentWd.status}) to ${updates.status}.` });
        }
      }

      const normalizedStatus = String(targetStatus || '').toLowerCase();
      if (normalizedStatus === 'pending' || normalizedStatus === 'approved' || normalizedStatus === 'completed') {
        const { availableEquity } = await calculateAvailableWithdrawalEquity(invId, effDate, {
          excludeWithdrawalId: id,
          accountId: accId
        });

        if (targetAmount > availableEquity) {
          return res.status(400).json({
            error: `WITHDRAWAL_EXCEEDS_AVAILABLE_EQUITY: Updated amount ($${targetAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}) exceeds available account equity ($${availableEquity.toLocaleString('en-US', { minimumFractionDigits: 2 })}) at effective date ${effDate}.`,
            availableEquity,
            requestedAmount: targetAmount,
            effectiveDate: effDate
          });
        }
      }

      let updateRes = await supabase.from("withdrawals").update(updates).eq("id", id).select();
      if (updateRes.error && updateRes.error.message && updateRes.error.message.includes("effective_accounting_date")) {
        delete updates.effective_accounting_date;
        updateRes = await supabase.from("withdrawals").update(updates).eq("id", id).select();
      }
      if (updateRes.error) throw updateRes.error;

      return res.status(200).json({
        status: "SUCCESS",
        withdrawal: updateRes.data[0]
      });
    } catch (error) {
      console.error("Error updating withdrawal:", error);
      return res.status(400).json({ error: error.message || "Withdrawal update failed." });
    }
  }

  if (req.method === "DELETE") {
    try {
      const { data, error } = await supabase.from("withdrawals").delete().eq("id", id).select();
      if (error) throw error;
      return res.status(200).json({ success: true, data });
    } catch (error) {
      return res.status(500).json({ error: "Failed to delete withdrawal." });
    }
  }

  res.setHeader("Allow", ["PATCH", "PUT", "DELETE"]);
  return res.status(405).json({ error: "Method not allowed" });
}
