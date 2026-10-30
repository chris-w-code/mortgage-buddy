import { STATES, duty, fullDuty, getSchemeCap, getDutyNote } from './rates.js';

export const DEFAULTS = {
  state: 'NSW',
  region: 'metro',
  buyerType: 'fhb_scheme', // 'fhb_scheme' | 'fhb_standard' | 'standard'
  allowLmi: false,
  showBudget: false, // Off by default to keep UI simple
  price: 1000000,
  savings: 120000,
  otherCash: 0,
  months: 0,
  rate: 6.5,
  years: 30,
  expenses: 5000,
  holdMonths: 6,
  costs: 5000,
  maxLoan: 1200000,
  pay: 6000,
  payFreq: 'mo', // 'mo' | 'fn'
  rent: 1500,
  rentFreq: 'mo', // 'mo' | 'fn'
  running: 1000,
  strataQtr: 0,
  fhb: true,
  strategy: 'max', // 'max' | 'set' | 'loan' | 'deposit'
  keepTarget: 30000,
  loanTarget: 800000,
  depositTarget: 100000,
  ladderMax: 0, // 0 = auto (uses maxAfford ceiling)
  ladderStep: 0, // 0 = auto proportional step
  shortlist: [],
  broker: {
    enabled: false,
    clientName: '',
    brokerName: '',
    company: '',
    acl: '',
    phone: '',
    email: '',
    bookingUrl: '',
    accent: '#463F3A',
    minDepPct: 5 // Default 5% minimum deposit (95% LVR); broker can set down to 2% (98% LVR)
  }
};

export const MONEY_KEYS = [
  'price', 'savings', 'otherCash', 'expenses', 'costs',
  'maxLoan', 'pay', 'rent', 'running', 'keepTarget', 'loanTarget', 'depositTarget', 'strataQtr'
];

export const PLAIN_KEYS = ['months', 'rate', 'years', 'holdMonths'];

export const money = n =>
  (n < 0 ? '−' : '') + '$' + Math.round(Math.abs(n)).toLocaleString('en-AU');

export const short = n => {
  const a = Math.abs(n), sign = n < 0 ? '−' : '';
  if (a >= 1e6) return sign + '$' + (Math.round(a / 1e4) / 100).toString().replace(/\.?0+$/, '') + 'M';
  return sign + '$' + Math.round(a / 1000) + 'k';
};

export const parseNum = v => {
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  return isFinite(n) ? n : 0;
};

export function toMonthly(amount, freq = 'mo') {
  const v = Number(amount) || 0;
  return freq === 'fn' ? (v * 26) / 12 : v;
}

export function convertFreqAmount(amount, fromFreq, toFreq) {
  if (fromFreq === toFreq) return Math.round(Number(amount) || 0);
  const v = Number(amount) || 0;
  if (fromFreq === 'mo' && toFreq === 'fn') return Math.round((v * 12) / 26);
  if (fromFreq === 'fn' && toFreq === 'mo') return Math.round((v * 26) / 12);
  return Math.round(v);
}

export function pmt(L, rate, years) {
  const r = rate / 100 / 12;
  const n = Math.max(1, years) * 12;
  if (r === 0) return L / n;
  return L * r / (1 - Math.pow(1 + r, -n));
}

/**
 * Estimates Australian Lenders Mortgage Insurance (LMI) when LVR > 80% and allowLmi is enabled.
 */
export function estimateLmi(P, L) {
  if (P <= 0 || L <= 0) return 0;
  const lvr = L / P;
  if (lvr <= 0.8001) return 0;

  const highLoan = L > 1000000 ? 1.25 : L > 750000 ? 1.15 : L > 500000 ? 1.08 : 1.0;
  let baseRate = 0;
  if (lvr <= 0.82) baseRate = 0.0075;
  else if (lvr <= 0.85) baseRate = 0.0125;
  else if (lvr <= 0.88) baseRate = 0.0195;
  else if (lvr <= 0.90) baseRate = 0.0255;
  else if (lvr <= 0.92) baseRate = 0.034;
  else baseRate = 0.041;

  return Math.round(L * baseRate * highLoan);
}

