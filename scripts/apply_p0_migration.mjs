import fs from 'fs';
import https from 'https';

const token = 'sbp_oauth_e3d5038a503ff69ddf9304a10b9e31a0d4064863';
const migrationPath = 'scripts/migrations/20260920_p0_withdrawal_and_provenance_repair.sql';
const sqlContent = fs.readFileSync(migrationPath, 'utf8');

function sql(query) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ query });
    const req = https.request('https://api.supabase.com/v1/projects/julhldzkiqdeuuoqmvlo/database/query', {
      method: 'POST',
      timeout: 120000,
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch (e) {
          resolve({ status: res.statusCode, text: body });
        }
      });
    });
    req.on('timeout', () => {
      req.destroy(new Error('Request timed out after 120s'));
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function main() {
  console.log('Applying migration to production (julhldzkiqdeuuoqmvlo)...');
  const res = await sql(sqlContent);
  console.log('Migration Result:', JSON.stringify(res, null, 2));

  if (res.status === 200 || res.status === 201) {
    console.log('✅ Migration applied successfully!');
  } else {
    console.error('❌ Migration failed!');
    process.exit(1);
  }
}

main().catch(console.error);
