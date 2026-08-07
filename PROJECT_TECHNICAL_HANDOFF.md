# Stone & Company Forex Fund — Technical Handoff & Codebase Audit

**Document Version:** 1.0.0  
**Target Audience:** Senior Engineering Team & Technical Leadership  
**Status:** Complete Technical Audit (Read-Only Investigation)  
**Repository:** `joshuastout13-ctrl/ForexPage` (`4xtrack.com`)  

---

## EXECUTIVE SUMMARY & SYSTEM OVERVIEW

This document provides a comprehensive technical audit and handoff for the **Stone & Company Forex Fund** investment tracking and commission distribution platform. The platform is designed to track fund trading performance, maintain investor balances, account for capital deposits/withdrawals, calculate investor-level gross/net returns, distribute profit-sharing commissions to affiliates/recipients, and serve investor & admin dashboards.

---

## 1. PROJECT ARCHITECTURE

### System Technology Stack

| Layer | Technology | Version / Details |
|---|---|---|
| **Frontend UI** | Vanilla HTML5 / CSS3 / ES Modules | Custom CSS token system, responsive glassmorphism design, Google Fonts (Outfit & Inter), Chart.js (v4 CDN) |
| **Backend Runtime** | Node.js Serverless Functions | Node.js `22.x` runtime (ES Modules, `"type": "module"`) |
| **Serverless Host** | Vercel Serverless Functions | Hosted on Vercel at `4xtrack.com` |
| **Primary Database** | Supabase PostgreSQL | `@supabase/supabase-js` v2.103.3 with Row Level Security (RLS) enabled |
| **Legacy Data Source** | Google Sheets API | Google Visualization API (`gviz/tq` JSON endpoint) fallback |
| **Authentication** | HMAC-SHA256 Signed Cookies | `scff_session` (investors) & `scff_admin_session` (admins) + `bcryptjs` v3.0.3 password hashing |
| **External APIs** | Myfxbook API & Scrape.do | Official Myfxbook JSON API + Scrape.do web scraper + Resend Email API (`resend` v6.18.0) |
| **Scheduled Jobs** | Vercel Cron | `api/cron/sync-myfxbook.js` scheduled daily at `0 23 * * *` (11:00 PM UTC / 4:00 PM PST) |

### Directory Structure & File Map

```
ForexPage/
├── index.html                    # Investor Portal single-page web app (Login, Dashboard, Error card)
├── admin.html                    # Admin Dashboard single-page web app (10 management tabs + Email Center + Audit)
├── package.json                  # Dependencies, scripts, and Node.js engine configuration
├── vercel.json                   # Vercel deployment routes, static rewrites, headers, and cron schedules
├── .env.local                    # Environment configuration (secrets, keys, tokens)
├── api/                          # Vercel Serverless API Handlers
│   ├── login.js                  # Investor login endpoint (POST)
│   ├── logout.js                 # Investor logout endpoint (POST)
│   ├── me.js                     # Current investor session & dashboard payload endpoint (GET)
│   ├── change-password.js        # Investor password update endpoint (POST)
│   ├── health.js                 # System health check endpoint (GET)
│   ├── cron/
│   │   └── sync-myfxbook.js      # Daily Vercel Cron job for Myfxbook live performance sync
│   └── admin/
│       ├── login.js              # Admin authentication endpoint (POST)
│       ├── logout.js             # Admin logout endpoint (POST)
│       ├── me.js                 # Admin session verification endpoint (GET)
│       ├── reset-password.js     # Admin investor password reset endpoint (POST)
│       ├── live-performance.js   # Admin headline performance override endpoint (GET/PATCH)
│       ├── monthly-returns.js    # Fund monthly gross return manager (GET/POST/PUT)
│       ├── historical-data.js    # Investor monthly history override manager (GET/POST/DELETE)
│       ├── myfxbook-preview.js   # Scrape live Myfxbook data without DB commit (GET)
│       ├── myfxbook-commit.js    # Approve & commit previewed Myfxbook data to DB (POST)
│       ├── snapshots.js          # Monthly snapshot audit log endpoint (GET)
│       ├── accounts/             # Account management endpoints
│       ├── commission-audit/
│       │   ├── index.js          # Core Audit calculation engine & report generator (JSON/CSV/Excel)
│       │   └── export.js         # Dedicated audit export endpoint
│       ├── commission-shares/
│       │   ├── index.js          # Commission share rule CRUD endpoint
│       │   └── bulk.js           # Bulk commission rule manager (deletes legacy rules, updates shares)
│       ├── deposits/             # Deposit transaction CRUD endpoints
│       ├── withdrawals/          # Withdrawal transaction CRUD endpoints
│       ├── investors/            # Investor profile CRUD endpoints
│       └── send-email/           # Mass broadcast & test email endpoints via Resend
├── lib/                          # Core Business Logic & Shared Helpers
│   ├── config.js                 # Environment variable loader & default constants
│   ├── auth.js                   # HMAC-SHA256 session token generation, verification & cookie parser
│   ├── adminAuth.js              # Admin session verification middleware
│   ├── password.js               # bcrypt password hashing & verification with legacy fallback
│   ├── dashboard.js              # Central investor dashboard calculation engine (buildInvestorDashboard)
│   ├── myfxbook.js               # Myfxbook official API client & Scrape.do fallback scraper
│   ├── supabase.js               # Supabase client initializer & row normalizer
│   ├── sheets.js                 # Google Sheets gviz JSON parser & numeric helpers
│   └── email.js                  # Resend email API integration & responsive HTML template builder
├── supabase/                     # PostgreSQL Migrations & Schema Definitions
│   ├── schema.sql                # Core database schema (investors, accounts, deposits, withdrawals, returns)
│   ├── schema_update_v2.sql      # Commission rules & commission earnings schema
│   ├── schema_update_v3.sql      # Commission shares schema with effective date ranges
│   ├── schema_update_v4.sql      # Force password change column & audit_runs log table
│   └── admin_email_logs.sql      # Email log tracking table & RLS policies
└── scripts/                      # Database seed and test scripts
    ├── setup-db.js               # Supabase database initialization & table seeder
    ├── final-qa.js               # End-to-end integration test runner
    ├── integrity-test.js         # Investor portal logic integrity validator
    └── qa-logic-check.js         # Mathematical reconciliation test script
```

---

## 2. PACKAGE.JSON & DEPENDENCIES

