import { STATES, duty, fullDuty, getSchemeCap, getDutyNote } from './rates.js';

export const DEFAULTS = {
  state: 'NSW',
  region: 'metro',
  buyerType: 'fhb_scheme', // 'fhb_scheme' | 'fhb_standard' | 'standard'
  allowLmi: false,
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
  strategy: 'max', // 'max' | 'set' | 'loan'
  keepTarget: 30000,
  loanTarget: 800000,
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
    accent: '#1E6A54'
  }
};

export const MONEY_KEYS = [
  'price', 'savings', 'otherCash', 'expenses', 'costs',
  'maxLoan', 'pay', 'rent', 'running', 'keepTarget', 'loanTarget', 'strataQtr'
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
 * Estimates Australian Lenders Mortgage Insurance (LMI) when LVR > 80% outside the 5% scheme.
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

export function calc(P, s, overrides = {}) {
  const stateCode = overrides.state || s.state || 'NSW';
  const region = overrides.region || s.region || 'metro';
  const { buyerType, isFhb, usesScheme } = getBuyerFlags(s);
  const schemeCap = getSchemeCap(stateCode, region);
  const strataQtr = overrides.strataQtr != null ? Number(overrides.strataQtr) : (Number(s.strataQtr) || 0);
  const strataMonthly = Math.max(0, strataQtr) / 3;

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
  const L95 = 0.95 * P;
  const L90 = 0.90 * P;
  const L80 = 0.80 * P;

  const eligibleForSchemeAtPrice = usesScheme && P <= schemeCap;
  const nonSchemeMaxLvr = s.allowLmi ? 0.90 : 0.80;
  const maxLvrLoan = eligibleForSchemeAtPrice ? L95 : nonSchemeMaxLvr * P;

  const denom = 1 - M * f;
  const Lrule = denom > 0 ? (M * E + P + D + C - S - O) / denom : Infinity;

  let L, mode, capped = false, limited = null, target = null;

  if (s.strategy === 'loan') {
    const desiredLoan = Math.max(0, Number(s.loanTarget) || 0);
    L = desiredLoan;
    if (L > maxLvrLoan) {
      L = maxLvrLoan;
      limited = 'min';
    }
    if (L > s.maxLoan) {
      capped = true;
    }
    if (eligibleForSchemeAtPrice && L > L80 + 1 && L > Lrule) {
      L = Math.max(Lrule, L80);
      limited = 'rule';
    }
    mode = eligibleForSchemeAtPrice
      ? (L > L80 + 1 ? 'scheme' : 'twenty')
      : (usesScheme && P > schemeCap ? 'priceCap' : (L > L80 + 1 ? 'lmi' : 'twenty'));
  } else if (s.strategy === 'set') {
    target = s.keepTarget;
    L = P - (S - D - C - target);
    if (L > maxLvrLoan) { L = maxLvrLoan; limited = 'min'; }
    if (L > s.maxLoan) { L = s.maxLoan; capped = true; limited = 'maxloan'; }
    if (eligibleForSchemeAtPrice && L > L80 + 1 && L > Lrule) {
      L = Math.max(Lrule, L80);
      limited = 'rule';
    }
    mode = eligibleForSchemeAtPrice
      ? (L > L80 + 1 ? 'scheme' : 'twenty')
      : (usesScheme && P > schemeCap ? 'priceCap' : (L > L80 + 1 ? 'lmi' : 'twenty'));
  } else {
    // 'max' strategy: keep most cash (put down minimum required deposit)
    if (eligibleForSchemeAtPrice) {
      if (Lrule >= L95) { L = L95; mode = 'min5'; }
      else if (Lrule > L80) { L = Lrule; mode = 'rule'; }
      else { L = L80; mode = 'twenty'; }
    } else {
      L = maxLvrLoan;
      mode = (usesScheme && P > schemeCap) ? 'priceCap' : (L > L80 + 1 ? 'lmi' : 'twenty');
    }
    if (L > s.maxLoan) { L = s.maxLoan; capped = true; }
  }

  L = Math.max(0, L);
  const scheme = eligibleForSchemeAtPrice && L > L80 + 1;
  const lmi = (!scheme && L > L80 + 1) ? estimateLmi(P, L) : 0;

  // If LMI applies in 'set' strategy, adjust L if possible so user still keeps target cash
  const deposit = P - L;
  const kept = S - deposit - D - C - lmi;
  const monthly = pmt(L, s.rate, s.years);
  const fortnightly = monthly / 2;
  const limit = scheme ? M * (E + monthly) : null;
  const houseLimit = scheme ? limit - O : null;
  const totalRunning = s.running + strataMonthly;
  const left = payMo + rentMo - monthly - totalRunning;

  const rf = s.rate / 100 / 26;
  let fnYears = null, saved = null;
  if (L > 0 && fortnightly > rf * L) {
    const n = -Math.log(1 - rf * L / fortnightly) / Math.log(1 + rf);
    fnYears = n / 26;
    saved = monthly * s.years * 12 - fortnightly * n;
  }

  const minPct = eligibleForSchemeAtPrice ? 5 : Math.round((1 - nonSchemeMaxLvr) * 100);
  const minDepAmount = (minPct / 100) * P;
  const extraDep = deposit - minDepAmount;

  const shortfall = -kept;
  let status, verdictTitle, verdictBody;
  if (kept < 0) {
    status = 'bad';
    verdictTitle = `${money(shortfall)} short`;
    const m = payMo > 0 ? Math.ceil(shortfall / payMo) : null;
    verdictBody = m
      ? `At ${money(payMo)}/mo saved, that's about ${m} more month${m > 1 ? 's' : ''} of saving.`
      : 'Lower the price, increase loan, or add savings.';
  } else if (s.strategy === 'loan' && L > s.maxLoan) {
    status = 'warn';
    verdictTitle = `Loan is ${money(L - s.maxLoan)} over pre-approval`;
    verdictBody = `Target loan of ${money(L)} exceeds your broker's ${money(s.maxLoan)} maximum loan limit.`;
  } else if (left < 0) {
    status = 'warn';
    verdictTitle = 'Repayments are over budget';
    verdictBody = `${money(-left)} a month more than your housing budget, freed-up rent/board and running costs cover.`;
  } else if (s.strategy === 'max' && mode === 'rule') {
    status = 'info';
    verdictTitle = 'Works, with a bigger deposit';
    verdictBody = `The hold-back rule caps your total cash at ${money(limit)}${O > 0 ? `, including ${money(O)} other cash` : ''}, so ${money(extraDep)} extra goes into the deposit.`;
  } else if (limited === 'rule') {
    status = 'info';
    verdictTitle = `You can keep up to ${money(kept)}`;
    verdictBody = `The hold-back rule caps your total cash at ${money(limit)} on this loan${O > 0 ? `, including ${money(O)} other cash` : ''}, so the rest goes into the deposit.`;
  } else if (s.strategy === 'loan' && limited === 'min') {
    status = 'info';
    verdictTitle = `Loan capped at ${money(L)} (${100 - minPct}% LVR)`;
    verdictBody = `Minimum ${minPct}% deposit (${money(minDepAmount)}) applies at this price. You keep ${money(kept)}.`;
  } else if (limited === 'min' || limited === 'maxloan') {
    status = 'info';
    verdictTitle = `You can keep ${money(kept)}, not ${money(target)}`;
    verdictBody = limited === 'min'
      ? `The deposit can't go below ${minPct}% (${money(minDepAmount)}), so this is the most cash left at this price.`
      : `Your broker's ${money(s.maxLoan)} loan limit requires a ${money(deposit)} deposit at this price.`;
  } else if (s.strategy === 'loan') {
    status = 'good';
    verdictTitle = `Borrowing ${money(L)} leaves ${money(kept)} cash`;
    verdictBody = `${money(deposit)} (${(deposit / P * 100).toFixed(1)}%) goes into the deposit at this price.`;
  } else if (s.strategy === 'set') {
    status = 'good';
    verdictTitle = `You keep ${money(kept)}`;
    verdictBody = `${money(deposit)} (${(deposit / P * 100).toFixed(1)}%) goes into the deposit.`;
  } else {
    status = 'good';
    verdictTitle = 'This price works';
    verdictBody = !scheme
      ? `You keep ${money(kept)} after a ${(deposit / P * 100).toFixed(0)}% deposit${lmi > 0 ? ` and ${money(lmi)} est. LMI` : ''}.`
      : O > 0
        ? `You keep ${money(kept)}. With ${money(O)} other cash, that's ${money(kept + O)} of your ${money(limit)} hold-back limit.`
        : `You keep ${money(kept)}, under your ${money(limit)} hold-back limit.`;
  }

  const notes = [];
  const stateInfo = STATES[stateCode] || STATES.NSW;
  const regionName = stateInfo.hasRegions
    ? (region === 'regional' ? stateInfo.regionalLabel : stateInfo.metroLabel)
    : stateInfo.name;

  if (scheme && O > 0) {
    notes.push(`The hold-back rule counts your ${money(O)} of other cash too, so you can keep up to ${money(Math.max(0, houseLimit))} from house savings.`);
  }
  if (usesScheme && mode === 'twenty') {
    notes.push('With a 20% deposit you don\'t need the 5% deposit scheme, so there\'s no hold-back limit and no LMI.');
  }
  if (usesScheme && mode === 'priceCap') {
    notes.push(`The 5% deposit scheme caps at ${short(schemeCap)} in ${regionName}, so this assumes a ${minPct}% minimum deposit${lmi > 0 ? ` (plus ~${money(lmi)} LMI)` : ''}.`);
  }
  if (!usesScheme && lmi > 0) {
    notes.push(`At ${(L / P * 100).toFixed(1)}% LVR without a guarantee scheme, estimated LMI is ~${money(lmi)}. Reaching a 20% deposit (${money(0.2 * P)}) avoids LMI.`);
  }
  if (capped && s.strategy !== 'loan') {
    notes.push(`The loan is capped at your broker's maximum of ${money(s.maxLoan)}, so the deposit is larger.`);
  }
  const dutyNote = getDutyNote(P, isFhb, stateCode);
  if (dutyNote) notes.push(dutyNote);
  if (strataMonthly > 0) {
    notes.push(`Includes ${money(strataQtr)}/qtr strata (${money(strataMonthly)}/mo) on top of ${money(s.running)}/mo running costs.`);
  }
  if (kept >= 0 && scheme && s.strategy === 'max') {
    notes.push(`Keep about $20–30k of the ${money(kept)} as an emergency fund. The rest can sit in the offset until you renovate.`);
  }
  if (s.strategy === 'set' && kept >= 0 && extraDep > 1 && !scheme) {
    notes.push('Keeping extra deposit funds above 20% in an offset account saves the same interest while keeping your cash accessible.');
  } else if (s.strategy === 'set' && kept >= 0 && extraDep > 1 && scheme) {
    notes.push('Keeping the extra deposit money in an offset account instead saves nearly the same interest, and you can still use it later.');
  }
  if ((s.strategy === 'set' || s.strategy === 'loan') && kept >= 0 && kept < 15000) {
    notes.push('That leaves very little for emergencies or repairs after you move in.');
  }

  return {
    P, S, D, fullD, C, L, lmi, deposit, kept, monthly, fortnightly,
    limit, left, mode, capped, scheme, schemeCap, fnYears, saved,
    limited, target, O, houseLimit, extraDep, minPct,
    strataQtr, strataMonthly, totalRunning, payMo, rentMo,
    buyerType, isFhb, usesScheme,
    status, verdictTitle, verdictBody, notes, stateCode, region
  };
}

/**
 * Solves for the maximum purchase price (rounded down to nearest $5k) where the buyer
 * is not short on cash (and keeps at least keepTarget in 'set' mode) and stays within maxLoan.
 */
export function solveMaxPrice(s) {
  let best = 100000;
  const minKeep = s.strategy === 'set' ? Math.max(0, s.keepTarget || 0) : 0;
  for (let p = 150000; p <= 5000000; p += 5000) {
    const r = calc(p, s);
    const loanOk = s.strategy === 'loan' ? (r.L <= (s.loanTarget || s.maxLoan) + 1) : (r.L <= s.maxLoan + 1);
    if (r.kept >= minKeep && loanOk) {
      best = p;
    } else if (p > best + 250000) {
      // Stop searching once well past the cliff
      break;
    }
  }
  return best;
}

/**
 * Dynamically calculates sensible slider bounds, 8 quick-select chips, and 9 ladder steps
 * tailored around the buyer's financial capacity & state cap.
 */
export function getDynamicPriceBounds(s) {
  const maxAfford = solveMaxPrice(s);
  const { usesScheme } = getBuyerFlags(s);
  const schemeCap = getSchemeCap(s.state, s.region);

  const refPrice = usesScheme ? Math.min(maxAfford, schemeCap * 1.1) : maxAfford;
  const anchor = Math.max(250000, Math.round(refPrice / 50000) * 50000);
  const step = anchor >= 750000 ? 50000 : 25000;

  const startChip = Math.max(200000, anchor - 5 * step);
  const chips = [];
  for (let i = 0; i < 7; i++) {
    chips.push(startChip + i * step);
  }

  const sliderMin = Math.max(150000, chips[0] - 3 * step);
  const sliderMax = Math.min(5000000, Math.max(maxAfford + 3 * step, chips[chips.length - 1] + 4 * step));

  const ladderPrices = new Set(chips);
  ladderPrices.add(chips[chips.length - 1] + step);
  if (maxAfford >= 150000) ladderPrices.add(maxAfford);
  ladderPrices.add(Math.round(s.price));

  return {
    maxAfford,
    sliderMin,
    sliderMax,
    chips,
    ladder: [...ladderPrices].sort((a, b) => a - b)
  };
}
