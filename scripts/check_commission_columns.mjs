import { supabase } from '../lib/supabase.js';

async function run() {
  const { data: eRow } = await supabase.from('commission_earnings').select('*').limit(1);
  console.log('commission_earnings sample columns:', Object.keys(eRow?.[0] || {}));

  const { data: sRow } = await supabase.from('commission_shares').select('*').limit(1);
  console.log('commission_shares sample columns:', Object.keys(sRow?.[0] || {}));

  const { data: rRow } = await supabase.from('commission_rules').select('*').limit(1);
  console.log('commission_rules sample columns:', Object.keys(rRow?.[0] || {}));
}

run().catch(console.error);
