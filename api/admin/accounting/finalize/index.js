import crypto from "node:crypto";
import Decimal from "decimal.js";
import { verifyAdminSession } from "../../../../lib/adminAuth.js";
import { supabase } from "../../../../lib/supabase.js";
import { calculateAccountingPeriod } from "../../../../lib/accounting-period-engine.js";
import { isDepositExcluded, isDrawFulfillmentWithdrawal } from "../../../../lib/accounting-engine.js";
import { loadAccountingData } from "../../../../lib/paginated-read.js";

export const ACCOUNTING_ENGINE_VERSION = "2.0.0";

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

function roundMoneyNum(val) {
  return new Decimal(val || 0).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
}

function formatMonthName(year, month) {
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en-US", {
    month: "long",
    timeZone: "UTC"
  });
}

function hasInvestorStartedByMonthEnd(startDate, year, month) {
  if (!startDate) return true;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const periodEndStr = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return String(startDate).slice(0, 10) <= periodEndStr;
}

function buildInvestorIdSet(inv, accounts) {
  const invId = String(inv.id || "").trim().toLowerCase();
  const username = String(inv.portal_username || inv.portalusername || inv.username || "").trim().toLowerCase();
  const invAccs = (accounts || []).filter(a => {
    const aInvId = String(a.investor_id || a.investorid || "").trim().toLowerCase();
    return aInvId === invId || (username && aInvId === username);
  });
  const idSet = new Set([invId, username, ...invAccs.map(a => String(a.id || "").trim().toLowerCase())].filter(Boolean));
  return { idSet, invAccs };
}

function getInvestorStartingCapital(invAccs) {
  if (!invAccs || invAccs.length === 0) return 0;
  return invAccs.reduce((sum, a) => {
    return sum + Number(a.starting_capital ?? a.startingcapital ?? a.capital ?? 0);
  }, 0);
}

function findHistoryRow(monthlyHistory, canonicalId, idSet, year, month) {
  const matches = (monthlyHistory || []).filter(h => {
    const hInv = String(h.investor_id || h.investorid || "").trim().toLowerCase();
    return idSet.has(hInv) && Number(h.year) === year && Number(h.month_number) === month;
  });
  if (matches.length === 0) return null;
  const exact = matches.find(h => String(h.investor_id).toLowerCase() === String(canonicalId).toLowerCase());
  return exact || matches[0];
}

function computePeriodCashflows(idSet, year, month, deposits, withdrawals) {
  let depsDec = new Decimal(0);
  let wdsDec = new Decimal(0);
  let drawFulfillmentDec = new Decimal(0);

  (deposits || []).forEach(d => {
    if (isDepositExcluded(d)) return;
    const treatment = String(d.accounting_treatment || "NEW_CASH").trim().toUpperCase();
    if (treatment === "HISTORICAL_PROVENANCE") return;
    if (d.is_commission === true || String(d.is_commission).toLowerCase() === "true") return;

    const effDateStr = d.effective_accounting_date || d.effective_date;
    const dDateStr = String(effDateStr || d.date || d.created_at || "").slice(0, 10);
    if (!dDateStr) return;

    const dt = new Date(dDateStr);
    if (dt.getUTCFullYear() !== year || (dt.getUTCMonth() + 1) !== month) return;

    const depInv = String(d.investor_id || d.investorid || d.id || "").trim().toLowerCase();
    if (idSet.has(depInv)) {
      depsDec = depsDec.add(new Decimal(d.amount || 0));
    }
  });

  (withdrawals || []).forEach(w => {
    const status = String(w.status || "").trim().toLowerCase();
    if (status !== "completed" && status !== "approved") return;

    const effDateStr = w.effective_accounting_date || w.effective_date;
    const wDateStr = String(effDateStr || w.request_date || w.date || w.created_at || "").slice(0, 10);
    let wYear = null;
    let wMonth = null;

    if (effDateStr) {
      const dt = new Date(effDateStr);
      wYear = dt.getUTCFullYear();
      wMonth = dt.getUTCMonth() + 1;
    } else if (w.effective_year || w.year) {
      wYear = Number(w.effective_year || w.year);
      if (w.month_number || w.month) {
        wMonth = Number(w.month_number || w.month);
      }
    } else if (wDateStr) {
      const dt = new Date(wDateStr);
      wYear = dt.getUTCFullYear();
      wMonth = dt.getUTCMonth() + 1;
    }

    if (wYear !== year || wMonth !== month) return;

    const wdInv = String(w.investor_id || w.investorid || w.id || "").trim().toLowerCase();
    if (idSet.has(wdInv)) {
      const amt = new Decimal(w.amount || 0);
      wdsDec = wdsDec.add(amt);
      if (isDrawFulfillmentWithdrawal(w)) {
        drawFulfillmentDec = drawFulfillmentDec.add(amt);
      }
    }
  });

  return {
    deposits: roundMoneyNum(depsDec),
    withdrawals: roundMoneyNum(wdsDec),
    drawFulfillment: roundMoneyNum(drawFulfillmentDec)
  };
}

