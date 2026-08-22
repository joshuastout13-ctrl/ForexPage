import { calculateAvailableWithdrawalEquity } from "../../../lib/withdrawal-validation.js";

export default async function handler(req, res) {
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

    const result = await calculateAvailableWithdrawalEquity(investorId, effDate, {
      accountId: accountId || null,
      excludeWithdrawalId: excludeWithdrawalId || null
    });

    return res.status(200).json(result);
  } catch (error) {
    console.error("Error calculating withdrawal equity:", error);
    return res.status(400).json({ error: error.message });
  }
}
