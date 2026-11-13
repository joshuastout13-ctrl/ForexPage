process.env.DATA_SOURCE = 'supabase';
import { supabase } from '../lib/supabase.js';

async function main() {
  console.log('=== TASK 4: SPECIAL SCRUTINY INVESTIGATION ===\n');

  const targets = [
    { id: 'inv_015f3774', label: 'Stone & Co Owners' },
    { id: 'inv_920b8af8', label: 'Ross Wamsley' },
    { id: 'inv_e1d4f2af', label: 'Josh Richards' }
  ];

  for (const t of targets) {
    console.log(`\n======================================================`);
    console.log(`SCRUTINY TARGET: ${t.label} (${t.id})`);
    console.log(`======================================================`);

    // 1. Investor profile
    const { data: inv } = await supabase.from('investors').select('*').eq('id', t.id).single();
    console.log('Investor Profile:', {
      id: inv?.id,
      name: `${inv?.first_name} ${inv?.last_name}`,
      portal_username: inv?.portal_username,
      email: inv?.email,
      role: inv?.role,
      active: inv?.active,
      split_pct: inv?.split_pct,
      monthly_draw: inv?.monthly_draw,
      start_date: inv?.start_date,
      notes: inv?.notes
    });

    // 2. Accounts
    const { data: accs } = await supabase.from('investor_accounts').select('*').eq('investor_id', t.id);
    console.log('Accounts:', accs.map(a => ({
      id: a.id,
      name: a.name,
      is_commission: a.is_commission,
      status: a.status,
      starting_capital: a.starting_capital,
      total_cash_in: a.total_cash_in,
      split_pct: a.split_pct
    })));

    // 3. Commission shares targeting this recipient
    const { data: shares } = await supabase.from('commission_shares').select('*').eq('recipient_investor_id', t.id);
    console.log(`Total commission_shares targeting recipient: ${shares?.length || 0}`);
    const activeShares = (shares || []).filter(s => s.status === 'active');
    console.log(`Active commission_shares: ${activeShares.length}`);
    const sharePcts = [...new Set(activeShares.map(s => s.commission_percent))];
    console.log(`Commission percentages in active shares: ${sharePcts.join(', ')}%`);

    // 4. Commission earnings for August 2026
    const { data: ceAug } = await supabase
      .from('commission_earnings')
      .select('source_investor_id, amount, status, calculation_version, created_at')
      .eq('recipient_id', t.id)
      .eq('year', 2026)
      .eq('month_number', 8);

    const activeCeAug = (ceAug || []).filter(e => !e.status || e.status === 'ACTIVE');
    const totalAug = activeCeAug.reduce((sum, r) => sum + Number(r.amount), 0);
    console.log(`August commission_earnings: ${activeCeAug.length} rows, Total: $${totalAug.toFixed(2)}`);

    // Sample source breakdown
    const topSources = activeCeAug.sort((a, b) => Number(b.amount) - Number(a.amount)).slice(0, 5);
    console.log('Top 5 August sources:', topSources);

    // 5. Monthly History from May to October 2026
    const { data: hist } = await supabase
      .from('investor_monthly_history')
      .select('month_number, month, opening_balance, deposits, withdrawals, gross_return_pct, ending_balance')
      .eq('investor_id', t.id)
      .eq('year', 2026)
      .gte('month_number', 5)
      .lte('month_number', 10)
      .order('month_number');
    console.log('Monthly History (M5 to M10):', hist);
  }
}

main().catch(console.error);
