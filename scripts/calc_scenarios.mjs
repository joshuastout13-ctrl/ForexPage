import Decimal from 'decimal.js';
Decimal.set({ precision: 30, rounding: Decimal.ROUND_HALF_UP });

const settled1 = new Decimal('3383453.52'); // As reported in prompt context
const settled2 = new Decimal('3333453.52'); // Live settled balance currently in DB

const extA = new Decimal('1606090.00'); // Certified baseline
const extB = new Decimal('1608590.00'); // Reported value with uncorrected transfer

console.log('--- REFERENCE SETTLED BALANCE ($3,383,453.52) ---');
const perfDollarA1 = settled1.minus(extA);
const perfPctA1 = perfDollarA1.dividedBy(extA).times(100);
console.log('Scenario A ($1,606,090.00):');
console.log('  Total Performance Dollars:', perfDollarA1.toFixed(2));
console.log('  Total Performance Pct:    ', perfPctA1.toFixed(8) + '%');

const perfDollarB1 = settled1.minus(extB);
const perfPctB1 = perfDollarB1.dividedBy(extB).times(100);
console.log('Scenario B ($1,608,590.00):');
console.log('  Total Performance Dollars:', perfDollarB1.toFixed(2));
console.log('  Total Performance Pct:    ', perfPctB1.toFixed(8) + '%');

console.log('\n--- LIVE DATABASE SETTLED BALANCE ($3,333,453.52) ---');
const perfDollarA2 = settled2.minus(extA);
const perfPctA2 = perfDollarA2.dividedBy(extA).times(100);
console.log('Scenario A ($1,606,090.00):');
console.log('  Total Performance Dollars:', perfDollarA2.toFixed(2));
console.log('  Total Performance Pct:    ', perfPctA2.toFixed(8) + '%');

const perfDollarB2 = settled2.minus(extB);
const perfPctB2 = perfDollarB2.dividedBy(extB).times(100);
console.log('Scenario B ($1,608,590.00):');
console.log('  Total Performance Dollars:', perfDollarB2.toFixed(2));
console.log('  Total Performance Pct:    ', perfPctB2.toFixed(8) + '%');
