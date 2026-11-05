import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STATES, duty, fullDuty, getSchemeCap } from '../js/rates.js';
import {
  DEFAULTS, MONEY_KEYS, PLAIN_KEYS, calc, getDynamicPriceBounds, getAutoLadderStep,
  estimateLmi, toMonthly, convertFreqAmount, solveMaxPrice
} from '../js/calc.js';
import { encodeSharePayload, decodeSharePayload } from '../js/share.js';
import {
  loadBrokerProfile, saveBrokerProfile, hasBrokerIdentity, isBrokerOnboarded,
  buildClientHandOffEmail, buildEmailComposeLinks
} from '../js/broker.js';

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

// 2. Verify 2 Buyer Profiles (First Home 5% Scheme vs Standard), 5% default minimum deposit, Hold-back cap, and Broker 98% LVR
const p900 = 900000;
const rScheme = calc(p900, { ...structuredClone(DEFAULTS), buyerType: 'fhb_scheme', savings: 180000 });
const rStd = calc(p900, { ...structuredClone(DEFAULTS), buyerType: 'standard', savings: 180000 });

assert.equal(rScheme.scheme, true, 'fhb_scheme at $900k uses 5% scheme');
assert.equal(rStd.scheme, false, 'standard does not use 5% scheme');
assert.ok(rScheme.D < rStd.D, 'fhb_scheme gets FHB stamp duty concession at $900k in NSW whereas standard pays full duty');
assert.equal(rStd.D, fullDuty(p900, 'NSW'), 'standard buyer pays full stamp duty');
assert.equal(rStd.L, 0.95 * p900, 'Default minimum deposit is 5% (95% LVR)');
assert.ok(rScheme.maxKeepAtPrice < rStd.maxKeepAtPrice, 'fhb_scheme caps maxKeepAtPrice via hold-back rule whereas standard does not');

// Verify Cash You Keep can be set all the way down to $0
const rZeroKeep = calc(p900, { ...structuredClone(DEFAULTS), buyerType: 'fhb_scheme', savings: 120000, strategy: 'set', keepTarget: 0 });
assert.equal(Math.round(rZeroKeep.kept), 0, 'User can lower Cash You Keep all the way down to $0');

// Verify Broker-configured high LVR (98% LVR / 2% deposit)
const rHighLvr = calc(p900, {
  ...structuredClone(DEFAULTS),
  buyerType: 'standard',
  savings: 100000,
  broker: { ...structuredClone(DEFAULTS.broker), minDepPct: 2 }
});
assert.equal(rHighLvr.L, 0.98 * p900, 'Broker setting minDepPct=2 enables 98% LVR (2% deposit)');

// 3. Verify non-scheme LMI when allowLmi=true
const rStdLmi = calc(p900, { ...structuredClone(DEFAULTS), buyerType: 'standard', allowLmi: true, savings: 150000 });
assert.ok(rStdLmi.lmi > 0, `High LVR with allowLmi=true should estimate LMI > 0 (got ${rStdLmi.lmi})`);
assert.equal(estimateLmi(1000000, 800000), 0, '80% LVR has $0 LMI');

// 4. Verify Unified 2nd Slider strategies ('max', 'set', 'deposit', 'loan') & Max Price solver
const baseState = { ...structuredClone(DEFAULTS), buyerType: 'standard', savings: 260000, maxLoan: 800000 };
const rDep = calc(900000, { ...baseState, strategy: 'deposit', depositTarget: 200000 });
assert.equal(rDep.deposit, 200000, 'Target deposit strategy locks deposit at $200k');
assert.equal(rDep.L, 700000, 'Loan is $900k - $200k = $700k');

const rLoan = calc(900000, { ...baseState, strategy: 'loan', loanTarget: 700000 });
assert.equal(rLoan.L, 700000, 'Target loan strategy locks loan at $700k');
assert.equal(rLoan.deposit, 200000, 'Deposit is Price ($900k) - Target Loan ($700k) = $200k');
assert.equal(rDep.kept, rLoan.kept, 'Cash kept is identical whether $200k deposit or $700k loan is targeted at $900k price');

const rKeep = calc(900000, { ...baseState, strategy: 'set', keepTarget: rDep.kept });
assert.equal(Math.round(rKeep.deposit), 200000, 'Targeting exact cash kept yields the same $200k deposit');
assert.equal(Math.round(rKeep.L), 700000, 'Targeting exact cash kept yields the same $700k loan');

// Verify solveMaxPrice stays anchored to ceiling even when user is testing a custom deposit or loan
const maxFromMax = solveMaxPrice({ ...baseState, strategy: 'max' });
const maxFromDep = solveMaxPrice({ ...baseState, strategy: 'deposit', depositTarget: 250000 });
assert.equal(maxFromMax, maxFromDep, 'solveMaxPrice returns consistent ceiling regardless of current 2nd slider position');

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
  showBudget: true,
  price: 850000,
  savings: 160000,
  strategy: 'deposit',
  depositTarget: 170000,
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
assert.equal(decoded.showBudget, true);
assert.equal(decoded.strategy, 'deposit');
assert.equal(decoded.depositTarget, 170000);
assert.equal(decoded.loanTarget, 680000);
assert.equal(decoded.payFreq, 'fn');
assert.equal(decoded.rentFreq, 'fn');

