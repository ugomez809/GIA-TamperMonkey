// ==UserScript==
// @name         Ricochet VoiceMail Lead Watcher
// @namespace    GIA.INC
// @version      1.64
// @description  Assists SDRs to be reminded of when to leave a voicemail.
// @author       JKira & Mr.G
// @match        https://giainc.ricochet.me/*
// @updateURL    https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/Ricochet%20TM/ricochet-voicemail-lead-watcher.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/Ricochet%20TM/ricochet-voicemail-lead-watcher.user.js
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      script.google.com
// @connect      script.googleusercontent.com
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const DEFAULT_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbxxPdfKXKPbhBTUg2mlM9ZP3CpO70_gGMSYpNY8AQ5Ikn7SFPZez7-J954KfnqnlXTtng/exec';
  const DEFAULT_SDR_NAME = '';
  const LOOP_MS = 250;
  const CLOSE_CONFIRM_MISSES = 2;
  const CALIFORNIA_TZ = 'America/Los_Angeles';
  const VM_COUNTS = new Set([2, 5, 8, 11, 14, 18, 22, 26, 30, 34, 37, 40]);
  const SEND_COOLDOWN_MS = 10000;
  const SEND_DELAY_MS = 3000;
  const OUTBOUND_ADDRESS_PLACEHOLDER = '.';

  const KEYS = {
    url: 'tm_ricochet_webapp_url_v1',
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
    loopHandle: null
  };

  init();

  function init() {
    if (!localStorage.getItem(KEYS.url)) {
      localStorage.setItem(KEYS.url, DEFAULT_WEB_APP_URL);
    }

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

    processQueue();
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

    const optionText = normalizeSpace(select.options[select.selectedIndex]?.text || '');
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

    const name = normalizeSpace(payload.name).toLowerCase();
    if (name) return `name:${name}`;

    const email = normalizeSpace(payload.email).toLowerCase();
    if (email) return `email:${email}`;

    const number = normalizePhone(payload.number);
    if (number) return `number:${number}`;

    const address = normalizeSpace(payload.address).toLowerCase();
    if (address) return `address:${address}`;

    return '';
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
    const root = document.querySelector('#btn-container.new-keypadwrap');
    if (!isVisible(root)) return false;

    const hangupButtons = document.querySelectorAll(
      'button.btn.btn-danger[ng-click*="hangup"], button.btn.btn-danger[ng-click*="transferandhangup"]'
    );

    for (const btn of hangupButtons) {
      if (isVisible(btn) && !btn.classList.contains('ng-hide')) {
        return true;
      }
    }

    const timerWrap = document.querySelector('#new-call-timer');
    if (isVisible(timerWrap)) {
      const timerText = normalizeSpace(timerWrap.textContent || '');
      if (timerText) return true;
    }

    return false;
  }

  function isVoicemailWindowOpen() {
    const select = document.querySelector('select.vm_btn[ng-model="perfect_voicemail"]');
    const playBtn = document.querySelector('button.vm_btn[ng-click*="playVm"]');
    return isVisible(select) || isVisible(playBtn);
  }

  function captureSelectedVoicemailName() {
    if (!state.activeSession) return;

    const select = document.querySelector('select.vm_btn[ng-model="perfect_voicemail"]');
    if (!select || !isVisible(select)) return;

    const optionText = normalizeSpace(select.options[select.selectedIndex]?.text || '');
    if (optionText && optionText.toLowerCase() !== 'choose') {
      state.activeSession.payload.voicemailNameUsed = optionText;
    }
  }

  function getVoicemailToggleElement(target) {
    if (!target || !target.closest) return null;
    return target.closest('div.btn.btn-info.new-keypadstyle[ng-click*="toggleVoicemailWindow"]');
  }

  function getVoicemailSelectElement(target) {
    if (!target || !target.matches) return null;
    return target.matches('select.vm_btn[ng-model="perfect_voicemail"]') ? target : null;
  }

  function getPlayVmElement(target) {
    if (!target || !target.closest) return null;
    return target.closest('button.vm_btn[ng-click*="playVm"]');
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
