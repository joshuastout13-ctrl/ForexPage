import { verifyAdminSession } from "../../../../lib/adminAuth.js";
import { supabase as defaultSupabase } from "../../../../lib/supabase.js";

const DEFAULT_PAGE_SIZE = 1000;
const DEFAULT_MAX_ROWS = 50000;
const DEFAULT_MAX_REQUESTS = 1000;

function safeSerializeValue(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function buildPageFingerprint(rows, orderBy) {
  const keys = [];
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (!row || typeof row !== "object" || row[orderBy] === undefined || row[orderBy] === null) {
      return `rows:${safeSerializeValue(rows)}`;
    }
    const keyVal = row[orderBy];
    keys.push([typeof keyVal, String(keyVal)]);
  }
  return `keys:${JSON.stringify(keys)}`;
}

/**
 * Route-local deterministic range pagination for read-only cashflows review queries.
 *
 * Pagination semantics and fail-closed guards:
 * - Uses deterministic ascending primary-key ordering (`orderBy`, default `"id"`) and `.range()` requests.
 * - Advances the offset by `data.length` and continues after short, nonempty pages so smaller server-side
 *   page caps do not truncate results. Only an empty array (`[]`) signals end-of-data.
 * - Fails with an error instead of returning partial results on query errors, malformed/null/non-array
 *   page data, repeated pages, lack of progress, duplicate/overlapping row IDs, row-limit overflow
 *   (allows up to exactly `maxRows` when the subsequent page is empty; throws if results exceed `maxRows`),
 *   or request-limit overflow (`maxRequests`).
 *
 * Snapshot / offset-drift limitation:
 * - Separate `.range()` requests (and the parallel reads across `deposits`, `withdrawals`, and `investors`)
 *   do NOT provide a consistent database snapshot.
 * - If rows are inserted, deleted, or updated in ways that alter filter membership while pagination is
 *   running, offset drift can occur: deletions or filter exclusions before the current offset may skip rows
 *   without detection, whereas insertions before the current offset can shift previously returned rows into
 *   a later page (rejected fail-closed via duplicate-ID detection rather than silently double-counting).
 */
