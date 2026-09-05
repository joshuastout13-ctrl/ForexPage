import { supabase } from "./supabase.js";

export const TARGET_PRODUCTION_PROJECT_ID = "julhldzkiqdeuuoqmvlo";

/**
 * Checks whether the environment is actively connected to the authoritative
 * production Supabase database (project julhldzkiqdeuuoqmvlo).
 */
export function isAuthoritativeProductionDbConfigured() {
  const url = process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key || !supabase) return false;
  return url.toLowerCase().includes(TARGET_PRODUCTION_PROJECT_ID.toLowerCase());
}

/**
 * Asserts that the authoritative production database is available and verified.
 * 
 * Strict Fail-Closed Rule:
 * Any operation that will mutate financial production data or evaluate a mutation
 * preflight MUST verify against authoritative production Supabase.
 * Proof of absence or data state cannot rely on:
 * - Google Sheets fallback
 * - local fixtures
 * - certification JSON
 * - cached API data
 * - historical snapshots
 * 
 * Throws AUTHORITATIVE_PRODUCTION_DB_UNAVAILABLE if requirements are not met.
 */
export async function assertAuthoritativeProductionDb(context = "financial_mutation") {
  if (process.env.NODE_ENV === "test" && process.env.ALLOW_MOCK_AUTHORITATIVE === "true") {
    // Controlled testing override explicitly permitted only under test runner
    return true;
  }

  if (!isAuthoritativeProductionDbConfigured()) {
    const errorMsg = `AUTHORITATIVE_PRODUCTION_DB_UNAVAILABLE: Financial mutation/preflight [${context}] blocked. Authoritative production database (${TARGET_PRODUCTION_PROJECT_ID}) is not connected. Fallback to Google Sheets or local mock is strictly prohibited for writes.`;
    console.error(`[FinancialMutationGuard] ${errorMsg}`);
    throw new Error(errorMsg);
  }

  // Live connectivity verification ping
  try {
    const { data, error } = await supabase.from("investors").select("id").limit(1);
    if (error) {
      throw new Error(`Connectivity check failed: ${error.message}`);
    }
  } catch (err) {
    const pingError = `AUTHORITATIVE_PRODUCTION_DB_UNAVAILABLE: Financial mutation/preflight [${context}] ping to ${TARGET_PRODUCTION_PROJECT_ID} failed: ${err.message}`;
    console.error(`[FinancialMutationGuard] ${pingError}`);
    throw new Error(pingError);
  }

  return true;
}

/**
 * Asserts that a verifiable audit actor (admin user ID, service worker name, etc.) is present.
 */
export function assertAuditActor(actor, context = "mutation") {
  const clean = String(actor || "").trim();
  if (!clean || clean.toLowerCase() === "anonymous" || clean.toLowerCase() === "unknown") {
    throw new Error(`AUDIT_ACTOR_REQUIRED: Financial mutation [${context}] requires a verified audit actor. Received: '${actor}'`);
  }
  return clean;
}

/**
 * Validates or constructs a deterministic idempotency key for financial transactions and corrections.
 * Prohibits random() or unconstrained UUIDs for historical adjustments.
 */
export function buildDeterministicIdempotencyKey({ type, investorId, effectiveDate, amountCents, purpose }) {
  if (!type || !investorId || !effectiveDate || amountCents === undefined || !purpose) {
    throw new Error("INVALID_IDEMPOTENCY_PARAMETERS: type, investorId, effectiveDate, amountCents, and purpose are required.");
  }

  const cleanPurpose = String(purpose).trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_");
  const cleanType = String(type).trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_");
  const cleanInv = String(investorId).trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_");
  
  if (cleanPurpose.includes("random") || cleanPurpose.includes("uuid")) {
    throw new Error("NON_DETERMINISTIC_KEY_PROHIBITED: Historical corrections must use deterministic purpose labels, not random tokens.");
  }

  return `${cleanType}:${cleanInv}:${effectiveDate}:${amountCents}:${cleanPurpose}`;
}

/**
 * Asserts that preflight data was retrieved from an authoritative source.
 */
export function assertAuthoritativePreflight(preflightSource, context = "mutation_preflight") {
  if (!preflightSource || preflightSource !== "AUTHORITATIVE_PRODUCTION_DB") {
    throw new Error(`NONAUTHORITATIVE_PREFLIGHT_BLOCKED: Financial mutation [${context}] cannot be authorized from source '${preflightSource || "UNKNOWN"}'. Must be AUTHORITATIVE_PRODUCTION_DB.`);
  }
  return true;
}
