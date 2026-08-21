# Package B — Concurrency-Safe Withdrawal Control Architecture & Design

**Document Version:** 1.0.0  
**Status:** `CANDIDATE_DESIGN / STAGING_CERTIFICATION_IN_PROGRESS`  
**Production Deployment:** `BLOCKED_PENDING_CLIENT_AUTHORIZATION`  
**Production Financial Writes:** `0`  

---

## 1. Executive Summary

This specification establishes an atomic, concurrency-safe withdrawal control mechanism for the Stone & Company Forex Fund platform. It replaces the stateless "check-then-insert" pattern with an in-database PostgreSQL transaction boundary utilizing investor-scoped advisory locking, server-side equity computation, durable idempotency enforcement, and self-excluding update semantics.

---

## 2. Core Architectural Principles

```
                ┌────────────────────────────────────────────────────────┐
                │          Incoming Withdrawal Request (POST/PATCH)      │
                └──────────────────────────┬─────────────────────────────┘
                                           │
                                           ▼
                ┌────────────────────────────────────────────────────────┐
                │           PostgreSQL Transaction Boundary (BEGIN)      │
                │  - Scoped Lock: pg_advisory_xact_lock(hash(investor))  │
                └──────────────────────────┬─────────────────────────────┘
                                           │
                        ┌──────────────────┴──────────────────┐
                        ▼                                     ▼
      ┌────────────────────────────────────┐┌────────────────────────────────────┐
      │          Idempotency Check         ││      Server-Side Available Equity  │
      │ - Key exists & identical: REPLAY   ││ - Prior month ending balance       │
      │ - Key exists & different: CONFLICT ││ - Capitalized prior commissions    │
      └─────────────────┬──────────────────┘│ - Eligible monthly deposits        │
                        │                   │ - Active same-period withdrawals   │
                        │                   └─────────────────┬──────────────────┘
                        │                                     │
                        ▼                                     ▼
                ┌────────────────────────────────────────────────────────┐
                │             Authoritative Invariant Check:             │
                │            Requested Amount <= Available Equity        │
                └──────────────────────────┬─────────────────────────────┘
                                           │
                        ┌──────────────────┴──────────────────┐
                        ▼ [PASS]                              ▼ [FAIL]
      ┌────────────────────────────────────┐┌────────────────────────────────────┐
      │     Atomic INSERT / UPDATE (COMMIT)││     RAISE EXCEPTION (ROLLBACK)     │
      │ - Returns { status: 'SUCCESS' }    ││ - 0 ledger mutation                │
      └────────────────────────────────────┘└────────────────────────────────────┘
```

### Key Rules
1. **Never Trust Client Equity:** Client and intermediate API layers provide transaction *intent* only (amount, date, idempotency key). All equity calculation is performed authoritatively inside the database engine.
2. **Investor-Scoped Locking:** Uses `pg_advisory_xact_lock(('x' || substr(md5(investor_id), 1, 16))::bit(64)::bigint)`. Requests for different investors execute in full parallel without contention, while concurrent requests for the same investor are strictly serialized.
3. **Zero Partial Writes:** If an overdraw occurs or a conflict is detected, the PostgreSQL transaction rolls back immediately with zero mutation.

---

## 3. Status Transition & Equity Reservation Matrix

| Status | Equity Reservation | Description |
|---|---|---|
| **`Pending`** | **YES** (`TRUE`) | Admin entered request; capital is reserved against future requests. |
| **`Approved`** | **YES** (`TRUE`) | Request approved for processing; capital remains reserved. |
| **`Completed`** | **YES** (`TRUE`) | Executed cashflow; deducted from eligible active capital. |
| **`Cancelled`** | **NO** (`FALSE`) | Voided/cancelled request; reserved equity is released. |
| **`Void`** | **NO** (`FALSE`) | Voided entry; excluded from equity deduction. |

---

## 4. Idempotency Key Semantics

* A unique constraint/index is enforced on `withdrawals(idempotency_key)`.
* **Identical Payload Replay:** If an identical request (same investor, same amount, same date) is resubmitted with the same key, the RPC safely returns the existing withdrawal with status `IDEMPOTENT_REPLAY`.
* **Payload Conflict:** If the same key is reused with differing parameters (e.g. different investor or amount), the RPC raises `IDEMPOTENCY_KEY_PAYLOAD_MISMATCH` and aborts.

---

## 5. Self-Excluding Update (PATCH) Semantics

When editing an existing withdrawal:
1. The target withdrawal is locked and loaded.
2. Investor reassignment is strictly forbidden (`INVESTOR_REASSIGNMENT_FORBIDDEN`).
3. The calculation excludes the current withdrawal ID (`p_exclude_withdrawal_id`), computing available equity as:
   $$\text{Available Equity} = \text{Prior Ending} + \text{Deposits} + \text{Commissions} - \sum \text{Other Active Withdrawals}$$
4. If the new amount $\le$ Available Equity, the update succeeds; otherwise it raises `WITHDRAWAL_EXCEEDS_AVAILABLE_EQUITY`.
