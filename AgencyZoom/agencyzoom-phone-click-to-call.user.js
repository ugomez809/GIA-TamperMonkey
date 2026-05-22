// ==UserScript==
// @name         LOCAL AgencyZoom Pipeline Click-to-Call
// @namespace    local.agencyzoom.pipeline-click-to-call
// @version      2.8
// @description  Adds small AgencyZoom-style action icons under each pipeline card producer area. Phone click-to-call works; note edits/starts pinned notes; SMS/email open the matching AgencyZoom composer.
// @match        https://app.agencyzoom.com/*
// @exclude      https://app.agencyzoom.com/login*
// @run-at       document-idle
// @grant        none
// @updateURL    https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/refs/heads/main/AgencyZoom/agencyzoom-phone-click-to-call.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/refs/heads/main/AgencyZoom/agencyzoom-phone-click-to-call.user.js
// ==/UserScript==

(function () {
  'use strict';

  const VERSION = '2.8';
  const SCRIPT = 'AZ Click-to-Call';
  const STYLE_ID = 'tm-az-click-call-style';
  const CARD_SELECTOR = '.dd-card.referral-container[data-id]';
  const PRODUCER_SLOT_SELECTOR = '.cardes-template-item[gs-id="producer"]';
  const PRODUCER_ANCHOR_SELECTOR = '.badge, span.badge, .cardes-template-item-content, .ctr';
  const ACTION_GROUP_CLASS = 'tm-az-ticket-action-strip';
  const BUTTON_CLASS = 'tm-az-click-call-btn';
  const ATTACHED_ATTR = 'data-tm-az-click-call';
  const NOTE_SEPARATOR = '--------------------------------';
  const phoneCache = new Map();
  let observer = null;
  let scanTimer = 0;

  boot();

  function boot() {
    if (!isAgencyZoom()) return;
    injectStyle();
    scheduleScan(50);
    startObserver();
  }

  function isAgencyZoom() {
    return /(^|\.)app\.agencyzoom\.com$/i.test(String(location.hostname || ''));
  }

  function startObserver() {
    if (observer) observer.disconnect();
    observer = new MutationObserver(() => scheduleScan(150));
    observer.observe(document.documentElement || document.body, {
      childList: true,
      subtree: true
    });
    setInterval(() => scheduleScan(0), 2500);
  }

  function scheduleScan(delay) {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(attachButtons, delay);
  }

  function attachButtons() {
    const cards = Array.from(document.querySelectorAll(CARD_SELECTOR));
    for (const card of cards) {
      const ticketId = clean(card.getAttribute('data-id') || card.id.replace(/^referral/i, ''));
      if (!ticketId) continue;

      const existingActions = card.querySelector(`.${ACTION_GROUP_CLASS}[data-ticket-id="${cssEscape(ticketId)}"]`);
      if (card.getAttribute(ATTACHED_ATTR) === ticketId && existingActions) continue;

      const host = findButtonHost(card);
      if (!host) continue;

      removeOldCardButtons(card);
      card.setAttribute(ATTACHED_ATTR, ticketId);
      host.setAttribute(ATTACHED_ATTR, ticketId);
      host.classList.add('tm-az-click-call-host');

      const actions = document.createElement('span');
      actions.className = ACTION_GROUP_CLASS;
      actions.dataset.ticketId = ticketId;
      actions.setAttribute(ATTACHED_ATTR, ticketId);

      actions.appendChild(createActionButton('note', 'Open first note and add timestamp', 'fal fa-sticky-note', ticketId, onNoteClick));
      actions.appendChild(createActionButton('sms', 'Open ticket SMS', 'fal fa-sms', ticketId, onSmsClick));
      actions.appendChild(createActionButton('email', 'Open ticket email', 'fal fa-paper-plane', ticketId, onEmailClick));
      actions.appendChild(createActionButton('phone', 'Call ticket phone', 'fal fa-phone', ticketId, onCallClick));

      host.appendChild(actions);
    }
  }

  function createActionButton(kind, label, iconClass, ticketId, handler) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `${BUTTON_CLASS} tm-az-action-${kind}`;
    btn.setAttribute('aria-label', label);
    btn.dataset.action = kind;
    btn.dataset.ticketId = ticketId;
    btn.dataset.label = label;
    btn.innerHTML = `<i class="${iconClass}" aria-hidden="true"></i>`;
    btn.addEventListener('click', handler, true);
    return btn;
  }

  function findButtonHost(card) {
    const producerSlot = card.querySelector(PRODUCER_SLOT_SELECTOR);
    if (producerSlot) {
      const badge = producerSlot.querySelector('.badge');
      if (badge) return badge;

      const anchor = producerSlot.querySelector(PRODUCER_ANCHOR_SELECTOR);
      if (anchor) return anchor;

      return producerSlot;
    }

    const anyBadge = card.querySelector('.badge');
    if (anyBadge) return anyBadge;

    return card;
  }

  function removeOldCardButtons(card) {
    for (const old of Array.from(card.querySelectorAll(`.${ACTION_GROUP_CLASS}`))) {
      old.remove();
    }
    for (const old of Array.from(card.querySelectorAll(`.${BUTTON_CLASS}`))) {
      old.remove();
    }
  }

  async function onSmsClick(event) {
    event.preventDefault();
    event.stopPropagation();
    if (event.stopImmediatePropagation) event.stopImmediatePropagation();

    await openDockActionFromButton(event.currentTarget, 'sms');
  }

  async function onEmailClick(event) {
    event.preventDefault();
    event.stopPropagation();
    if (event.stopImmediatePropagation) event.stopImmediatePropagation();

    await openDockActionFromButton(event.currentTarget, 'email');
  }

  async function openDockActionFromButton(btn, kind) {
    const card = btn.closest(CARD_SELECTOR);
    const ticketId = clean(btn.dataset.ticketId || closestTicketId(btn));
    if (!card || !ticketId || btn.dataset.busy === '1') return;

    btn.dataset.busy = '1';
    flashButton(btn, 'loading', kind === 'sms' ? 'Opening SMS...' : 'Opening email...');

    try {
      const opened = await openTicketFromCard(card, ticketId);
      if (!opened) {
        flashButton(btn, 'error', 'Could not open ticket');
        return;
      }

      const action = await waitForDockAction(kind, 4500);
      if (!action) {
        flashButton(btn, 'error', kind === 'sms' ? 'SMS button not found' : 'Email button not found');
        return;
      }

      strongClick(action);
      flashButton(btn, 'ready', kind === 'sms' ? 'SMS opened' : 'Email opened');
    } catch (err) {
      flashButton(btn, 'error', `${kind.toUpperCase()} failed: ${err && err.message ? err.message : String(err)}`);
    } finally {
      delete btn.dataset.busy;
    }
  }

  async function onNoteClick(event) {
    event.preventDefault();
    event.stopPropagation();
    if (event.stopImmediatePropagation) event.stopImmediatePropagation();

    const btn = event.currentTarget;
    const card = btn.closest(CARD_SELECTOR);
    const ticketId = clean(btn.dataset.ticketId || closestTicketId(btn));
    if (!card || !ticketId || btn.dataset.busy === '1') return;

    btn.dataset.busy = '1';
    flashButton(btn, 'loading', 'Opening ticket...');

    try {
      const opened = await openTicketFromCard(card, ticketId);
      if (!opened) {
        flashButton(btn, 'error', 'Could not open ticket');
        return;
      }

      flashButton(btn, 'loading', 'Finding pinned note...');
      const note = findFirstPinnedNote() || await waitForPinnedNote(350);
      if (!note) {
        flashButton(btn, 'loading', 'Creating pinned note...');
        const editor = await openNewPinnedNoteEditor(btn);
        if (!editor) {
          flashButton(btn, 'error', 'Could not create pinned note');
          return;
        }
        flashButton(btn, 'ready', 'New pinned note ready');
        return;
      }

      const edit = note.querySelector('.note-actions a.edit-note, a.edit-note[title="Edit"], a.edit-note');
      if (!edit) {
        flashButton(btn, 'error', 'Edit note button not found');
        return;
      }

      flashButton(btn, 'loading', 'Opening note editor...');
      strongClick(edit);

      const editor = await waitForNoteEditor(9000);
      if (!editor) {
        flashButton(btn, 'error', 'Note editor not found');
        return;
      }

      appendTimestampBlock(editor);
      flashButton(btn, 'ready', 'Note ready for typing');
    } catch (err) {
      flashButton(btn, 'error', `Note failed: ${err && err.message ? err.message : String(err)}`);
    } finally {
      delete btn.dataset.busy;
    }
  }

  async function onCallClick(event) {
    event.preventDefault();
    event.stopPropagation();
    if (event.stopImmediatePropagation) event.stopImmediatePropagation();

    const btn = event.currentTarget;
    const ticketId = clean(btn.dataset.ticketId || closestTicketId(btn));
    if (!ticketId || btn.dataset.busy === '1') return;

    const cached = phoneCache.get(ticketId);
    if (cached) {
      callPhone(cached.phone);
      flashButton(btn, 'ready', `Calling ${maskPhone(cached.phone)}`);
      return;
    }

    btn.dataset.busy = '1';
    flashButton(btn, 'loading', 'Fetching phone...');

    try {
      const result = await fetchTicketPhone(ticketId);
      if (!result.phone) {
        flashButton(btn, 'error', result.detail || 'Phone not found');
        return;
      }

      phoneCache.set(ticketId, {
        phone: result.phone,
        source: result.source,
        fetchedAt: Date.now()
      });

      flashButton(btn, 'ready', `Calling ${maskPhone(result.phone)}`);
      callPhone(result.phone);
    } catch (err) {
      flashButton(btn, 'error', `Call failed: ${err && err.message ? err.message : String(err)}`);
    } finally {
      delete btn.dataset.busy;
    }
  }

  async function openTicketFromCard(card, ticketId) {
    if (ticketDockMatches(ticketId)) return true;

    const target = card.querySelector('a.customer[rel], a.customer') || card;
    strongClick(target);

    return waitFor(() => ticketDockMatches(ticketId), 10000, 120);
  }

  async function waitForDockAction(kind, timeoutMs) {
    return waitFor(() => findDockAction(kind), timeoutMs, 90);
  }

  function findDockAction(kind) {
    const sideActions = document.querySelector('.az-dock__side-actions');
    const root = sideActions || document;

    if (kind === 'sms') {
      return root.querySelector('#dockSms') ||
        closestVisibleIconButton(root, 'i.fal.fa-sms, i.fa-sms') ||
        null;
    }

    if (kind === 'email') {
      return root.querySelector('#dockEmail') ||
        closestVisibleIconButton(root, 'i.fal.fa-paper-plane, i.fa-paper-plane') ||
        null;
    }

    return null;
  }

  function closestVisibleIconButton(root, iconSelector) {
    const icon = Array.from(root.querySelectorAll(iconSelector)).find((el) => isVisible(el));
    return icon ? icon.closest('a,button,[role="button"]') : null;
  }

  function ticketDockMatches(ticketId) {
    const dock = document.querySelector('.az-dock__container') ||
      document.querySelector('#serviceDetailDock') ||
      document.querySelector('.az-dock');
    const sideActions = document.querySelector('.az-dock__side-actions');
    if (!dock && !sideActions) return false;

    const scope = document.querySelector('.az-dock__container') || dock || document.body;
    const html = String(scope.innerHTML || '');
    return html.includes(`"id":${ticketId}`) ||
      html.includes(`leadId: ${ticketId}`) ||
      html.includes(`data-referralid="${ticketId}"`) ||
      html.includes(`data-sourceleadid="${ticketId}"`) ||
      html.includes(`TaskModel.init({leadId: ${ticketId}`);
  }

  async function waitForPinnedNote(timeoutMs) {
    return waitFor(() => findFirstPinnedNote(), timeoutMs, 120);
  }

  function findFirstPinnedNote() {
    const dock = document.querySelector('.az-dock__container') || document;
    const pinTopNote = dock.querySelector('#pinTopTimelineCard .lead-note');
    if (pinTopNote) return pinTopNote;

    const notes = Array.from(dock.querySelectorAll('.lead-note.az-defcard--pinned, .lead-note'));
    return notes.find((note) => isPinnedNote(note)) || null;
  }

  function isPinnedNote(note) {
    if (!(note instanceof Element)) return false;
    const pin = note.querySelector('.az-defcard__pin');
    const pinTitle = lower(pin?.getAttribute('title') || pin?.getAttribute('aria-label') || '');
    return !!note.closest('#pinTopTimelineCard') ||
      note.classList.contains('az-defcard--pinned') ||
      pinTitle.includes('unpin');
  }

  async function openNewPinnedNoteEditor(btn = null) {
    const opener = findNoteOpener();
    if (!opener) {
      if (btn) flashButton(btn, 'error', 'Note opener not found');
      return null;
    }

    strongClick(opener);

    const editor = await waitForNoteEditor(3200);
    if (!editor) {
      if (btn) flashButton(btn, 'error', 'New note editor not found');
      return null;
    }

    appendTimestampBlock(editor);

    const pinned = await ensureNewNotePinned(editor);
    if (!pinned) {
      if (btn) flashButton(btn, 'error', 'Pin to top not found');
      return null;
    }

    return editor;
  }

  function findNoteOpener() {
    const roots = [
      document.querySelector('.az-dock__side-actions'),
      document.querySelector('#serviceDetailDock'),
      document.querySelector('.az-dock'),
      document
    ].filter(Boolean);

    for (const root of roots) {
      const direct = Array.from(root.querySelectorAll('a.btn-note, .btn-note'))
        .find((el) => isVisible(el));
      if (direct) return direct;
    }

    const icon = Array.from(document.querySelectorAll('i.fal.fa-sticky-note, i.fa-sticky-note'))
      .find((el) => isVisible(el));
    return icon ? icon.closest('a,button,[role="button"]') : null;
  }

  async function ensureNewNotePinned(editor) {
    const pin = findNewNotePinControl(editor) || await waitFor(() => findNewNotePinControl(editor), 950, 50);
    if (!pin) return false;

    if (isPinControlAlreadyPinned(pin)) return true;

    clickPinToTop(pin);
    await sleep(250);
    return true;
  }

  function clickPinToTop(pin) {
    if (!(pin instanceof Element)) return false;
    try {
      if (window.jQuery) window.jQuery(pin).trigger('click');
    } catch {}
    strongClick(pin);
    return true;
  }

  function findNewNotePinControl(editor) {
    const root = getNoteEditorRoot(editor);
    const candidates = Array.from(root.querySelectorAll([
      'a.pin-top',
      'a.d-flex.align-items-center.pin-top',
      'button.pin-top',
      '[data-value].pin-top',
      'a[title*="Pin"]',
      'button[title*="Pin"]'
    ].join(','))).filter((el) => isVisible(el) || lower(el.textContent || '').includes('pin'));

    const byText = candidates.find((el) => lower(el.textContent || '').includes('pin to top'));
    if (byText) return byText;

    const byValue = candidates.find((el) => clean(el.getAttribute('data-value')) === '0');
    if (byValue) return byValue;

    return candidates[0] || findByVisibleText(root, ['a', 'button'], 'Pin to top');
  }

  function getNoteEditorRoot(editor) {
    return editor?.closest?.('#notePanelContainer, .modal, .popover, .az-dock') ||
      document.querySelector('#notePanelContainer') ||
      document;
  }

  function isPinControlAlreadyPinned(pin) {
    const text = lower(pin.textContent || '');
    const value = clean(pin.getAttribute('data-value'));
    return text.includes('unpin') ||
      value === '1' ||
      pin.classList.contains('active') ||
      pin.getAttribute('aria-pressed') === 'true';
  }

  function findByVisibleText(root, selectors, wantedText) {
    const wanted = lower(wantedText);
    return selectors
      .flatMap((selector) => Array.from(root.querySelectorAll(selector)))
      .find((el) => isVisible(el) && lower(el.textContent || '').includes(wanted)) || null;
  }

  async function waitForNoteEditor(timeoutMs) {
    return waitFor(() => {
      const focused = document.activeElement && document.activeElement.closest
        ? document.activeElement.closest('.ql-editor[contenteditable="true"]')
        : null;
      if (focused && isVisible(focused)) return focused;

      const editors = Array.from(document.querySelectorAll('.ql-editor[contenteditable="true"]'))
        .filter((editor) => isVisible(editor));
      if (!editors.length) return null;

      return editors.find((editor) => editor.closest('.modal, .popover, .az-dock__container')) ||
        editors[editors.length - 1];
    }, timeoutMs, 120);
  }

  function appendTimestampBlock(editor) {
    const line = `${NOTE_SEPARATOR}\n${formatPacificTimestamp()}`;
    const quill = getQuillInstance(editor);

    if (quill && typeof quill.insertText === 'function' && typeof quill.getLength === 'function') {
      const insertAt = Math.max(0, quill.getLength() - 1);
      const prefix = insertAt > 0 ? '\n' : '';
      const text = `${prefix}${line}`;
      quill.focus();
      quill.insertText(insertAt, text, 'user');
      if (typeof quill.setSelection === 'function') {
        quill.setSelection(insertAt + text.length, 0, 'user');
      }
      return;
    }

    appendTimestampDom(editor, line);
  }

  function appendTimestampDom(editor, line) {
    const [separator, stamp] = line.split('\n');
    const hasText = clean(editor.textContent || '');

    if (!hasText) {
      editor.innerHTML = '';
    }

    const separatorP = document.createElement('p');
    separatorP.textContent = separator;
    editor.appendChild(separatorP);

    const stampP = document.createElement('p');
    stampP.textContent = stamp;
    editor.appendChild(stampP);

    focusEnd(stampP);
    emitEditorInput(editor);
  }

  function getQuillInstance(editor) {
    try {
      if (window.Quill && typeof window.Quill.find === 'function') {
        const direct = window.Quill.find(editor);
        if (direct && typeof direct.insertText === 'function') return direct;

        const container = editor.closest('.ql-container');
        const fromContainer = container ? window.Quill.find(container) : null;
        if (fromContainer && typeof fromContainer.insertText === 'function') return fromContainer;
      }
    } catch {}

    return editor.__quill || editor.closest('.ql-container')?.__quill || null;
  }

  function formatPacificTimestamp() {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      month: '2-digit',
      day: '2-digit',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    }).formatToParts(new Date());

    const part = (type) => parts.find((p) => p.type === type)?.value || '';
    return `${part('month')}/${part('day')}/${part('year')} ${part('hour')}:${part('minute')}${part('dayPeriod').toUpperCase()}: `;
  }

  function focusEnd(node) {
    const range = document.createRange();
    range.selectNodeContents(node);
    range.collapse(false);

    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    const editor = node.closest('.ql-editor[contenteditable="true"]');
    if (editor) editor.focus();
  }

  function emitEditorInput(editor) {
    try {
      editor.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType: 'insertText',
        data: ''
      }));
    } catch {
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    }
    editor.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function strongClick(el) {
    if (!el) return;
    const opts = { bubbles: true, cancelable: true, view: window };
    hideAgencyZoomTooltips(el);
    el.dispatchEvent(new MouseEvent('mouseover', opts));
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.dispatchEvent(new MouseEvent('click', opts));
    el.dispatchEvent(new MouseEvent('mouseout', opts));
    el.dispatchEvent(new MouseEvent('mouseleave', opts));
    hideAgencyZoomTooltips(el);
    setTimeout(() => hideAgencyZoomTooltips(el), 80);
    setTimeout(() => hideAgencyZoomTooltips(el), 350);
  }

  function hideAgencyZoomTooltips(sourceEl = null) {
    try {
      const $ = window.jQuery || window.$;
      if ($) {
        const targets = [];
        if (sourceEl instanceof Element) targets.push(sourceEl);
        targets.push(...Array.from(document.querySelectorAll('.tooltipstered, .az-tooltip')));
        for (const target of targets) {
          try {
            const jq = $(target);
            if (typeof jq.tooltipster === 'function') jq.tooltipster('hide');
          } catch {}
          try {
            const jq = $(target);
            if (typeof jq.tooltip === 'function') jq.tooltip('hide');
          } catch {}
        }
      }
    } catch {}

    document.querySelectorAll('.tooltipster-base, .tooltipster-sidetip, .tooltipster-box').forEach((el) => {
      try { el.remove(); } catch {}
    });
  }

  function waitFor(check, timeoutMs, intervalMs) {
    const started = Date.now();
    return new Promise((resolve) => {
      const tick = () => {
        let value = null;
        try { value = check(); } catch {}
        if (value) {
          resolve(value);
          return;
        }
        if (Date.now() - started >= timeoutMs) {
          resolve(null);
          return;
        }
        setTimeout(tick, intervalMs);
      };
      tick();
    });
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function fetchTicketPhone(ticketId) {
    const csrf = getCsrfToken();
    const headers = {
      'Accept': 'text/html, */*;q=0.8',
      'X-Requested-With': 'XMLHttpRequest'
    };
    if (csrf) headers['X-CSRF-Token'] = csrf;

    const url = new URL('/lead/index', location.origin);
    url.searchParams.set('id', ticketId);

    const response = await fetch(url.toString(), {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      redirect: 'follow',
      headers
    });

    const text = await response.text();
    if (!response.ok) {
      return { phone: '', source: '', detail: `HTTP ${response.status}` };
    }

    if (looksLikeLogin(text, response.url || '')) {
      return { phone: '', source: '', detail: 'AgencyZoom returned login page' };
    }

    const extracted = extractPhone(text);
    if (!extracted.phone) {
      return { phone: '', source: '', detail: 'Phone not found in ticket response' };
    }

    return extracted;
  }

  function extractPhone(text) {
    const raw = String(text || '');

    const htmlPhone = extractPhoneFromHtml(raw);
    if (htmlPhone.phone) return htmlPhone;

    const customerWindows = collectWindows(raw, /CustomerReferral|customerReferral|customerreferral/i, 18000);
    for (const chunk of customerWindows) {
      const jsonPhone = extractPhoneFromKeyValue(chunk);
      if (jsonPhone) {
        return { phone: jsonPhone, source: 'CustomerReferral phone field' };
      }

      const labeledPhone = findPhoneNearLabel(chunk);
      if (labeledPhone) {
        return { phone: labeledPhone, source: 'CustomerReferral phone label' };
      }
    }

    const labeled = findPhoneNearLabel(raw);
    if (labeled) {
      return { phone: labeled, source: 'phone-labeled response text' };
    }

    return { phone: '', source: '' };
  }

  function extractPhoneFromHtml(raw) {
    const doc = new DOMParser().parseFromString(raw, 'text/html');

    const selectors = [
      '#customerreferral-phone',
      'input[name="CustomerReferral[phone]"]',
      'input[type="tel"]',
      '[data-phone]'
    ];

    for (const selector of selectors) {
      const el = doc.querySelector(selector);
      const value = clean(el && (el.value || el.getAttribute('value') || el.getAttribute('data-phone') || el.textContent));
      if (normalizePhone(value)) return { phone: value, source: selector };
    }

    const initialInput = doc.querySelector('#detailDockform input[name="initialValues"], input[name="initialValues"]');
    const initialRaw = initialInput ? htmlDecode(initialInput.value || initialInput.getAttribute('value') || '') : '';
    const initialJson = parseJson(initialRaw);
    if (initialJson) {
      const direct = firstPhone(
        readPath(initialJson, ['CustomerReferral', 'phone']),
        readPath(initialJson, ['customerReferral', 'phone']),
        readPath(initialJson, ['Customer', 'phone']),
        readPath(initialJson, ['customer', 'phone'])
      );
      if (direct) return { phone: direct, source: 'initialValues.CustomerReferral.phone' };

      const nested = findPhoneInObject(initialJson, 'initialValues');
      if (nested) return nested;
    }

    const tel = Array.from(doc.querySelectorAll('a[href^="tel:"]'))
      .map((a) => String(a.getAttribute('href') || '').replace(/^tel:/i, ''))
      .find((value) => normalizePhone(value));
    if (tel) return { phone: tel, source: 'tel link' };

    return { phone: '', source: '' };
  }

  function extractPhoneFromKeyValue(text) {
    const raw = htmlDecode(String(text || ''));
    const patterns = [
      /["']phone["']\s*[:=]\s*["']([^"']{7,30})["']/i,
      /&quot;phone&quot;\s*:\s*&quot;([^&]{7,30})&quot;/i,
      /\bphone\b[^0-9+]{0,40}(\+?1?[\s().-]*\d{3}[\s().-]*\d{3}[\s().-]*\d{4})/i
    ];

    for (const pattern of patterns) {
      const match = raw.match(pattern);
      if (match && normalizePhone(match[1])) return match[1];
    }

    return '';
  }

  function collectWindows(text, pattern, size) {
    const raw = String(text || '');
    const windows = [];
    let match;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(raw))) {
      const start = Math.max(0, match.index - Math.floor(size / 4));
      const end = Math.min(raw.length, match.index + size);
      windows.push(raw.slice(start, end));
      if (!pattern.global) break;
    }
    return windows;
  }

  function findPhoneNearLabel(text) {
    const raw = htmlDecode(String(text || ''));
    const labelRe = /(?:phone|mobile|cell|telephone)[^0-9+]{0,120}(\+?1?[\s().-]*\d{3}[\s().-]*\d{3}[\s().-]*\d{4})/ig;
    let match;
    while ((match = labelRe.exec(raw))) {
      if (normalizePhone(match[1])) return match[1];
    }
    return '';
  }

  function findPhoneInObject(value, path) {
    if (!value || typeof value !== 'object') return null;

    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i += 1) {
        const found = findPhoneInObject(value[i], `${path}[${i}]`);
        if (found) return found;
      }
      return null;
    }

    for (const key of Object.keys(value)) {
      const nextPath = path ? `${path}.${key}` : key;
      const child = value[key];
      if (/phone|mobile|cell/i.test(key)) {
        const phone = firstPhone(child);
        if (phone) return { phone, source: nextPath };
      }
      if (child && typeof child === 'object') {
        const found = findPhoneInObject(child, nextPath);
        if (found) return found;
      }
    }

    return null;
  }

  function callPhone(phone) {
    const digits = normalizePhone(phone);
    if (!digits) return;

    const href = `tel:+1${digits}`;
    const link = document.createElement('a');
    link.href = href;
    link.style.position = 'fixed';
    link.style.left = '-9999px';
    link.style.top = '0';
    document.body.appendChild(link);
    link.click();
    setTimeout(() => link.remove(), 500);
  }

  function flashButton(btn, state, title) {
    btn.classList.remove('tm-az-call-loading', 'tm-az-call-ready', 'tm-az-call-error');
    if (state === 'loading') btn.classList.add('tm-az-call-loading');
    if (state === 'ready') btn.classList.add('tm-az-call-ready');
    if (state === 'error') btn.classList.add('tm-az-call-error');
    btn.setAttribute('aria-label', title || btn.dataset.label || 'AgencyZoom action');

    if (state === 'ready' || state === 'error') {
      setTimeout(() => {
        btn.classList.remove('tm-az-call-loading', 'tm-az-call-ready', 'tm-az-call-error');
        btn.setAttribute('aria-label', btn.dataset.label || 'AgencyZoom action');
      }, state === 'ready' ? 2500 : 5000);
    }
  }

  function closestTicketId(el) {
    const card = el && el.closest && el.closest(CARD_SELECTOR);
    return clean(card && (card.getAttribute('data-id') || card.id.replace(/^referral/i, '')));
  }

  function getCsrfToken() {
    return clean(
      readAttr('meta[name="csrf-token"]', 'content') ||
      readAttr('meta[name="csrfToken"]', 'content') ||
      readValue(document, 'input[name="_csrf"]') ||
      readValue(document, 'input[name="_csrf-frontend"]')
    );
  }

  function looksLikeLogin(text, finalUrl) {
    const raw = String(text || '').slice(0, 50000);
    let path = '';
    try {
      const parsed = new URL(finalUrl || '', location.origin);
      path = parsed.pathname + parsed.search;
    } catch {}

    return /\/login(?:$|[?#/])/i.test(path) ||
      (/<form[^>]+(?:id|class|action)=["'][^"']*login/i.test(raw) && /name=["']password["']/i.test(raw)) ||
      /name=["']LoginForm\[password\]["']|name=["']password["'][^>]*autocomplete=["']current-password/i.test(raw) ||
      /<title>\s*(?:login|sign in)/i.test(raw);
  }

  function parseJson(text) {
    const raw = htmlDecode(String(text || '').trim());
    if (!raw) return null;
    try { return JSON.parse(raw); } catch {}
    try { return JSON.parse(raw.replace(/&quot;/g, '"')); } catch {}
    return null;
  }

  function readPath(obj, parts) {
    let cur = obj;
    for (const part of parts) {
      if (!cur || typeof cur !== 'object') return '';
      cur = cur[part];
    }
    return cur;
  }

  function readAttr(selector, attr) {
    const el = document.querySelector(selector);
    return el ? el.getAttribute(attr) || '' : '';
  }

  function readValue(root, selector) {
    const el = root && root.querySelector ? root.querySelector(selector) : null;
    return clean(el && (el.value || el.getAttribute('value') || el.textContent));
  }

  function firstPhone(...values) {
    for (const value of values) {
      const text = clean(value);
      if (normalizePhone(text)) return text;
    }
    return '';
  }

  function normalizePhone(value) {
    let digits = String(value || '').replace(/\D/g, '');
    if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
    return digits.length === 10 ? digits : '';
  }

  function maskPhone(value) {
    const digits = normalizePhone(value);
    return digits ? `***-***-${digits.slice(-4)}` : '';
  }

  function isVisible(el) {
    if (!el) return false;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 &&
      rect.height > 0 &&
      rect.bottom >= 0 &&
      rect.right >= 0 &&
      rect.top <= window.innerHeight &&
      rect.left <= window.innerWidth;
  }

  function clean(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }

  function lower(value) {
    return clean(value).toLowerCase();
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(String(value));
    return String(value).replace(/["\\]/g, '\\$&');
  }

  function htmlDecode(text) {
    const ta = document.createElement('textarea');
    ta.innerHTML = String(text || '');
    return ta.value;
  }

  function phoneSvg() {
    return '<i class="fal fa-phone" aria-hidden="true"></i>';
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .tm-az-click-call-host {
        position: relative !important;
        overflow: visible !important;
      }
      .${ACTION_GROUP_CLASS} {
        position: absolute;
        top: calc(100% + 2px);
        right: 0;
        z-index: 9999;
        display: grid;
        grid-template-columns: 18px 18px;
        grid-template-rows: 18px 18px;
        grid-template-areas:
          "sms phone"
          "note email";
        gap: 2px;
        width: 38px;
        height: 38px;
        white-space: nowrap;
      }
      .${BUTTON_CLASS} {
        position: relative;
        width: 18px;
        height: 18px;
        z-index: 9999;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        border: 0;
        border-radius: 3px;
        background: transparent;
        color: #111827;
        box-shadow: none;
        cursor: pointer;
        transition: color .12s ease, background .12s ease, transform .12s ease;
      }
      .${BUTTON_CLASS}:hover {
        background: rgba(17, 24, 39, .08);
        color: #111827;
        transform: translateY(-1px);
      }
      .${BUTTON_CLASS}.tm-az-action-phone:hover {
        color: #15803d;
      }
      .${BUTTON_CLASS}.tm-az-action-note:hover {
        color: #b45309;
      }
      .${BUTTON_CLASS}.tm-az-action-sms:hover {
        color: #2563eb;
      }
      .${BUTTON_CLASS}.tm-az-action-email:hover {
        color: #7c3aed;
      }
      .${BUTTON_CLASS}.tm-az-action-phone {
        grid-area: phone;
      }
      .${BUTTON_CLASS}.tm-az-action-sms {
        grid-area: sms;
      }
      .${BUTTON_CLASS}.tm-az-action-email {
        grid-area: email;
      }
      .${BUTTON_CLASS}.tm-az-action-note {
        grid-area: note;
      }
      .${BUTTON_CLASS}:focus-visible {
        outline: 2px solid rgba(37, 99, 235, .45);
        outline-offset: 1px;
      }
      .${BUTTON_CLASS} i {
        font-size: 15px;
        line-height: 1;
        pointer-events: none;
      }
      .${BUTTON_CLASS}.tm-az-call-loading {
        background: rgba(253, 230, 138, .75);
        color: #78350f;
        animation: tmAzCallPulse .85s infinite alternate;
      }
      .${BUTTON_CLASS}.tm-az-call-ready {
        background: rgba(187, 247, 208, .75);
        color: #14532d;
      }
      .${BUTTON_CLASS}.tm-az-call-error {
        background: rgba(254, 202, 202, .78);
        color: #7f1d1d;
      }
      @keyframes tmAzCallPulse {
        from { opacity: .58; }
        to { opacity: 1; }
      }
    `;
    document.head.appendChild(style);
  }
})();
