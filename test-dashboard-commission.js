import { buildInvestorDashboard } from "./lib/dashboard.js";

async function test() {
  try {
    const data = await buildInvestorDashboard("inv_015f3774"); // A sample investor ID
    console.log("Summary:", data.summary.commissionsEarnedMonth);
    console.log("Breakdown:", data.commissionBreakdown);
  } catch (e) {
    console.error(e);
  }
}
test();
