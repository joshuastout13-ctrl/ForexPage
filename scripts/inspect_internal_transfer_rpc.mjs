import https from 'https';
import fs from 'fs';

const tokensPath = 'C:/Users/USER/.gemini/antigravity-ide/mcp_oauth_tokens.json';

function getEntry() {
  const tokens = JSON.parse(fs.readFileSync(tokensPath, 'utf8'));
  const key = Object.keys(tokens).find(k => k.includes('julhldzkiqdeuuoqmvlo'));
  return { tokens, key, entry: tokens[key] };
}

async function refreshToken() {
  const { tokens, key, entry } = getEntry();
  const postData = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: entry.token.refresh_token,
    client_id: entry.client_id,
    client_secret: entry.client_secret
  }).toString();

  return new Promise((resolve, reject) => {
    const req = https.request('https://api.supabase.com/v1/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          const data = JSON.parse(body);
          entry.token.access_token = data.access_token;
          entry.token.refresh_token = data.refresh_token;
          entry.token.expiry = new Date(Date.now() + data.expires_in * 1000).toISOString();
          fs.writeFileSync(tokensPath, JSON.stringify(tokens, null, 2));
          resolve(data.access_token);
        } else {
          reject(new Error(`Failed to refresh token: ${res.statusCode} ${body}`));
        }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

export async function sql(query) {
  let { entry } = getEntry();
  let token = entry.token.access_token;

  const doRequest = (tok) => {
    return new Promise((resolve, reject) => {
      const postData = JSON.stringify({ query });
      const req = https.request('https://api.supabase.com/v1/projects/julhldzkiqdeuuoqmvlo/database/query', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + tok,
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
      req.on('error', reject);
      req.write(postData);
      req.end();
    });
  };

  let res = await doRequest(token);
  if (res.status === 401) {
    console.log('Received 401, refreshing OAuth token...');
    token = await refreshToken();
    res = await doRequest(token);
  }
  return res;
}