async function readAllRowsPaginated(db, table, options = {}) {
  const {
    select = "*",
    orderBy = "id",
    applyFilters = null,
    pageSize = DEFAULT_PAGE_SIZE,
    maxRows = DEFAULT_MAX_ROWS,
    maxRequests = DEFAULT_MAX_REQUESTS
  } = options;

  if (!db || typeof db.from !== "function") {
    throw new Error(`CashflowsReview pagination("${table}"): database client is not initialized`);
  }
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 1000) {
    throw new Error(`CashflowsReview pagination("${table}"): pageSize must be an integer between 1 and 1000`);
  }
  if (!Number.isSafeInteger(maxRows) || maxRows < 1) {
    throw new Error(`CashflowsReview pagination("${table}"): maxRows must be a positive integer`);
  }
  if (!Number.isSafeInteger(maxRequests) || maxRequests < 1) {
    throw new Error(`CashflowsReview pagination("${table}"): maxRequests must be a positive integer`);
  }

  const allRows = [];
  const seenPageFingerprints = new Set();
  const seenRowKeys = new Set();
  let offset = 0;
  let requests = 0;

  while (true) {
    if (requests >= maxRequests) {
      throw new Error(
        `CashflowsReview pagination("${table}") exceeded maxRequests limit (${maxRequests}) at offset ${offset} after ${allRows.length} rows`
      );
    }
    requests += 1;

    const rangeStart = offset;
    const rangeEnd = offset + pageSize - 1;
    if (!Number.isSafeInteger(rangeStart) || !Number.isSafeInteger(rangeEnd) || rangeEnd < rangeStart) {
      throw new Error(
        `CashflowsReview pagination("${table}") computed invalid range [${rangeStart}, ${rangeEnd}] on request ${requests}`
      );
    }

    let query = db.from(table).select(select);
    if (typeof applyFilters === "function") {
      query = applyFilters(query);
    }
    query = query.order(orderBy, { ascending: true }).range(rangeStart, rangeEnd);

    const response = await query;
    if (!response || typeof response !== "object") {
      throw new Error(
        `CashflowsReview pagination("${table}") request ${requests} (offset ${rangeStart}) returned an invalid response`
      );
    }

    const { data, error } = response;
    if (error) {
      const errorMessage = error.message || String(error);
      throw new Error(
        `CashflowsReview pagination("${table}") request ${requests} (offset ${rangeStart}) failed: ${errorMessage}`
      );
    }

    if (!Array.isArray(data)) {
      const receivedType = data === null ? "null" : typeof data;
      throw new Error(
        `CashflowsReview pagination("${table}") request ${requests} (offset ${rangeStart}) returned non-array data (${receivedType})`
      );
    }

    // Only an empty array signals end-of-data.
    if (data.length === 0) {
      break;
    }

    for (let i = 0; i < data.length; i += 1) {
      const row = data[i];
      if (!row || typeof row !== "object" || Array.isArray(row)) {
        throw new Error(
          `CashflowsReview pagination("${table}") request ${requests} (offset ${rangeStart}) returned invalid non-object row at index ${i}`
        );
      }
    }

    const pageFingerprint = buildPageFingerprint(data, orderBy);
    if (seenPageFingerprints.has(pageFingerprint)) {
      throw new Error(
        `CashflowsReview pagination("${table}") request ${requests} (offset ${rangeStart}) returned a repeated page`
      );
    }
    seenPageFingerprints.add(pageFingerprint);

    let rowsWithOrderKey = 0;
    let newUniqueKeysOnPage = 0;
    const currentPageKeys = new Set();
    let duplicateKeyInPage = null;
    let overlappingKeyAcrossPages = null;

    for (let i = 0; i < data.length; i += 1) {
      const keyVal = data[i][orderBy];
      if (keyVal === undefined || keyVal === null) {
        continue;
      }
      rowsWithOrderKey += 1;
      const typedKey = `${typeof keyVal}:${String(keyVal)}`;
      if (currentPageKeys.has(typedKey)) {
        duplicateKeyInPage = String(keyVal);
      } else {
        currentPageKeys.add(typedKey);
        if (seenRowKeys.has(typedKey)) {
          overlappingKeyAcrossPages = String(keyVal);
        } else {
          newUniqueKeysOnPage += 1;
        }
      }
    }

    if (rowsWithOrderKey > 0) {
      if (rowsWithOrderKey === data.length && newUniqueKeysOnPage === 0) {
        throw new Error(
          `CashflowsReview pagination("${table}") request ${requests} (offset ${rangeStart}) made no progress (all rows already seen)`
        );
      }
      if (duplicateKeyInPage !== null) {
        throw new Error(
          `CashflowsReview pagination("${table}") request ${requests} (offset ${rangeStart}) returned duplicate ${orderBy} "${duplicateKeyInPage}" within page`
        );
      }
      if (overlappingKeyAcrossPages !== null) {
        throw new Error(
          `CashflowsReview pagination("${table}") request ${requests} (offset ${rangeStart}) returned already-seen ${orderBy} "${overlappingKeyAcrossPages}" (possible offset drift or non-advancing range)`
        );
      }
    }

    // Allow up to exactly maxRows; throw if total rows would exceed maxRows.
    // When allRows.length reaches maxRows, the next iteration verifies the following page is empty.
    if (allRows.length + data.length > maxRows) {
      throw new Error(
        `CashflowsReview pagination("${table}") exceeded maxRows limit (${maxRows}) on request ${requests} (offset ${rangeStart})`
      );
    }

    for (const typedKey of currentPageKeys) {
      seenRowKeys.add(typedKey);
    }

    allRows.push(...data);

    const nextOffset = offset + data.length;
    if (!Number.isSafeInteger(nextOffset) || nextOffset <= offset) {
      throw new Error(
        `CashflowsReview pagination("${table}") request ${requests} made no offset progress from ${offset}`
      );
    }
    offset = nextOffset;
  }

  return allRows;
}

/**
 * READ-ONLY Admin Endpoint for Cashflows Review & Effective Accounting Date Inspection.
 * Lists current August deposits and withdrawals with proposed effective accounting dates.
 * Performs ZERO financial writes.
 * Note: Paginated table reads execute as separate requests and do not form a single
 * database snapshot; concurrent data changes during pagination can cause offset drift.
 */
