import { verifyAdminSession } from "../../../lib/adminAuth.js";
import { supabase } from "../../../lib/supabase.js";
import { hashPassword, isBcryptHash } from "../../../lib/password.js";

export default async function handler(req, res) {
  const session = verifyAdminSession(req);
  if (!session) return res.status(401).json({ error: "Unauthorized" });

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: "Missing investor ID" });

  if (req.method === "PATCH" || req.method === "PUT") {
    try {
      const body = req.body || {};
      const updates = {};
      
      if (body.firstName !== undefined) updates.first_name = body.firstName;
      if (body.lastName !== undefined) updates.last_name = body.lastName;
      if (body.email !== undefined) updates.email = body.email;
      if (body.portalUsername !== undefined) updates.portal_username = body.portalUsername;
      const rawPwd = body.tempPassword !== undefined ? body.tempPassword : body.password;
      if (rawPwd !== undefined) {
        const cleanPwd = String(rawPwd || "").trim();
        updates.temp_password = cleanPwd ? (isBcryptHash(cleanPwd) ? cleanPwd : hashPassword(cleanPwd)) : "";
      }
      if (body.splitPct !== undefined) updates.split_pct = Number(body.splitPct);
      if (body.monthlyDraw !== undefined) updates.monthly_draw = Number(body.monthlyDraw);
      if (body.startDate !== undefined) updates.start_date = body.startDate;
      if (body.asOfDate !== undefined) updates.start_date = body.asOfDate;
      if (body.role !== undefined) updates.role = body.role;
      if (body.showFundPerformance !== undefined) updates.show_fund_performance = (body.showFundPerformance === true || body.showFundPerformance === "true");
      if (body.show_fund_performance !== undefined) updates.show_fund_performance = (body.show_fund_performance === true || body.show_fund_performance === "true");
      if (body.notes !== undefined) updates.notes = body.notes;

      // Handle commission rules if provided
      const splitPct = updates.split_pct !== undefined ? updates.split_pct : undefined;
      const commissionRules = Array.isArray(body.commissionRules) ? body.commissionRules : null;

      if (splitPct !== undefined && (isNaN(splitPct) || splitPct < 0 || splitPct > 100)) {
        throw new Error("Invalid split percentage: must be between 0 and 100");
      }

      if (commissionRules !== null && commissionRules.length > 0) {
        return res.status(400).json({
          error: "LEGACY_COMMISSION_RULES_DEPRECATED: Use /api/admin/commission-shares (or /bulk) to manage date-effective commission shares instead of legacy commission_rules.",
          code: "LEGACY_COMMISSION_RULES_DEPRECATED"
        });
      }

      // Build associated account update payload preserving exact field mappings
      const accUpdates = {};
      if (body.name !== undefined) accUpdates.name = body.name;
      if (body.startingCapital !== undefined) accUpdates.starting_capital = Number(body.startingCapital);
      if (body.totalCashIn !== undefined) accUpdates.total_cash_in = Number(body.totalCashIn);
      if (body.isCommission !== undefined) accUpdates.is_commission = body.isCommission === true || body.isCommission === "true";
      if (body.splitPct !== undefined) accUpdates.split_pct = Number(body.splitPct);
      if (body.startDate !== undefined || body.asOfDate !== undefined) {
        accUpdates.open_date = body.startDate || body.asOfDate;
      }

      // Preserve exact trigger condition and derived fields when creating a missing account
      const createAccountIfMissing = body.startingCapital !== undefined && body.startingCapital !== "";
      const createAccountPayload = createAccountIfMissing
        ? {
            id: body.accountId || body.portalUsername || id,
            investor_id: id,
            name: body.name || [body.firstName, body.lastName].filter(Boolean).join(" ") || "Main Account",
            starting_capital: Number(body.startingCapital || 0),
            total_cash_in: Number(body.totalCashIn !== undefined ? body.totalCashIn : (body.startingCapital || 0)),
            open_date: body.startDate || body.asOfDate || new Date().toISOString().split("T")[0],
            status: "Active",
            is_commission: body.isCommission === true || body.isCommission === "true",
            split_pct: Number(body.splitPct !== undefined ? body.splitPct : 100),
            notes: "Created via Admin Dashboard update"
          }
        : null;

      if (!supabase) {
        throw new Error("Database client unavailable.");
      }

      // Execute investor profile update and associated account update/insert atomically in one transaction
      const { data: rpcData, error: rpcError } = await supabase.rpc(
        "update_investor_profile_and_accounts_atomic",
        {
          p_investor_id: id,
          p_investor_updates: updates,
          p_account_updates: accUpdates,
          p_target_portal_username: body.portalUsername ? String(body.portalUsername) : null,
          p_create_account_if_missing: createAccountIfMissing,
          p_create_account_payload: createAccountPayload
        }
      );

      if (rpcError) throw rpcError;
      if (!rpcData || typeof rpcData !== "object" || !rpcData.investor || typeof rpcData.investor !== "object") {
        throw new Error("Atomic investor update returned an invalid response payload.");
      }

      return res.status(200).json({ success: true, investor: rpcData.investor });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === "DELETE") {
    try {
      const investorId = typeof id === "string" ? id.trim() : "";
      if (!investorId) {
        return res.status(400).json({ error: "Missing investor ID" });
      }

      if (!supabase) {
        return res.status(503).json({ error: "Database client unavailable." });
      }

      // Execute fail-closed financial/audit history checks and zero-history draft deletion atomically in one transaction
      const { data: rpcData, error: rpcError } = await supabase.rpc(
        "delete_draft_investor_atomic",
        { p_investor_id: investorId }
      );

      if (rpcError) {
        const msg =
          typeof rpcError.message === "string" && rpcError.message.trim()
            ? rpcError.message.trim()
            : "Atomic investor deletion failed.";

        if (/^(?:ERROR:\s*)?FINANCIAL_HISTORY_IMMUTABLE:/.test(msg)) {
          return res.status(409).json({ error: msg, code: "FINANCIAL_HISTORY_IMMUTABLE" });
        }
        if (/^(?:ERROR:\s*)?AMBIGUOUS_ACCOUNT_LINKAGE:/.test(msg)) {
          return res.status(409).json({ error: msg, code: "AMBIGUOUS_ACCOUNT_LINKAGE" });
        }
        if (/^(?:ERROR:\s*)?INVESTOR_NOT_FOUND:/.test(msg)) {
          return res.status(404).json({ error: msg, code: "INVESTOR_NOT_FOUND" });
        }
        if (/^(?:ERROR:\s*)?INVALID_INVESTOR_ID:/.test(msg)) {
          return res.status(400).json({ error: msg, code: "INVALID_INVESTOR_ID" });
        }
        return res.status(500).json({ error: msg });
      }

      if (
        !rpcData ||
        typeof rpcData !== "object" ||
        rpcData.status !== "DELETED" ||
        rpcData.deleted_investor_id !== investorId
      ) {
        throw new Error("Atomic investor deletion returned an invalid response payload.");
      }

      return res.status(200).json({
        success: true,
        message: "Draft investor profile deleted (zero financial history)"
      });
    } catch (err) {
      return res.status(500).json({ error: err?.message || "Internal server error" });
    }
  }

  res.status(405).json({ error: "Method not allowed" });
}
