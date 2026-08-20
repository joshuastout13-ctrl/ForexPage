# Client Accounting Clarifications Package

**Document Version:** 1.0.0  
**Target Audience:** Joshua Stout / Fund Administration  
**Document Status:** PENDING CLIENT FEEDBACK  
**Scope:** 7 Specific Unresolved Financial Exceptions (Priority Groups A, B, C, D)  

---

## 1. Overview & Verified Accounts (No Further Client Input Required)

The forensic audit has **completely verified** the following four accounts against primary database records, transaction logs, and exact mathematical roll-forwards. **No input is needed from Josh for these accounts:**

- ✅ **Austin Ray (`austinray`):** May start $4,016.80 $\to$ May end $4,083.28 $\to$ June end / July open $4,158.21 $\to$ July end $4,223.28 (verified 100% continuous; separated from Ashlee Ray).
- ✅ **Theresa Kruger (`tkruger`):** July 1 withdrawal of $1,877.83 (`wd_01d8c2cb`) is source-proven as the exact payout of June profit, resetting capital to $110,000.00.
- ✅ **Kelci Ray (`kray`):** June 30 ending $5,197.76 + July 1 deposit $50,000.00 (`dep_ca11829d`) = $55,197.76 July 1 opening capital $\to$ July 31 ending $56,061.60 (verified exact).
- ✅ **Cathyann Jones (`cjones`):** Feb–June history materialized deterministically from verified start capital ($43,479.02) to July 31 ending $48,014.37.

---

## 2. Seven Essential Clarification Questions for Josh

To enable controlled staging and execution of the remaining financial corrections, please clarify the following 7 specific items:

### Item 1: Mary Jo Harris (`mharris`) — July Withdrawal Amount
* **Context:** Your review note (Cell `T386`) specifies: *"this balance should be reduced by a 20000 withdrawel"*. However, production database record `wd_e4fc9d89` (entered August 11) is recorded as **$22,000.00**.
* **Question for Josh:**
  > **Was the actual July wire/disbursement $20,000.00 or $22,000.00?**  
  > *(Please confirm against bank disbursement records so we can adjust or preserve record `wd_e4fc9d89`).*

---

### Item 2: Gary Larson (`glarson`) — August 1 Starting Capital vs September Deposit
* **Context:** Your review note (Cells `T170 & T176`) states he started with **$487,000.00 on August 1, 2026**. Production also contains a separate deposit record `dep_94a0ffe1` for **$120,000.00** dated **September 1, 2026**.
* **Question for Josh:**
  > **Does the $487,000.00 August 1 starting balance already include the $120,000.00 recorded on September 1, or is the $120,000.00 a separate fresh cash addition in September?**

---

### Item 3: Jeff Bennion (`jbennion`) — July 1 Cutover Baseline Authorization
* **Context:** Jeff's account has a 100% investor split and compounds mathematically from April 1 ($2,242,679.67) to June 30 ending **$2,477,604.26**. Your review note (Cell `T259`) instructs: *"change to this figure starting July 1 2026"* with value **$2,672,544.48** (+ $194,940.22).
* **Question for Josh:**
  > **Please confirm that $2,672,544.48 is an authorized master cutover baseline effective July 1, 2026 (rather than an unrecorded cash deposit).**  
  > *(If confirmed, July trading gain of $83,640.64 will compound from $2,672,544.48 to establish July 31 ending of $2,756,185.12).*

---

### Item 4: Michael Landon (`mlandon`) — July 1 Opening Capital Disambiguation
* **Context:** Michael Landon's ledger from January 1 ($63,012.86) compounds continuously to June 30 ending **$73,166.11**. In Cell `T406`, the value `10872.81` was entered (which matches cumulative profit), followed by the note in Cell `T407`: *"Start with this figure as of July 1 2026"*.
* **Question for Josh:**
  > **Which figure is the intended July 1 starting capital: $73,166.11 (total cumulative capital) or $10,872.81?**  
  > *(Setting $10,872.81 would erase $62,293.30 of principal without a recorded withdrawal).*

---

### Item 5: Ted Boardwalk (`tboardwalk`) — Negative Balance & Overdraft Policy
* **Context:** A $5,000 withdrawal against $2,945.95 equity resulted in a negative capital position (-$2,054.05) and trading losses (-$1,508.02 July close / -$449.61 August operating). In Cell `T560`, you entered **$17.19**.
* **Question for Josh:**
  > **When an investor's withdrawal exceeds their available account equity, what accounting policy should the platform enforce:**
  > - **(A)** Allow negative active capital and compound subsequent trading losses/gains?
  > - **(B)** Cap withdrawals at available equity ($0.00 floor)?
  > - **(C)** Record the excess overdraft as an external receivable / debit balance?
  > - **(D)** Another client-defined treatment?

---

### Item 6: Michael Beck (`mbeck`) — Source Support for $557,693.10 Checkpoint
* **Context:** Michael Beck started April 1, 2026 with $506,712.70. Production stores June 30 ending as **$553,437.68** (compounding to July 31 close **$568,441.65** and August operating **$570,350.40** with verified commissions). In Cell `T399`, you entered **$557,693.10** ($4,255.42 variance). Pre-April commissions ($4,704.00) cannot mathematically yield $4,255.42.
* **Question for Josh:**
  > **If $557,693.10 is the intended historical checkpoint, what specific source record, effective date, or accounting adjustment supports the $4,255.42 delta?**

---

### Item 7: Jerrys Rogue Jets (`jerrys`) — Origin of the $59.42 Checkpoint Variance
* **Context:** June 30 ending ($536,926.63) minus July 1 withdrawal ($2,500.00) equals July 1 eligible capital of **$534,426.63**. In Cell `T273`, you entered **$534,486.05** (a +$59.42 variance) alongside the note to add the August 1 $2,500 withdrawal.
* **Question for Josh:**
  > **We have verified and staged the recurring $2,500 August 1 withdrawal. What transaction or calculation accounts for the remaining $59.42 in the $534,486.05 checkpoint?**

---

## 3. Ready-to-Send Client Message for Josh

```text
Hi Josh,

We have completed the forensic review and verified Austin Ray, Theresa Kruger, Kelci Ray, and Cathyann Jones to the exact cent.

To finalize and safely stage the remaining accounting adjustments, could you please clarify the following 7 quick points:

1. Mary Jo Harris: Was the July withdrawal $20,000 or $22,000? (Please confirm against bank wire/disbursement records).
2. Gary Larson: Does the $487,000 August 1 starting balance include the $120,000 recorded on September 1, or is the $120,000 a separate later addition?
3. Jeff Bennion: Please confirm that $2,672,544.48 is an authorized July 1 master cutover balance (not an unrecorded deposit).
4. Michael Landon: Which July 1 starting capital is intended: $73,166.11 (total capital) or $10,872.81?
5. Ted Boardwalk: If a withdrawal exceeds account equity, should the platform allow negative balances, cap the withdrawal at equity, or record the excess as a separate debit?
6. Michael Beck: If $557,693.10 is the intended June checkpoint, what date or source record supports the $4,255.42 difference?
7. Jerrys Rogue Jets: We have staged the $2,500 August 1 withdrawal. What accounts for the additional $59.42 in the $534,486.05 figure?

Thanks!
```

---
*End of Client Clarifications Required Document.*