### Content of `package.json`

```json
{
  "name": "stone-company-forex-fund",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "node dev-server.js",
    "deploy": "vercel --prod"
  },
  "engines": {
    "node": "22.x"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.103.3",
    "bcryptjs": "^3.0.3",
    "decimal.js": "^10.6.0",
    "dotenv": "^17.4.2",
    "exceljs": "^4.4.0",
    "resend": "^6.18.0"
  }
}
```

### Dependency Audit

*   `@supabase/supabase-js` (`^2.103.3`): Primary PostgreSQL client. Used for database queries, upserts, and RPCs using the `SUPABASE_SERVICE_ROLE_KEY`.
*   `bcryptjs` (`^3.0.3`): Used for hashing new investor passwords (`saltRounds = 10`) and verifying passwords against `$2a$`, `$2b$`, or `$2y$` hashes with legacy plaintext fallback.
*   `decimal.js` (`^10.6.0`): Arbitrary-precision decimal arithmetic library (`precision: 20`, `ROUND_HALF_UP`). Used inside compounding loops in `lib/dashboard.js` and `api/admin/commission-audit/index.js`.
*   `exceljs` (`^4.4.0`): Used in `api/admin/commission-audit/index.js` to generate multi-sheet, formatted Excel workbooks (`.xlsx`) for single-account and "Run All" audit reports.
*   `resend` (`^6.18.0`): Used in `lib/email.js` to send transactional and mass broadcast emails to investors.
*   `dotenv` (`^17.4.2`): Environment variable loader for local development.

### Technology Check Summary
*   **Supabase:** YES (Primary Database)
*   **Myfxbook:** YES (API + Web Scraping)
*   **bcrypt:** YES (`bcryptjs` v3.0.3)
*   **ExcelJS:** YES (Workbook Export)
*   **decimal.js:** YES (Partial backend calculations)
*   **big.js:** NO
*   **TypeScript:** NO (Pure JavaScript ES Modules)
*   **Auth Libraries:** Custom HMAC-SHA256 signed cookies + `bcryptjs`
*   **Cron Libraries:** Native Vercel Cron (`vercel.json` + `x-vercel-cron` header check)

---

## 3. DATABASE SCHEMA

### Database Tables Overview

The PostgreSQL database in Supabase contains 13 core tables:

#### 1. `investors`
*   **Purpose:** Primary identity table for all platform investors and administrators.
*   **Primary Key:** `id` (`TEXT`)
*   **Columns:**
    *   `id` (`TEXT`, PRIMARY KEY): E.g., `"inv_08ea159a"` or `"Stout001"`
    *   `first_name` (`TEXT`, NULLABLE)
    *   `last_name` (`TEXT`, NULLABLE)
    *   `email` (`TEXT`, NULLABLE)
    *   `portal_username` (`TEXT`, UNIQUE, NULLABLE): Login username
    *   `temp_password` (`TEXT`, NULLABLE): Plaintext temporary password or bcrypt hash
    *   `active` (`BOOLEAN`, DEFAULT `TRUE`): Soft-delete / account status flag
    *   `split_pct` (`NUMERIC(5,2)`, DEFAULT `100.00`): **CRITICAL MONEY/PCT.** Investor's entitlement share of gross profit (e.g. 75.00 = 75%)
    *   `monthly_draw` (`NUMERIC(12,2)`, DEFAULT `0.00`): **CRITICAL MONEY.** Automatic monthly fixed recurring withdrawal amount
    *   `start_date` (`DATE`, NULLABLE): Capital deployment date
    *   `role` (`TEXT`, DEFAULT `'investor'`): `'investor'` or `'admin'`
    *   `force_password_change` (`BOOLEAN`, DEFAULT `FALSE`): Forces mandatory password setup on next login
    *   `notes` (`TEXT`, NULLABLE)
    *   `created_at` (`TIMESTAMP WITH TIME ZONE`, DEFAULT `NOW()`)
    *   `updated_at` (`TIMESTAMP WITH TIME ZONE`, DEFAULT `NOW()`)

#### 2. `investor_accounts`
*   **Purpose:** Financial ledger accounts belonging to an investor.
*   **Primary Key:** `id` (`TEXT`)
*   **Foreign Keys:** `investor_id` → `investors(id)`
*   **Columns:**
    *   `id` (`TEXT`, PRIMARY KEY)
    *   `investor_id` (`TEXT`, REFERENCES `investors(id)`)
    *   `name` (`TEXT`, NULLABLE): Account nickname (e.g., `"Primary Trading Account"`)
    *   `starting_capital` (`NUMERIC(15,2)`, DEFAULT `0.00`): **CRITICAL MONEY.** Initial principal deposit
    *   `total_cash_in` (`NUMERIC(15,2)`, DEFAULT `0.00`): **CRITICAL MONEY.** Total net principal contributed
    *   `open_date` (`DATE`, NULLABLE)
    *   `status` (`TEXT`, DEFAULT `'Active'`)
    *   `is_commission` (`BOOLEAN`, DEFAULT `FALSE`): Flags whether this account is dedicated to receiving commission earnings
    *   `split_pct` (`NUMERIC(5,2)`, DEFAULT `100.00`): Account-level split percentage override
    *   `created_at` (`TIMESTAMP WITH TIME ZONE`)
    *   `updated_at` (`TIMESTAMP WITH TIME ZONE`)

#### 3. `deposits`
*   **Purpose:** Records of incoming capital additions.
*   **Primary Key:** `id` (`TEXT`)
*   **Foreign Keys:** `investor_id` → `investors(id)`, `account_id` → `investor_accounts(id)`
*   **Columns:**
    *   `id` (`TEXT`, PRIMARY KEY)
    *   `investor_id` (`TEXT`, REFERENCES `investors(id)`)
    *   `account_id` (`TEXT`, REFERENCES `investor_accounts(id)`)
    *   `date` (`DATE`, NULLABLE)
    *   `amount` (`NUMERIC(15,2)`, NOT NULL): **CRITICAL MONEY.** Dollar value of deposit
    *   `type` (`TEXT`, DEFAULT `'Wire'`): Deposit classification (`'Wire'`, `'Commission'`, etc.)
    *   `notes` (`TEXT`, NULLABLE)
    *   `created_at` (`TIMESTAMP WITH TIME ZONE`)

