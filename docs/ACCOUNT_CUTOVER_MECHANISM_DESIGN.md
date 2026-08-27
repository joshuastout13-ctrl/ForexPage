# Account Cutover Mechanism — Architecture & Design Specification

**Status:** `CERTIFIED_FOR_AUTHORIZATION`  
**Classification:** `PLATFORM_ACCOUNTING_ARCHITECTURE`  
**Reference Case:** Jeff Bennion (`inv_65b7fbd9` / `jbennion`) August 1, 2026 Cutover Baseline  

---

## 1. Problem Statement & Business Semantics

In managed forex accounting, an external authorized cutover occurs when fund leadership mandates a specific starting operating capital for an investor at a specific accounting period (e.g., historical migration, external reconciliation checkpoint, or structural baseline adjustment).

### Strict Economic Definitions:
* **What a Cutover IS:** An externally authorized, durable replacement of the standard $N-1 \to N$ roll-forward starting operating capital for a specific account and month.
* **What a Cutover is NOT:**
  * **NOT an External Cash Deposit:** Must never contribute to `Total Deposits`, cashflow reports, or wire reconciliations.
  * **NOT a Withdrawal:** Must never generate disbursement liabilities.
  * **NOT a Referral Commission:** Must never contaminate upline/downline earnings.
  * **NOT a Trading Gain/Loss:** Must never distort gross trading return rates or investor performance graphs.
  * **NOT an Arbitrary Balancing Adjustment:** Must be permanently bound to an audit record detailing authorization provenance.

---

## 2. Durable Schema Design (`account_cutover_adjustments`)

To ensure permanence and prevent data loss during historical recalculations or month-close procedures, cutovers are stored in a dedicated, immutable audit table:

```sql
CREATE TABLE account_cutover_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  investor_id TEXT NOT NULL REFERENCES investors(id) ON DELETE CASCADE,
  account_id TEXT REFERENCES investor_accounts(id) ON DELETE CASCADE,
  year INTEGER NOT NULL,
  month_number INTEGER NOT NULL CHECK (month_number BETWEEN 1 AND 12),
  effective_date DATE NOT NULL,
  authorized_opening_balance NUMERIC(20, 10) NOT NULL,
  prior_rollforward_balance NUMERIC(20, 10) NOT NULL,
  reason TEXT NOT NULL,
  authorization_reference TEXT NOT NULL,
  created_by TEXT DEFAULT 'system',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  idempotency_key TEXT UNIQUE,
  CONSTRAINT uq_account_cutover_period UNIQUE (investor_id, year, month_number)
);

CREATE INDEX idx_cutover_investor_period ON account_cutover_adjustments(investor_id, year, month_number);
```

---

## 3. Recalculation Engine Integration (`api/admin/historical-data/recalculate.js`)

During monthly recalculation:
1. The engine calculates standard roll-forward: `opening = prior_ending + capitalized_commissions`.
2. The engine queries `account_cutover_adjustments` for `(investor_id, year, month_number)`.
3. If an authorized cutover exists:
   $$\text{opening\_balance} \leftarrow \text{authorized\_opening\_balance}$$
4. Trading gains, withdrawals, and ending balances for month $N$ proceed strictly from this authoritative cutover opening.
5. All prior months ($1 \dots N-1$) remain 100% untouched.

---

## 4. Dashboard & Performance UI Semantics

* **Total Deposits:** Sums strictly from `deposits` table where `type != 'VOID'`. Cutovers produce **$0.00 deposit delta**.
* **Performance Graph:** Renders net monthly trading dollar gains. Cutovers do **not** generate graph bars.
* **Monthly Return %:** In open/unfinalized months (0.00% gross return), return % remains `0.00%`. In trading months, return % is calculated as $\frac{\text{Net Gain}}{\text{Authorized Cutover Opening}}$.

---

## 5. Package B Available Equity Integration

The PostgreSQL authoritative withdrawal equity validation engine (`calculate_available_withdrawal_equity_sql`) checks `account_cutover_adjustments`. If an authorized cutover is present for target period $(Y, M)$, it uses `authorized_opening_balance` as the baseline equity before subtracting active reservations.

For Jeff Bennion at August 1, 2026:
* Authorized Cutover Opening: **`$2,673,903.44`**
* Existing August Withdrawal (`wd_54f99320`): **`-$21,500.00`**
* Available Equity at 0% return: **`$2,652,403.44`**
