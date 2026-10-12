import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { supabase, isAuthoritativeProductionDbConfigured } from '../lib/supabase.js';
import { sql } from './inspect_internal_transfer_rpc.mjs';
import { buildInvestorDashboard } from '../lib/dashboard.js';
import Decimal from 'decimal.js';

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });
process.env.DATA_SOURCE = 'supabase';

const BATCH_ID = 'JOSH_AUTHORIZED_2026_10_BATCH_8_TRANSACTIONS';

export function getProductionExecutionSql() {
  return `
  DO $$
  DECLARE
    v_bholly_oct_dep_sum numeric;
    v_sep_return_pct numeric;
    v_sep_locked boolean;
    v_dep_inserted_count int := 0;
    v_wd_inserted_count int := 0;
    v_hist_updated_count int := 0;
  BEGIN
    -- 1. Acquire transaction-level advisory lock
    PERFORM pg_advisory_xact_lock(hashtext('${BATCH_ID}'));

    -- 2. Safety Precondition: Verify September 2026 return remains +3.07% and locked
    SELECT gross_return_pct, locked INTO v_sep_return_pct, v_sep_locked
    FROM monthly_returns
    WHERE year = 2026 AND month_number = 9;

    IF v_sep_return_pct <> 3.07 OR v_sep_locked <> true THEN
      RAISE EXCEPTION 'PRECONDITION FAILED: September return is % locked=%, expected 3.07%% locked=true', v_sep_return_pct, v_sep_locked;
    END IF;

    -- 3. Safety Precondition: Verify Brad Holly deposit is already recognized ($278,000 total)
    SELECT COALESCE(SUM(amount), 0) INTO v_bholly_oct_dep_sum
    FROM deposits
    WHERE investor_id = 'inv_5deeea21'
      AND effective_accounting_date = '2026-10-01'
      AND status = 'confirmed';

    IF v_bholly_oct_dep_sum <> 278000.00 THEN
      RAISE EXCEPTION 'PRECONDITION FAILED: Brad Holly October deposits sum to %, expected 278000.00', v_bholly_oct_dep_sum;
    END IF;

    -- =========================================================================
    -- OCTOBER 2026 TRANSACTIONS
    -- =========================================================================

    -- [1. Brad Holly]: ALREADY APPLIED ON OCT 09 -> SKIP INSERTION

    -- [2. Steve Kimball]: WITHDRAWAL $6,000.00
    IF NOT EXISTS (SELECT 1 FROM withdrawals WHERE idempotency_key = 'JOSH_AUTH_2026_10_BATCH_skimbell_wd_6000') THEN
      INSERT INTO withdrawals (
        id, investor_id, account_id, amount, request_date, effective_accounting_date,
        year, month_number, month, status, notes, idempotency_key, created_by
      ) VALUES (
        'wd_josh_auth_skimbell_6000', 'inv_16a045fa', 'skimbell', 6000.00, '2026-10-01', '2026-10-01',
        2026, 10, 'October', 'Completed',
        'Josh authorized October 1, 2026 cashflow batch (spreadsheet reconciliation)',
        'JOSH_AUTH_2026_10_BATCH_skimbell_wd_6000', 'Josh Stout (Authorized via User Request Oct 2026)'
      );
      v_wd_inserted_count := v_wd_inserted_count + 1;

      -- Update October monthly history
      UPDATE investor_monthly_history
      SET withdrawals = 6000.00,
          ending_balance = opening_balance - 6000.00,
          updated_at = NOW()
      WHERE investor_id = 'inv_16a045fa' AND year = 2026 AND month_number = 10;
      v_hist_updated_count := v_hist_updated_count + 1;

      -- Update November and December projection baselines
      UPDATE investor_monthly_history
      SET opening_balance = 76556.98898222776,
          ending_balance = 76556.98898222776,
          updated_at = NOW()
      WHERE investor_id = 'inv_16a045fa' AND year = 2026 AND month_number IN (11, 12);
    END IF;

    -- [3. Dale Waite]: DEPOSIT $6,500.00
    IF NOT EXISTS (SELECT 1 FROM deposits WHERE idempotency_key = 'JOSH_AUTH_2026_10_BATCH_dwaite_dep_6500') THEN
      INSERT INTO deposits (
        id, investor_id, account_id, date, effective_accounting_date, amount,
        accounting_treatment, status, type, notes, idempotency_key, created_by
      ) VALUES (
        'dep_josh_auth_dwaite_6500', 'inv_60ed0c32', 'dwaite', '2026-10-01', '2026-10-01', 6500.00,
        'NEW_CASH', 'confirmed', 'Wire',
        'Josh authorized October 1, 2026 cashflow batch (spreadsheet reconciliation)',
        'JOSH_AUTH_2026_10_BATCH_dwaite_dep_6500', 'Josh Stout (Authorized via User Request Oct 2026)'
      );
      v_dep_inserted_count := v_dep_inserted_count + 1;

      -- Update October monthly history
      UPDATE investor_monthly_history
      SET deposits = 6500.00,
          ending_balance = opening_balance + 6500.00,
          updated_at = NOW()
      WHERE investor_id = 'inv_60ed0c32' AND year = 2026 AND month_number = 10;
      v_hist_updated_count := v_hist_updated_count + 1;

      -- Update November and December projection baselines
      UPDATE investor_monthly_history
      SET opening_balance = 244700.1501530554,
          ending_balance = 244700.1501530554,
          updated_at = NOW()
      WHERE investor_id = 'inv_60ed0c32' AND year = 2026 AND month_number IN (11, 12);
    END IF;

    -- [4. Josh Stout]: WITHDRAWAL $20,000.00
    IF NOT EXISTS (SELECT 1 FROM withdrawals WHERE idempotency_key = 'JOSH_AUTH_2026_10_BATCH_stout001_wd_20000') THEN
      INSERT INTO withdrawals (
        id, investor_id, account_id, amount, request_date, effective_accounting_date,
        year, month_number, month, status, notes, idempotency_key, created_by
      ) VALUES (
        'wd_josh_auth_stout001_20000', 'stout001', 'stout001', 20000.00, '2026-10-01', '2026-10-01',
        2026, 10, 'October', 'Completed',
        'Josh authorized October 1, 2026 withdrawal batch (spreadsheet reconciliation)',
        'JOSH_AUTH_2026_10_BATCH_stout001_wd_20000', 'Josh Stout (Authorized via User Request Oct 2026)'
      );
      v_wd_inserted_count := v_wd_inserted_count + 1;

      -- Update October monthly history
      UPDATE investor_monthly_history
      SET withdrawals = 20000.00,
          ending_balance = opening_balance + deposits - 20000.00,
          updated_at = NOW()
      WHERE investor_id = 'stout001' AND year = 2026 AND month_number = 10;
      v_hist_updated_count := v_hist_updated_count + 1;

      -- Update November and December projection baselines
      UPDATE investor_monthly_history
      SET opening_balance = opening_balance - 20000.00,
          ending_balance = ending_balance - 20000.00,
          updated_at = NOW()
      WHERE investor_id = 'stout001' AND year = 2026 AND month_number IN (11, 12);
    END IF;

    -- [5. Glenn Maddocks]: DEPOSIT $568,277.00
    IF NOT EXISTS (SELECT 1 FROM deposits WHERE idempotency_key = 'JOSH_AUTH_2026_10_BATCH_gmaddocks_dep_568277') THEN
      INSERT INTO deposits (
        id, investor_id, account_id, date, effective_accounting_date, amount,
        accounting_treatment, status, type, notes, idempotency_key, created_by
      ) VALUES (
        'dep_josh_auth_gmaddocks_568277', 'inv_5a509c6a', 'inv_5a509c6a', '2026-10-01', '2026-10-01', 568277.00,
        'NEW_CASH', 'confirmed', 'Wire',
        'Josh authorized October 1, 2026 cashflow batch (spreadsheet reconciliation)',
        'JOSH_AUTH_2026_10_BATCH_gmaddocks_dep_568277', 'Josh Stout (Authorized via User Request Oct 2026)'
      );
      v_dep_inserted_count := v_dep_inserted_count + 1;

      -- Update October monthly history
      UPDATE investor_monthly_history
      SET deposits = 568277.00,
          ending_balance = opening_balance + 568277.00,
          updated_at = NOW()
      WHERE investor_id = 'inv_5a509c6a' AND year = 2026 AND month_number = 10;
      v_hist_updated_count := v_hist_updated_count + 1;

      -- Update November and December projection baselines
      UPDATE investor_monthly_history
      SET opening_balance = 718680.5047009998,
          ending_balance = 718680.5047009998,
          updated_at = NOW()
      WHERE investor_id = 'inv_5a509c6a' AND year = 2026 AND month_number IN (11, 12);
    END IF;

    -- =========================================================================
    -- SEPTEMBER 2026 LOCKED HISTORICAL OVERRIDES
    -- =========================================================================

    -- [6. Josh Oviatt]: WITHDRAWAL $795.00
    IF NOT EXISTS (SELECT 1 FROM withdrawals WHERE idempotency_key = 'JOSH_AUTH_2026_10_BATCH_joviatt_wd_795') THEN
      INSERT INTO withdrawals (
        id, investor_id, account_id, amount, request_date, effective_accounting_date,
        year, month_number, month, status, notes, idempotency_key, created_by
      ) VALUES (
        'wd_josh_auth_joviatt_795', 'inv_ce0675be', 'joviatt', 795.00, '2026-09-01', '2026-09-01',
        2026, 9, 'September', 'Completed',
        'Josh authorized September 1, 2026 historical withdrawal correction (spreadsheet reconciliation)',
        'JOSH_AUTH_2026_10_BATCH_joviatt_wd_795', 'Josh Stout (Authorized via User Request Oct 2026)'
      );
      v_wd_inserted_count := v_wd_inserted_count + 1;

      -- September locked historical override
      UPDATE investor_monthly_history
      SET withdrawals = 795.00,
          ending_balance = 52578.6801393919,
          locked = true,
          updated_at = NOW()
      WHERE investor_id = 'inv_ce0675be' AND year = 2026 AND month_number = 9;
      v_hist_updated_count := v_hist_updated_count + 1;

      -- Carry forward into October, November, December
      UPDATE investor_monthly_history
      SET opening_balance = 52578.6801393919,
          ending_balance = 52578.6801393919,
          updated_at = NOW()
      WHERE investor_id = 'inv_ce0675be' AND year = 2026 AND month_number IN (10, 11, 12);
    END IF;

    -- [7. Whit Miller]: WITHDRAWAL $700.00
    IF NOT EXISTS (SELECT 1 FROM withdrawals WHERE idempotency_key = 'JOSH_AUTH_2026_10_BATCH_wmiller_wd_700') THEN
      INSERT INTO withdrawals (
        id, investor_id, account_id, amount, request_date, effective_accounting_date,
        year, month_number, month, status, notes, idempotency_key, created_by
      ) VALUES (
        'wd_josh_auth_wmiller_700', 'inv_ea8b4eba', 'wmiller', 700.00, '2026-09-01', '2026-09-01',
        2026, 9, 'September', 'Completed',
        'Josh authorized September 1, 2026 historical withdrawal correction (spreadsheet reconciliation)',
        'JOSH_AUTH_2026_10_BATCH_wmiller_wd_700', 'Josh Stout (Authorized via User Request Oct 2026)'
      );
      v_wd_inserted_count := v_wd_inserted_count + 1;

      -- September locked historical override
      UPDATE investor_monthly_history
      SET withdrawals = 700.00,
          ending_balance = 118957.0466621119,
          locked = true,
          updated_at = NOW()
      WHERE investor_id = 'inv_ea8b4eba' AND year = 2026 AND month_number = 9;
      v_hist_updated_count := v_hist_updated_count + 1;

      -- Carry forward into October, November, December
      UPDATE investor_monthly_history
      SET opening_balance = 118957.0466621119,
          ending_balance = 118957.0466621119,
          updated_at = NOW()
      WHERE investor_id = 'inv_ea8b4eba' AND year = 2026 AND month_number IN (10, 11, 12);
    END IF;

    -- [8. Jean Harder]: WITHDRAWAL $1,500.00
    IF NOT EXISTS (SELECT 1 FROM withdrawals WHERE idempotency_key = 'JOSH_AUTH_2026_10_BATCH_jharder_wd_1500') THEN
      INSERT INTO withdrawals (
        id, investor_id, account_id, amount, request_date, effective_accounting_date,
        year, month_number, month, status, notes, idempotency_key, created_by
      ) VALUES (
        'wd_josh_auth_jharder_1500', 'inv_bc1bcb0c', 'jharder', 1500.00, '2026-09-01', '2026-09-01',
        2026, 9, 'September', 'Completed',
        'Josh authorized September 1, 2026 historical withdrawal correction (spreadsheet reconciliation)',
        'JOSH_AUTH_2026_10_BATCH_jharder_wd_1500', 'Josh Stout (Authorized via User Request Oct 2026)'
      );
      v_wd_inserted_count := v_wd_inserted_count + 1;

      -- September locked historical override
      UPDATE investor_monthly_history
      SET withdrawals = 1500.00,
          ending_balance = 115603.2810342445,
          locked = true,
          updated_at = NOW()
      WHERE investor_id = 'inv_bc1bcb0c' AND year = 2026 AND month_number = 9;
      v_hist_updated_count := v_hist_updated_count + 1;

      -- Carry forward into October, November, December
      UPDATE investor_monthly_history
      SET opening_balance = 115603.2810342445,
          ending_balance = 115603.2810342445,
          updated_at = NOW()
      WHERE investor_id = 'inv_bc1bcb0c' AND year = 2026 AND month_number IN (10, 11, 12);
    END IF;

    -- 4. Durable Audit Log
    INSERT INTO audit_runs (
      admin_id, source_investor_id, year, month_number, report_json
    ) VALUES (
      'Josh Stout (Authorized via User Request Oct 2026)',
      NULL,
      2026,
      10,
      jsonb_build_object(
        'batch_id', '${BATCH_ID}',
        'timestamp', NOW(),
        'deposits_inserted', v_dep_inserted_count,
        'withdrawals_inserted', v_wd_inserted_count,
        'history_rows_updated', v_hist_updated_count,
        'bholly_skipped_reason', 'ALREADY_APPLIED_OCT_09'
      )
    );

    -- 5. Final Assertions (Atomic roll-back if initial insertion did not complete exactly)
    IF v_dep_inserted_count <> 2 OR v_wd_inserted_count <> 5 OR v_hist_updated_count <> 7 THEN
      RAISE EXCEPTION 'INSERTION COUNT ASSERTION FAILED: expected deps=2 wds=5 hist=7, got deps=% wds=% hist=%',
        v_dep_inserted_count, v_wd_inserted_count, v_hist_updated_count;
    END IF;
  END $$;
  `;
}