#### 4. `withdrawals`
*   **Purpose:** Records of outgoing capital withdrawals and profit draws.
*   **Primary Key:** `id` (`TEXT`)
*   **Foreign Keys:** `investor_id` → `investors(id)`, `account_id` → `investor_accounts(id)`
*   **Columns:**
    *   `id` (`TEXT`, PRIMARY KEY)
    *   `investor_id` (`TEXT`, REFERENCES `investors(id)`)
    *   `account_id` (`TEXT`, REFERENCES `investor_accounts(id)`)
    *   `request_date` (`DATE`, NULLABLE)
    *   `year` (`INTEGER`, NULLABLE)
    *   `month_number` (`INTEGER`, NULLABLE)
    *   `month` (`TEXT`, NULLABLE)
    *   `amount` (`NUMERIC(15,2)`, NOT NULL): **CRITICAL MONEY.** Dollar value of withdrawal
    *   `status` (`TEXT`, DEFAULT `'Completed'`): `'Pending'`, `'Completed'`, or `'Cancelled'`
    *   `created_at` (`TIMESTAMP WITH TIME ZONE`)

#### 5. `monthly_returns`
*   **Purpose:** Master fund-level gross trading returns per month.
*   **Primary Key:** `(year, month_number)`
*   **Columns:**
    *   `year` (`INTEGER`, NOT NULL)
    *   `month_number` (`INTEGER`, NOT NULL): `1` through `12`
    *   `month` (`TEXT`, NULLABLE): Month name (e.g., `"January"`)
    *   `gross_return_pct` (`NUMERIC(5,2)`, NOT NULL): **CRITICAL PCT.** Fund-level trading return (e.g., `3.25` = +3.25%)
    *   `source` (`TEXT`, NULLABLE): `'Myfxbook Scrape'`, `'Manual Overide'`, etc.
    *   `locked` (`BOOLEAN`, DEFAULT `FALSE`): Flag indicating if month returns are locked against edits
    *   `last_updated` (`TEXT`, NULLABLE)
    *   `created_at` (`TIMESTAMP WITH TIME ZONE`)

#### 6. `live_performance`
*   **Purpose:** Headline performance feed table displayed in the right sidebar.
*   **Primary Key:** `metric` (`TEXT`)
*   **Columns:**
    *   `metric` (`TEXT`, PRIMARY KEY): E.g., `'Today'`, `'This Week'`, `'This Month'`, `'This Year'`, `'Gain'`
    *   `value_pct` (`TEXT`, NULLABLE): **POTENTIAL TYPE RISK.** Percentage string (e.g., `"0.37"`)
    *   `source` (`TEXT`, NULLABLE)
    *   `last_updated` (`TEXT`, NULLABLE)
    *   `is_override` (`BOOLEAN`, DEFAULT `FALSE`): Prevents automated scrapers from overwriting admin manual entry
    *   `updated_at` (`TIMESTAMP WITH TIME ZONE`)

#### 7. `investor_monthly_history`
*   **Purpose:** Historical monthly balances and manual overrides for investor calculations.
*   **Primary Key:** `id` (`UUID`, DEFAULT `gen_random_uuid()`)
*   **Unique Constraint:** `UNIQUE(investor_id, year, month_number)`
*   **Foreign Keys:** `investor_id` → `investors(id)`, `account_id` → `investor_accounts(id)`
*   **Columns:**
    *   `id` (`UUID`, PRIMARY KEY)
    *   `investor_id` (`TEXT`, REFERENCES `investors(id)`)
    *   `account_id` (`TEXT`, REFERENCES `investor_accounts(id)`)
    *   `year` (`INTEGER`, NOT NULL)
    *   `month_number` (`INTEGER`, NOT NULL)
    *   `month` (`TEXT`, NULLABLE)
    *   `opening_balance` (`NUMERIC(15,2)`): **CRITICAL MONEY.** Starting capital for month
    *   `deposits` (`NUMERIC(15,2)`, DEFAULT `0`): **CRITICAL MONEY.**
    *   `withdrawals` (`NUMERIC(15,2)`, DEFAULT `0`): **CRITICAL MONEY.**
    *   `gross_return_pct` (`NUMERIC(5,2)`, DEFAULT `0`): **CRITICAL PCT.**
    *   `manual_gain_amount` (`NUMERIC(15,2)`, NULLABLE): **CRITICAL MONEY.** Authoritative historical gain override
    *   `manual_return_pct` (`NUMERIC(5,2)`, NULLABLE): **CRITICAL PCT.** Authoritative historical return % override
    *   `recurring_draw` (`NUMERIC(12,2)`, DEFAULT `0`): **CRITICAL MONEY.**
    *   `ending_balance` (`NUMERIC(15,2)`): **CRITICAL MONEY.** Authoritative historical ending balance
    *   `is_manual` (`BOOLEAN`, DEFAULT `FALSE`): Flags if row is an authoritative manual entry from old Google Sheets
    *   `created_at` (`TIMESTAMP WITH TIME ZONE`)

#### 8. `commission_shares`
*   **Purpose:** Active commission allocation rules mapping source investors to recipients with effective date ranges.
*   **Primary Key:** `id` (`UUID`, DEFAULT `gen_random_uuid()`)
*   **Foreign Keys:** `source_investor_id` → `investors(id)`, `source_account_id` → `investor_accounts(id)`, `recipient_investor_id` → `investors(id)`
*   **Columns:**
    *   `id` (`UUID`, PRIMARY KEY)
    *   `source_investor_id` (`TEXT`, REFERENCES `investors(id)` ON DELETE CASCADE)
    *   `source_account_id` (`TEXT`, REFERENCES `investor_accounts(id)` ON DELETE CASCADE, NULLABLE)
    *   `recipient_investor_id` (`TEXT`, REFERENCES `investors(id)` ON DELETE CASCADE)
    *   `commission_percent` (`NUMERIC(5,2)`, NOT NULL): **CRITICAL PCT.** Share of the **Commission Pool** (NOT gross profit)
    *   `effective_start_date` (`DATE`, NOT NULL): Date rule becomes active
    *   `effective_end_date` (`DATE`, NULLABLE): Date rule expires (`NULL` = active indefinitely)
    *   `status` (`TEXT`, DEFAULT `'active'`): `'active'`, `'pending'`, `'ended'`, or `'cancelled'`
    *   `created_at` (`TIMESTAMP WITH TIME ZONE`)

