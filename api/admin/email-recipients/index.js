import { verifyAdminSession } from "../../../lib/adminAuth.js";
import { supabase } from "../../../lib/supabase.js";

export default async function handler(req, res) {
  const session = verifyAdminSession(req);
  if (!session) {
    return res.status(401).json({ error: "Unauthorized access" });
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    if (!supabase) {
      throw new Error("Supabase client not initialized on server");
    }

    // Fetch investors
    const { data: investors, error: invError } = await supabase
      .from("investors")
      .select("*")
      .order("first_name", { ascending: true });

    if (invError) throw invError;

    // Fetch investor accounts to associate account IDs with recipients
    const { data: accounts, error: accError } = await supabase
      .from("investor_accounts")
      .select("id, investor_id, name, status");

    if (accError) {
      console.warn("Could not fetch investor accounts:", accError.message);
    }

    const accountsMap = new Map();
    if (accounts) {
      accounts.forEach((acc) => {
        if (!accountsMap.has(acc.investor_id)) {
          accountsMap.set(acc.investor_id, []);
        }
        accountsMap.get(acc.investor_id).push({
          id: acc.id,
          name: acc.name || acc.id,
          status: acc.status
        });
      });
    }

    // Deduplicate recipients by email address
    const recipientMap = new Map();

    (investors || []).forEach((inv) => {
      const email = (inv.email || "").trim().toLowerCase();
      if (!email) return; // Skip investors with no email

      const invAccounts = accountsMap.get(inv.id) || [];
      const fullName = [inv.first_name, inv.last_name].filter(Boolean).join(" ") || inv.id;

      if (!recipientMap.has(email)) {
        recipientMap.set(email, {
          id: inv.id, // primary investor ID
          investorIds: [inv.id],
          firstName: inv.first_name || "",
          lastName: inv.last_name || "",
          name: fullName,
          email: email,
          portalUsername: inv.portal_username || inv.id,
          active: inv.active !== false,
          role: inv.role || "Investor",
          accounts: invAccounts
        });
      } else {
        // Merge duplicate email entries
        const existing = recipientMap.get(email);
        if (!existing.investorIds.includes(inv.id)) {
          existing.investorIds.push(inv.id);
        }
        invAccounts.forEach(acc => {
          if (!existing.accounts.some(a => a.id === acc.id)) {
            existing.accounts.push(acc);
          }
        });
      }
    });

    const recipients = Array.from(recipientMap.values());

    return res.status(200).json({
      success: true,
      count: recipients.length,
      recipients
    });
  } catch (err) {
    console.error("Error in /api/admin/email-recipients:", err);
    return res.status(500).json({ error: err.message || "Failed to fetch email recipients" });
  }
}
