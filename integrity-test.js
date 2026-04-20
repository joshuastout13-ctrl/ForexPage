async function testInvestorLogin() {
  const baseUrl = 'http://localhost:3000';
  
  // We need to fetch the portal username from the previous QA if possible, 
  // but let's just create a fresh one for this specific test
  const portalUsername = 'inv_test_' + Date.now();
  const password = 'password123';
  
  console.log("--- TESTING INVESTOR PORTAL INTEGRITY ---");
  
  // 1. Create investor via Admin API
  const loginRes = await fetch(baseUrl + '/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin' })
  });
  const adminCookie = loginRes.headers.get('set-cookie').split(';')[0];

  const invRes = await fetch(baseUrl + '/api/admin/investors', {
    method: 'POST',
    headers: { 'Cookie': adminCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      firstName: 'Integrity', lastName: 'Test', email: 'integrity@test.com',
      portalUsername: portalUsername, tempPassword: password,
      splitPct: 70, startingCapital: 1000, 
      startDate: '2023-01-01', role: 'Investor'
    })
  });
  if (invRes.status !== 200) throw new Error("Failed to create test investor");
  console.log("Test Investor Created: " + portalUsername);

  // 2. Attempt Login as Investor
  const invLoginRes = await fetch(baseUrl + '/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: portalUsername, password: password })
  });
  
  if (invLoginRes.status === 200) {
    console.log("Investor Login: PASS");
    const invCookie = invLoginRes.headers.get('set-cookie').split(';')[0];
    
    // 3. Test Dashboard Data
    const dashRes = await fetch(baseUrl + '/api/me', {
       headers: { 'Cookie': invCookie }
    });
    const dashData = await dashRes.json();
    if (dashData.investor && dashData.accounts) {
       console.log("Investor Dashboard Data: PASS");
    } else {
       console.log("Investor Dashboard Data: FAIL (" + JSON.stringify(dashData) + ")");
    }
  } else {
    console.log("Investor Login: FAIL (" + invLoginRes.status + ")");
  }
}

testInvestorLogin().catch(console.error);
