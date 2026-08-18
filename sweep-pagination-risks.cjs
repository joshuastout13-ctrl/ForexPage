/**
 * GLOBAL QUERY-PAGINATION DEFECT SWEEP
 * Identifies all Supabase/PostgREST queries across the entire repository
 * and classifies them for 1,000-row truncation risks.
 */

const fs = require('fs');
const path = require('path');

const TARGET_TABLES = [
  'commission_earnings',
  'investor_monthly_history',
  'deposits',
  'withdrawals',
  'commission_shares',
  'commission_rules',
  'investors',
  'investor_accounts'
];

function getAllFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    if (file === 'node_modules' || file === '.git' || file === 'scratch' || file.startsWith('.')) continue;
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      getAllFiles(filePath, fileList);
    } else if (file.endsWith('.js') || file.endsWith('.cjs') || file.endsWith('.ts') || file.endsWith('.mjs')) {
      fileList.push(filePath);
    }
  }
  return fileList;
}

const allFiles = getAllFiles('.');
console.log(`Scanning ${allFiles.length} script files for Supabase query patterns...`);

const results = [];

for (const filePath of allFiles) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Check if line contains .from("table") or .from('table')
    for (const table of TARGET_TABLES) {
      const regex = new RegExp(`\\.from\\s*\\(\\s*["'\`]${table}["'\`]\\)`, 'i');
      if (regex.test(line)) {
        // Grab surrounding 10 lines to analyze query filters & pagination
        const contextLines = lines.slice(Math.max(0, i - 2), Math.min(lines.length, i + 8)).join('\n');
        
        let classification = 'TRUNCATION_RISK';
        let reason = '';

        const hasRange = /\.range\s*\(/i.test(contextLines);
        const hasPaginationLoop = /while\s*\(|for\s*\(.*page/i.test(contextLines) || /range\s*\(\s*page/i.test(contextLines);
        const hasSpecificFilter = /\.eq\s*\(\s*["'](id|investor_id|recipient_id|source_investor_id|user_id|email|portal_username)["']/i.test(contextLines) ||
                                  /\.in\s*\(\s*["'](id|investor_id|recipient_id)["']/i.test(contextLines);
        const hasSingleOrLimit = /\.single\s*\(\)|\.limit\s*\(\s*[1-9][0-9]{0,2}\s*\)|\.maybeSingle\s*\(\)/i.test(contextLines);
        const hasYearAndMonthFilter = /\.eq\s*\(\s*["']year["']|\.eq\s*\(\s*["']month_number["']/i.test(contextLines);

        if (hasPaginationLoop || hasRange) {
          classification = 'PAGINATED';
          reason = 'Uses explicit .range() or pagination loop';
        } else if (hasSpecificFilter || hasSingleOrLimit) {
          classification = 'SAFE_BOUNDED_QUERY';
          reason = 'Bounded by specific investor/account/single ID or small limit';
        } else if (filePath.includes('readSupabaseTable') || contextLines.includes('readSupabaseTable')) {
          classification = 'TRUNCATION_RISK';
          reason = 'Global readSupabaseTable() helper lacks pagination (caps at 1,000 rows)';
        } else {
          classification = 'TRUNCATION_RISK';
          reason = 'Unbounded .select("*") without pagination on potentially >1000 row table';
        }

        results.push({
          file: filePath,
          line: i + 1,
          table,
          classification,
          snippet: line.trim(),
          reason
        });
      }
    }
  }
}

console.log(`\n=== QUERY PAGINATION DEFECT SWEEP RESULTS ===`);
console.log(`Total queries scanned: ${results.length}`);

const counts = {
  SAFE_BOUNDED_QUERY: 0,
  PAGINATED: 0,
  TRUNCATION_RISK: 0
};

results.forEach(r => { counts[r.classification]++; });
console.log('Classification Summary:', counts);

console.log('\n--- TRUNCATION_RISK Queries ---');
const risks = results.filter(r => r.classification === 'TRUNCATION_RISK');
risks.forEach(r => {
  console.log(`[${r.table}] ${r.file}:${r.line} - ${r.reason}`);
  console.log(`   Snippet: ${r.snippet}`);
});

fs.writeFileSync('./scratch/pagination-sweep-results.json', JSON.stringify({ counts, results }, null, 2));
