require("dotenv").config({path: ".env.local"});
import("./lib/supabase.js").then(async m => {
  const { data: history } = await m.supabase.from("investor_monthly_history").select("*").eq("year", 2026);
  const manuals = history.filter(h => h.is_manual);
  console.log("Manual count:", manuals.length);
  manuals.forEach(h => console.log(h.investor_id, h.month_number, "Gain:", h.manual_gain_amount, "Pct:", h.manual_return_pct));
  console.log("Done");
});
