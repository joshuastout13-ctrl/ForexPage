import Decimal from "decimal.js";
import { supabase } from "./supabase.js";

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

export const MONTH_ABBRS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
];

/**
 * Resolves any combination of month/year/effectiveDate inputs into a canonical period:
 * {
 *   effectiveDate: 'YYYY-MM-01',
 *   effectiveAccountingDate: 'YYYY-MM-01',
 *   year: 2026,
 *   monthNumber: 8,
 *   monthName: 'August',
 *   monthAbbr: 'Aug'
 * }
 */
export function canonicalizeWithdrawalPeriod(input = {}) {
  let targetYear = null;
  let targetMonthNum = null;

  // 1. If explicit ISO effective date provided ('YYYY-MM-DD' or 'YYYY-MM')
  const rawDateStr = input.effective_accounting_date || input.effectiveAccountingDate || input.effectiveDate || input.request_date || input.requestDate;
  if (typeof rawDateStr === 'string' && /^\d{4}-\d{2}/.test(rawDateStr.trim())) {
    const parts = rawDateStr.trim().split('-');
    const parsedY = parseInt(parts[0], 10);
    const parsedM = parseInt(parts[1], 10);
    if (!isNaN(parsedY) && parsedY >= 2000 && parsedY <= 2100 && !isNaN(parsedM) && parsedM >= 1 && parsedM <= 12) {
      targetYear = parsedY;
      targetMonthNum = parsedM;
    }
  }

  // 2. Parse year if provided explicitly
  const rawYear = input.year !== undefined && input.year !== null ? input.year : input.effectiveYear;
  if (rawYear !== undefined && rawYear !== null && rawYear !== '') {
    const parsedY = parseInt(String(rawYear).trim(), 10);
    if (!isNaN(parsedY) && parsedY >= 2000 && parsedY <= 2100) {
      targetYear = parsedY;
    }
  }

  // 3. Parse month if provided explicitly (number, full name, abbr, numeric string)
  const rawMonth = input.month_number !== undefined && input.month_number !== null ? input.month_number :
                   (input.monthNumber !== undefined && input.monthNumber !== null ? input.monthNumber :
                   (input.month !== undefined && input.month !== null ? input.month : input.effectiveMonth));

  if (rawMonth !== undefined && rawMonth !== null && rawMonth !== '') {
    if (typeof rawMonth === 'number') {
      if (rawMonth >= 1 && rawMonth <= 12) {
        targetMonthNum = Math.floor(rawMonth);
      }
    } else if (typeof rawMonth === 'string') {
      const trimmed = rawMonth.trim();
      const asNum = parseInt(trimmed, 10);
      if (!isNaN(asNum) && String(asNum) === trimmed && asNum >= 1 && asNum <= 12) {
        targetMonthNum = asNum;
      } else {
        const lower = trimmed.toLowerCase();
        // Check full names
        const fullIdx = MONTH_NAMES.findIndex(m => m.toLowerCase() === lower);
        if (fullIdx !== -1) {
          targetMonthNum = fullIdx + 1;
        } else {
          // Check 3-letter abbreviations
          const abbrIdx = MONTH_ABBRS.findIndex(a => a.toLowerCase() === lower.slice(0, 3));
          if (abbrIdx !== -1) {
            targetMonthNum = abbrIdx + 1;
          }
        }
      }
    }
  }

  // Fallback for year if not set
  if (!targetYear) {
    targetYear = new Date().getFullYear();
  }

  // Validate that month was successfully determined
  if (!targetMonthNum || targetMonthNum < 1 || targetMonthNum > 12) {
    throw new Error(`INVALID_EFFECTIVE_DATE: Unable to parse valid month from input (${JSON.stringify(rawMonth !== undefined ? rawMonth : input)}).`);
  }

  const padMonth = String(targetMonthNum).padStart(2, '0');
  const effectiveDate = `${targetYear}-${padMonth}-01`;

  return {
    effectiveDate,
    effectiveAccountingDate: effectiveDate,
    year: targetYear,
    monthNumber: targetMonthNum,
    monthName: MONTH_NAMES[targetMonthNum - 1],
    monthAbbr: MONTH_ABBRS[targetMonthNum - 1]
  };
}

function toDec(val, fallback = 0) {
  if (val === null || val === undefined || isNaN(val)) return new Decimal(fallback);
  return new Decimal(val);
}

/**
 * Shared Fail-Closed Available Withdrawal Equity Service
 * 
 * Invariants:
 * 1. Initial period: uses starting_capital.
 * 2. Established account with missing prior month: fails closed (throws ACCOUNTING_HISTORY_INCOMPLETE).
 * 3. Pre-start effective date: returns 0 equity.
 * 4. Contradictory start dates: throws ACCOUNT_START_DATE_CONFLICT.
 */
