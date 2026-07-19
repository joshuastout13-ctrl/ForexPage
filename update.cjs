const fs = require('fs');
let code = fs.readFileSync('lib/dashboard.js', 'utf8');

// Chunk 1
code = code.replace(
`  let historyTable = [];
  let commissionEarningsTable = [];`,
`  let historyTable = [];
  let commissionEarningsTable = [];
  let commissionRulesTable = [];`
);

// Chunk 2
code = code.replace(
`    ({ rawInvestors, accounts, returnsSheet, depositsSheet, withdrawalsSheet, historyTable, commissionEarningsTable, live } = preloadedData);
    if (useSupabase) {
      if (rawInvestors) rawInvestors = rawInvestors.map(normalizeRow);
      if (accounts) accounts = accounts.map(normalizeRow);
      if (returnsSheet) returnsSheet = returnsSheet.map(normalizeRow);
      if (depositsSheet) depositsSheet = depositsSheet.map(normalizeRow);
      if (withdrawalsSheet) withdrawalsSheet = withdrawalsSheet.map(normalizeRow);
      if (historyTable) historyTable = historyTable.map(normalizeRow);
      if (commissionEarningsTable) commissionEarningsTable = commissionEarningsTable.map(normalizeRow);
    }`,
`    ({ rawInvestors, accounts, returnsSheet, depositsSheet, withdrawalsSheet, historyTable, commissionEarningsTable, commissionRulesTable, live } = preloadedData);
    if (useSupabase) {
      if (rawInvestors) rawInvestors = rawInvestors.map(normalizeRow);
      if (accounts) accounts = accounts.map(normalizeRow);
      if (returnsSheet) returnsSheet = returnsSheet.map(normalizeRow);
      if (depositsSheet) depositsSheet = depositsSheet.map(normalizeRow);
      if (withdrawalsSheet) withdrawalsSheet = withdrawalsSheet.map(normalizeRow);
      if (historyTable) historyTable = historyTable.map(normalizeRow);
      if (commissionEarningsTable) commissionEarningsTable = commissionEarningsTable.map(normalizeRow);
      if (commissionRulesTable) commissionRulesTable = commissionRulesTable.map(normalizeRow);
    }`
);

// Chunk 3
code = code.replace(
`    [rawInvestors, accounts, returnsSheet, depositsSheet, withdrawalsSheet, historyTable, commissionEarningsTable, live] = await Promise.all([
      readSupabaseTable("investors"),
      readSupabaseTable("investor_accounts"),
      readSupabaseTable("monthly_returns"),
      readSupabaseTable("deposits"),
      readSupabaseTable("withdrawals"),
      readSupabaseTable("investor_monthly_history"),
      readSupabaseTable("commission_earnings"),
      getMyfxbookLive()
    ]);`,
`    [rawInvestors, accounts, returnsSheet, depositsSheet, withdrawalsSheet, historyTable, commissionEarningsTable, commissionRulesTable, live] = await Promise.all([
      readSupabaseTable("investors"),
      readSupabaseTable("investor_accounts"),
      readSupabaseTable("monthly_returns"),
      readSupabaseTable("deposits"),
      readSupabaseTable("withdrawals"),
      readSupabaseTable("investor_monthly_history"),
      readSupabaseTable("commission_earnings"),
      readSupabaseTable("commission_rules"),
      getMyfxbookLive()
    ]);`
);

// Chunk 4
code = code.replace(
`    historyTable = [];
    commissionEarningsTable = [];
  }`,
`    historyTable = [];
    commissionEarningsTable = [];
    commissionRulesTable = [];
  }`
);

// Chunk 5
const chunk5Search = `  if (commissionEarningsTable && commissionEarningsTable.length > 0) {
    const myEarnings = commissionEarningsTable.filter(r => String(r.recipient_id).toLowerCase() === internalId.toLowerCase());
    myEarnings.forEach(e => {
      const eYear = num(e.year);
      const eMonth = num(e.month_number);
      if (eYear === targetYear) {
        commissionsEarnedYear += num(e.amount);
        if (eMonth === currentMonthIdx) {
          commissionsEarnedMonth += num(e.amount);
        }
      }
    });
  }`;

