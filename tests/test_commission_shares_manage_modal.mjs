import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.SUPABASE_ANON_KEY;
delete process.env.DATA_SOURCE;
process.env.SESSION_SECRET = "test_commission_shares_modal_secret";

import { createSession } from "../lib/auth.js";
import commissionSharesHandler from "../api/admin/commission-shares/index.js";
import bulkHandler from "../api/admin/commission-shares/bulk.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function makeReqRes({ method = "GET", body = {}, cookie = "" } = {}) {
  const req = {
    method,
    headers: cookie ? { cookie } : {},
    query: {},
    body
  };
  const res = {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.payload = data;
      return this;
    }
  };
  return { req, res };
}

function createInMemorySharesDb() {
  const investors = [
    { id: "inv_jef", portal_username: "jefuller", first_name: "Jeff", last_name: "Fuller", email: "jef@example.com", split_pct: 50 },
    { id: "inv_015f3774", portal_username: "stoneandco", first_name: "Stone and", last_name: "Co", email: "stone@example.com", split_pct: 100 },
    { id: "inv_rwam", portal_username: "rwamsley", first_name: "Ross", last_name: "Wamsley", email: "ross@example.com", split_pct: 100 },
    { id: "inv_jstout", portal_username: "jstout", first_name: "Joshua", last_name: "Stout", email: "josh@example.com", split_pct: 100 }
  ];

  const shares = [
    { id: "cs_stone", source_investor_id: "inv_jef", source_account_id: null, recipient_investor_id: "inv_015f3774", commission_percent: 23, effective_start_date: "2026-11-01", effective_end_date: null, status: "active" },
    { id: "cs_ross", source_investor_id: "inv_jef", source_account_id: null, recipient_investor_id: "inv_rwam", commission_percent: 23, effective_start_date: "2026-11-01", effective_end_date: null, status: "active" },
    { id: "cs_josh", source_investor_id: "inv_jef", source_account_id: null, recipient_investor_id: "inv_jstout", commission_percent: 2, effective_start_date: "2026-11-01", effective_end_date: null, status: "active" }
  ];

  const accountingPeriods = [
    { year: 2026, month_number: 10, status: "FINALIZED" }
  ];
  const monthlyReturns = [
    { year: 2026, month_number: 10, locked: true },
    { year: 2026, month_number: 11, locked: false }
  ];

  const matchRow = (row, filters) => filters.every(([op, col, val]) => {
    const rv = row[col];
    if (op === "eq") return String(rv) === String(val);
    if (op === "ilike") return String(rv || "").toLowerCase() === String(val || "").toLowerCase();
    if (op === "or") {
      const clauses = String(val).split(",").map(s => s.trim()).filter(Boolean);
      return clauses.some(c => {
        const idx = c.indexOf(".eq.");
        if (idx === -1) return false;
        const fCol = c.slice(0, idx);
        const fVal = c.slice(idx + 4);
        return String(row[fCol] || "") === fVal;
      });
    }
    return true;
  });

  return {
    shares,
    investors,
    from(table) {
      const dataMap = {
        investors,
        commission_shares: shares,
        commission_rules: [],
        accounting_periods: accountingPeriods,
        monthly_returns: monthlyReturns
      };
      const source = dataMap[table];
      assert(source !== undefined, `Unexpected table ${table}`);

      return {
        select() {
          const filters = [];
          const chain = {
            eq(c, v) { filters.push(["eq", c, v]); return chain; },
            ilike(c, v) { filters.push(["ilike", c, v]); return chain; },
            or(expr) { filters.push(["or", null, expr]); return chain; },
            then(resolve, reject) {
              try {
                const matched = source.filter(r => matchRow(r, filters)).map(r => ({ ...r }));
                resolve({ data: matched, error: null });
              } catch (e) {
                if (reject) reject(e);
              }
            },
            async maybeSingle() {
              const matched = source.filter(r => matchRow(r, filters));
              return { data: matched[0] ? { ...matched[0] } : null, error: null };
            }
          };
          return chain;
        },
        update(patch) {
          return {
            async eq(col, val) {
              for (const row of source) {
                if (String(row[col]) === String(val)) {
                  Object.assign(row, patch);
                }
              }
              return { error: null };
            }
          };
        },
        async insert(row) {
          source.push({ id: `cs_new_${source.length + 1}`, ...row });
          return { error: null };
        }
      };
    }
  };
}

