# Package B — Fail-Closed Concurrency-Safe Withdrawal Control Architecture

**Document Version:** 2.1.0
**Status:** `STAGING_CERTIFIED / READY_FOR_PRODUCTION_AUTHORIZATION`
**Production Baseline:** `87caf6e8979148d56b02a28b08da31349f7e53f0`
**Production Deployment:** `NOT_AUTHORIZED`
**Production Financial Writes:** `0`
**Accounting Finalization:** `HOLD`

---

## 1. Executive Summary & Design Scope

Package B implements an in-database PostgreSQL transaction boundary that guarantees:
> **"A withdrawal must never be saved if it exceeds available account equity."**

To prevent overdraws caused by data anomalies or race conditions, this design implements:
1. **Fail-Closed Accounting History:** Established accounts with missing prior-month history rows are strictly blocked from withdrawals (`ACCOUNTING_HISTORY_INCOMPLETE`) rather than falling back to starting capital.
2. **Account Open/Start Date Conflict Handling:** Contradictory periods between `investors.start_date` and `investor_accounts.open_date` fail closed (`ACCOUNT_START_DATE_CONFLICT`).
3. **Shared Financial Lock Protocol:** `financial_lock_key(investor_id)` transactional advisory locking combined with `withdrawals FOR UPDATE` and `investor_accounts FOR UPDATE` row locks.
4. **Authoritative RPC Mutation Path:** The web API delegates authoritative calculation, serialization, and persistence to PostgreSQL RPC functions (`create_withdrawal_atomic`, `update_withdrawal_atomic`).
5. **Scope Certification:** Certified as `WITHDRAWAL_VS_WITHDRAWAL_CONCURRENCY_SAFE`.

---

## 2. Complete Capital-Changing Lock Protocol

Every operation capable of modifying an investor's available equity belongs to the capital-changing domain:

| Operation | Lock Protocol | Target Scope |
|---|---|---|
| **Withdrawal Create (Package B)** | `financial_lock_key(investor_id)` + `investor_accounts FOR UPDATE` | `investor_id` |
| **Withdrawal Update / Status Change (Package B)** | `financial_lock_key(investor_id)` + `withdrawals FOR UPDATE` + `investor_accounts FOR UPDATE` | `investor_id` |
| **Deposit Create (Future)** | `financial_lock_key(investor_id)` + `FOR UPDATE` | `investor_id` |
| **Deposit Void / Edit (Future)** | `financial_lock_key(investor_id)` + `FOR UPDATE` | `investor_id` |
| **Commission Finalization (Future)** | `financial_lock_key(investor_id)` + `FOR UPDATE` | `investor_id` |
| **Monthly Accounting Finalization (Future)** | `financial_lock_key(investor_id)` + `FOR UPDATE` | `investor_id` |
| **Starting Capital / Cutover Edit (Future)** | `financial_lock_key(investor_id)` + `FOR UPDATE` | `investor_id` |

### Shared Lock Function Definition
```sql
CREATE OR REPLACE FUNCTION financial_lock_key(p_investor_id TEXT)
RETURNS BIGINT LANGUAGE sql IMMUTABLE AS $$
  SELECT ('x' || substr(md5(p_investor_id), 1, 16))::bit(64)::bigint;
$$;
```

---

## 3. Fail-Closed Equity Calculation Rules

Inside the PostgreSQL transaction boundary, available equity is computed as:

$$\text{Available Equity} = \max\left(0, \text{Prior Ending Balance} + \text{Eligible Deposits} + \text{Prior Capitalized Commissions} - \sum \text{Other Active Withdrawals}\right)$$

### History Fallback Invariants
1. **First Active Period (Rule A):** If the withdrawal's effective accounting period is the account's initial opening period ($\text{targetYear} = \text{startYear} \land \text{targetMonth} = \text{startMonth}$), `investor_accounts.starting_capital` is used.
2. **Established Account Missing Prior Month (Rule B):** If the account has completed prior months and `investor_monthly_history` lacks a record for month $N-1$, the engine **FAILS CLOSED** and raises `ACCOUNTING_HISTORY_INCOMPLETE`. It does not fall back to `starting_capital`.
3. **Pre-Start Effective Date (Rule C):** If $\text{effective\_date} < \text{effective\_start\_date}$, available equity is strictly `$0.00`.
4. **Start Date Conflict (Rule D):** If `investor_accounts.open_date` conflicts with `investors.start_date` across accounting periods ($\text{YYYY-MM}$ mismatch), raises `ACCOUNT_START_DATE_CONFLICT`.

---

## 4. Status Normalization & Equity Reservation

| Status | Normalized | Equity Reservation |
|---|---|---|
| `Pending` | `Pending` | **YES** (`TRUE`) |
| `Approved` | `Approved` | **YES** (`TRUE`) |
| `Completed` | `Completed` | **YES** (`TRUE`) |
| `Cancelled` / `Canceled` | `Cancelled` | **NO** (`FALSE`) |
| `Void` / `VOID` | `Void` | **NO** (`FALSE`) |
| *Other / Unknown* | *Rejected* | Raises `INVALID_WITHDRAWAL_STATUS` |

---

## 5. RPC Output Contract & Error Codes

### Success Response
```json
{
  "status": "SUCCESS",
  "withdrawal_id": "c1f7a28e-4a81-4f3b-bc67-0925a1e2f891",
  "available_equity_before": 10000.00,
  "amount": 2500.00,
  "available_equity_after": 7500.00,
  "effective_accounting_date": "2026-08-01",
  "idempotency_replay": false,
  "withdrawal": { ... }
}
```

### Idempotent Replay Response
```json
{
  "status": "IDEMPOTENT_REPLAY",
  "withdrawal_id": "c1f7a28e-4a81-4f3b-bc67-0925a1e2f891",
  "amount": 2500.00,
  "effective_accounting_date": "2026-08-01",
  "idempotency_replay": true,
  "withdrawal": { ... }
}
```

### Standardized Error Codes
* `WITHDRAWAL_EXCEEDS_AVAILABLE_EQUITY`
* `ACCOUNTING_HISTORY_INCOMPLETE`
* `ACCOUNT_START_DATE_CONFLICT`
* `INVALID_EFFECTIVE_DATE`
* `INVALID_AMOUNT`
* `INVALID_WITHDRAWAL_STATUS`
* `IDEMPOTENCY_KEY_PAYLOAD_MISMATCH`
* `INVESTOR_NOT_FOUND`
* `WITHDRAWAL_NOT_FOUND`
