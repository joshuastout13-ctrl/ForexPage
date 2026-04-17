const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
  
  await page.goto('http://localhost:3000/admin');
  await page.type('#loginUser', 'admin');
  await page.type('#loginPass', 'admin');
  await page.click('#loginBtn');
  
  try {
    await page.waitForSelector('#addInvestorBtn', {visible:true, timeout: 5000});
  } catch (e) {
    console.log("Could not find addInvestorBtn");
    await browser.close();
    process.exit(1);
  }

  console.log('Clicking Add Investor');
  await page.click('#addInvestorBtn');
  
  let isVisible = await page.$eval('#investorModal', el => !el.classList.contains('hidden'));
  console.log('Add Modal Open:', isVisible);
  
  console.log('Clicking Cancel');
  await page.click('#investorModal .closeModalBtn');
  await new Promise(r => setTimeout(r, 500));
  
  console.log('Clicking Edit');
  await page.click('.edit-btn');
  let editVisible = await page.$eval('#investorModal', el => !el.classList.contains('hidden'));
  console.log('Edit Modal Open:', editVisible);
  
  await browser.close();
})().catch(err => {
  console.error('SCRIPT ERROR:', err.message);
  process.exit(1);
});