function runAdminModalFilterFromHtml(adminHtml, stateData, sourceInvestorId) {
  const helperMatch = adminHtml.match(/(function compareDropdownLabels[\s\S]*?)\/\* dropdown-helpers-end \*\//);
  assert(helperMatch, "admin.html must contain shared dropdown helpers");

  const startMarker = "} else if (tab === 'commission_shares') {";
  const startIdx = adminHtml.indexOf(startMarker);
  assert(startIdx !== -1, "admin.html must contain commission_shares modal branch");
  const endIdx = adminHtml.indexOf("fields.innerHTML = html;", startIdx);
  assert(endIdx !== -1, "admin.html must close commission_shares branch before fields.innerHTML");

  const slice = adminHtml.slice(startIdx + startMarker.length, endIdx);
  const fn = new Function(
    "state",
    "extraData",
    "item",
    "escapeHtml",
    `${helperMatch[1]}\nlet html = '';\n${slice.replace(/\}\s*$/, "")}\nreturn { html, currentShares, sourceUsername };`
  );
  const escapeHtml = (s) => String(s ?? "");
  return fn({ data: stateData }, { sourceInvestorId }, null, escapeHtml);
}

async function runTests() {
  console.log("=== Commission Shares Manage Modal & Bulk Update Regression Suite ===");
  const db = createInMemorySharesDb();
  const adminCookie = `scff_admin_session=${createSession({ adminId: "admin_1", role: "admin" })}`;

  // 1. GET /api/admin/commission-shares exposes both UI display fields AND canonical DB fields
  const { req: getReq, res: getRes } = makeReqRes({ method: "GET", cookie: adminCookie });
  await commissionSharesHandler(getReq, getRes, { supabase: db });
  assert.strictEqual(getRes.statusCode, 200);
  const listedShares = getRes.payload.commission_shares;
  assert.strictEqual(listedShares.length, 3);
  for (const s of listedShares) {
    assert.strictEqual(s.source_investor_id, "inv_jef");
    assert.strictEqual(s.investor_id, "jefuller");
    assert(s.recipient_investor_id, "must expose recipient_investor_id");
    assert(s.commission_percent !== undefined, "must expose commission_percent");
    assert.strictEqual(s.effective_start_date, "2026-11-01");
  }
  console.log("  PASS [1]: GET /api/admin/commission-shares returns canonical & display keys cleanly");

  // 2. admin.html Manage Shares modal matches existing shares & renders data-share-id rows for Jeff Fuller
  const adminHtml = fs.readFileSync(path.join(__dirname, "../admin.html"), "utf8");
  const modalOut = runAdminModalFilterFromHtml(
    adminHtml,
    { investors: db.investors, commission_shares: listedShares },
    "inv_jef"
  );
  assert.strictEqual(modalOut.currentShares.length, 3, "Manage Shares must load all 3 active rules for Jeff Fuller");
  assert(modalOut.html.includes('data-share-id="cs_stone"'), "Modal HTML must preserve cs_stone share id");
  assert(modalOut.html.includes('data-share-id="cs_ross"'), "Modal HTML must preserve cs_ross share id");
  assert(modalOut.html.includes('data-share-id="cs_josh"'), "Modal HTML must preserve cs_josh share id");
  assert(modalOut.html.includes('value="2026-11-01"'), "Modal HTML must render existing 2026-11-01 start date");
  assert(modalOut.html.includes('<option value="stoneandco" selected>'), "Modal HTML must pre-select Stone and Co");
  assert(modalOut.html.includes('<option value="rwamsley" selected>'), "Modal HTML must pre-select Ross Wamsley");
  assert(modalOut.html.includes('<option value="jstout" selected>'), "Modal HTML must pre-select Joshua Stout");
  console.log("  PASS [2]: admin.html Manage Shares loads all 3 existing rows with IDs, dates, and selected recipients");

  // 3. Updating Joshua Stout 2% -> 4% with preserved share IDs succeeds cleanly without OVERLAPPING_COMMISSION_SHARE
  const { req: updReq, res: updRes } = makeReqRes({
    method: "POST",
    cookie: adminCookie,
    body: {
      sourceInvestorId: "jefuller",
      accountId: null,
      shares: [
        { id: "cs_stone", recipientId: "stoneandco", commissionPercent: 23, effectiveStartDate: "2026-11-01", effectiveEndDate: null, status: "active" },
        { id: "cs_ross", recipientId: "rwamsley", commissionPercent: 23, effectiveStartDate: "2026-11-01", effectiveEndDate: null, status: "active" },
        { id: "cs_josh", recipientId: "jstout", commissionPercent: 4, effectiveStartDate: "2026-11-01", effectiveEndDate: null, status: "active" }
      ]
    }
  });
  await bulkHandler(updReq, updRes, { supabase: db });
  assert.strictEqual(updRes.statusCode, 200, JSON.stringify(updRes.payload));
  assert.strictEqual(updRes.payload.success, true);
  assert.strictEqual(db.shares.length, 3, "Must update in-place without creating duplicate share rows");
  assert.strictEqual(db.shares.find(s => s.id === "cs_josh").commission_percent, 4);
  console.log("  PASS [3]: In-place update (Joshua Stout 2% -> 4%) succeeded cleanly with zero overlap errors");

  // 4. Genuine duplicate/overlapping rule without id STILL fails closed with 409 OVERLAPPING_COMMISSION_SHARE
  const { req: dupReq, res: dupRes } = makeReqRes({
    method: "POST",
    cookie: adminCookie,
    body: {
      sourceInvestorId: "jefuller",
      accountId: null,
      shares: [
        { id: null, recipientId: "stoneandco", commissionPercent: 23, effectiveStartDate: "2026-11-02", effectiveEndDate: null, status: "active" },
        { id: "cs_ross", recipientId: "rwamsley", commissionPercent: 23, effectiveStartDate: "2026-11-01", effectiveEndDate: null, status: "active" },
        { id: "cs_josh", recipientId: "jstout", commissionPercent: 4, effectiveStartDate: "2026-11-01", effectiveEndDate: null, status: "active" }
      ]
    }
  });
  await bulkHandler(dupReq, dupRes, { supabase: db });
  assert.strictEqual(dupRes.statusCode, 409);
  assert.strictEqual(dupRes.payload.code, "OVERLAPPING_COMMISSION_SHARE");
  console.log("  PASS [4]: Genuine unlinked overlapping share STILL rejected cleanly with 409 OVERLAPPING_COMMISSION_SHARE");

  console.log("\nCOMMISSION SHARES MANAGE MODAL RESULT: PASS (4/4)");
}

runTests().catch((err) => {
  console.error("COMMISSION SHARES MANAGE MODAL FAILED:", err);
  process.exit(1);
});
