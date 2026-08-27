import fs from 'fs';
import crypto from 'crypto';

function computeLFHash(filepath) {
  const content = fs.readFileSync(filepath, 'utf8');
  const normalized = content.replace(/\r\n/g, '\n');
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
}

const files = [
  'docs/MARY_JO_TIER4_CORRECTION_SQL.md',
  'docs/GARY_LARSON_TIER3_CORRECTION_SQL.md',
  'docs/JEANNINE_SHAFFAR_TIER3_CORRECTION_SQL.md',
  'docs/PARALLEL_WAVE1_EXECUTION_PACKAGE.md'
];

console.log('=== CANONICAL LF SHA-256 HASHES ===');
for (const f of files) {
  console.log(`${f}: ${computeLFHash(f)}`);
}
