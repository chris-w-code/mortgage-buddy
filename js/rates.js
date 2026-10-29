// Australian State & Territory Stamp Duty + First Home Guarantee (5% Scheme) Rules

export const STATES = {
  NSW: {
    code: 'NSW',
    name: 'New South Wales',
    authority: 'Revenue NSW',
    hasRegions: true,
    metroLabel: 'Sydney, Newcastle, Lake Macquarie & Illawarra',
    regionalLabel: 'Rest of NSW',
    schemeCaps: { metro: 1500000, regional: 800000 },
    fhbNote: 'Full stamp duty exemption up to $800k, phasing out between $800k and $1M.',
    defaultPrice: 1000000
  },
  VIC: {
    code: 'VIC',
    name: 'Victoria',
    authority: 'SRO Victoria',
    hasRegions: true,
    metroLabel: 'Melbourne & Geelong',
    regionalLabel: 'Rest of VIC',
    schemeCaps: { metro: 950000, regional: 650000 },
    fhbNote: 'Full stamp duty exemption up to $600k, phasing out between $600k and $750k.',
    defaultPrice: 750000
  },
  QLD: {
    code: 'QLD',
    name: 'Queensland',
    authority: 'Queensland Revenue Office',
    hasRegions: true,
    metroLabel: 'Brisbane, Gold Coast & Sunshine Coast',
    regionalLabel: 'Rest of QLD',
    schemeCaps: { metro: 1000000, regional: 700000 },
    fhbNote: 'Owner-occupier home rate applied. First home concession: $0 duty up to $700k, phasing out to $800k.',
    defaultPrice: 780000
  },
  WA: {
    code: 'WA',
    name: 'Western Australia',
    authority: 'RevenueWA',
    hasRegions: true,
    metroLabel: 'Perth',
    regionalLabel: 'Rest of WA',
    schemeCaps: { metro: 850000, regional: 600000 },
    fhbNote: 'Full FHB exemption up to $450k, concessional rate phasing out up to $600k.',
    defaultPrice: 650000
  },
  SA: {
    code: 'SA',
    name: 'South Australia',
    authority: 'RevenueSA',
    hasRegions: true,
    metroLabel: 'Adelaide',
    regionalLabel: 'Rest of SA',
    schemeCaps: { metro: 900000, regional: 500000 },
    fhbNote: 'SA FHB stamp duty relief applies to eligible new homes; established homes pay standard rates.',
    defaultPrice: 700000
  },
  TAS: {
    code: 'TAS',
    name: 'Tasmania',
    authority: 'SRO Tasmania',
    hasRegions: true,
    metroLabel: 'Hobart & Launceston',
    regionalLabel: 'Rest of TAS',
    schemeCaps: { metro: 700000, regional: 550000 },
    fhbNote: 'Full FHB duty exemption for established homes up to $750k.',
    defaultPrice: 600000
  },
  ACT: {
    code: 'ACT',
    name: 'Australian Capital Territory',
    authority: 'ACT Revenue Office',
    hasRegions: false,
    metroLabel: 'ACT',
    regionalLabel: 'ACT',
    schemeCaps: { metro: 1000000, regional: 1000000 },
    fhbNote: 'Eligible HBCS buyers pay $0 duty up to $1M, with concessional phase-out above $1M.',
    defaultPrice: 800000
  },
  NT: {
    code: 'NT',
    name: 'Northern Territory',
    authority: 'Territory Revenue Office',
    hasRegions: false,
    metroLabel: 'Northern Territory',
    regionalLabel: 'Northern Territory',
    schemeCaps: { metro: 600000, regional: 600000 },
    fhbNote: 'Standard NT conveyance duty rates shown.',
    defaultPrice: 550000
  }
};

function calcBracketDuty(v, brackets) {
  let b = brackets[0];
  for (const x of brackets) {
    if (v > x[0]) b = x;
  }
  return b[1] + Math.ceil((v - b[0]) / 100) * b[2];
}

// NSW 2026 brackets
const NSW_BRACKETS = [
  [0, 0, 1.25],
  [17000, 212, 1.5],
  [37000, 512, 1.75],
  [99000, 1597, 3.5],
  [372000, 11152, 4.5],
  [1240000, 50212, 5.5],
  [3721000, 186667, 7]
];

// VIC PPR / General brackets
function vicFullDuty(v) {
  if (v <= 25000) return v * 0.014;
  if (v <= 130000) return 350 + (v - 25000) * 0.024;
  if (v <= 440000) return 2870 + (v - 130000) * 0.05;
  if (v <= 550000) return 18370 + (v - 440000) * 0.06;
  if (v <= 960000) return 2870 + (v - 130000) * 0.06;
  if (v <= 2000000) return v * 0.055;
  return 110000 + (v - 2000000) * 0.065;
}

