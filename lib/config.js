import { extractSheetId } from "./sheets.js";
const rawSheetId = (process.env.GOOGLE_SHEET_ID || process.env.GOOGLE_SHEET_URL || "").trim() || "1uV2CmudSQtmHRaIZTqYDGjWLlmMOcYBCdA1uaL7iMVg";

export const CONFIG = {
  googleSheetId: extractSheetId(rawSheetId),
  myfxbookUrl: process.env.MYFXBOOK_URL || "https://www.myfxbook.com/members/PCSplus/stone-company/11915183",
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
