import puppeteer from 'puppeteer';

async function runQA() {
  console.log("--- STARTING COMPREHENSIVE UI QA ---");
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));

  // 1. Load Admin
  await page.goto('http://localhost:3000/admin');
  console.log("Navigated to /admin");

  // 2. Login
  await page.type('#loginUser', 'admin');
  await page.type('#loginPass', 'admin');
  await page.click('#loginBtn');
  
  try {
    await page.waitForSelector('.sidebar', {visible:true, timeout: 5000});
    console.log("Login and Sidebar: PASS");
  } catch (e) {
    console.log("Login failure or Sidebar not found: FAIL");
    const content = await page.content();
    console.log("Page Content Snippet:", content.slice(0, 500));
    await browser.close();
    process.exit(1);
  }

  // 3. Navigation Tabs
  const tabs = ['accounts', 'deposits', 'withdrawals', 'returns', 'performance', 'snapshots'];
  for (let i = 0; i < tabs.length; i++) {
    const tab = tabs[i];
    await page.click('[data-tab="' + tab + '"]');
    await new Promise(r => setTimeout(r, 1000));
    const title = await page.$eval('#viewTitle', el => el.textContent);
    console.log('Tab ' + tab + ' loading:', (title.toLowerCase().indexOf(tab) !== -1 || (tab === 'returns' && title.indexOf('Monthly') !== -1)) ? "PASS" : "FAIL (" + title + ")");
  }

  // 4. Investors CRUD: Add New
  console.log("Testing Investor Creation...");
  await page.click('[data-tab="investors"]');
  await new Promise(r => setTimeout(r, 500));
  await page.click('#addEntityBtn');
  await page.waitForSelector('#entityModal', {visible:true});
  
  await page.type('#f_first_name', 'QA');
  await page.type('#f_last_name', 'Test');
  await page.type('#f_email', 'qa@test.com');
  await page.type('#f_portal_username', 'qatest');
  await page.type('#f_split_pct', '70');
  await page.type('#f_start_date', '2023-01-01');
  await page.type('#f_starting_capital', '1000');
  
  await page.click('#saveEntityBtn');
  await new Promise(r => setTimeout(r, 2000));
  
  const content = await page.content();
  console.log("Investor Creation:", content.indexOf('QA Test') !== -1 ? "PASS" : "FAIL");

  // 5. Account Check
  await page.click('[data-tab="accounts"]');
  await new Promise(r => setTimeout(r, 1000));
  const accContent = await page.content();
  console.log("Automatic Account Creation:", accContent.indexOf('qatest') !== -1 ? "PASS" : "FAIL");

  // 6. Logout
  await page.click('#logoutBtn');
  await page.waitForSelector('#loginView', {visible:true});
  console.log("Logout: PASS");

  await browser.close();
}

runQA().catch(err => {
  console.error('QA SCRIPT ERROR:', err.message);
  process.exit(1);
});