#### 9. `commission_earnings`
*   **Purpose:** Committed historical ledger of commission payouts received by recipients from source accounts.
*   **Primary Key:** `id` (`UUID`, DEFAULT `gen_random_uuid()`)
*   **Foreign Keys:** `recipient_id` → `investors(id)`, `source_investor_id` → `investors(id)`
*   **Columns:**
    *   `id` (`UUID`, PRIMARY KEY)
    *   `recipient_id` (`TEXT`, REFERENCES `investors(id)` ON DELETE CASCADE)
    *   `source_investor_id` (`TEXT`, REFERENCES `investors(id)` ON DELETE CASCADE)
    *   `year` (`INTEGER`, NOT NULL)
    *   `month_number` (`INTEGER`, NOT NULL)
    *   `amount` (`NUMERIC(15,2)`, NOT NULL): **CRITICAL MONEY.** Exact dollar amount earned
    *   `created_at` (`TIMESTAMP WITH TIME ZONE`)

#### 10. `commission_rules` (Legacy Table)
*   **Purpose:** Legacy simple commission rules table (superseded by `commission_shares`, maintained for backward compatibility).
*   **Primary Key:** `id` (`UUID`, DEFAULT `gen_random_uuid()`)
*   **Columns:** `id`, `investor_id`, `recipient_id`, `percent` (`NUMERIC(5,2)`), `created_at`, `updated_at`.

#### 11. `snapshots`
*   **Purpose:** Historical snapshot audit trail of investor monthly calculations.
*   **Primary Key:** `id` (`TEXT`)
*   **Columns:** `id`, `investor_id`, `account_id`, `year`, `month_number`, `month`, `opening_balance`, `deposit_amount`, `gross_return_pct`, `split_pct`, `effective_return_pct`, `gain_amount`, `monthly_draw`, `withdrawal_amount`, `ending_balance`, `created_at`.

#### 12. `audit_runs`
*   **Purpose:** Saved audit report runs executed by admins.
*   **Primary Key:** `id` (`UUID`)
*   **Columns:** `id`, `admin_id`, `source_investor_id`, `year`, `month_number`, `report_json` (`JSONB`), `created_at`.

#### 13. `admin_email_logs`
*   **Purpose:** Execution history log for mass email broadcasts.
*   **Primary Key:** `id` (`UUID`)
*   **Columns:** `id`, `subject`, `body`, `recipient_count`, `recipient_emails` (`TEXT[]`), `status`, `sent_by`, `is_test`, `error_message`, `details` (`JSONB`), `created_at`.

### Floating-Point Risk Assessment

*   **Database Level:** All monetary and percentage fields use explicit PostgreSQL fixed-point types (`NUMERIC(15,2)`, `NUMERIC(12,2)`, `NUMERIC(5,2)`). This provides exact decimal precision at the storage level.
*   **Backend Level Risk:** In Node.js, data fetched from Supabase via JavaScript numbers or converted via `Number(val)` or `parseFloat(val)` is cast into standard IEEE-754 double-precision floating-point numbers. While `decimal.js` is used inside internal compounding loops in `lib/dashboard.js` and `commission-audit/index.js`, values are converted back to JavaScript numbers using `.toNumber()` between iterations. This creates potential floating-point representation drift (e.g. `81848.27882699999` vs `81848.278827`).

---

## 4. SAMPLE DATABASE RECORDS

The following sanitized records demonstrate how a source investor ("Investor A"), accounts, monthly returns, commission shares, historical records, and commission earnings relate across tables:

### Table `investors`
```json
[
  {
    "id": "inv_source_001",
    "first_name": "Investor",
    "last_name": "A",
    "email": "investorA@example.com",
    "portal_username": "investora",
    "active": true,
    "split_pct": 75.00,
    "monthly_draw": 0.00,
    "role": "investor"
  },
  {
    "id": "inv_recipient_002",
    "first_name": "Recipient",
    "last_name": "B",
    "email": "recipientB@example.com",
    "portal_username": "recipientb",
    "active": true,
    "split_pct": 100.00,
    "role": "investor"
  },
  {
    "id": "inv_recipient_003",
    "first_name": "Recipient",
    "last_name": "C",
    "email": "recipientC@example.com",
    "portal_username": "recipientc",
    "active": true,
    "split_pct": 100.00,
    "role": "investor"
  }
]
```

### Table `investor_accounts`
```json
[
  {
    "id": "acc_source_001",
    "investor_id": "inv_source_001",
    "name": "Primary Investment Account",
    "starting_capital": 100000.00,
    "total_cash_in": 100000.00,
    "status": "Active",
    "is_commission": false
  }
]
```

### Table `monthly_returns`
```json
[
  {
    "year": 2026,
    "month_number": 7,
    "month": "July",
    "gross_return_pct": 10.00,
    "source": "Myfxbook Scrape",
    "locked": false
  }
]
```

### Table `commission_shares`
```json
[
  {
    "id": "share_001",
    "source_investor_id": "inv_source_001",
    "recipient_investor_id": "inv_recipient_002",
    "commission_percent": 50.00,
    "effective_start_date": "2026-01-01",
    "effective_end_date": null,
    "status": "active"
  },
  {
    "id": "share_002",
    "source_investor_id": "inv_source_001",
    "recipient_investor_id": "inv_recipient_003",
    "commission_percent": 50.00,
    "effective_start_date": "2026-01-01",
    "effective_end_date": null,
    "status": "active"
  }
]
```

### Table `commission_earnings`
```json
[
  {
    "id": "earn_001",
    "source_investor_id": "inv_source_001",
    "recipient_id": "inv_recipient_002",
    "year": 2026,
    "month_number": 7,
    "amount": 1250.00
  },
  {
    "id": "earn_002",
    "source_investor_id": "inv_source_001",
    "recipient_id": "inv_recipient_003",
    "year": 2026,
    "month_number": 7,
    "amount": 1250.00
  }
]
```

---

## 5. MYFXBOOK INTEGRATION

### Architecture & Endpoints

Myfxbook integration is implemented in `lib/myfxbook.js` and `api/cron/sync-myfxbook.js`.

