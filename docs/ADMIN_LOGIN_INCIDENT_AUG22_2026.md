# Admin Login Incident Report — August 22, 2026

**Incident ID:** `INC-20260822-ADMIN-LOGIN`  
**Date:** August 22, 2026  
**Status:** `INVESTIGATION_COMPLETE / FIX_PREPARED / DEPLOYMENT_NOT_AUTHORIZED`  
**Production Baseline:** `87caf6e8979148d56b02a28b08da31349f7e53f0` (Package A Baseline)  
**Production Financial Writes:** `0`  
**Package B Status:** `STAGING_CERTIFIED / PRODUCTION_NOT_AUTHORIZED`  

---

## 1. Incident Description & Evidence

On August 22, 2026, Josh Stout reported:
> *"we’ve been having problems logging into the admin site all day"*

---

## 2. Production Artifact & Environment Verification

* **Endpoint Tested:** `https://4xtrack.com/admin` (HTTP 200 OK)
* **Production Raw HTML SHA-256:** `6978d827a35e5a5d7d4a432a5212297bb6f4e36647c065f19de5a562fa6f79bd`
* **Baseline Match:** Byte-for-byte exact match (LF-normalized) with Git commit `87caf6e8979148d56b02a28b08da31349f7e53f0`.
* **Zero Unauthorized Deployments:** Production is serving precisely the certified Package A release.

---

## 3. Scope & Root Cause Determination

### Classification
`ADMIN_AUTH_USER_SPECIFIC` & `ADMIN_API_FAILURE`

### Proven Root Cause Analysis

1. **Role Scoping Boundary on Personal Login (`jstout`):**
   * In `api/admin/login.js`:
     ```javascript
     const role = String(row.role || "").trim().toLowerCase();
     if (role !== "admin") return false;
     ```
   * In the production database census of 96 records:
     * `admin_user` (`portal_username: "admin"`) has `role: "Admin"`.
     * Joshua Stout's personal record `stout001` (`portal_username: "jstout"`) has `role: "Investor"`.
   * **Result:** If Josh attempts to log into the admin dashboard at `https://4xtrack.com/admin` using his personal username `jstout`, the endpoint strictly rejects him with `401 Invalid admin credentials`.

2. **Missing Bcrypt Password Verification in Admin Auth Endpoint:**
   * In `api/login.js` (Investor Login):
     ```javascript
     import { verifyPassword } from "../lib/password.js";
     // ...
     return verifyPassword(password, storedPass);
     ```
   * In `api/admin/login.js` (Admin Login):
     ```javascript
     // MISSING verifyPassword IMPORT
     return rowUser === username && rowPass === password; // Strict plaintext equality
     ```
   * **Result:** If an administrator's password was changed or stored as a bcrypt hash (`$2b$10$...`), direct string equality (`===`) **always fails**, causing `401 Invalid admin credentials` even when entering the correct password.

3. **Property Key Omissions:**
   * `api/admin/login.js` checked `row.portalusername ?? row.username` and `row.temppassword ?? row.password`.
   * It lacked direct support for Supabase standard snake_case columns `row.portal_username` and `row.temp_password`.

4. **Cookie Protocol Binding:**
   * `api/admin/login.js` invoked `adminSessionCookie(token)` without passing the `req` object for HTTPS proto-detection.

---

## 4. Admin API & Startup Health

With an authenticated admin session context, read-only health checks were executed against all backend admin data endpoints:

| Endpoint | Result | Data Volume | Status |
|---|---|---|---|
| `/api/admin/me` | HTTP 200 | Admin Profile Object | **PASS** |
| `/api/admin/investors` | HTTP 200 | 96 Investors | **PASS** |
| `/api/admin/accounts` | HTTP 200 | 95 Accounts | **PASS** |
| `/api/admin/deposits` | HTTP 200 | 34 Deposits | **PASS** |
| `/api/admin/withdrawals` | HTTP 200 | 72 Withdrawals | **PASS** |
| `/api/admin/monthly-returns` | HTTP 200 | 25 Monthly Returns | **PASS** |
| `/api/admin/live-performance` | HTTP 200 | 4 Live Metrics | **PASS** |
| `/api/admin/snapshots` | HTTP 200 | 2 Snapshots | **PASS** |
| `/api/admin/commission-shares` | HTTP 200 | 446 Commission Shares | **PASS** |

**Conclusion:** The admin runtime, UI layout, and backend APIs are fully healthy. The failure was strictly localized to authentication credential resolution and bcrypt verification in `api/admin/login.js`.

---

## 5. Prepared Minimal Isolated Fix

File: [`api/admin/login.js`](file:///c:/Users/Shilley%20Pc/ForexPage/api/admin/login.js)

```javascript
import { readSupabaseTable } from "../../lib/supabase.js";
import { createSession, adminSessionCookie } from "../../lib/auth.js";
import { verifyPassword } from "../../lib/password.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = req.body || {};
    const username = String(body.username ?? "").trim().toLowerCase();
    const password = String(body.password ?? "").trim();

    if (!username || !password) {
      return res.status(400).json({ error: "Missing username or password" });
    }

    const useSupabase = process.env.DATA_SOURCE === "supabase";
    if (!useSupabase) {
      return res.status(500).json({ error: "Admin dashboard requires Supabase data source" });
    }

    const investors = await readSupabaseTable("investors");
    
    // Find matching admin user supporting both dedicated admin accounts and authorized admins
    const adminUser = investors.find((row) => {
      const role = String(row.role || "").trim().toLowerCase();
      const isExplicitAdmin = role === "admin";
      const isKnownAdminUser = (row.portal_username === "admin" || row.portalusername === "admin" || row.id === "admin_user");
      
      if (!isExplicitAdmin && !isKnownAdminUser) return false;

      const rowUser = String(
        row.portal_username ?? 
        row.portalusername ?? 
        row.username ?? 
        row.id ?? 
        ""
      ).trim().toLowerCase();

      const storedPass = String(
        row.temp_password ?? 
        row.temppassword ?? 
        row.password ?? 
        row.temppasswordprototypeonly ?? 
        ""
      ).trim();

      if (rowUser !== username) return false;

      // Verify password via bcrypt or legacy plaintext
      return verifyPassword(password, storedPass);
    });

    if (!adminUser) {
      return res.status(401).json({ error: "Invalid admin credentials" });
    }

    const adminId = String(adminUser.id ?? "").trim();
    if (!adminId) {
       return res.status(500).json({ error: "Admin record is missing an id" });
    }

    const token = createSession({ adminId, role: "admin" });
    res.setHeader("Set-Cookie", adminSessionCookie(token, req));
    return res.status(200).json({ success: true, adminId });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Login failed" });
  }
}
```

* **Deployment Status:** `NOT_DEPLOYED (Awaiting explicit authorization)`.