function sanitizeFutureNotes(existingNotes) {
  if (!existingNotes) return null;
  if (String(existingNotes).trim().toUpperCase().startsWith("PROJECTION_VOIDED")) {
    return null;
  }
  return existingNotes;
}

function buildProjectedMonthMutation({
  investor,
  idSet,
  invAccs,
  priorEndingBalance,
  incomingCommissionCredit,
  year,
  month,
  deposits,
  withdrawals,
  monthlyHistory,
  nowIso,
  createIfMissing
}) {
  const existingHist = findHistoryRow(monthlyHistory, investor.id, idSet, year, month);
  if (existingHist && (existingHist.locked === true || existingHist.is_manual === true || existingHist.ismanual === true)) {
    return { action: "SKIP_LOCKED_OR_MANUAL", endingBalance: Number(existingHist.ending_balance || 0) };
  }
  if (!existingHist && !createIfMissing) {
    return { action: "SKIP_MISSING", endingBalance: priorEndingBalance };
  }

  const monthName = formatMonthName(year, month);
  const started = hasInvestorStartedByMonthEnd(investor.start_date, year, month);

  if (!started) {
    const zeroPayload = {
      investor_id: investor.id,
      account_id: null,
      year,
      month_number: month,
      month: monthName,
      opening_balance: 0,
      deposits: 0,
      withdrawals: 0,
      gross_return_pct: 0,
      manual_gain_amount: null,
      manual_return_pct: null,
      recurring_draw: 0,
      ending_balance: 0,
      is_manual: false,
      locked: false,
      notes: sanitizeFutureNotes(existingHist?.notes),
      updated_at: nowIso
    };
    return existingHist
      ? { action: "UPDATE", id: existingHist.id, row: zeroPayload, endingBalance: 0 }
      : { action: "SKIP_PRESTART", endingBalance: 0 };
  }

  const basePrior = priorEndingBalance !== null && priorEndingBalance !== undefined
    ? new Decimal(priorEndingBalance)
    : new Decimal(getInvestorStartingCapital(invAccs));

  const openingDec = basePrior.add(new Decimal(incomingCommissionCredit || 0)).toNumber();
  const cashflows = computePeriodCashflows(idSet, year, month, deposits, withdrawals);
  const contractualDraw = new Decimal(investor.monthly_draw ?? investor.monthlydraw ?? investor.recurring_draw ?? 0);
  const effectiveDraw = roundMoneyNum(Decimal.max(0, contractualDraw.sub(new Decimal(cashflows.drawFulfillment || 0))));
  const endingBalance = Decimal.max(
    0,
    new Decimal(openingDec)
      .add(cashflows.deposits)
      .sub(cashflows.withdrawals)
      .sub(effectiveDraw)
  ).toNumber();

  const payload = {
    investor_id: investor.id,
    account_id: null,
    year,
    month_number: month,
    month: monthName,
    opening_balance: openingDec,
    deposits: cashflows.deposits,
    withdrawals: cashflows.withdrawals,
    gross_return_pct: 0,
    manual_gain_amount: null,
    manual_return_pct: null,
    recurring_draw: effectiveDraw,
    ending_balance: endingBalance,
    is_manual: false,
    locked: false,
    notes: sanitizeFutureNotes(existingHist?.notes),
    updated_at: nowIso
  };

  if (existingHist) {
    return { action: "UPDATE", id: existingHist.id, row: payload, endingBalance };
  }

  return {
    action: "CREATE",
    row: { id: crypto.randomUUID(), created_at: nowIso, ...payload },
    endingBalance
  };
}

