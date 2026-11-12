import Decimal from "decimal.js";
import { getApplicableCommissionShares } from "../../lib/commission-utils.js";

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

/**
 * Standalone calculation helper for unposted October commission candidates (AUDIT / TEST ONLY).
 *
 * CRITICAL SAFEGUARDS:
 * 1. Strictly decoupled from the investor API, buildInvestorDashboard, and api/me.js.
 *    Never exposed in investor payloads or serialized in responses.
 * 2. Strictly ALL-OR-NOTHING fail-closed:
 *    - Returns { status: "UNAVAILABLE", totalAmount: null, reason: ... } if ANY required
 *      input is missing or invalid: gross return rate, provenance, source investor record,
 *      start_date, split_pct, commission_percent, monthly history row, or opening balance.
 *    - NEVER silently omits an input to return a partial total.
 * 3. Legitimate pre-start accounts (e.g. participation start_date = 2026-11-01)
 *    strictly contribute $0.00 without making the calculation unavailable.
 * 4. Outputs are explicitly labeled as unposted estimates/simulations with unlocked status.
 * 5. For Joshua Stout, policies remain UNRESOLVED; returns both alternatives or requires
 *    an explicit policy option ('date_effective' | 'legacy_75').
 *
 * @param {Object} params
 * @param {string} params.recipientId - Recipient investor ID or username
 * @param {Array}  params.shares - Commission shares table
 * @param {Array}  params.rawInvestors - Raw investor records with start_date and split_pct
 * @param {Array}  params.historyTable - Monthly history table for opening balance
 * @param {number|Decimal} params.candidateGrossReturnPct - Gross return pct (REQUIRED; fails closed if omitted)
 * @param {Object|string}  [params.returnProvenance] - Return rate provenance (REQUIRED or defaults to unlocked simulation)
 * @param {Object} [params.options={}] - Options (e.g., stoutTreatment: 'date_effective' | 'legacy_75')
 * @returns {Object} All-or-nothing candidate calculation result
 */
