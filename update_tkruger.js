import { supabase } from "./lib/supabase.js";

async function run() {
  try {
    const { data, error } = await supabase
      .from('investor_accounts')
      .update({ starting_capital: 109851.86 })
      .eq('investor_id', 'inv_8cf28066');

    if (error) {
      console.error("Error updating:", error);
    } else {
      console.log("Successfully updated Tkruger starting capital to 109851.86");
    }
  } catch (err) {
    console.error(err);
  }
}
run();