function buildPeriodCloseAndRolloverPlan({
  yr,
  m,
  currentRun,
  investors,
  accounts,
  deposits,
  withdrawals,
  monthlyHistory,
  nowIso
}) {
  const monthName = formatMonthName(yr, m);
  const historyRowsToUpdate = [];
  const historyRowsToCreate = [];
  const commissionRowsToCreate = [];
  const rolloverRowsToUpdate = [];
  const rolloverRowsToCreate = [];
  let totalIncomingCreditsNextMonth = new Decimal(0);

  const investorLookup = new Map();
  (investors || []).forEach(i => {
    if (i.id) investorLookup.set(String(i.id).toLowerCase(), i);
  });

  // 1. Period M close mutations (history + active commission earnings)
  const incomingCommByRecipient = new Map();
  for (const invResult of currentRun.investors) {
    const rawInvestor = investorLookup.get(String(invResult.investorId).toLowerCase()) || {
      id: invResult.investorId,
      portal_username: invResult.username,
      start_date: invResult.startDate,
      monthly_draw: invResult.recurringDraw
    };
    const { idSet } = buildInvestorIdSet(rawInvestor, accounts);
    const existingHist = findHistoryRow(monthlyHistory, rawInvestor.id, idSet, yr, m);

    if (existingHist && (existingHist.is_manual || existingHist.ismanual)) {
      throw new Error(
        `MANUAL_HISTORY_COLLISION: Manual history record exists for ${invResult.name} in period ${yr}-${m}. Manual records cannot be overwritten automatically.`
      );
    }

    const isPreStart = Boolean(invResult.isPreStart);
    const histPayload = {
      investor_id: rawInvestor.id,
      account_id: null,
      year: yr,
      month_number: m,
      month: monthName,
      opening_balance: isPreStart ? 0 : invResult.priorEndingBalance,
      deposits: isPreStart ? 0 : invResult.deposits,
      withdrawals: isPreStart ? 0 : invResult.withdrawals,
      gross_return_pct: isPreStart ? 0 : invResult.fundReturnPct,
      manual_gain_amount: null,
      manual_return_pct: null,
      recurring_draw: isPreStart ? 0 : (invResult.effectiveDrawToDeduct ?? 0),
      ending_balance: isPreStart ? 0 : invResult.endingBalance,
      is_manual: false,
      locked: true,
      notes: sanitizeFutureNotes(existingHist?.notes),
      updated_at: nowIso
    };

    if (existingHist) {
      historyRowsToUpdate.push({ id: existingHist.id, row: histPayload });
    } else if (!isPreStart) {
      historyRowsToCreate.push({ id: crypto.randomUUID(), created_at: nowIso, ...histPayload });
    }

    if (!isPreStart) {
      (invResult.recipientAllocations || []).forEach(rec => {
        if (Number(rec.amount) > 0) {
          const amtDec = new Decimal(rec.amount);
          totalIncomingCreditsNextMonth = totalIncomingCreditsNextMonth.add(amtDec);

          const recKey = String(rec.recipientId || "").trim().toLowerCase();
          incomingCommByRecipient.set(recKey, (incomingCommByRecipient.get(recKey) || new Decimal(0)).add(amtDec));

          commissionRowsToCreate.push({
            id: crypto.randomUUID(),
            recipient_id: rec.recipientId,
            source_investor_id: rawInvestor.id,
            source_account_id: rec.sourceAccountId || null,
            year: yr,
            month_number: m,
            amount: amtDec.toNumber(),
            commission_percent_snapshot: rec.commissionPercent,
            commission_share_rule_id: rec.id || null,
            calculation_version: `${ACCOUNTING_ENGINE_VERSION}_authoritative`,
            status: "ACTIVE",
            ledger_key: `${yr}_${m}_${rawInvestor.id}_${rec.sourceAccountId || "DEFAULT"}_${rec.recipientId}`,
            created_at: nowIso
          });
        }
      });
    }
  }

  // 2. Roll forward M+1 (and M+2 within same calendar year if unlocked placeholder exists)
  const nextYr = m === 12 ? yr + 1 : yr;
  const nextM = m === 12 ? 1 : m + 1;

  for (const invResult of currentRun.investors) {
    const rawInvestor = investorLookup.get(String(invResult.investorId).toLowerCase()) || {
      id: invResult.investorId,
      portal_username: invResult.username,
      start_date: invResult.startDate,
      monthly_draw: invResult.recurringDraw
    };
    const { idSet, invAccs } = buildInvestorIdSet(rawInvestor, accounts);

    let octCommDec = new Decimal(0);
    idSet.forEach(alias => {
      if (incomingCommByRecipient.has(alias)) {
        octCommDec = octCommDec.add(incomingCommByRecipient.get(alias));
      }
    });

    const m1PriorEnding = invResult.isPreStart ? null : invResult.endingBalance;
    const m1Plan = buildProjectedMonthMutation({
      investor: rawInvestor,
      idSet,
      invAccs,
      priorEndingBalance: m1PriorEnding,
      incomingCommissionCredit: roundMoneyNum(octCommDec),
      year: nextYr,
      month: nextM,
      deposits,
      withdrawals,
      monthlyHistory,
      nowIso,
      createIfMissing: hasInvestorStartedByMonthEnd(rawInvestor.start_date, nextYr, nextM)
    });

    if (m1Plan.action === "UPDATE") {
      rolloverRowsToUpdate.push({ id: m1Plan.id, row: m1Plan.row });
    } else if (m1Plan.action === "CREATE") {
      rolloverRowsToCreate.push(m1Plan.row);
    }

    // Refresh existing same-year open M+2 placeholder (e.g. December) so stale PROJECTION_VOIDED rows match
    if (nextM < 12) {
      const next2M = nextM + 1;
      const startedByM1 = hasInvestorStartedByMonthEnd(rawInvestor.start_date, nextYr, nextM);
      const m2PriorEnding = startedByM1 ? m1Plan.endingBalance : null;
      const m2Plan = buildProjectedMonthMutation({
        investor: rawInvestor,
        idSet,
        invAccs,
        priorEndingBalance: m2PriorEnding,
        incomingCommissionCredit: 0,
        year: nextYr,
        month: next2M,
        deposits,
        withdrawals,
        monthlyHistory,
        nowIso,
        createIfMissing: false
      });

      if (m2Plan.action === "UPDATE") {
        rolloverRowsToUpdate.push({ id: m2Plan.id, row: m2Plan.row });
      }
    }
  }

  return {
    historyRowsToUpdate,
    historyRowsToCreate,
    commissionRowsToCreate,
    rolloverRowsToUpdate,
    rolloverRowsToCreate,
    totalIncomingCreditsNextMonth: roundMoneyNum(totalIncomingCreditsNextMonth)
  };
}

