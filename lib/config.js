import { extractSheetId } from "./sheets.js";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const rawSheetId = (process.env.GOOGLE_SHEET_ID || process.env.GOOGLE_SHEET_URL || "").trim() || "1uV2CmudSQtmHRaIZTqYDGjWLlmMOcYBCdA1uaL7iMVg";

export const CONFIG = {
  googleSheetId: extractSheetId(rawSheetId),

  // Myfxbook Official API credentials (used for watched-accounts data)
  myfxbookEmail: process.env.MYFXBOOK_EMAIL || "",
  myfxbookPassword: process.env.MYFXBOOK_PASSWORD || "",
  myfxbookAccountId: process.env.MYFXBOOK_ACCOUNT_ID || "11915183", // Stone & Company account

  // Legacy URL kept for reference only
  myfxbookUrl: process.env.MYFXBOOK_URL || "https://myfxbook.com/members/PCSplus/stone-company/11915183",
  zenrowsApiKey: process.env.ZENROWS_API_KEY || "",

  defaultFundYear: Number(process.env.DEFAULT_FUND_YEAR || "2026"),
  sessionSecret: process.env.SESSION_SECRET || "change-this-secret",

  tabs: {
    investors: process.env.GOOGLE_INVESTORS_TAB || "Investors",
    investorAccounts: process.env.GOOGLE_ACCOUNTS_TAB || "Investor_Accounts",
    deposits: process.env.GOOGLE_DEPOSITS_TAB || "Deposits",
    withdrawals: process.env.GOOGLE_WITHDRAWALS_TAB || "Withdrawals",
    monthlyReturns: process.env.GOOGLE_MONTHLY_RETURNS_TAB || "Monthly_Returns",
    livePerformance: process.env.GOOGLE_LIVE_TAB || "Live_Performance"
  }
};
