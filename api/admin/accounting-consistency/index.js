import { verifyAdminSession } from "../../../lib/adminAuth.js";
import { paginatedRead } from "../../../lib/supabase.js";
import { isDrawFulfillmentWithdrawal } from "../../../lib/accounting-engine.js";
import Decimal from "decimal.js";
import ExcelJS from "exceljs";

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

function roundMoney(d) {
  return d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

function num(v) {
  if (v === null || v === undefined) return 0;
  return new Decimal(v).toNumber();
}

const MONTH_NAMES = [
  "", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

export default async function handler(req, res) {
  try {
    const session = verifyAdminSession(req);
    if (!session) return res.status(401).json({ error: "Unauthorized" });

    if (req.method !== "GET" && req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const query = req.method === "POST" ? req.body : req.query;
    const year = Number(query.year || new Date().getFullYear());
    const filterInvestorId = query.investorId || null;
    const filterStatus = query.status || null;
    const format = (query.format || "json").toLowerCase();

    // Fetch all reference data with deterministic id pagination (>1,000 rows in investor_monthly_history & commission_earnings)
    const [investors, accounts, returns, history, earningsTargetYear, earningsPrevYearDec, deposits, withdrawals] = await Promise.all([
      paginatedRead("investors"),
      paginatedRead("investor_accounts"),
      paginatedRead("monthly_returns", { queryModifier: q => q.eq("year", year) }),
      paginatedRead("investor_monthly_history", { queryModifier: q => q.eq("year", year) }),
      paginatedRead("commission_earnings", { queryModifier: q => q.eq("year", year) }),
      paginatedRead("commission_earnings", { queryModifier: q => q.eq("year", year - 1).eq("month_number", 12) }),
      paginatedRead("deposits", { queryModifier: q => q.not("type", "ilike", "VOID") }),
      paginatedRead("withdrawals", { queryModifier: q => q.in("status", ["Approved", "Completed", "Pending", "pending"]) })
    ]);
    history.sort((a, b) => Number(a.month_number) - Number(b.month_number));

    const activeDeposits = (deposits || []).filter(d => {
      const typeUpper = String(d.type || "").trim().toUpperCase();
      const statusLower = String(d.status || "").trim().toLowerCase();
      const treatment = String(d.accounting_treatment || "NEW_CASH").trim().toUpperCase();
      if (typeUpper === "VOID" || typeUpper === "HISTORICAL_PROVENANCE") return false;
      if (treatment === "HISTORICAL_PROVENANCE") return false;
      if (String(d.idempotency_key || "").startsWith("hist_prov_")) return false;
      if (statusLower && !["confirmed", "completed", "approved"].includes(statusLower)) return false;
      return true;
    });

    const isActiveEarning = e => !e.status || String(e.status).trim().toUpperCase() === "ACTIVE";
    const activeEarningsTargetYear = (earningsTargetYear || []).filter(isActiveEarning);
    const activeEarningsPrevYearDec = (earningsPrevYearDec || []).filter(isActiveEarning);

    const returnMap = {};
    (returns || []).forEach(r => { returnMap[r.month_number] = new Decimal(r.gross_return_pct || 0); });

    // Index unique ACTIVE commission_earnings rows by ID to avoid duplicate counting
    const earningsById = {};
    activeEarningsTargetYear.forEach(e => { earningsById[e.id] = e; });
    activeEarningsPrevYearDec.forEach(e => { earningsById[e.id] = e; });

    // Map earnings by recipient and earned month
    const earningsByRecipientAndMonth = {};
    Object.values(earningsById).forEach(e => {
      const key = `${e.recipient_id}_Y${e.year}_M${e.month_number}`;
      if (!earningsByRecipientAndMonth[key]) earningsByRecipientAndMonth[key] = [];
      earningsByRecipientAndMonth[key].push(e);
    });

    let totalInvestorsChecked = 0;
    let totalMonthsChecked = 0;
    let countReconciled = 0;
    let countLedgerNotCapitalized = 0;
    let countPartialCapitalization = 0;
    let countHistoryExceedsLedger = 0;
    let countBalanceMismatch = 0;
    let countPreStart = 0;
    let countZeroMonth = 0;

    let totalUniqueLedgerPrincipal = new Decimal(0);
    let totalConfirmedUncapitalizedPrincipal = new Decimal(0);
    let totalPartiallyCapitalizedPrincipal = new Decimal(0);
    let totalUndeterminedPrincipal = new Decimal(0);

    const affectedInvestorsSet = new Set();
    const affectedInvestorMonthsSet = new Set();

    // Unique active ledger principal sum for the year
    activeEarningsTargetYear.forEach(e => {
      totalUniqueLedgerPrincipal = totalUniqueLedgerPrincipal.add(new Decimal(e.amount));
    });

    const dataset = [];
    const classifiedLedgerRows = {};

    for (const inv of (investors || [])) {
      if (inv.active === false || String(inv.role || "").toLowerCase() === "admin") {
        continue;
      }
      if (filterInvestorId && inv.id !== filterInvestorId && inv.portal_username !== filterInvestorId) {
        continue;
      }
      totalInvestorsChecked++;

      const invHistory = (history || []).filter(h => h.investor_id === inv.id || h.investor_id === inv.portal_username);
      const invDeposits = activeDeposits.filter(d => d.investor_id === inv.id || d.investor_id === inv.portal_username);
      const invWithdrawals = (withdrawals || []).filter(w => w.investor_id === inv.id || w.investor_id === inv.portal_username);

      const splitPct = new Decimal(inv.split_pct || 100);
      const splitDec = splitPct.div(100);
      const draw = new Decimal(inv.monthly_draw || 0);

      let startMonth = 1;
      let startYear = year;
      if (inv.start_date) {
        const sd = new Date(inv.start_date);
        startYear = sd.getUTCFullYear();
        if (startYear === year) startMonth = sd.getUTCMonth() + 1;
        else if (startYear > year) startMonth = 13;
      }

      for (let m = 1; m <= 12; m++) {
        totalMonthsChecked++;

        const isPreStart = startYear > year || (startYear === year && m < startMonth);

        const mHist = invHistory.find(h => h.month_number === m);
        const prevHist = invHistory.find(h => h.month_number === m - 1);

        // Incoming ledger commissions for this credit month m (earned in m-1)
        const prevYear = m === 1 ? year - 1 : year;
        const prevMonthNum = m === 1 ? 12 : m - 1;
        const ledgerRows = earningsByRecipientAndMonth[`${inv.id}_Y${prevYear}_M${prevMonthNum}`] || earningsByRecipientAndMonth[`${inv.portal_username}_Y${prevYear}_M${prevMonthNum}`] || [];

        const ledgerCommTotal = ledgerRows.reduce((s, e) => s.add(new Decimal(e.amount)), new Decimal(0));

        // Deposits & withdrawals in month m
        const mDeps = invDeposits.filter(d => {
          const eff = d.effective_accounting_date || d.date;
          if (!eff) return false;
          const dt = new Date(eff);
          return dt.getUTCFullYear() === year && dt.getUTCMonth() + 1 === m;
        }).reduce((s, d) => s.add(new Decimal(d.amount)), new Decimal(0));

        const matchingMWds = invWithdrawals.filter(w => {
          if (w.effective_accounting_date || w.request_date) {
            const eff = String(w.effective_accounting_date || w.request_date).slice(0, 10);
            const dt = new Date(eff);
            return dt.getUTCFullYear() === year && dt.getUTCMonth() + 1 === m;
          }
          const wYear = Number(w.year || w.effective_year || year);
          return wYear === year && Number(w.month_number) === m;
        });
        const mWds = matchingMWds.reduce((s, w) => s.add(new Decimal(w.amount || 0)), new Decimal(0));
        const mDrawFulfilled = matchingMWds
          .filter(w => isDrawFulfillmentWithdrawal(w))
          .reduce((s, w) => s.add(new Decimal(w.amount || 0)), new Decimal(0));

        const fundRetPct = returnMap[m] || new Decimal(0);

        // Stored values
        const storedOpening = mHist ? new Decimal(mHist.opening_balance) : null;
        const storedEnding = mHist ? new Decimal(mHist.ending_balance) : null;
        const storedDeposits = mHist ? new Decimal(mHist.deposits) : mDeps;
        const storedWds = mHist ? new Decimal(mHist.withdrawals) : mWds;

        // Prior ending
        const priorEnding = prevHist ? new Decimal(prevHist.ending_balance) : (storedOpening !== null ? storedOpening : new Decimal(0));

        // Implied commission credit in stored history
        let storedCommCredit = new Decimal(0);
        if (storedOpening !== null && prevHist) {
          storedCommCredit = storedOpening.sub(priorEnding).sub(storedDeposits);
        }

        // Expected opening (if 100% ledger commissions were capitalized)
        const expectedOpening = priorEnding.add(storedDeposits).add(ledgerCommTotal);
        const openingDiff = storedOpening !== null ? storedOpening.sub(expectedOpening) : null;

        // Own gain calculation
        let eligibleCapital = new Decimal(0);
        let ownGain = new Decimal(0);
        let calcEnding = new Decimal(0);

        if (storedOpening !== null) {
          eligibleCapital = storedOpening.add(storedDeposits).sub(storedWds);
          if (!isPreStart && fundRetPct.gt(0)) {
            const grossProfit = eligibleCapital.mul(fundRetPct.div(100));
            ownGain = roundMoney(grossProfit.mul(splitDec));
          } else if (!isPreStart && fundRetPct.lt(0)) {
            const grossLoss = eligibleCapital.mul(fundRetPct.div(100));
            ownGain = roundMoney(grossLoss.mul(splitDec));
          }
          const effectiveDraw = Decimal.max(0, draw.sub(mDrawFulfilled));
          calcEnding = eligibleCapital.add(ownGain).sub(effectiveDraw);
        }

        const balanceDiff = (storedEnding !== null && calcEnding !== null) ? storedEnding.sub(calcEnding) : null;

        // Status Determination
        let status = "RECONCILED";

        if (isPreStart) {
          status = "PRE_START";
          countPreStart++;
        } else if (!mHist) {
          status = "MISSING_DATA";
        } else if (fundRetPct.eq(0) && ledgerCommTotal.eq(0) && mDeps.eq(0) && mWds.eq(0) && (balanceDiff ? balanceDiff.abs().lte(0.02) : true)) {
          status = "ZERO_MONTH";
          countZeroMonth++;
        } else if (ledgerCommTotal.gt(0) && storedCommCredit.eq(0)) {
          status = "LEDGER_NOT_CAPITALIZED";
          countLedgerNotCapitalized++;
          totalConfirmedUncapitalizedPrincipal = totalConfirmedUncapitalizedPrincipal.add(ledgerCommTotal);
          affectedInvestorsSet.add(inv.id);
          affectedInvestorMonthsSet.add(`${inv.id}_M${m}`);
        } else if (ledgerCommTotal.gt(0) && storedCommCredit.gt(0) && storedCommCredit.lt(ledgerCommTotal.sub(0.02))) {
          status = "PARTIAL_CAPITALIZATION";
          countPartialCapitalization++;
          const uncapDelta = ledgerCommTotal.sub(storedCommCredit);
          totalPartiallyCapitalizedPrincipal = totalPartiallyCapitalizedPrincipal.add(uncapDelta);
          affectedInvestorsSet.add(inv.id);
          affectedInvestorMonthsSet.add(`${inv.id}_M${m}`);
        } else if (storedCommCredit.gt(ledgerCommTotal.add(0.02))) {
          status = "HISTORY_EXCEEDS_LEDGER";
          countHistoryExceedsLedger++;
          affectedInvestorsSet.add(inv.id);
          affectedInvestorMonthsSet.add(`${inv.id}_M${m}`);
        } else if (balanceDiff && balanceDiff.abs().gt(0.02)) {
          status = "BALANCE_MISMATCH";
          countBalanceMismatch++;
          affectedInvestorsSet.add(inv.id);
          affectedInvestorMonthsSet.add(`${inv.id}_M${m}`);
        } else {
          status = "RECONCILED";
          countReconciled++;
        }

        if (filterStatus && filterStatus.toUpperCase() !== "ALL" && status !== filterStatus.toUpperCase()) {
          continue;
        }

        // Ledger row status attribution
        const ledgerDetails = ledgerRows.map(e => {
          let rowStatus = "CAPITALIZED";
          if (storedCommCredit.eq(0)) {
            rowStatus = "NOT_CAPITALIZED";
          } else if (storedCommCredit.lt(ledgerCommTotal.sub(0.02))) {
            rowStatus = ledgerRows.length === 1 ? "PARTIALLY_CAPITALIZED" : "UNDETERMINED_AT_SOURCE_LEVEL";
            if (ledgerRows.length > 1) {
              totalUndeterminedPrincipal = totalUndeterminedPrincipal.add(new Decimal(e.amount));
            }
          }
          return {
            id: e.id,
            sourceInvestorId: e.source_investor_id,
            amount: new Decimal(e.amount).toNumber(),
            createdAt: e.created_at,
            status: rowStatus
          };
        });

        // Expandable Equation Breakdown
        const equationBreakdown = {
          priorEnding: priorEnding.toNumber(),
          deposits: storedDeposits.toNumber(),
          withdrawals: storedWds.toNumber(),
          expectedJulyComm: ledgerCommTotal.toNumber(),
          expectedOpening: expectedOpening.toNumber(),
          storedOpening: storedOpening !== null ? storedOpening.toNumber() : 0,
          openingDifference: openingDiff !== null ? openingDiff.toNumber() : 0,
          eligibleCapital: eligibleCapital.toNumber(),
          fundReturnPct: fundRetPct.toNumber(),
          sourceSplitPct: splitPct.toNumber(),
          ownGain: ownGain.toNumber(),
          calculatedEnding: calcEnding.toNumber(),
          storedEnding: storedEnding !== null ? storedEnding.toNumber() : 0,
          endingDifference: balanceDiff !== null ? balanceDiff.toNumber() : 0,
          equationText: `${MONTH_NAMES[m-1] || 'Prior'} Ending ($${priorEnding.toFixed(2)}) + ${MONTH_NAMES[m]} Deposits ($${storedDeposits.toFixed(2)}) + Expected Comm ($${ledgerCommTotal.toFixed(2)}) = Expected Opening ($${expectedOpening.toFixed(2)}) vs Stored Opening ($${storedOpening ? storedOpening.toFixed(2) : '0.00'}) [Diff: $${openingDiff ? openingDiff.toFixed(2) : '0.00'}]`
        };

        dataset.push({
          investorId: inv.id,
          username: inv.portal_username,
          name: `${inv.first_name} ${inv.last_name}`,
          year,
          month: m,
          monthName: MONTH_NAMES[m],
          openingBalance: storedOpening !== null ? storedOpening.toNumber() : 0,
          deposits: storedDeposits.toNumber(),
          withdrawals: storedWds.toNumber(),
          eligibleCapital: eligibleCapital.toNumber(),
          fundReturnPct: fundRetPct.toNumber(),
          sourceSplitPct: splitPct.toNumber(),
          ownGainLoss: ownGain.toNumber(),
          incomingCommissionLedger: ledgerCommTotal.toNumber(),
          expectedCommissionCredit: ledgerCommTotal.toNumber(),
          storedCommissionCredit: storedCommCredit.toNumber(),
          commissionDifference: ledgerCommTotal.sub(storedCommCredit).toNumber(),
          calculatedEnding: calcEnding.toNumber(),
          storedEnding: storedEnding !== null ? storedEnding.toNumber() : 0,
          balanceDifference: balanceDiff !== null ? balanceDiff.toNumber() : 0,
          status,
          ledgerDetails,
          equationBreakdown
        });
      }
    }

    const summary = {
      investorsChecked: totalInvestorsChecked,
      monthsChecked: totalMonthsChecked,
      countReconciled,
      countZeroMonth,
      countPreStart,
      countLedgerNotCapitalized,
      countPartialCapitalization,
      countHistoryExceedsLedger,
      countBalanceMismatch,
      totalUniqueLedgerPrincipal: totalUniqueLedgerPrincipal.toNumber(),
      confirmedUncapitalizedPrincipal: totalConfirmedUncapitalizedPrincipal.toNumber(),
      partiallyCapitalizedPrincipal: totalPartiallyCapitalizedPrincipal.toNumber(),
      undeterminedPrincipal: totalUndeterminedPrincipal.toNumber(),
      affectedInvestorsCount: affectedInvestorsSet.size,
      affectedInvestorMonthsCount: affectedInvestorMonthsSet.size,
      affectedInvestorsList: Array.from(affectedInvestorsSet)
    };

    if (format === "csv") {
      return generateCsvExport(res, summary, dataset);
    }

    if (format === "xlsx" || format === "excel") {
      return generateExcelExport(res, summary, dataset);
    }

    return res.status(200).json({ summary, dataset });
  } catch (err) {
    console.error("[Accounting Consistency API]", err);
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
}

function generateCsvExport(res, summary, dataset) {
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename=accounting_consistency_report_${new Date().toISOString().slice(0,10)}.csv`);

  let csv = `INVESTOR,USERNAME,MONTH,OPENING_BALANCE,DEPOSITS,WITHDRAWALS,ELIGIBLE_CAPITAL,FUND_RETURN_PCT,SPLIT_PCT,OWN_GAIN_LOSS,INCOMING_COMMISSION_LEDGER,STORED_COMM_CREDIT,COMMISSION_DIFF,CALCULATED_ENDING,STORED_ENDING,BALANCE_DIFF,STATUS\n`;

  dataset.forEach(row => {
    csv += `"${row.name}","${row.username}","${row.monthName}",${row.openingBalance},${row.deposits},${row.withdrawals},${row.eligibleCapital},${row.fundReturnPct},${row.sourceSplitPct},${row.ownGainLoss},${row.incomingCommissionLedger},${row.storedCommissionCredit},${row.commissionDifference},${row.calculatedEnding},${row.storedEnding},${row.balanceDifference},"${row.status}"\n`;
  });

  return res.status(200).send(csv);
}

async function generateExcelExport(res, summary, dataset) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Accounting Consistency");

  sheet.columns = [
    { header: "Investor Name", key: "name", width: 25 },
    { header: "Username", key: "username", width: 15 },
    { header: "Month", key: "monthName", width: 12 },
    { header: "Opening Balance", key: "openingBalance", width: 16 },
    { header: "Deposits", key: "deposits", width: 14 },
    { header: "Withdrawals", key: "withdrawals", width: 14 },
    { header: "Eligible Capital", key: "eligibleCapital", width: 16 },
    { header: "Fund Return %", key: "fundReturnPct", width: 14 },
    { header: "Source Split %", key: "sourceSplitPct", width: 14 },
    { header: "Own Gain/Loss", key: "ownGainLoss", width: 16 },
    { header: "Ledger Commission", key: "incomingCommissionLedger", width: 18 },
    { header: "Stored Comm Credit", key: "storedCommissionCredit", width: 18 },
    { header: "Commission Diff", key: "commissionDifference", width: 16 },
    { header: "Calculated Ending", key: "calculatedEnding", width: 18 },
    { header: "Stored Ending", key: "storedEnding", width: 18 },
    { header: "Balance Diff", key: "balanceDifference", width: 14 },
    { header: "Status", key: "status", width: 22 }
  ];

  dataset.forEach(row => {
    sheet.addRow(row);
  });

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename=accounting_consistency_report_${new Date().toISOString().slice(0,10)}.xlsx`);

  await workbook.xlsx.write(res);
  return res.end();
}
