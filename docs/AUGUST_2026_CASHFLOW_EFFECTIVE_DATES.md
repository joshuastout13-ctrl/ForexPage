# August 2026 Cashflow Effective-Date Review Document

> [!IMPORTANT]
> **PROPOSED BACKFILL REVIEW ONLY — ZERO PRODUCTION DATABASE MUTATIONS.**
> The existing production `deposits` and `withdrawals` tables remain 100% untouched.

---

## Executive Summary

Under authoritative fund rules (*"ALL deposits and withdrawals are financially effective on the 1st of the month"*), transaction records dated during the month (e.g. August 11 or 12) represent the calendar date the admin entered or approved the request (`created_at`/entry timestamp), not an intention to prorate.

This document lists every August cashflow transaction requiring explicit `effective_accounting_date` assignment prior to live month-end finalization.

---

## 1. Proposed August Deposit Effective Dates (7 Records)

| Record ID | Investor ID | Amount | Existing `date` Field | Proposed `effective_accounting_date` | Reason / Notes |
|---|---|---|---|---|---|
| `dep_aug_1` | `inv_5deeea21` | $\$20,000.00$ | `2026-08-01` | `2026-08-01` | 1st-of-month deposit. Participates in full month return. |
| `dep_aug_2` | `inv_65b7fbd9` | $\$21,500.00$ | `2026-08-01` | `2026-08-01` | 1st-of-month deposit. Participates in full month return. |
| `dep_aug_3` | `inv_0298b899` | $\$99,975.00$ | `2026-08-01` | `2026-08-01` | 1st-of-month deposit. Participates in full month return. |
| `dep_aug_4` | `inv_3dc85bea` | $\$4,000.00$ | `2026-08-01` | `2026-08-01` | 1st-of-month deposit. Participates in full month return. |
| `dep_aug_5` | `inv_54a72d26` | $\$10,000.00$ | `2026-08-01` | `2026-08-01` | 1st-of-month deposit. Participates in full month return. |
| `dep_aug_6` | `inv_3c86fcfb` | $\$50,000.00$ | `2026-08-01` | `2026-08-01` | 1st-of-month deposit. Participates in full month return. |
| `dep_aug_7` | `inv_1531b890` | $\$7,000.00$ | `2026-08-01` | `2026-08-01` | 1st-of-month deposit. Participates in full month return. |

---

## 2. Proposed August Withdrawal Effective Dates (16 Records)

| Record ID | Investor ID | Amount | Existing `request_date` | Proposed `effective_accounting_date` | Reason / Notes |
|---|---|---|---|---|---|
| `wd_aug_1` | `inv_f797f3fe` | $\$12,000.00$ | `2026-08-11` | `2026-08-01` | Entry date `08-11`. Financially effective August 1. |
| `wd_aug_2` | `inv_65b7fbd9` | $\$21,500.00$ | `2026-08-11` | `2026-08-01` | Entry date `08-11`. Financially effective August 1. |
| `wd_aug_3` | `inv_4c5c0ee6` | $\$18,700.00$ | `2026-08-11` | `2026-08-01` | Entry date `08-11`. Financially effective August 1. |
| `wd_aug_4` | `inv_4c5c0ee6` | $\$22,000.00$ | `2026-08-11` | `2026-08-01` | Entry date `08-11`. Financially effective August 1. |
| `wd_aug_5` | `inv_f797f3fe` | $\$30,000.00$ | `2026-08-11` | `2026-08-01` | Entry date `08-11`. Financially effective August 1. |
| `wd_aug_6` | `inv_60ed0c32` | $\$2,000.00$ | `2026-08-11` | `2026-08-01` | Entry date `08-11`. Financially effective August 1. |
| `wd_aug_7` | `inv_8cf28066` | $\$1,877.83$ | `2026-08-11` | `2026-08-01` | Entry date `08-11`. Financially effective August 1. |
| `wd_aug_8` | `inv_8cf28066` | $\$1,721.50$ | `2026-08-11` | `2026-08-01` | Entry date `08-11`. Financially effective August 1. |
| `wd_aug_9` | `inv_ce0675be` | $\$795.00$ | `2026-08-11` | `2026-08-01` | Entry date `08-11`. Financially effective August 1. |
| `wd_aug_10` | `inv_d3ec0cf8` | $\$3,000.00$ | `2026-08-11` | `2026-08-01` | Entry date `08-11`. Financially effective August 1. |
| `wd_aug_11` | `inv_d5761f42` | $\$150.00$ | `2026-08-11` | `2026-08-01` | Entry date `08-11`. Financially effective August 1. |
| `wd_aug_12` | `inv_d8b5ab06` | $\$7,000.00$ | `2026-08-11` | `2026-08-01` | Entry date `08-11`. Financially effective August 1. |
| `wd_aug_13` | `inv_ea8b4eba` | $\$700.00$ | `2026-08-11` | `2026-08-01` | Entry date `08-11`. Financially effective August 1. |
| `wd_aug_14` | `stout001` | $\$20,000.00$ | `2026-08-11` | `2026-08-01` | Entry date `08-11`. Financially effective August 1. |
| `wd_aug_15` | `inv_141417dc` | $\$20,000.00$ | `2026-08-11` | `2026-08-01` | Entry date `08-11`. Financially effective August 1. |
| `wd_aug_16` | `inv_bc1bcb0c` | $\$1,500.00$ | `2026-08-12` | `2026-08-01` | Entry date `08-12`. Financially effective August 1. |

---

## 3. Recommended Admin Action

When the Phase 4 database migration is approved for production deployment, executing an explicit update setting `effective_accounting_date = '2026-08-01'` for these 23 records will clear all `NON_FIRST_DAY_CASHFLOW` flags and allow August finalization to pass cleanly.
