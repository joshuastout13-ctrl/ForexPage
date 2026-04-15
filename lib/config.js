export const CONFIG = {
  googleSheetId: process.env.GOOGLE_SHEET_ID || "1uV2CmudSQtmHRaIZTqYDGjWLlmMOcYBCdA1uaL7iMVg",
  defaultFundYear: Number(process.env.DEFAULT_FUND_YEAR || "2026"),
  sessionSecret: process.env.SESSION_SECRET || "change-this-secret",

  tabs: {
    investors: process.env.GOOGLE_INVESTORS_TAB || "Investors",
    deposits: process.env.GOOGLE_DEPOSITS_TAB || "Deposits",
    withdrawals: process.env.GOOGLE_WITHDRAWALS_TAB || "Withdrawals",
    monthlyReturns: process.env.GOOGLE_MONTHLY_RETURNS_TAB || "Monthly_Returns"
  }
};