export function getBuyerFlags(s) {
  const bt = s.buyerType || (s.fhb === false ? 'standard' : 'fhb_scheme');
  const isFhb = bt === 'fhb_scheme' || bt === 'fhb_standard';
  const usesScheme = bt === 'fhb_scheme';
  return { buyerType: bt, isFhb, usesScheme };
}

export function getMinDepositPct(s) {
  const brokerPct = s.broker && isFinite(Number(s.broker.minDepPct)) && Number(s.broker.minDepPct) > 0
    ? Number(s.broker.minDepPct)
    : 5;
  return Math.max(2, Math.min(50, brokerPct));
}

export function calc(P, s, overrides = {}) {
  const stateCode = overrides.state || s.state || 'NSW';
  const region = overrides.region || s.region || 'metro';
  const { buyerType, isFhb, usesScheme } = getBuyerFlags(s);
  const schemeCap = getSchemeCap(stateCode, region);
  const strataQtr = overrides.strataQtr != null ? Number(overrides.strataQtr) : (Number(s.strataQtr) || 0);
  const strataMonthly = Math.max(0, strataQtr) / 3;
  const strataFortnightly = (Math.max(0, strataQtr) * 4) / 26;

  const payMo = toMonthly(s.pay, s.payFreq || 'mo');
  const rentMo = toMonthly(s.rent, s.rentFreq || 'mo');

  const S = s.savings + s.months * payMo;
  const O = usesScheme ? Math.max(0, s.otherCash || 0) : 0;
  const D = duty(P, isFhb, stateCode);
  const fullD = fullDuty(P, stateCode);
  const C = s.costs;
  const E = s.expenses;
  const M = s.holdMonths;
  const f = pmt(1, s.rate, s.years);

  // Default minimum deposit is 5% (95% LVR), unless broker configured a custom minDepPct (down to 2% / 98% LVR)
  const minPct = getMinDepositPct(s);
  const maxLvr = 1 - minPct / 100;
  const maxLvrLoan = maxLvr * P;
  const L80 = 0.80 * P;

  const eligibleForSchemeAtPrice = usesScheme && P <= schemeCap;
  const denom = 1 - M * f;
  const Lrule = denom > 0 ? (M * E + P + D + C - S - O) / denom : Infinity;

  // Determine the maximum allowable loan at this price (which gives minimum required deposit & max keepable cash)
  let maxLoanAtPrice;
  let limitedByHoldback = false;
  if (eligibleForSchemeAtPrice) {
    if (Lrule >= maxLvrLoan) {
      maxLoanAtPrice = maxLvrLoan;
    } else if (Lrule > L80) {
      maxLoanAtPrice = Lrule;
      limitedByHoldback = true;
    } else {
      maxLoanAtPrice = L80;
      limitedByHoldback = true;
    }
  } else {
    maxLoanAtPrice = maxLvrLoan;
  }

  const cappedByMaxLoan = maxLoanAtPrice > s.maxLoan;
  maxLoanAtPrice = Math.max(0, Math.min(maxLoanAtPrice, s.maxLoan));

  const minDepAtPrice = Math.max(0, P - maxLoanAtPrice);
  const schemeAtMaxLoan = eligibleForSchemeAtPrice && maxLoanAtPrice > L80 + 1;
  const lmiAtMaxLoan = (!schemeAtMaxLoan && s.allowLmi && maxLoanAtPrice > L80 + 1)
    ? estimateLmi(P, maxLoanAtPrice)
    : 0;

  // Raw cash left when putting down the minimum allowable deposit at this price
  const rawMaxKeep = S - minDepAtPrice - D - C - lmiAtMaxLoan;
  const maxKeepAtPrice = Math.max(0, rawMaxKeep);

  // Maximum deposit the user can put in from savings (leaving $0 cash kept)
  const maxDepFromSavings = Math.min(P, Math.max(minDepAtPrice, S - D - C));
  const minLoanAtPrice = Math.max(0, P - maxDepFromSavings);

  let L;
  let mode = eligibleForSchemeAtPrice ? 'scheme' : 'standard';

  if (rawMaxKeep < 0) {
    // Price exceeds what savings can cover at minimum deposit (used by solveMaxPrice ceiling check)
    L = maxLoanAtPrice;
  } else if (s.strategy === 'loan') {
    const desiredLoan = Math.max(0, Number(s.loanTarget) || 0);
    L = Math.max(minLoanAtPrice, Math.min(maxLoanAtPrice, desiredLoan));
  } else if (s.strategy === 'deposit') {
    const desiredDep = Math.max(minDepAtPrice, Math.min(maxDepFromSavings, Number(s.depositTarget) || 0));
    L = P - desiredDep;
  } else if (s.strategy === 'set') {
    const desiredKeep = Math.max(0, Math.min(maxKeepAtPrice, Number(s.keepTarget) || 0));
    const desiredDep = Math.max(minDepAtPrice, Math.min(maxDepFromSavings, S - D - C - desiredKeep));
    L = P - desiredDep;
  } else {
    // 'max' strategy: keep maximum allowable cash (minimum deposit)
    L = maxLoanAtPrice;
  }

  L = Math.max(0, L);
  const scheme = eligibleForSchemeAtPrice && L > L80 + 1;
  const lmi = (!scheme && s.allowLmi && L > L80 + 1) ? estimateLmi(P, L) : 0;

  const deposit = P - L;
  const kept = S - deposit - D - C - lmi;
  const monthly = pmt(L, s.rate, s.years);
  const fortnightly = monthly / 2;
  const limit = scheme ? M * (E + monthly) : null;
  const houseLimit = scheme ? Math.max(0, limit - O) : null;
  const totalRunning = s.running + strataMonthly;
  const left = payMo + rentMo - monthly - totalRunning;

  const rf = s.rate / 100 / 26;
  let fnYears = null, saved = null;
  if (L > 0 && fortnightly > rf * L) {
    const n = -Math.log(1 - rf * L / fortnightly) / Math.log(1 + rf);
    fnYears = n / 26;
    saved = monthly * s.years * 12 - fortnightly * n;
  }

  const minDepAmount = (minPct / 100) * P;
  const extraDep = Math.max(0, deposit - minDepAmount);

  const status = kept < 0 ? 'bad' : (s.showBudget && left < 0) ? 'warn' : 'good';

  // Factual calculation notes only (no financial advice)
  const notes = [];
  const stateInfo = STATES[stateCode] || STATES.NSW;
  const regionName = stateInfo.hasRegions
    ? (region === 'regional' ? stateInfo.regionalLabel : stateInfo.metroLabel)
    : stateInfo.name;

  if (scheme && limitedByHoldback) {
    notes.push(`5% scheme hold-back rule caps max cash kept at ${money(houseLimit)}${O > 0 ? ` (after counting ${money(O)} other cash)` : ''}, with ${money(extraDep)} extra going to the deposit.`);
  } else if (usesScheme && L <= L80 + 1 && P <= schemeCap) {
    notes.push('At 20%+ deposit (80% LVR or lower), the 5% scheme and hold-back cap do not apply.');
  } else if (usesScheme && P > schemeCap) {
    notes.push(`Above the ${short(schemeCap)} 5% scheme cap in ${regionName}; hold-back rule does not apply.`);
  }
  if (!scheme && lmi > 0) {
    notes.push(`Includes ~${money(lmi)} estimated LMI at ${(L / P * 100).toFixed(1)}% LVR.`);
  }
  if (cappedByMaxLoan) {
    notes.push(`Loan is capped at your ${money(s.maxLoan)} pre-approved maximum.`);
  }
  const dutyNote = getDutyNote(P, isFhb, stateCode);
  if (dutyNote) notes.push(dutyNote);
  if (strataMonthly > 0) {
    notes.push(`Includes ${money(strataQtr)}/qtr strata (${money(strataMonthly)}/mo).`);
  }

  return {
    P, S, D, fullD, C, L, lmi, deposit, kept, monthly, fortnightly,
    limit, left, mode, capped: cappedByMaxLoan, scheme, schemeCap, fnYears, saved,
    O, houseLimit, extraDep, minPct,
    minDepAtPrice, maxDepFromSavings, minLoanAtPrice, maxLoanAtPrice, maxKeepAtPrice,
    strataQtr, strataMonthly, strataFortnightly, totalRunning, payMo, rentMo,
    buyerType, isFhb, usesScheme,
    status, notes, stateCode, region
  };
}

