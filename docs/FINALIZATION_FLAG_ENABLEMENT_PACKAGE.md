# Production Accounting Finalization Flag Enablement Package

**Target System:** ForexPage Production (`https://4xtrack.com`)  
**Status:** **`DRAFT_PENDING_EXPLICIT_AUTHORIZATION (NO MUTATIONS EXECUTED)`**

---

## 1. Overview & Purpose

The monthly accounting finalization engine is guarded by an application environment variable (`ACCOUNTING_FINALIZATION_ENABLED`). When this variable is unset or `false`, the finalization endpoint (`POST /api/admin/accounting/finalize`) safely rejects any mutating month-close request with an HTTP 503 `FINALIZATION_DISABLED` error while allowing dry-run previews.

This package defines the exact procedure to enable the feature flag when the fund administrator (Josh Stout) is ready to execute month-close operations.

---

## 2. Configuration Details

* **Hosting Platform:** Vercel (Production Environment)
* **Environment Variable:** `ACCOUNTING_FINALIZATION_ENABLED`
* **Current State:** `UNPROVEN / DEFAULT_DISABLED`
* **Target Value:** `"true"`
* **Target Scope:** Production (and Preview/Development if desired)

---

## 3. Step-by-Step Enablement Procedure

1. **Access Vercel Dashboard:**
   * Navigate to the project settings for `ForexPage` (or linked production domain `4xtrack.com`).
   * Open **Settings** $\to$ **Environment Variables**.
2. **Add / Update Variable:**
   * Key: `ACCOUNTING_FINALIZATION_ENABLED`
   * Value: `true`
   * Environments: `Production`
   * Click **Save**.
3. **Trigger Redeployment:**
   * Go to **Deployments** $\to$ select the latest `main` branch deployment $\to$ click **Redeploy** (to ensure the new environment variable is injected into serverless function runtimes).

---

## 4. Post-Deployment Verification (Non-Mutating)

Execute a dry-run test from the admin console or via API to ensure the endpoint is active without performing database writes:

```bash
# Verify dry-run response (returns HTTP 200 with SUCCESS_DRY_RUN instead of HTTP 503)
curl -X POST https://4xtrack.com/api/admin/accounting/finalize \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -d '{"year": 2026, "month": 8, "dryRun": true}'
```

---

## 5. Instant Rollback / Kill-Switch Procedure

If month-close operations need to be immediately locked down:
1. In Vercel Environment Variables, set `ACCOUNTING_FINALIZATION_ENABLED="false"`.
2. Redeploy the latest commit.
3. The API will immediately revert to blocking any mutating finalization requests.
