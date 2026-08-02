import { verifyAdminSession } from "../../../lib/adminAuth.js";
import { supabase } from "../../../lib/supabase.js";

export default async function handler(req, res) {
  try {
    const session = verifyAdminSession(req);
    if (!session) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { sourceInvestorId, accountId, shares } = req.body;

    if (!sourceInvestorId || !Array.isArray(shares)) {
      return res.status(400).json({ error: "Invalid payload: sourceInvestorId and shares array required" });
    }

    // Look up source investor
    let { data: sourceInv } = await supabase
      .from("investors")
      .select("id, split_pct, portal_username")
      .eq("id", sourceInvestorId)
      .maybeSingle();

    if (!sourceInv) {
      const { data: srcByUsername } = await supabase
        .from("investors")
        .select("id, split_pct, portal_username")
        .ilike("portal_username", sourceInvestorId)
        .maybeSingle();
      sourceInv = srcByUsername;
    }

    const invSplit = sourceInv ? Number(sourceInv.split_pct || 100) : 100;
    const maxPool = 100 - invSplit;

    // Validate total active percentage in payload
    const activePayloadShares = shares.filter(s => s.status !== "cancelled" && s.status !== "ended");
    const totalAllocated = activePayloadShares.reduce((sum, s) => sum + Number(s.commissionPercent || 0), 0);

    if (totalAllocated > maxPool + 0.01) {
      return res.status(400).json({
        error: `Total assigned commission (${totalAllocated.toFixed(2)}%) exceeds available commission pool (${maxPool.toFixed(2)}%) for this investor.`
      });
    }

    const nowIso = new Date().toISOString().split('T')[0];

    // Fetch existing shares for this source investor
    const { data: existingShares } = await supabase
      .from("commission_shares")
      .select("*")
      .or(`source_investor_id.eq.${sourceInvestorId},source_investor_id.eq.${sourceInv ? sourceInv.id : ''},source_investor_id.eq.${sourceInv ? sourceInv.portal_username : ''}`);

    const existingMap = new Map((existingShares || []).map(s => [s.id, s]));
    const payloadIds = new Set(shares.map(s => s.id).filter(Boolean));

    // 1. Process payload items (Update or Insert)
    for (const item of shares) {
      // Resolve recipient
      let recId = item.recipientId || item.recipientUsername;
      let recipientObj = null;
      if (recId) {
        const { data: r1 } = await supabase.from("investors").select("id").eq("id", recId).maybeSingle();
        recipientObj = r1;
        if (!recipientObj) {
          const { data: r2 } = await supabase.from("investors").select("id").ilike("portal_username", recId).maybeSingle();
          recipientObj = r2;
        }
        if (!recipientObj) {
          const { data: r3 } = await supabase.from("investors").select("id").ilike("email", recId).maybeSingle();
          recipientObj = r3;
        }
      }

      if (!recipientObj) {
        continue; // Skip invalid recipient
      }

      if (sourceInv && recipientObj.id.toLowerCase() === sourceInv.id.toLowerCase()) {
        return res.status(400).json({ error: "Cannot share commission with yourself" });
      }

      if (item.id && existingMap.has(item.id)) {
        // Update existing share
        await supabase
          .from("commission_shares")
          .update({
            recipient_investor_id: recipientObj.id,
            commission_percent: Number(item.commissionPercent || 0),
            effective_start_date: item.effectiveStartDate || nowIso,
            effective_end_date: item.effectiveEndDate || null,
            status: item.status || "active",
            updated_at: new Date()
          })
          .eq("id", item.id);
      } else {
        // Insert new share
        await supabase
          .from("commission_shares")
          .insert({
            source_investor_id: sourceInv ? sourceInv.id : sourceInvestorId,
            source_account_id: accountId || null,
            recipient_investor_id: recipientObj.id,
            commission_percent: Number(item.commissionPercent || 0),
            effective_start_date: item.effectiveStartDate || nowIso,
            effective_end_date: item.effectiveEndDate || null,
            status: item.status || "active"
          });
      }
    }

    // 2. Deactivate any existing shares that were removed in the payload
    for (const [exId, exShare] of existingMap.entries()) {
      if (!payloadIds.has(exId) && exShare.status !== "cancelled") {
        await supabase
          .from("commission_shares")
          .update({
            status: "cancelled",
            effective_end_date: nowIso,
            updated_at: new Date()
          })
          .eq("id", exId);
      }
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("[Admin Bulk Commission Shares API]", error);
    res.status(500).json({ error: error.message || "Internal server error" });
  }
}