async function runInChunks(items, chunkSize, workerFn) {
  for (let i = 0; i < items.length; i += chunkSize) {
    const slice = items.slice(i, i + chunkSize);
    await workerFn(slice);
  }
}

async function executeLiveFinalizationWrites({
  db,
  yr,
  m,
  monthName,
  currentRun,
  previewRunId,
  adminId,
  plan,
  nowIso
}) {
  // Primary atomic execution path: single Postgres transaction via finalize_monthly_accounting_v2
  if (typeof db?.rpc === "function") {
    const periodHistoryJson = [
      ...plan.historyRowsToUpdate.map(item => item.row),
      ...plan.historyRowsToCreate
    ];
    const rolloverHistoryJson = [
      ...plan.rolloverRowsToUpdate.map(item => item.row),
      ...plan.rolloverRowsToCreate
    ];
    const commissionEarningsJson = plan.commissionRowsToCreate;

    const { data: rpcResult, error: rpcError } = await db.rpc("finalize_monthly_accounting_v2", {
      p_year: yr,
      p_month_number: m,
      p_gross_return_pct: currentRun.fundReturnPct,
      p_return_source: currentRun.returnSource,
      p_return_status: currentRun.returnStatus,
      p_input_hash: currentRun.inputHash,
      p_preview_run_id: previewRunId || currentRun.previewRunId,
      p_calculation_version: ACCOUNTING_ENGINE_VERSION,
      p_admin_id: adminId,
      p_period_history_json: periodHistoryJson,
      p_rollover_history_json: rolloverHistoryJson,
      p_commission_earnings_json: commissionEarningsJson,
      p_supersede_reason: "Replaced by authoritative month close"
    });

    if (!rpcError && rpcResult) {
      return {
        accountingPeriodId: rpcResult.periodId ?? null,
        auditId: rpcResult.auditId ?? null,
        totalWrites:
          Number(rpcResult.historyCount || 0) +
          Number(rpcResult.rolloverCount || 0) +
          Number(rpcResult.earningsCount || 0) +
          3
      };
    }

    const msg = String(rpcError?.message || "");
    const isMissingRpc =
      rpcError?.code === "PGRST202" ||
      rpcError?.code === "42883" ||
      /Could not find the function|does not exist/i.test(msg);

    if (!isMissingRpc) {
      throw new Error(msg || "ATOMIC_FINALIZATION_RPC_FAILED");
    }
  }

  // Fallback path (used only when an isolated test adapter omits Postgres RPCs)
  // 1. Ensure monthly_returns row is locked
  const { error: retErr } = await db
    .from("monthly_returns")
    .update({
      locked: true,
      last_updated: nowIso
    })
    .eq("year", yr)
    .eq("month_number", m);
  if (retErr) {
    throw new Error(`Failed to lock monthly_returns ${yr}-${m}: ${retErr.message}`);
  }

  // 2. Record finalized period in accounting_periods
  const { data: periodRow, error: periodErr } = await db
    .from("accounting_periods")
    .upsert({
      year: yr,
      month_number: m,
      status: "FINALIZED",
      fund_return_pct: currentRun.fundReturnPct,
      return_source: currentRun.returnSource,
      return_status: currentRun.returnStatus,
      return_captured_at: currentRun.returnCapturedAt,
      preview_input_hash: currentRun.inputHash,
      preview_run_id: previewRunId || currentRun.previewRunId,
      finalized_at: nowIso,
      finalized_by: adminId,
      calculation_version: ACCOUNTING_ENGINE_VERSION,
      updated_at: nowIso
    }, { onConflict: "year,month_number" })
    .select()
    .single();
  if (periodErr) {
    throw new Error(`Failed to record accounting_periods ${yr}-${m}: ${periodErr.message}`);
  }

  const accountingPeriodId = periodRow?.id || null;

  // 3. Apply M history updates & creates
  await runInChunks(plan.historyRowsToUpdate, 20, async slice => {
    await Promise.all(slice.map(async item => {
      const { error } = await db
        .from("investor_monthly_history")
        .update(item.row)
        .eq("id", item.id);
      if (error) throw new Error(`Failed updating M${m} history ${item.id}: ${error.message}`);
    }));
  });

  if (plan.historyRowsToCreate.length > 0) {
    await runInChunks(plan.historyRowsToCreate, 100, async slice => {
      const { error } = await db.from("investor_monthly_history").insert(slice);
      if (error) throw new Error(`Failed inserting M${m} history rows: ${error.message}`);
    });
  }

  // 4. Insert ACTIVE commission_earnings rows (never touching legacy SUPERSEDED rows)
  const commissionInserts = plan.commissionRowsToCreate.map(row => ({
    ...row,
    accounting_period_id: accountingPeriodId
  }));
  if (commissionInserts.length > 0) {
    await runInChunks(commissionInserts, 100, async slice => {
      const { error } = await db.from("commission_earnings").insert(slice);
      if (error) throw new Error(`Failed inserting commission_earnings rows: ${error.message}`);
    });
  }

  // 5. Apply M+1 / M+2 rollover updates & creates
  await runInChunks(plan.rolloverRowsToUpdate, 20, async slice => {
    await Promise.all(slice.map(async item => {
      const { error } = await db
        .from("investor_monthly_history")
        .update(item.row)
        .eq("id", item.id);
      if (error) throw new Error(`Failed updating rollover history ${item.id}: ${error.message}`);
    }));
  });

  if (plan.rolloverRowsToCreate.length > 0) {
    await runInChunks(plan.rolloverRowsToCreate, 100, async slice => {
      const { error } = await db.from("investor_monthly_history").insert(slice);
      if (error) throw new Error(`Failed inserting rollover history rows: ${error.message}`);
    });
  }

  // 6. Write immutable audit_runs summary record
  const totalWrites =
    1 +
    1 +
    plan.historyRowsToUpdate.length +
    plan.historyRowsToCreate.length +
    commissionInserts.length +
    plan.rolloverRowsToUpdate.length +
    plan.rolloverRowsToCreate.length;

  const { error: auditErr } = await db.from("audit_runs").insert({
    id: crypto.randomUUID(),
    admin_id: adminId,
    source_investor_id: null,
    year: yr,
    month_number: m,
    report_json: {
      period: `${yr}-${String(m).padStart(2, "0")}`,
      month_name: monthName,
      input_hash: currentRun.inputHash,
      preview_run_id: previewRunId || currentRun.previewRunId,
      finalized_at: nowIso,
      gross_return_pct: currentRun.fundReturnPct,
      calculation_version: ACCOUNTING_ENGINE_VERSION,
      accounting_period_id: accountingPeriodId,
      history_records_written: plan.historyRowsToUpdate.length + plan.historyRowsToCreate.length,
      earnings_records_written: commissionInserts.length,
      rollover_records_written: plan.rolloverRowsToUpdate.length + plan.rolloverRowsToCreate.length,
      control_equations: {
        gross_eligible_capital: currentRun.summary.grossEligibleCapital,
        total_gross_fund_result: currentRun.summary.totalGrossFundResult,
        total_source_gain_loss: currentRun.summary.totalSourceGainLoss,
        total_recipient_commissions: currentRun.summary.totalRecipientCommissions
      }
    },
    created_at: nowIso
  });
  if (auditErr) {
    throw new Error(`Failed inserting audit_runs record: ${auditErr.message}`);
  }

  return { accountingPeriodId, totalWrites };
}

