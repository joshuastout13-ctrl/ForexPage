import { readSheet, truthy } from "../lib/sheets.js";
import { createSession, sessionCookie } from "../lib/auth.js";
import { CONFIG } from "../lib/config.js";

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(data));
      } catch {
        resolve({});
      }
    });
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");

  if (req.method !== "POST") {
    res.statusCode = 405;
    return res.end(JSON.stringify({ error: "Method not allowed" }));
  }

  const body = await readBody(req);
  const email = String(body.email ?? "").trim().toLowerCase();
  const pin = String(body.pin ?? body.password ?? "").trim();

  if (!email || !pin) {
    res.statusCode = 400;
    return res.end(JSON.stringify({ error: "Email and PIN are required" }));
  }

  let investors;
  try {
    investors = await readSheet(CONFIG.tabs.investors);
  } catch {
    res.statusCode = 502;
    return res.end(JSON.stringify({ error: "Could not load investor data" }));
  }

  const investor = investors.find(
    (r) => String(r.Email ?? r.email ?? "").trim().toLowerCase() === email
  );

  // Use the same error for both "not found" and "wrong pin" to prevent enumeration
  const credentialsError = () => {
    res.statusCode = 401;
    return res.end(JSON.stringify({ error: "Invalid email or PIN" }));
  };

  if (!investor) return credentialsError();

  if (!truthy(investor.Active ?? investor.active ?? "true")) {
    res.statusCode = 403;
    return res.end(JSON.stringify({ error: "Account is inactive" }));
  }

  const storedPin = String(
    investor.PIN ?? investor.pin ?? investor.Password ?? investor.password ?? ""
  ).trim();

  if (!storedPin || storedPin !== pin) return credentialsError();

  const investorId = String(
    investor.InvestorID ?? investor.investorid ?? investor.ID ?? investor.id ?? ""
  ).trim();

  if (!investorId) {
    res.statusCode = 500;
    return res.end(JSON.stringify({ error: "Investor record missing ID" }));
  }

  const token = createSession({ investorId, email });
  res.setHeader("Set-Cookie", sessionCookie(token));
  res.end(JSON.stringify({ ok: true }));
}
