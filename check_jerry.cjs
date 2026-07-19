require("dotenv").config({path: ".env.local"});
import("./lib/supabase.js").then(async m => {
  const { data } = await m.supabase.from("investor_monthly_history").select("*").eq("investor_id", "jerrys001").order("month_number", { ascending: true });
  for (const h of data) {
    if (h.month_number >= 5) {
      console.log(`Month ${h.month_number}: Open ${h.opening_balance.toFixed(2)}, Deps ${h.deposits}, Wds ${h.withdrawals}, End ${h.ending_balance.toFixed(2)}`);
    }
  }
});