// 7. Verify 8-row proportional Compare Prices ladder & custom overrides
assert.equal(getAutoLadderStep(700000), 25000, '$700k top price uses $25k auto step');
assert.equal(getAutoLadderStep(1000000), 50000, '$1M top price uses $50k auto step');
assert.equal(getAutoLadderStep(1400000), 75000, '$1.4M top price uses $75k auto step');
assert.equal(getAutoLadderStep(5000000), 250000, '$5M top price uses $250k auto step');

const b1400 = getDynamicPriceBounds({ ...structuredClone(DEFAULTS), ladderMax: 1400000, ladderStep: 100000 });
assert.equal(b1400.ladder.length, 8, 'Compare Prices always generates 8 rows');
assert.deepEqual(
  b1400.ladder,
  [700000, 800000, 900000, 1000000, 1100000, 1200000, 1300000, 1400000],
  'At $1.4M with $100k step, generates clean $700k -> $1.4M rows'
);

const b5m = getDynamicPriceBounds({ ...structuredClone(DEFAULTS), ladderMax: 5000000, ladderStep: 0 });
assert.equal(b5m.ladder.length, 8, '$5M auto ladder has 8 rows');
assert.equal(b5m.ladder[0], 3250000, '$5M auto ladder starts at $3.25M');
assert.equal(b5m.ladder[7], 5000000, '$5M auto ladder ends at $5.0M');

// 8. Verify Broker Onboarding (Skippable Step 1, Persistent Profile, Desktop Email Hand-Off)
assert.ok(!html.includes('value="fhb_standard"'), 'index.html should only have fhb_scheme and standard buyerType options');

const mockStore = {
  _data: {},
  getItem(k) { return this._data[k] || null; },
  setItem(k, v) { this._data[k] = String(v); }
};

// Verify skippable broker profile
const initialProfile = loadBrokerProfile(mockStore);
assert.equal(isBrokerOnboarded(initialProfile), false, 'Fresh broker profile is not yet onboarded');
saveBrokerProfile({ skipped: true }, mockStore);
const skippedProfile = loadBrokerProfile(mockStore);
assert.equal(skippedProfile.skipped, true, 'Skipped state persists in storage');
assert.equal(hasBrokerIdentity(skippedProfile), false, 'Skipped profile has no identity fields');
assert.equal(isBrokerOnboarded(skippedProfile), true, 'Skipped profile counts as onboarded so future sessions open Step 2');

// Verify filled broker profile
saveBrokerProfile({
  brokerName: 'Alex Mercer',
  company: 'Harbour Mortgage Advisory',
  email: 'alex@harbour.com.au',
  phone: '0400 123 456',
  skipped: false
}, mockStore);
const filledProfile = loadBrokerProfile(mockStore);
assert.equal(hasBrokerIdentity(filledProfile), true, 'Filled profile has broker identity');
assert.equal(isBrokerOnboarded(filledProfile), true, 'Filled profile is onboarded');

// Verify desktop email composer output & compose links
const emailState = {
  ...structuredClone(DEFAULTS),
  state: 'NSW',
  buyerType: 'fhb_scheme',
  savings: 140000,
  maxLoan: 1100000,
  rate: 6.25,
  years: 30,
  broker: {
    ...structuredClone(DEFAULTS.broker),
    ...filledProfile,
    clientName: 'Sarah & Tom',
    clientEmail: 'sarah.tom@example.com',
    minDepPct: 5
  }
};
const emailBounds = getDynamicPriceBounds(emailState);
const testShareUrl = 'https://chris-w-code.github.io/mortgage-buddy/#s=testtoken';
const emailTpl = buildClientHandOffEmail(emailState, emailBounds.maxAfford, testShareUrl);

assert.equal(emailTpl.to, 'sarah.tom@example.com');
assert.ok(emailTpl.subject.includes('Sarah & Tom'), 'Email subject includes client name');
assert.ok(emailTpl.body.includes('Hi Sarah & Tom,'), 'Email body greets client by name');
assert.ok(emailTpl.body.includes(testShareUrl), 'Email body contains the client share URL');
assert.ok(emailTpl.body.includes('Alex Mercer'), 'Email body signs off with broker name when provided');

const composeLinks = buildEmailComposeLinks(emailTpl);
assert.ok(composeLinks.mailtoHref.startsWith('mailto:sarah.tom%40example.com?subject='), 'Generates valid mailto link');
assert.ok(composeLinks.gmailHref.startsWith('https://mail.google.com/mail/?view=cm&fs=1&to=sarah.tom%40example.com'), 'Generates valid Gmail compose link');
assert.ok(composeLinks.outlookHref.startsWith('https://outlook.office.com/mail/deeplink/compose?to=sarah.tom%40example.com'), 'Generates valid Outlook Web compose link');

console.log('All verification assertions passed!');
