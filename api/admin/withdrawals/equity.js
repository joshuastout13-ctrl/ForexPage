import { verifyAdminSession } from "../../../lib/adminAuth.js";
import { supabase as defaultSupabase } from "../../../lib/supabase.js";
import { calculateAvailableWithdrawalEquity } from "../../../lib/withdrawal-validation.js";
import { checkPeriodLock } from "../../../lib/period-lock-guard.js";

export default async function handler(req, res, deps = {}) {
  const session = verifyAdminSession(req);
  if (!session) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { investorId, accountId, effectiveDate, excludeWithdrawalId } = req.query;

    if (!investorId) {
      return res.status(400).json({ error: "investorId is required" });
    }

    const effDate = effectiveDate || new Date().toISOString().slice(0, 10);
    const db = deps.supabase !== undefined ? deps.supabase : defaultSupabase;
    const calcFn = deps.calculateAvailableWithdrawalEquity || calculateAvailableWithdrawalEquity;

    const [result, lockStatus] = await Promise.all([
      calcFn(investorId, effDate, {
        accountId: accountId || null,
        excludeWithdrawalId: excludeWithdrawalId || null
      }),
      checkPeriodLock(db, { effectiveDate: effDate }).catch(() => ({
        locked: false,
        year: null,
        monthNumber: null,
        reason: null
      }))
    ]);

    return res.status(200).json({
      ...result,
      periodLocked: Boolean(lockStatus?.locked),
      periodYear: lockStatus?.year || null,
      periodMonthNumber: lockStatus?.monthNumber || null,
      periodLockReason: lockStatus?.reason || null
    });
  } catch (error) {
    console.error("Error calculating withdrawal equity:", error);
    return res.status(400).json({ error: error.message });
  }
}
