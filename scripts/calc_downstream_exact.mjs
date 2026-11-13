import Decimal from 'decimal.js';

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

const accounts = [
  { name: 'Stone and Co Owners Account', id: 'inv_015f3774', username: 'stoneandco', augEnd: 269259.46, augComm: 84879.05, split: 100, septComm: 77484.00, septDeps: 0, septWds: 0 },
  { name: 'Ross Wamsley', id: 'inv_920b8af8', username: 'rwamsley', augEnd: 1367590.65, augComm: 84214.47, split: 100, septComm: 76428.59, septDeps: 0, septWds: 0 },
  { name: 'josh richards', id: 'inv_e1d4f2af', username: 'jrichards', augEnd: 109112.32, augComm: 17530.92, split: 100, septComm: 18747.90, septDeps: 0, septWds: 0 },
  { name: 'Jacob Wamsley', id: 'inv_d0f857c7', username: 'jwamsley', augEnd: 76362.91, augComm: 2449.51, split: 100, septComm: 2519.45, septDeps: 0, septWds: 0 },
  { name: 'David Valdes', id: 'inv_df9fbf05', username: 'valdes', augEnd: 1036532.53, augComm: 2028.76, split: 64.10, septComm: 2086.69, septDeps: 700000, septWds: 0 },
  { name: 'Michael Beck', id: 'inv_d2ab6da4', username: 'mbeck', augEnd: 583359.27, augComm: 1902.72, split: 75.00, septComm: 1929.45, septDeps: 0, septWds: 0 },
  { name: 'ted Boardwalk', id: 'inv_a79798ca', username: 'tboardwalk', augEnd: -2254.97, augComm: 1129.92, split: 66.60, septComm: 1702.78, septDeps: 0, septWds: 0 },
  { name: 'Adam Richards', id: 'inv_d3ec0cf8', username: 'arichards', augEnd: 95284.58, augComm: 944.25, split: 75.00, septComm: 1020.33, septDeps: 0, septWds: 3000 },
  { name: 'Bill and Mary Kimball', id: 'inv_57a1a49a', username: 'bkimball', augEnd: 1724276.43, augComm: 303.36, split: 100, septComm: 312.02, septDeps: 0, septWds: 0 },
  { name: 'Val Taylor', id: 'inv_6a1b838a', username: 'vtaylor', augEnd: 306739.04, augComm: 299.11, split: 50.00, septComm: 307.65, septDeps: 0, septWds: 0 },
  { name: 'Jim Colby', id: 'inv_a7e429ce', username: 'jcolby', augEnd: 246068.20, augComm: 159.65, split: 75.00, septComm: 164.21, septDeps: 0, septWds: 0 },
  { name: 'Nelson Guyer', id: 'inv_141417dc', username: 'nguyer', augEnd: 90598.48, augComm: 64.10, split: 61.30, septComm: 65.93, septDeps: 0, septWds: 15000 }
];

const grossRet = new Decimal('0.0307');

let totAugComm = new Decimal(0);
let totCompGain = new Decimal(0);
let totCorr = new Decimal(0);

console.log('| Account | Name | Username | Aug Commission | Investor Split | Sept Compounded Gain on Comm | Total Correction Impact |');
console.log('|---|---|---|---:|---:|---:|---:|');

accounts.forEach(a => {
  const comm = new Decimal(a.augComm);
  const split = new Decimal(a.split).div(100);
  const gain = comm.mul(grossRet).mul(split);
  const total = comm.add(gain);

  totAugComm = totAugComm.add(comm);
  totCompGain = totCompGain.add(gain);
  totCorr = totCorr.add(total);

  console.log(`| \`${a.id}\` | ${a.name} | \`${a.username}\` | $${comm.toFixed(2)} | ${a.split.toFixed(1)}% | $${gain.toFixed(2)} | $${total.toFixed(2)} |`);
});

console.log('\nTOTALS:');
console.log('Total August Commission:', totAugComm.toFixed(2));
console.log('Total September Compounded Gain:', totCompGain.toFixed(2));
console.log('Total October Settlement Impact:', totCorr.toFixed(2));
