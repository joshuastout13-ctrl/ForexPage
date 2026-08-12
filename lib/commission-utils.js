/**
 * Commission Shares — Effective Date Rule Selection Utilities
 *
 * Centralized helper for selecting the correct commission_shares row(s)
 * applicable to a specific year/month period.
 *
 * RULES:
 *   periodStart = YYYY-MM-01
 *   periodEnd   = last day of YYYY-MM
 *
 *   A rule is applicable when:
 *     effective_start_date <= periodEnd
 *     AND (effective_end_date IS NULL  OR  effective_end_date >= periodStart)
 *
 *   Cancelled rows are always excluded.
 *   "ended" rows are valid for historical months (their date range determines applicability).
 *
 * TIMEZONE SAFETY:
 *   All date comparisons use YYYY-MM-DD string comparison (lexicographic),
 *   avoiding Date object timezone pitfalls entirely.
 */

/**
 * Returns ALL commission_shares rows applicable to a given period,
 * optionally filtered by source and/or recipient investor ID.
 *
 * @param {Object} options
 * @param {Array}  options.shares - The full unifiedSharesTable array
 * @param {number} options.year - The period year (e.g. 2026)
 * @param {number} options.month - The period month (1-12)
 * @param {string} [options.sourceInvestorId] - Filter by source investor ID (case-insensitive)
 * @param {Set|string} [options.sourceIdSet] - Set of lowercase source IDs to match against
 * @param {string} [options.recipientInvestorId] - Filter by recipient investor ID (case-insensitive)
 * @param {Set|string} [options.recipientIdSet] - Set of lowercase recipient IDs to match against
 * @returns {Array} Matching commission_shares rows
 */
export function getApplicableCommissionShares({
  shares = [],
  year,
  month,
  sourceInvestorId,
  sourceIdSet,
  recipientInvestorId,
  recipientIdSet
}) {
  // Build period date strings for lexicographic comparison
  const periodStart = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate(); // month is 1-based, Date uses 0-based for next month's day 0
  const periodEnd = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  // Normalize filter sets
  const srcSet = normalizeIdSet(sourceInvestorId, sourceIdSet);
  const recSet = normalizeIdSet(recipientInvestorId, recipientIdSet);

  return shares.filter(rule => {
    // 1. Exclude cancelled rows
    if (rule.status === 'cancelled') return false;

    // 2. Source filter (if provided)
    if (srcSet && !srcSet.has(String(rule.source_investor_id || '').toLowerCase())) return false;

    // 3. Recipient filter (if provided)
    if (recSet && !recSet.has(String(rule.recipient_investor_id || '').toLowerCase())) return false;

    // 4. Effective date range overlap check
    const ruleStart = String(rule.effective_start_date || '2000-01-01');
    const ruleEnd = rule.effective_end_date ? String(rule.effective_end_date) : null;

    // Rule must have started on or before the period ends
    if (ruleStart > periodEnd) return false;

    // If rule has an end date, it must not have ended before the period starts
    if (ruleEnd !== null && ruleEnd < periodStart) return false;

    return true;
  });
}

/**
 * Returns the SINGLE best-matching commission_shares row for a specific
 * source→recipient pair in a given period. If multiple applicable rows exist
 * (shouldn't happen with correct data), returns the one with the latest
 * effective_start_date.
 *
 * @param {Object} options - Same as getApplicableCommissionShares
 * @returns {Object|null} The applicable share row, or null if none found
 */
export function getApplicableCommissionShare(options) {
  const applicable = getApplicableCommissionShares(options);
  if (applicable.length === 0) return null;
  if (applicable.length === 1) return applicable[0];

  // Multiple matches: warn about configuration overlap, then prefer latest start date
  console.warn(
    `[CommissionUtils] OVERLAP: ${applicable.length} rules found for ` +
    `source=${applicable[0]?.source_investor_id} → recipient=${applicable[0]?.recipient_investor_id} ` +
    `in ${options.year}-${String(options.month).padStart(2, '0')}. ` +
    `Selecting latest start date. Percents: ${applicable.map(r => r.commission_percent + '%').join(', ')}`
  );
  return applicable.sort((a, b) => {
    const aStart = String(a.effective_start_date || '2000-01-01');
    const bStart = String(b.effective_start_date || '2000-01-01');
    return bStart.localeCompare(aStart); // descending
  })[0];
}

/**
 * Normalizes an investor ID or ID set into a lowercase Set for matching.
 * @param {string} [singleId]
 * @param {Set|string} [idSet]
 * @returns {Set|null}
 */
function normalizeIdSet(singleId, idSet) {
  if (idSet instanceof Set) return idSet;
  if (typeof idSet === 'string') return new Set([idSet.toLowerCase()]);
  if (typeof singleId === 'string') return new Set([singleId.toLowerCase()]);
  return null;
}
