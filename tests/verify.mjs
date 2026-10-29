import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STATES, duty, fullDuty, getSchemeCap } from '../js/rates.js';
import {
  DEFAULTS, MONEY_KEYS, PLAIN_KEYS, calc, getDynamicPriceBounds,
  estimateLmi, toMonthly, convertFreqAmount, solveMaxPrice
} from '../js/calc.js';
import { encodeSharePayload, decodeSharePayload } from '../js/share.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(__dirname, '../js/app.js'), 'utf8');

// 0. Verify all DOM IDs referenced in app.js and MONEY_KEYS / PLAIN_KEYS exist in index.html
const idMatches = [...appJs.matchAll(/\$\('([^']+)'\)/g)].map(m => m[1]);
const requiredIds = new Set([...idMatches, ...MONEY_KEYS, ...PLAIN_KEYS]);
for (const id of requiredIds) {
  assert.ok(html.includes(`id="${id}"`), `index.html should contain id="${id}"`);
}

// 1. Verify all 8 Australian states & territories exist and calculate valid stamp duty
for (const code of ['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT']) {
  assert.ok(STATES[code], `State ${code} should be defined`);
  const dFull = fullDuty(850000, code);
  assert.ok(dFull > 0, `Full duty at $850k for ${code} should be > 0 (got ${dFull})`);
  const capMetro = getSchemeCap(code, 'metro');
  const capReg = getSchemeCap(code, 'regional');
  assert.ok(capMetro >= capReg, `Metro cap (${capMetro}) >= Regional cap (${capReg}) for ${code}`);
}

// 2. Verify 3 Buyer Profiles: 'fhb_scheme' vs 'fhb_standard' vs 'standard'
const p900 = 900000;
const rScheme = calc(p900, { ...structuredClone(DEFAULTS), buyerType: 'fhb_scheme', savings: 120000 });
const rFhbStd = calc(p900, { ...structuredClone(DEFAULTS), buyerType: 'fhb_standard', savings: 220000 });
const rStd = calc(p900, { ...structuredClone(DEFAULTS), buyerType: 'standard', savings: 220000 });

assert.equal(rScheme.scheme, true, 'fhb_scheme at $900k uses 5% scheme');
assert.equal(rFhbStd.scheme, false, 'fhb_standard does not use 5% scheme');
assert.ok(rFhbStd.D < rStd.D, 'fhb_standard gets FHB stamp duty concession at $900k in NSW whereas standard pays full duty');
assert.equal(rStd.D, fullDuty(p900, 'NSW'), 'standard buyer pays full stamp duty');
assert.equal(rStd.L, 0.80 * p900, 'standard buyer with allowLmi=false defaults to 80% LVR (20% deposit)');

// 3. Verify non-scheme LMI when allowLmi=true
const rStdLmi = calc(p900, { ...structuredClone(DEFAULTS), buyerType: 'standard', allowLmi: true, savings: 150000 });
assert.equal(rStdLmi.L, 0.90 * p900, 'standard buyer with allowLmi=true can borrow 90% LVR');
assert.ok(rStdLmi.lmi > 0, `90% LVR without scheme should estimate LMI > 0 (got ${rStdLmi.lmi})`);
assert.equal(estimateLmi(1000000, 800000), 0, '80% LVR has $0 LMI');

// 4. Verify Target Loan strategy ('loan') & Max Price solver
const loanState = { ...structuredClone(DEFAULTS), buyerType: 'standard', savings: 250000, strategy: 'loan', loanTarget: 700000 };
const rLoan = calc(900000, loanState);
assert.equal(rLoan.L, 700000, 'Target loan strategy locks loan at $700k when within LVR cap');
assert.equal(rLoan.deposit, 200000, 'Deposit is Price ($900k) - Target Loan ($700k) = $200k');
const maxP = solveMaxPrice(loanState);
assert.ok(maxP >= 900000 && maxP <= 950000, `Max price with $700k loan + $250k savings should be ~$905k (got ${maxP})`);

// 5. Verify Fortnightly / Monthly frequency conversion for pay & rent
assert.equal(Math.round(toMonthly(1000, 'fn')), Math.round(1000 * 26 / 12), '1000/fn converts to 2167/mo');
const fnVal = convertFreqAmount(2167, 'mo', 'fn');
assert.equal(fnVal, 1000, '2167/mo converts to 1000/fn');

const rMoRent = calc(1000000, { ...structuredClone(DEFAULTS), rent: 2167, rentFreq: 'mo' });
const rFnRent = calc(1000000, { ...structuredClone(DEFAULTS), rent: 1000, rentFreq: 'fn' });
assert.ok(Math.abs(rMoRent.left - rFnRent.left) <= 1, 'Monthly leftover should match whether rent is entered as $1000/fn or $2167/mo');

// 6. Verify URL share encoding & decoding round-trip with new fields
const customState = {
  ...structuredClone(DEFAULTS),
  state: 'VIC',
  region: 'metro',
  buyerType: 'standard',
  allowLmi: true,
  price: 850000,
  savings: 160000,
  strategy: 'loan',
  loanTarget: 680000,
  pay: 2500,
  payFreq: 'fn',
  rent: 800,
  rentFreq: 'fn'
};
const token = encodeSharePayload(customState, { includeShortlist: true, clientMode: true });
const decoded = decodeSharePayload(token);
assert.equal(decoded.buyerType, 'standard');
assert.equal(decoded.allowLmi, true);
assert.equal(decoded.strategy, 'loan');
assert.equal(decoded.loanTarget, 680000);
assert.equal(decoded.payFreq, 'fn');
assert.equal(decoded.rentFreq, 'fn');

console.log('All verification assertions passed!');