*   **Authentication:** `myfxbookLogin()` calls `https://www.myfxbook.com/api/login.json?email=...&password=...`. Upon success, Myfxbook returns a session token cached in memory for 24 hours (`sessionExpiry = Date.now() + 24*60*60*1000`).
*   **Watched Accounts API:** `fetchWatchedAccount(session)` calls `https://www.myfxbook.com/api/get-watched-accounts.json?session=...`. It retrieves watched account metrics (`gain`, `drawdown`, `name`).
*   **Scrape.do Fallback Scraper:** `fetchScrapeDoMetrics()` calls `https://api.scrape.do?token=...&url=...` to scrape high-fidelity periodic headline metrics (`Today`, `This Week`, `This Month`, `This Year`) directly from the public Myfxbook web page.
*   **Database Persistence:** When `getMyfxbookLive({ previewMode: false })` executes, `updateLivePerformance()` upserts the metrics into the `live_performance` table in Supabase (respecting any `is_override: true` rows).

### Synchronization Schedule & Triggers

1.  **Automated Daily Cron:** Configured in `vercel.json` to execute `api/cron/sync-myfxbook.js` daily at `0 23 * * *` (11 PM UTC). Vercel passes `x-vercel-cron: 1` header to authorize execution.
2.  **Manual Admin Preview & Commit:** In `admin.html`, clicking "Pull Live Data" triggers `GET /api/admin/myfxbook-preview` (which calls `getMyfxbookLive({ previewMode: true })` without writing to DB). The admin reviews the preview modal and clicks "Accept & Save", calling `POST /api/admin/myfxbook-commit` to update `live_performance`.

### Idempotency & Failure Handling

*   **Idempotency:** Upserts on `live_performance` use `onConflict: "metric"`. Running sync multiple times updates the existing metric rows rather than duplicating data.
*   **Retries & Fallbacks:** If the Myfxbook official API fails, the system falls back to Scrape.do web scraping. If Scrape.do fails, it falls back to existing rows in `live_performance` or Google Sheets.

### Does Myfxbook Currently Update Investor Dashboards Automatically?

**PARTIALLY.**

*   **What Myfxbook DOES update:** Myfxbook automatically updates the **fund-level headline metrics** on the right sidebar of the investor dashboard (`Today`, `This Week`, `This Month`, `This Year`, `Fund Gain`, `Drawdown`).
*   **What Myfxbook DOES NOT update:** Myfxbook does **NOT** automatically update individual investor account balances, deposits, withdrawals, monthly investor split allocations, or commission payouts. Individual investor accounts require monthly return percentages to be recorded in `monthly_returns` or `investor_monthly_history`.

---

## 6. COMPLETE MONEY FLOW

### Detailed Step-by-Step Calculation Trace

Below is the exact step-by-step mathematical trace for a source account with $100,000 capital under a 10.00% gross fund return, 75% source split, and two 50% commission pool recipients:

```
[Myfxbook / Fund Trading]
       │
       ▼
1. Fund Gross Return % (monthly_returns.gross_return_pct) = 10.00%
       │
       ▼
2. Source Account Capital Base (lib/dashboard.js & api/admin/commission-audit/index.js)
   startingBalance = $100,000.00
   adjustedStartingBalance = startingBalance + deposits - withdrawals = $100,000.00
       │
       ▼
3. Gross Profit Calculation
   Formula: grossProfit = adjustedStartingBalance * (grossReturnPct / 100)
   Math: $100,000.00 * (10.00 / 100) = $10,000.00
       │
       ▼
4. Source Investor Split Entitlement
   Source Split % (investors.split_pct) = 75.00%
   Formula: sourceKeptAmount = grossProfit * (sourceSplitPct / 100)
   Math: $10,000.00 * (75.00 / 100) = $7,500.00
       │
       ▼
5. Remaining Commission Pool
   Formula: commissionPoolPct = 100.00 - sourceSplitPct = 25.00%
   Formula: grossPoolAmount = grossProfit * (commissionPoolPct / 100)
   Math: $10,000.00 * (25.00 / 100) = $2,500.00
       │
       ▼
6. Recipient Allocations (commission_shares)
   Recipient B Share % = 50.00% of Pool
   Formula: recipientBAmount = grossPoolAmount * (commissionPercent / 100)
   Math: $2,500.00 * (50.00 / 100) = $1,250.00 (12.50% of Gross Profit)

   Recipient C Share % = 50.00% of Pool
   Formula: recipientCAmount = grossPoolAmount * (commissionPercent / 100)
   Math: $2,500.00 * (50.00 / 100) = $1,250.00 (12.50% of Gross Profit)
       │
       ▼
7. Accounting Reconciliation Proof
   Total Distributed = Source Kept ($7,500.00) + Total Recipients ($2,500.00) = $10,000.00
   Unallocated Pool = Gross Pool ($2,500.00) - Total Recipients ($2,500.00) = $0.00
   Accounting Variance = Gross Profit ($10,000.00) - Total Distributed ($10,000.00) = $0.00
   Status: PASS
```

---

## 7. COMMISSION ENGINE ANALYSIS

### Codebase Inventory of Calculation Engines

Commissions and profit sharing are calculated in **four separate locations** across the codebase:

1.  **`lib/dashboard.js` (`buildInvestorDashboard`)**: Calculates dynamic commission earnings fallbacks when `commission_earnings` rows are absent.
2.  **`api/admin/commission-audit/index.js` (`calculateSingleAudit` & `handleRunAllAudit`)**: Authoritative reconciliation engine for admin audit reports, CSV exports, and Excel workbooks.
3.  **`api/admin/commission-shares/bulk.js`**: Validates total assigned commission pool percentages during rule creation.
4.  **`admin.html` (Frontend client-side scripts)**: In-browser calculation helpers for preview modals.

### Discrepancy & Duplication Assessment

*   **Is there ONE centralized engine?** **NO.** The calculation logic is duplicated between `lib/dashboard.js` and `api/admin/commission-audit/index.js`.
*   **Inconsistency Identified:** `lib/dashboard.js` fallback logic estimates source monthly profit by compounding starting capital across past months (`accBalance * (grossPct / 100)`), whereas `commission-audit/index.js` reads actual historical monthly balances from `investor_monthly_history`. As a result, if manual historical overrides exist, the investor dashboard dynamic commission fallback and the admin audit report can produce differing numbers unless `commission_earnings` ledger rows are explicitly written.

---

## 8. MEANING OF COMMISSION PERCENTAGES

### Definitive Rule Analysis