/**
 * Solves for the maximum purchase price (rounded down to nearest $5k) where the buyer
 * has enough savings for the minimum required deposit + stamp duty + costs and stays within maxLoan.
 */
export function solveMaxPrice(s) {
  let best = 100000;
  const ceilingState = Object.assign({}, s, { strategy: 'max' });
  for (let p = 150000; p <= 10000000; p += 5000) {
    const r = calc(p, ceilingState);
    if (r.kept >= 0 && r.L <= s.maxLoan + 1) {
      best = p;
    } else if (p > best + 250000) {
      break;
    }
  }
  return best;
}

/**
 * Picks a proportional, human-friendly price increment for an 8-row comparison table
 * so the 7 steps span ~38%–45% of the top price (e.g. $25k at $700k, $50k at $1M,
 * $75k at $1.4M, $150k at $2.5M, $250k at $5M).
 */
export function getAutoLadderStep(topPrice) {
  const p = Math.max(250000, Number(topPrice) || 1000000);
  if (p <= 800000) return 25000;
  if (p <= 1200000) return 50000;
  if (p <= 1650000) return 75000;
  if (p <= 2200000) return 100000;
  if (p <= 3000000) return 150000;
  if (p <= 3800000) return 200000;
  if (p <= 6000000) return 250000;
  return 500000;
}