const chunk5Replace = `  if (commissionEarningsTable && commissionEarningsTable.length > 0) {
    const myEarnings = commissionEarningsTable.filter(r => String(r.recipient_id).toLowerCase() === internalId.toLowerCase());
    myEarnings.forEach(e => {
      const eYear = num(e.year);
      const eMonth = num(e.month_number);
      if (eYear === targetYear) {
        commissionsEarnedYear += num(e.amount);
        if (eMonth === currentMonthIdx) {
          commissionsEarnedMonth += num(e.amount);
        }
      }
    });
  }

  // 8.5. Detailed Commission Breakdown
  const commissionBreakdown = [];
  if (commissionEarningsTable && commissionEarningsTable.length > 0) {
    const myEarnings = commissionEarningsTable.filter(r => String(r.recipient_id).toLowerCase() === internalId.toLowerCase() && num(r.year) === targetYear);
    
    // Group by source_investor_id
    const grouped = {};
    myEarnings.forEach(e => {
      const sourceId = e.source_investor_id;
      if (!grouped[sourceId]) {
        // Find investor details
        const sourceInvestor = rawInvestors.find(i => String(i.id).toLowerCase() === String(sourceId).toLowerCase()) || {};
        const firstName = String(sourceInvestor.first_name || sourceInvestor.firstname || "").trim();
        const lastName = String(sourceInvestor.last_name || sourceInvestor.lastname || "").trim();
        const name = \`\${firstName} \${lastName}\`.trim() || sourceId;
        
        // Find commission rule (percent)
        let percent = 0;
        if (commissionRulesTable && commissionRulesTable.length > 0) {
           const rule = commissionRulesTable.find(r => 
             String(r.recipient_id).toLowerCase() === internalId.toLowerCase() && 
             (String(r.investor_id).toLowerCase() === String(sourceId).toLowerCase() || !r.investor_id) // Add !r.investor_id for default rules if applicable
           );
           if (rule) percent = num(rule.percent);
        }
        
        grouped[sourceId] = {
          sourceName: name,
          percent: percent,
          monthAmount: 0,
          yearAmount: 0
        };
      }
      
      const amt = num(e.amount);
      grouped[sourceId].yearAmount += amt;
      if (num(e.month_number) === currentMonthIdx) {
        grouped[sourceId].monthAmount += amt;
      }
    });
    
    for (const sourceId in grouped) {
      commissionBreakdown.push(grouped[sourceId]);
    }
    // Sort by yearAmount descending
    commissionBreakdown.sort((a, b) => b.yearAmount - a.yearAmount);
  }`;
code = code.replace(chunk5Search, chunk5Replace);

// Chunk 6
const chunk6Search = `    investor: {
      id: internalId,
      name: (investor.first_name || investor.firstname || "") + " " + (investor.last_name || investor.lastname || ""),
      startDate: investor.start_date || investor.startdate || "",
      splitPct: investor.split_pct || investor.splitpct || 100,
      hasCommissionAccount: investorAccounts.some(a => a.is_commission || String(a.is_commission).toLowerCase() === "true")
    },
    live: live,
    liveDollarGains,
    summary: {
      startingCapital,
      currentBalance: summaryBalance,
      totalGain,
      totalCashIn: effectiveCashIn,
      totalWithdrawals,
      totalPerformancePct,
      totalPerformanceDollar,
      commissionsEarnedYear,
      commissionsEarnedMonth
    },
    breakdown,
    monthlyHistory`;
const chunk6Replace = `    investor: {
      id: internalId,
      name: (investor.first_name || investor.firstname || "") + " " + (investor.last_name || investor.lastname || ""),
      startDate: investor.start_date || investor.startdate || "",
      splitPct: investor.split_pct || investor.splitpct || 100,
      hasCommissionAccount: investorAccounts.some(a => a.is_commission || String(a.is_commission).toLowerCase() === "true")
    },
    live: live,
    liveDollarGains,
    summary: {
      startingCapital,
      currentBalance: summaryBalance,
      totalGain,
      totalCashIn: effectiveCashIn,
      totalWithdrawals,
      totalPerformancePct,
      totalPerformanceDollar,
      commissionsEarnedYear,
      commissionsEarnedMonth
    },
    commissionBreakdown,
    breakdown,
    monthlyHistory`;
code = code.replace(chunk6Search, chunk6Replace);

fs.writeFileSync('lib/dashboard.js', code);