*   **`investors.split_pct`**: Represents the **Source Investor's direct entitlement percentage of GROSS PROFIT** (e.g. `75.00%`).
*   **`commission_shares.commission_percent`**: Represents the **Recipient's percentage share of the REMAINING COMMISSION POOL**, NOT gross profit.

### Mathematical Proof

If Gross Profit = $10,000.00, Source Split = 75%, and Recipient Commission Share = 50%:
*   Source Kept = $10,000.00 * 75% = **$7,500.00**
*   Commission Pool = $10,000.00 * (100% - 75%) = **$2,500.00**
*   Recipient Allocation = $2,500.00 * 50% = **$1,250.00** (which equals 12.5% of Gross Profit)

### Pool Constraint Enforcement

The API in `api/admin/commission-shares/index.js` and `bulk.js` explicitly enforces that the sum of active recipient `commission_percent` values cannot exceed the available pool (`100 - split_pct`):

```js
const maxPool = 100 - invSplit;
if (totalAllocated > maxPool + 0.01) {
  return res.status(400).json({
    error: `Total active assigned commission (${totalAllocated.toFixed(2)}%) exceeds available commission pool (${maxPool.toFixed(2)}%)`
  });
}
```

---

## 9. HISTORICAL GOOGLE SHEET DATA

### Data Lineage & Authority

*   **Origin:** Historical financial data originated from Google Sheets tabs (`Investors`, `Investor_Accounts`, `Deposits`, `Withdrawals`, `Monthly_Returns`, `Live_Performance`).
*   **Database Storage:** Historical records were migrated into Supabase table `investor_monthly_history` with `is_manual: true`.
*   **Authority Status:** `investor_monthly_history` records with `is_manual: true` are considered **authoritative**. When `buildInvestorDashboard()` or `calculateSingleAudit()` runs, if a row exists in `investor_monthly_history` for a given month, the system reads `opening_balance`, `manual_gain_amount`, and `ending_balance` directly from the database rather than calculating them dynamically.
*   **Google Sheet Dependency:** The platform can operate entirely on Supabase (`DATA_SOURCE=supabase`). Google Sheets serves as a secondary fallback data provider.

---

## 10. MONTHLY FINALIZATION & IMMUTABILITY

### Finalization State Machine

*   **Does the platform have a formal month closure state machine?** **NO.** The platform does not currently have an explicit `'OPEN'` vs `'FINALIZED'` month status flag on calculations.
*   **Can historical payouts change if rules are edited today?**
    *   **IF `commission_earnings` LEDGER ROWS EXIST:** **NO.** If commission earnings rows were written to `commission_earnings` for January, both `dashboard.js` and `commission-audit/index.js` read the committed ledger rows. Modifying `commission_shares` today will not alter January's past earnings.
    *   **IF `commission_earnings` LEDGER ROWS ARE MISSING:** **YES.** If no ledger rows were written for January, `dashboard.js` dynamically calculates historical commission estimates using current active rules in `commission_shares`. Editing rules today would alter past estimated displays.

---

## 11. COMMISSION EARNINGS LEDGER

### Ledger Mechanics (`commission_earnings` Table)

*   **Creation:** Rows are created via API requests or bulk seed scripts.
*   **Automation:** Ledger rows are **NOT automatically generated** by a background cron job when a month ends. Admin intervention or script execution is required to commit ledger entries.
*   **Immutability:** Once written, `commission_earnings` rows represent immutable historical records.
*   **Usage:**
    *   `lib/dashboard.js` queries `commission_earnings` to populate the investor's commission earnings metrics and breakdown modal.
    *   `api/admin/commission-audit/index.js` checks `commission_earnings` first (`recipientDataSource = "ledger"`). If rows exist, it uses them; otherwise, it falls back to `calculated_from_rules`.

---

## 12. DEPOSITS AND WITHDRAWALS

### Compounding & Timing Logic

In `lib/dashboard.js` and `api/admin/commission-audit/index.js`, monthly balances are computed in the following strict order:

```js
// 1. Prior Month Ending Balance
startingBalance = priorMonthEndingBalance;

// 2. Adjust Capital Base for Intra-Month Capital Movements
adjustedStartingBalance = startingBalance + deposits - withdrawals;

// 3. Apply Monthly Gross Trading Return to Adjusted Capital Base
grossProfit = adjustedStartingBalance * (grossReturnPct / 100);
investorNetGain = grossProfit * (splitPct / 100);

// 4. Subtract Fixed Recurring Monthly Draw & Compute Ending Balance
endingBalance = Math.max(0, adjustedStartingBalance + investorNetGain - recurringDraw);
```

### Capital Timing Limitation

*   **Intra-Month Timing:** Deposits and withdrawals occurring mid-month are currently applied at the start of the monthly return calculation (`adjustedStartingBalance`). The platform does not currently perform daily time-weighted rate of return (TWRR) weighting for mid-month capital movements.

---

## 13. FINANCIAL ARITHMETIC & PRECISION

### Evaluation of Arithmetic Implementation

*   **JavaScript IEEE-754 Risk:** Standard JavaScript numbers are double-precision floating point. Operations like `0.1 + 0.2 = 0.30000000000000004` can introduce micro-rounding drift.
*   **`decimal.js` Usage:** `decimal.js` is imported in `lib/dashboard.js` and `api/admin/commission-audit/index.js` with `precision: 20` and `ROUND_HALF_UP`. Internal monthly compounding loops use `Decimal` objects for intermediate addition/multiplication.
*   **Casting Boundary:** At the boundary of database queries and API response JSON payloads, `Decimal` instances are cast back to standard JS numbers via `.toNumber()`.
*   **Recommendation:** Migrating financial calculations to integer cents or keeping `Decimal` instances intact throughout calculation workflows will eliminate floating-point drift.

---

## 14. ROUNDING RULES & TOLERANCE

### Current Rounding Rules

*   **Rounding Mode:** `Decimal.ROUND_HALF_UP` (standard financial rounding).
*   **Audit Tolerance:** In `api/admin/commission-audit/index.js`, a **$0.05 tolerance threshold** is enforced for audit reconciliation:

```js
const allocationTolerance = 0.05;
const isFullyAllocated = Math.abs(unallocatedPoolAmount) <= allocationTolerance;
const hasNoAccountingVariance = Math.abs(varianceAmount) <= allocationTolerance;
const isPass = isFullyAllocated && hasNoAccountingVariance && unallocatedPoolAmount >= -allocationTolerance;
```

