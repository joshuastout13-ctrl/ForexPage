async function runQA() {
  console.log("--- FINAL QA INTEGRATION TEST ---");
  const baseUrl = 'http://localhost:3000';
  let cookie = '';

  // 1. Login
  const loginRes = await fetch(baseUrl + '/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin' })
  });
  if (loginRes.status !== 200) throw new Error("Login Failed: " + loginRes.status);
  cookie = loginRes.headers.get('set-cookie').split(';')[0];
  console.log("1. Admin Login: PASS");

  const authHeaders = { 'Cookie': cookie, 'Content-Type': 'application/json' };

  // 2. Create Investor
  const invPayload = {
    firstName: 'QA', lastName: 'User', email: 'qa@test.com',
    portalUsername: 'qauser_' + Date.now(),
    tempPassword: 'password123',
    splitPct: 70, startingCapital: 1000,
    startDate: '2023-01-01', role: 'Investor'
  };
  const invRes = await fetch(baseUrl + '/api/admin/investors', {
    method: 'POST', headers: authHeaders, body: JSON.stringify(invPayload)
  });
  const invData = await invRes.json();
  if (invRes.status !== 200) throw new Error("Investor Creation Failed: " + JSON.stringify(invData));
  const investorId = invData.investor.id;
  console.log("2. Investor Creation: PASS (ID: " + investorId + ")");

  // 3. Accounts Check
  const accsRes = await fetch(baseUrl + '/api/admin/accounts', { headers: authHeaders });
  const accsData = await accsRes.json();
  const newAcc = accsData.accounts.find(a => a.investor_id === investorId);
  if (!newAcc) throw new Error("Linked Account not automatically created");
  const accountId = newAcc.id;
  console.log("3. Automatic Account Creation: PASS (ID: " + accountId + ")");

  // 4. Create Deposit
  const depPayload = { investorId, accountId, amount: 500, date: '2023-01-05', type: 'Deposit' };
  const depRes = await fetch(baseUrl + '/api/admin/deposits', {
    method: 'POST', headers: authHeaders, body: JSON.stringify(depPayload)
  });
  if (depRes.status !== 200) throw new Error("Deposit Creation Failed");
  console.log("4. Deposit Creation: PASS");

  // 5. Create Withdrawal
  const wdPayload = { investorId, accountId, amount: 100, requestDate: '2023-01-10', year: 2023, monthNumber: 1, month: 'January', status: 'Pending' };
  const wdRes = await fetch(baseUrl + '/api/admin/withdrawals', {
    method: 'POST', headers: authHeaders, body: JSON.stringify(wdPayload)
  });
  if (wdRes.status !== 200) throw new Error("Withdrawal Creation Failed");
  console.log("5. Withdrawal Creation: PASS");

  // 6. Update Live Performance
  const perfPayload = { metric: 'Total Gain', valuePct: 15.5, source: 'Manual QA', isOverride: true };
  const perfRes = await fetch(baseUrl + '/api/admin/live-performance', {
    method: 'PATCH', headers: authHeaders, body: JSON.stringify(perfPayload)
  });
  if (perfRes.status !== 200) throw new Error("Live Performance Update Failed");
  console.log("6. Live Performance Update: PASS");

  // 7. Verify Snapshots Read-Only
  const snapRes = await fetch(baseUrl + '/api/admin/snapshots', {
    method: 'POST', headers: authHeaders, body: JSON.stringify({})
  });
  if (snapRes.status !== 405) throw new Error("Snapshots POST not blocked: " + snapRes.status);
  console.log("7. Snapshots Read-Only: PASS");

  console.log("--- ALL INTEGRATION TESTS PASSED ---");
}

runQA().catch(err => {
  console.error("QA FAILED:", err.message);
  process.exit(1);
});
