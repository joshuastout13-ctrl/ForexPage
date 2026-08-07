# Stone & Company Forex Fund — Key Source Code Excerpts

**Document Version:** 1.0.0  
**Repository:** `joshuastout13-ctrl/ForexPage` (`4xtrack.com`)  
**Note:** All credentials, tokens, and secrets have been redacted.

---

## 1. MYFXBOOK SYNCHRONIZATION

### File: `lib/myfxbook.js`

```javascript
import { CONFIG } from "./config.js";
import { readSheet, num } from "./sheets.js";

let cachedSession = null;
let sessionExpiry = 0;

const MYFXBOOK_API = "https://www.myfxbook.com/api";

/**
 * Logs into the Myfxbook API and returns a session token.
 */
async function myfxbookLogin() {
  const { myfxbookEmail, myfxbookPassword } = CONFIG;

  if (!myfxbookEmail || !myfxbookPassword) {
    throw new Error("MYFXBOOK_EMAIL and MYFXBOOK_PASSWORD env vars are required");
  }

  // Reuse cached session if still valid
  if (cachedSession && Date.now() < sessionExpiry) {
    return cachedSession;
  }

  const url = `${MYFXBOOK_API}/login.json?email=${encodeURIComponent(myfxbookEmail)}&password=${encodeURIComponent(myfxbookPassword)}`;
  const res = await fetch(url);
  const data = await res.json();

  if (data.error) {
    throw new Error(`Myfxbook login failed: ${data.message}`);
  }

  cachedSession = data.session;
  sessionExpiry = Date.now() + 24 * 60 * 60 * 1000;

  console.log("[Myfxbook API] Login successful, session cached");
  return cachedSession;
}

/**
 * Fetches ForEx Investment Tracker data from Myfxbook's watched accounts.
 */
async function fetchWatchedAccount(session) {
  const url = `${MYFXBOOK_API}/get-watched-accounts.json?session=${session}`;
  const res = await fetch(url);
  const data = await res.json();

  if (data.error) {
    cachedSession = null;
    sessionExpiry = 0;
    throw new Error(`Myfxbook get-watched-accounts failed: ${data.message}`);
  }

  const accounts = data.accounts || [];
  if (accounts.length === 0) {
    throw new Error("No watched accounts found. Please add the fund account to your Myfxbook watchlist.");
  }

  const targetId = CONFIG.myfxbookAccountId;
  let account;

  if (targetId) {
    account = accounts.find((a) => String(a.id) === String(targetId));
  }
  if (!account) {
    account = accounts.find((a) => (a.name || "").toLowerCase().includes("stone"));
  }
  if (!account) {
    account = accounts[0];
  }

  return account;
}

/**
 * Fetches live performance metrics from Myfxbook API & Scrape.do fallback.
 */
export async function getMyfxbookLive({ previewMode = false } = {}) {
  const result = {
    today: "0.00%",
    week: "0.00%",
    month: "0.00%",
    year: "0.00%",
    gain: "0.00%",
    absGain: "0.00%",
    daily: "0.00%",
    monthly: "0.00%",
    drawdown: "0.00%",
    fetchedAt: new Date().toISOString(),
    source: "Hybrid (Sheets + API)"
  };

  const useSupabase = process.env.DATA_SOURCE === "supabase";
  const sourceName = useSupabase ? "Supabase" : "Google Sheets";

  try {
    let sourceData = [];
    if (useSupabase) {
      const { readSupabaseTable } = await import("./supabase.js");
      sourceData = await readSupabaseTable("live_performance");
    } else {
      sourceData = await readSheet(CONFIG.tabs.livePerformance);
    }

    const fmt = (v) => {
      const n = parseFloat(String(v).replace(/[%\s]/g, ""));
      if (isNaN(n)) return "0.00%";
      return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
    };

    sourceData.forEach((row) => {
      const metric = String(row.metric || row.Metric || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      const val = fmt(row.value || row.Value || row.valuepct || row.value_pct || "0.00%");
      
      if (metric === "today") result.today = val;
      if (metric === "thisweek" || metric === "week") result.week = val;
      if (metric === "thismonth" || metric === "month") result.month = val;
      if (metric === "thisyear" || metric === "year") result.year = val;
      if (metric === "gain") result.gain = val;
    });
  } catch (err) {
    console.error(`[Myfxbook] ${sourceName} performance fetch failed:`, err.message);
  }

  if (CONFIG.myfxbookEmail && CONFIG.myfxbookPassword) {
    try {
      const session = await myfxbookLogin();
      const account = await fetchWatchedAccount(session);

      const fmtPct = (v) => {
        const n = parseFloat(v);
        if (isNaN(n)) return "0.00%";
        return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
      };

      result.gain = fmtPct(account.gain);
      result.absGain = fmtPct(account.gain);
      result.drawdown = `${parseFloat(account.drawdown || 0).toFixed(2)}%`;
      result.accountName = account.name || "N/A";

      if (result.year === "0.00%") {
        result.year = fmtPct(account.gain);
      }
    } catch (err) {
      console.error("[Myfxbook API] Error fetching real-time gain:", err.message);
      result.source = "Google Sheets (Final Fallback)";
    }
  }
  
  if (CONFIG.scrapedotdoToken) {
    try {
      const scraperData = await fetchScrapeDoMetrics();
      
      const updateIfValid = (key, val) => {
        if (val && val !== "0.00%" && val !== "N/A" && val !== "NOT FOUND") {
          result[key] = val;
        }
      };

      updateIfValid("today", scraperData.today);
      updateIfValid("week", scraperData.week);
      updateIfValid("month", scraperData.month);
      updateIfValid("year", scraperData.year);

      result.source = "Myfxbook (Scrape.do)";
      
      if (!previewMode) {
        const { updateLivePerformance } = await import("./supabase.js");
        await updateLivePerformance(scraperData);
      }
    } catch (err) {
      console.error("[Myfxbook] Scrape.do scraper failed:", err.message);
    }
  } 
  
  return result;
}

async function fetchScrapeDoMetrics() {
  const params = new URLSearchParams({
    token: CONFIG.scrapedotdoToken,
    url: CONFIG.myfxbookUrl,
    super: "true",
    render: "true"
  });

  const url = `https://api.scrape.do?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Scrape.do API error: ${res.status}`);

  const html = await res.text();
  const extract = (label) => {
    const regex = new RegExp(`${label}</td>[\\s\\S]*?<span[^>]*>([^<%\\s]+)%`, "i");
    const match = html.match(regex);
    if (!match) return "0.00%";
    const n = parseFloat(match[1]);
    return isNaN(n) ? "0.00%" : `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
  };

  return {
    today: extract("Today"),
    week: extract("This Week"),
    month: extract("This Month"),
    year: extract("This Year")
  };
}
```

### File: `api/cron/sync-myfxbook.js`

```javascript
import { getMyfxbookLive } from "../../lib/myfxbook.js";

export default async function handler(req, res) {
  const authHeader = req.headers.authorization;
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  const isAuthorized = isVercelCron || (authHeader && authHeader === `Bearer ${process.env.CRON_SECRET}`);

  if (!isAuthorized) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const data = await getMyfxbookLive();
    return res.status(200).json({ 
      success: true, 
      message: "Sync completed successfully",
      data
    });
  } catch (error) {
    return res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
}
```

---

## 2. INVESTOR DASHBOARD & COMPOUNDING ENGINE

### File: `lib/dashboard.js` (Core Excerpt)

```javascript
import { readSheet, num, bool, monthNum, filterInvestors } from "./sheets.js";
import { readSupabaseTable, normalizeRow } from "./supabase.js";
import { CONFIG } from "./config.js";
import { getMyfxbookLive } from "./myfxbook.js";
import Decimal from "decimal.js";

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

export async function buildInvestorDashboard(investorId, preloadedData = null) {
  const id = String(investorId ?? "").trim();
  if (!id) throw Object.assign(new Error("Missing investor ID"), { status: 400 });

  const useSupabase = process.env.DATA_SOURCE === "supabase";
  // Data loading ...
  const [rawInvestors, accounts, returnsSheet, depositsSheet, withdrawalsSheet, historyTable, commissionEarningsTable, commissionSharesTable, commissionRulesTable, live] = await Promise.all([
    readSupabaseTable("investors"),
    readSupabaseTable("investor_accounts"),
    readSupabaseTable("monthly_returns"),
    readSupabaseTable("deposits"),
    readSupabaseTable("withdrawals"),
    readSupabaseTable("investor_monthly_history"),
    readSupabaseTable("commission_earnings"),
    readSupabaseTable("commission_shares"),
    readSupabaseTable("commission_rules"),
    getMyfxbookLive()
  ]);

  // Compounding Loop per month
  let balance = new Decimal(startCapital);
  let totalGain = new Decimal(0);
  let totalWithdrawals = new Decimal(0);
  let summaryBalance = new Decimal(startCapital);
  const decSplitPct = new Decimal(splitPct);
  const decRecurringDraw = new Decimal(recurringDraw);

  const breakdown = [];
  for (const row of monthlyHistory) {
    const m = row.monthNumber;
    const deps = new Decimal(depByMonth[m] || 0);
    const wds = new Decimal(wdByMonth[m] || 0);
    const grossPct = new Decimal(row.grossReturnPct || 0);
    let effPct = grossPct.mul(decSplitPct).div(100);

    const historyRow = historyRecords.find(hr => hr.month_number === m);
    
    // Order of operations:
    // 1. prior ending balance (balance)
    // 2. + deposits (deps)
    // 3. - withdrawals (wds)
    // 4. apply gross return x split %
    // 5. - recurring draw
    const startingBal = historyRow ? new Decimal(historyRow.opening_balance) : balance;
    const adjustedStart = historyRow 
      ? new Decimal(historyRow.opening_balance).add(historyRow.deposits || 0).sub(historyRow.withdrawals || 0)
      : balance.add(deps).sub(wds);

    let gain = new Decimal(0);
    let ending = new Decimal(0);

    if (historyRow) {
      if (historyRow.manual_gain_amount !== null && historyRow.manual_gain_amount !== undefined) {
        gain = new Decimal(historyRow.manual_gain_amount);
      } else {
        const returnPct = historyRow.manual_return_pct !== null ? new Decimal(historyRow.manual_return_pct) : effPct;
        gain = adjustedStart.mul(returnPct).div(100);
      }
      ending = new Decimal(historyRow.ending_balance);
    } else {
      gain = adjustedStart.mul(effPct).div(100);
      ending = Decimal.max(0, adjustedStart.add(gain).sub(decRecurringDraw));
    }

    // Commission earnings ...
    balance = ending.add(commissionsEarned);
  }

  return { summary, live, monthlyHistory, breakdown };
}
```

---

## 3. AUDIT & RECONCILIATION ENGINE

### File: `api/admin/commission-audit/index.js` (Core Audit Calculation Function)

```javascript
export function calculateSingleAudit({
  sourceInvestorId, year, monthNumber,
  allInvestors, allAccounts, allHistory, allMonthlyReturns, allShares, allEarnings
}) {
  const { monthStartStr, monthEndStr } = getMonthDateBounds(year, monthNumber);

  // 1. Source Investor Record
  const searchId = String(sourceInvestorId || "").trim().toLowerCase();
  const sourceInv = (allInvestors || []).find(i =>
    String(i.id || "").toLowerCase() === searchId ||
    String(i.portal_username || "").toLowerCase() === searchId ||
    String(i.email || "").toLowerCase() === searchId
  );
  if (!sourceInv) return null;

  const sourceIdSet = new Set([sourceInv.id, sourceInv.portal_username, sourceInv.email].filter(Boolean).map(s => String(s).trim().toLowerCase()));

  // 2. Source Accounts & Monthly History
  const sourceAccounts = (allAccounts || []).filter(a => sourceIdSet.has(String(a.investor_id || a.id || "").trim().toLowerCase()));
  const sourceHistAllMonths = (allHistory || []).filter(h => sourceIdSet.has(String(h.investor_id || h.investorid || "").trim().toLowerCase()));
  const sourceHist = sourceHistAllMonths.find(h => num(h.month_number) === monthNumber);

  // 3. Gross Profit Calculation
  const monthlyReturnObj = (allMonthlyReturns || []).find(r => num(r.month_number) === monthNumber);
  const grossReturnPct = monthlyReturnObj ? num(monthlyReturnObj.gross_return_pct) : (sourceHist ? num(sourceHist.gross_return_pct) : 0);

  let startingBalance = sourceHist ? num(sourceHist.opening_balance) : 0;
  let deposits = sourceHist ? num(sourceHist.deposits) : 0;
  let withdrawals = sourceHist ? num(sourceHist.withdrawals) : 0;
  let adjustedStartingBalance = (sourceHist && num(sourceHist.adjusted_opening_balance) > 0)
    ? num(sourceHist.adjusted_opening_balance)
    : (startingBalance + deposits - withdrawals);

  let grossProfit = new Decimal(adjustedStartingBalance).mul(grossReturnPct).div(100).toNumber();
  if (sourceHist && num(sourceHist.gross_gain || sourceHist.manual_gain_amount) > 0) {
    grossProfit = num(sourceHist.gross_gain || sourceHist.manual_gain_amount);
  }

  // 4. Source Split & Pool Calculations
  const sourceSplitPct = num(sourceInv.split_pct || 75);
  const sourceKeptAmount = new Decimal(grossProfit).mul(sourceSplitPct).div(100).toNumber();
  const commissionPoolPct = 100 - sourceSplitPct;
  const grossPoolAmount = new Decimal(grossProfit).mul(commissionPoolPct).div(100).toNumber();

  // 5. Recipient Allocations
  const sourceEarningsThisMonth = (allEarnings || []).filter(e =>
    sourceIdSet.has(String(e.source_investor_id || "").trim().toLowerCase()) &&
    num(e.month_number) === monthNumber &&
    e.status !== 'void' && e.status !== 'cancelled'
  );

  let recipientBreakdown = [];
  if (sourceEarningsThisMonth.length > 0) {
    recipientBreakdown = sourceEarningsThisMonth.map(e => {
      const recId = String(e.recipient_id || "").trim().toLowerCase();
      const recInv = (allInvestors || []).find(i => String(i.id || "").toLowerCase() === recId || String(i.portal_username || "").toLowerCase() === recId);
      const amt = num(e.amount);
      const effectivePct = grossProfit > 0 ? (amt / grossProfit) * 100 : 0;
      const share = (allShares || []).find(s => sourceIdSet.has(String(s.source_investor_id || "").toLowerCase()) && String(s.recipient_investor_id || "").toLowerCase() === recId);
      const commPctOfPool = share ? num(share.commission_percent) : (commissionPoolPct > 0 ? (amt / grossPoolAmount) * 100 : 0);

      return {
        recipientId: recInv ? recInv.id : e.recipient_id,
        recipientName: recInv ? `${recInv.first_name || ''} ${recInv.last_name || ''}`.trim() : recId,
        commissionPctOfPool: commPctOfPool,
        effectivePctOfGrossProfit: effectivePct,
        amountReceived: amt,
        earnedMonth: `${MONTH_NAMES[monthNumber]} ${year}`,
        creditMonth: `${MONTH_NAMES[(monthNumber % 12) + 1]} ${monthNumber === 12 ? year + 1 : year}`
      };
    });
  }

  // 6. Strict Accounting & Reconciliation Proof
  const totalRecipientAmount = recipientBreakdown.reduce((sum, r) => sum + r.amountReceived, 0);
  const unallocatedPoolAmount = new Decimal(grossPoolAmount).sub(totalRecipientAmount).toNumber();
  const totalDistributedAmount = new Decimal(sourceKeptAmount).add(totalRecipientAmount).toNumber();
  const varianceAmount = new Decimal(grossProfit).sub(totalDistributedAmount).toNumber();

  const allocationTolerance = 0.05;
  const isFullyAllocated = Math.abs(unallocatedPoolAmount) <= allocationTolerance;
  const hasNoAccountingVariance = Math.abs(varianceAmount) <= allocationTolerance;
  const isPass = isFullyAllocated && hasNoAccountingVariance && unallocatedPoolAmount >= -allocationTolerance;

  return {
    sourceSummary: {
      sourceInvestorId: sourceInv.id,
      sourceName: `${sourceInv.first_name} ${sourceInv.last_name}`,
      startingBalance, currentBalance, deposits, withdrawals, adjustedStartingBalance,
      grossReturnPct, grossProfit, sourceInvestorSplitPct: sourceSplitPct,
      sourceInvestorKeptAmount, commissionPoolPct, grossPoolAmount,
      totalRecipientAmount, totalDistributedAmount, unallocatedPoolAmount, varianceAmount,
      status: isPass ? "PASS" : "FLAGGED",
      isPass
    },
    recipientBreakdown
  };
}
```

---

## 4. AUTHENTICATION & VIEW STATE MACHINE

### File: `lib/auth.js` (Session Helper)

```javascript
import crypto from "node:crypto";
import { CONFIG } from "./config.js";

function sign(value) {
  return crypto
    .createHmac("sha256", CONFIG.sessionSecret)
    .update(value)
    .digest("hex");
}

export function createSession(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = sign(body);
  return `${body}.${sig}`;
}

export function verifySession(token) {
  if (!token || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  const expected = sign(body);
  if (sig !== expected) return null;

  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}
```

### File: `index.html` (State Machine Excerpt)

```javascript
// Centralized View State Machine
const VIEW_IDS = {
  login: "loginCard",
  changePassword: "changePasswordCard",
  dashboard: "dashboard",
  error: "errorCard"
};

function showView(view) {
  for (const [key, id] of Object.entries(VIEW_IDS)) {
    const el = document.getElementById(id);
    if (!el) continue;
    if (key === view) {
      el.classList.remove("hidden");
    } else {
      el.classList.add("hidden");
    }
  }
}

// Global Error Diagnostics
window.addEventListener("error", (e) => console.error("[GLOBAL ERROR]", e.error || e.message));
window.addEventListener("unhandledrejection", (e) => console.error("[UNHANDLED PROMISE]", e.reason));

// Safe Application Startup
(async function initializeApp() {
  try {
    showView("login"); // Always show login as safe default
    await loadDashboard();
  } catch (err) {
    console.error("[App Init Error]", err);
    showErrorState("We couldn't start the application. Please try again.");
  }
})();
```

---
*End of Source Excerpts Document.*
