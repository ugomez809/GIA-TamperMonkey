// ==UserScript==
// @name         LOCAL AgencyZoom Pipeline Click-to-Call
// @namespace    local.agencyzoom.pipeline-click-to-call
// @version      2.27
// @description  Adds AgencyZoom-style action icons to lead pipeline cards and task modals. Phone calls route through RingCentral; note edits/starts pinned notes; SMS/email open the matching AgencyZoom composer.
// @match        https://app.agencyzoom.com/*
// @exclude      https://app.agencyzoom.com/login*
// @run-at       document-idle
// @grant        none
// @updateURL    https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/AgencyZoom/Click-to-Call/agencyzoom-phone-click-to-call.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/AgencyZoom/Click-to-Call/agencyzoom-phone-click-to-call.user.js
// ==/UserScript==

(function () {
  'use strict';

  const VERSION = '2.26';
  const SCRIPT = 'AZ Click-to-Call';
  const STYLE_ID = 'tm-az-click-call-style';
  const SERVICE_PIPELINE_PATH = '/pipeline/service-pipeline';
  const LEAD_DETAIL_PATH = '/lead/index';
  const PENDING_ACTION_KEY = 'tmAzClickToCall.pendingAction.v1';
  const PENDING_ACTION_TTL_MS = 30000;
  const CARD_SELECTOR = [
    '.dd-card.referral-container[data-id]',
    '.dd-card.service-container[data-id]',
    '.dd-card.service-ticket-container[data-id]',
    '.dd-card.ticket-container[data-id]',
    '.dd-card[data-id]'
  ].join(',');
  const LEAD_CARD_SELECTOR = '.dd-card.referral-container[data-id]';
  const PRODUCER_SLOT_SELECTOR = '.cardes-template-item[gs-id="producer"]';
  const PRODUCER_ANCHOR_SELECTOR = '.badge, span.badge, .cardes-template-item-content, .ctr';
  const ACTION_GROUP_CLASS = 'tm-az-ticket-action-strip';
  const BUTTON_CLASS = 'tm-az-click-call-btn';
  const TASK_PHONE_ROW_CLASS = 'tm-az-task-phone-call-row';
  const TASK_CALL_BUTTON_CLASS = 'tm-az-task-phone-call';
  const LEGACY_TASK_NAME_ROW_CLASS = 'tm-az-task-name-call-row';
  const LEGACY_TASK_CALL_BUTTON_CLASS = 'tm-az-task-name-call';
  const ATTACHED_ATTR = 'data-tm-az-click-call';
  const TASK_ATTACHED_ATTR = 'data-tm-az-task-click-call-phone';
  const NATIVE_DIALER_SELECTOR = '#dockDialer';
  const NOTE_SEPARATOR = '--------------------------------';
  const NOTE_EDITOR_OPEN_DELAY_MS = 800;
  const NOTE_EDITOR_STABLE_MS = 900;
  const NOTE_EDITOR_STABLE_TIMEOUT_MS = 3600;
  const NOTE_INSERT_VERIFY_MS = 650;
  const DIALER_OVERRIDE_CHECK_MS = 1000;
  const FLASH_RESET_MS = {
    loading: 12000,
    ready: 1800,
    error: 5000
  };
  const phoneCache = new Map();
  let observer = null;
  let scanTimer = 0;
  let dialerOverrideTimer = 0;

  boot();

  function boot() {
    if (!isAgencyZoom()) return;
    injectStyle();
    installRingCentralDialerHooks();
    clearPendingAction();
    scheduleScan(50);
    startObserver();
  }

  function isAgencyZoom() {
    return /(^|\.)app\.agencyzoom\.com$/i.test(String(location.hostname || ''));
  }

  function isServicePipelinePage() {
    const path = String(location.pathname || '').replace(/\/+$/, '') || '/';
    return path === SERVICE_PIPELINE_PATH || path.startsWith(`${SERVICE_PIPELINE_PATH}/`);
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

  function installRingCentralDialerHooks() {
    document.addEventListener('click', onNativeDialerClick, true);
    ensureNativeDialerOverride();
    dialerOverrideTimer = setInterval(ensureNativeDialerOverride, DIALER_OVERRIDE_CHECK_MS);
  }

  function onNativeDialerClick(event) {
    const target = event.target && event.target.closest ? event.target.closest(NATIVE_DIALER_SELECTOR) : null;
    if (!target) return;

    event.preventDefault();
    event.stopPropagation();
    if (event.stopImmediatePropagation) event.stopImmediatePropagation();

    const found = extractNativeDialerPhone(target);
    const phone = found.phone || promptForManualPhone();
    if (phone) callPhone(phone);
  }

  function ensureNativeDialerOverride() {
    const page = getPageWindow();
    const dialer = page.Dialer;
    if (!dialer || typeof dialer.makeCall !== 'function') return false;
    if (dialer.makeCall.__tmAzRingCentralMakeCall) return true;

    const originalMakeCall = dialer.makeCall.__tmAzOriginalMakeCall || dialer.makeCall;
    const wrappedMakeCall = function (agentId, linkType, linkId, phoneNumber) {
      const directPhone = normalizePhone(phoneNumber);
      const fallbackPhone = directPhone || extractNativeDialerPhone().phone || promptForManualPhone();
      if (fallbackPhone) callPhone(fallbackPhone);
      return undefined;
    };

    wrappedMakeCall.__tmAzRingCentralMakeCall = true;
    wrappedMakeCall.__tmAzOriginalMakeCall = originalMakeCall;
    dialer.makeCall = wrappedMakeCall;
    return true;
  }

  function extractNativeDialerPhone(dialerEl = null) {
    const selectorSources = [
      { selector: '#currentCustomerPhone', source: 'current customer phone' },
      { selector: '#customerreferral-phone', source: 'customer referral phone' }
    ];

    for (const item of selectorSources) {
      const value = readValue(document, item.selector);
      const phone = normalizePhone(value);
      if (phone) return { phone, source: item.source };
    }

    const labeledPhone = readLabeledValue(document, ['Phone', 'Mobile', 'Cell', 'Telephone']);
    if (normalizePhone(labeledPhone)) {
      return { phone: normalizePhone(labeledPhone), source: 'lead contact phone label' };
    }

    const pageDialer = getPageWindow().Dialer;
    const dialerStatePhone = firstPhone(
      pageDialer && pageDialer.to,
      pageDialer && pageDialer.phoneNumber,
      pageDialer && pageDialer.phone,
      pageDialer && pageDialer.number
    );
    if (dialerStatePhone) return { phone: normalizePhone(dialerStatePhone), source: 'Dialer state' };

    const dockDialer = dialerEl || document.querySelector(NATIVE_DIALER_SELECTOR);
    const dockPhone = firstPhone(
      dockDialer && dockDialer.getAttribute && dockDialer.getAttribute('data-phone'),
      dockDialer && dockDialer.getAttribute && dockDialer.getAttribute('data-number'),
      dockDialer && dockDialer.getAttribute && dockDialer.getAttribute('data-to'),
      dockDialer && dockDialer.getAttribute && dockDialer.getAttribute('href'),
      dockDialer && dockDialer.textContent
    );
    if (dockPhone) return { phone: normalizePhone(dockPhone), source: NATIVE_DIALER_SELECTOR };

    return { phone: '', source: '' };
  }

  function promptForManualPhone() {
    const value = window.prompt('No phone number found. Enter phone manually:');
    return normalizePhone(value);
  }

  async function resumePendingAction() {
    const pending = getPendingAction();
    if (!pending) return;

    const currentTicketId = getCurrentDetailTicketId();
    if (!currentTicketId || currentTicketId !== pending.ticketId) return;

    clearPendingAction();

    if (pending.kind === 'sms' || pending.kind === 'email') {
      await openDockComposer(pending.kind, 15000);
      return;
    }

    if (pending.kind === 'note') {
      await openOrPreparePinnedNote();
    }
  }

  function savePendingAction(kind, ticketId) {
    if (!kind || !ticketId) return;
    try {
      sessionStorage.setItem(PENDING_ACTION_KEY, JSON.stringify({
        kind,
        ticketId: String(ticketId),
        createdAt: Date.now()
      }));
    } catch {}
  }

  function getPendingAction() {
    let pending = null;
    try {
      pending = JSON.parse(sessionStorage.getItem(PENDING_ACTION_KEY) || 'null');
    } catch {
      clearPendingAction();
      return null;
    }

    if (!pending || !pending.kind || !pending.ticketId || Date.now() - Number(pending.createdAt || 0) > PENDING_ACTION_TTL_MS) {
      clearPendingAction();
      return null;
    }

    return pending;
  }

  function clearPendingAction() {
    try { sessionStorage.removeItem(PENDING_ACTION_KEY); } catch {}
  }

  function scheduleScan(delay) {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(attachButtons, delay);
  }

  function attachButtons() {
    if (isServicePipelinePage()) {
      removeManagedActionUi();
      return;
    }

    attachTaskModalCallButtons();

    const cards = Array.from(document.querySelectorAll(LEAD_CARD_SELECTOR));
    for (const card of cards) {
      const ticketId = getCardTicketId(card);
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

  function attachTaskModalCallButtons() {
    const contactBlocks = Array.from(document.querySelectorAll('#taskContactInfo'));
    for (const contact of contactBlocks) {
      if (!isTaskModalContactBlock(contact)) continue;
      cleanupLegacyTaskNameCall(contact);

      const phoneLabel = contact.querySelector('.label.phone, .phone');
      const rawPhone = clean(phoneLabel && phoneLabel.textContent);
      const digits = normalizePhone(rawPhone);
      if (!phoneLabel || !digits) {
        removeOldTaskCallButtons(contact);
        contact.removeAttribute(TASK_ATTACHED_ATTR);
        continue;
      }

      const existing = contact.querySelector(`.${TASK_CALL_BUTTON_CLASS}`);
      if (contact.getAttribute(TASK_ATTACHED_ATTR) === digits && existing) {
        refreshTaskCallButton(existing, rawPhone, digits);
        continue;
      }

      removeOldTaskCallButtons(contact);

      const row = ensureTaskPhoneRow(contact, phoneLabel);
      if (!row) continue;

      row.appendChild(createTaskCallButton(rawPhone, digits));
      contact.setAttribute(TASK_ATTACHED_ATTR, digits);
    }
  }

  function isTaskModalContactBlock(contact) {
    const modal = contact.closest('.modal-content, .modal') || contact;

    if (modal.querySelector('#taskedit-form')) return true;

    const title = clean(modal.querySelector('.modal-title')?.textContent || '');
    return /\btask\b/i.test(title);
  }

  function ensureTaskPhoneRow(contact, phoneLabel) {
    const currentRow = phoneLabel.closest(`.${TASK_PHONE_ROW_CLASS}`);
    if (currentRow && contact.contains(currentRow)) return currentRow;

    const nodeToMove = phoneLabel;
    if (!nodeToMove || !nodeToMove.parentNode) return null;

    const row = document.createElement('span');
    row.className = TASK_PHONE_ROW_CLASS;
    nodeToMove.parentNode.insertBefore(row, nodeToMove);
    row.appendChild(nodeToMove);
    return row;
  }

  function createTaskCallButton(rawPhone, digits) {
    const link = document.createElement('a');
    link.className = `${BUTTON_CLASS} tm-az-action-phone ${TASK_CALL_BUTTON_CLASS}`;
    link.dataset.phone = digits;
    link.innerHTML = phoneSvg();
    refreshTaskCallButton(link, rawPhone, digits);
    link.addEventListener('click', onTaskModalCallClick, true);
    return link;
  }

  function refreshTaskCallButton(link, rawPhone, digits) {
    const label = `Call ${clean(rawPhone) || 'task contact'}`;
    link.dataset.phone = digits;
    link.dataset.label = label;
    link.href = buildRingCentralTelUrl(digits);
    link.title = label;
    link.setAttribute('aria-label', label);
  }

  function removeOldTaskCallButtons(contact) {
    for (const old of Array.from(contact.querySelectorAll(`.${TASK_CALL_BUTTON_CLASS},.${LEGACY_TASK_CALL_BUTTON_CLASS}`))) {
      old.remove();
    }
  }

  function cleanupLegacyTaskNameCall(contact) {
    for (const row of Array.from(contact.querySelectorAll(`.${LEGACY_TASK_NAME_ROW_CLASS}`))) {
      const child = row.firstElementChild;
      if (child && row.parentNode) {
        row.parentNode.insertBefore(child, row);
      }
      row.remove();
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

  function removeManagedActionUi() {
    for (const card of Array.from(document.querySelectorAll(CARD_SELECTOR))) {
      removeOldCardButtons(card);
      if (card.getAttribute(ATTACHED_ATTR)) card.removeAttribute(ATTACHED_ATTR);
    }

    for (const host of Array.from(document.querySelectorAll(`[${ATTACHED_ATTR}]`))) {
      host.removeAttribute(ATTACHED_ATTR);
      host.classList.remove('tm-az-click-call-host');
    }

    for (const contact of Array.from(document.querySelectorAll('#taskContactInfo'))) {
      removeOldTaskCallButtons(contact);
      cleanupLegacyTaskNameCall(contact);
      contact.removeAttribute(TASK_ATTACHED_ATTR);
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
    const card = closestTicketCard(btn);
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
    const card = closestTicketCard(btn);
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

      await openOrPreparePinnedNote(btn);
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

  function onTaskModalCallClick(event) {
    event.preventDefault();
    event.stopPropagation();
    if (event.stopImmediatePropagation) event.stopImmediatePropagation();

    const btn = event.currentTarget;
    const digits = normalizePhone(btn.dataset.phone || btn.getAttribute('href'));
    if (!digits) {
      flashButton(btn, 'error', 'Task phone not found');
      return;
    }

    flashButton(btn, 'ready', `Calling ${maskPhone(digits)}`);
    callPhone(digits);
  }

  async function openOrPreparePinnedNote(btn = null) {
    if (btn) flashButton(btn, 'loading', 'Finding pinned note...');

    await waitFor(() => findFirstPinnedNote() || findNoteOpener(), 10000, 120);

    const note = findFirstPinnedNote() || await waitForPinnedNote(350);
    if (!note) {
      if (btn) flashButton(btn, 'loading', 'Creating pinned note...');
      const editor = await openNewPinnedNoteEditor(btn);
      if (!editor) {
        if (btn) flashButton(btn, 'error', 'Could not create pinned note');
        return false;
      }
      if (btn) flashButton(btn, 'ready', 'New pinned note ready');
      return true;
    }

    const edit = note.querySelector('.note-actions a.edit-note, a.edit-note[title="Edit"], a.edit-note');
    if (!edit) {
      if (btn) flashButton(btn, 'error', 'Edit note button not found');
      return false;
    }

    if (btn) flashButton(btn, 'loading', 'Opening note editor...');
    strongClick(edit);

    const editor = await waitForNoteEditor(9000);
    if (!editor) {
      if (btn) flashButton(btn, 'error', 'Note editor not found');
      return false;
    }

    const stamped = await appendTimestampBlock(editor);
    if (!stamped) {
      if (btn) flashButton(btn, 'error', 'Could not add note divider');
      return false;
    }

    if (btn) flashButton(btn, 'ready', 'Note ready for typing');
    return true;
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

  async function openDockComposer(kind, timeoutMs = 6000) {
    const firstAction = await waitForDockAction(kind, timeoutMs);
    if (!firstAction) return false;

    const tried = new Set();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const action = attempt === 0 ? firstAction : findDockAction(kind, tried);
      if (!action) return false;

      tried.add(action);
      strongClick(action);

      const composer = await waitFor(() => findComposer(kind), 3200, 120);
      if (composer) return true;
    }

    return false;
  }

  function findDockAction(kind, exclude = new Set()) {
    const sideActions = document.querySelector('.az-dock__side-actions');
    const root = sideActions || document;
    let action = null;

    if (kind === 'sms') {
      action = root.querySelector('#dockSms') ||
        closestVisibleIconButton(root, 'i.fal.fa-sms, i.fa-sms') ||
        null;
    }

    if (kind === 'email') {
      action = root.querySelector('#dockEmail') ||
        closestVisibleIconButton(root, 'i.fal.fa-paper-plane, i.fa-paper-plane') ||
        null;
    }

    if (action && exclude && exclude.has(action)) return null;
    return action;
  }

  function findDockActionCandidates(kind, exclude = new Set()) {
    const roots = getDockActionRoots();
    const candidates = [];

    for (const root of roots) {
      for (const el of findExplicitDockActionElements(root, kind)) {
        const action = normalizeActionElement(el);
        if (!action || exclude.has(action) || !isVisible(action) || isOwnActionElement(action)) continue;
        candidates.push({ action, score: 120 });
      }

      for (const el of Array.from(root.querySelectorAll('a,button,[role="button"],[onclick],.btn'))) {
        const action = normalizeActionElement(el);
        if (!action || exclude.has(action) || !isVisible(action) || isOwnActionElement(action)) continue;
        const score = scoreDockAction(action, kind);
        if (score > 0) candidates.push({ action, score });
      }
    }

    candidates.sort((a, b) => b.score - a.score);
    return uniqueElements(candidates.map((candidate) => candidate.action));
  }

  function findExplicitDockActionElements(root, kind) {
    const ids = kind === 'sms' ? ['dockSms'] : ['dockEmail'];
    const matches = [];
    for (const id of ids) {
      const direct = root.querySelector(`#${id}`);
      if (direct) matches.push(direct);
    }
    return matches;
  }

  function getDockActionRoots() {
    return uniqueElements([
      ...Array.from(document.querySelectorAll('.az-dock__side-actions')),
      ...Array.from(document.querySelectorAll('.az-dock__container')),
      ...Array.from(document.querySelectorAll('#serviceDetailDock')),
      ...Array.from(document.querySelectorAll('.az-dock')),
      document
    ]).filter((root) => root === document || (root && isVisible(root)));
  }

  function normalizeActionElement(el) {
    if (!(el instanceof Element)) return null;
    return el.closest('a,button,[role="button"],[onclick],.btn') || el;
  }

  function scoreDockAction(action, kind) {
    const signature = lower([
      action.id,
      action.className,
      action.getAttribute('title'),
      action.getAttribute('aria-label'),
      action.getAttribute('data-original-title'),
      action.getAttribute('data-target'),
      action.getAttribute('href'),
      action.textContent,
      Array.from(action.querySelectorAll('[id],i,[title],[aria-label]')).map((child) => [
        child.id,
        child.className,
        child.getAttribute('title'),
        child.getAttribute('aria-label')
      ].filter(Boolean).join(' ')).join(' ')
    ].filter(Boolean).join(' '));

    if (kind === 'sms') {
      if (/\bdocksms\b/.test(signature)) return 100;
      if (/\bfa-sms\b|\bsms\b|text message|send text|texting/.test(signature)) return 80;
      return 0;
    }

    if (kind === 'email') {
      if (/\bdockemail\b/.test(signature)) return 100;
      if (/\bfa-paper-plane\b|\bfa-envelope\b|\bemail\b|e-mail|send email/.test(signature)) return 80;
      return 0;
    }

    return 0;
  }

  function isOwnActionElement(el) {
    return !!(el && el.closest && (
      el.closest(`.${ACTION_GROUP_CLASS}`) ||
      el.closest(`.${TASK_CALL_BUTTON_CLASS}`) ||
      el.closest(CARD_SELECTOR)
    ));
  }

  function findComposer(kind) {
    const directSelectors = kind === 'sms'
      ? '#smsForm, form[action*="sms"], form[action*="SMS"]'
      : '#emailForm, form[action*="/common/email/send"], form[action*="email/send"], form[action*="Email"]';

    const direct = Array.from(document.querySelectorAll(directSelectors))
      .find((el) => isVisible(el));
    if (direct) return direct;

    const candidates = Array.from(document.querySelectorAll('.modal, .popover, form, [id*="compose"], [class*="compose"]'))
      .filter((el) => isVisible(el) && isComposerLike(el, kind));

    return candidates[0] || null;
  }

  function isComposerLike(el, kind) {
    const signature = lower([
      el.id,
      el.className,
      el.getAttribute('aria-label'),
      el.getAttribute('action'),
      el.textContent
    ].filter(Boolean).join(' ')).slice(0, 5000);

    if (kind === 'sms') {
      return !!el.querySelector('textarea, input[name*="phone"], input[name*="Phone"]') &&
        /\bsms\b|text message|send text|characters remaining|recipient|send/.test(signature);
    }

    if (kind === 'email') {
      return !!el.querySelector('input[type="email"], input[name*="email"], input[name*="Email"], input[name*="subject"], .cke, iframe, textarea') &&
        /\bemail\b|e-mail|subject|cc:|bcc:|recipient|send/.test(signature);
    }

    return false;
  }

  function uniqueElements(elements) {
    const seen = new Set();
    const unique = [];
    for (const el of elements) {
      if (!el || seen.has(el)) continue;
      seen.add(el);
      unique.push(el);
    }
    return unique;
  }

  function ticketDockMatches(ticketId, options = {}) {
    const dock = getDockScope();
    const sideActions = document.querySelector('.az-dock__side-actions');
    if (!dock && !sideActions) return false;

    const scope = dock || document.body;
    const html = String(scope.innerHTML || '');
    const exactMatch = html.includes(`"id":${ticketId}`) ||
      html.includes(`"id":"${ticketId}"`) ||
      html.includes(`leadId: ${ticketId}`) ||
      html.includes(`serviceTicketId: ${ticketId}`) ||
      html.includes(`ticketId: ${ticketId}`) ||
      html.includes(`data-referralid="${ticketId}"`) ||
      html.includes(`data-sourceleadid="${ticketId}"`) ||
      html.includes(`data-serviceticketid="${ticketId}"`) ||
      html.includes(`data-service-ticket-id="${ticketId}"`) ||
      html.includes(`data-ticketid="${ticketId}"`) ||
      html.includes(`data-ticket-id="${ticketId}"`) ||
      html.includes(`TaskModel.init({leadId: ${ticketId}`) ||
      serviceTicketIdPattern(ticketId).test(html);

    if (exactMatch) return true;

    if (options.allowTypeOnly && options.recordType) {
      const activeType = getActiveDockType();
      const signature = getDockSignature();
      return activeType === options.recordType &&
        !!signature &&
        signature !== options.previousDockSignature;
    }

    return false;
  }

  function serviceTicketIdPattern(ticketId) {
    return new RegExp(`(?:serviceTicketId|service_ticket_id|serviceId|ticketId|ticket_id|sourceId|source_id|id)["']?\\s*[:=]\\s*["']?${escapeRegExp(ticketId)}\\b`, 'i');
  }

  function getDockScope() {
    return document.querySelector('.az-dock__container') ||
      document.querySelector('#serviceDetailDock') ||
      document.querySelector('.az-dock') ||
      null;
  }

  function getActiveDockType() {
    const roots = [
      ...Array.from(document.querySelectorAll('.az-dock__side-actions')),
      getDockScope()
    ].filter(Boolean);

    for (const root of roots) {
      const appt = Array.from(root.querySelectorAll('.btn-appt-dock[data-type]'))
        .find((el) => isVisible(el));
      const type = clean(appt && appt.getAttribute('data-type')).toLowerCase();
      if (type) return type;
    }

    return '';
  }

  function getDockSignature() {
    const scope = getDockScope();
    const sideActions = document.querySelector('.az-dock__side-actions');
    const html = [
      scope ? scope.innerHTML : '',
      sideActions ? sideActions.innerHTML : ''
    ].join('');
    return clean(html).slice(0, 6000);
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
    const opener = findNoteOpener() || await waitFor(() => findNoteOpener(), 6000, 120);
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

    const stamped = await appendTimestampBlock(editor);
    if (!stamped) {
      if (btn) flashButton(btn, 'error', 'Could not add note divider');
      return null;
    }

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

  async function appendTimestampBlock(editor) {
    const stamp = formatPacificTimestamp();
    await sleep(NOTE_EDITOR_OPEN_DELAY_MS);
    await waitForNoteEditorSettled(editor);

    let quill = getQuillInstance(editor);
    const beforeSeparatorCount = countOccurrences(getEditorPlainText(editor, quill), NOTE_SEPARATOR);

    appendTimestampOnce(editor, quill, stamp);
    await sleep(NOTE_INSERT_VERIFY_MS);

    quill = getQuillInstance(editor);
    if (countOccurrences(getEditorPlainText(editor, quill), NOTE_SEPARATOR) > beforeSeparatorCount) {
      return true;
    }

    if (ensureSeparatorBeforeStamp(editor, quill, stamp, beforeSeparatorCount)) {
      return true;
    }

    await waitForNoteEditorSettled(editor, 450, 1800);
    quill = getQuillInstance(editor);
    appendTimestampOnce(editor, quill, stamp);
    await sleep(300);

    quill = getQuillInstance(editor);
    if (countOccurrences(getEditorPlainText(editor, quill), NOTE_SEPARATOR) > beforeSeparatorCount) {
      return true;
    }

    return ensureSeparatorBeforeStamp(editor, quill, stamp, beforeSeparatorCount);
  }

  function appendTimestampOnce(editor, quill, stamp) {
    if (appendTimestampQuill(editor, quill, stamp)) return true;

    appendTimestampDom(editor, stamp);
    return true;
  }

  function appendTimestampQuill(editor, quill, stamp) {
    if (!quill || typeof quill.insertText !== 'function' || typeof quill.getLength !== 'function') {
      return false;
    }

    try {
      const beforeText = getEditorPlainText(editor, quill);
      const insertAt = Math.max(0, quill.getLength() - 1);
      const textBeforeInsert = String(beforeText || '').slice(0, insertAt);
      const needsLeadingBreak = clean(textBeforeInsert) && !textBeforeInsert.endsWith('\n');
      const block = `${needsLeadingBreak ? '\n' : ''}${NOTE_SEPARATOR}\n${stamp}`;

      quill.focus();
      quill.insertText(insertAt, block, 'user');
      if (typeof quill.update === 'function') quill.update('user');
      if (typeof quill.setSelection === 'function') {
        quill.setSelection(insertAt + block.length, 0, 'user');
      }

      emitEditorInput(editor);
      return true;
    } catch {
      return false;
    }
  }

  function ensureSeparatorBeforeStamp(editor, quill, stamp, beforeSeparatorCount) {
    if (!quill || typeof quill.insertText !== 'function') return false;

    const text = getEditorPlainText(editor, quill);
    const stampIndex = text.lastIndexOf(stamp);
    if (stampIndex < 0) return false;

    const beforeStamp = text.slice(Math.max(0, stampIndex - NOTE_SEPARATOR.length - 4), stampIndex);
    if (beforeStamp.includes(NOTE_SEPARATOR)) {
      return countOccurrences(text, NOTE_SEPARATOR) > beforeSeparatorCount;
    }

    try {
      const needsLeadingBreak = stampIndex > 0 && text[stampIndex - 1] !== '\n';
      const insertText = `${needsLeadingBreak ? '\n' : ''}${NOTE_SEPARATOR}\n`;
      quill.insertText(stampIndex, insertText, 'user');
      if (typeof quill.update === 'function') quill.update('user');
      if (typeof quill.setSelection === 'function') {
        quill.setSelection(stampIndex + insertText.length + stamp.length, 0, 'user');
      }
      emitEditorInput(editor);
    } catch {
      return false;
    }

    return countOccurrences(getEditorPlainText(editor, quill), NOTE_SEPARATOR) > beforeSeparatorCount;
  }

  function appendTimestampDom(editor, stamp) {
    const hasText = clean(editor.textContent || '');

    if (!hasText) {
      editor.innerHTML = '';
    } else {
      editor.appendChild(document.createElement('p'));
    }

    const separatorP = document.createElement('p');
    separatorP.textContent = NOTE_SEPARATOR;
    editor.appendChild(separatorP);

    const stampP = document.createElement('p');
    stampP.textContent = stamp;
    editor.appendChild(stampP);

    focusEnd(stampP);
    emitEditorInput(editor);
  }

  function getEditorPlainText(editor, quill) {
    try {
      if (quill && typeof quill.getText === 'function') return String(quill.getText() || '');
    } catch {}
    return String(editor?.textContent || '');
  }

  async function waitForNoteEditorSettled(editor, stableMs = NOTE_EDITOR_STABLE_MS, timeoutMs = NOTE_EDITOR_STABLE_TIMEOUT_MS) {
    const started = Date.now();
    let lastSignature = '';
    let stableStarted = Date.now();

    while (Date.now() - started < timeoutMs) {
      const quill = getQuillInstance(editor);
      const text = getEditorPlainText(editor, quill);
      const signature = `${getEditorLength(editor, quill)}:${text.length}:${text.slice(-160)}`;

      if (signature === lastSignature) {
        if (Date.now() - stableStarted >= stableMs) return true;
      } else {
        lastSignature = signature;
        stableStarted = Date.now();
      }

      await sleep(120);
    }

    return false;
  }

  function getEditorLength(editor, quill) {
    try {
      if (quill && typeof quill.getLength === 'function') return quill.getLength();
    } catch {}
    return String(editor?.textContent || '').length;
  }

  function countOccurrences(text, needle) {
    if (!needle) return 0;
    return String(text || '').split(needle).length - 1;
  }

  function getQuillInstance(editor) {
    const page = getPageWindow();
    try {
      if (page.Quill && typeof page.Quill.find === 'function') {
        const direct = page.Quill.find(editor);
        if (direct && typeof direct.insertText === 'function') return direct;

        const container = editor.closest('.ql-container');
        const fromContainer = container ? page.Quill.find(container) : null;
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
    const page = getPageWindow();
    const MouseEventCtor = page.MouseEvent || MouseEvent;
    const opts = { bubbles: true, cancelable: true, view: page };
    hideAgencyZoomTooltips(el);
    el.dispatchEvent(new MouseEventCtor('mouseover', opts));
    el.dispatchEvent(new MouseEventCtor('mousedown', opts));
    el.dispatchEvent(new MouseEventCtor('mouseup', opts));
    el.dispatchEvent(new MouseEventCtor('click', opts));
    el.dispatchEvent(new MouseEventCtor('mouseout', opts));
    el.dispatchEvent(new MouseEventCtor('mouseleave', opts));
    hideAgencyZoomTooltips(el);
    setTimeout(() => hideAgencyZoomTooltips(el), 80);
    setTimeout(() => hideAgencyZoomTooltips(el), 350);
  }

  function hideAgencyZoomTooltips(sourceEl = null) {
    try {
      const page = getPageWindow();
      const $ = page.jQuery || page.$ || window.jQuery || window.$;
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

  function getPageWindow() {
    try {
      if (typeof unsafeWindow !== 'undefined' && unsafeWindow) return unsafeWindow;
    } catch {}
    return window;
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

    const labeledPhone = readLabeledValue(doc, ['Phone', 'Mobile', 'Cell', 'Telephone']);
    if (normalizePhone(labeledPhone)) return { phone: labeledPhone, source: 'lead contact phone label' };

    const selectors = [
      '#currentCustomerPhone',
      '#customerreferral-phone',
      'input[name="CustomerReferral[phone]"]',
      'input[type="tel"]',
      '#dockDialer',
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

  function buildRingCentralTelUrl(phone) {
    const digits = normalizePhone(phone);
    return digits ? `tel://${digits}` : '';
  }

  function callPhone(phone) {
    const href = buildRingCentralTelUrl(phone);
    if (!href) return;

    const link = document.createElement('a');
    link.href = href;
    link.target = '_blank';
    link.rel = 'noopener';
    link.style.position = 'fixed';
    link.style.left = '-9999px';
    link.style.top = '0';
    document.body.appendChild(link);
    link.click();
    setTimeout(() => link.remove(), 500);
  }

  function flashButton(btn, state, title) {
    clearButtonFlash(btn);
    btn.classList.remove('tm-az-call-loading', 'tm-az-call-ready', 'tm-az-call-error');
    if (state === 'loading') btn.classList.add('tm-az-call-loading');
    if (state === 'ready') btn.classList.add('tm-az-call-ready');
    if (state === 'error') btn.classList.add('tm-az-call-error');
    btn.setAttribute('aria-label', title || btn.dataset.label || 'AgencyZoom action');
    releaseButtonFocus(btn);

    const resetMs = FLASH_RESET_MS[state];
    if (resetMs) {
      btn.__tmAzFlashTimer = setTimeout(() => clearButtonFlash(btn), resetMs);
    }
  }

  function clearButtonFlash(btn) {
    if (!btn) return;
    if (btn.__tmAzFlashTimer) {
      clearTimeout(btn.__tmAzFlashTimer);
      btn.__tmAzFlashTimer = 0;
    }
    btn.classList.remove('tm-az-call-loading', 'tm-az-call-ready', 'tm-az-call-error', 'active', 'focus');
    btn.setAttribute('aria-label', btn.dataset.label || 'AgencyZoom action');
    releaseButtonFocus(btn);
  }

  function releaseButtonFocus(btn) {
    try {
      if (btn && document.activeElement === btn && typeof btn.blur === 'function') btn.blur();
    } catch {}
  }

  function closestTicketCard(el) {
    return el && el.closest ? el.closest(CARD_SELECTOR) : null;
  }

  function closestTicketId(el) {
    return getCardTicketId(closestTicketCard(el));
  }

  function getCurrentDetailTicketId() {
    let url = null;
    try {
      url = new URL(location.href);
    } catch {
      return '';
    }

    const path = String(url.pathname || '').replace(/\/+$/, '');
    if (path !== LEAD_DETAIL_PATH) return '';
    return extractTicketId(url.searchParams.get('id') || '');
  }

  function getCardTicketId(card) {
    if (!card) return '';

    const candidates = [
      card.getAttribute('data-id'),
      card.getAttribute('data-referralid'),
      card.getAttribute('data-sourceleadid'),
      card.getAttribute('data-serviceticketid'),
      card.getAttribute('data-service-ticket-id'),
      card.getAttribute('data-ticketid'),
      card.getAttribute('data-ticket-id'),
      card.id
    ];

    for (const value of candidates) {
      const id = extractTicketId(value);
      if (id) return id;
    }

    return '';
  }

  function getCardRecordType(card) {
    const signature = lower([
      card?.className,
      card?.id,
      card?.getAttribute?.('data-type'),
      card?.getAttribute?.('data-record-type'),
      card?.getAttribute?.('data-module'),
      card?.getAttribute?.('data-url'),
      card?.getAttribute?.('href'),
      card?.innerHTML?.slice?.(0, 3000)
    ].filter(Boolean).join(' '));

    if (/service/.test(signature)) return 'service';
    if (/referral|lead/.test(signature)) return 'lead';
    return '';
  }

  function extractTicketId(value) {
    const text = clean(value);
    if (!text) return '';

    const exact = text.match(/^\d{4,}$/);
    if (exact) return exact[0];

    const prefixed = text.match(/(?:referral|service|serviceticket|service-ticket|ticket|lead)[_-]?(\d{4,})/i);
    if (prefixed) return prefixed[1];

    const any = text.match(/\b(\d{5,})\b/);
    return any ? any[1] : '';
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

  function readLabeledValue(root, labels) {
    if (!root || !root.querySelectorAll) return '';

    const wanted = new Set(labels.map((label) => lower(label).replace(/[:\s]+$/g, '')));
    const rows = Array.from(root.querySelectorAll([
      '#lc-info-default .table-clean li',
      '.lead-contact .table-clean li',
      '.table-clean li'
    ].join(',')));

    for (const row of rows) {
      const spans = Array.from(row.querySelectorAll(':scope > span'));
      if (spans.length < 2) continue;

      const label = lower(clean(spans[0].textContent)).replace(/[:\s]+$/g, '');
      if (!wanted.has(label)) continue;

      const value = clean(spans.slice(1).map((span) => span.textContent).join(' '));
      if (normalizePhone(value)) return value;
    }

    return '';
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

  function escapeRegExp(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
      .${TASK_PHONE_ROW_CLASS} {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        max-width: 100%;
      }
      .${BUTTON_CLASS}.${TASK_CALL_BUTTON_CLASS} {
        flex: 0 0 22px;
        width: 22px;
        height: 22px;
        border-radius: 50%;
        color: #15803d;
        text-decoration: none !important;
      }
      .${BUTTON_CLASS}.${TASK_CALL_BUTTON_CLASS}:hover,
      .${BUTTON_CLASS}.${TASK_CALL_BUTTON_CLASS}:focus-visible {
        background: rgba(21, 128, 61, .12);
        color: #166534;
        text-decoration: none !important;
      }
      .${BUTTON_CLASS}.${TASK_CALL_BUTTON_CLASS} i {
        font-size: 14px;
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
