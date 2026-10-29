import { STATES, getSchemeCap } from './rates.js';
import {
  DEFAULTS, MONEY_KEYS, PLAIN_KEYS, money, short, parseNum,
  calc, getDynamicPriceBounds, getBuyerFlags, convertFreqAmount, toMonthly, solveMaxPrice
} from './calc.js';
import { decodeSharePayload, buildShareUrl, buildBrokerInquiryMailto } from './share.js';

(function () {
  const $ = id => document.getElementById(id);
  const STORAGE_KEY = 'mortgage-buddy-v1';
  const LEGACY_KEY = 'shire-calc';

  let s = structuredClone(DEFAULTS);
  let viewMode = 'default';

  function loadInitialState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_KEY);
      const saved = JSON.parse(raw || 'null');
      if (saved && typeof saved === 'object') {
        mergeState(saved);
      }
    } catch (e) {}

    if (window.location.hash && window.location.hash.startsWith('#s=')) {
      const token = window.location.hash.slice(3);
      const fromUrl = decodeSharePayload(token);
      if (fromUrl) {
        mergeState(fromUrl);
        if (fromUrl._viewMode === 'client') {
          viewMode = 'client';
        }
      }
    }
  }

  function mergeState(src) {
    MONEY_KEYS.concat(PLAIN_KEYS).forEach(k => {
      const n = Number(src[k]);
      if (isFinite(n)) s[k] = n;
    });
    if (typeof src.fhb === 'boolean') s.fhb = src.fhb;
    if (typeof src.allowLmi === 'boolean') s.allowLmi = src.allowLmi;
    if (['fhb_scheme', 'fhb_standard', 'standard'].includes(src.buyerType)) {
      s.buyerType = src.buyerType;
      s.fhb = src.buyerType !== 'standard';
    } else if (typeof src.fhb === 'boolean') {
      s.buyerType = src.fhb ? 'fhb_scheme' : 'standard';
    }
    if (src.payFreq === 'mo' || src.payFreq === 'fn') s.payFreq = src.payFreq;
    if (src.rentFreq === 'mo' || src.rentFreq === 'fn') s.rentFreq = src.rentFreq;
    if (['max', 'set', 'loan'].includes(src.strategy)) s.strategy = src.strategy;
    if (src.state && STATES[src.state]) s.state = src.state;
    if (src.region === 'metro' || src.region === 'regional') s.region = src.region;
    if (Array.isArray(src.shortlist)) s.shortlist = src.shortlist;
    if (src.broker && typeof src.broker === 'object') {
      s.broker = Object.assign({}, DEFAULTS.broker, src.broker);
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    } catch (e) {}
  }

  function showToast(msg) {
    const t = $('toast');
    if (!t) return;
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => { t.hidden = true; }, 2800);
  }

  async function copyUrlToClipboard(url, message) {
    try {
      await navigator.clipboard.writeText(url);
      showToast(message);
    } catch (e) {
      window.prompt('Copy this shareable link:', url);
    }
  }

  function applyBrokerTheme() {
    const hasBroker = Boolean(s.broker && (s.broker.enabled || s.broker.brokerName || s.broker.company));
    if (hasBroker && s.broker.accent && /^#[0-9a-fA-F]{6}$/.test(s.broker.accent)) {
      document.documentElement.style.setProperty('--accent', s.broker.accent);
      document.documentElement.style.setProperty('--deposit', s.broker.accent);
    } else {
      document.documentElement.style.removeProperty('--accent');
      document.documentElement.style.removeProperty('--deposit');
    }
  }

  function renderBrokerBanner(r) {
    const banner = $('brokerBanner');
    const hasBroker = Boolean(s.broker && (s.broker.enabled || s.broker.brokerName || s.broker.company));
    if (!hasBroker) {
      banner.hidden = true;
      return;
    }
    banner.hidden = false;
    const firm = s.broker.company || s.broker.brokerName || 'Your Mortgage Broker';
    const clientLine = s.broker.clientName ? `Prepared for ${s.broker.clientName}` : 'Client Pre-Approval Companion';
    $('bBadge').textContent = firm + (s.broker.acl ? ` · ${s.broker.acl}` : '');
    $('bTitle').textContent = clientLine;
    $('bSub').textContent = s.broker.brokerName && s.broker.company
      ? `Broker: ${s.broker.brokerName} · Pre-configured with your borrowing limits & ${s.state} rules`
      : `Pre-configured with your borrowing limits & ${s.state} rules`;

    const ctas = [];
    const mailHref = buildBrokerInquiryMailto(s, r);
    ctas.push(`<a class="btn-sm btn-primary" href="${mailHref}">Ask ${escapeHtml(s.broker.brokerName || 'Broker')} about ${short(r.P)}</a>`);
    if (s.broker.phone) {
      ctas.push(`<a class="btn-sm" href="tel:${encodeURIComponent(s.broker.phone)}">Call ${escapeHtml(s.broker.phone)}</a>`);
    }
    if (s.broker.bookingUrl) {
      ctas.push(`<a class="btn-sm" href="${escapeHtml(s.broker.bookingUrl)}" target="_blank" rel="noopener noreferrer">Book a call</a>`);
    }
    $('bCtas').innerHTML = ctas.join('');
  }

  function getApproachHelp(usesScheme) {
    if (s.strategy === 'set') {
      return 'Keep this exact cash buffer and put remaining funds into the deposit to lower your loan.';
    }
    if (s.strategy === 'loan') {
      return 'Lock in a target loan amount to see your exact repayments, required deposit, and leftover cash.';
    }
    if (usesScheme) {
      return 'Put down the 5% minimum deposit and keep as much cash as the hold-back rule allows.';
    }
    return s.allowLmi
      ? 'Put down the minimum 10% deposit (with LMI) to keep as much upfront cash as possible.'
      : 'Put down a 20% deposit (80% LVR — no LMI) and keep the rest of your cash.';
  }

  function renderProfileAndState() {
    const st = STATES[s.state] || STATES.NSW;
    const { buyerType, isFhb, usesScheme } = getBuyerFlags(s);

    $('buyerTypeSelect').value = buyerType;
    $('stateSelect').value = s.state;

    const regSelect = $('regionSelect');
    if (st.hasRegions && usesScheme) {
      regSelect.hidden = false;
      regSelect.innerHTML = [
        `<option value="metro">${st.metroLabel}</option>`,
        `<option value="regional">${st.regionalLabel}</option>`
      ].join('');
      regSelect.value = s.region;
    } else {
      regSelect.hidden = true;
    }

    const cap = getSchemeCap(s.state, s.region);
    $('capPill').hidden = !usesScheme;
    $('capPill').textContent = `5% scheme cap: ${short(cap)}`;

    const profileLabel = usesScheme
      ? 'First Home (5% Scheme)'
      : isFhb
        ? 'First Home Buyer'
        : 'Property Purchase Calculator';
    $('eyebrowState').textContent = `${s.state} · ${profileLabel}`;

    $('ledeText').textContent = usesScheme
      ? 'Enter a listing price at an open home or auction to see your deposit, stamp duty, the cash you can keep under the 5% scheme hold-back rule, and your repayments.'
      : 'Enter a listing price or target loan to see your deposit, stamp duty, leftover cash buffer, and monthly or fortnightly repayments.';

    // Show/hide scheme-specific vs standard buyer fields
    $('otherCashField').hidden = !usesScheme;
    $('expensesField').hidden = !usesScheme;
    $('holdMonthsField').hidden = !usesScheme;
    $('lmiCheckWrap').hidden = usesScheme;
  }

  function renderInputs() {
    MONEY_KEYS.forEach(k => {
      const el = $(k);
      if (el && document.activeElement !== el) {
        el.value = Math.round(s[k] || 0).toLocaleString('en-AU');
      }
    });
    PLAIN_KEYS.forEach(k => {
      const el = $(k);
      if (el && document.activeElement !== el) {
        el.value = s[k];
      }
    });
    $('allowLmi').checked = !!s.allowLmi;

    const bounds = getDynamicPriceBounds(s);
    const pr = $('priceRange');
    pr.min = bounds.sliderMin;
    pr.max = bounds.sliderMax;
    pr.value = Math.min(bounds.sliderMax, Math.max(bounds.sliderMin, s.price));

    const { usesScheme } = getBuyerFlags(s);
    document.querySelectorAll('[data-strat]').forEach(b =>
      b.setAttribute('aria-checked', String(b.dataset.strat === s.strategy))
    );
    $('stratHelp').textContent = getApproachHelp(usesScheme);
    $('keepField').hidden = s.strategy !== 'set';
    $('loanField').hidden = s.strategy !== 'loan';

    // Frequency toggle pills for pay and rent
    document.querySelectorAll('[data-freq-field="pay"]').forEach(b => {
      b.setAttribute('aria-pressed', String(b.dataset.freqVal === (s.payFreq || 'mo')));
    });
    document.querySelectorAll('[data-freq-field="rent"]').forEach(b => {
      b.setAttribute('aria-pressed', String(b.dataset.freqVal === (s.rentFreq || 'mo')));
    });

    const payMo = toMonthly(s.pay, s.payFreq || 'mo');
    $('payFreqHint').textContent = s.payFreq === 'fn'
      ? `Fortnightly (= ${money(payMo)}/mo toward home)`
      : 'Per month toward home';

    const rentMo = toMonthly(s.rent, s.rentFreq || 'mo');
    $('rentFreqHint').textContent = s.rentFreq === 'fn'
      ? `Fortnightly (= ${money(rentMo)}/mo once you move in)`
      : 'Per month once you move in';

    // Broker setup inputs
    const bFields = ['clientName', 'brokerName', 'company', 'acl', 'phone', 'email', 'bookingUrl', 'accent'];
    bFields.forEach(f => {
      const el = $('br_' + f);
      if (el && document.activeElement !== el) {
        el.value = (s.broker && s.broker[f]) || '';
      }
    });
    if ($('brokerPanel')) {
      $('brokerPanel').hidden = viewMode === 'client';
    }
  }

  function renderShortlist() {
    const list = Array.isArray(s.shortlist) ? s.shortlist : [];
    const emptyEl = $('shortlistEmpty');
    const wrapEl = $('shortlistTableWrap');
    const tbody = $('shortlistBody');

    if (list.length === 0) {
      emptyEl.hidden = false;
      wrapEl.hidden = true;
      return;
    }
    emptyEl.hidden = true;
    wrapEl.hidden = false;

    tbody.innerHTML = list.map(item => {
      const x = calc(item.price, s, { strataQtr: item.strataQtr || 0 });
      const dotColor = x.status === 'bad' ? 'var(--bad)' : x.status === 'warn' ? 'var(--warn)' : x.status === 'info' ? 'var(--info)' : 'var(--good)';
      const isCur = Math.round(s.price) === Math.round(item.price) && Math.round(s.strataQtr || 0) === Math.round(item.strataQtr || 0);
      const strataLabel = item.strataQtr > 0 ? `${money(item.strataQtr)}/qtr` : '—';
      const mailHref = buildBrokerInquiryMailto(s, x, item.name);
      return `<tr class="clickable ${isCur ? 'cur' : ''}" data-sl-id="${item.id}">
        <td><span class="sl-badge" style="background:${dotColor}"></span><strong>${escapeHtml(item.name)}</strong></td>
        <td>${short(item.price)}</td>
        <td class="wide-only">${strataLabel}</td>
        <td class="wide-only">${money(x.deposit)}</td>
        <td class="wide-only">${money(x.D)}</td>
        <td>${money(x.monthly)}</td>
        <td class="${x.kept < 0 ? 'neg' : ''}">${short(x.kept)}</td>
        <td class="${x.left < 0 ? 'neg' : ''}">${money(x.left)}</td>
        <td>
          <span class="sl-actions">
            <a class="btn-icon" href="${mailHref}" title="Send to broker" data-stop="1">Ask Broker</a>
            <button type="button" class="btn-icon" data-del-sl="${item.id}" aria-label="Remove ${escapeHtml(item.name)}">✕</button>
          </span>
        </td>
      </tr>`;
    }).join('');
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function render() {
    applyBrokerTheme();
    renderProfileAndState();
    const r = calc(s.price, s);
    renderBrokerBanner(r);

    const bounds = getDynamicPriceBounds(s);
    const maxP = bounds.maxAfford;
    $('maxPriceTopHint').textContent = `± $10k · Max price: ${short(maxP)}`;

    const chipButtons = bounds.chips.map(p =>
      `<button type="button" class="chip" data-p="${p}" aria-pressed="${p === Math.round(s.price)}">${short(p)}</button>`
    );
    if (!bounds.chips.includes(maxP)) {
      chipButtons.push(
        `<button type="button" class="chip chip-max" data-p="${maxP}" aria-pressed="${maxP === Math.round(s.price)}" title="Maximum purchase price based on your funds and loan settings">Max: ${short(maxP)}</button>`
      );
    }
    $('chips').innerHTML = chipButtons.join('');

    if (s.strategy === 'loan') {
      $('loanMaxHint').innerHTML = `<span>With a ${short(s.loanTarget)} loan + your funds, max price is <strong>${money(maxP)}</strong></span>` +
        (Math.round(s.price) !== maxP ? `<button type="button" data-p="${maxP}" class="chip">Load ${short(maxP)}</button>` : '');
    }

    const cls = 'v-' + r.status;
    const v = $('verdict');
    v.className = 'verdict o2 ' + cls;
    const askHref = buildBrokerInquiryMailto(s, r);
    const hasBroker = Boolean(s.broker && (s.broker.enabled || s.broker.brokerName || s.broker.company || s.broker.email));
    v.innerHTML = `<div class="verdict-text"><strong>${r.verdictTitle}</strong><p>${r.verdictBody}</p></div>` +
      (hasBroker ? `<a class="btn-sm" href="${askHref}">Check with ${escapeHtml(s.broker.brokerName || 'Broker')}</a>` : '');

    $('notes').innerHTML = r.notes.map(n => `<li>${n}</li>`).join('');

    $('savingsLine').textContent = `${money(r.S)} available funds${s.months > 0 ? ` after ${s.months} more month${s.months > 1 ? 's' : ''} of saving` : ''}${r.O > 0 ? `, plus ${money(r.O)} other cash that isn't used here` : ''}.`;
    const parts = [
      ['Deposit', r.deposit, 'var(--deposit)', `${(r.deposit / r.P * 100).toFixed(1)}% of price`],
      ['Stamp duty', r.D, 'var(--duty)', r.isFhb && r.D < r.fullD ? `With ${s.state} FHB concession` : `${s.state} standard rate`]
    ];
    if (r.lmi > 0) {
      parts.push(['Est. LMI', r.lmi, 'var(--lmi)', `${(r.L / r.P * 100).toFixed(1)}% LVR insurance`]);
    }
    parts.push(['Legal and other', r.C, 'var(--costs)', 'Conveyancer, inspections']);
    parts.push(
      r.kept >= 0
        ? ['Cash kept', r.kept, 'var(--kept)', (r.target != null ? `Aim ${money(r.target)} · ` : '') + (r.scheme ? `up to ${money(Math.max(0, r.houseLimit))}` : 'available buffer')]
        : ['Shortfall', -r.kept, 'var(--short)', 'Not covered by funds']
    );

    const total = parts.reduce((a, p) => a + Math.max(0, p[1]), 0) || 1;
    $('bar').innerHTML = parts.map(p => `<span style="width:${Math.max(0, p[1]) / total * 100}%;background:${p[2]}"></span>`).join('');
    $('legend').innerHTML = parts.map(p => `<div><i style="background:${p[2]}"></i><span class="lbl">${p[0]}</span><b>${money(p[1])}</b><small>${p[3]}</small></div>`).join('');

    $('fMon').textContent = money(r.monthly);
    $('fRate').textContent = `${s.rate}% over ${s.years} yrs`;
    $('fFn').textContent = money(r.fortnightly);
    $('fFnNote').textContent = r.fnYears ? `Done in ~${r.fnYears.toFixed(1)} yrs, ${short(r.saved)} less interest` : 'Half the monthly amount';
    $('fLoan').textContent = money(r.L);
    $('fLvr').textContent = `${(r.L / r.P * 100).toFixed(1)}% LVR${r.lmi > 0 ? ` (+${short(r.lmi)} LMI)` : ''}`;
    $('fDep').textContent = money(r.deposit);
    $('fDepPct').textContent = r.extraDep > 1 ? `${(r.deposit / r.P * 100).toFixed(1)}% of price` : `${r.minPct}% minimum`;

    const kEl = $('fKept');
    kEl.textContent = money(r.kept);
    kEl.classList.toggle('neg', r.kept < 0);
    if (r.scheme) {
      $('fLimit').textContent = (r.O > 0 ? `Total cash ${money(r.kept + r.O)} (incl. ${money(r.O)} other). ` : '') +
        `Hold-back limit ${money(r.limit)}: ${s.holdMonths} × (${money(s.expenses)} expenses + ${money(r.monthly)} repayment)`;
      $('meterWrap').hidden = false;
      $('meter').style.width = Math.max(0, Math.min(100, (r.kept + r.O) / r.limit * 100)) + '%';
    } else {
      $('fLimit').textContent = r.kept < 0
        ? 'Not enough funds for this price'
        : r.usesScheme
          ? 'Hold-back limit doesn\'t apply at 20%+ deposit'
          : 'Remaining cash buffer after settlement';
      $('meterWrap').hidden = true;
    }

    const lEl = $('fLeft');
    lEl.textContent = money(r.left);
    lEl.classList.toggle('neg', r.left < 0);
    const strataNote = r.strataMonthly > 0 ? ` + ${money(r.strataMonthly)}/mo strata` : '';
    const payLabel = s.payFreq === 'fn' ? `${money(s.pay)}/fn (${money(r.payMo)}/mo)` : `${money(s.pay)}/mo`;
    const rentLabel = s.rentFreq === 'fn' ? `${money(s.rent)}/fn (${money(r.rentMo)}/mo)` : `${money(s.rent)}/mo`;
    $('fLeftNote').textContent = `${payLabel} budget + ${rentLabel} rent/board freed, minus ${money(s.running)}/mo running costs${strataNote}`;

    $('sumLine').textContent = r.usesScheme
      ? `${s.state} · ${s.rate}% · ${money(s.expenses)}/mo expenses · ${s.holdMonths}-mo hold-back`
      : `${s.state} · ${s.rate}% · Max loan ${short(s.maxLoan)}`;

    // Dock
    $('dPrice').textContent = short(s.price);
    $('dMon').textContent = `${money(r.monthly)}/mo`;
    const dotColor = r.kept < 0 ? 'var(--bad)' : r.left < 0 ? 'var(--warn)' : 'var(--good)';
    $('dSub').innerHTML = `<span class="dock-dot" style="background:${dotColor}"></span>${money(r.fortnightly)}/fn · keep ${short(r.kept)}`;

    // Price Ladder
    $('ladder').innerHTML = bounds.ladder.map(p => {
      const x = calc(p, s);
      return `<tr data-p="${p}" tabindex="0" class="clickable ${p === Math.round(s.price) ? 'cur' : ''}"><td>${short(p)}${p === maxP ? ' <small>(Max)</small>' : ''}</td><td class="wide-only">${money(x.L)}</td><td class="wide-only">${money(x.deposit)}</td><td class="wide-only">${money(x.D)}</td><td>${money(x.monthly)}</td><td>${money(x.fortnightly)}</td><td class="${x.kept < 0 ? 'neg' : ''}">${short(x.kept)}</td><td class="${x.left < 0 ? 'neg' : ''}">${money(x.left)}</td></tr>`;
    }).join('');

    renderShortlist();

    const stInfo = STATES[s.state] || STATES.NSW;
    const aclNote = s.broker && s.broker.acl ? ` ${s.broker.company || s.broker.brokerName || 'Broker'} (${s.broker.acl}).` : '';
    $('footNote').textContent = r.usesScheme
      ? `How this works: under the 5% First Home Guarantee scheme (capped at ${short(r.schemeCap)} in this region), total cash retained cannot exceed the lender's hold-back limit (months × expenses plus monthly repayment). Savings above that limit go toward the deposit, reducing the loan. At 20% deposit or more, the scheme and hold-back limit do not apply. Stamp duty estimates use current ${stInfo.name} rates. General estimates only — not financial or credit advice under the NCCP Act.${aclNote} Confirm duty with ${stInfo.authority} and loan eligibility with your broker.`
      : `How this works: calculates required deposit, ${stInfo.name} transfer (stamp) duty, legal costs, and repayments across your target price or loan range. At 80% LVR (20% deposit) or below, no Lenders Mortgage Insurance (LMI) applies. General estimates only — not financial or credit advice under the NCCP Act.${aclNote} Confirm duty with ${stInfo.authority} and loan eligibility with your broker.`;
  }

  function update() {
    save();
    renderInputs();
    render();
  }

  function setPrice(p) {
    s.price = Math.max(100000, Math.min(5000000, Math.round(p)));
    update();
  }

  // Wire up inputs
  MONEY_KEYS.concat(PLAIN_KEYS).forEach(k => {
    const el = $(k);
    if (!el) return;
    el.addEventListener('input', () => {
      s[k] = parseNum(el.value);
      save();
      render();
      const bounds = getDynamicPriceBounds(s);
      $('priceRange').value = Math.min(bounds.sliderMax, Math.max(bounds.sliderMin, s.price));
    });
    el.addEventListener('blur', renderInputs);
    el.addEventListener('focus', () => { setTimeout(() => { try { el.select(); } catch (e) {} }, 0); });
    el.addEventListener('keydown', e => { if (e.key === 'Enter') el.blur(); });
  });

  $('buyerTypeSelect').addEventListener('change', e => {
    const bt = e.target.value;
    if (['fhb_scheme', 'fhb_standard', 'standard'].includes(bt)) {
      s.buyerType = bt;
      s.fhb = bt !== 'standard';
      update();
    }
  });

  $('allowLmi').addEventListener('change', e => {
    s.allowLmi = e.target.checked;
    update();
  });

  $('priceRange').addEventListener('input', e => setPrice(+e.target.value));

  $('stateSelect').addEventListener('change', e => {
    const newState = e.target.value;
    if (STATES[newState]) {
      s.state = newState;
      s.region = 'metro';
      update();
    }
  });

  $('regionSelect').addEventListener('change', e => {
    s.region = e.target.value === 'regional' ? 'regional' : 'metro';
    update();
  });

  // Shortlist Add
  $('addShortlistForm').addEventListener('submit', e => {
    e.preventDefault();
    const nameInput = $('slName');
    const name = (nameInput.value || '').trim() || `Property at ${short(s.price)}`;
    const item = {
      id: 'sl_' + Date.now().toString(36),
      name,
      price: Math.round(s.price),
      strataQtr: Math.max(0, Math.round(s.strataQtr || 0))
    };
    s.shortlist = Array.isArray(s.shortlist) ? s.shortlist : [];
    s.shortlist.unshift(item);
    nameInput.value = '';
    update();
    showToast(`Saved "${name}" to your shortlist`);
  });

  // Broker Setup fields
  ['clientName', 'brokerName', 'company', 'acl', 'phone', 'email', 'bookingUrl', 'accent'].forEach(f => {
    const el = $('br_' + f);
    if (!el) return;
    el.addEventListener('input', () => {
      s.broker = s.broker || structuredClone(DEFAULTS.broker);
      s.broker[f] = el.value.trim();
      s.broker.enabled = Boolean(s.broker.brokerName || s.broker.company || s.broker.clientName);
      save();
      render();
    });
  });

  // Share buttons
  $('btnSharePartner').addEventListener('click', () => {
    const url = buildShareUrl(s, { includeShortlist: true, clientMode: viewMode === 'client' });
    copyUrlToClipboard(url, 'Link copied! Send to your partner to sync numbers & shortlist.');
  });

  $('btnCopyClientLink').addEventListener('click', () => {
    s.broker.enabled = true;
    save();
    const url = buildShareUrl(s, { includeShortlist: true, clientMode: true });
    copyUrlToClipboard(url, 'Branded Client Link copied to clipboard!');
  });

  document.addEventListener('click', e => {
    if (e.target.closest('[data-stop]')) return;

    // Frequency toggle (/mo vs /fn) on pay or rent
    const freqBtn = e.target.closest('[data-freq-field]');
    if (freqBtn) {
      const field = freqBtn.dataset.freqField; // 'pay' or 'rent'
      const newFreq = freqBtn.dataset.freqVal; // 'mo' or 'fn'
      const freqKey = field + 'Freq';
      const oldFreq = s[freqKey] || 'mo';
      if (oldFreq !== newFreq) {
        s[field] = convertFreqAmount(s[field], oldFreq, newFreq);
        s[freqKey] = newFreq;
        update();
      }
      return;
    }

    const delBtn = e.target.closest('[data-del-sl]');
    if (delBtn) {
      const id = delBtn.dataset.delSl;
      s.shortlist = (s.shortlist || []).filter(item => item.id !== id);
      update();
      return;
    }

    const slRow = e.target.closest('[data-sl-id]');
    if (slRow) {
      const item = (s.shortlist || []).find(x => x.id === slRow.dataset.slId);
      if (item) {
        s.price = item.price;
        s.strataQtr = item.strataQtr || 0;
        update();
        window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      }
      return;
    }

    const sg = e.target.closest('[data-strat]');
    if (sg) {
      const nextStrat = sg.dataset.strat;
      if (nextStrat === 'loan' && s.strategy !== 'loan') {
        // Initialize loanTarget to current calculated loan so transition is smooth
        const cur = calc(s.price, s);
        if (cur.L > 0) s.loanTarget = Math.round(cur.L / 5000) * 5000;
      }
      s.strategy = nextStrat;
      update();
      return;
    }

    const am = e.target.closest('[data-amt]');
    if (am) { const k = am.dataset.amt; s[k] = Math.max(0, (s[k] || 0) + (+am.dataset.by)); update(); return; }

    const st = e.target.closest('[data-step]');
    if (st) { setPrice(s.price + (+st.dataset.step)); return; }

    const c = e.target.closest('.chip, tbody tr[data-p]');
    if (!c) return;
    setPrice(+c.dataset.p);
    if (c.tagName === 'TR') {
      window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    }
  });

  document.addEventListener('keydown', e => {
    const t = e.target;
    if (t.tagName === 'TR' && t.dataset.p && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      setPrice(+t.dataset.p);
    }
  });

  $('reset').addEventListener('click', () => {
    s = structuredClone(DEFAULTS);
    window.history.replaceState(null, '', window.location.pathname);
    update();
    showToast('Reset to default example numbers');
  });

  loadInitialState();
  renderInputs();
  render();
})();