export async function executePeriodFinalizationWorkflow({
  db,
  accountingDataLoader = loadAccountingData,
  yr,
  m,
  previewRunId = null,
  inputHash = null,
  dryRun = true,
  fundReturnPct = null,
  finalizationEnabled = process.env.ACCOUNTING_FINALIZATION_ENABLED === "true",
  allowOpenReturn = process.env.ALLOW_OPEN_RETURN_FINALIZATION === "true",
  adminId = "system_admin"
}) {
  try {
    // 4. Batch load all authoritative inputs
    const {
      investors, accounts, deposits, withdrawals,
      commissionShares, monthlyHistory, commissionEarnings, monthlyReturns,
      cutoverAdjustments
    } = await accountingDataLoader({ supabaseClient: db });

    // 5. Server-side authoritative recalculation
    const currentRun = calculateAccountingPeriod({
      year: yr,
      month: m,
      fundReturnPct,
      investors: investors || [],
      accounts: accounts || [],
      deposits: deposits || [],
      withdrawals: withdrawals || [],
      commissionShares: commissionShares || [],
      monthlyHistory: monthlyHistory || [],
      commissionEarnings: commissionEarnings || [],
      monthlyReturns: monthlyReturns || [],
      cutoverAdjustments: cutoverAdjustments || []
    });

    // 6. Stale Preview Protection (Check inputHash match)
    if (inputHash && currentRun.inputHash !== inputHash) {
      return {
        statusCode: 409,
        payload: {
          error: "STALE_PREVIEW",
          message: "Financial inputs changed after preview was generated. Please refresh preview.",
          previewHash: inputHash,
          currentHash: currentRun.inputHash
        }
      };
    }

    // 7. Validation Gate Check
    if (!currentRun.canFinalize || currentRun.summary.flaggedCount > 0) {
      return {
        statusCode: 422,
        payload: {
          error: "VALIDATION_FAILED",
          message: "Period cannot be finalized because validation anomalies exist.",
          flaggedCount: currentRun.summary.flaggedCount,
          flags: currentRun.investors.filter(i => i.status === "FLAGGED").map(i => ({ investor: i.name, reason: i.flagReason }))
        }
      };
    }

    // 8. Require Frozen Return State (Not OPEN)
    const targetReturnRow = (monthlyReturns || []).find(
      r => Number(r.year) === yr && Number(r.month_number || r.month) === m
    );
    const isReturnLockedInDb = Boolean(targetReturnRow && (targetReturnRow.locked === true || String(targetReturnRow.locked).toLowerCase() === "true"));

    if ((currentRun.returnStatus === "OPEN" || (!dryRun && !isReturnLockedInDb)) && !allowOpenReturn) {
      return {
        statusCode: 422,
        payload: {
          error: "RETURN_NOT_FROZEN",
          message: "Monthly return must be captured and frozen before finalization can proceed.",
          returnStatus: currentRun.returnStatus,
          returnLocked: isReturnLockedInDb
        }
      };
    }

    // 9. Idempotency & Duplicate Finalization Guard
    const { data: existingPeriods, error: apErr } = await db
      .from("accounting_periods")
      .select("id,year,month_number,status")
      .eq("year", yr)
      .eq("month_number", m);
    if (apErr) {
      throw new Error(`Failed checking accounting_periods status: ${apErr.message}`);
    }

    const activeCommRowsForPeriod = (commissionEarnings || []).filter(e => {
      if (Number(e.year) !== yr || Number(e.month_number || e.month) !== m) return false;
      const st = String(e.status || "ACTIVE").trim().toUpperCase();
      return st !== "SUPERSEDED" && st !== "VOID";
    });
    const hasFinalizedPeriodRow = (existingPeriods || []).some(
      p => String(p.status || "").trim().toUpperCase() === "FINALIZED"
    );
    const hasCloseLinkedCommRows = activeCommRowsForPeriod.some(
      e => e.accounting_period_id !== null && e.accounting_period_id !== undefined && String(e.accounting_period_id).trim() !== ""
    );
    const periodHistoryRows = (monthlyHistory || []).filter(
      h => Number(h.year) === yr && Number(h.month_number || h.month) === m
    );
    const allPeriodHistoryLocked = periodHistoryRows.length > 0 && periodHistoryRows.every(h => h.locked === true);
    const alreadyFinalized = hasFinalizedPeriodRow || hasCloseLinkedCommRows || (allPeriodHistoryLocked && activeCommRowsForPeriod.length > 0);

    if (dryRun === false && alreadyFinalized) {
      return {
        statusCode: 409,
        payload: {
          error: "ALREADY_FINALIZED",
          message: `Accounting period ${yr}-${String(m).padStart(2, "0")} is already finalized or contains active commission earnings rows.`
        }
      };
    }

    // 10. Control Equation Check & Build Close + Rollover Plan
    const grossCap = currentRun.summary.grossEligibleCapital;
    const grossResult = currentRun.summary.totalGrossFundResult;
    const sourceGain = currentRun.summary.totalSourceGainLoss;
    const recipientComm = currentRun.summary.totalRecipientCommissions;
    const isControlReconciled = Math.abs(grossResult - (sourceGain + recipientComm)) < 0.05;
    if (!isControlReconciled) {
      return {
        statusCode: 422,
        payload: {
          error: "CONTROL_EQUATION_FAILED",
          message: `Control equation discrepancy detected: gross(${grossResult}) !== source(${sourceGain}) + comm(${recipientComm}).`
        }
      };
    }

    const nowIso = new Date().toISOString();
    const monthName = formatMonthName(yr, m);
    const plan = buildPeriodCloseAndRolloverPlan({
      yr,
      m,
      currentRun,
      investors,
      accounts,
      deposits,
      withdrawals,
      monthlyHistory,
      nowIso
    });

    const nextYear = m === 12 ? yr + 1 : yr;
    const nextMonth = m === 12 ? 1 : m + 1;

    const baseManifest = {
      previewStatus: dryRun === false ? "FINALIZED" : "SHADOW_ONLY",
      isDryRun: dryRun !== false,
      alreadyFinalized,
      engineVersion: ACCOUNTING_ENGINE_VERSION,
      inputHash: currentRun.inputHash,
      previewRunId: previewRunId || currentRun.previewRunId,
      period: currentRun.period,
      returnMetadata: {
        returnPct: currentRun.fundReturnPct,
        source: currentRun.returnSource,
        status: currentRun.returnStatus,
        capturedAt: currentRun.returnCapturedAt
      },
      controlEquations: {
        grossEligibleCapital: grossCap,
        totalGrossFundResult: grossResult,
        totalSourceGainLoss: sourceGain,
        totalRecipientCommissions: recipientComm,
        controlCheck: "RECONCILED"
      },
      nextMonthIncomingCommissionCreditsManifest: {
        targetYear: nextYear,
        targetMonth: nextMonth,
        totalIncomingCredits: plan.totalIncomingCreditsNextMonth
      }
    };

    // Dry-run path: zero writes
    if (dryRun !== false || !finalizationEnabled) {
      return {
        statusCode: 200,
        payload: {
          status: "SUCCESS_DRY_RUN",
          message: "Dry run finalization completed successfully with ZERO database writes.",
          manifest: {
            ...baseManifest,
            whatWouldChange: {
              monthlyHistoryRowsToCreate: plan.historyRowsToCreate.length,
              monthlyHistoryRowsToUpdate: plan.historyRowsToUpdate.length,
              commissionEarningsRowsToCreate: plan.commissionRowsToCreate.length,
              rolloverHistoryRowsToCreate: plan.rolloverRowsToCreate.length,
              rolloverHistoryRowsToUpdate: plan.rolloverRowsToUpdate.length,
              accountingPeriodStatusChange: `OPEN -> FINALIZED (${yr}-${m})`,
              auditRunRow: 1,
              totalDatabaseWritesPerformed: 0
            }
          }
        }
      };
    }

    // 11. Live Execution Path
    const execResult = await executeLiveFinalizationWrites({
      db,
      yr,
      m,
      monthName,
      currentRun,
      previewRunId,
      adminId,
      plan,
      nowIso
    });

    return {
      statusCode: 200,
      payload: {
        status: "SUCCESS_FINALIZED",
        message: `${monthName} ${yr} finalized and rolled over cleanly into ${formatMonthName(nextYear, nextMonth)} ${nextYear}.`,
        manifest: {
          ...baseManifest,
          accountingPeriodId: execResult.accountingPeriodId,
          changesApplied: {
            monthlyHistoryRowsCreated: plan.historyRowsToCreate.length,
            monthlyHistoryRowsUpdated: plan.historyRowsToUpdate.length,
            commissionEarningsRowsCreated: plan.commissionRowsToCreate.length,
            rolloverHistoryRowsCreated: plan.rolloverRowsToCreate.length,
            rolloverHistoryRowsUpdated: plan.rolloverRowsToUpdate.length,
            accountingPeriodStatusChange: `OPEN -> FINALIZED (${yr}-${m})`,
            auditRunRow: 1,
            totalDatabaseWritesPerformed: execResult.totalWrites
          }
        }
      }
    };
  } catch (error) {
    const msg = String(error?.message || "");
    if (msg.startsWith("MANUAL_HISTORY_COLLISION")) {
      return { statusCode: 409, payload: { error: "MANUAL_HISTORY_COLLISION", message: msg } };
    }
    if (msg.includes("PERIOD_ALREADY_FINALIZED")) {
      return { statusCode: 409, payload: { error: "ALREADY_FINALIZED", message: msg } };
    }
    return { statusCode: 500, payload: { error: "FINALIZATION_FAILED", message: msg } };
  }
}

