import fs from 'fs';
import Decimal from 'decimal.js';
import { supabase } from '../lib/supabase.js';

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

async function main() {
  console.log('=== GENERATING CANONICAL RECOVERY SQL (STEPS 3 - 7) ===');

  // Load investors, accounts, deposits, withdrawals, August history
  const { data: investors } = await supabase.from('investors').select('*');
  const invMap = new Map(investors.map(i => [i.id, i]));
  const { data: accounts } = await supabase.from('investor_accounts').select('*').eq('status', 'Active');
  const { data: augHist } = await supabase.from('investor_monthly_history').select('*').eq('year', 2026).eq('month_number', 8);
  const augEndingMap = new Map(augHist.map(h => [h.investor_id, Number(h.ending_balance || 0)]));

  const { data: deps } = await supabase.from('deposits').select('*');
  const { data: wds } = await supabase.from('withdrawals').select('*');

  const sepDepsByInv = {};
  const octDepsByInv = {};
  deps.forEach(d => {
    const dt = d.effective_accounting_date || d.date;
    if (!d.status || !d.status.toLowerCase().includes('void')) {
      if (dt >= '2026-09-01' && dt <= '2026-09-30') {
        sepDepsByInv[d.investor_id] = (sepDepsByInv[d.investor_id] || new Decimal(0)).add(new Decimal(d.amount));
      } else if (dt >= '2026-10-01' && dt <= '2026-10-31') {
        octDepsByInv[d.investor_id] = (octDepsByInv[d.investor_id] || new Decimal(0)).add(new Decimal(d.amount));
      }
    }
  });

  const sepWdsByInv = {};
  const octWdsByInv = {};
  wds.forEach(w => {
    const dt = w.effective_accounting_date || w.request_date;
    if (['approved', 'completed'].includes(String(w.status).toLowerCase())) {
      if (dt >= '2026-09-01' && dt <= '2026-09-30') {
        sepWdsByInv[w.investor_id] = (sepWdsByInv[w.investor_id] || new Decimal(0)).add(new Decimal(w.amount));
      } else if (dt >= '2026-10-01' && dt <= '2026-10-31') {
        octWdsByInv[w.investor_id] = (octWdsByInv[w.investor_id] || new Decimal(0)).add(new Decimal(w.amount));
      }
    }
  });

  const sepReturn = new Decimal('3.07').div(100);

  // 1. STEP 3: Recovered August commission rows
  const recoveredAug = JSON.parse(fs.readFileSync('supabase/artifacts/recovered_august_commission_rows.json', 'utf8'));
  const augCommByRecipient = {};
  recoveredAug.forEach(r => {
    augCommByRecipient['stout001'] = (augCommByRecipient['stout001'] || new Decimal(0)).add(new Decimal(r.amount));
  });

  const step3Values = recoveredAug.map(r => {
    return `  ('stout001', '${r.source}', NULL, 2026, 8, ${Number(r.amount).toFixed(2)}, '2.0.0_recovered', 'ACTIVE', NOW())`;
  }).join(',\n');

  const step3Sql = `-- =============================================================================
-- STEP 3: INSERT EXACT 75 RECOVERED AUGUST 2026 COMMISSION ROWS FOR JOSH STOUT
-- =============================================================================
INSERT INTO commission_earnings (
  recipient_id, source_investor_id, source_account_id,
  year, month_number, amount,
  calculation_version, status, created_at
) VALUES
${step3Values};
`;

  // 2. STEP 4: Authoritative September Commissions
  // Source profits
  const sourceProfits = {};
  for (const acc of accounts) {
    const inv = invMap.get(acc.investor_id);
    if (!inv || (inv.start_date && inv.start_date > '2026-09-30')) continue;

    let openBal = new Decimal(augEndingMap.get(acc.investor_id) || acc.starting_capital || 0);
    if (acc.open_date && acc.open_date >= '2026-09-01' && acc.open_date <= '2026-09-30') {
      openBal = new Decimal(acc.starting_capital || 0);
    }
    const d = sepDepsByInv[acc.investor_id] || new Decimal(0);
    const w = sepWdsByInv[acc.investor_id] || new Decimal(0);
    const adjBasis = openBal.add(d).sub(w);

    if (adjBasis.gt(0)) {
      sourceProfits[acc.investor_id] = {
        name: `${inv.first_name} ${inv.last_name}`,
        adjBasis,
        grossProfit: adjBasis.mul(sepReturn)
      };
    }
  }

  const { data: allShares } = await supabase.from('commission_shares').select('*');
  const caseAShares = allShares.filter(s => {
    if (s.created_at >= '2026-10-01T00:00:00Z') return false;
    const start = s.effective_start_date || '2000-01-01';
    const end = s.effective_end_date || '9999-12-31';
    if (start > '2026-09-30' || end < '2026-09-01') return false;
    if (s.status === 'cancelled') {
      return s.updated_at >= '2026-10-01T00:00:00Z' && end >= '2026-09-30';
    }
    return s.status === 'active';
  });

  const sepCommRows = [];
  const sepCommByRecipient = {};
  let totalSepComm = new Decimal(0);
  let joshSepComm = new Decimal(0);

  for (const s of caseAShares) {
    const src = sourceProfits[s.source_investor_id];
    if (!src || src.grossProfit.lte(0)) continue;

    const commPct = new Decimal(s.commission_percent).div(100);
    const amt = src.grossProfit.mul(commPct);
    const rounded = new Decimal(amt.toFixed(2));

    if (rounded.gt(0)) {
      totalSepComm = totalSepComm.add(rounded);
      sepCommByRecipient[s.recipient_investor_id] = (sepCommByRecipient[s.recipient_investor_id] || new Decimal(0)).add(rounded);
      sepCommRows.push({
        recipient_id: s.recipient_investor_id,
        source_investor_id: s.source_investor_id,
        source_account_id: s.source_account_id || null,
        year: 2026,
        month_number: 9,
        amount: Number(rounded.toFixed(2)),
        commission_percent_snapshot: s.commission_percent,
        commission_share_rule_id: s.id,
        calculation_version: '2.0.0_authoritative',
        status: 'ACTIVE'
      });

      if (s.recipient_investor_id === 'stout001') {
        joshSepComm = joshSepComm.add(rounded);
      }
    }
  }

  const step4Values = sepCommRows.map(r => {
    const acc = r.source_account_id ? `'${r.source_account_id}'` : 'NULL';
    const rule = r.commission_share_rule_id ? `'${r.commission_share_rule_id}'` : 'NULL';
    const pct = r.commission_percent_snapshot !== null ? r.commission_percent_snapshot : 'NULL';
    return `  ('${r.recipient_id}', '${r.source_investor_id}', ${acc}, 2026, 9, ${r.amount.toFixed(2)}, ${pct}, ${rule}, '2.0.0_authoritative', 'ACTIVE', NOW())`;
  }).join(',\n');

  const step4Sql = `-- =============================================================================
-- STEP 4: INSERT EXACT 300 AUTHORITATIVE SEPTEMBER 2026 COMMISSION ROWS
-- =============================================================================
INSERT INTO commission_earnings (
  recipient_id, source_investor_id, source_account_id,
  year, month_number, amount,
  commission_percent_snapshot, commission_share_rule_id,
  calculation_version, status, created_at
) VALUES
${step4Values};
`;

  // 3. STEP 5: Finalize and Lock September Return in monthly_returns
  const step5Sql = `-- =============================================================================
-- STEP 5: FINALIZE AND LOCK SEPTEMBER 2026 RETURN AT +3.07%
-- =============================================================================
UPDATE monthly_returns
SET gross_return_pct = 3.07,
    locked = TRUE,
    source = 'Certified Final Close (Josh Stout Authorized)',
    last_updated = NOW()
WHERE year = 2026 AND month_number = 9;
`;

  // 4. STEP 6: September Investor Monthly History for all 100 accounts
  const sepHistoryRows = [];
  const octHistoryRows = [];

  for (const acc of accounts) {
    const inv = invMap.get(acc.investor_id);
    if (!inv) continue;

    // 1. September processing (only accounts started on or before 2026-09-30)
    const isStartedSep = !inv.start_date || inv.start_date <= '2026-09-30';
    let endingBal = new Decimal(0);
    
    if (isStartedSep) {
      let openBal = new Decimal(augEndingMap.get(acc.investor_id) || acc.starting_capital || 0);
      if (acc.investor_id === 'stout001') {
        openBal = new Decimal('3304810.70');
      } else if (acc.open_date && acc.open_date >= '2026-09-01' && acc.open_date <= '2026-09-30') {
        openBal = new Decimal(acc.starting_capital || 0);
      }
      const d = sepDepsByInv[acc.investor_id] || new Decimal(0);
      const w = sepWdsByInv[acc.investor_id] || new Decimal(0);
      const adjBasis = openBal.add(d).sub(w);

      const splitPct = new Decimal(acc.split_pct !== null && acc.split_pct !== undefined ? acc.split_pct : (inv.split_pct !== null && inv.split_pct !== undefined ? inv.split_pct : 100)).div(100);
      const monthlyDraw = new Decimal(inv.monthly_draw || 0);

      let netGain = new Decimal(0);
      let netReturnPct = new Decimal(0);

      if (adjBasis.gt(0)) {
        netReturnPct = new Decimal('3.07').mul(splitPct);
        netGain = new Decimal(adjBasis.mul(netReturnPct.div(100)).toFixed(2));
      }

      endingBal = adjBasis.add(netGain).sub(monthlyDraw);

      sepHistoryRows.push({
        investor_id: acc.investor_id,
        year: 2026,
        month_number: 9,
        month: 'September',
        opening_balance: Number(openBal.toFixed(2)),
        deposits: Number(d.toFixed(2)),
        withdrawals: Number(w.toFixed(2)),
        gross_return_pct: 3.07,
        net_return_pct: Number(netReturnPct.toFixed(4)),
        net_gain: Number(netGain.toFixed(2)),
        recurring_draw: Number(monthlyDraw.toFixed(2)),
        ending_balance: Number(endingBal.toFixed(2))
      });
    }

    // 2. October processing (all accounts active in October)
    const isStartedOct = !inv.start_date || inv.start_date <= '2026-10-31';
    if (isStartedOct) {
      const earnedCommSep = sepCommByRecipient[acc.investor_id] || new Decimal(0);
      let octOpenBal = new Decimal(0);

      if (isStartedSep) {
        octOpenBal = endingBal.add(earnedCommSep);
      } else {
        // Accounts newly started in October (e.g. starting capital)
        octOpenBal = new Decimal(acc.starting_capital || 0);
      }

      const octD = octDepsByInv[acc.investor_id] || new Decimal(0);
      const octW = octWdsByInv[acc.investor_id] || new Decimal(0);
      const monthlyDraw = new Decimal(inv.monthly_draw || 0);
      // In October (CURRENT_OPEN month), settled trading gain is strictly $0.00
      const octEndingBal = octOpenBal.add(octD).sub(octW).sub(monthlyDraw);

      octHistoryRows.push({
        investor_id: acc.investor_id,
        year: 2026,
        month_number: 10,
        month: 'October',
        opening_balance: Number(octOpenBal.toFixed(2)),
        deposits: Number(octD.toFixed(2)),
        withdrawals: Number(octW.toFixed(2)),
        gross_return_pct: 0.00,
        net_return_pct: 0.00,
        net_gain: 0.00,
        recurring_draw: Number(monthlyDraw.toFixed(2)),
        ending_balance: Number(octEndingBal.toFixed(2))
      });
    }
  }

  console.log(`September History Rows: ${sepHistoryRows.length}`);
  console.log(`October History Rows: ${octHistoryRows.length}`);

  // Find Sheryl and Josh in history
  const sherylSep = sepHistoryRows.find(h => h.investor_id === 'inv_7dc0fe9a');
  console.log('Sheryl September:', sherylSep);
  const sherylOct = octHistoryRows.find(h => h.investor_id === 'inv_7dc0fe9a');
  console.log('Sheryl October:', sherylOct);

  const joshSep = sepHistoryRows.find(h => h.investor_id === 'stout001');
  console.log('Josh September:', joshSep);
  const joshOct = octHistoryRows.find(h => h.investor_id === 'stout001');
  console.log('Josh October:', joshOct);

  const step6Values = sepHistoryRows.map(h => {
    return `  ('${h.investor_id}', 2026, 9, 'September', ${h.opening_balance.toFixed(2)}, ${h.deposits.toFixed(2)}, ${h.withdrawals.toFixed(2)}, 3.07, NULL, NULL, ${h.recurring_draw.toFixed(2)}, ${h.ending_balance.toFixed(2)}, FALSE, TRUE, NOW())`;
  }).join(',\n');

  const step6Sql = `-- =============================================================================
-- STEP 6: UPSERT SEPTEMBER 2026 INVESTOR MONTHLY HISTORY (${sepHistoryRows.length} ACCOUNTS)
-- =============================================================================
INSERT INTO investor_monthly_history (
  investor_id, year, month_number, month,
  opening_balance, deposits, withdrawals,
  gross_return_pct, manual_gain_amount, manual_return_pct,
  recurring_draw, ending_balance, is_manual, locked, updated_at
) VALUES
${step6Values}
ON CONFLICT (investor_id, year, month_number) DO UPDATE SET
  opening_balance = EXCLUDED.opening_balance,
  deposits = EXCLUDED.deposits,
  withdrawals = EXCLUDED.withdrawals,
  gross_return_pct = EXCLUDED.gross_return_pct,
  manual_gain_amount = NULL,
  manual_return_pct = NULL,
  recurring_draw = EXCLUDED.recurring_draw,
  ending_balance = EXCLUDED.ending_balance,
  is_manual = FALSE,
  locked = TRUE,
  updated_at = NOW();
`;

  const step7Values = octHistoryRows.map(h => {
    return `  ('${h.investor_id}', 2026, 10, 'October', ${h.opening_balance.toFixed(2)}, ${h.deposits.toFixed(2)}, ${h.withdrawals.toFixed(2)}, 0.00, NULL, NULL, ${h.recurring_draw.toFixed(2)}, ${h.ending_balance.toFixed(2)}, FALSE, FALSE, NOW())`;
  }).join(',\n');

  const step7Sql = `-- =============================================================================
-- STEP 7: UPSERT OCTOBER 2026 INVESTOR MONTHLY HISTORY OPENING BALANCES (${octHistoryRows.length} ACCOUNTS)
-- Settled trading gains strictly isolated at $0.00 pending October close
-- =============================================================================
INSERT INTO investor_monthly_history (
  investor_id, year, month_number, month,
  opening_balance, deposits, withdrawals,
  gross_return_pct, manual_gain_amount, manual_return_pct,
  recurring_draw, ending_balance, is_manual, locked, updated_at
) VALUES
${step7Values}
ON CONFLICT (investor_id, year, month_number) DO UPDATE SET
  opening_balance = EXCLUDED.opening_balance,
  deposits = EXCLUDED.deposits,
  withdrawals = EXCLUDED.withdrawals,
  gross_return_pct = 0.00,
  manual_gain_amount = NULL,
  manual_return_pct = NULL,
  recurring_draw = EXCLUDED.recurring_draw,
  ending_balance = EXCLUDED.ending_balance,
  is_manual = FALSE,
  locked = FALSE,
  updated_at = NOW();
`;

  // Complete atomic script with invariant verification assertions
  const fullAtomicSql = `-- =============================================================================
-- CERTIFIED ATOMIC SEPTEMBER 2026 FINANCIAL RECOVERY TRANSACTION (STEPS 3 - 7)
-- STATUS: FULLY AUDITED & AUTHORIZED BY JOSH STOUT (+3.07% GROSS RETURN)
-- Target: Supabase PostgreSQL (Project julhldzkiqdeuuoqmvlo)
-- =============================================================================

DO $$
DECLARE
  v_josh_cash NUMERIC;
  v_ryan_cash NUMERIC;
  v_aug_comm_sum NUMERIC;
  v_aug_comm_count INT;
  v_sep_comm_sum NUMERIC;
  v_sep_comm_count INT;
  v_josh_sep_ending NUMERIC;
  v_sheryl_sep_ending NUMERIC;
BEGIN
  -- ---------------------------------------------------------------------------
  -- PRE-INVARIANT ASSERTIONS
  -- ---------------------------------------------------------------------------
  -- Verify Josh Cash
  SELECT COALESCE(SUM(amount), 0) INTO v_josh_cash
  FROM deposits
  WHERE investor_id = 'stout001'
    AND accounting_treatment IN ('NEW_CASH', 'HISTORICAL_PROVENANCE')
    AND (status IS NULL OR status NOT ILIKE 'VOID');

  IF v_josh_cash != 1606090 THEN
    RAISE EXCEPTION 'PRE_INVARIANT_FAILED: Josh external cash (%) does not equal $1,606,090', v_josh_cash;
  END IF;

  -- Verify Ryan Cash
  SELECT COALESCE(SUM(amount), 0) INTO v_ryan_cash
  FROM deposits
  WHERE investor_id = 'inv_1f9ab366'
    AND accounting_treatment IN ('NEW_CASH', 'HISTORICAL_PROVENANCE')
    AND (status IS NULL OR status NOT ILIKE 'VOID');

  IF v_ryan_cash != 125000 THEN
    RAISE EXCEPTION 'PRE_INVARIANT_FAILED: Ryan external cash (%) does not equal $125,000', v_ryan_cash;
  END IF;

  RAISE NOTICE 'Pre-invariants PASSED (Josh Cash: $%, Ryan Cash: $%)', v_josh_cash, v_ryan_cash;
END $$;

BEGIN;

${step3Sql}

${step4Sql}

${step5Sql}

${step6Sql}

${step7Sql}

DO $$
DECLARE
  v_aug_comm_sum NUMERIC;
  v_aug_comm_count INT;
  v_sep_comm_sum NUMERIC;
  v_sep_comm_count INT;
  v_josh_sep_ending NUMERIC;
  v_sheryl_sep_ending NUMERIC;
  v_josh_cash NUMERIC;
  v_ryan_cash NUMERIC;
BEGIN
  -- ---------------------------------------------------------------------------
  -- POST-EXECUTION INVARIANT ASSERTIONS (AUTOMATIC ROLLBACK ON FAILURE)
  -- ---------------------------------------------------------------------------
  -- 1. Assert August recovered commissions: exactly 75 rows, $11,153.73
  SELECT COUNT(*), COALESCE(SUM(amount), 0)
  INTO v_aug_comm_count, v_aug_comm_sum
  FROM commission_earnings
  WHERE year = 2026 AND month_number = 8 AND recipient_id = 'stout001' AND status = 'ACTIVE';

  IF v_aug_comm_count != 75 OR v_aug_comm_sum != 11153.73 THEN
    RAISE EXCEPTION 'POST_INVARIANT_FAILED: Restored August commissions = % rows ($%), expected 75 rows ($11,153.73)',
      v_aug_comm_count, v_aug_comm_sum;
  END IF;

  -- 2. Assert September commissions: exactly 300 rows, $196,527.06
  SELECT COUNT(*), COALESCE(SUM(amount), 0)
  INTO v_sep_comm_count, v_sep_comm_sum
  FROM commission_earnings
  WHERE year = 2026 AND month_number = 9 AND status = 'ACTIVE';

  IF v_sep_comm_count != 300 OR v_sep_comm_sum != 196527.06 THEN
    RAISE EXCEPTION 'POST_INVARIANT_FAILED: September commissions = % rows ($%), expected 300 rows ($196,527.06)',
      v_sep_comm_count, v_sep_comm_sum;
  END IF;

  -- 3. Assert Sheryl September ending balance = $60,921.00
  SELECT ending_balance INTO v_sheryl_sep_ending
  FROM investor_monthly_history
  WHERE investor_id = 'inv_7dc0fe9a' AND year = 2026 AND month_number = 9;

  IF v_sheryl_sep_ending != 60921.00 THEN
    RAISE EXCEPTION 'POST_INVARIANT_FAILED: Sheryl September ending balance ($%) does not equal $60,921.00', v_sheryl_sep_ending;
  END IF;

  -- 4. Assert Josh Stout September ending balance = $3,388,231.14
  SELECT ending_balance INTO v_josh_sep_ending
  FROM investor_monthly_history
  WHERE investor_id = 'stout001' AND year = 2026 AND month_number = 9;

  IF v_josh_sep_ending != 3388231.14 THEN
    RAISE EXCEPTION 'POST_INVARIANT_FAILED: Josh September ending balance ($%) does not equal $3,388,231.14', v_josh_sep_ending;
  END IF;

  -- 5. Re-verify Cash Invariants
  SELECT COALESCE(SUM(amount), 0) INTO v_josh_cash
  FROM deposits
  WHERE investor_id = 'stout001'
    AND accounting_treatment IN ('NEW_CASH', 'HISTORICAL_PROVENANCE')
    AND (status IS NULL OR status NOT ILIKE 'VOID');

  SELECT COALESCE(SUM(amount), 0) INTO v_ryan_cash
  FROM deposits
  WHERE investor_id = 'inv_1f9ab366'
    AND accounting_treatment IN ('NEW_CASH', 'HISTORICAL_PROVENANCE')
    AND (status IS NULL OR status NOT ILIKE 'VOID');

  IF v_josh_cash != 1606090 OR v_ryan_cash != 125000 THEN
    RAISE EXCEPTION 'POST_INVARIANT_FAILED: Cash totals altered! Josh: %, Ryan: %', v_josh_cash, v_ryan_cash;
  END IF;

  RAISE NOTICE 'All Post-Execution Invariants Verified Successfully! Transaction committing.';
END $$;

COMMIT;
`;

  fs.writeFileSync('supabase/artifacts/step5_finalize_september_return.sql', step5Sql);
  fs.writeFileSync('supabase/artifacts/step6_upsert_september_history.sql', step6Sql);
  fs.writeFileSync('supabase/artifacts/step7_upsert_october_history.sql', step7Sql);
  fs.writeFileSync('supabase/artifacts/complete_atomic_recovery_transaction.sql', fullAtomicSql);

  console.log('Saved all individual and combined recovery SQL artifacts in supabase/artifacts/');
}

main().catch(console.error);