*   **Penny-Split Handling:** If a division results in fractional cents (e.g. $100.00 / 3 = $33.3333...), each recipient receives $33.33. The leftover $0.01 remains in `unallocatedPoolAmount` and is flagged if it exceeds $0.05.

---

## 15. INVESTOR DASHBOARD ARCHITECTURE

### Data Flow Trace

```
1. User logs in at index.html → POST /api/login → HMAC session cookie set
2. index.html calls loadDashboard() → GET /api/me
3. api/me.js verifies scff_session cookie → extracts investorId
4. api/me.js calls buildInvestorDashboard(investorId) in lib/dashboard.js
5. lib/dashboard.js queries Supabase tables:
   - investors (profile, split_pct, monthly_draw)
   - investor_accounts (starting_capital, total_cash_in)
   - monthly_returns (fund trading returns)
   - deposits & withdrawals (capital movements)
   - investor_monthly_history (authoritative manual historical overrides)
   - commission_earnings & commission_shares (commission payouts & rules)
   - live_performance (sidebar headline feed)
6. Compounding loop executes → constructs summary, monthlyHistory, breakdown
7. JSON payload returned to index.html → rendered in UI via renderSummary(), renderLive(), renderMonths(), renderChart(), renderBreakdown()
```

---

## 16. AUTHENTICATION & SECURITY

### Authentication Architecture

*   **Investor Login:** `POST /api/login` verifies credentials using `verifyPassword()` in `lib/password.js`. Supports bcrypt hashes (`$2a$`, `$2b$`, `$2y$`) and legacy plaintext. Upon success, issues an HTTP-only HMAC-SHA256 signed cookie (`scff_session`).
*   **Admin Login:** `POST /api/admin/login` verifies admin credentials and issues an HTTP-only HMAC-SHA256 signed cookie (`scff_admin_session`).
*   **Session Verification:** `verifySession(token)` in `lib/auth.js` splits token into `[body, signature]`, re-computes HMAC-SHA256 using `CONFIG.sessionSecret`, and parses base64url payload.
*   **Front-End State Machine:** `index.html` implements a centralized `showView(view)` state machine controlling `login`, `changePassword`, `dashboard`, and `error` card visibility, guaranteeing exactly one view is visible at all times.

---

## 17. AUTHORIZATION & DATA PRIVACY

### Server-Side Access Control

*   **Investor Endpoint (`/api/me`)**: Restricted strictly to the authenticated investor's ID derived from `scff_session`. Investors cannot pass arbitrary investor IDs to view other accounts.
*   **Admin Endpoints (`/api/admin/*`)**: Protected by `verifyAdminSession(req)` in `lib/adminAuth.js`. Requires valid `scff_admin_session` with `role: "admin"`. Unauthenticated requests return `401 Unauthorized`.
*   **Data Isolation:** Investor accounts cannot view outgoing commission recipients, other investor balances, or administrative audit reports.

---

## 18. AUDIT & RECONCILIATION ENGINE

### Audit Report Architecture

Implemented in `api/admin/commission-audit/index.js`.

*   **Single Account Audit:** `calculateSingleAudit()` calculates full financial reconciliation for a source account in a given month.
*   **Run All Audit:** `handleRunAllAudit()` iterates across all active investors in the system, executes `calculateSingleAudit()`, aggregates totals, sorts `FLAGGED` accounts first, and returns summary metrics.
*   **Reconciliation Equation:**
    $$\text{Gross Profit} = \text{Source Kept} + \text{Total Recipients} + \text{Unallocated Pool} + \text{Variance}$$
*   **Export Formats:**
    *   **JSON:** API payload for admin dashboard UI.
    *   **CSV:** Tabular CSV stream with UTF-8 BOM.
    *   **Excel (`.xlsx`):** Multi-sheet workbook generated via `ExcelJS` containing Summary, Recipient Breakdown, and Monthly YTD Ledger.

---

## 19. AUTOMATION MATRIX

| System Action | Current Classification | Details / Requirements |
|---|---|---|
| Myfxbook Headline Feed Sync | **AUTOMATIC** | Vercel Cron daily at 11 PM UTC |
| Monthly Return % Input | **MANUAL** | Admin enters gross return in `monthly_returns` |
| Investor Balance Calculation | **AUTOMATIC** | Computed dynamically on dashboard view |
| Deposit / Withdrawal Entry | **MANUAL** | Admin records transactions |
| Commission Rule Creation | **MANUAL** | Admin sets up `commission_shares` |
| Commission Earnings Ledger Commit | **MANUAL / SCRIPT** | Admin/script commits entries to `commission_earnings` |
| Monthly Closing / Lock | **MANUAL** | Admin locks `monthly_returns` row |
| Audit Report Generation | **AUTOMATIC ON-DEMAND** | Admin clicks "Generate Report" or "Run All" |
| Email Broadcast | **MANUAL** | Admin composes and sends via Email Center |
| Password Setup / Reset | **AUTOMATIC / ADMIN** | First-login setup + Admin reset modal |

---

## 20. FAILURE & DUPLICATION RISKS

1.  **Missing `commission_earnings` Ledger Rows:** If ledger entries are not written when a month closes, changing commission rules in the future will dynamically alter historical commission displays for past months.
2.  **Unallocated Pool Flagging:** If recipient commission shares do not sum to 100% of the commission pool, the audit report flags the account as `FLAGGED` due to unallocated funds.
3.  **Concurrent Cron / Double Sync:** `updateLivePerformance()` uses `upsert` on `metric`, preventing duplicate database row creation during concurrent sync triggers.

---

## 21. EXISTING TEST SUITE

The repository contains 5 diagnostic and integration test scripts:

1.  `final-qa.js`: End-to-end HTTP integration test verifying admin login, investor creation, account creation, deposit, withdrawal, live performance update, and read-only snapshots.
2.  `integrity-test.js`: Validates dashboard calculation outputs against Supabase database data.
3.  `qa-logic-check.js`: Verifies mathematical balance compounding, adjusted starting capital, and gross return math.
4.  `test-recalc.js`: Tests balance recalculations across historical months.
5.  `scratch/check_html.js`: Custom HTML parser verifying tag balancing and DOM hierarchy.

---

## 22. GIT HISTORY SUMMARY