export default async function handler(req, res, deps = {}) {
  const db = deps.supabase || supabase;
  const accountingDataLoader = deps.loadAccountingData || loadAccountingData;

  // 1. Verify Admin Authentication
  const auth = verifyAdminSession(req);
  if (!auth || !auth.adminId) {
    return res.status(401).json({ error: "Unauthorized", message: "Admin authentication required." });
  }

  // 2. Feature Flag Check — Default: DISABLED
  const finalizationEnabled = process.env.ACCOUNTING_FINALIZATION_ENABLED === "true";

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const {
    year,
    month,
    previewRunId,
    inputHash,
    dryRun = true,
    fundReturnPct = null
  } = req.body || {};

  if (!year || !month) {
    return res.status(400).json({ error: "Missing required parameters: year, month" });
  }

  const yr = Number(year);
  const m = Number(month);
  if (!Number.isInteger(yr) || !Number.isInteger(m) || m < 1 || m > 12) {
    return res.status(400).json({ error: "Invalid year or month parameter." });
  }

  // 3. Block real finalization if feature flag is OFF
  if (!finalizationEnabled && dryRun === false) {
    return res.status(503).json({
      error: "FINALIZATION_DISABLED",
      message: "Monthly accounting finalization is not enabled in this environment."
    });
  }

  if (!db) {
    return res.status(503).json({
      error: "DATABASE_UNAVAILABLE",
      message: "Database client is not configured."
    });
  }

  const outcome = await executePeriodFinalizationWorkflow({
    db,
    accountingDataLoader,
    yr,
    m,
    previewRunId,
    inputHash,
    dryRun,
    fundReturnPct,
    finalizationEnabled,
    allowOpenReturn: process.env.ALLOW_OPEN_RETURN_FINALIZATION === "true",
    adminId: auth.adminId
  });
  return res.status(outcome.statusCode).json(outcome.payload);
}
