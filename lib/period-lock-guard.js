import { supabase as defaultSupabase } from "./supabase.js";

/**
 * Resolves numeric { year, monthNumber } from common cashflow / return payloads.
 */
export function resolvePeriodFromInput({ effectiveDate, effective_accounting_date, date, request_date, year, month, monthNumber, month_number } = {}) {
  const dateStr = effectiveDate || effective_accounting_date || date || request_date || "";
  if (dateStr && /^\d{4}-\d{2}/.test(String(dateStr).trim())) {
    const clean = String(dateStr).trim();
    const y = parseInt(clean.slice(0, 4), 10);
    const m = parseInt(clean.slice(5, 7), 10);
    if (!Number.isNaN(y) && !Number.isNaN(m) && m >= 1 && m <= 12) {
      return { year: y, monthNumber: m };
    }
  }

  const yNum = Number(year);
  const mNum = Number(monthNumber ?? month_number ?? month);
  if (Number.isInteger(yNum) && Number.isInteger(mNum) && mNum >= 1 && mNum <= 12) {
    return { year: yNum, monthNumber: mNum };
  }

  return { year: null, monthNumber: null };
}

/**
 * Throws a 409 PERIOD_LOCKED Error when the target period is FINALIZED or locked.
 * Used across admin cashflow, return, and commission share write endpoints.
 */
export async function assertPeriodUnlocked(client, periodInput, context = "financial_mutation") {
  const db = client || defaultSupabase;
  if (!db) return { unlocked: true, skipped: true };

  const { year, monthNumber } = resolvePeriodFromInput(periodInput);
  if (!year || !monthNumber) {
    return { unlocked: true, year: null, monthNumber: null };
  }

  const [apRes, mrRes] = await Promise.all([
    db
      .from("accounting_periods")
      .select("year, month_number, status")
      .eq("year", year)
      .eq("month_number", monthNumber)
      .eq("status", "FINALIZED")
      .limit(1),
    db
      .from("monthly_returns")
      .select("year, month_number, locked, status")
      .eq("year", year)
      .eq("month_number", monthNumber)
      .limit(1)
  ]);

  if (apRes?.error) {
    throw new Error(`PERIOD_LOCK_CHECK_FAILED: ${apRes.error.message}`);
  }
  if (mrRes?.error) {
    throw new Error(`PERIOD_LOCK_CHECK_FAILED: ${mrRes.error.message}`);
  }

  const isApFinalized = Array.isArray(apRes?.data) && apRes.data.length > 0;
  const mrRow = Array.isArray(mrRes?.data) ? mrRes.data[0] : null;
  const isMrLocked = Boolean(
    mrRow &&
      (mrRow.locked === true ||
        String(mrRow.locked).toLowerCase() === "true" ||
        String(mrRow.status || "").toUpperCase() === "FINALIZED" ||
        String(mrRow.status || "").toUpperCase() === "FINAL_RETURN_CAPTURED")
  );

  if (isApFinalized || isMrLocked) {
    const err = new Error(
      `PERIOD_LOCKED: Accounting period ${year}-${String(monthNumber).padStart(2, "0")} is finalized/locked; ${context} is prohibited.`
    );
    err.code = "PERIOD_LOCKED";
    err.status = 409;
    err.year = year;
    err.monthNumber = monthNumber;
    throw err;
  }

  return { unlocked: true, year, monthNumber };
}

export function isPeriodLockedError(err) {
  if (!err) return false;
  return err.code === "PERIOD_LOCKED" || String(err.message || "").includes("PERIOD_LOCKED");
}

/**
 * Maps any locked-period period overlap or RPC lock error to HTTP 409 / 400 cleanly.
 */
export function getMutationErrorStatus(err, defaultStatus = 500) {
  if (!err) return defaultStatus;
  if (Number.isInteger(err.status)) return err.status;
  const msg = String(err.message || "");
  if (msg.includes("PERIOD_LOCKED")) return 409;
  if (
    msg.includes("OVERLAP") ||
    msg.includes("COMMISSION_POOL_EXCEEDED") ||
    msg.includes("INSUFFICIENT_EQUITY") ||
    msg.includes("INVALID_") ||
    msg.includes("DUPLICATE_")
  ) {
    return 400;
  }
  return defaultStatus;
}
