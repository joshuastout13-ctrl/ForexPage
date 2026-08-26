import { verifyAdminSession } from "../../../../lib/adminAuth.js";
import { supabase } from "../../../../lib/supabase.js";

export default async function handler(req, res) {
  const session = verifyAdminSession(req);
  if (!session) return res.status(401).json({ error: "Unauthorized" });

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: "Missing withdrawal ID" });

  if (req.method === "POST") {
    try {
      if (!supabase) {
        return res.status(503).json({
          error: "PACKAGE_B_RPC_UNAVAILABLE: Database client is not configured. Raw status mutation blocked."
        });
      }

      // Invoke atomic RPC for cancellation under investor advisory lock
      const { data: rpcData, error: rpcError } = await supabase.rpc("update_withdrawal_atomic", {
        p_withdrawal_id: id,
        p_amount: null,
        p_status: "Cancelled",
        p_notes: "Cancelled via admin portal action",
        p_updated_by: session?.adminId || "admin"
      });

      if (!rpcError && rpcData) {
        return res.status(200).json({ success: true, withdrawal: rpcData.withdrawal });
      }

      if (rpcError) {
        const msg = rpcError.message || "";
        if (msg.includes("WITHDRAWAL_NOT_FOUND")) {
          return res.status(404).json({ error: msg });
        }
        if (msg.includes("INVALID_STATUS_TRANSITION") || msg.includes("INVALID_WITHDRAWAL_STATUS")) {
          return res.status(400).json({ error: msg });
        }

        const isMissingRpc = !msg || 
          msg.includes("does not exist") || 
          msg.includes("schema cache") || 
          msg.includes("Could not find the function") || 
          rpcError.code === "42883" || 
          rpcError.code === "PGRST202";

        if (isMissingRpc) {
          return res.status(503).json({
            error: "PACKAGE_B_RPC_UNAVAILABLE: Database concurrency control function (update_withdrawal_atomic) is not installed or unavailable in the target database. Raw status mutation blocked."
          });
        }

        return res.status(400).json({ error: msg });
      }
    } catch (err) {
      return res.status(503).json({
        error: `PACKAGE_B_RPC_UNAVAILABLE: ${err.message || "Failed to execute atomic status transition."}`
      });
    }
  }

  res.setHeader("Allow", ["POST"]);
  return res.status(405).json({ error: "Method not allowed" });
}
