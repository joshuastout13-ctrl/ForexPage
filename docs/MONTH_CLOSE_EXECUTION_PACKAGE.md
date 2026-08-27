# Month-Close Execution Package (August 2026 Close)

**Target System:** ForexPage Production (`https://4xtrack.com`)  
**Target Accounting Period:** **August 2026 (`2026-08`)**  
**Status:** **`DRAFT_PENDING_EXPLICIT_AUTHORIZATION (NO MUTATIONS EXECUTED)`**

---

## 1. Pre-Conditions & Preflight Checklist

Before executing the August 2026 month-close finalization, verify:
* `[ ]` **Platform Accounting Continuity:** Confirmed 0 open and 0 ending variances across all 91 active accounts ([`docs/PLATFORM_WIDE_READ_ONLY_SWEEP.sql`](file:///c:/Users/USER/.gemini/antigravity-ide/scratch/ForexPage/docs/PLATFORM_WIDE_READ_ONLY_SWEEP.sql)).
* `[ ]` **Gross Return Capture:** The August 2026 monthly fund gross return % (e.g. trading gain %) is finalized and entered into `monthly_returns` table with `status = 'FROZEN'` or provided in payload.
* `[ ]` **Cutover Invariants:** Jeff Bennion ($2,673,903.44) and Ted Boardwalk ($17.19) cutovers verified intact.
* `[ ]` **Feature Flag Enabled:** `ACCOUNTING_FINALIZATION_ENABLED="true"` active in production environment.

---

## 2. Dry-Run / Preview Execution (Safe & Non-Mutating)

Admin generates a preflight preview via `POST /api/admin/accounting/finalize` with `dryRun: true`:

```json
POST /api/admin/accounting/finalize
Headers: {
  "Authorization": "Bearer <ADMIN_JWT>",
  "Content-Type": "application/json"
}
Body: {
  "year": 2026,
  "month": 8,
  "dryRun": true
}
```

### Expected Dry-Run Response:
* **HTTP Status:** `200 OK`
* **Status:** `"SUCCESS_DRY_RUN"`
* **Control Check:** `"RECONCILED"` (`Math.abs(grossResult - (sourceGain + recipientComm)) < 0.05`)
* **Total Database Writes Performed:** `0`
* **Output:** Captures `inputHash` and `whatWouldChange` manifest (expected 91 history rows + August commission allocations).

---

## 3. Mutating Finalization Execution (Requires Explicit Authorization)

Once preview is approved, submit the authenticated request with `dryRun: false` and the matching `inputHash`:

```json
POST /api/admin/accounting/finalize
Headers: {
  "Authorization": "Bearer <ADMIN_JWT>",
  "Content-Type": "application/json"
}
Body: {
  "year": 2026,
  "month": 8,
  "dryRun": false,
  "inputHash": "<VERIFIED_INPUT_HASH>"
}
```

---

## 4. Post-Finalization Verification

1. **Verify History Persistence:**
   * Query `investor_monthly_history` for `year = 2026 AND month_number = 8` to ensure all 91 active accounts reflect finalized ending balances and return percentages.
2. **Verify Commission Earnings Generation:**
   * Query `commission_earnings` for `year = 2026 AND month_number = 8` to confirm referral allocations are created.
3. **Verify $N \to N+1$ Continuity:**
   * Re-run [`docs/PLATFORM_WIDE_READ_ONLY_SWEEP.sql`](file:///c:/Users/USER/.gemini/antigravity-ide/scratch/ForexPage/docs/PLATFORM_WIDE_READ_ONLY_SWEEP.sql) targeting September 2026 opening balances to ensure August referral earnings roll forward into September opening balances cent-exact.
