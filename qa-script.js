async function run() {
  console.log("--- RUNNING QA TESTS ---");
  let cookieHeader = '';

  // 1. Auth Protection
  const res1 = await fetch('http://localhost:3000/api/admin/investors');
  console.log("Test 1 - Unauthorized Access:", res1.status === 401 ? "PASS" : "FAIL");

  // 2. Login
  const res2 = await fetch('http://localhost:3000/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin' })
  });
  
  if (res2.status !== 200) {
    console.log("Test 2 - Login: FAIL " + res2.status);
    return;
  }
  const cookies = res2.headers.get('set-cookie');
  if (cookies) {
     cookieHeader = cookies.split(';')[0];
  }
  console.log("Test 2 - Login & Session creation:", cookieHeader ? "PASS" : "FAIL");

  const authOps = { headers: { 'Cookie': cookieHeader } };

  // 3. Me endpoint
  const res3 = await fetch('http://localhost:3000/api/admin/me', authOps);
  const meData = await res3.json();
  console.log("Test 3 - Session verification API:", meData.admin ? "PASS" : "FAIL");

  // 4. Test GET routes
  const routes = [
    { name: 'Investors', url: '/api/admin/investors' },
    { name: 'Accounts', url: '/api/admin/accounts' },
    { name: 'Deposits', url: '/api/admin/deposits' },
    { name: 'Withdrawals', url: '/api/admin/withdrawals' },
    { name: 'Monthly Returns', url: '/api/admin/monthly-returns' },
    { name: 'Live Performance', url: '/api/admin/live-performance' },
    { name: 'Snapshots', url: '/api/admin/snapshots' },
  ];

  for (const r of routes) {
    const res = await fetch('http://localhost:3000' + r.url, authOps);
    console.log('Test GET ' + r.name + ':', res.status === 200 ? "PASS" : "FAIL " + res.status);
  }

  // 5. Test Live Performance Read-Only check on Snapshots
  const resSnap = await fetch('http://localhost:3000/api/admin/snapshots', {
     method: 'POST', 
     headers: { 'Content-Type': 'application/json', 'Cookie': cookieHeader },
     body: JSON.stringify({})
  });
  console.log("Test 5 - Snapshots POST method block:", resSnap.status === 405 ? "PASS" : "FAIL " + resSnap.status);

  // 6. Test Logout
  const resLog = await fetch('http://localhost:3000/api/admin/logout', { 
    method: 'POST',
    headers: { 'Cookie': cookieHeader }
  });
  console.log("Test 6 - Logout clears session:", resLog.status === 200 ? "PASS" : "FAIL");

  const resCheck = await fetch('http://localhost:3000/api/admin/me', { headers: { 'Cookie': '' } });
  console.log("Test 7 - Verified cleared session:", resCheck.status === 401 ? "PASS" : "FAIL");
}

run().catch(console.error);
