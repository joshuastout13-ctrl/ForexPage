import { verifyAdminSession } from "../../../../lib/adminAuth.js";
import { supabase } from "../../../../lib/supabase.js";
import { assertAuthoritativeProductionDb, assertAuditActor } from "../../../../lib/financial-mutation-guard.js";

export default async function handler(req, res) {
  const session = verifyAdminSession(req);
  if (!session) return res.status(401).json({ error: "Unauthorized" });

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: "Missing account ID" });

  if (req.method === "POST") {
    try {
      await assertAuthoritativeProductionDb("certify_account_external_cash_provenance");
      const auditActor = assertAuditActor(session?.adminId || session?.userId || req.body?.certified_by, "certify_account_external_cash_provenance");

      if (!supabase) {
        return res.status(503).json({
          error: "AUTHORITATIVE_PRODUCTION_DB_UNAVAILABLE: Database client is not configured. Provenance mutation blocked."
        });
      }

      const body = req.body || {};
      const targetStatus = String(body.status || "COMPLETE").trim().toUpperCase();
      const notes = body.notes || "";

      if (!["UNKNOWN", "PARTIAL", "COMPLETE"].includes(targetStatus)) {
        return res.status(400).json({
          error: `INVALID_PROVENANCE_STATUS: Status must be UNKNOWN, PARTIAL, or COMPLETE. Received: ${targetStatus}`
        });
      }

      const { data: rpcData, error: rpcError } = await supabase.rpc("certify_account_external_cash_provenance", {
        p_account_id: id,
        p_status: targetStatus,
        p_notes: notes,
        p_certified_by: auditActor
      });

      if (rpcError) {
        console.error("[certify-provenance] RPC error:", rpcError);
        const msg = rpcError.message || "";
        const code = rpcError.code || "";
        if (msg.includes("ACCOUNT_NOT_FOUND")) {
          return res.status(404).json({ error: msg, code });
        }
        if (msg.includes("CANNOT_CERTIFY_EMPTY_PROVENANCE") || msg.includes("INVALID_PROVENANCE_STATUS")) {
          return res.status(400).json({ error: msg, code });
        }
        return res.status(400).json({ error: msg, code, details: rpcError.details });
      }

      return res.status(200).json({
        success: true,
        certification: rpcData
      });
    } catch (err) {
      console.error("[certify-provenance] Exception:", err);
      const isAuthDbUnavailable = String(err?.message || "").includes("AUTHORITATIVE_PRODUCTION_DB_UNAVAILABLE");
      return res.status(isAuthDbUnavailable ? 503 : 400).json({ error: err.message || "Provenance certification failed." });
    }
  }

  res.setHeader("Allow", ["POST"]);
  return res.status(405).json({ error: "Method not allowed" });
}