async function main() {
  console.log('================================================================================');
  console.log('EXECUTE AUTHORIZED 4XTRACK TRANSACTION BATCH (OCTOBER + SEPTEMBER)');
  console.log('Authoritative Supabase Project: julhldzkiqdeuuoqmvlo');
  console.log('Batch Identity: ' + BATCH_ID);
  console.log('Execution Timestamp: ' + new Date().toISOString());
  console.log('================================================================================\n');

  // 1. Preflight Safety Check
  if (!isAuthoritativeProductionDbConfigured()) {
    throw new Error('FATAL: Not connected to authoritative production Supabase project (julhldzkiqdeuuoqmvlo)');
  }
  console.log('✓ Authoritative production Supabase connection verified.');

  // 2. Pre-mutation Dashboard & Balance Baselines
  console.log('\n--- CAPTURING PRE-MUTATION BASELINES ---');
  const portals = ['bholly', 'skimbell', 'dwaite', 'jstout', 'gmaddocks', 'joviatt', 'wmiller', 'jharder'];
  const beforeBalances = {};
  for (const portal of portals) {
    const dash = await buildInvestorDashboard(portal, null, { mustBeAuthoritative: true });
    beforeBalances[portal] = dash.summary.currentBalance;
    console.log(`  ${portal.padEnd(12)}: $${dash.summary.currentBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  }

  // Global Controls Pre-check
  const joshDashPre = await buildInvestorDashboard('jstout', null, { mustBeAuthoritative: true });
  const tedDashPre = await buildInvestorDashboard('tboardwalk', null, { mustBeAuthoritative: true });
  const davidDashPre = await buildInvestorDashboard('dtownley', null, { mustBeAuthoritative: true });
  const ringerDashPre = await buildInvestorDashboard('rringer', null, { mustBeAuthoritative: true });

  console.log('\n--- GLOBAL CONTROLS (BEFORE) ---');
  console.log(`  Josh Stout Settled:       $${joshDashPre.summary.currentBalance.toFixed(2)}`);
  console.log(`  Josh Stout Outside Cash:  $${joshDashPre.summary.totalExternalCashSent.toFixed(2)}`);
  console.log(`  Ted Boardwalk Settled:    $${tedDashPre.summary.currentBalance.toFixed(2)}`);
  console.log(`  David Townley Settled:    $${davidDashPre.summary.currentBalance.toFixed(2)}`);
  console.log(`  Ryan Ringer Outside Cash: $${ringerDashPre.summary.totalExternalCashSent.toFixed(2)}`);

  // 3. Execute Atomic PostgreSQL Transaction
  console.log('\n--- EXECUTING ATOMIC POSTGRESQL MUTATION TRANSACTION ---');
  const sqlPayload = getProductionExecutionSql();
  const res = await sql(sqlPayload);

  console.log('Mutation Response Status:', res.status);
  console.log('Mutation Response Data:', JSON.stringify(res.data, null, 2));

  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`MUTATION TRANSACTION FAILED: ${JSON.stringify(res)}`);
  }
  console.log('✅ ATOMIC POSTGRESQL TRANSACTION COMMITTED SUCCESSFULLY!\n');

  // 4. Post-mutation Dashboard & Balance Verification
  console.log('--- CAPTURING POST-MUTATION DASHBOARDS ---');
  const afterBalances = {};
  for (const portal of portals) {
    const dash = await buildInvestorDashboard(portal, null, { mustBeAuthoritative: true });
    afterBalances[portal] = dash.summary.currentBalance;
    const diff = dash.summary.currentBalance - beforeBalances[portal];
    console.log(`  ${portal.padEnd(12)}: BEFORE=$${beforeBalances[portal].toLocaleString('en-US', { minimumFractionDigits: 2 })} | AFTER=$${dash.summary.currentBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })} | DIFF=${diff >= 0 ? '+' : ''}$${diff.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  }

  // 5. Global Controls Post-check
  const joshDashPost = await buildInvestorDashboard('jstout', null, { mustBeAuthoritative: true });
  const tedDashPost = await buildInvestorDashboard('tboardwalk', null, { mustBeAuthoritative: true });
  const davidDashPost = await buildInvestorDashboard('dtownley', null, { mustBeAuthoritative: true });
  const ringerDashPost = await buildInvestorDashboard('rringer', null, { mustBeAuthoritative: true });

  console.log('\n--- GLOBAL CONTROLS (AFTER) ---');
  console.log(`  Josh Stout Settled:       $${joshDashPost.summary.currentBalance.toFixed(2)} (diff: -$${(joshDashPre.summary.currentBalance - joshDashPost.summary.currentBalance).toFixed(2)})`);
  console.log(`  Josh Stout Outside Cash:  $${joshDashPost.summary.totalExternalCashSent.toFixed(2)}`);
  console.log(`  Ted Boardwalk Settled:    $${tedDashPost.summary.currentBalance.toFixed(2)}`);
  console.log(`  David Townley Settled:    $${davidDashPost.summary.currentBalance.toFixed(2)}`);
  console.log(`  Ryan Ringer Outside Cash: $${ringerDashPost.summary.totalExternalCashSent.toFixed(2)}`);

  // Verify monthly_returns remains locked +3.07%
  const { data: sepRet } = await supabase.from('monthly_returns').select('*').eq('year', 2026).eq('month_number', 9).single();
  console.log(`\n✓ September Return in monthly_returns: ${sepRet.gross_return_pct}% locked=${sepRet.locked}`);
  if (Number(sepRet.gross_return_pct) !== 3.07 || sepRet.locked !== true) {
    throw new Error('CRITICAL INTEGRITY FAILURE: September monthly_returns was modified!');
  }
}

main().catch(console.error);