// QLD Owner-Occupier Home Concession rate
function qldHomeDuty(v) {
  if (v <= 350000) return Math.ceil(v / 100) * 1.0;
  if (v <= 540000) return 3500 + Math.ceil((v - 350000) / 100) * 3.5;
  if (v <= 1000000) return 10150 + Math.ceil((v - 540000) / 100) * 4.5;
  return 30850 + Math.ceil((v - 1000000) / 100) * 5.75;
}

// WA Residential rates
const WA_BRACKETS = [
  [0, 0, 1.9],
  [120000, 2280, 2.85],
  [150000, 3135, 3.8],
  [360000, 11115, 4.75],
  [725000, 28453, 5.15]
];

// SA Residential rates
const SA_BRACKETS = [
  [0, 0, 1.0],
  [12000, 120, 2.0],
  [30000, 480, 3.0],
  [50000, 1080, 3.5],
  [100000, 2830, 4.0],
  [200000, 6830, 4.25],
  [250000, 8955, 4.75],
  [300000, 11330, 5.0],
  [500000, 21330, 5.5]
];

// TAS Residential rates
const TAS_BRACKETS = [
  [0, 50, 0],
  [3000, 50, 1.75],
  [25000, 435, 2.25],
  [75000, 1560, 3.5],
  [200000, 5935, 4.0],
  [375000, 12935, 4.25],
  [725000, 27810, 4.5]
];

// ACT Owner-Occupier rates
function actFullDuty(v) {
  if (v <= 260000) return (v / 100) * 0.49;
  if (v <= 300000) return 1274 + ((v - 260000) / 100) * 2.2;
  if (v <= 500000) return 2154 + ((v - 300000) / 100) * 3.4;
  if (v <= 750000) return 8954 + ((v - 500000) / 100) * 4.32;
  if (v <= 1000000) return 19754 + ((v - 750000) / 100) * 5.9;
  if (v <= 1455000) return 34504 + ((v - 1000000) / 100) * 6.4;
  return v * 0.0454;
}

// NT Duty rates
function ntFullDuty(v) {
  if (v <= 525000) {
    const k = v / 1000;
    return (0.06571441 * k * k) + 15 * k;
  }
  if (v <= 3000000) return v * 0.0495;
  if (v <= 5000000) return v * 0.0575;
  return v * 0.0595;
}

export function getSchemeCap(stateCode = 'NSW', region = 'metro') {
  const st = STATES[stateCode] || STATES.NSW;
  return st.schemeCaps[region === 'regional' ? 'regional' : 'metro'] || 1500000;
}

export function fullDuty(price, stateCode = 'NSW') {
  const v = Math.max(0, Number(price) || 0);
  switch (stateCode) {
    case 'NSW':
      return calcBracketDuty(v, NSW_BRACKETS);
    case 'VIC':
      return Math.round(vicFullDuty(v));
    case 'QLD':
      return Math.round(qldHomeDuty(v));
    case 'WA':
      return calcBracketDuty(v, WA_BRACKETS);
    case 'SA':
      return calcBracketDuty(v, SA_BRACKETS);
    case 'TAS':
      return calcBracketDuty(v, TAS_BRACKETS);
    case 'ACT':
      return Math.round(actFullDuty(v));
    case 'NT':
      return Math.round(ntFullDuty(v));
    default:
      return calcBracketDuty(v, NSW_BRACKETS);
  }
}

export function duty(price, fhb = true, stateCode = 'NSW') {
  const v = Math.max(0, Number(price) || 0);
  const full = fullDuty(v, stateCode);
  if (!fhb) return full;

  switch (stateCode) {
    case 'NSW':
      if (v >= 1000000) return full;
      if (v <= 800000) return 0;
      return full * (v - 800000) / 200000;
    case 'VIC':
      if (v >= 750000) return full;
      if (v <= 600000) return 0;
      return Math.round(full * (v - 600000) / 150000);
    case 'QLD':
      if (v >= 800000) return full;
      if (v <= 700000) return 0;
      // QLD first home concession phases out linearly between $700k and $800k
      return Math.max(0, Math.round(full * (v - 700000) / 100000));
    case 'WA':
      if (v >= 600000) return full;
      if (v <= 450000) return 0;
      return Math.round((v - 450000) * 0.1919);
    case 'TAS':
      if (v <= 750000) return 0;
      return full;
    case 'ACT':
      if (v <= 1000000) return 0;
      if (v >= 1455000) return full;
      return Math.min(full, Math.round(((v - 1000000) / 100) * 6.4));
    case 'SA':
    case 'NT':
    default:
      return full;
  }
}

export function getDutyNote(price, fhb, stateCode = 'NSW') {
  if (!fhb) return null;
  const full = fullDuty(price, stateCode);
  const actual = duty(price, true, stateCode);
  const saved = full - actual;
  if (saved <= 0) return null;
  if (actual === 0) {
    return `No stamp duty at this price under ${stateCode} first home buyer rules (saves $${Math.round(full).toLocaleString('en-AU')}).`;
  }
  return `The ${stateCode} first home buyer concession saves about $${Math.round(saved).toLocaleString('en-AU')} in stamp duty here.`;
}