export default async function handler(req, res, deps = {}) {
  const auth = verifyAdminSession(req);
  if (!auth) {
    return res.status(401).json({ error: "Unauthorized", message: "Admin authentication required." });
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const resolvedDeps = deps && typeof deps === "object" ? deps : {};
    const db = resolvedDeps.supabase !== undefined ? resolvedDeps.supabase : defaultSupabase;
    const paginationOptions =
      resolvedDeps.paginationOptions && typeof resolvedDeps.paginationOptions === "object"
        ? resolvedDeps.paginationOptions
        : {};

    const year = Number(req.query?.year || 2026);
    const month = Number(req.query?.month || 8);
    const prefix = `${year}-${String(month).padStart(2, '0')}`;

    // Parallel paginated fetch of deposits, withdrawals, and investors.
    // Separate page requests do not provide a consistent database snapshot (see offset-drift caveat above).
    const [deposits, withdrawals, investors] = await Promise.all([
      readAllRowsPaginated(db, "deposits", {
        ...paginationOptions,
        select: "*",
        orderBy: "id",
        applyFilters: (q) => q.not("type", "ilike", "VOID")
      }),
      readAllRowsPaginated(db, "withdrawals", {
        ...paginationOptions,
        select: "*",
        orderBy: "id",
        applyFilters: (q) => q.in("status", ["Approved", "Completed", "pending"])
      }),
      readAllRowsPaginated(db, "investors", {
        ...paginationOptions,
        select: "*",
        orderBy: "id"
      })
    ]);

    const investorMap = {};
    investors.forEach(i => {
      investorMap[i.id] = `${i.first_name || ''} ${i.last_name || ''}`.trim() || i.portal_username || i.id;
      if (i.portal_username) investorMap[i.portal_username] = investorMap[i.id];
    });

    // Proposed default effective date for the target accounting month (Day 1)
    const proposedEffectiveDate = `${prefix}-01`;

    // Filter August deposits
    const periodDeposits = deposits.filter(d => {
      const dateStr = String(d.date || d.created_at || '');
      return dateStr.startsWith(prefix);
    }).map(d => ({
      id: d.id,
      cashflowType: "DEPOSIT",
      investorId: d.investor_id,
      investorName: investorMap[d.investor_id] || d.investor_id,
      amount: Number(d.amount || 0),
      entryRecordedDate: d.date || d.created_at,
      currentEffectiveAccountingDate: d.effective_accounting_date || null,
      proposedEffectiveAccountingDate: d.effective_accounting_date || proposedEffectiveDate,
      isFirstDay: d.effective_accounting_date ? d.effective_accounting_date.endsWith("-01") : new Date(d.date).getUTCDate() === 1,
      reviewStatus: d.effective_accounting_date ? "CONFIRMED" : "PROPOSED_UNAPPLIED"
    }));

    // Filter August withdrawals
    const periodWithdrawals = withdrawals.filter(w => {
      const ws = String(w.request_date || w.date || w.created_at || '');
      const yr = w.year || (ws ? new Date(ws).getUTCFullYear() : null);
      const m = w.month_number || (ws ? new Date(ws).getUTCMonth() + 1 : null);
      return (yr === year && m === month) || ws.startsWith(prefix);
    }).map(w => ({
      id: w.id,
      cashflowType: "WITHDRAWAL",
      investorId: w.investor_id,
      investorName: investorMap[w.investor_id] || w.investor_id,
      amount: Number(w.amount || 0),
      entryRecordedDate: w.request_date || w.date || w.created_at,
      currentEffectiveAccountingDate: w.effective_accounting_date || null,
      proposedEffectiveAccountingDate: w.effective_accounting_date || proposedEffectiveDate,
      isFirstDay: w.effective_accounting_date ? w.effective_accounting_date.endsWith("-01") : new Date(w.request_date || w.date).getUTCDate() === 1,
      reviewStatus: w.effective_accounting_date ? "CONFIRMED" : "PROPOSED_UNAPPLIED"
    }));

    const totalDepositAmount = periodDeposits.reduce((s, d) => s + d.amount, 0);
    const totalWithdrawalAmount = periodWithdrawals.reduce((s, w) => s + w.amount, 0);

    return res.status(200).json({
      status: "SUCCESS_READ_ONLY",
      period: prefix,
      defaultProposedEffectiveDate: proposedEffectiveDate,
      summary: {
        totalDepositsCount: periodDeposits.length,
        totalDepositAmount: Number(totalDepositAmount.toFixed(2)),
        totalWithdrawalsCount: periodWithdrawals.length,
        totalWithdrawalAmount: Number(totalWithdrawalAmount.toFixed(2)),
        allProposedDatesAreDay1: periodDeposits.every(d => d.proposedEffectiveAccountingDate.endsWith("-01")) && periodWithdrawals.every(w => w.proposedEffectiveAccountingDate.endsWith("-01"))
      },
      deposits: periodDeposits,
      withdrawals: periodWithdrawals,
      note: "Proposed effective dates require admin review before writing to production columns."
    });

  } catch (err) {
    console.error("[CashflowsReview] Error listing cashflows review:", err);
    return res.status(500).json({ error: "CASHFLOWS_REVIEW_FAILED", message: err.message });
  }
}