export async function calculateAvailableWithdrawalEquity(investorId, effectiveDate, options = {}) {
  const { excludeWithdrawalId = null, accountId = null, preloadedData: rawPreloaded = null } = options;
  const preloadedData = rawPreloaded || (options.rawInvestors ? options : null);

  if (!effectiveDate || !/^\d{4}-\d{2}-01$/.test(effectiveDate)) {
    throw new Error(`INVALID_EFFECTIVE_DATE: Effective date must be the first day of the month ('YYYY-MM-01'), received: ${effectiveDate}`);
  }

  const [yearStr, monthStr] = effectiveDate.split('-');
  const targetYear = parseInt(yearStr, 10);
  const targetMonth = parseInt(monthStr, 10);

  // 1. Fetch Investor & Account
  let invData, accs;
  if (preloadedData && preloadedData.rawInvestors) {
    invData = preloadedData.rawInvestors.find(i => i.id === investorId || i.portal_username === investorId);
    accs = (preloadedData.accounts || []).filter(a => a.investor_id === (invData ? invData.id : investorId));
  } else {
    const { data: dbInv } = await supabase
      .from("investors")
      .select("id, start_date, active, split_pct, monthly_draw")
      .eq("id", investorId)
      .single();
    invData = dbInv;
    if (!invData) {
      const { data: dbInvByName } = await supabase
        .from("investors")
        .select("id, start_date, active, split_pct, monthly_draw")
        .eq("portal_username", investorId)
        .single();
      invData = dbInvByName;
    }
    if (!invData) {
      throw new Error(`INVESTOR_NOT_FOUND: Investor ${investorId} does not exist.`);
    }

    const { data: dbAccs } = await supabase
      .from("investor_accounts")
      .select("*")
      .eq("investor_id", invData.id);
    accs = dbAccs || [];
  }

  if (!invData) {
    throw new Error(`INVESTOR_NOT_FOUND: Investor ${investorId} does not exist.`);
  }

  const targetAccount = accountId 
    ? (accs || []).find(a => a.id === accountId || a.account_id === accountId)
    : (accs && accs.length > 0 ? accs[0] : null);

  const startingCapital = targetAccount ? toDec(targetAccount.starting_capital) : new Decimal(0);
  const accOpenDate = targetAccount && targetAccount.open_date;
  const invStartDate = invData.start_date;

  // Resolve authoritative accounting start date & non-fatal metadata discrepancy warning
  const effectiveStartDate = invStartDate || accOpenDate || '2026-01-01';

  if (accOpenDate && invStartDate) {
    const accYear = parseInt(accOpenDate.slice(0, 4), 10);
    const accMonth = parseInt(accOpenDate.slice(5, 7), 10);
    const invYear = parseInt(invStartDate.slice(0, 4), 10);
    const invMonth = parseInt(invStartDate.slice(5, 7), 10);
    if (accYear !== invYear || accMonth !== invMonth) {
      console.warn(`[WithdrawalValidation] METADATA_START_DATE_DISCREPANCY: Account open period (${accYear}-${accMonth}) differs from investor start period (${invYear}-${invMonth}) for investor ${investorId}.`);
    }
  }

  // Pre-start boundary check
  if (effectiveDate < effectiveStartDate) {
    return {
      availableEquity: 0,
      details: {
        isPreStart: true,
        reason: `Effective date (${effectiveDate}) is before account start date (${effectiveStartDate}).`,
        priorEndingBalance: 0,
        deposits: 0,
        otherWithdrawals: 0,
        capitalizedCommissions: 0,
        startingCapital: startingCapital.toNumber()
      }
    };
  }

  const [startYearStr, startMonthStr] = effectiveStartDate.split('-');
  const startYear = parseInt(startYearStr, 10);
  const startMonth = parseInt(startMonthStr, 10);
  const isFirstPeriod = (targetYear === startYear && targetMonth === startMonth);

  const priorYear = targetMonth === 1 ? targetYear - 1 : targetYear;
  const priorMonth = targetMonth === 1 ? 12 : targetMonth - 1;

  // 2. Check for Authorized Cutover Adjustment FIRST (Parity with PostgreSQL calculate_available_withdrawal_equity_sql)
  let cutoverRecord = null;
  if (preloadedData && (preloadedData.cutoverAdjustments || preloadedData.cutovers)) {
    const list = preloadedData.cutoverAdjustments || preloadedData.cutovers || [];
    cutoverRecord = list.find(
      c => (c.investor_id === invData.id || c.investorid === invData.id) &&
           Number(c.year) === targetYear &&
           Number(c.month_number || c.month) === targetMonth
    );
  } else if (supabase) {
    const { data: dbCutover } = await supabase
      .from("account_cutover_adjustments")
      .select("authorized_opening_balance")
      .eq("investor_id", invData.id)
      .eq("year", targetYear)
      .eq("month_number", targetMonth)
      .maybeSingle();
    cutoverRecord = dbCutover;
  }

  let priorEndingBalance = new Decimal(0);
  let priorMonthCommissions = new Decimal(0);

  if (cutoverRecord && cutoverRecord.authorized_opening_balance !== null && cutoverRecord.authorized_opening_balance !== undefined) {
    priorEndingBalance = toDec(cutoverRecord.authorized_opening_balance);
    priorMonthCommissions = new Decimal(0);
  } else if (isFirstPeriod) {
    priorEndingBalance = startingCapital;
  } else {
    let priorHist;
    if (preloadedData && preloadedData.historyTable) {
      priorHist = preloadedData.historyTable.find(
        h => h.investor_id === invData.id && h.year === priorYear && h.month_number === priorMonth
      );
    } else {
      const { data: dbHist } = await supabase
        .from("investor_monthly_history")
        .select("ending_balance")
        .eq("investor_id", invData.id)
        .eq("year", priorYear)
        .eq("month_number", priorMonth)
        .single();
      priorHist = dbHist;
    }

    if (priorHist && priorHist.ending_balance !== null && priorHist.ending_balance !== undefined) {
      priorEndingBalance = toDec(priorHist.ending_balance);
    } else {
      // Missing required prior month on established account -> FAIL CLOSED
      throw new Error(`ACCOUNTING_HISTORY_INCOMPLETE: Required prior month history (${priorYear}-${priorMonth}) is missing for established investor ${invData.id}.`);
    }
  }

  // 3. Prior Month Capitalized Commissions (N-1 -> N)
  // If cutover is active for this month, priorMonthCommissions remains 0.00 as cutover balance is all-inclusive baseline
  if (!cutoverRecord || cutoverRecord.authorized_opening_balance === null || cutoverRecord.authorized_opening_balance === undefined) {
    let commEarnings = [];
    if (preloadedData && (preloadedData.commissionEarningsTable || preloadedData.commissionEarnings)) {
      commEarnings = (preloadedData.commissionEarningsTable || preloadedData.commissionEarnings || []).filter(
        c => c.recipient_id === invData.id && c.year === priorYear && c.month_number === priorMonth
      );
    } else if (supabase) {
      const { data: dbComms } = await supabase
        .from("commission_earnings")
        .select("amount")
        .eq("recipient_id", invData.id)
        .eq("year", priorYear)
        .eq("month_number", priorMonth);
      commEarnings = dbComms || [];
    }

    if (commEarnings && commEarnings.length > 0) {
      priorMonthCommissions = commEarnings.reduce(
        (sum, row) => sum.add(toDec(row.amount)),
        new Decimal(0)
      );
    }
  }

  // 4. Eligible Deposits in Target Period (Excluding VOID)
  let allDeposits = [];
  if (preloadedData && (preloadedData.depositsSheet || preloadedData.deposits)) {
    allDeposits = (preloadedData.depositsSheet || preloadedData.deposits || []).filter(d => d.investor_id === invData.id);
  } else if (supabase) {
    const { data: dbDeps } = await supabase
      .from("deposits")
      .select("amount, date, effective_accounting_date, type")
      .eq("investor_id", invData.id);
    allDeposits = dbDeps || [];
  }

  const eligibleDeposits = (allDeposits || [])
    .filter(d => {
      if (d.type && String(d.type).toUpperCase() === 'VOID') return false;
      const dDate = d.effective_accounting_date || d.date || '';
      return String(dDate).startsWith(`${targetYear}-${String(targetMonth).padStart(2, '0')}`);
    })
    .reduce((sum, d) => sum.add(toDec(d.amount)), new Decimal(0));

  // 5. Active Other Withdrawals (Pending, Approved, Completed)
  let allWithdrawals = [];
  if (preloadedData && (preloadedData.withdrawalsSheet || preloadedData.withdrawals)) {
    allWithdrawals = (preloadedData.withdrawalsSheet || preloadedData.withdrawals || []).filter(w => w.investor_id === invData.id);
  } else if (supabase) {
    const { data: dbWds } = await supabase
      .from("withdrawals")
      .select("id, amount, request_date, effective_accounting_date, status, year, month_number")
      .eq("investor_id", invData.id);
    allWithdrawals = dbWds || [];
  }

  const otherWithdrawals = (allWithdrawals || [])
    .filter(w => {
      if (excludeWithdrawalId && w.id === excludeWithdrawalId) return false;
      const st = String(w.status || '').toLowerCase();
      if (st !== 'pending' && st !== 'approved' && st !== 'completed') return false;

      const wYear = w.year ? Number(w.year) : null;
      const wMonth = w.month_number ? Number(w.month_number) : null;
      if (wYear === targetYear && wMonth === targetMonth) return true;

      const eff = w.effective_accounting_date || w.request_date;
      return eff && String(eff).slice(0, 7) === `${targetYear}-${String(targetMonth).padStart(2, '0')}`;
    })
    .reduce((sum, w) => sum.add(toDec(w.amount)), new Decimal(0));

  // 6. Net Available Equity
  const rawEquity = priorEndingBalance
    .add(eligibleDeposits)
    .add(priorMonthCommissions)
    .sub(otherWithdrawals);

  const availableEquity = Decimal.max(0, rawEquity).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();

  return {
    availableEquity,
    rawEquity: rawEquity.toNumber(),
    isNegative: rawEquity.lt(0),
    details: {
      priorEndingBalance: priorEndingBalance.toNumber(),
      eligibleDeposits: eligibleDeposits.toNumber(),
      priorMonthCapitalizedCommissions: priorMonthCommissions.toNumber(),
      otherWithdrawals: otherWithdrawals.toNumber(),
      targetYear,
      targetMonth,
      effectiveDate
    }
  };
}
