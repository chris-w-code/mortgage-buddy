import { DEFAULTS, MONEY_KEYS, PLAIN_KEYS, money, getBuyerFlags } from './calc.js';
import { STATES } from './rates.js';

// Compact key mapping to keep shareable URLs short for SMS / WhatsApp / Email
const KEY_MAP = {
  state: 'st',
  region: 'rg',
  buyerType: 'bt',
  allowLmi: 'al',
  price: 'p',
  savings: 's',
  otherCash: 'o',
  months: 'm',
  rate: 'r',
  years: 'y',
  expenses: 'e',
  holdMonths: 'hm',
  costs: 'c',
  maxLoan: 'ml',
  pay: 'py',
  payFreq: 'pf',
  rent: 'rn',
  rentFreq: 'rf',
  running: 'ru',
  strataQtr: 'sq',
  fhb: 'f',
  strategy: 'sg',
  keepTarget: 'kt',
  loanTarget: 'lt'
};

const REV_MAP = Object.fromEntries(Object.entries(KEY_MAP).map(([k, v]) => [v, k]));

function toBase64Url(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  bytes.forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(b64) {
  const padded = b64.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export function encodeSharePayload(s, options = { includeShortlist: true, clientMode: false }) {
  const payload = {};
  for (const [fullKey, shortKey] of Object.entries(KEY_MAP)) {
    if (s[fullKey] !== DEFAULTS[fullKey]) {
      payload[shortKey] = s[fullKey];
    }
  }
  if (options.includeShortlist && Array.isArray(s.shortlist) && s.shortlist.length > 0) {
    payload.sl = s.shortlist.map(item => [
      item.id,
      item.name,
      item.price,
      item.strataQtr || 0,
      item.notes || ''
    ]);
  }
  if (s.broker && (s.broker.enabled || options.clientMode || s.broker.brokerName || s.broker.company)) {
    payload.br = {
      en: 1,
      cn: s.broker.clientName || '',
      bn: s.broker.brokerName || '',
      co: s.broker.company || '',
      ac: s.broker.acl || '',
      ph: s.broker.phone || '',
      em: s.broker.email || '',
      bu: s.broker.bookingUrl || '',
      cl: s.broker.accent || '#1E6A54'
    };
  }
  if (options.clientMode) {
    payload.vw = 'client';
  }
  return toBase64Url(JSON.stringify(payload));
}

export function decodeSharePayload(encoded) {
  if (!encoded) return null;
  try {
    const raw = JSON.parse(fromBase64Url(encoded));
    if (!raw || typeof raw !== 'object') return null;
    const out = {};
    for (const [shortKey, val] of Object.entries(raw)) {
      const fullKey = REV_MAP[shortKey];
      if (!fullKey) continue;
      if (MONEY_KEYS.includes(fullKey) || PLAIN_KEYS.includes(fullKey)) {
        const n = Number(val);
        if (isFinite(n)) out[fullKey] = n;
      } else if (fullKey === 'fhb' || fullKey === 'allowLmi') {
        out[fullKey] = Boolean(val);
      } else if (fullKey === 'buyerType' && ['fhb_scheme', 'fhb_standard', 'standard'].includes(val)) {
        out.buyerType = val;
      } else if ((fullKey === 'payFreq' || fullKey === 'rentFreq') && (val === 'mo' || val === 'fn')) {
        out[fullKey] = val;
      } else if (fullKey === 'strategy' && ['max', 'set', 'loan'].includes(val)) {
        out.strategy = val;
      } else if (fullKey === 'state' && STATES[val]) {
        out.state = val;
      } else if (fullKey === 'region' && (val === 'metro' || val === 'regional')) {
        out.region = val;
      }
    }
    if (!out.buyerType && typeof out.fhb === 'boolean') {
      out.buyerType = out.fhb ? 'fhb_scheme' : 'standard';
    }
    if (Array.isArray(raw.sl)) {
      out.shortlist = raw.sl.slice(0, 20).map(arr => ({
        id: String(arr[0] || Date.now()),
        name: String(arr[1] || 'Property'),
        price: Math.max(100000, Number(arr[2]) || 800000),
        strataQtr: Math.max(0, Number(arr[3]) || 0),
        notes: String(arr[4] || '')
      }));
    }
    if (raw.br && typeof raw.br === 'object') {
      out.broker = {
        enabled: Boolean(raw.br.en),
        clientName: String(raw.br.cn || ''),
        brokerName: String(raw.br.bn || ''),
        company: String(raw.br.co || ''),
        acl: String(raw.br.ac || ''),
        phone: String(raw.br.ph || ''),
        email: String(raw.br.em || ''),
        bookingUrl: String(raw.br.bu || ''),
        accent: /^#[0-9a-fA-F]{6}$/.test(String(raw.br.cl || '')) ? raw.br.cl : '#1E6A54'
      };
    }
    out._viewMode = raw.vw === 'client' ? 'client' : 'default';
    return out;
  } catch (e) {
    return null;
  }
}

export function buildShareUrl(s, options = { includeShortlist: true, clientMode: false }) {
  const token = encodeSharePayload(s, options);
  const url = new URL(window.location.href);
  url.hash = 's=' + token;
  return url.toString();
}

export function buildBrokerInquiryMailto(s, r, propertyName = '') {
  const brokerEmail = (s.broker && s.broker.email) ? s.broker.email : '';
  const propLabel = propertyName ? `${propertyName} (${money(r.P)})` : `a property at ${money(r.P)}`;
  const subject = `Property check: ${propLabel}${s.broker?.clientName ? ` — ${s.broker.clientName}` : ''}`;
  const lvr = (r.L / r.P * 100).toFixed(1);
  const { isFhb, usesScheme } = getBuyerFlags(s);
  const profileLabel = usesScheme ? 'FHB (5% Scheme)' : isFhb ? 'FHB (Standard)' : 'Next Home / Standard';
  const bodyLines = [
    `Hi ${s.broker?.brokerName || 'there'},`,
    '',
    `Could we please run a quick check on ${propLabel}?`,
    '',
    `• Buyer profile: ${profileLabel} (${s.state} ${s.region})`,
    `• Purchase price: ${money(r.P)}`,
    `• Loan needed: ${money(r.L)} (${lvr}% LVR)`,
    `• Deposit: ${money(r.deposit)} (${(r.deposit / r.P * 100).toFixed(1)}%)`,
    `• Est. stamp duty: ${money(r.D)}${isFhb ? ' (FHB)' : ''}`,
    r.lmi > 0 ? `• Est. LMI: ${money(r.lmi)}` : null,
    `• Cash kept after settlement: ${money(r.kept)}`,
    `• Est. monthly repayment: ${money(r.monthly)}/mo at ${s.rate}%`,
    r.strataQtr > 0 ? `• Strata: ${money(r.strataQtr)}/qtr` : null,
    '',
    `Interactive link: ${typeof window !== 'undefined' ? buildShareUrl(s, { includeShortlist: true, clientMode: true }) : ''}`
  ].filter(v => v !== null);

  return `mailto:${encodeURIComponent(brokerEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyLines.join('\n'))}`;
}
