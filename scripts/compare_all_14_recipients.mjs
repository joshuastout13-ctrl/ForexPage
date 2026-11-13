import { sql } from './inspect_internal_transfer_rpc.mjs';
import Decimal from 'decimal.js';

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

async function main() {
  console.log('=== COMPLETE COMPARISON OF ALL 14 RECIPIENTS ===\n');

  const recipientIds = [
    { id: 'inv_4d52f6a4', name: 'David Townley', username: 'dtownley' },
    { id: 'stout001',     name: 'Joshua Stout', username: 'jstout' },
    { id: 'inv_015f3774', name: 'Stone & Co Owners', username: 'stoneandco' },
    { id: 'inv_920b8af8', name: 'Ross Wamsley', username: 'rwamsley' },
    { id: 'inv_e1d4f2af', name: 'Josh Richards', username: 'jrichards' },
    { id: 'inv_d0f857c7', name: 'Jacob Wamsley', username: 'jwamsley' },
    { id: 'inv_df9fbf05', name: 'David Valdes', username: 'valdes' },
    { id: 'inv_d2ab6da4', name: 'Michael Beck', username: 'mbeck' },
    { id: 'inv_a79798ca', name: 'Ted Boardwalk', username: 'tboardwalk' },
    { id: 'inv_d3ec0cf8', name: 'Adam Richards', username: 'arichards' },
    { id: 'inv_57a1a49a', name: 'Bill and Mary Kimball', username: 'bkimball' },
    { id: 'inv_6a1b838a', name: 'Val Taylor', username: 'vtaylor' },
    { id: 'inv_a7e429ce', name: 'Jim Colby', username: 'jcolby' },
    { id: 'inv_141417dc', name: 'Nelson Guyer', username: 'nguyer' }
  ];

  const results = [];

  for (const r of recipientIds) {
    // Investor & account
    const invRes = await sql(`SELECT * FROM investors WHERE id = '${r.id}';`);
    const inv = invRes.data[0];
    const accRes = await sql(`SELECT * FROM investor_accounts WHERE investor_id = '${r.id}';`);
    const acc = accRes.data[0];

    // Commissions in M8 and M9
    const commM8Active = await sql(`
      SELECT count(*) as cnt, sum(amount) as total 
      FROM commission_earnings 
      WHERE recipient_id = '${r.id}' AND year = 2026 AND month_number = 8 AND (status = 'ACTIVE' OR status IS NULL);
    `);
    const commM8Superseded = await sql(`
      SELECT count(*) as cnt, sum(amount) as total 
      FROM commission_earnings 
      WHERE recipient_id = '${r.id}' AND year = 2026 AND month_number = 8 AND status = 'SUPERSEDED';
    `);
    const commM9Active = await sql(`
      SELECT count(*) as cnt, sum(amount) as total 
      FROM commission_earnings 
      WHERE recipient_id = '${r.id}' AND year = 2026 AND month_number = 9 AND (status = 'ACTIVE' OR status IS NULL);
    `);

    // History for M8, M9, M10
    const hist = await sql(`
      SELECT month_number, opening_balance, deposits, withdrawals, gross_return_pct, manual_gain_amount, ending_balance, locked, updated_at
      FROM investor_monthly_history
      WHERE investor_id = '${r.id}' AND year = 2026 AND month_number IN (8, 9, 10)
      ORDER BY month_number;
    `);

    const hMap = {};
    (hist.data || []).forEach(h => { hMap[h.month_number] = h; });

    const m8 = hMap[8];
    const m9 = hMap[9];
    const m10 = hMap[10];

    const augEnding = m8 ? Number(m8.ending_balance) : 0;
    const augComm = commM8Active.data[0]?.total ? Number(commM8Active.data[0].total) : 0;
    const augCommSuper = commM8Superseded.data[0]?.total ? Number(commM8Superseded.data[0].total) : 0;
    const septComm = commM9Active.data[0]?.total ? Number(commM9Active.data[0].total) : 0;

    const septDeps = m9 ? Number(m9.deposits) : 0;
    const septWds = m9 ? Number(m9.withdrawals) : 0;
    const actualSeptOpen = m9 ? Number(m9.opening_balance) : 0;
    const actualSeptGain = m9 ? (m9.manual_gain_amount !== null ? Number(m9.manual_gain_amount) : (actualSeptOpen + septDeps - septWds) * (Number(m9.gross_return_pct) / 100) * (Number(inv?.split_pct || 100) / 100)) : 0;
    const actualSeptEnd = m9 ? Number(m9.ending_balance) : 0;

    const actualOctOpen = m10 ? Number(m10.opening_balance) : 0;

    // Expected values
    const expectedSeptOpen = augEnding + augComm + septDeps - septWds; // Note: deps/wds are in sept
    // Wait: Expected Sept Opening strictly BEFORE sept deposits/withdrawals is: augEnding + augComm
    // Let's distinguish expectedSeptOpening (at start of Sept) vs adjusted base (opening + deps - wds)
    const expectedSeptOpening = augEnding + augComm;
    const openingDelta = actualSeptOpen - expectedSeptOpening;

    const splitPct = Number(inv?.split_pct || 100);
    const grossReturn = 3.07;
    const correctSeptGain = (expectedSeptOpening + septDeps - septWds) * (grossReturn / 100) * (splitPct / 100);
    const correctSeptEnd = (expectedSeptOpening + septDeps - septWds) + correctSeptGain;
    const correctOctOpen = correctSeptEnd + septComm;
    const finalCorrection = correctOctOpen - actualOctOpen;

    results.push({
      recipient_id: r.id,
      name: r.name,
      portal_username: r.username,
      account_id: acc?.id || null,
      account_name: acc?.name || null,
      is_commission: acc?.is_commission,
      split_pct: splitPct,
      active_row_count: Number(commM8Active.data[0]?.cnt || 0),
      superseded_row_count: Number(commM8Superseded.data[0]?.cnt || 0),
      aug_comm_earned: augComm,
      aug_ending_balance: augEnding,
      sept_cashflows: { deposits: septDeps, withdrawals: septWds },
      actual_sept_opening: actualSeptOpen,
      expected_sept_opening: expectedSeptOpening,
      opening_delta: openingDelta,
      comm_capitalized_into_sept: actualSeptOpen - augEnding,
      actual_sept_gain: actualSeptGain,
      correct_sept_gain: correctSeptGain,
      actual_sept_ending: actualSeptEnd,
      correct_sept_ending: correctSeptEnd,
      sept_ending_delta: correctSeptEnd - actualSeptEnd,
      sept_comm_earned: septComm,
      actual_oct_opening: actualOctOpen,
      correct_oct_opening: correctOctOpen,
      final_correction_required: finalCorrection,
      m9_updated_at: m9?.updated_at,
      classification: Math.abs(openingDelta) < 0.02 ? 'CORRECT' : (openingDelta < -0.02 ? 'UNDERSTATED' : 'OVERSTATED')
    });
  }

  console.log(JSON.stringify(results, null, 2));
}

main().catch(console.error);