export function calculateUnpostedOctoberCandidate({
  recipientId,
  shares = [],
  rawInvestors = [],
  historyTable = [],
  candidateGrossReturnPct,
  returnProvenance = null,
  options = {}
}) {
  const rid = String(recipientId || "").trim().toLowerCase();
  if (!rid) {
    return {
      status: "UNAVAILABLE",
      reason: "MISSING_RECIPIENT_ID",
      totalAmount: null,
      estimateStatus: "UNAVAILABLE",
      sharesCount: 0,
      rules: []
    };
  }

  // 1. Return rate validation (Strict fail-closed: never guess 3.05 or accept <= 0)
  if (
    candidateGrossReturnPct === undefined ||
    candidateGrossReturnPct === null ||
    isNaN(Number(candidateGrossReturnPct)) ||
    Number(candidateGrossReturnPct) <= 0
  ) {
    return {
      status: "UNAVAILABLE",
      reason: "MISSING_OR_INVALID_GROSS_RETURN_RATE",
      totalAmount: null,
      estimateStatus: "UNAVAILABLE",
      sharesCount: 0,
      rules: []
    };
  }
  const grossReturnRate = new Decimal(candidateGrossReturnPct).div(100);

  // Provenance metadata (truthful disclosure of unlocked return status)
  const provenanceInfo = returnProvenance || {
    source: "monthly_returns (unlocked / unposted)",
    year: 2026,
    month: 10,
    rate: Number(candidateGrossReturnPct),
    locked: false
  };

  // 2. Identify recipient investor ID set
  const recipientInvestor = (rawInvestors || []).find((i) => {
    const id = String(i.id || i.investorid || i.investorsinvestorid || "").trim().toLowerCase();
    const u = String(i.portal_username || i.portalusername || i.username || "").trim().toLowerCase();
    return id === rid || u === rid;
  });

  const recipientIdSet = new Set([
    rid,
    recipientInvestor ? String(recipientInvestor.id || "").toLowerCase() : null,
    recipientInvestor ? String(recipientInvestor.portal_username || recipientInvestor.portalusername || "").toLowerCase() : null
  ].filter(Boolean));

  // Determine whether recipient is Joshua Stout
  const isStout = recipientIdSet.has("stout001") || recipientIdSet.has("jstout");

  // 3. Filter applicable shares using canonical rule date logic from lib/commission-utils.js
  const applicableShares = getApplicableCommissionShares({
    shares,
    year: 2026,
    month: 10,
    recipientIdSet
  });

  // Check for duplicate rules on the same source->recipient pair
  const seenSources = new Set();
  for (const s of applicableShares) {
    const srcKey = String(s.source_investor_id || s.source_id || s.sourceinvestorid || "").trim().toLowerCase();
    if (seenSources.has(srcKey)) {
      return {
        status: "UNAVAILABLE",
        reason: `DUPLICATE_RULES_DETECTED: Multiple active rules for source ${srcKey}`,
        totalAmount: null,
        estimateStatus: "UNAVAILABLE",
        sharesCount: 0,
        rules: []
      };
    }
    seenSources.add(srcKey);
  }

  // Helper to compute rules array and check all-or-nothing invariants
  const evaluatedRules = [];
  let totalCommDateEff = new Decimal(0);
  let totalCommLegacy = new Decimal(0);

  for (const share of applicableShares) {
    const sid = String(share.source_investor_id || share.source_id || share.sourceinvestorid || "").trim().toLowerCase();

    // Check source investor existence
    const sourceInvestor = (rawInvestors || []).find((i) => {
      const id = String(i.id || i.investorid || i.investorsinvestorid || "").toLowerCase();
      const u = String(i.portal_username || i.portalusername || i.username || "").toLowerCase();
      return id === sid || u === sid;
    });

    if (!sourceInvestor) {
      return {
        status: "UNAVAILABLE",
        reason: `MISSING_SOURCE_INVESTOR: No investor record found for source ${sid}`,
        totalAmount: null,
        estimateStatus: "UNAVAILABLE",
        sharesCount: 0,
        rules: []
      };
    }

    // A. Participation start date check (Strict fail-closed: must be present and valid)
    const rawStart = sourceInvestor.start_date ?? sourceInvestor.opendate ?? sourceInvestor.startdate;
    if (!rawStart || String(rawStart).trim() === "") {
      return {
        status: "UNAVAILABLE",
        reason: `MISSING_START_DATE: Source ${sourceInvestor.portal_username || sid} has no participation start_date`,
        totalAmount: null,
        estimateStatus: "UNAVAILABLE",
        sharesCount: 0,
        rules: []
      };
    }

    const srcStart = new Date(String(rawStart).trim());
    if (isNaN(srcStart.getTime())) {
      return {
        status: "UNAVAILABLE",
        reason: `INVALID_START_DATE: Source ${sourceInvestor.portal_username || sid} has unparseable start_date "${rawStart}"`,
        totalAmount: null,
        estimateStatus: "UNAVAILABLE",
        sharesCount: 0,
        rules: []
      };
    }

    // Pre-start check: If participation began after October 31, 2026 (e.g. 2026-11-01),
    // strictly contributes $0.00 October eligible capital and $0.00 commission.
    const isPreStart =
      srcStart.getUTCFullYear() > 2026 ||
      (srcStart.getUTCFullYear() === 2026 && srcStart.getUTCMonth() + 1 > 10);

    if (isPreStart) {
      evaluatedRules.push({
        shareId: share.id,
        sourceId: sid,
        sourceUsername: sourceInvestor.portal_username,
        eligibleCapital: 0,
        splitPct: Number(sourceInvestor.split_pct || 0),
        commPct: Number(share.commission_percent || 0),
        ruleComm: 0,
        isPreStart: true,
        note: `Pre-start account (start_date: ${rawStart}); $0.00 October trading participation`
      });
      continue;
    }

    // B. Source split percentage check (Strict fail-closed: NEVER default to 100%)
    const rawSplit = sourceInvestor.split_pct ?? sourceInvestor.investorsplit;
    if (rawSplit === undefined || rawSplit === null || isNaN(Number(rawSplit)) || Number(rawSplit) <= 0) {
      return {
        status: "UNAVAILABLE",
        reason: `MISSING_OR_INVALID_SPLIT_PCT: Source ${sourceInvestor.portal_username || sid} has invalid split_pct (${rawSplit})`,
        totalAmount: null,
        estimateStatus: "UNAVAILABLE",
        sharesCount: 0,
        rules: []
      };
    }
    const splitPct = new Decimal(Number(rawSplit)).div(100);

    // C. Commission percent on rule (Strict fail-closed: must be valid number > 0)
    const commPctNum = Number(share.commission_percent);
    if (isNaN(commPctNum) || commPctNum <= 0) {
      return {
        status: "UNAVAILABLE",
        reason: `INVALID_COMMISSION_PERCENT: Rule ${share.id || sid} has invalid commission_percent (${share.commission_percent})`,
        totalAmount: null,
        estimateStatus: "UNAVAILABLE",
        sharesCount: 0,
        rules: []
      };
    }
    const commPct = new Decimal(commPctNum).div(100);

    // D. Source capital basis from historyTable (Strict fail-closed: opening_balance required)
    const sourceIdSet = new Set([
      sid,
      String(sourceInvestor.id || "").toLowerCase(),
      String(sourceInvestor.portal_username || sourceInvestor.portalusername || "").toLowerCase()
    ].filter(Boolean));

    const srcHist = (historyTable || []).find(
      (h) =>
        sourceIdSet.has(String(h.investor_id || h.investorid || "").trim().toLowerCase()) &&
        Number(h.year) === 2026 &&
        Number(h.month_number) === 10
    );

    if (!srcHist) {
      return {
        status: "UNAVAILABLE",
        reason: `MISSING_OCTOBER_HISTORY_ROW: Source ${sourceInvestor.portal_username || sid} missing 2026-10 history record`,
        totalAmount: null,
        estimateStatus: "UNAVAILABLE",
        sharesCount: 0,
        rules: []
      };
    }

    const rawOpening = Number(srcHist.opening_balance);
    if (isNaN(rawOpening) || rawOpening <= 0) {
      return {
        status: "UNAVAILABLE",
        reason: `MISSING_OR_NON_POSITIVE_OPENING_BALANCE: Source ${sourceInvestor.portal_username || sid} has opening_balance ${srcHist.opening_balance} (no fallback to ending_balance allowed)`,
        totalAmount: null,
        estimateStatus: "UNAVAILABLE",
        sharesCount: 0,
        rules: []
      };
    }

    const sourceEligibleCapital = new Decimal(rawOpening)
      .add(new Decimal(Number(srcHist.deposits || 0)))
      .sub(new Decimal(Number(srcHist.withdrawals || 0)));

    if (sourceEligibleCapital.lte(0)) {
      return {
        status: "UNAVAILABLE",
        reason: `NON_POSITIVE_ELIGIBLE_CAPITAL: Source ${sourceInvestor.portal_username || sid} computed eligible capital <= 0 (${sourceEligibleCapital.toNumber()})`,
        totalAmount: null,
        estimateStatus: "UNAVAILABLE",
        sharesCount: 0,
        rules: []
      };
    }

    // Calculation: sourceEligibleCapital * grossReturnRate * splitPct * commPct
    const grossGain = sourceEligibleCapital.mul(grossReturnRate);
    const netGain = grossGain.mul(splitPct);
    const ruleComm = netGain.mul(commPct).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

    totalCommDateEff = totalCommDateEff.add(ruleComm);

    // Stout legacy baseline: exclude rules effective on or after 2026-10-01
    const ruleStartStr = String(share.effective_start_date || share.effectivestartdate || "");
    const isMidOctoberRule = ruleStartStr >= "2026-10-01";
    if (!isMidOctoberRule) {
      totalCommLegacy = totalCommLegacy.add(ruleComm);
    }

    evaluatedRules.push({
      shareId: share.id,
      sourceId: sid,
      sourceUsername: sourceInvestor.portal_username,
      eligibleCapital: sourceEligibleCapital.toNumber(),
      splitPct: Number(rawSplit),
      commPct: commPctNum,
      ruleComm: ruleComm.toNumber(),
      effectiveStartDate: ruleStartStr,
      isMidOctoberAddition: isMidOctoberRule
    });
  }

  // 4. Handle Joshua Stout Policy Ambiguity honestly
  if (isStout) {
    const stoutAlternatives = {
      dateEffective85: totalCommDateEff.toNumber(),
      legacy75: totalCommLegacy.toNumber(),
      delta: totalCommDateEff.sub(totalCommLegacy).toNumber(),
      policyStatus: "UNRESOLVED"
    };

    const requestedTreatment = options.stoutTreatment || (options.useLegacyStoutBaseline ? "legacy_75" : null);

    if (requestedTreatment === "legacy_75") {
      return {
        status: "AVAILABLE",
        estimateStatus: "UNPOSTED_ESTIMATE",
        returnRateLocked: false,
        isSimulation: true,
        recipientId: rid,
        candidateGrossReturnPct: Number(candidateGrossReturnPct),
        totalAmount: totalCommLegacy.toNumber(),
        sharesCount: evaluatedRules.length,
        policyStatus: "UNRESOLVED (legacy 75 shares alternative selected)",
        stoutAlternatives,
        provenance: provenanceInfo,
        rules: evaluatedRules
      };
    } else if (requestedTreatment === "date_effective") {
      return {
        status: "AVAILABLE",
        estimateStatus: "UNPOSTED_ESTIMATE",
        returnRateLocked: false,
        isSimulation: true,
        recipientId: rid,
        candidateGrossReturnPct: Number(candidateGrossReturnPct),
        totalAmount: totalCommDateEff.toNumber(),
        sharesCount: evaluatedRules.length,
        policyStatus: "UNRESOLVED (date-effective 85 shares alternative selected)",
        stoutAlternatives,
        provenance: provenanceInfo,
        rules: evaluatedRules
      };
    } else {
      // No explicit policy option selected: do not pick a default
      return {
        status: "UNRESOLVED_POLICY_SELECTION_REQUIRED",
        estimateStatus: "UNPOSTED_ESTIMATE",
        returnRateLocked: false,
        isSimulation: true,
        recipientId: rid,
        candidateGrossReturnPct: Number(candidateGrossReturnPct),
        totalAmount: null,
        sharesCount: evaluatedRules.length,
        policyStatus: "UNRESOLVED (requires explicit selection of date_effective or legacy_75)",
        stoutAlternatives,
        provenance: provenanceInfo,
        rules: evaluatedRules
      };
    }
  }

  // 5. Normal recipients (resolved single policy)
  return {
    status: "AVAILABLE",
    estimateStatus: "UNPOSTED_ESTIMATE",
    returnRateLocked: false,
    isSimulation: true,
    recipientId: rid,
    candidateGrossReturnPct: Number(candidateGrossReturnPct),
    totalAmount: totalCommDateEff.toNumber(),
    sharesCount: evaluatedRules.length,
    policyStatus: "RESOLVED",
    stoutAlternatives: null,
    provenance: provenanceInfo,
    rules: evaluatedRules
  };
}

