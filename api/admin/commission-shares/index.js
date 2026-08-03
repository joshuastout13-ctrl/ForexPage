import { verifyAdminSession } from "../../../lib/adminAuth.js";
import { supabase } from "../../../lib/supabase.js";

export default async function handler(req, res) {
  try {
    const session = verifyAdminSession(req);
    if (!session) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (req.method === "GET") {
      const [{ data: sharesData }, { data: rulesData }, { data: investorsData }] = await Promise.all([
        supabase.from("commission_shares").select("*"),
        supabase.from("commission_rules").select("*"),
        supabase.from("investors").select("id, portal_username, first_name, last_name, email")
      ]);

      const invMap = new Map((investorsData || []).map(i => [String(i.id).toLowerCase(), i]));
      
      const sourceInvsWithShares = new Set(
        (sharesData || []).map(s => {
          const src = invMap.get(String(s.source_investor_id || "").toLowerCase());
          return src ? (src.portal_username || src.id).toLowerCase() : String(s.source_investor_id).toLowerCase();
        })
      );

      const mappedShares = (sharesData || []).map(i => {
        const src = invMap.get(String(i.source_investor_id || "").toLowerCase());
        const rec = invMap.get(String(i.recipient_investor_id || "").toLowerCase());
        return {
          id: i.id,
          investor_id: src ? (src.portal_username || src.id) : i.source_investor_id,
          account_id: i.source_account_id || "All",
          recipient_id: i.recipient_investor_id,
          recipient_name: rec ? (rec.portal_username || rec.first_name || rec.id) : i.recipient_investor_id,
          percent: i.commission_percent,
          effective_start_date: i.effective_start_date,
          effective_end_date: i.effective_end_date,
          status: i.status || "active",
          notes: i.notes || ""
        };
      });

      const mappedRules = (rulesData || [])
        .filter(r => {
          const src = invMap.get(String(r.investor_id || r.source_investor_id || "").toLowerCase());
          const srcKey = src ? (src.portal_username || src.id).toLowerCase() : String(r.investor_id || r.source_investor_id).toLowerCase();
          return !sourceInvsWithShares.has(srcKey);
        })
        .map(r => {
          const src = invMap.get(String(r.investor_id || r.source_investor_id || "").toLowerCase());
          const rec = invMap.get(String(r.recipient_id || r.recipient_investor_id || "").toLowerCase());
          return {
            id: r.id,
            investor_id: src ? (src.portal_username || src.id) : (r.investor_id || r.source_investor_id),
            account_id: r.account_id || r.source_account_id || "All",
            recipient_id: r.recipient_id || r.recipient_investor_id,
            recipient_name: rec ? (rec.portal_username || rec.first_name || rec.id) : (r.recipient_id || r.recipient_investor_id),
            percent: r.percent || r.commission_percent,
            effective_start_date: null,
            effective_end_date: null,
            status: "active",
            notes: ""
          };
        });

      const combined = [...mappedShares, ...mappedRules];
      return res.status(200).json({ commission_shares: combined });
    }

    if (req.method === "POST") {
      const { 
        sourceInvestorId, 
        accountId, 
        recipientUsername, 
        commissionPercent, 
        effectiveStartDate,
        effectiveEndDate,
        status
      } = req.body;
      
      // We accept recipientUsername (email or username) from admin portal since it's easier to type, or we can use ID if provided.
      // Wait, in admin portal we defined recipientUsername but it can also be an ID. Let's find the user.
      if (!sourceInvestorId || !recipientUsername || !commissionPercent || !effectiveStartDate) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      // Find recipient by id, portal_username, or email
      let { data: recipient } = await supabase
        .from("investors")
        .select("id, portal_username")
        .eq("id", recipientUsername)
        .maybeSingle();

      if (!recipient) {
        const { data: recByUsername } = await supabase
          .from("investors")
          .select("id, portal_username")
          .ilike("portal_username", recipientUsername)
          .maybeSingle();
        recipient = recByUsername;
      }

      if (!recipient) {
        const { data: recByEmail } = await supabase
          .from("investors")
          .select("id, portal_username")
          .ilike("email", recipientUsername)
          .maybeSingle();
        recipient = recByEmail;
      }

      if (!recipient) {
        return res.status(404).json({ error: "Recipient investor not found" });
      }

      if (recipient.id.toLowerCase() === sourceInvestorId.toLowerCase()) {
        return res.status(400).json({ error: "Cannot share commission with yourself" });
      }

      // Look up source investor to get their split_pct
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

      // Validate total active percentage does not exceed available pool
      const { data: activeShares } = await supabase
        .from("commission_shares")
        .select("commission_percent, source_investor_id")
        .in("status", ["active", "pending"])
        .is("effective_end_date", null); 

      if (activeShares && activeShares.length > 0) {
        const matchingShares = activeShares.filter(s => {
          const sId = String(s.source_investor_id || '').toLowerCase();
          return sId === String(sourceInvestorId).toLowerCase() ||
            (sourceInv && sId === String(sourceInv.id).toLowerCase()) ||
            (sourceInv && sId === String(sourceInv.portal_username).toLowerCase());
        });
        const currentTotalAssigned = matchingShares.reduce((sum, s) => sum + Number(s.commission_percent || 0), 0);
        
        if (currentTotalAssigned + Number(commissionPercent) > maxPool + 0.01) {
          return res.status(400).json({ 
            error: `Total assigned commission (${(currentTotalAssigned + Number(commissionPercent)).toFixed(2)}%) exceeds available commission pool (${maxPool.toFixed(2)}%) for this investor.` 
          });
        }
      }

      const { data, error } = await supabase
        .from("commission_shares")
        .insert({
          source_investor_id: sourceInvestorId,
          source_account_id: accountId || null,
          recipient_investor_id: recipient.id,
          commission_percent: commissionPercent,
          effective_start_date: effectiveStartDate,
          effective_end_date: effectiveEndDate || null,
          status: status || "active"
        })
        .select()
        .single();

      if (error) throw error;
      return res.status(201).json({ share: data });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    console.error("[Admin Commission Shares API]", error);
    res.status(500).json({ error: error.message || "Internal server error" });
  }
}
