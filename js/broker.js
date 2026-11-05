import { STATES } from './rates.js';
import { money, short, getBuyerFlags, getMinDepositPct } from './calc.js';

export const BROKER_STORAGE_KEY = 'mortgage-buddy-broker-profile-v1';

export const DEFAULT_BROKER_PROFILE = {
  brokerName: '',
  company: '',
  email: '',
  phone: '',
  bookingUrl: '',
  acl: '',
  skipped: false
};

export function hasBrokerIdentity(profile) {
  if (!profile || typeof profile !== 'object') return false;
  return Boolean(
    (profile.brokerName && profile.brokerName.trim()) ||
    (profile.company && profile.company.trim()) ||
    (profile.email && profile.email.trim()) ||
    (profile.phone && profile.phone.trim())
  );
}

export function isBrokerOnboarded(profile) {
  if (!profile || typeof profile !== 'object') return false;
  return Boolean(profile.skipped || hasBrokerIdentity(profile));
}

export function loadBrokerProfile(storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  const out = Object.assign({}, DEFAULT_BROKER_PROFILE);
  if (!storage) return out;
  try {
    const raw = storage.getItem(BROKER_STORAGE_KEY);
    if (!raw) return out;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      for (const k of Object.keys(DEFAULT_BROKER_PROFILE)) {
        if (k === 'skipped') {
          out.skipped = Boolean(parsed.skipped);
        } else if (typeof parsed[k] === 'string') {
          out[k] = parsed[k].trim();
        }
      }
    }
  } catch (e) {}
  return out;
}

export function saveBrokerProfile(profile, storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  const clean = Object.assign({}, DEFAULT_BROKER_PROFILE);
  if (profile && typeof profile === 'object') {
    for (const k of Object.keys(DEFAULT_BROKER_PROFILE)) {
      if (k === 'skipped') {
        clean.skipped = Boolean(profile.skipped);
      } else if (typeof profile[k] === 'string') {
        clean[k] = profile[k].trim();
      }
    }
  }
  if (storage) {
    try {
      storage.setItem(BROKER_STORAGE_KEY, JSON.stringify(clean));
    } catch (e) {}
  }
  return clean;
}

/**
 * Generates a desktop-friendly email subject and body for a broker sending
 * a pre-configured calculator link to their client.
 */
export function buildClientHandOffEmail(s, maxAfford, shareUrl) {
  const b = (s && s.broker) || {};
  const clientName = (b.clientName || '').trim();
  const to = (b.clientEmail || '').trim();
  const brokerName = (b.brokerName || '').trim();
  const company = (b.company || '').trim();
  const phone = (b.phone || '').trim();

  const { usesScheme } = getBuyerFlags(s);
  const stInfo = STATES[s.state] || STATES.NSW;
  const regionLabel = (stInfo.hasRegions && usesScheme)
    ? (s.region === 'regional' ? ` (${stInfo.regionalLabel})` : ` (${stInfo.metroLabel})`)
    : '';
  const profileLabel = usesScheme ? 'First Home (5% Scheme)' : 'Standard Buyer';
  const minPct = getMinDepositPct(s);
  const maxLvr = 100 - minPct;

  const subject = clientName
    ? `Your Pre-Approval & Open Home Calculator — ${clientName}`
    : `Your Pre-Approval & Open Home Calculator (${short(maxAfford)} Max Price)`;

  const greeting = clientName ? `Hi ${clientName},` : 'Hi there,';

  const signOffLines = ['Best regards,'];
  if (brokerName) signOffLines.push(brokerName);
  if (company) signOffLines.push(company);
  if (phone) signOffLines.push(phone);
  if (signOffLines.length === 1) {
    signOffLines.push('Your Mortgage Broker');
  }

  const bodyLines = [
    greeting,
    '',
    'Here is your personalised Open Home & Property Calculator pre-loaded with your pre-approval numbers:',
    '',
    `• Max Purchase Price Ceiling: ${money(maxAfford)}`,
    `• Max Pre-Approved Loan: ${money(s.maxLoan)} (at ${s.rate}% over ${s.years} yrs)`,
    `• Available Savings Included: ${money(s.savings)}`,
    `• Minimum Deposit Setting: ${minPct}% (up to ${maxLvr}% LVR)`,
    `• Buyer Profile: ${s.state}${regionLabel} · ${profileLabel}`,
    '',
    'Open your calculator here:',
    shareUrl || '',
    '',
    'When you are looking at listings or at an open home, simply slide or type the property price (and any quarterly strata for units) to see your exact deposit, stamp duty, repayments, and cash kept after settlement.',
    '',
    ...signOffLines
  ];

  return {
    to,
    subject,
    body: bodyLines.join('\n')
  };
}

/**
 * Builds 1-click desktop email compose URLs (Default Mailto, Gmail Web, Outlook Web).
 */
export function buildEmailComposeLinks({ to = '', subject = '', body = '' }) {
  const cleanTo = String(to || '').trim();
  const encTo = encodeURIComponent(cleanTo);
  const encSub = encodeURIComponent(String(subject || ''));
  const encBody = encodeURIComponent(String(body || ''));

  return {
    mailtoHref: `mailto:${encTo}?subject=${encSub}&body=${encBody}`,
    gmailHref: `https://mail.google.com/mail/?view=cm&fs=1&to=${encTo}&su=${encSub}&body=${encBody}`,
    outlookHref: `https://outlook.office.com/mail/deeplink/compose?to=${encTo}&subject=${encSub}&body=${encBody}`
  };
}
