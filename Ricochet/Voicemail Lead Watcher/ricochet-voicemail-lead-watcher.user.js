// ==UserScript==
// @name         Ricochet Voicemail Lead Watcher
// @namespace    GIA.INC
// @version      2.28
// @description  Assists SDRs to be reminded of when to leave a voicemail.
// @author       JKira & Mr.G
// @match        https://giainc.ricochet.me/*
// @updateURL    https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/Ricochet/Voicemail%20Lead%20Watcher/ricochet-voicemail-lead-watcher.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/Ricochet/Voicemail%20Lead%20Watcher/ricochet-voicemail-lead-watcher.user.js
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      script.google.com
// @connect      script.googleusercontent.com
// @connect      docs.google.com
// @connect      spreadsheets.google.com
// @connect      drive.google.com
// @connect      accounts.google.com
// @connect      *.googleusercontent.com
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const DEFAULT_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbxxPdfKXKPbhBTUg2mlM9ZP3CpO70_gGMSYpNY8AQ5Ikn7SFPZez7-J954KfnqnlXTtng/exec';
  const DEFAULT_VM_ROUTING_URL = 'https://script.google.com/macros/s/AKfycbxAJWax-LOjK1_3-Caf0ZfzFenma9jtzxiG3wBav3w1hkjXHgnekq6E0zFDRLjeLs2Q/exec';
  const DEFAULT_VM_ROUTING_CSV_URLS = [
    'https://docs.google.com/spreadsheets/d/1u4eFoyKGE5j3iKl_PuGg54ftwni4OSnHT1N5Sc_xkLE/gviz/tq?tqx=out:csv&gid=0',
    'https://docs.google.com/spreadsheets/d/1u4eFoyKGE5j3iKl_PuGg54ftwni4OSnHT1N5Sc_xkLE/export?format=csv&gid=0'
  ];
  const DEFAULT_SDR_NAME = '';
  const LOOP_MS = 250;
  const CLOSE_CONFIRM_MISSES = 2;
  const CALIFORNIA_TZ = 'America/Los_Angeles';
  const VM_COUNTS = new Set([2, 5, 8, 11, 14, 18, 22, 26, 30, 34, 37, 40]);
  const SEND_COOLDOWN_MS = 10000;
  const SEND_DELAY_MS = 3000;
  const OUTBOUND_ADDRESS_PLACEHOLDER = '.';
  const DEFAULT_VM_GROUP = 'call';
  const DEFAULT_VM_GROUP_LABEL = 'Call';
  const DEFAULT_SHOW_REMINDER = true;
  const VM_ROUTING_REFRESH_MS = 5 * 60 * 1000;
  const VM_ORIGINAL_TEXT_DATA = 'tmRicochetVmOriginalText';
  const VM_ORIGINAL_LABEL_DATA = 'tmRicochetVmOriginalLabel';
  const VM_HAD_LABEL_DATA = 'tmRicochetVmHadLabel';
  const CALL_OPEN_SELECTOR = [
    'button.btn.btn-danger[ng-click*="hangup"]',
    'button.btn.btn-danger[ng-click*="transferandhangup"]',
    '[ng-click*="hangup"]',
    '[ng-click*="transferandhangup"]'
  ].join(', ');
  const VM_SELECT_CANDIDATE_SELECTOR = [
    'select.vm_btn[ng-model="perfect_voicemail"]',
    'select[ng-model*="voicemail" i]',
    'select[data-ng-model*="voicemail" i]',
    'select[ng-model*="vm" i]',
    'select[data-ng-model*="vm" i]',
    'select[name*="voice" i]',
    'select[class*="vm" i]'
  ].join(', ');
  const VM_PLAY_SELECTOR = [
    'button.vm_btn[ng-click*="playVm"]',
    '[ng-click*="playVm"]',
    '[data-ng-click*="playVm"]',
    'button[class*="vm" i]'
  ].join(', ');
  const VM_TOGGLE_SELECTOR = [
    'div.btn.btn-info.new-keypadstyle[ng-click*="toggleVoicemailWindow"]',
    '[ng-click*="toggleVoicemailWindow"]',
    '[data-ng-click*="toggleVoicemailWindow"]',
    '[ng-click*="openNewCallPerfectVoicemailModal"]',
    '[data-ng-click*="openNewCallPerfectVoicemailModal"]'
  ].join(', ');

  const KEYS = {
    url: 'tm_ricochet_webapp_url_v1',
    vmRoutingUrl: 'tm_ricochet_vm_routing_url_v1',
    vmRoutingCache: 'tm_ricochet_vm_routing_cache_v8',
    queue: 'tm_ricochet_queue_v1',
    stop: 'tm_ricochet_stop_session_v1',
    recent: 'tm_ricochet_recent_send_sigs_v1'
  };

  const state = {
    running: sessionStorage.getItem(KEYS.stop) !== '1',
    queueBusy: false,
    callWasOpen: false,
    closeMisses: 0,
    activeSession: null,
    badge: null,
    loopHandle: null,
    vmFilterSignature: '',
    vmAutoSelectSignature: '',
    vmAutoSelectLastAt: 0,
    vmAutoSelectSettleTimer: null,
    vmRoutingBusy: false,
    vmRoutingLastCheck: 0,
    vmRoutingRequestId: 0,
    vmRoutingErrors: [],
    vmRoutesByVendor: Object.create(null),
    vmRouteSourcesByVendor: Object.create(null),
    vmReminderByVendor: Object.create(null),
    vmRoutingSource: '',
    vmRoutingStatus: '',
    vmRoutesLoadedAt: 0,
    vmOptionStores: new WeakMap()
  };

  init();

  function init() {
    if (!localStorage.getItem(KEYS.url)) {
      localStorage.setItem(KEYS.url, DEFAULT_WEB_APP_URL);
    }

    loadVoicemailRoutingCache();
    refreshVoicemailRouting(true);

    createBadge();
    registerMenu();
    bindEvents();

    setTimeout(() => {
      promptForCallerNameIfMissing();
    }, 300);

    state.loopHandle = setInterval(mainLoop, LOOP_MS);
    log('Loaded');
  }

  function mainLoop() {
    try {
      if (!state.running) {
        clearActiveSession('stopped');
        state.callWasOpen = false;
        state.closeMisses = 0;
        hideBadge();
        processQueue();
        return;
      }

      if (!hasLeadWatcherSurface() && !state.activeSession && !state.callWasOpen) {
        state.closeMisses = 0;
        hideBadge();
        processQueue();
        return;
      }

      const callOpen = isCallOpen();

      if (callOpen) {
        state.closeMisses = 0;

        if (!state.callWasOpen) {
          handleCallOpened();
          state.callWasOpen = true;
        }

        updateCurrentCallData();
      } else {
        if (state.callWasOpen) {
          state.closeMisses += 1;

          if (state.closeMisses >= CLOSE_CONFIRM_MISSES) {
            handleCallClosed();
            state.callWasOpen = false;
            state.closeMisses = 0;
          }
        } else {
          updateCurrentCallData();
        }
      }
    } catch (err) {
      log(`Loop error: ${err && err.message ? err.message : err}`);
    }

    if (state.running) {
      try {
        applyVoicemailFilter();
      } catch (err) {
        log(`Voicemail filter error: ${err && err.message ? err.message : err}`);
      }
    }

    processQueue();
  }

  function hasLeadWatcherSurface() {
    return [
      '#btn-container.new-keypadwrap',
      '.lead-popup-main-row, .lead-popup-main-row-opened-script',
      '#lead-popup-phone-number',
      '.outbound-calls',
      CALL_OPEN_SELECTOR,
      'body.rico-on-call',
      VM_SELECT_CANDIDATE_SELECTOR,
      VM_PLAY_SELECTOR,
      VM_TOGGLE_SELECTOR,
      'button[ng-click*="triggerHotKeysStatusLead"]',
      '#stc-bottom-dialpad'
    ].some((selector) => [...document.querySelectorAll(selector)].some(isVisible));
  }

  function handleCallOpened() {
    const fresh = buildCurrentPayload();
    const freshLeadKey = getLeadKey(fresh);

    if (state.activeSession && !state.activeSession.sent) {
      const currentKey = getLeadKey(state.activeSession.payload);
      if (currentKey && freshLeadKey && currentKey !== freshLeadKey) {
        if (isSessionLocked(state.activeSession)) return;
        clearActiveSession('new_open_different_lead');
      }
    }

    if (!state.activeSession) {
      if (!hasAnyLeadData(fresh)) return;
      state.activeSession = createSessionFromFresh(fresh);
    }

    if (!state.activeSession.payload.timestampCallBoxOpen) {
      state.activeSession.payload.timestampCallBoxOpen = formatCaliforniaDate(new Date()) || '';
      log(`Call opened: ${state.activeSession.payload.number || state.activeSession.payload.email || state.activeSession.payload.name || 'unknown'}`);
    }

    state.activeSession.isCallOpen = true;
    state.activeSession.lastTouched = Date.now();
    updateBadgeFromSession();
  }

  function handleCallClosed() {
    if (!state.activeSession) {
      log('Call closed but no active session to stamp');
      hideBadge();
      return;
    }

    stampCloseTimestampIfMissing('auto_or_manual_close');

    state.activeSession.isCallOpen = false;
    state.activeSession.lastTouched = Date.now();
    hideBadge();
  }

  function stampCloseTimestampIfMissing(reason) {
    if (!state.activeSession) return;
    if (state.activeSession.payload.timestampCallBoxClosed) return;

    state.activeSession.payload.timestampCallBoxClosed = formatCaliforniaDate(new Date()) || '';
    log(`Call closed (${reason}): ${state.activeSession.payload.number || state.activeSession.payload.email || state.activeSession.payload.name || 'unknown'}`);
  }

  function updateCurrentCallData() {
    const fresh = buildCurrentPayload();
    const freshLeadKey = getLeadKey(fresh);
    const liveCallOpen = isCallOpen();

    if (!state.activeSession) {
      if (!hasAnyLeadData(fresh)) return;

      state.activeSession = createSessionFromFresh(fresh);
      state.activeSession.isCallOpen = liveCallOpen;

      if (liveCallOpen && !state.activeSession.payload.timestampCallBoxOpen) {
        state.activeSession.payload.timestampCallBoxOpen = formatCaliforniaDate(new Date()) || '';
      }

      updateBadgeFromSession();
      return;
    }

    const currentLeadKey = getLeadKey(state.activeSession.payload);

    if (!state.activeSession.sent && currentLeadKey && freshLeadKey && currentLeadKey !== freshLeadKey) {
      if (isSessionLocked(state.activeSession)) {
        state.activeSession.isCallOpen = liveCallOpen;
        if (!liveCallOpen && hasSelectedStatus(state.activeSession.payload) && !state.activeSession.payload.timestampCallBoxClosed) {
          stampCloseTimestampIfMissing('post_status_wait');
        }
        state.activeSession.lastTouched = Date.now();
        updateBadgeFromSession();
        return;
      }

      handleLeadChanged(fresh);
      return;
    }

    const p = state.activeSession.payload;
    state.activeSession.isCallOpen = liveCallOpen;

    if (isSessionLocked(state.activeSession)) {
      if (!liveCallOpen && hasSelectedStatus(p) && !p.timestampCallBoxClosed) {
        stampCloseTimestampIfMissing('post_status_wait');
      }

      p.sdrName = getCallerName() || p.sdrName || '';
      state.activeSession.lastTouched = Date.now();
      updateBadgeFromSession();
      return;
    }

    if (liveCallOpen && !p.timestampCallBoxOpen) {
      p.timestampCallBoxOpen = formatCaliforniaDate(new Date()) || '';
    }

    p.name = fresh.name || p.name || '';
    p.email = fresh.email || p.email || '';
    p.address = fresh.address || p.address || '';
    p.number = fresh.number || p.number || '';
    p.vendor = fresh.vendor || p.vendor || '';

    if (fresh.outboundCallAmount !== '' && fresh.outboundCallAmount != null) {
      p.outboundCallAmount = fresh.outboundCallAmount;
    }

    p.sdrName = getCallerName() || p.sdrName || '';
    state.activeSession.lastTouched = Date.now();

    updateBadgeFromSession();
  }

  function handleLeadChanged(fresh) {
    clearActiveSession('lead_changed_before_status');

    if (!hasAnyLeadData(fresh)) return;

    state.activeSession = createSessionFromFresh(fresh);

    if (isCallOpen()) {
      state.activeSession.payload.timestampCallBoxOpen = formatCaliforniaDate(new Date()) || '';
      state.activeSession.isCallOpen = true;
    }

    state.activeSession.lastTouched = Date.now();
    updateBadgeFromSession();
    log(`Lead changed: ${state.activeSession.payload.name || state.activeSession.payload.number || 'unknown'}`);
  }

  function createSessionFromFresh(fresh) {
    return {
      id: `s_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
      payload: {
        date: '',
        timestampCallBoxOpen: '',
        name: fresh.name || '',
        email: fresh.email || '',
        address: fresh.address || '',
        number: fresh.number || '',
        vendor: fresh.vendor || '',
        outboundCallAmount:
          fresh.outboundCallAmount !== '' && fresh.outboundCallAmount != null
            ? fresh.outboundCallAmount
            : '',
        sdrName: getCallerName() || fresh.sdrName || '',
        voicemailNameUsed: fresh.voicemailNameUsed || '',
        voicemailBoxOpened: fresh.voicemailBoxOpened || 'No',
        voicemailLeft: fresh.voicemailLeft || 'No',
        timestampCallBoxClosed: '',
        statusUsed: '',
        timestampStatusSelected: ''
      },
      sent: false,
      isCallOpen: false,
      lastTouched: Date.now(),
      finalizeTimer: null,
      finalizeReason: ''
    };
  }

  function finalizeAndQueue(reason) {
    const session = state.activeSession;
    if (!session || session.sent) return;
    if (!hasSelectedStatus(session.payload)) return;

    if (session.finalizeTimer) {
      clearTimeout(session.finalizeTimer);
      session.finalizeTimer = null;
    }

    const payload = {
      date: '',
      timestampCallBoxOpen: session.payload.timestampCallBoxOpen || '',
      name: session.payload.name || '',
      email: session.payload.email || '',
      address: session.payload.address || '',
      number: session.payload.number || '',
      vendor: session.payload.vendor || '',
      outboundCallAmount: normalizeOutboundForSend(session.payload.outboundCallAmount),
      sdrName: getCallerName() || session.payload.sdrName || '',
      voicemailNameUsed: session.payload.voicemailNameUsed || '',
      voicemailBoxOpened: session.payload.voicemailBoxOpened || 'No',
      voicemailLeft: session.payload.voicemailLeft || 'No',
      timestampCallBoxClosed: session.payload.timestampCallBoxClosed || '',
      statusUsed: session.payload.statusUsed || '',
      timestampStatusSelected: session.payload.timestampStatusSelected || ''
    };

    const queued = enqueue(payload);

    if (!queued) {
      session.sent = true;
      log(`Duplicate payload ignored (${reason}): ${payload.name || payload.number || payload.email || 'lead'} | status=${payload.statusUsed}`);
      state.activeSession = null;
      hideBadge();
      return;
    }

    processQueue(true);

    session.sent = true;
    log(`Queued session (${reason}): ${payload.name || payload.number || payload.email || 'lead'} | status=${payload.statusUsed}`);
    state.activeSession = null;
    hideBadge();
  }

  function scheduleFinalize(reason) {
    const session = state.activeSession;
    if (!session || session.sent) return;

    if (session.finalizeTimer) {
      log('Duplicate status click ignored: send already pending');
      return;
    }

    session.finalizeReason = reason || 'status_selected';

    const sessionId = session.id;
    session.finalizeTimer = setTimeout(() => {
      if (!state.activeSession || state.activeSession.id !== sessionId) return;

      state.activeSession.finalizeTimer = null;

      if (!state.activeSession.payload.timestampCallBoxClosed) {
        stampCloseTimestampIfMissing('delayed_before_send');
      }

      finalizeAndQueue(state.activeSession.finalizeReason || 'status_selected_delayed');
    }, SEND_DELAY_MS);

    log(`Send scheduled in ${Math.round(SEND_DELAY_MS / 1000)}s`);
  }

  function clearActiveSession(reason) {
    if (state.activeSession && state.activeSession.finalizeTimer) {
      clearTimeout(state.activeSession.finalizeTimer);
      state.activeSession.finalizeTimer = null;
    }

    if (state.activeSession && reason) {
      log(`Session cleared: ${reason}`);
    }

    state.activeSession = null;
    state.vmAutoSelectSignature = '';
    state.vmAutoSelectLastAt = 0;
    clearVoicemailAutoSelectSettleTimer();
  }

  function isSessionLocked(session) {
    return !!(session && (session.finalizeTimer || hasSelectedStatus(session.payload)));
  }

  function bindEvents() {
    document.addEventListener('click', onDocumentClick, true);
    document.addEventListener('change', onDocumentChange, true);
    document.addEventListener('keydown', onDocumentKeydown, true);
  }

  function onDocumentClick(e) {
    if (!state.running) return;

    const statusBtn = getStatusButtonElement(e.target);
    if (statusBtn) {
      if (!state.activeSession) {
        const fresh = buildCurrentPayload();
        if (!hasAnyLeadData(fresh)) return;
        state.activeSession = createSessionFromFresh(fresh);

        if (isCallOpen()) {
          state.activeSession.payload.timestampCallBoxOpen = formatCaliforniaDate(new Date()) || '';
          state.activeSession.isCallOpen = true;
        }
      }

      if (state.activeSession.finalizeTimer || hasSelectedStatus(state.activeSession.payload)) {
        log('Duplicate status click ignored');
        return;
      }

      if (wasRecentlyQueued(state.activeSession.payload)) {
        log('Status click ignored: 10s cooldown active for this lead');
        return;
      }

      const clickedStatus = getStatusButtonText(statusBtn);
      if (!clickedStatus) return;

      state.activeSession.payload.statusUsed = clickedStatus;
      state.activeSession.payload.timestampStatusSelected = formatCaliforniaDate(new Date()) || '';
      state.activeSession.lastTouched = Date.now();

      log(`Status clicked: ${clickedStatus}`);
      scheduleFinalize('status_selected');
      return;
    }

    const playVmBtn = getPlayVmElement(e.target);
    if (playVmBtn) {
      if (!state.activeSession) {
        const fresh = buildCurrentPayload();
        if (!hasAnyLeadData(fresh)) return;
        state.activeSession = createSessionFromFresh(fresh);
      }

      captureSelectedVoicemailName();
      state.activeSession.payload.voicemailBoxOpened = 'Yes';
      state.activeSession.payload.voicemailLeft = 'Yes';
      state.activeSession.lastTouched = Date.now();
      log('Play VM clicked');
      return;
    }

    const vmToggle = getVoicemailToggleElement(e.target);
    if (vmToggle) {
      setTimeout(() => {
        if (!state.activeSession) {
          const fresh = buildCurrentPayload();
          if (!hasAnyLeadData(fresh)) return;
          state.activeSession = createSessionFromFresh(fresh);
        }

        if (isVoicemailWindowOpen()) {
          applyVoicemailFilter();
          state.activeSession.payload.voicemailBoxOpened = 'Yes';
          state.activeSession.lastTouched = Date.now();
          log('Voicemail box opened');
        } else {
          captureSelectedVoicemailName();
          state.activeSession.lastTouched = Date.now();
          log('Voicemail box closed');
        }
      }, 120);
    }
  }

  function onDocumentChange(e) {
    if (!state.running) return;

    const select = getVoicemailSelectElement(e.target);
    if (!select) return;

    if (!state.activeSession) {
      const fresh = buildCurrentPayload();
      if (!hasAnyLeadData(fresh)) return;
      state.activeSession = createSessionFromFresh(fresh);
    }

    const optionText = getVoicemailOptionDisplayText(select.options[select.selectedIndex]);
    state.activeSession.payload.voicemailBoxOpened = 'Yes';
    state.activeSession.payload.voicemailNameUsed =
      optionText && optionText.toLowerCase() !== 'choose' ? optionText : '';
    state.activeSession.lastTouched = Date.now();

    log(`Voicemail selected: ${state.activeSession.payload.voicemailNameUsed || 'none'}`);
  }

  function onDocumentKeydown(e) {
    if (!state.running) return;
    if (e.key !== 'Enter') return;

    const input = e.target && e.target.matches && e.target.matches('#stc-bottom-dialpad')
      ? e.target
      : null;

    if (!input) return;

    updateCurrentCallData();
  }

  function hasSelectedStatus(payload) {
    return !!normalizeSpace(payload && payload.statusUsed);
  }

  function hasAnyLeadData(payload) {
    return !!(
      normalizeSpace(payload && payload.name) ||
      normalizeSpace(payload && payload.email) ||
      normalizeSpace(payload && payload.address) ||
      normalizeSpace(payload && payload.number) ||
      normalizeSpace(payload && payload.vendor)
    );
  }

  function getLeadKey(payload) {
    if (!payload) return '';

    const number = normalizePhone(payload.number);
    if (isStablePhoneKey(number)) return `number:${number}`;

    const email = normalizeSpace(payload.email).toLowerCase();
    if (isStableEmailKey(email)) return `email:${email}`;

    const name = normalizeSpace(payload.name).toLowerCase();
    const phoneFromName = normalizePhone(name);
    if (!hasLetters(name) && isStablePhoneKey(phoneFromName)) return `number:${phoneFromName}`;
    if (isStableNameKey(name)) return `name:${name}`;

    const address = normalizeSpace(payload.address).toLowerCase();
    if (address) return `address:${address}`;

    return '';
  }

  function isStablePhoneKey(value) {
    return normalizePhone(value).length >= 10;
  }

  function isStableEmailKey(value) {
    const clean = normalizeSpace(value);
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean);
  }

  function isStableNameKey(value) {
    const clean = normalizeSpace(value);
    return clean.length >= 2 && hasLetters(clean);
  }

  function hasLetters(value) {
    return /[a-z]/i.test(String(value || ''));
  }

  function buildCurrentPayload() {
    const popup = getActivePopup();
    const popupData = popup ? extractLeadData(popup) : null;
    const callBoxData = extractCallBoxData();
    const manualNumber = getManualDialNumber();

    return {
      name: (popupData && popupData.name) || callBoxData.name || '',
      email: (popupData && popupData.email) || '',
      address: (popupData && popupData.address) || '',
      number:
        (popupData && popupData.number) ||
        manualNumber ||
        callBoxData.number ||
        callBoxData.callerId ||
        '',
      vendor: (popupData && popupData.vendor) || '',
      outboundCallAmount:
        popupData && popupData.outboundCallAmount !== '' && popupData.outboundCallAmount != null
          ? popupData.outboundCallAmount
          : '',
      sdrName: getCallerName() || '',
      voicemailNameUsed: '',
      voicemailBoxOpened: 'No',
      voicemailLeft: 'No'
    };
  }

  function extractCallBoxData() {
    return {
      number: normalizePhone(firstText(document, ['.last-call-number'])),
      name: firstText(document, ['.last-call-name']),
      callerId: normalizePhone(firstText(document, ['.user-caller-id']))
    };
  }

  function getActivePopup() {
    const nodes = document.querySelectorAll('.lead-popup-main-row, .lead-popup-main-row-opened-script');
    const matches = [];

    for (const el of nodes) {
      if (!isVisible(el)) continue;
      if (el.querySelector('#lead-popup-phone-number') || el.querySelector('.outbound-calls')) {
        matches.push(el);
      }
    }

    return matches.length ? matches[matches.length - 1] : null;
  }

  function extractLeadData(root) {
    return {
      name: firstText(root, [
        '.col-sm-8 h2.ng-binding',
        '.col-sm-8 h2',
        'h2.ng-binding',
        'h2'
      ]),
      email: firstText(root, [
        '.led-usr-email.ng-binding',
        '.led-usr-email'
      ]),
      address: cleanAddress(firstText(root, [
        '.led-usr-addr .ng-binding',
        '.led-usr-addr'
      ])),
      number: normalizePhone(firstText(root, [
        '#lead-popup-phone-number',
        '.inspectletIgnore'
      ])),
      vendor: getValueByLabel(root, 'Vendor'),
      outboundCallAmount: getOutboundCount(root)
    };
  }

  function getOutboundCount(root) {
    const direct = firstText(root, [
      '.outbound-calls span.ng-binding',
      '.outbound-calls .ng-binding',
      '.outbound-calls span'
    ]);

    if (direct) return toInt(direct);

    const text = normalizeSpace(root.textContent || '');
    const match = text.match(/Outbound\s*(\d+)/i);
    return match ? Number(match[1]) : '';
  }

  function getValueByLabel(root, label) {
    const wanted = label.toLowerCase();
    const nodes = root.querySelectorAll('div, span, label');

    for (const node of nodes) {
      const text = normalizeSpace(node.textContent || '').replace(/:$/, '');
      if (text.toLowerCase() !== wanted) continue;

      if (node.nextElementSibling) {
        const next = normalizeSpace(node.nextElementSibling.textContent || '');
        if (next) return stripLabel(next, label);
      }

      const row = node.closest('.row') || node.parentElement;
      if (!row) continue;

      const children = [...row.children]
        .map((child) => normalizeSpace(child.textContent || ''))
        .filter(Boolean);

      const value = children.find((part) => part.replace(/:$/, '').toLowerCase() !== wanted);
      if (value) return stripLabel(value, label);
    }

    return '';
  }

  function isCallOpen() {
    const hangupButtons = document.querySelectorAll(CALL_OPEN_SELECTOR);
    for (const btn of hangupButtons) {
      if (isVisible(btn) && !(btn.classList && btn.classList.contains('ng-hide'))) {
        return true;
      }
    }

    const timerWrap = document.querySelector('#new-call-timer');
    if (isVisible(timerWrap)) {
      const timerText = normalizeSpace(timerWrap.textContent || '');
      if (timerText) return true;
    }

    const root = document.querySelector('#btn-container.new-keypadwrap');
    if (isVisible(root)) return true;

    if (document.body && document.body.classList && document.body.classList.contains('rico-on-call')) {
      return true;
    }

    return false;
  }

  function isVoicemailWindowOpen() {
    if (findCustomVoicemailModal()) return true;

    const select = findVoicemailSelect();
    const playBtn = findPlayVmButton();
    return isVisible(select) || isVisible(playBtn);
  }

  function findVoicemailSelect() {
    const exact = document.querySelector('select.vm_btn[ng-model="perfect_voicemail"]');
    if (isVisible(exact)) return exact;

    for (const select of document.querySelectorAll(VM_SELECT_CANDIDATE_SELECTOR)) {
      if (isVisible(select) && isVoicemailSelectCandidate(select)) return select;
    }

    for (const select of document.querySelectorAll('select')) {
      if (isVisible(select) && isVoicemailSelectCandidate(select)) return select;
    }

    return null;
  }

  function findPlayVmButton() {
    for (const btn of document.querySelectorAll(VM_PLAY_SELECTOR)) {
      if (isVisible(btn)) return btn;
    }

    return null;
  }

  function findCustomVoicemailModal() {
    const modal = document.querySelector('#modalCallPerfectVoicemail');
    return isVisible(modal) ? modal : null;
  }

  function findCustomVoicemailDropdownButton() {
    const modal = findCustomVoicemailModal();
    if (!modal) return null;

    const buttons = [
      ...modal.querySelectorAll('button.button-dropdown-with-label, button.button-dropdown')
    ];

    for (const button of buttons) {
      if (!isVisible(button)) continue;

      const wrapper = button.closest('.dropdown-button-wrapper') || button.parentElement;
      const label = normalizeSpace(firstText(wrapper || modal, ['.dropdown-label']));
      if (!label || label.toLowerCase() === 'voicemail') {
        return button;
      }
    }

    return null;
  }

  function getCustomVoicemailOptionElements() {
    const modal = findCustomVoicemailModal();
    if (!modal) return [];

    return [...modal.querySelectorAll('.stc-vue-dropdown-option')];
  }

  function getCustomVoicemailOptionText(option) {
    return normalizeSpace(option && option.textContent);
  }

  function getCustomVoicemailSelectedText() {
    const button = findCustomVoicemailDropdownButton();
    if (!button) return '';

    const text = firstText(button, ['.dropdown-text']) || normalizeSpace(button.textContent || '');
    return isVoicemailSelectOptionPlaceholder(text) ? '' : text;
  }

  function findCustomVoicemailPlayButton(modal) {
    if (!modal || !modal.querySelectorAll) return null;

    for (const button of modal.querySelectorAll('button')) {
      if (normalizeSpace(button.textContent || '').toLowerCase() === 'play') {
        return button;
      }
    }

    return null;
  }

  function setCustomVoicemailControlsAvailable(modal, available) {
    const button = findCustomVoicemailDropdownButton();
    if (button) {
      if (!available) {
        const text = button.querySelector && button.querySelector('.dropdown-text');
        if (text) text.textContent = 'Select Option';
        else button.textContent = 'Select Option';
        button.disabled = true;
        if (button.setAttribute) button.setAttribute('aria-disabled', 'true');
        if (button.style) button.style.pointerEvents = 'none';
        if (button.dataset) button.dataset.tmRicochetVmControlsBlocked = '1';
      } else if (button.dataset && button.dataset.tmRicochetVmControlsBlocked === '1') {
        button.disabled = false;
        if (button.removeAttribute) button.removeAttribute('aria-disabled');
        if (button.style) button.style.pointerEvents = '';
        delete button.dataset.tmRicochetVmControlsBlocked;
      }
    }

    const playButton = findCustomVoicemailPlayButton(modal);
    if (!playButton) return;

    if (!available) {
      if (playButton.dataset && !Object.prototype.hasOwnProperty.call(playButton.dataset, 'tmRicochetVmOldDisplay')) {
        playButton.dataset.tmRicochetVmOldDisplay = playButton.style ? playButton.style.display || '' : '';
      }
      if (playButton.style) playButton.style.display = 'none';
      playButton.disabled = true;
      if (playButton.setAttribute) playButton.setAttribute('aria-disabled', 'true');
      if (playButton.dataset) playButton.dataset.tmRicochetVmControlsBlocked = '1';
      return;
    }

    if (playButton.dataset && playButton.dataset.tmRicochetVmControlsBlocked === '1') {
      if (playButton.style) playButton.style.display = playButton.dataset.tmRicochetVmOldDisplay || '';
      playButton.disabled = false;
      if (playButton.removeAttribute) playButton.removeAttribute('aria-disabled');
      delete playButton.dataset.tmRicochetVmControlsBlocked;
      delete playButton.dataset.tmRicochetVmOldDisplay;
    }
  }

  function isVoicemailSelectOptionPlaceholder(value) {
    const clean = normalizeSpace(value).toLowerCase();
    return clean === 'select option' || clean === 'choose';
  }

  function isVoicemailSelectCandidate(select) {
    if (!select || !select.matches || !select.matches('select')) return false;
    if (select.matches('select.vm_btn[ng-model="perfect_voicemail"]')) return true;

    const options = select.options ? [...select.options] : [];
    if (!options.length) return false;

    return options.some((option) => {
      const text = normalizeSpace(option.textContent || option.label || '');
      return getVoicemailCallCount(text) !== '';
    });
  }

  function applyVoicemailFilter() {
    const select = findVoicemailSelect();

    if (!select || !isVisible(select)) {
      if (applyCustomVoicemailFilter()) return;

      state.vmFilterSignature = '';
      state.vmAutoSelectSignature = '';
      state.vmAutoSelectLastAt = 0;
      clearVoicemailAutoSelectSettleTimer();
      return;
    }

    refreshVoicemailRouting(false);

    const vendor = getCurrentVendorForVoicemailFilter();
    const route = getVoicemailRouteForVendor(vendor);
    const voicemailAllowed = route.showReminder !== false;
    const requestedGroup = route.group;
    const optionStore = getVoicemailOptionStore(select);
    const items = optionStore.options.map((option) => {
      const originalText = getOriginalVoicemailOptionText(option);
      return {
        option,
        originalText,
        ...getVoicemailOptionMeta(originalText)
      };
    });

    const hasRequestedGroup = items.some((item) => !item.placeholder && item.group === requestedGroup);
    const blockMissingSheetGroup = route.fromSheet && requestedGroup !== DEFAULT_VM_GROUP && !hasRequestedGroup;
    const activeGroup = hasRequestedGroup || blockMissingSheetGroup ? requestedGroup : DEFAULT_VM_GROUP;
    const targetVmCount = getCurrentVoicemailTargetCount();
    const selectedOption = select.options[select.selectedIndex] || null;
    let selectedStillVisible = false;

    for (const item of items) {
      const matchesTargetVm = !!targetVmCount &&
        getVoicemailCallCount(item.originalText || item.displayText) === Number(targetVmCount);
      item.visible = item.placeholder ||
        (voicemailAllowed && !blockMissingSheetGroup && item.group === activeGroup && matchesTargetVm);

      if (item.visible) {
        setVoicemailOptionLabel(item.option, item.displayText);
      } else {
        restoreVoicemailOptionLabel(item.option);
      }

      if (item.option === selectedOption && item.visible) {
        selectedStillVisible = true;
      }
    }

    rebuildVoicemailSelectOptions(select, items);

    if (!selectedStillVisible) {
      selectPreferredVisibleVoicemailOption(select);
    }

    const signature = [
      normalizeVendorKey(vendor),
      requestedGroup,
      activeGroup,
      voicemailAllowed ? '' : 'voicemail-disabled',
      blockMissingSheetGroup ? 'blocked' : '',
      targetVmCount ? `vm-${targetVmCount}` : 'no-vm-needed',
      state.vmRoutesLoadedAt,
      items.map((item) => item.originalText).join('\u001f')
    ].join('|');

    if (voicemailAllowed && targetVmCount) {
      autoSelectVoicemailForCallCount(select, items, targetVmCount, `${signature}|${targetVmCount}`);
    }

    if (signature !== state.vmFilterSignature) {
      state.vmFilterSignature = signature;
      logVoicemailFilter(vendor, requestedGroup, activeGroup, blockMissingSheetGroup);
    }

  }

  function applyCustomVoicemailFilter() {
    const modal = findCustomVoicemailModal();
    if (!modal) return false;

    refreshVoicemailRouting(false);

    const button = findCustomVoicemailDropdownButton();
    let optionElements = getCustomVoicemailOptionElements();

    if (!optionElements.length && button) {
      clickElement(button);
      optionElements = getCustomVoicemailOptionElements();
    }

    const vendor = getCurrentVendorForVoicemailFilter();
    const route = getVoicemailRouteForVendor(vendor);
    const voicemailAllowed = route.showReminder !== false;
    const targetVmCount = getCurrentVoicemailTargetCount();

    if (!optionElements.length) {
      setCustomVoicemailControlsAvailable(modal, voicemailAllowed && !!targetVmCount);
      return true;
    }

    const requestedGroup = route.group;
    const items = optionElements.map((option) => {
      const originalText = getCustomVoicemailOptionText(option);
      return {
        option,
        originalText,
        ...getVoicemailOptionMeta(originalText)
      };
    });

    const hasRequestedGroup = items.some((item) => !item.placeholder && item.group === requestedGroup);
    const blockMissingSheetGroup = route.fromSheet && requestedGroup !== DEFAULT_VM_GROUP && !hasRequestedGroup;
    const activeGroup = hasRequestedGroup || blockMissingSheetGroup ? requestedGroup : DEFAULT_VM_GROUP;

    for (const item of items) {
      const matchesTargetVm = !!targetVmCount &&
        getVoicemailCallCount(item.originalText || item.displayText) === Number(targetVmCount);
      item.visible = voicemailAllowed && !blockMissingSheetGroup && item.group === activeGroup && matchesTargetVm;
      setCustomVoicemailOptionVisibility(item.option, item.visible);
    }

    const hasVisibleVoicemail = items.some((item) => item.visible);
    setCustomVoicemailControlsAvailable(modal, hasVisibleVoicemail);

    const signature = [
      'custom',
      normalizeVendorKey(vendor),
      requestedGroup,
      activeGroup,
      voicemailAllowed ? '' : 'voicemail-disabled',
      blockMissingSheetGroup ? 'blocked' : '',
      targetVmCount ? `vm-${targetVmCount}` : 'no-vm-needed',
      state.vmRoutesLoadedAt,
      items.map((item) => item.originalText).join('\u001f')
    ].join('|');

    if (voicemailAllowed && targetVmCount && hasVisibleVoicemail) {
      autoSelectCustomVoicemailForCallCount(items, targetVmCount, `${signature}|${targetVmCount}`);
    }

    if (signature !== state.vmFilterSignature) {
      state.vmFilterSignature = signature;
      logVoicemailFilter(vendor, requestedGroup, activeGroup, blockMissingSheetGroup);
    }

    return true;
  }

  function setCustomVoicemailOptionVisibility(option, visible) {
    const wrapper = getCustomVoicemailOptionWrapper(option);
    for (const el of [option, wrapper]) {
      if (!el || !el.style) continue;
      el.style.display = visible ? '' : 'none';
    }
  }

  function getCustomVoicemailOptionWrapper(option) {
    const parent = option && option.parentElement;
    return parent && parent.children && parent.children.length <= 2 ? parent : option;
  }

  function autoSelectCustomVoicemailForCallCount(items, targetCount, signature) {
    const targetItem = items.find((item) =>
      item.visible &&
      !item.placeholder &&
      getVoicemailCallCount(item.originalText || item.displayText) === Number(targetCount)
    );

    if (!targetItem || !targetItem.option) return false;

    const selectedText = getCustomVoicemailSelectedText();
    const selectedCount = getVoicemailCallCount(selectedText);
    const alreadySyncedSignature = state.vmAutoSelectSignature === signature;
    if (selectedCount === Number(targetCount)) {
      state.vmAutoSelectSignature = signature;
      state.vmAutoSelectLastAt = Date.now();
      if (state.activeSession && selectedText) {
        state.activeSession.payload.voicemailNameUsed = selectedText;
      }
      return true;
    }

    const recentScriptSelection = state.vmAutoSelectSignature === signature &&
      Date.now() - state.vmAutoSelectLastAt < 2000;

    if (selectedText && alreadySyncedSignature && !recentScriptSelection && selectedCount !== Number(targetCount)) {
      return false;
    }

    if (!clickElement(targetItem.option)) return false;

    state.vmAutoSelectSignature = signature;
    state.vmAutoSelectLastAt = Date.now();

    if (state.activeSession) {
      state.activeSession.payload.voicemailNameUsed = targetItem.displayText || targetItem.originalText || '';
      state.activeSession.payload.voicemailBoxOpened = 'Yes';
      state.activeSession.lastTouched = Date.now();
    }

    log(`Voicemail auto-selected for outbound ${targetCount}: ${targetItem.displayText || targetItem.originalText}`);
    return true;
  }

  function setVoicemailRoutingStatus(value) {
    state.vmRoutingStatus = normalizeSpace(value);
  }

  function refreshVoicemailRouting(force = false) {
    const url = getVoicemailRoutingUrl();
    const csvUrls = DEFAULT_VM_ROUTING_CSV_URLS.filter(Boolean);
    if (!url && !csvUrls.length) return;
    if (state.vmRoutingBusy && !force) return;

    const now = Date.now();
    if (!force && now - state.vmRoutingLastCheck < VM_ROUTING_REFRESH_MS) return;

    const requestId = state.vmRoutingRequestId + 1;
    state.vmRoutingRequestId = requestId;
    state.vmRoutingBusy = true;
    state.vmRoutingLastCheck = now;
    state.vmRoutingErrors = [];
    setVoicemailRoutingStatus(force ? 'force refreshing routing' : 'loading routing');

    if (force) {
      clearVoicemailRouting('force refresh');
      localStorage.removeItem(KEYS.vmRoutingCache);
    }

    const loadCsvFallback = (reason, index = 0, fallbackRoutes = null) => {
      if (requestId !== state.vmRoutingRequestId) return;

      if (index >= csvUrls.length) {
        state.vmRoutingBusy = false;
        if (Array.isArray(fallbackRoutes)) {
          addVoicemailRoutingError(`CSV fallback failed after ${reason}; using Apps Script routes without Show Reminder`);
          applyVoicemailRouting(fallbackRoutes, 'remote');
          return;
        }
        const errorSummary = getVoicemailRoutingErrorSummary(reason);
        setVoicemailRoutingStatus(`routing load failed: ${errorSummary}`);
        log(`Voicemail routing load failed: ${errorSummary}`);
        return;
      }

      const csvUrl = csvUrls[index];
      const sourceLabel = `Sheet CSV ${index + 1}`;
      setVoicemailRoutingStatus(`trying ${sourceLabel}`);

      GM_xmlhttpRequest({
        method: 'GET',
        url: addCacheBust(csvUrl),
        headers: getNoCacheHeaders(),
        timeout: 30000,
        onload: (res) => {
          if (requestId !== state.vmRoutingRequestId) return;

          if (res.status < 200 || res.status >= 300) {
            addVoicemailRoutingError(`${sourceLabel} HTTP ${res.status}: ${getRoutingResponsePreview(res.responseText)}`);
            log(`Voicemail routing ${sourceLabel} failed after ${reason}: HTTP ${res.status}`);
            loadCsvFallback(`${sourceLabel} HTTP ${res.status}`, index + 1, fallbackRoutes);
            return;
          }

          const routes = parseVoicemailRoutingCsv(res.responseText);
          if (!routes) {
            addVoicemailRoutingError(`${sourceLabel} invalid: ${getRoutingResponsePreview(res.responseText)}`);
            log(`Voicemail routing ${sourceLabel} failed after ${reason}: invalid response`);
            loadCsvFallback(`${sourceLabel} invalid response`, index + 1, fallbackRoutes);
            return;
          }

          state.vmRoutingBusy = false;
          applyVoicemailRouting(routes, sourceLabel);
        },
        onerror: () => {
          if (requestId !== state.vmRoutingRequestId) return;
          addVoicemailRoutingError(`${sourceLabel} network error`);
          log(`Voicemail routing ${sourceLabel} failed after ${reason}: network error`);
          loadCsvFallback(`${sourceLabel} network error`, index + 1, fallbackRoutes);
        },
        ontimeout: () => {
          if (requestId !== state.vmRoutingRequestId) return;
          addVoicemailRoutingError(`${sourceLabel} timeout`);
          log(`Voicemail routing ${sourceLabel} failed after ${reason}: timeout`);
          loadCsvFallback(`${sourceLabel} timeout`, index + 1, fallbackRoutes);
        }
      });
    };

    if (!url) {
      loadCsvFallback('no Apps Script URL');
      return;
    }

    GM_xmlhttpRequest({
      method: 'GET',
      url: addCacheBust(url),
      headers: getNoCacheHeaders(),
      timeout: 30000,
      onload: (res) => {
        if (requestId !== state.vmRoutingRequestId) return;

        if (res.status < 200 || res.status >= 300) {
          addVoicemailRoutingError(`Apps Script HTTP ${res.status}: ${getRoutingResponsePreview(res.responseText)}`);
          loadCsvFallback(`Apps Script HTTP ${res.status}`);
          return;
        }

        const body = safeJsonParse(res.responseText);
        if (!body || body.ok === false || !Array.isArray(body.routes)) {
          addVoicemailRoutingError(`Apps Script invalid: ${getRoutingResponsePreview(res.responseText)}`);
          loadCsvFallback('Apps Script invalid response');
          return;
        }

        if (!routesHaveReminderConfig(body.routes) && csvUrls.length) {
          addVoicemailRoutingError('Apps Script missing Show Reminder; trying Sheet CSV');
          loadCsvFallback('Apps Script missing Show Reminder', 0, body.routes);
          return;
        }

        state.vmRoutingBusy = false;
        applyVoicemailRouting(body.routes, 'remote');
      },
      onerror: () => {
        if (requestId !== state.vmRoutingRequestId) return;
        addVoicemailRoutingError('Apps Script network error');
        loadCsvFallback('Apps Script network error');
      },
      ontimeout: () => {
        if (requestId !== state.vmRoutingRequestId) return;
        addVoicemailRoutingError('Apps Script timeout');
        loadCsvFallback('Apps Script timeout');
      }
    });
  }

  function addVoicemailRoutingError(message) {
    const clean = normalizeSpace(message);
    if (clean) {
      state.vmRoutingErrors.push(clean);
    }
  }

  function getVoicemailRoutingErrorSummary(fallback) {
    const details = state.vmRoutingErrors.filter(Boolean);
    return details.length ? details.join(' / ') : fallback;
  }

  function getRoutingResponsePreview(text) {
    const clean = normalizeSpace(String(text || '').replace(/<[^>]+>/g, ' '));
    return clean ? clean.slice(0, 90) : 'empty response';
  }

  function clearVoicemailRouting(source) {
    state.vmRoutesByVendor = Object.create(null);
    state.vmRouteSourcesByVendor = Object.create(null);
    state.vmReminderByVendor = Object.create(null);
    state.vmRoutingSource = source || '';
    state.vmRoutesLoadedAt = Date.now();
    state.vmFilterSignature = '';
  }

  function getNoCacheHeaders() {
    return {
      'Cache-Control': 'no-cache, no-store, max-age=0',
      Pragma: 'no-cache',
      Expires: '0'
    };
  }

  function parseVoicemailRoutingCsv(text) {
    const rows = parseCsvRows(text);
    if (!rows.length) return null;

    const headers = rows[0].map((value) => normalizeSpace(value).toLowerCase());
    const vendorIndex = headers.indexOf('vendor');
    const groupIndex = headers.indexOf('group');
    const activeIndex = headers.indexOf('active');
    const showReminderIndex = headers.indexOf('show reminder');

    if (vendorIndex === -1 || groupIndex === -1) return null;

    const routes = [];

    for (const row of rows.slice(1)) {
      const vendor = normalizeSpace(row[vendorIndex] || '');
      const group = normalizeSpace(row[groupIndex] || '');
      const active = activeIndex === -1 ? 'TRUE' : row[activeIndex];

      if (!vendor || !group || !isActiveVoicemailRoute(active)) continue;

      routes.push({
        vendor,
        group,
        showReminder: showReminderIndex === -1
          ? DEFAULT_SHOW_REMINDER
          : parseShowReminderValue(row[showReminderIndex])
      });
    }

    return routes;
  }

  function parseCsvRows(text) {
    const rows = [];
    let row = [];
    let value = '';
    let inQuotes = false;

    for (let i = 0; i < String(text || '').length; i += 1) {
      const char = text[i];
      const next = text[i + 1];

      if (char === '"') {
        if (inQuotes && next === '"') {
          value += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }

      if (char === ',' && !inQuotes) {
        row.push(value);
        value = '';
        continue;
      }

      if ((char === '\n' || char === '\r') && !inQuotes) {
        if (char === '\r' && next === '\n') i += 1;
        row.push(value);
        if (row.some((cell) => normalizeSpace(cell))) rows.push(row);
        row = [];
        value = '';
        continue;
      }

      value += char;
    }

    row.push(value);
    if (row.some((cell) => normalizeSpace(cell))) rows.push(row);

    return rows;
  }

  function isActiveVoicemailRoute(value) {
    const clean = normalizeSpace(value).toLowerCase();
    return clean === 'true' || clean === 'yes' || clean === '1';
  }

  function parseShowReminderValue(value, defaultValue = DEFAULT_SHOW_REMINDER) {
    if (value === false) return false;
    if (value === true) return true;
    const clean = normalizeSpace(value).toLowerCase();
    if (!clean) return defaultValue;
    if (clean === 'false' || clean === 'no' || clean === 'n' || clean === '0' || clean === 'off' || clean === 'hide' || clean === 'hidden') return false;
    if (clean === 'true' || clean === 'yes' || clean === 'y' || clean === '1' || clean === 'on' || clean === 'show' || clean === 'shown') return true;
    return defaultValue;
  }

  function routesHaveReminderConfig(routes) {
    return Array.isArray(routes) && routes.some((route) =>
      route && Object.prototype.hasOwnProperty.call(route, 'showReminder')
    );
  }

  function applyVoicemailRouting(routes, source) {
    const routesByVendor = Object.create(null);
    const routeSourcesByVendor = Object.create(null);
    const reminderByVendor = Object.create(null);

    for (const route of routes) {
      if (!route || typeof route !== 'object') continue;

      const vendorKey = normalizeVendorKey(route.vendor);
      const group = normalizeVoicemailGroup(route.group);
      const hasShowReminder = Object.prototype.hasOwnProperty.call(route, 'showReminder');
      const showReminder = hasShowReminder
        ? parseShowReminderValue(route.showReminder)
        : DEFAULT_SHOW_REMINDER;

      if (vendorKey && group) {
        routesByVendor[vendorKey] = group;
        routeSourcesByVendor[vendorKey] = source;
        reminderByVendor[vendorKey] = showReminder;

        const compactVendorKey = normalizeVendorCompactKey(route.vendor);
        if (compactVendorKey && compactVendorKey !== vendorKey) {
          routesByVendor[compactVendorKey] = group;
          routeSourcesByVendor[compactVendorKey] = source;
          reminderByVendor[compactVendorKey] = showReminder;
        }
      }
    }

    state.vmRoutesByVendor = routesByVendor;
    state.vmRouteSourcesByVendor = routeSourcesByVendor;
    state.vmReminderByVendor = reminderByVendor;
    state.vmRoutingSource = source;
    state.vmRoutesLoadedAt = Date.now();
    state.vmFilterSignature = '';

    saveVoicemailRoutingCache(routes);
    setVoicemailRoutingStatus(`loaded from ${source}; Commercial=${getLoadedCommercialGroupLabel()}`);
    log(`Voicemail routing loaded from ${source}: ${Object.keys(routesByVendor).length} active route(s)`);
  }

  function getLoadedCommercialGroupLabel() {
    return state.vmRoutesByVendor[normalizeVendorKey('Commercial_WC_Contractors')] || 'missing';
  }

  function loadVoicemailRoutingCache() {
    const cached = loadVoicemailRoutingCachePayload();
    if (!cached || !Array.isArray(cached.routes)) return;

    const routesByVendor = Object.create(null);
    const routeSourcesByVendor = Object.create(null);
    const reminderByVendor = Object.create(null);

    for (const route of cached.routes) {
      const vendorKey = normalizeVendorKey(route && route.vendor);
      const group = normalizeVoicemailGroup(route && route.group);
      const hasShowReminder = route && Object.prototype.hasOwnProperty.call(route, 'showReminder');
      const showReminder = hasShowReminder
        ? parseShowReminderValue(route && route.showReminder)
        : DEFAULT_SHOW_REMINDER;

      if (vendorKey && group) {
        routesByVendor[vendorKey] = group;
        routeSourcesByVendor[vendorKey] = 'cache';
        reminderByVendor[vendorKey] = showReminder;

        const compactVendorKey = normalizeVendorCompactKey(route && route.vendor);
        if (compactVendorKey && compactVendorKey !== vendorKey) {
          routesByVendor[compactVendorKey] = group;
          routeSourcesByVendor[compactVendorKey] = 'cache';
          reminderByVendor[compactVendorKey] = showReminder;
        }
      }
    }

    state.vmRoutesByVendor = routesByVendor;
    state.vmRouteSourcesByVendor = routeSourcesByVendor;
    state.vmReminderByVendor = reminderByVendor;
    state.vmRoutingSource = 'cache';
    state.vmRoutesLoadedAt = Number(cached.loadedAt) || 0;
    state.vmRoutingStatus = `loaded from cache; Commercial=${getLoadedCommercialGroupLabel()}`;
  }

  function loadVoicemailRoutingCachePayload() {
    try {
      const raw = localStorage.getItem(KEYS.vmRoutingCache);
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch (_) {
      return null;
    }
  }

  function saveVoicemailRoutingCache(routes) {
    try {
      localStorage.setItem(KEYS.vmRoutingCache, JSON.stringify({
        loadedAt: state.vmRoutesLoadedAt || Date.now(),
        routes: Array.isArray(routes) ? routes : []
      }));
    } catch (_) {}
  }

  function getVoicemailRouteForVendor(vendor) {
    const vendorKey = normalizeVendorKey(vendor);
    const compactVendorKey = normalizeVendorCompactKey(vendor);
    const matchedKey =
      vendorKey && state.vmRoutesByVendor[vendorKey]
        ? vendorKey
        : compactVendorKey && state.vmRoutesByVendor[compactVendorKey]
          ? compactVendorKey
          : '';

    if (matchedKey) {
      return {
        group: state.vmRoutesByVendor[matchedKey],
        showReminder: state.vmReminderByVendor[matchedKey] !== false,
        fromSheet: true,
        source: state.vmRouteSourcesByVendor[matchedKey] || state.vmRoutingSource || 'route'
      };
    }

    return {
      group: DEFAULT_VM_GROUP,
      showReminder: DEFAULT_SHOW_REMINDER,
      fromSheet: false,
      source: 'default'
    };
  }

  function getCurrentVendorForVoicemailFilter() {
    const freshVendor = buildCurrentPayload().vendor || '';
    if (normalizeSpace(freshVendor)) {
      return freshVendor;
    }

    const activeVendor = state.activeSession && state.activeSession.payload
      ? state.activeSession.payload.vendor
      : '';

    if (normalizeSpace(activeVendor)) {
      return activeVendor;
    }

    return buildCurrentPayload().vendor || '';
  }

  function getVoicemailRoutingUrl() {
    return (localStorage.getItem(KEYS.vmRoutingUrl) || DEFAULT_VM_ROUTING_URL || '').trim();
  }

  function addCacheBust(url) {
    const joiner = url.includes('?') ? '&' : '?';
    return `${url}${joiner}t=${Date.now()}`;
  }

  function setVoicemailRoutingUrl() {
    const value = window.prompt('Paste your deployed Voicemail Routing Apps Script Web App URL', getVoicemailRoutingUrl());
    if (value === null) return;

    const clean = value.trim();
    if (clean) {
      localStorage.setItem(KEYS.vmRoutingUrl, clean);
      log('Voicemail Routing URL saved');
    } else {
      localStorage.removeItem(KEYS.vmRoutingUrl);
      localStorage.removeItem(KEYS.vmRoutingCache);
      state.vmRoutesByVendor = Object.create(null);
      state.vmRoutesLoadedAt = 0;
      state.vmFilterSignature = '';
      log('Voicemail Routing URL cleared; using Sheet CSV fallback');
      return;
    }

    refreshVoicemailRouting(true);
  }

  function getOriginalVoicemailOptionText(option) {
    rememberOriginalVoicemailOption(option);
    return normalizeSpace(option.dataset[VM_ORIGINAL_TEXT_DATA] || option.textContent || '');
  }

  function getVoicemailOptionStore(select) {
    let store = state.vmOptionStores.get(select);
    const currentOptions = [...select.options];
    const shouldRefresh =
      !store ||
      currentOptions.length > store.options.length ||
      currentOptions.some((option) => !store.optionSet.has(option));

    if (shouldRefresh) {
      const options = currentOptions.map((option) => {
        rememberOriginalVoicemailOption(option);
        return option;
      });

      store = {
        options,
        optionSet: new Set(options)
      };

      state.vmOptionStores.set(select, store);
    }

    return store;
  }

  function rememberOriginalVoicemailOption(option) {
    if (!option || !option.dataset) return;

    if (!Object.prototype.hasOwnProperty.call(option.dataset, VM_ORIGINAL_TEXT_DATA)) {
      option.dataset[VM_ORIGINAL_TEXT_DATA] = normalizeSpace(option.textContent || '');
    }

    if (!Object.prototype.hasOwnProperty.call(option.dataset, VM_HAD_LABEL_DATA)) {
      option.dataset[VM_HAD_LABEL_DATA] = option.hasAttribute('label') ? '1' : '0';
      option.dataset[VM_ORIGINAL_LABEL_DATA] = option.getAttribute('label') || '';
    }
  }

  function getVoicemailOptionMeta(text) {
    const clean = normalizeSpace(text);

    if (isVoicemailPlaceholder(clean)) {
      return {
        placeholder: true,
        group: '',
        displayText: clean
      };
    }

    const dashIndex = clean.indexOf('-');
    if (dashIndex > 0) {
      const prefix = normalizeSpace(clean.slice(0, dashIndex));
      const rest = normalizeSpace(clean.slice(dashIndex + 1));

      if (rest && isValidVoicemailGroupPrefix(prefix)) {
        const group = normalizeVoicemailGroup(prefix);
        return {
          placeholder: false,
          group,
          displayText: group === DEFAULT_VM_GROUP
            ? normalizeSpace(`${DEFAULT_VM_GROUP_LABEL} ${rest}`)
            : clean
        };
      }
    }

    return {
      placeholder: false,
      group: DEFAULT_VM_GROUP,
      displayText: clean
    };
  }

  function isValidVoicemailGroupPrefix(value) {
    const clean = normalizeSpace(value);
    return !!clean && !/\s/.test(clean);
  }

  function normalizeVoicemailGroup(value) {
    return normalizeSpace(value).toLowerCase();
  }

  function normalizeVendorKey(value) {
    return normalizeSpace(value).toLowerCase();
  }

  function normalizeVendorCompactKey(value) {
    return normalizeVendorKey(value).replace(/[^a-z0-9]/g, '');
  }

  function isVoicemailPlaceholder(value) {
    return normalizeSpace(value).toLowerCase() === 'choose';
  }

  function setVoicemailOptionVisibility(option, visible) {
    option.hidden = !visible;
    option.disabled = !visible;
    option.style.display = visible ? '' : 'none';
  }

  function setVoicemailOptionLabel(option, label) {
    rememberOriginalVoicemailOption(option);
    const clean = normalizeSpace(label);
    option.textContent = clean;
    option.setAttribute('label', clean);
  }

  function restoreVoicemailOptionLabel(option) {
    rememberOriginalVoicemailOption(option);
    option.textContent = option.dataset[VM_ORIGINAL_TEXT_DATA] || option.textContent || '';

    if (option.dataset[VM_HAD_LABEL_DATA] === '1') {
      option.setAttribute('label', option.dataset[VM_ORIGINAL_LABEL_DATA] || '');
      return;
    }

    option.removeAttribute('label');
  }

  function rebuildVoicemailSelectOptions(select, items) {
    const fragment = document.createDocumentFragment();

    for (const item of items) {
      setVoicemailOptionVisibility(item.option, item.visible);

      if (item.visible) {
        fragment.appendChild(item.option);
      }
    }

    select.replaceChildren(fragment);
  }

  function selectPreferredVisibleVoicemailOption(select) {
    const options = [...select.options];
    const visibleOptions = options.filter((option) => !option.hidden && !option.disabled);
    const preferred =
      visibleOptions.find((option) => isVoicemailPlaceholder(getOriginalVoicemailOptionText(option))) ||
      visibleOptions[0];

    if (preferred) {
      select.selectedIndex = options.indexOf(preferred);
    }
  }

  function getCurrentVoicemailTargetCount() {
    const fresh = buildCurrentPayload();
    const freshOutbound = fresh.outboundCallAmount;
    const sessionOutbound = state.activeSession && state.activeSession.payload
      ? state.activeSession.payload.outboundCallAmount
      : '';
    const count = normalizeOutboundForSend(
      freshOutbound !== '' && freshOutbound != null ? freshOutbound : sessionOutbound
    );

    return VM_COUNTS.has(Number(count)) ? Number(count) : '';
  }

  function autoSelectVoicemailForCallCount(select, items, targetCount, signature) {
    const targetItem = items.find((item) =>
      item.visible &&
      !item.placeholder &&
      getVoicemailCallCount(item.originalText || item.displayText) === Number(targetCount)
    );

    if (!targetItem || !targetItem.option) return false;

    const selectedOption = select.options[select.selectedIndex] || null;
    const alreadySyncedSignature = state.vmAutoSelectSignature === signature;
    if (selectedOption === targetItem.option) {
      state.vmAutoSelectSignature = signature;
      state.vmAutoSelectLastAt = Date.now();
      if (!alreadySyncedSignature) {
        syncSelectedVoicemailWithRicochet(select, targetItem.option, targetCount);
      }
      return true;
    }

    const selectedText = selectedOption ? getOriginalVoicemailOptionText(selectedOption) : '';
    const selectedIsPlaceholder = isVoicemailPlaceholder(selectedText);
    const selectedCount = getVoicemailCallCount(selectedText);
    const recentScriptSelection = state.vmAutoSelectSignature === signature &&
      Date.now() - state.vmAutoSelectLastAt < 2000;

    if (!selectedIsPlaceholder && state.vmAutoSelectSignature === signature && !recentScriptSelection && selectedCount !== Number(targetCount)) {
      return false;
    }

    if (!selectVoicemailOption(select, targetItem.option)) return false;
    state.vmAutoSelectSignature = signature;
    state.vmAutoSelectLastAt = Date.now();
    captureSelectedVoicemailName();
    syncSelectedVoicemailWithRicochet(select, targetItem.option, targetCount);
    scheduleVoicemailAutoSelectSettle(select, targetItem.option, signature, targetCount);
    log(`Voicemail auto-selected for outbound ${targetCount}: ${getVoicemailOptionDisplayText(targetItem.option)}`);
    return true;
  }

  function selectVoicemailOption(select, option) {
    const options = [...select.options];
    const nextIndex = options.indexOf(option);
    if (nextIndex < 0) return false;

    for (const item of options) {
      item.selected = false;
    }

    option.selected = true;
    select.selectedIndex = nextIndex;

    if (option.value != null) {
      select.value = option.value;
    }

    return select.selectedIndex === nextIndex;
  }

  function scheduleVoicemailAutoSelectSettle(select, option, signature, targetCount) {
    clearVoicemailAutoSelectSettleTimer();

    state.vmAutoSelectSettleTimer = setTimeout(() => {
      state.vmAutoSelectSettleTimer = null;

      if (!isVisible(select)) return;
      if (![...select.options].includes(option)) return;

      const selectedOption = select.options[select.selectedIndex] || null;
      const selectedCount = selectedOption ? getVoicemailCallCount(getOriginalVoicemailOptionText(selectedOption)) : '';
      if (selectedOption === option && selectedCount === Number(targetCount)) return;

      if (!selectVoicemailOption(select, option)) return;

      state.vmAutoSelectSignature = signature;
      state.vmAutoSelectLastAt = Date.now();
      captureSelectedVoicemailName();
      syncSelectedVoicemailWithRicochet(select, option, targetCount);
      log(`Voicemail auto-select settled for outbound ${targetCount}: ${getVoicemailOptionDisplayText(option)}`);
    }, 150);
  }

  function syncSelectedVoicemailWithRicochet(select, option, targetCount) {
    dispatchVoicemailSelectEvents(select);
    if (Number(targetCount) === 2) {
      syncAngularVoicemailModel(select, option);
    }
  }

  function dispatchVoicemailSelectEvents(select) {
    const view = select && select.ownerDocument && select.ownerDocument.defaultView;
    const EventCtor = view && typeof view.Event === 'function' ? view.Event : Event;
    select.dispatchEvent(new EventCtor('input', { bubbles: true, cancelable: true }));
    select.dispatchEvent(new EventCtor('change', { bubbles: true, cancelable: true }));
  }

  function syncAngularVoicemailModel(select, option) {
    const view = select && select.ownerDocument && select.ownerDocument.defaultView;
    const angular = view && view.angular;
    const modelPath = normalizeSpace(select && select.getAttribute && select.getAttribute('ng-model'));

    if (!angular || typeof angular.element !== 'function' || !modelPath) return false;

    const wrapped = angular.element(select);
    const scope = getAngularScope(wrapped);
    if (!scope) return false;

    const value = option && option.value != null ? option.value : select.value;
    if (!assignScopePath(scope, modelPath, value)) return false;

    if (wrapped && typeof wrapped.triggerHandler === 'function') {
      wrapped.triggerHandler('change');
    }

    if (typeof scope.$applyAsync === 'function') {
      scope.$applyAsync();
    } else if (typeof scope.$apply === 'function' && !scope.$$phase) {
      scope.$apply();
    } else if (typeof scope.$digest === 'function' && !scope.$$phase) {
      scope.$digest();
    }

    return true;
  }

  function getAngularScope(wrapped) {
    if (!wrapped) return null;
    if (typeof wrapped.scope === 'function') {
      const scope = wrapped.scope();
      if (scope) return scope;
    }
    if (typeof wrapped.isolateScope === 'function') {
      return wrapped.isolateScope();
    }
    return null;
  }

  function assignScopePath(scope, path, value) {
    const parts = normalizeSpace(path).split('.').filter(Boolean);
    if (!parts.length || parts.some((part) => !/^[A-Za-z_$][\w$]*$/.test(part))) {
      return false;
    }

    let cursor = scope;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const part = parts[i];
      if (!cursor[part] || typeof cursor[part] !== 'object') {
        cursor[part] = {};
      }
      cursor = cursor[part];
    }

    cursor[parts[parts.length - 1]] = value;
    return true;
  }

  function clearVoicemailAutoSelectSettleTimer() {
    if (!state.vmAutoSelectSettleTimer) return;
    clearTimeout(state.vmAutoSelectSettleTimer);
    state.vmAutoSelectSettleTimer = null;
  }

  function getVoicemailCallCount(text) {
    const clean = normalizeSpace(text);
    const dashIndex = clean.indexOf('-');
    const label = dashIndex > 0 ? normalizeSpace(clean.slice(dashIndex + 1)) : clean;
    const match =
      label.match(/\bcall\s*[-#]?\s*0*(\d+)\b/i) ||
      label.match(/\b0*(\d+)\s*vm\b/i);

    if (!match) return '';

    const count = Number(match[1]);
    return VM_COUNTS.has(count) ? count : '';
  }

  function getVoicemailOptionDisplayText(option) {
    if (!option) return '';
    return normalizeSpace(option.label || option.textContent || '');
  }

  function logVoicemailFilter(vendor, requestedGroup, activeGroup, blockMissingSheetGroup) {
    if (blockMissingSheetGroup) {
      const vendorLabel = normalizeSpace(vendor) || 'no vendor';
      log(`Voicemail filter: ${vendorLabel} -> ${requestedGroup} (no matching voicemails found)`);
      return;
    }

    const fallbackLabel = activeGroup === DEFAULT_VM_GROUP ? DEFAULT_VM_GROUP_LABEL : activeGroup;
    const fallbackReason =
      requestedGroup && requestedGroup !== DEFAULT_VM_GROUP && activeGroup === DEFAULT_VM_GROUP
        ? ` (fallback from ${requestedGroup})`
        : '';
    const vendorLabel = normalizeSpace(vendor) || 'no vendor';

    log(`Voicemail filter: ${vendorLabel} -> ${fallbackLabel}${fallbackReason}`);
  }

  function captureSelectedVoicemailName() {
    if (!state.activeSession) return;

    const customText = getCustomVoicemailSelectedText();
    if (customText) {
      state.activeSession.payload.voicemailNameUsed = customText;
      return;
    }

    const select = findVoicemailSelect();
    if (!select || !isVisible(select)) return;

    const optionText = getVoicemailOptionDisplayText(select.options[select.selectedIndex]);
    if (optionText && optionText.toLowerCase() !== 'choose') {
      state.activeSession.payload.voicemailNameUsed = optionText;
    }
  }

  function getVoicemailToggleElement(target) {
    if (!target || !target.closest) return null;
    return target.closest(VM_TOGGLE_SELECTOR);
  }

  function getVoicemailSelectElement(target) {
    if (!target) return null;
    const select = target.closest ? target.closest('select') : target;
    if (!select || !select.matches || !select.matches('select')) return null;
    return isVoicemailSelectCandidate(select) ? select : null;
  }

  function getPlayVmElement(target) {
    if (!target || !target.closest) return null;
    const customPlay = target.closest('#modalCallPerfectVoicemail button');
    if (customPlay && normalizeSpace(customPlay.textContent).toLowerCase() === 'play') {
      return customPlay;
    }

    return target.closest(VM_PLAY_SELECTOR);
  }

  function getStatusButtonElement(target) {
    if (!target || !target.closest) return null;
    return target.closest('button[ng-click*="triggerHotKeysStatusLead"]');
  }

  function getStatusButtonText(button) {
    if (!button) return '';
    const clone = button.cloneNode(true);
    clone.querySelectorAll('.badge').forEach((el) => el.remove());
    return normalizeSpace(clone.textContent || '');
  }

  function updateBadgeFromSession() {
    if (!state.badge) return;

    if (!state.activeSession || state.activeSession.sent) {
      hideBadge();
      return;
    }

    if (!state.activeSession.isCallOpen) {
      hideBadge();
      return;
    }

    const outbound = normalizeOutboundForSend(state.activeSession.payload.outboundCallAmount);
    if (VM_COUNTS.has(Number(outbound))) {
      const route = getVoicemailRouteForVendor(state.activeSession.payload.vendor || '');
      if (route.showReminder === false) {
        hideBadge();
        return;
      }

      state.badge.textContent = 'Remember to Leave a Voicemail';
      state.badge.style.background = 'linear-gradient(180deg, #ef2b2b 0%, #ca1515 100%)';
      state.badge.style.display = 'flex';
      return;
    }

    hideBadge();
  }

  function createBadge() {
    const badge = document.createElement('div');
    badge.id = 'tm-ricochet-state-badge-v1';
    badge.style.cssText = [
      'position:fixed',
      'right:12px',
      'top:50%',
      'transform:translateY(-50%)',
      'z-index:2147483647',
      'width:300px',
      'min-height:74px',
      'padding:16px 18px',
      'border-radius:14px',
      'box-shadow:0 10px 24px rgba(0,0,0,.35)',
      'border:1px solid rgba(255,255,255,.22)',
      'display:none',
      'align-items:center',
      'justify-content:center',
      'text-align:center',
      'font:700 24px/1.15 Arial,sans-serif',
      'color:#fff',
      'user-select:none',
      'pointer-events:none',
      'box-sizing:border-box'
    ].join(';');

    document.body.appendChild(badge);
    state.badge = badge;
  }

  function hideBadge() {
    if (!state.badge) return;
    state.badge.style.display = 'none';
    state.badge.textContent = '';
  }

  function getCallerName() {
    return normalizeSpace(GM_getValue('callerName', DEFAULT_SDR_NAME) || DEFAULT_SDR_NAME);
  }

  function promptForCallerName(force = false) {
    const existing = getCallerName();

    if (existing && !force) return existing;

    const value = window.prompt('Enter SDR Name (saved in Tampermonkey)', existing || DEFAULT_SDR_NAME);
    const clean = normalizeSpace(value || '');

    if (clean) {
      GM_setValue('callerName', clean);
      log(`SDR Name saved: ${clean}`);
      return clean;
    }

    return existing || DEFAULT_SDR_NAME;
  }

  function promptForCallerNameIfMissing() {
    if (getCallerName()) return;
    promptForCallerName(false);
  }

  function getWebAppUrl() {
    return (localStorage.getItem(KEYS.url) || DEFAULT_WEB_APP_URL || '').trim();
  }

  function setWebAppUrl() {
    const value = window.prompt('Paste your deployed Apps Script Web App URL', getWebAppUrl());
    if (value === null) return;

    const clean = value.trim();
    localStorage.setItem(KEYS.url, clean || DEFAULT_WEB_APP_URL);
    log(clean ? 'Web App URL saved' : 'Web App URL reset to default');
  }

  function normalizeOutboundForSend(value) {
    const n = toInt(value);
    return Number.isFinite(n) ? n : '';
  }

  function getManualDialNumber() {
    const input = document.querySelector('#stc-bottom-dialpad');
    const raw = normalizeSpace(input ? input.value : '');
    return normalizePhone(raw);
  }

  function loadQueue() {
    try {
      const raw = localStorage.getItem(KEYS.queue);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  function saveQueue(queue) {
    localStorage.setItem(KEYS.queue, JSON.stringify(queue));
  }

  function loadRecentSendSignatures() {
    try {
      const raw = localStorage.getItem(KEYS.recent);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function saveRecentSendSignatures(map) {
    localStorage.setItem(KEYS.recent, JSON.stringify(map));
  }

  function pruneRecentSendSignatures(map) {
    const now = Date.now();

    for (const key of Object.keys(map)) {
      const ts = Number(map[key]);
      if (!Number.isFinite(ts) || now - ts > SEND_COOLDOWN_MS) {
        delete map[key];
      }
    }

    return map;
  }

  function buildSendSignature(payload) {
    const sdr = normalizeSpace(payload && payload.sdrName).toLowerCase();
    const lead = getLeadKey(payload);
    return sdr || lead ? `${sdr}|${lead}` : '';
  }

  function wasRecentlyQueued(payload) {
    const signature = buildSendSignature(payload);
    if (!signature) return false;

    const recent = pruneRecentSendSignatures(loadRecentSendSignatures());
    saveRecentSendSignatures(recent);

    const recentTs = Number(recent[signature]);
    return Number.isFinite(recentTs) && Date.now() - recentTs < SEND_COOLDOWN_MS;
  }

  function enqueue(payload) {
    const queue = loadQueue();
    const signature = buildSendSignature(payload);

    if (signature) {
      const recent = pruneRecentSendSignatures(loadRecentSendSignatures());
      const recentTs = Number(recent[signature]);

      if (Number.isFinite(recentTs) && Date.now() - recentTs < SEND_COOLDOWN_MS) {
        saveRecentSendSignatures(recent);
        log('Duplicate payload ignored (10s cooldown)');
        return false;
      }

      if (queue.some((item) => item && item.signature === signature)) {
        saveRecentSendSignatures(recent);
        log('Duplicate payload ignored (already queued)');
        return false;
      }

      recent[signature] = Date.now();
      saveRecentSendSignatures(recent);
    }

    queue.push({
      id: `q_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
      attempts: 0,
      createdAt: Date.now(),
      signature,
      payload
    });

    saveQueue(queue);
    log(`Queued: ${payload.name || payload.number || payload.email || 'lead'} | queue ${queue.length}`);
    return true;
  }

  function processQueue(force = false) {
    if (state.queueBusy) return;
    if (!force && !state.running) return;

    const url = getWebAppUrl();
    if (!url) return;

    const queue = loadQueue();
    if (!queue.length) return;

    state.queueBusy = true;
    sendNext(url);
  }

  function sendNext(url) {
    const queue = loadQueue();
    if (!queue.length) {
      state.queueBusy = false;
      return;
    }

    const item = queue[0];
    const outboundPayload = sanitizePayloadForSend(item.payload);

    GM_xmlhttpRequest({
      method: 'POST',
      url,
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify(outboundPayload),
      timeout: 30000,
      onload: (res) => {
        const body = safeJsonParse(res.responseText);

        if (res.status >= 200 && res.status < 300 && (!body || body.ok !== false)) {
          const next = loadQueue();
          next.shift();
          saveQueue(next);
          log(`Sent: ${item.payload.name || item.payload.number || item.payload.email || 'lead'}`);
          state.queueBusy = false;
          return;
        }

        retryQueue(`HTTP ${res.status} | ${String(res.responseText || '').slice(0, 200)}`);
      },
      onerror: () => retryQueue('Network error'),
      ontimeout: () => retryQueue('Timeout')
    });
  }

  function sanitizePayloadForSend(payload) {
    const clean = payload && typeof payload === 'object' ? { ...payload } : {};
    clean.address = OUTBOUND_ADDRESS_PLACEHOLDER;
    return clean;
  }

  function retryQueue(reason) {
    const queue = loadQueue();
    if (!queue.length) {
      state.queueBusy = false;
      return;
    }

    queue[0].attempts = (queue[0].attempts || 0) + 1;
    saveQueue(queue);
    log(`Send failed: ${reason} | retry ${queue[0].attempts}`);

    const wait = Math.min(15000, 1000 * queue[0].attempts);
    setTimeout(() => {
      state.queueBusy = false;
    }, wait);
  }

  function registerMenuCommandSafe(name, fn) {
    try {
      GM_registerMenuCommand(name, fn);
    } catch (_) {}
  }

  function registerMenu() {
    registerMenuCommandSafe('Set Web App URL', setWebAppUrl);
    registerMenuCommandSafe('Set Voicemail Routing URL', setVoicemailRoutingUrl);
    registerMenuCommandSafe('Refresh Voicemail Routing', () => refreshVoicemailRouting(true));
    registerMenuCommandSafe('Set / Change SDR Name', () => promptForCallerName(true));
    registerMenuCommandSafe('Start', startRunning);
    registerMenuCommandSafe('Stop', stopRunning);
    registerMenuCommandSafe('Flush Queue', () => processQueue(true));
  }

  function startRunning() {
    sessionStorage.removeItem(KEYS.stop);
    state.running = true;
    log('Running');
  }

  function stopRunning() {
    sessionStorage.setItem(KEYS.stop, '1');
    state.running = false;
    clearActiveSession('stopped_for_page_session');
    state.callWasOpen = false;
    state.closeMisses = 0;
    hideBadge();
    log('Stopped for this page session');
  }

  function formatCaliforniaDate(value) {
    const d = value instanceof Date ? value : new Date(value);
    if (!d || Number.isNaN(d.getTime())) return '';

    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: CALIFORNIA_TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).formatToParts(d);

    const map = {};
    for (const part of parts) {
      if (part.type !== 'literal') {
        map[part.type] = part.value;
      }
    }

    return `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}:${map.second}`;
  }

  function firstText(root, selectors) {
    for (const selector of selectors) {
      const el = root.querySelector(selector);
      const text = normalizeSpace(el ? el.textContent : '');
      if (text) return text;
    }
    return '';
  }

  function stripLabel(value, label) {
    return normalizeSpace(String(value || '').replace(new RegExp(`^${escapeRegExp(label)}\\s*:\\s*`, 'i'), ''));
  }

  function normalizePhone(value) {
    return String(value || '').replace(/[^\d]/g, '');
  }

  function cleanAddress(value) {
    return normalizeSpace(String(value || '').replace(/\s*,\s*/g, ', '));
  }

  function toInt(value) {
    const n = Number(String(value == null ? '' : value).replace(/[^\d-]/g, ''));
    return Number.isFinite(n) ? n : '';
  }

  function normalizeSpace(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function safeJsonParse(text) {
    try {
      return JSON.parse(text);
    } catch (_) {
      return null;
    }
  }

  function clickElement(el) {
    if (!el) return false;

    try {
      if (typeof el.click === 'function') {
        el.click();
        return true;
      }
    } catch (_) {}

    try {
      const view = (el.ownerDocument && el.ownerDocument.defaultView) || window;
      const EventCtor = view.MouseEvent || view.Event || Event;
      el.dispatchEvent(new EventCtor('click', { bubbles: true, cancelable: true, view }));
      return true;
    } catch (_) {
      return false;
    }
  }

  function isVisible(el) {
    if (!el || !(el instanceof Element)) return false;
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function log(message) {
    console.log('[Ricochet Lead Watcher]', message);
  }
})();
