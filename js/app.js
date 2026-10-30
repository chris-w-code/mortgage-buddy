import { STATES, getSchemeCap } from './rates.js';
import {
  DEFAULTS, MONEY_KEYS, PLAIN_KEYS, money, short, parseNum,
  calc, getDynamicPriceBounds, getBuyerFlags, convertFreqAmount, toMonthly
} from './calc.js';
import { decodeSharePayload, buildShareUrl, buildBrokerInquiryMailto } from './share.js';

(function () {
  const $ = id => document.getElementById(id);
  const STORAGE_KEY = 'mortgage-buddy-v1';
  const LEGACY_KEY = 'shire-calc';

  let s = structuredClone(DEFAULTS);
  let viewMode = 'default';
  let activeTab = 'ladder';

  // Keys that live inside Setup / Price card (excluding the 3 synchronized split boxes which display live r.kept, r.deposit, r.L)
  const SPLIT_KEYS = ['keepTarget', 'depositTarget', 'loanTarget'];
  const DIRECT_MONEY_KEYS = MONEY_KEYS.filter(k => !SPLIT_KEYS.includes(k));

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
    if (typeof src.showBudget === 'boolean') s.showBudget = src.showBudget;
    if (['fhb_scheme', 'fhb_standard', 'standard'].includes(src.buyerType)) {
      s.buyerType = src.buyerType;
      s.fhb = src.buyerType !== 'standard';
    } else if (typeof src.fhb === 'boolean') {
      s.buyerType = src.fhb ? 'fhb_scheme' : 'standard';
    }
    if (src.payFreq === 'mo' || src.payFreq === 'fn') s.payFreq = src.payFreq;
    if (src.rentFreq === 'mo' || src.rentFreq === 'fn') s.rentFreq = src.rentFreq;
    if (['max', 'set', 'loan', 'deposit'].includes(src.strategy)) s.strategy = src.strategy;
    if (isFinite(Number(src.ladderMax))) s.ladderMax = Math.max(0, Number(src.ladderMax));
    if (isFinite(Number(src.ladderStep))) s.ladderStep = Math.max(0, Number(src.ladderStep));
    if (src.state && STATES[src.state]) s.state = src.state;
    if (src.region === 'metro' || src.region === 'regional') s.region = src.region;
    if (Array.isArray(src.shortlist)) s.shortlist = src.shortlist;
    if (src.broker && typeof src.broker === 'object') {
      s.broker = Object.assign({}, DEFAULTS.broker, src.broker);
      if (s.broker.accent === '#1E6A54' || s.broker.accent === '#2563EB') {
        s.broker.accent = '#463F3A';
      }
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

  function toggleSetupDrawer(forceOpen, focusId) {
    const backdrop = $('setupModalBackdrop');
    const btn = $('btnToggleSetup');
    const nextOpen = typeof forceOpen === 'boolean' ? forceOpen : backdrop.hidden;
    backdrop.hidden = !nextOpen;
    btn.setAttribute('aria-expanded', String(nextOpen));
    document.body.style.overflow = nextOpen ? 'hidden' : '';
    if (nextOpen && focusId) {
      const target = $(focusId);
      if (target) {
        setTimeout(() => {
          try { target.focus(); if (target.select) target.select(); } catch (e) {}
        }, 30);
      }
    }
  }

  function toggleLadderMenu(forceOpen) {
    const pop = $('ladderMenuPopover');
    const btn = $('btnLadderMenu');
    if (!pop || !btn) return;
    const nextOpen = typeof forceOpen === 'boolean' ? forceOpen : pop.hidden;
    pop.hidden = !nextOpen;
    btn.setAttribute('aria-expanded', String(nextOpen));
  }

  function setActiveTab(tabName) {
    activeTab = tabName === 'shortlist' ? 'shortlist' : 'ladder';
    const isLadder = activeTab === 'ladder';
    $('tabBtnLadder').setAttribute('aria-selected', String(isLadder));
    $('tabBtnShortlist').setAttribute('aria-selected', String(!isLadder));
    $('tabPanelLadder').hidden = !isLadder;
    $('tabPanelShortlist').hidden = isLadder;
    if ($('ladderHeadRight')) $('ladderHeadRight').hidden = !isLadder;
    if ($('tabSubtleHint')) {
      $('tabSubtleHint').hidden = isLadder;
      $('tabSubtleHint').textContent = 'Save open homes to compare side-by-side or share with your partner and broker.';
    }
    if (!isLadder) toggleLadderMenu(false);
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
        : 'Next Home / Standard';
    $('eyebrowState').textContent = `${s.state} · ${profileLabel}`;

    const shortProfile = usesScheme ? 'FHB 5%' : isFhb ? 'FHB' : 'Standard';
    $('baseProfilePill').textContent = `${s.state} · ${shortProfile}`;

    // Show/hide scheme-specific vs standard buyer fields inside Setup
    $('otherCashField').hidden = !usesScheme;
    $('expensesField').hidden = !usesScheme;
    $('holdMonthsField').hidden = !usesScheme;
    $('lmiCheckWrap').hidden = usesScheme;
  }

  function renderInputs() {
    DIRECT_MONEY_KEYS.forEach(k => {
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
    $('showBudget').checked = !!s.showBudget;
    $('budgetFieldsWrap').hidden = !s.showBudget;
    $('budgetSummaryRow').hidden = !s.showBudget;

    const bounds = getDynamicPriceBounds(s);
    const pr = $('priceRange');
    pr.min = bounds.sliderMin;
    pr.max = bounds.sliderMax;
    pr.value = Math.min(bounds.sliderMax, Math.max(bounds.sliderMin, s.price));

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
    if ($('br_minDepPct')) {
      $('br_minDepPct').value = String((s.broker && s.broker.minDepPct) || 5);
    }
    if ($('brokerPanel')) {
      $('brokerPanel').hidden = viewMode === 'client';
    }
  }

  function renderSplitControls(r) {
    // Update the unified Deposit / Cash Kept / Loan slider bounds & position
    const sr = $('splitRange');
    const minDep = Math.round(r.minDepAtPrice);
    const maxDep = Math.max(minDep, Math.round(r.maxDepFromSavings));
    sr.min = minDep;
    sr.max = maxDep;
    sr.disabled = maxDep <= minDep;
    sr.value = Math.min(maxDep, Math.max(minDep, Math.round(r.deposit)));

    // Keep the 3 tap-to-type inputs synchronized with live calculated amounts (unless user is actively typing in one)
    const keepEl = $('keepTarget');
    if (document.activeElement !== keepEl) {
      keepEl.value = Math.round(r.kept).toLocaleString('en-AU');
    }
    keepEl.classList.toggle('neg', r.kept < 0);

    const depEl = $('depositTarget');
    if (document.activeElement !== depEl) {
      depEl.value = Math.round(r.deposit).toLocaleString('en-AU');
    }

    const loanEl = $('loanTarget');
    if (document.activeElement !== loanEl) {
      loanEl.value = Math.round(r.L).toLocaleString('en-AU');
    }

    // Highlight active card
    $('cardKeep').classList.toggle('is-active', s.strategy === 'set');
    $('cardDeposit').classList.toggle('is-active', s.strategy === 'deposit');
    $('cardLoan').classList.toggle('is-active', s.strategy === 'loan');

    // Update integrated Min / Max slider buttons & axis labels based on user's available funds
    const atMin = Math.abs(r.deposit - minDep) < 500;
    const atMax = maxDep > minDep && Math.abs(r.deposit - maxDep) < 500;
    $('splitMinBtn').disabled = maxDep <= minDep;
    $('splitMaxBtn').disabled = maxDep <= minDep;
    $('splitMinBtn').setAttribute('aria-pressed', String(atMin));
    $('splitMaxBtn').setAttribute('aria-pressed', String(atMax));
    $('splitMinLabel').textContent = `Min deposit ${short(minDep)} (keep ${short(r.maxKeepAtPrice)})`;
    $('splitMaxLabel').textContent = `Max deposit ${short(maxDep)} ($0 kept)`;
  }

  function renderShortlist() {
    const list = Array.isArray(s.shortlist) ? s.shortlist : [];
    const emptyEl = $('shortlistEmpty');
    const wrapEl = $('shortlistTableWrap');
    const tbody = $('shortlistBody');

    $('tabBtnShortlist').textContent = `Saved Homes (${list.length})`;

    if (list.length === 0) {
      emptyEl.hidden = false;
      wrapEl.hidden = true;
      return;
    }
    emptyEl.hidden = true;
    wrapEl.hidden = false;

    tbody.innerHTML = list.map(item => {
      const x = calc(item.price, s, { strataQtr: item.strataQtr || 0 });
      const dotColor = x.status === 'bad' ? 'var(--bad)' : x.status === 'warn' ? 'var(--warn)' : x.status === 'info' ? 'var(--grey-olive)' : 'var(--accent-blush)';
      const isCur = Math.round(s.price) === Math.round(item.price) && Math.round(s.strataQtr || 0) === Math.round(item.strataQtr || 0);
      const strataLabel = item.strataQtr > 0 ? `${money(item.strataQtr)}/qtr` : '—';
      const mailHref = buildBrokerInquiryMailto(s, x, item.name);
      return `<tr class="clickable ${isCur ? 'cur' : ''}" data-sl-id="${item.id}">
        <td><span class="sl-badge" style="background:${dotColor}"></span><strong>${escapeHtml(item.name)}</strong></td>
        <td>${short(item.price)}</td>
        <td class="wide-only">${strataLabel}</td>
        <td class="wide-only">${money(x.deposit)}</td>
        <td class="wide-only">${money(x.D)}</td>
        <td>${money(x.monthly + x.strataMonthly)}</td>
        <td class="${x.kept < 0 ? 'neg' : ''}">${short(x.kept)}</td>
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
    renderSplitControls(r);

    const bounds = getDynamicPriceBounds(s);
    const maxP = bounds.maxAfford;

    // Update Baseline Summary Bar Pills
    $('baseSavingsPill').textContent = short(r.S);
    $('baseMaxLoanPill').textContent = short(s.maxLoan);
    $('baseRatePill').textContent = `${s.rate}%`;
    $('baseMaxPricePill').textContent = short(maxP);
    $('maxPriceTopHint').textContent = `Max: ${short(maxP)}`;

    const chipButtons = bounds.chips.map(p =>
      `<button type="button" class="chip" data-p="${p}" aria-pressed="${p === Math.round(s.price)}">${short(p)}</button>`
    );
    if (!bounds.chips.includes(maxP)) {
      chipButtons.push(
        `<button type="button" class="chip chip-max" data-p="${maxP}" aria-pressed="${maxP === Math.round(s.price)}" title="Maximum purchase price based on your funds and loan settings">Max: ${short(maxP)}</button>`
      );
    }
    $('chips').innerHTML = chipButtons.join('');

    $('notes').innerHTML = r.notes.map(n => `<li>${n}</li>`).join('');

    $('savingsLine').textContent = `Out of ${money(r.S)} available funds${s.months > 0 ? ` (incl. ${s.months} mo saving)` : ''}:`;
    const parts = [
      ['Deposit', r.deposit, 'var(--deposit)', `${(r.deposit / r.P * 100).toFixed(1)}% of price`],
      ['Stamp duty', r.D, 'var(--duty)', r.isFhb && r.D < r.fullD ? `With ${s.state} FHB concession` : `${s.state} transfer duty`]
    ];
    if (r.lmi > 0) {
      parts.push(['Est. LMI', r.lmi, 'var(--lmi)', `${(r.L / r.P * 100).toFixed(1)}% LVR insurance`]);
    }
    parts.push(['Legal & fees', r.C, 'var(--costs)', 'Conveyancing, inspections']);
    parts.push(
      r.kept >= 0
        ? ['Cash you keep', r.kept, 'var(--kept)', r.scheme ? `Up to ${money(Math.max(0, r.houseLimit))} cap` : 'For renos / buffer']
        : ['Shortfall', -r.kept, 'var(--short)', 'Over available funds']
    );

    const total = parts.reduce((a, p) => a + Math.max(0, p[1]), 0) || 1;
    $('bar').innerHTML = parts.map(p => `<span style="width:${Math.max(0, p[1]) / total * 100}%;background:${p[2]}"></span>`).join('');
    $('legend').innerHTML = parts.map(p => `<div><i style="background:${p[2]}"></i><span class="lbl">${p[0]}</span><b>${money(p[1])}</b><small>${p[3]}</small></div>`).join('');

    const hasStrata = r.strataQtr > 0;
    const totalMon = r.monthly + r.strataMonthly;
    const totalFn = r.fortnightly + r.strataFortnightly;

    $('strataHint').textContent = hasStrata
      ? `+${money(r.strataMonthly)}/mo (+${money(r.strataFortnightly)}/fn) included in repayments`
      : '$0 for houses, or quarterly strata for units';

    $('fMon').textContent = money(totalMon);
    $('fRate').textContent = `${s.rate}% · ${s.years} yrs${hasStrata ? ' + strata' : ''}`;
    $('fLoanSummary').textContent = hasStrata
      ? `${money(r.monthly)}/mo loan + ${money(r.strataMonthly)}/mo strata`
      : `On a ${money(r.L)} loan (${(r.L / r.P * 100).toFixed(0)}% LVR)`;
    $('fFn').textContent = money(totalFn);
    $('fFnNote').textContent = hasStrata
      ? `${money(r.fortnightly)}/fn loan + ${money(r.strataFortnightly)}/fn strata`
      : (r.fnYears ? `Paid off in ~${r.fnYears.toFixed(1)} yrs (${short(r.saved)} less interest)` : 'Half the monthly amount');

    // Barcode Tick-Bar LVR Visualizer (40 ticks)
    const lvrPct = Math.max(0, Math.min(100, (r.L / r.P) * 100));
    const depPct = Math.max(0, 100 - lvrPct);
    $('tickLoanLabel').innerHTML = `<strong>${lvrPct.toFixed(1)}%</strong> Loan LVR (${short(r.L)})`;
    $('tickDepLabel').innerHTML = `<strong>${depPct.toFixed(1)}%</strong> Deposit (${short(r.deposit)})`;
    const totalTicks = 40;
    const loanTicks = Math.round((lvrPct / 100) * totalTicks);
    const ticksHtml = [];
    for (let i = 0; i < totalTicks; i++) {
      ticksHtml.push(`<i class="${i < loanTicks ? 't-loan' : ''}"></i>`);
    }
    $('lvrTickBar').innerHTML = ticksHtml.join('');

    $('fLoan').textContent = money(r.L);
    $('fLvr').textContent = `${(r.L / r.P * 100).toFixed(1)}% LVR${r.lmi > 0 ? ` (+${short(r.lmi)} LMI)` : ''}`;
    $('fDep').textContent = money(r.deposit);
    $('fDepPct').textContent = `${(r.deposit / r.P * 100).toFixed(1)}% of price (${r.minPct}% min)`;

    const kEl = $('fKept');
    kEl.textContent = money(r.kept);
    if (r.scheme) {
      $('fLimit').textContent = `Hold-back cap: ${money(r.limit)}`;
      $('meterWrap').hidden = false;
      $('meter').style.width = Math.max(0, Math.min(100, (r.kept + r.O) / r.limit * 100)) + '%';
    } else {
      $('fLimit').textContent = r.kept < 0
        ? 'Shortfall on funds'
        : `Max keepable: ${money(r.maxKeepAtPrice)}`;
      $('meterWrap').hidden = true;
    }

    const lEl = $('fLeft');
    lEl.textContent = money(r.left);
    lEl.classList.toggle('neg', r.left < 0);
    const strataNote = r.strataMonthly > 0 ? ` + ${money(r.strataMonthly)}/mo strata` : '';
    const payLabel = s.payFreq === 'fn' ? `${money(s.pay)}/fn` : `${money(s.pay)}/mo`;
    const rentLabel = s.rentFreq === 'fn' ? `${money(s.rent)}/fn` : `${money(s.rent)}/mo`;
    $('fLeftNote').textContent = `${payLabel} budget + ${rentLabel} rent freed − ${money(s.running)}/mo running${strataNote}`;

    $('sumLine').textContent = r.usesScheme
      ? `${s.state} · ${s.rate}% · ${money(s.expenses)}/mo expenses · ${s.holdMonths}-mo hold-back`
      : `${s.state} · ${s.rate}% · Max loan ${short(s.maxLoan)}`;

    // Mobile Dock
    $('dPrice').textContent = short(s.price);
    $('dMon').textContent = `${money(totalMon)}/mo`;
    const dotColor = r.kept < 0 ? 'var(--bad)' : (s.showBudget && r.left < 0) ? 'var(--warn)' : 'var(--accent-blush)';
    $('dSub').innerHTML = `<span class="dock-dot" style="background:${dotColor}"></span>${money(totalFn)}/fn · keep ${short(r.kept)}`;

    // Price Ladder & Range Controls
    const ladMin = bounds.ladder[0];
    const ladMax = bounds.ladder[bounds.ladder.length - 1];
    $('ladderSpanLabel').textContent = `8 prices: ${short(ladMin)} → ${short(ladMax)} (${short(bounds.step)} steps)`;
    $('ladderAutoOpt').textContent = `Auto (${short(bounds.autoStep)})`;
    $('ladderStepSelect').value = String(s.ladderStep || 0);

    const ladMaxEl = $('ladderMaxInput');
    if (document.activeElement !== ladMaxEl) {
      ladMaxEl.value = Math.round(bounds.topPrice).toLocaleString('en-AU');
    }
    $('btnResetLadder').hidden = !(s.ladderMax > 0 || s.ladderStep > 0);

    $('ladder').innerHTML = bounds.ladder.map(p => {
      const x = calc(p, s);
      return `<tr data-p="${p}" tabindex="0" class="clickable ${p === Math.round(s.price) ? 'cur' : ''}"><td>${short(p)}${p === maxP ? ' <small>(Max)</small>' : ''}</td><td class="wide-only">${money(x.L)}</td><td class="wide-only">${money(x.deposit)}</td><td class="wide-only">${money(x.D)}</td><td>${money(x.monthly + x.strataMonthly)}</td><td>${money(x.fortnightly + x.strataFortnightly)}</td><td class="${x.kept < 0 ? 'neg' : ''}">${short(x.kept)}</td></tr>`;
    }).join('');

    renderShortlist();

    const stInfo = STATES[s.state] || STATES.NSW;
    const aclNote = s.broker && s.broker.acl ? ` ${s.broker.company || s.broker.brokerName || 'Broker'} (${s.broker.acl}).` : '';
    $('footNote').textContent = `Stamp duty estimates use current ${stInfo.name} rates. General estimates only — not financial or credit advice under the NCCP Act.${aclNote} Confirm duty with ${stInfo.authority} and loan eligibility with your broker.`;
  }

  function update() {
    const bounds = getDynamicPriceBounds(s);
    if (s.price > bounds.maxAfford) {
      s.price = bounds.maxAfford;
    }
    save();
    renderInputs();
    render();
  }

  function setPrice(p) {
    const bounds = getDynamicPriceBounds(s);
    s.price = Math.max(100000, Math.min(bounds.maxAfford, Math.round(p)));
    update();
  }

  // Wire up Compare Prices range controls (#ladderMaxInput, #ladderStepSelect, #btnResetLadder)
  const ladMaxEl = $('ladderMaxInput');
  ladMaxEl.addEventListener('input', () => {
    const val = parseNum(ladMaxEl.value);
    if (val >= 200000) {
      s.ladderMax = Math.min(10000000, Math.round(val));
      save();
      render();
      const bounds = getDynamicPriceBounds(s);
      $('priceRange').min = bounds.sliderMin;
      $('priceRange').max = bounds.sliderMax;
    }
  });
  ladMaxEl.addEventListener('blur', () => {
    const val = parseNum(ladMaxEl.value);
    if (!val || val < 200000) s.ladderMax = 0;
    update();
  });
  ladMaxEl.addEventListener('focus', () => { setTimeout(() => { try { ladMaxEl.select(); } catch (e) {} }, 0); });
  ladMaxEl.addEventListener('keydown', e => { if (e.key === 'Enter') ladMaxEl.blur(); });

  $('ladderStepSelect').addEventListener('change', e => {
    s.ladderStep = Math.max(0, Number(e.target.value) || 0);
    update();
  });

  $('btnResetLadder').addEventListener('click', () => {
    s.ladderMax = 0;
    s.ladderStep = 0;
    update();
  });

  if ($('btnLadderMenu')) {
    $('btnLadderMenu').addEventListener('click', e => {
      e.stopPropagation();
      toggleLadderMenu();
    });
  }
  if ($('btnCloseLadderMenu')) {
    $('btnCloseLadderMenu').addEventListener('click', () => toggleLadderMenu(false));
  }

  // Wire up standard numeric inputs (Setup + Price + Strata)
  DIRECT_MONEY_KEYS.concat(PLAIN_KEYS).forEach(k => {
    const el = $(k);
    if (!el) return;
    el.addEventListener('input', () => {
      s[k] = parseNum(el.value);
      save();
      render();
      const bounds = getDynamicPriceBounds(s);
      $('priceRange').value = Math.min(bounds.sliderMax, Math.max(bounds.sliderMin, s.price));
    });
    el.addEventListener('blur', () => {
      if (k === 'price') {
        const bounds = getDynamicPriceBounds(s);
        s.price = Math.max(100000, Math.min(bounds.maxAfford, Math.round(s.price)));
        save();
        render();
      }
      renderInputs();
    });
    el.addEventListener('focus', () => { setTimeout(() => { try { el.select(); } catch (e) {} }, 0); });
    el.addEventListener('keydown', e => { if (e.key === 'Enter') el.blur(); });
  });

  // Wire up the 3 synchronized tap-to-type split inputs (#keepTarget, #depositTarget, #loanTarget)
  const splitModeMap = {
    keepTarget: 'set',
    depositTarget: 'deposit',
    loanTarget: 'loan'
  };
  SPLIT_KEYS.forEach(k => {
    const el = $(k);
    if (!el) return;
    el.addEventListener('input', () => {
      s.strategy = splitModeMap[k];
      s[k] = Math.max(0, parseNum(el.value));
      save();
      render();
    });
    el.addEventListener('blur', () => render());
    el.addEventListener('focus', () => { setTimeout(() => { try { el.select(); } catch (e) {} }, 0); });
    el.addEventListener('keydown', e => { if (e.key === 'Enter') el.blur(); });
  });

  // Wire up unified 2nd slider (#splitRange)
  $('splitRange').addEventListener('input', e => {
    const val = +e.target.value;
    const minDep = +e.target.min;
    const maxDep = +e.target.max;
    if (val <= minDep + 500) {
      s.strategy = 'max';
    } else if (val >= maxDep - 500) {
      s.strategy = 'set';
      s.keepTarget = 0;
    } else {
      s.strategy = 'deposit';
      s.depositTarget = Math.round(val / 1000) * 1000;
    }
    update();
  });

  // Setup Modal toggles
  $('btnToggleSetup').addEventListener('click', () => toggleSetupDrawer(true));
  $('btnCloseSetup').addEventListener('click', () => toggleSetupDrawer(false));
  $('btnCloseSetupX').addEventListener('click', () => toggleSetupDrawer(false));
  $('setupModalBackdrop').addEventListener('click', e => {
    if (e.target === $('setupModalBackdrop')) toggleSetupDrawer(false);
  });

  // Jump to Max Affordable Price buttons
  $('baseCeilingBtn').addEventListener('click', () => {
    const bounds = getDynamicPriceBounds(s);
    setPrice(bounds.maxAfford);
  });
  $('maxPriceTopHint').addEventListener('click', () => {
    const bounds = getDynamicPriceBounds(s);
    setPrice(bounds.maxAfford);
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

  $('showBudget').addEventListener('change', e => {
    s.showBudget = e.target.checked;
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

  if ($('br_minDepPct')) {
    $('br_minDepPct').addEventListener('change', e => {
      s.broker = s.broker || structuredClone(DEFAULTS.broker);
      s.broker.minDepPct = Math.max(2, Math.min(50, Number(e.target.value) || 5));
      update();
    });
  }

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
    const pop = $('ladderMenuPopover');
    if (pop && !pop.hidden && !e.target.closest('#ladderMenuPopover') && !e.target.closest('#btnLadderMenu')) {
      toggleLadderMenu(false);
    }

    if (e.target.closest('[data-stop]')) return;

    // Baseline pill click -> open setup drawer and focus input
    const openSetupBtn = e.target.closest('[data-open-setup]');
    if (openSetupBtn) {
      toggleSetupDrawer(true, openSetupBtn.dataset.openSetup);
      return;
    }

    // Bottom Comparison Tabs
    const tabBtn = e.target.closest('[data-tab]');
    if (tabBtn) {
      setActiveTab(tabBtn.dataset.tab);
      return;
    }

    // Min / Max buttons integrated into Lever 2 slider
    const splitEndBtn = e.target.closest('[data-split-end]');
    if (splitEndBtn) {
      const end = splitEndBtn.dataset.splitEnd;
      if (end === 'min') {
        s.strategy = 'max';
      } else if (end === 'max') {
        s.strategy = 'set';
        s.keepTarget = 0;
      }
      update();
      return;
    }

    // Frequency toggle (/mo vs /fn) on pay or rent
    const freqBtn = e.target.closest('[data-freq-field]');
    if (freqBtn) {
      const field = freqBtn.dataset.freqField;
      const newFreq = freqBtn.dataset.freqVal;
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
    if (e.key === 'Escape' && $('ladderMenuPopover') && !$('ladderMenuPopover').hidden) {
      toggleLadderMenu(false);
      return;
    }
    if (e.key === 'Escape' && !$('setupModalBackdrop').hidden) {
      toggleSetupDrawer(false);
      return;
    }
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
