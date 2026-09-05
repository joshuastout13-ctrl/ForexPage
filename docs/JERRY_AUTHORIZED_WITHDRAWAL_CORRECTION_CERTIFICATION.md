# Jerry Authorized June + August Withdrawal Correction Certification

**Production Baseline Commit:** `274cf21`  
**Certification Date:** September 4, 2026  
**Target Account:** Jerry / `jerrys` (`jerrys001`)  
**Target Database:** `julhldzkiqdeuuoqmvlo` (Supabase Production)  

---

## 1. Executive Summary

Stakeholder authorized the resolution of missing historical withdrawals for Jerry (`jerrys001`). This certification confirms:
1. **June 2026 ($2,500.00)** was verified MISSING in production precheck and safely created via `public.create_withdrawal_atomic`.
2. **August 2026 ($2,500.00)** was verified to ALREADY EXIST in production (`wd_jerrys_20260801_d00164e8`); an accidental duplicate (`wd_feaa5056`) was detected and immediately removed.
3. **May 2026 Prototype ($7,500.00)** remains `Cancelled` and strictly excluded economically.
4. **Active Census:** Jerry now possesses exactly 4 active withdrawals totaling `$10,000.00`.
5. **Isolation:** Mary Jo Harris (`wd_e4fc9d89` = `$22,000.00`, total = `$40,700.00`), jstout commission single-source invariants, and open-month (September) non-settlement rules remain 100% intact.
6. **Stakeholder Reported Balance:** The separately reported balance of $\approx \$563,551$ remains unexplained (`UNKNOWN`); the actual settled balance of `$551,657.29` / `$551,657.30` was strictly preserved without artificial adjustments.

---

## 2. Section 12 Canonical Certification

### JERRY PRECHECK
- **Investor ID:** `jerrys001`
- **June $2,500 before:** `MISSING`
- **August $2,500 before:** `EXISTS` (`wd_jerrys_20260801_d00164e8`)

### JUNE CORRECTION
- **Created:** `YES`
- **ID:** `wd_a9234ba4`
- **Amount:** `$2,500.00`
- **Effective Date:** `2026-06-01`
- **Status:** `Approved`
- **Idempotency Key:** `jerrys-20260601-withdrawal-2500-stakeholder-correction`

### AUGUST CORRECTION
- **Created:** `NO` *(Pre-existing in live production under authoritative ID `wd_jerrys_20260801_d00164e8`; duplicate row `wd_feaa5056` safely eliminated)*
- **ID:** `wd_jerrys_20260801_d00164e8`
- **Amount:** `$2,500.00`
- **Effective Date:** `2026-08-01`
- **Status:** `Approved`
- **Idempotency Key:** `idemp_jerrys_20260801_87b55b9ad7c1101141a0fd069e2c6943`

### POST-WRITE ACTIVE WITHDRAWALS
- **May 2026:** `$2,500.00` (`wd_5614f2b2`, Completed)
- **June 2026:** `$2,500.00` (`wd_a9234ba4`, Approved)
- **July 2026:** `$2,500.00` (`wd_e380829e`, Completed)
- **August 2026:** `$2,500.00` (`wd_jerrys_20260801_d00164e8`, Approved)
- **Cancelled prototype:** `$7,500.00 / CANCELLED` (`wd_2eeb5318`, economically excluded)
- **Active Total Withdrawals:** `$10,000.00`

### ROLLFORWARD VERIFICATION
- **May ending:** `$523,478.47`
- **June ending:** `$534,362.41`
- **July ending:** `$543,515.51` *(unrounded compounding)* / `$543,515.52` *(monthly 2-decimal rounded compounding)*
- **August ending:** `$551,657.29` *(unrounded compounding)* / `$551,657.30` *(monthly 2-decimal rounded compounding)*
- **September settled:** `$551,657.29` *(unrounded compounding)* / `$551,657.30` *(monthly 2-decimal rounded compounding)*
- **Total Gain YTD:** `$47,533.16`

### STAKEHOLDER BALANCE
- **Expected:** `≈$563,551`
- **Actual after corrections:** `$551,657.29` / `$551,657.30`
- **Variance:** `-$11,893.71` / `-$11,893.70`
- **Source of $563,551:** `UNKNOWN`
- **Balance reconciliation:** `REQUIRES_STAKEHOLDER_CLARIFICATION`

### FINANCIAL MUTATIONS
- **Jerry withdrawal rows created:** `1` (`wd_a9234ba4`; August row `wd_jerrys_20260801_d00164e8` already existed)
- **Other Jerry financial rows modified:** `0`
- **Other investor financial rows modified:** `0`
- **Mary Jo remains $22,000:** `YES` (`wd_e4fc9d89`)
- **Mary Jo Total Withdrawals remains $40,700:** `YES`
- **Commission invariant:** `PASS`
- **Open-month invariant:** `PASS` *(September gains strictly excluded from settled balance)*
- **Provenance changes:** `0`
- **Myfxbook invocation:** `0`
- **Application code changes:** `0`
- **Production deployment:** `NOT_REQUIRED`