/**
 * Dynamically calculates sensible slider bounds (strictly capped at maxAfford),
 * quick-select chips, and an 8-row price ladder.
 */
export function getDynamicPriceBounds(s) {
  const maxAfford = solveMaxPrice(s);
  const topPrice = (s.ladderMax && s.ladderMax >= 200000)
    ? Math.round(s.ladderMax)
    : maxAfford;
  const autoStep = getAutoLadderStep(topPrice);
  const step = (s.ladderStep && s.ladderStep >= 10000) ? Math.round(s.ladderStep) : autoStep;

  // Build 8 clean rows ending at topPrice, snapping lower rows to clean multiples of `step`
  const rows = [];
  const snappedTop = Math.floor(topPrice / step) * step;
  const isExactMultiple = (topPrice - snappedTop) < 5000;

  if (isExactMultiple) {
    for (let i = 7; i >= 0; i--) {
      rows.push(Math.max(100000, snappedTop - i * step));
    }
  } else {
    for (let i = 6; i >= 0; i--) {
      rows.push(Math.max(100000, snappedTop - i * step));
    }
    rows.push(topPrice);
  }

  const uniqueRows = [...new Set(rows)].sort((a, b) => a - b);
  while (uniqueRows.length < 8 && uniqueRows[0] > 100000) {
    uniqueRows.unshift(Math.max(100000, uniqueRows[0] - step));
  }
  const ladder = uniqueRows.slice(-8);

  // Slider is strictly bounded by what is possible: [sliderMin, maxAfford]
  const sliderMin = Math.max(100000, Math.min(ladder[0] - step, maxAfford - 7 * step));
  const sliderMax = Math.max(sliderMin, maxAfford);

  return {
    maxAfford,
    topPrice,
    autoStep,
    step,
    sliderMin,
    sliderMax,
    chips: ladder,
    ladder
  };
}
