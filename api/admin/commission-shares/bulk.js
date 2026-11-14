import { verifyAdminSession } from "../../../lib/adminAuth.js";
import { supabase } from "../../../lib/supabase.js";
import { getFinalizedPeriods, ruleAppliesToPeriod } from "../../../lib/commission-share-validation.js";

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

    const nowIso = new Date().toISOString().split('T')[0];

    // Fetch existing shares for this source investor BEFORE writing anything
    const { data: existingShares, error: exErr } = await supabase
      .from("commission_shares")
      .select("*")
      .or(`source_investor_id.eq.${sourceInvestorId},source_investor_id.eq.${sourceInv ? sourceInv.id : ''},source_investor_id.eq.${sourceInv ? sourceInv.portal_username : ''}`);

    if (exErr) throw exErr;

    const existingMap = new Map((existingShares || []).map(s => [s.id, s]));
    const canonicalSourceId = sourceInv ? sourceInv.id : sourceInvestorId;
    const accountFilter = accountId || null;
    const finalizedPeriods = await getFinalizedPeriods(supabase);

    // Resolve recipients and build full candidate list before applying any DB writes
    const resolvedItems = [];
    for (const item of shares) {
      const recId = item.recipientId || item.recipientUsername;
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
        return res.status(400).json({ error: `Recipient investor not found: ${recId || "(empty)"}` });
      }
      if (
        recipientObj.id.toLowerCase() === canonicalSourceId.toLowerCase() ||
        (sourceInv?.portal_username && recipientObj.id.toLowerCase() === sourceInv.portal_username.toLowerCase())
      ) {
        return res.status(400).json({ error: "Cannot share commission with yourself" });
      }

      const pct = Number(item.commissionPercent ?? 0);
      const startDate = String(item.effectiveStartDate || nowIso).slice(0, 10);
      const endDate = item.effectiveEndDate ? String(item.effectiveEndDate).slice(0, 10) : null;
      const itemStatus = String(item.status || "active").toLowerCase();

      if (Number.isNaN(pct) || pct <= 0 || pct > 100) {
        return res.status(400).json({ error: `INVALID_COMMISSION_PERCENT: Invalid percent (${item.commissionPercent})` });
      }
      if (endDate && endDate < startDate) {
        return res.status(400).json({ error: `INVALID_DATE_RANGE: ${endDate} < ${startDate}` });
      }
      if (!["active", "ended", "cancelled"].includes(itemStatus)) {
        return res.status(400).json({ error: `INVALID_SHARE_STATUS: ${itemStatus}` });
      }

      resolvedItems.push({
        id: item.id || null,
        source_investor_id: canonicalSourceId,
        source_account_id: accountFilter,
        recipient_investor_id: recipientObj.id,
        commission_percent: pct,
        effective_start_date: startDate,
        effective_end_date: endDate,
        status: itemStatus
      });
    }

    const payloadIds = new Set(resolvedItems.map(s => s.id).filter(Boolean));
    const removedShares = [];
    for (const [exId, exShare] of existingMap.entries()) {
      if (!payloadIds.has(exId) && exShare.status !== "cancelled" && exShare.status !== "ended") {
        removedShares.push({
          ...exShare,
          status: "ended",
          effective_end_date: nowIso
        });
      }
    }

    // Check locked periods against all updates/inserts/removals
    for (const item of resolvedItems) {
      const existing = item.id ? existingMap.get(item.id) : null;
      for (const fp of finalizedPeriods) {
        const beforeApplies = existing ? ruleAppliesToPeriod(existing, fp.year, fp.month_number) : false;
        const afterApplies = item.status !== "cancelled" ? ruleAppliesToPeriod(item, fp.year, fp.month_number) : false;
        const changedEconomics =
          beforeApplies &&
          afterApplies &&
          (Math.abs(Number(existing.commission_percent) - item.commission_percent) > 1e-6 ||
            String(existing.recipient_investor_id || "").toLowerCase() !== String(item.recipient_investor_id || "").toLowerCase());
        if (beforeApplies !== afterApplies || changedEconomics) {
          return res.status(409).json({
            error: `PERIOD_LOCKED: Bulk commission share update alters finalized period ${fp.year}-${String(fp.month_number).padStart(2, "0")}.`,
            code: "PERIOD_LOCKED"
          });
        }
      }
    }

    for (const rem of removedShares) {
      const existing = existingMap.get(rem.id);
      for (const fp of finalizedPeriods) {
        if (ruleAppliesToPeriod(existing, fp.year, fp.month_number) !== ruleAppliesToPeriod(rem, fp.year, fp.month_number)) {
          return res.status(409).json({
            error: `PERIOD_LOCKED: Removing share ${rem.id} alters finalized period ${fp.year}-${String(fp.month_number).padStart(2, "0")}.`,
            code: "PERIOD_LOCKED"
          });
        }
      }
    }

    // Resulting state for non-cancelled shares on the same (source_account_id)
    const unchangedShares = (existingShares || []).filter(
      s => !payloadIds.has(s.id) && !removedShares.some(r => r.id === s.id)
    );
    const resultingActiveOrEnded = [...resolvedItems, ...removedShares, ...unchangedShares].filter(
      s => String(s.status || "").toLowerCase() !== "cancelled"
    );

    // Pairwise overlap & pointwise 100% pool checks
    for (let i = 0; i < resultingActiveOrEnded.length; i++) {
      const a = resultingActiveOrEnded[i];
      const aStart = String(a.effective_start_date || "1900-01-01").slice(0, 10);
      const aEnd = String(a.effective_end_date || "9999-12-31").slice(0, 10);

      for (let j = i + 1; j < resultingActiveOrEnded.length; j++) {
        const b = resultingActiveOrEnded[j];
        if (
          String(a.recipient_investor_id || "").toLowerCase() === String(b.recipient_investor_id || "").toLowerCase() &&
          String(a.source_account_id || "") === String(b.source_account_id || "")
        ) {
          const bStart = String(b.effective_start_date || "1900-01-01").slice(0, 10);
          const bEnd = String(b.effective_end_date || "9999-12-31").slice(0, 10);
          if (aStart <= bEnd && bStart <= aEnd) {
            return res.status(409).json({
              error: `OVERLAPPING_COMMISSION_SHARE: Overlapping rules for recipient ${a.recipient_investor_id}.`,
              code: "OVERLAPPING_COMMISSION_SHARE"
            });
          }
        }
      }

      const poolAtPoint = resultingActiveOrEnded
        .filter(s => {
          if (String(s.source_account_id || "") !== String(a.source_account_id || "")) return false;
          const sStart = String(s.effective_start_date || "1900-01-01").slice(0, 10);
          const sEnd = String(s.effective_end_date || "9999-12-31").slice(0, 10);
          return sStart <= aStart && aStart <= sEnd;
        })
        .reduce((sum, s) => sum + Number(s.commission_percent || 0), 0);

      if (invSplit + poolAtPoint > 100.01) {
        return res.status(400).json({
          error: `Total commission allocation on ${aStart} is ${(invSplit + poolAtPoint).toFixed(2)}% (split ${invSplit}% + shares ${poolAtPoint.toFixed(2)}%), exceeding 100%.`
        });
      }
    }

    // Apply verified writes
    for (const item of resolvedItems) {
      if (item.id && existingMap.has(item.id)) {
        const { error: updErr } = await supabase
          .from("commission_shares")
          .update({
            recipient_investor_id: item.recipient_investor_id,
            commission_percent: item.commission_percent,
            effective_start_date: item.effective_start_date,
            effective_end_date: item.effective_end_date,
            status: item.status,
            updated_at: new Date()
          })
          .eq("id", item.id);
        if (updErr) throw updErr;
      } else {
        const { error: insErr } = await supabase
          .from("commission_shares")
          .insert({
            source_investor_id: item.source_investor_id,
            source_account_id: item.source_account_id,
            recipient_investor_id: item.recipient_investor_id,
            commission_percent: item.commission_percent,
            effective_start_date: item.effective_start_date,
            effective_end_date: item.effective_end_date,
            status: item.status
          });
        if (insErr) throw insErr;
      }
    }

    // End (never cancel) any active shares omitted from payload
    for (const rem of removedShares) {
      const { error: endErr } = await supabase
        .from("commission_shares")
        .update({
          status: "ended",
          effective_end_date: nowIso,
          updated_at: new Date()
        })
        .eq("id", rem.id);
      if (endErr) throw endErr;
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("[Admin Bulk Commission Shares API]", error);
    res.status(500).json({ error: error.message || "Internal server error" });
  }
}