Recent architectural milestones from git log:
*   `b45575b`: Implemented centralized `showView()` state machine in `index.html` preventing blank-screen state transitions.
*   `b1ad35d`: Fixed HTML tag structure and div nesting in `index.html` and `admin.html`.
*   `8c6e271`: Added `bcryptjs` password hashing and legacy password compatibility.
*   `264decd`: Updated audit reconciliation rules (unallocated pool flagged) and added "Run All" mode.
*   `fd00cca`: Added ExcelJS multi-sheet `.xlsx` export engine.
*   `9c698a3`: Built Admin Audit Report tab, CSV export, and first-login security update flow.
*   `28f8558`: Implemented two-date commission timing rule (earned month vs credit month).

---

## 23. CURRENT KNOWN BUGS & GAPS

1.  **Unallocated Commission Pools:** Source accounts where recipient commission shares do not total 100% of the commission pool show as `FLAGGED` in audit reports until remaining shares are assigned.
2.  **No Automated Ledger Generation:** `commission_earnings` rows require explicit script execution or admin commits when a month ends.
3.  **Mid-Month Capital Weighting:** Deposits/withdrawals made mid-month receive the full month's return rather than a time-weighted return.

---

## 24. ARCHITECTURAL RISK ASSESSMENT

| Domain Area | Risk Rating | Justification |
|---|---|---|
| **Myfxbook Sync** | **LOW** | Idempotent upserts, daily cron, Scrape.do fallback scraper working reliably. |
| **Financial Arithmetic** | **MEDIUM** | `decimal.js` used in loops, but numbers cast to JS `Number` at boundaries. |
| **Commission Engine** | **MEDIUM** | Duplicated between `dashboard.js` and `commission-audit/index.js`. |
| **Historical Integrity** | **LOW** | `investor_monthly_history` with `is_manual: true` protects historical data. |
| **Authentication** | **LOW** | HMAC-SHA256 cookies, `bcryptjs` hashing, and `showView()` state machine active. |
| **Authorization / Privacy** | **LOW** | Strict server-side session checks on `/api/me` and `/api/admin/*`. |
| **Dashboard Consistency** | **LOW** | Unified payload builder in `lib/dashboard.js`. |
| **Monthly Closing** | **MEDIUM** | Lacks automated script/cron to finalize months and auto-generate `commission_earnings`. |
| **Idempotency** | **LOW** | Primary keys and unique constraints enforce database idempotency. |
| **Audit & Reporting** | **LOW** | Comprehensive Audit engine with 100% money flow proof, CSV, and Excel exports. |

---

## 25. DIRECT ANSWERS TO QUESTIONS A–J

### A. Is the platform currently capable of automatically going Myfxbook → monthly performance → investor profit → commission allocation → recipient earnings → investor dashboards without manual intervention?
**PARTIALLY.** Myfxbook automatically updates the headline fund metrics sidebar daily. However, allocating investor profit, computing exact monthly returns, and generating recipient commission ledger entries currently requires admin input of the monthly gross return percentage.

### B. What parts still require manual action?
1. Entering/locking the monthly gross return percentage in `monthly_returns`.
2. Entering new deposits or withdrawals in `deposits` / `withdrawals`.
3. Generating and committing ledger rows to `commission_earnings` at month-end.

### C. Is there currently one authoritative commission calculation engine?
**NO.** The calculation logic is implemented in `lib/dashboard.js` for investor dashboards and `api/admin/commission-audit/index.js` for admin audit reports.

### D. Can current financial arithmetic produce rounding/floating-point discrepancies?
**YES (MINOR).** While `decimal.js` is used internally during calculation loops, values are cast back to standard JavaScript numbers (`.toNumber()`) at database and API boundaries, which can produce minor floating-point representation artifacts (e.g. `$0.000000001`).

### E. Can historical finalized months change when current commission rules change?
*   **If `commission_earnings` ledger rows exist:** **NO.**
*   **If `commission_earnings` ledger rows are missing:** **YES** (because the system falls back to dynamic calculation using current rules).

### F. Can running the same synchronization/calculation twice duplicate money?
**NO.** Database operations use `upsert` with unique constraints (`(year, month_number)` and primary keys), ensuring idempotency.

### G. Are `commission_earnings` automatically generated?
**NO.** They are generated via admin action or database scripts.

### H. Is Myfxbook automatically synchronized on a schedule?
**YES.** Scheduled daily at 11:00 PM UTC via Vercel Cron.

### I. What is the authoritative source for each data type?
*   **Trading Returns (Headline):** Myfxbook via Scrape.do / API stored in `live_performance`.
*   **Trading Returns (Monthly Fund):** `monthly_returns` table in Supabase.
*   **Balances:** Computed dynamically in `lib/dashboard.js` or read from `investor_monthly_history` (`is_manual: true`).
*   **Deposits:** `deposits` table in Supabase.
*   **Withdrawals:** `withdrawals` table in Supabase.
*   **Commission Rules:** `commission_shares` table in Supabase.
*   **Historical Recipient Earnings:** `commission_earnings` table in Supabase.

### J. TOP 10 Recommendations for Full Automation:
1.  **Unified Calculation Module:** Refactor `dashboard.js` and `commission-audit/index.js` to share a single importable core calculation package.
2.  **Automated Month-End Cron:** Create an automated monthly closing job that calculates and commits `commission_earnings` ledger rows on the 1st of every month.
3.  **Automated Myfxbook Monthly Return Importer:** Automatically extract monthly closed trade return percentages from Myfxbook into `monthly_returns`.
4.  **End-to-End `Decimal` Pipeline:** Maintain `Decimal` objects throughout the pipeline to eliminate floating-point casting artifacts.
5.  **Intra-Month Time-Weighted Return (TWRR):** Implement daily time-weighted capital calculations for mid-month deposits/withdrawals.
6.  **Immutable Month Locking:** Add an explicit `is_closed` boolean flag to lock closed months against retro-active rule changes.
7.  **Penny-Breakout Allocation Rule:** Implement explicit penny-rounding assignment so unallocated cents are deterministically assigned.
8.  **Automated Commission Pool Alerting:** Trigger admin notifications if an active investor's commission shares do not sum to 100% of the pool.
9.  **Database Row Level Security (RLS) Policies:** Add user-specific Supabase RLS policies for enhanced client-side direct database query safety.
10. **Automated Regression Test Pipeline:** Add continuous integration (CI) workflow executing `final-qa.js` and `integrity-test.js` on every pull request.

---
*End of Technical Handoff Document.*
