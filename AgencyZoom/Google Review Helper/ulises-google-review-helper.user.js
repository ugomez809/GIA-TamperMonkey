// ==UserScript==
// @name         Ulises AgencyZoom Google Review Helper
// @namespace    local.agencyzoom.ulises-google-review-helper
// @version      0.2.0
// @description  Checks Ulises Gomez Agency Google reviews for the active AgencyZoom SMS contact and fills the right SMS draft.
// @author       Ulises Gomez Agency
// @homepageURL  https://github.com/ugomez809/GIA-TamperMonkey
// @supportURL   https://github.com/ugomez809/GIA-TamperMonkey/issues
// @match        https://app.agencyzoom.com/integration/messages/index*
// @match        https://app.agencyzoom.com/pipeline/*
// @connect      docs.google.com
// @connect      googleusercontent.com
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-idle
// @noframes
// @icon         https://www.google.com/s2/favicons?sz=64&domain=agencyzoom.com
// @updateURL    https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/AgencyZoom/Google%20Review%20Helper/ulises-google-review-helper.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/AgencyZoom/Google%20Review%20Helper/ulises-google-review-helper.user.js
// ==/UserScript==

(function attachUlisesReviewHelper() {
  'use strict';

  const AGENCY_NAME = 'Ulises Gomez Agency';
  const SHEET_URL = 'https://docs.google.com/spreadsheets/d/1oAcXoR9E-Qi9P7aJDCGrYLjzS1VLb5ZwEeiBEnUxYNA/export?format=csv&gid=0';
  const SHEET_CACHE_KEY = 'ulisesReviewSheet:v1:1oAcXoR9E-Qi9P7aJDCGrYLjzS1VLb5ZwEeiBEnUxYNA:0';
  const ROOT_ID = 'ugomez-google-review-helper';
  const SHEET_REFRESH_MS = 4 * 60 * 60 * 1000;
  const MIN_REVIEW_SEARCH_LETTERS = 2;
  const PIPELINE_LOOKUP_CONCURRENCY = 3;

  const ASK_REVIEW_MESSAGE = [
    'Your feedback helps our agency recognize outstanding client service. If I helped you today, a quick Google review mentioning my name would mean a lot to me! https://gomezagency.net/feedback/',
    '',
    'Tu opinion ayuda a nuestra agencia a reconocer el excelente servicio de nuestro equipo. Si te ayude hoy, una breve resena en Google mencionando mi nombre significaria mucho para mi! https://gomezagency.net/feedback/'
  ].join('\n');

  const THANK_REVIEW_MESSAGE = [
    'Thank you for leaving us a Google review. Your feedback helps our agency recognize great service and helps other clients feel confident choosing us. I really appreciate you taking the time.',
    '',
    'Gracias por dejarnos una resena en Google. Tu opinion ayuda a nuestra agencia a reconocer el buen servicio y ayuda a otros clientes a sentirse seguros al elegirnos. De verdad aprecio que hayas tomado el tiempo.'
  ].join('\n');

  const reviewStore = createReviewStore({
    fetchCsv: requestSheetCsv,
    read: () => typeof GM_getValue === 'function' ? GM_getValue(SHEET_CACHE_KEY, '') : '',
    write: value => { if (typeof GM_setValue === 'function') GM_setValue(SHEET_CACHE_KEY, value); }
  });
  let lastRenderedName = '';
  let manualLookupName = '';
  let manualLookupStatus = 'idle';
  let manualLookupMessage = '';
  let manualLookupRows = [];
  let lookupSequence = 0;
  let manualLookupSequence = 0;
  let manualLookupTimer = 0;
  let pipelineLookupRunning = 0;
  const pipelineLookupQueue = [];

  function normalizeName(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function compactText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function getOwnText(element) {
    return Array.from(element.childNodes)
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent)
      .join(' ');
  }

  function stripPhoneFromName(value) {
    return compactText(value).replace(/\s*\(?\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4}\s*$/, '').trim();
  }

  function isLikelyCustomerFullName(value) {
    const normalized = normalizeName(value);
    if (!normalized || normalized.includes('unknown')) {
      return false;
    }

    const blockedPhrases = [
      'information notification',
      'create new lead',
      'link to existing',
      'active policies',
      'lifecycle automation',
      'my account',
      'customer since',
      'google review',
      'review check',
      'messages from',
      'acct producer csr',
      'at a glance'
    ];

    if (blockedPhrases.some((phrase) => normalized.includes(phrase))) {
      return false;
    }

    const parts = normalized.split(' ').filter(Boolean);
    return parts.length >= 2 && parts.length <= 5 && parts.every((part) => /^[a-z]+$/.test(part));
  }

  function countLetters(value) {
    return (String(value || '').match(/[a-z]/gi) || []).length;
  }

  function shouldSearchReviewLookup(value) {
    return countLetters(value) >= MIN_REVIEW_SEARCH_LETTERS;
  }

  function isServicePipelinePage() {
    return isPipelinePage() && hasServicePipelineHeader();
  }

  function isPipelinePage() {
    const path = String(window.location.pathname || '');
    return path.startsWith('/pipeline/');
  }

  function hasServicePipelineHeader() {
    return Array.from(document.querySelectorAll('h2'))
      .some((heading) => compactText(heading.textContent) === '1. Service Pipeline');
  }

  function formatReviewSearchSummary(query, rows) {
    if (!shouldSearchReviewLookup(query)) {
      return `Type at least ${MIN_REVIEW_SEARCH_LETTERS} letters of a customer name to search in ${AGENCY_NAME}.`;
    }

    const count = Array.isArray(rows) ? rows.length : 0;
    if (count === 0) {
      return `No matches in ${AGENCY_NAME}.`;
    }

    const countText = count >= 50 ? '50+ matches' : `${count} ${count === 1 ? 'match' : 'matches'}`;
    return `${countText} in ${AGENCY_NAME}.`;
  }

  function findInfoBoxesPanel() {
    const panels = Array.from(document.querySelectorAll('.tm-info-boxes'))
      .map((infoBoxes) => ({
        infoBoxes,
        content: infoBoxes.closest('.simplebar-content') || infoBoxes.parentElement
      }))
      .filter(({ content }) => content);

    return panels.find(({ content }) => /active policies|create new lead|link to existing|customer since|leads/i.test(content.textContent || '')) ||
      panels[0] ||
      null;
  }

  function findCustomerNameInPanel(panel, anchor) {
    if (!panel) {
      return '';
    }

    const elements = Array.from(panel.querySelectorAll('h1, h2, h3, h4, h5, [class*="name"], [class*="title"], span, div'))
      .filter((element) => {
        if (!anchor) {
          return true;
        }

        return !anchor.contains(element) &&
          Boolean(element.compareDocumentPosition(anchor) & Node.DOCUMENT_POSITION_FOLLOWING);
      });

    for (const element of elements) {
      const text = stripPhoneFromName(compactText(getOwnText(element) || (element.children.length === 0 ? element.textContent : '')));
      if (isLikelyCustomerFullName(text)) {
        return text;
      }
    }

    return '';
  }

  function findActiveFullName() {
    const panelMatch = findInfoBoxesPanel();
    const panelName = findCustomerNameInPanel(panelMatch && panelMatch.content, panelMatch && panelMatch.infoBoxes);
    if (panelName) {
      return panelName;
    }

    const activeThread = document.querySelector('.threadContainer a.active, .threadContainer .active, [class*="threadContainer"] a.active, [class*="threadContainer"] .active');
    if (activeThread) {
      const chunks = String(activeThread.innerText || activeThread.textContent || '')
        .split(/\n+/)
        .map((line) => stripPhoneFromName(line))
        .filter(Boolean);
      for (const chunk of chunks) {
        if (isLikelyCustomerFullName(chunk)) {
          return chunk;
        }
      }
    }

    const headingCandidates = Array.from(document.querySelectorAll('h1, h2, h3, h4, .conversation-name, .message-title'));
    for (const element of headingCandidates) {
      const text = stripPhoneFromName(element.textContent);
      if (isLikelyCustomerFullName(text)) {
        return text;
      }
    }

    return '';
  }

  function findMountPoint() {
    const panelMatch = findInfoBoxesPanel();
    if (panelMatch && panelMatch.infoBoxes.parentElement) {
      return {
        container: panelMatch.infoBoxes.parentElement,
        anchor: panelMatch.infoBoxes
      };
    }

    const container = document.querySelector('.message-container') ||
      document.querySelector('[class*="message-container"]') ||
      document.querySelector('.text-form-container') ||
      document.querySelector('#textForm') ||
      document.body;

    return {
      container,
      anchor: null
    };
  }

  function ensureRoot() {
    let root = document.getElementById(ROOT_ID);
    if (!root) {
      root = document.createElement('div');
      root.id = ROOT_ID;
      root.className = 'ugomez-review-helper';
    }

    const mount = findMountPoint();
    if (mount.anchor && mount.anchor.parentElement === mount.container) {
      if (root.parentElement !== mount.container || root.previousElementSibling !== mount.anchor) {
        mount.container.insertBefore(root, mount.anchor.nextSibling);
      }
    } else if (root.parentElement !== mount.container || root !== mount.container.firstElementChild) {
      mount.container.insertBefore(root, mount.container.firstChild);
    }

    injectStyles();
    return root;
  }

  function helperHasFocus() {
    const root = document.getElementById(ROOT_ID);
    return Boolean(root && document.activeElement && root.contains(document.activeElement));
  }

  function injectStyles() {
    if (document.getElementById(`${ROOT_ID}-style`)) {
      return;
    }

    const style = document.createElement('style');
    style.id = `${ROOT_ID}-style`;
    style.textContent = `
      #${ROOT_ID} {
        display: block;
        margin: 12px 0 0;
      }
      #${ROOT_ID} .ugomez-review-stack {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      #${ROOT_ID} .info-box {
        width: 100%;
        min-width: 0;
        border: 1px solid #e5e7eb;
        border-radius: 4px;
        background: #fff;
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
      }
      #${ROOT_ID} .ib-title {
        width: 100%;
        padding: 12px 14px;
        text-align: center;
      }
      #${ROOT_ID} .ib-title h2 {
        margin: 0;
        font-size: 30px;
        line-height: 1.1;
        font-weight: 700;
      }
      #${ROOT_ID} .ib-title small {
        display: block;
        margin-top: 3px;
        color: #6b7280;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0;
      }
      #${ROOT_ID} .ugomez-review-status.ugomez-ok,
      #${ROOT_ID} .ugomez-review-status.ugomez-no {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 38px;
        min-height: 38px;
        box-sizing: border-box;
        box-shadow: none;
        overflow: hidden;
      }
      #${ROOT_ID} .ugomez-review-status.ugomez-ok { background: #16803c; border-color: #16803c; }
      #${ROOT_ID} .ugomez-review-status.ugomez-no { background: #c62828; border-color: #c62828; }
      #${ROOT_ID} .ugomez-review-status.ugomez-ok .ib-title,
      #${ROOT_ID} .ugomez-review-status.ugomez-no .ib-title {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        height: 100%;
        padding: 0 8px;
      }
      #${ROOT_ID} .ugomez-review-status.ugomez-ok .ib-title h2,
      #${ROOT_ID} .ugomez-review-status.ugomez-no .ib-title h2 {
        color: #fff;
        font-size: 18px;
        line-height: 1;
      }
      #${ROOT_ID} .ugomez-review-status.ugomez-ok .ib-title small,
      #${ROOT_ID} .ugomez-review-status.ugomez-no .ib-title small {
        display: inline-block;
        color: #fff;
        margin-top: 0;
        font-size: 9px;
        line-height: 1;
      }
      #${ROOT_ID} .ugomez-ok h2 { color: #16803c; }
      #${ROOT_ID} .ugomez-no h2 { color: #c62828; }
      #${ROOT_ID} .ugomez-warn h2 { color: #996b00; }
      #${ROOT_ID} .ugomez-review-action.nav-link.active {
        display: inline-flex;
        align-items: center;
        justify-content: flex-start;
        min-height: 42px;
        width: 100%;
        padding: 8px 14px;
        border-radius: 4px;
        cursor: pointer;
        text-decoration: none;
        white-space: normal;
      }
      #${ROOT_ID} .ugomez-review-lookup-box {
        padding: 10px 12px;
      }
      #${ROOT_ID} .ugomez-review-search-form {
        width: 100%;
        margin: 0;
      }
      #${ROOT_ID} .ugomez-review-search-label {
        display: block;
        margin: 0 0 6px;
        color: #50698f;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0;
        text-transform: uppercase;
      }
      #${ROOT_ID} .ugomez-review-search-control {
        display: flex;
        align-items: stretch;
        width: 100%;
        height: 38px;
        border: 1px solid #d8dde6;
        border-radius: 4px;
        background: #fff;
        overflow: hidden;
      }
      #${ROOT_ID} .ugomez-review-search-input {
        flex: 1;
        min-width: 0;
        border: 0;
        outline: 0;
        padding: 0 10px;
        color: #001f4e;
        font-size: 13px;
        line-height: 38px;
      }
      #${ROOT_ID} .ugomez-review-search-input::placeholder {
        color: #9aa8bd;
      }
      #${ROOT_ID} .ugomez-review-search-button {
        width: 42px;
        border: 0;
        border-left: 1px solid #e5e7eb;
        background: #fff;
        color: #003e7e;
        cursor: pointer;
      }
      #${ROOT_ID} .ugomez-review-search-button:hover,
      #${ROOT_ID} .ugomez-review-search-button:focus {
        background: #f3f6fb;
      }
      #${ROOT_ID} .ugomez-review-manual-result {
        margin-top: 8px;
        color: #6b7280;
        font-size: 11px;
        line-height: 1.35;
      }
      #${ROOT_ID} .ugomez-review-manual-result.ugomez-ok {
        color: #126c35;
        font-weight: 700;
      }
      #${ROOT_ID} .ugomez-review-manual-result.ugomez-no {
        color: #c62828;
        font-weight: 700;
      }
      #${ROOT_ID} .ugomez-review-manual-result.ugomez-warn {
        color: #996b00;
      }
      #${ROOT_ID} .ugomez-review-match-list {
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin-top: 8px;
      }
      #${ROOT_ID} .ugomez-review-match {
        border-top: 1px solid #eef1f6;
        padding-top: 6px;
      }
      #${ROOT_ID} .ugomez-review-match-name {
        color: #001f4e;
        font-size: 12px;
        font-weight: 700;
        line-height: 1.25;
      }
      #${ROOT_ID} .ugomez-review-match-meta {
        color: #6b7280;
        font-size: 10px;
        line-height: 1.25;
      }
      #${ROOT_ID} .ugomez-review-note {
        color: #6b7280;
        font-size: 11px;
        line-height: 1.35;
      }
      .ugomez-pipeline-review-card {
        box-shadow: inset 4px 0 0 #6b7280;
      }
      .ugomez-pipeline-review-card.ugomez-reviewed {
        box-shadow: inset 4px 0 0 #16803c;
      }
      .ugomez-pipeline-review-card.ugomez-missing {
        box-shadow: inset 4px 0 0 #c62828;
      }
      .ugomez-pipeline-review-card.ugomez-checking {
        box-shadow: inset 4px 0 0 #6b7280;
      }
    `;
    document.head.appendChild(style);
  }

  function manualResultClass() {
    if (manualLookupStatus === 'matches') {
      return 'ugomez-ok';
    }

    if (manualLookupStatus === 'missing' || manualLookupStatus === 'error') {
      return 'ugomez-no';
    }

    return 'ugomez-warn';
  }

  function renderManualLookupResult() {
    const result = document.querySelector(`#${ROOT_ID} .ugomez-review-manual-result`);
    if (!result) {
      return;
    }

    result.className = `ugomez-review-manual-result ${manualResultClass()}`;
    result.textContent = '';
    result.hidden = !manualLookupMessage;

    const summary = document.createElement('div');
    summary.textContent = manualLookupMessage;
    result.appendChild(summary);

    if (manualLookupRows.length > 0) {
      const list = document.createElement('div');
      list.className = 'ugomez-review-match-list';

      manualLookupRows.slice(0, 8).forEach((row) => {
        const item = document.createElement('div');
        item.className = 'ugomez-review-match';

        const name = document.createElement('div');
        name.className = 'ugomez-review-match-name';
        name.textContent = row.reviewer_name || 'Unnamed reviewer';

        const meta = document.createElement('div');
        meta.className = 'ugomez-review-match-meta';
        const date = row.original_review_date || row.review_date || '';
        const rating = row.rating ? `${row.rating} star${Number(row.rating) === 1 ? '' : 's'}` : '';
        meta.textContent = [rating, date].filter(Boolean).join(' · ');

        item.append(name, meta);
        list.appendChild(item);
      });

      result.appendChild(list);
    }
  }

  async function runManualLookup(query) {
    const sequence = ++manualLookupSequence;

    if (!shouldSearchReviewLookup(query)) {
      manualLookupStatus = 'idle';
      manualLookupRows = [];
      manualLookupMessage = formatReviewSearchSummary(query, []);
      renderManualLookupResult();
      return;
    }

    manualLookupStatus = 'loading';
    manualLookupRows = [];
    manualLookupMessage = `Searching Google reviews for ${query}...`;
    renderManualLookupResult();

    try {
      const rows = await lookupReviewRows(query);
      if (sequence !== manualLookupSequence) {
        return;
      }

      manualLookupRows = rows;
      manualLookupStatus = rows.length > 0 ? 'matches' : 'missing';
      manualLookupMessage = formatReviewSearchSummary(query, rows) + (reviewStore.status().stale ? ' Cached list is stale; recent reviews may be missing.' : '');
      renderManualLookupResult();
    } catch (error) {
      if (sequence !== manualLookupSequence) {
        return;
      }

      manualLookupStatus = 'error';
      manualLookupRows = [];
      manualLookupMessage = `Could not read review sheet: ${error.message}`;
      renderManualLookupResult();
    }
  }

  function addManualLookupBox(stack, state) {
    const lookupBox = document.createElement('div');
    lookupBox.className = 'info-box row ml-0 ugomez-review-lookup-box';

    const form = document.createElement('form');
    form.className = 'ugomez-review-search-form';

    const label = document.createElement('label');
    label.className = 'ugomez-review-search-label';
    label.htmlFor = `${ROOT_ID}-manual-name`;
    label.textContent = 'Review lookup name';

    const control = document.createElement('div');
    control.className = 'ugomez-review-search-control';

    const input = document.createElement('input');
    input.id = `${ROOT_ID}-manual-name`;
    input.className = 'ugomez-review-search-input';
    input.type = 'search';
    input.autocomplete = 'off';
    input.placeholder = 'Customer name...';
    input.value = manualLookupName;

    const button = document.createElement('button');
    button.className = 'ugomez-review-search-button';
    button.type = 'submit';
    button.title = 'Search Google review';
    button.setAttribute('aria-label', 'Search Google review');
    button.innerHTML = '<i class="far fa-search" aria-hidden="true"></i>';

    const updateManualLookup = (debounced) => {
      const lookupName = stripPhoneFromName(input.value);
      manualLookupName = lookupName;
      window.clearTimeout(manualLookupTimer);

      if (!shouldSearchReviewLookup(lookupName)) {
        manualLookupSequence += 1;
        manualLookupRows = [];
        manualLookupStatus = 'idle';
        manualLookupMessage = formatReviewSearchSummary(lookupName, []);
        renderManualLookupResult();
        return;
      }

      if (debounced) {
        manualLookupTimer = window.setTimeout(() => runManualLookup(lookupName), 300);
        return;
      }

      runManualLookup(lookupName);
    };

    input.addEventListener('input', () => {
      updateManualLookup(true);
    });

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      updateManualLookup(false);
    });

    const result = document.createElement('div');
    result.className = `ugomez-review-manual-result ${manualResultClass()}`;
    result.textContent = manualLookupMessage || formatReviewSearchSummary(manualLookupName, []);
    result.hidden = false;

    control.append(input, button);
    form.append(label, control, result);
    lookupBox.appendChild(form);
    stack.appendChild(lookupBox);
  }

  function renderState(state) {
    const root = ensureRoot();
    const statusClass = state.status === 'reviewed' ? 'ugomez-ok' : state.status === 'missing' ? 'ugomez-no' : 'ugomez-warn';
    const symbol = state.status === 'reviewed' ? '✓' : state.status === 'missing' ? 'X' : '...';
    const label = state.status === 'reviewed' ? 'GOOGLE REVIEW' : state.status === 'missing' ? 'NO EXACT MATCH' : state.status === 'stale' ? 'STALE REVIEW LIST' : 'REVIEW CHECK';
    const buttonText = state.status === 'reviewed' ? 'Thanks for the Google Review' : 'Send Google Review Request';

    root.innerHTML = '';

    const stack = document.createElement('div');
    stack.className = 'ugomez-review-stack';
    root.appendChild(stack);

    const infoBox = document.createElement('div');
    infoBox.className = `info-box row ml-0 ugomez-review-status ${statusClass}`;
    infoBox.innerHTML = `<div class="ib-title"><h2>${symbol}</h2><small>${label}</small></div>`;
    stack.appendChild(infoBox);

    if (state.fullName && (state.status === 'reviewed' || state.status === 'missing')) {
      const actionBox = document.createElement('div');
      actionBox.className = 'info-box row ml-0 ugomez-review-action-box';

      const action = document.createElement('a');
      action.className = 'm-1 nav-link active ugomez-review-action';
      action.href = '#';
      action.textContent = buttonText;
      action.addEventListener('click', (event) => {
        event.preventDefault();
        fillSmsMessage(state.status === 'reviewed' ? THANK_REVIEW_MESSAGE : ASK_REVIEW_MESSAGE);
      });
      actionBox.appendChild(action);
      stack.appendChild(actionBox);
    }

    addManualLookupBox(stack, state);

    const note = document.createElement('div');
    note.className = 'ugomez-review-note';
    note.textContent = state.message;
    stack.appendChild(note);
    const sheetStatus = document.createElement('div');
    sheetStatus.className = 'ugomez-review-note ugomez-sheet-status';
    sheetStatus.textContent = sheetStatusText();
    const refreshButton = document.createElement('button');
    refreshButton.type = 'button';
    refreshButton.textContent = 'Refresh review sheet';
    refreshButton.addEventListener('click', async () => {
      refreshButton.disabled = true;
      refreshButton.textContent = 'Refreshing…';
      await refreshSheetAndView(true);
      refreshButton.disabled = false;
      refreshButton.textContent = 'Refresh review sheet';
      sheetStatus.textContent = sheetStatusText();
    });
    stack.append(sheetStatus, refreshButton);
  }

  function setNativeValue(element, value) {
    const prototype = element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');

    if (descriptor && descriptor.set) {
      descriptor.set.call(element, value);
    } else {
      element.value = value;
    }

    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.focus();
  }

  function fillSmsMessage(message) {
    const textarea = document.querySelector('textarea[placeholder="Type a message..."]') ||
      document.querySelector('textarea#textMessage') ||
      document.querySelector('textarea.form-control') ||
      document.querySelector('textarea');

    if (textarea) {
      setNativeValue(textarea, message);
      return true;
    }

    const editor = document.querySelector('.ql-editor[contenteditable="true"]');
    if (editor) {
      editor.textContent = message;
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      editor.focus();
      return true;
    }

    window.alert('Could not find the AgencyZoom SMS text box.');
    return false;
  }

  // Parse RFC-style CSV without splitting quoted comments containing commas/newlines.
  function parseReviewCsv(text) {
    text = String(text || '').replace(/^\uFEFF/, '');
    if (/^\s*</.test(text)) throw new Error('Google returned a sign-in page instead of CSV. Check sheet sharing.');
    const grid = [];
    let row = [], cell = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '"') {
        if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
        else quoted = !quoted;
      } else if (!quoted && (c === ',' || c === '\r' || c === '\n')) {
        row.push(cell); cell = '';
        if (c !== ',') { grid.push(row); row = []; if (c === '\r' && text[i + 1] === '\n') i++; }
      } else cell += c;
    }
    if (quoted) throw new Error('Incomplete CSV download.');
    if (cell || row.length) { row.push(cell); grid.push(row); }
    const headers = (grid.shift() || []).map(value => value.trim().toLowerCase());
    const nameIndex = headers.indexOf('name');
    const dateIndex = headers.indexOf('timestamp');
    const ratingIndex = headers.indexOf('rating 1-5');
    const idIndex = headers.indexOf('review id');
    if (nameIndex < 0 || dateIndex < 0 || ratingIndex < 0) throw new Error('Sheet needs Name, Timestamp and Rating 1-5 columns.');
    const rows = grid.filter(values => values.some(value => value.trim())).map(values => {
      if (values.length !== headers.length) throw new Error('Incomplete or malformed CSV row.');
      return { reviewer_name: values[nameIndex].trim(), rating: values[ratingIndex].trim(),
        original_review_date: values[dateIndex].trim(), id: idIndex < 0 ? '' : values[idIndex].trim() };
    }).filter(value => normalizeName(value.reviewer_name));
    if (!rows.length) throw new Error('Sheet has no reviewer names; keeping previous data.');
    rows.sort((a, b) => b.original_review_date.localeCompare(a.original_review_date));
    return rows;
  }

  function createReviewStore({ fetchCsv, read, write, now = () => Date.now() }) {
    let rows = [], index = new Map(), fetchedAt = 0, inFlight = null, retryAt = 0, error = '';
    let lastStorageRead = -Infinity;
    function install(data) {
      rows = data.rows; fetchedAt = data.fetchedAt;
      index = new Map();
      rows.forEach(row => {
        const key = normalizeName(row.reviewer_name);
        if (!index.has(key)) index.set(key, []);
        index.get(key).push(row);
      });
    }
    function loadSaved() {
      if (now() - lastStorageRead < 60000) return;
      lastStorageRead = now();
      try {
        const saved = JSON.parse(read() || 'null');
        if (saved && saved.version === 1 && Number.isFinite(saved.fetchedAt) && saved.fetchedAt > fetchedAt && saved.fetchedAt <= now() &&
          Array.isArray(saved.rows) && saved.rows.length && saved.rows.every(row => row && typeof row.reviewer_name === 'string' && normalizeName(row.reviewer_name))) install(saved);
      } catch { /* Unavailable storage or corrupt cache: download a fresh copy. */ }
    }
    loadSaved();
    async function ensure(force = false) {
      loadSaved();
      if (inFlight) return inFlight;
      if (!force && rows.length && now() - fetchedAt < SHEET_REFRESH_MS) return;
      if (!force && now() < retryAt) {
        if (!rows.length) throw new Error(error || 'Review sheet unavailable.');
        return;
      }
      inFlight = (async () => {
        try {
          const nextRows = parseReviewCsv(await fetchCsv());
          const data = { version: 1, fetchedAt: now(), rows: nextRows };
          install(data); error = ''; retryAt = 0;
          try { write(JSON.stringify(data)); } catch { /* Keep working from memory if storage is full. */ }
        } catch (failure) {
          error = failure.message || String(failure); retryAt = now() + 5 * 60 * 1000;
          if (!rows.length) throw failure;
        }
      })();
      try { await inFlight; } finally { inFlight = null; }
    }
    return {
      ensure,
      exact: name => index.get(normalizeName(name)) || [],
      search: name => {
        const query = normalizeName(name), result = [];
        if (!query) return result;
        for (const row of rows) {
          if (normalizeName(row.reviewer_name).includes(query)) result.push(row);
          if (result.length >= 50) break;
        }
        return result;
      },
      status: () => ({ fetchedAt, count: rows.length, stale: !fetchedAt || now() - fetchedAt >= SHEET_REFRESH_MS, error })
    };
  }

  function requestSheetCsv() {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET', url: SHEET_URL + '&_=' + Date.now(), anonymous: true, timeout: 30000,
        onload: response => {
          if (response.status !== 200) { reject(new Error('Sheet download returned HTTP ' + response.status)); return; }
          resolve(String(response.responseText || ''));
        },
        onerror: () => reject(new Error('Sheet download failed. Check connection and sharing.')),
        ontimeout: () => reject(new Error('Sheet download timed out.'))
      });
    });
  }

  async function lookupReviewRows(fullName) {
    await reviewStore.ensure();
    return reviewStore.search(fullName);
  }

  async function lookupReview(fullName) {
    await reviewStore.ensure();
    const rows = reviewStore.exact(fullName);
    return { reviewed: rows.length > 0, rows, reviewNames: rows.map(row => row.reviewer_name) };
  }

  function sheetStatusText() {
    const state = reviewStore.status();
    if (!state.fetchedAt) return state.error || 'Review sheet has not loaded yet.';
    return state.count + ' reviews · Updated ' + new Date(state.fetchedAt).toLocaleString() +
      (state.stale ? ' · STALE — latest reviews may be missing.' : '') +
      (state.error ? ' · Refresh failed: ' + state.error : '');
  }

  async function refreshSheetAndView(force = false) {
    const before = JSON.stringify(reviewStore.status());
    try { await reviewStore.ensure(force); } catch { /* Show unavailable state through normal UI. */ }
    if (!force && before === JSON.stringify(reviewStore.status())) return;
    lastRenderedName = '';
    findServicePipelineCards().forEach(card => { delete card.dataset.ugomezReviewName; });
    if (isServicePipelinePage()) refreshPipelineBadges();
    else if (!isPipelinePage()) {
      if (!force && helperHasFocus()) {
        const status = document.querySelector('#' + ROOT_ID + ' .ugomez-sheet-status');
        if (status) status.textContent = sheetStatusText();
        return;
      }
      await refresh();
      if (shouldSearchReviewLookup(manualLookupName)) runManualLookup(manualLookupName);
    }
  }

  function findServicePipelineCards() {
    return Array.from(document.querySelectorAll('#servicePipeline .dd-card.referral-container, #completed-pool .dd-card.referral-container'));
  }

  function extractPipelineCardName(card) {
    const lines = String(card.innerText || card.textContent || '')
      .split(/\n+/)
      .map((line) => stripPhoneFromName(line))
      .filter(Boolean);

    for (const line of lines) {
      if (isLikelyCustomerFullName(line)) {
        return line;
      }
    }

    return '';
  }

  function setPipelineBadge(card, status) {
    card.classList.add('ugomez-pipeline-review-card');
    card.classList.remove('ugomez-reviewed', 'ugomez-missing', 'ugomez-checking');

    const statusClass = status === 'reviewed' ? 'ugomez-reviewed' : status === 'missing' ? 'ugomez-missing' : 'ugomez-checking';
    const statusLabel = status === 'reviewed' ? 'Google review found' : status === 'missing' ? 'No exact review name match in sheet' : status === 'error' ? 'Review sheet unavailable' : status === 'stale' ? 'Stale review list; refresh needed' : 'Checking Google review';

    card.classList.add(statusClass);
    card.title = statusLabel + ' · ' + sheetStatusText();
  }

  function processPipelineLookupQueue() {
    while (pipelineLookupRunning < PIPELINE_LOOKUP_CONCURRENCY && pipelineLookupQueue.length > 0) {
      const item = pipelineLookupQueue.shift();
      if (!item.card.isConnected || item.card.dataset.ugomezReviewName !== item.normalizedName) {
        continue;
      }

      pipelineLookupRunning += 1;
      lookupReview(item.fullName)
        .then((result) => {
          if (!item.card.isConnected || item.card.dataset.ugomezReviewName !== item.normalizedName) {
            return;
          }

          setPipelineBadge(item.card, result.reviewed ? 'reviewed' : reviewStore.status().stale ? 'stale' : 'missing');
        })
        .catch(() => {
          if (!item.card.isConnected || item.card.dataset.ugomezReviewName !== item.normalizedName) {
            return;
          }

          setPipelineBadge(item.card, 'error');
        })
        .finally(() => {
          pipelineLookupRunning -= 1;
          processPipelineLookupQueue();
        });
    }
  }

  function queuePipelineReviewLookup(card, fullName) {
    const normalizedName = normalizeName(fullName);
    if (!normalizedName) {
      return;
    }

    if (card.dataset.ugomezReviewName === normalizedName && card.classList.contains('ugomez-pipeline-review-card')) {
      return;
    }

    card.dataset.ugomezReviewName = normalizedName;
    setPipelineBadge(card, 'loading');
    pipelineLookupQueue.push({ card, fullName, normalizedName });
    processPipelineLookupQueue();
  }

  function refreshPipelineBadges() {
    injectStyles();

    findServicePipelineCards().forEach((card) => {
      const fullName = extractPipelineCardName(card);
      if (!fullName) {
        return;
      }

      queuePipelineReviewLookup(card, fullName);
    });
  }

  async function refresh() {
    const activeFullName = findActiveFullName();
    const fullName = activeFullName;
    if (!fullName) {
      lastRenderedName = '';
      renderState({
        status: 'idle',
        fullName: '',
        message: 'Open a conversation with a full customer name to check for a Google review.'
      });
      return;
    }

    if (fullName === lastRenderedName && document.getElementById(ROOT_ID)) {
      ensureRoot();
      return;
    }

    lastRenderedName = fullName;
    const sequence = ++lookupSequence;
    renderState({
      status: 'loading',
      fullName,
      message: `Checking Google review for ${fullName}...`
    });

    try {
      const result = await lookupReview(fullName);
      if (sequence !== lookupSequence) {
        return;
      }

      renderState({
        status: result.reviewed ? 'reviewed' : reviewStore.status().stale ? 'stale' : 'missing',
        fullName,
        message: result.reviewed
          ? `${fullName} has an exact Google review match in ${AGENCY_NAME}.`
          : `${fullName} has no exact name match in the review sheet.`
      });
    } catch (error) {
      if (sequence !== lookupSequence) {
        return;
      }

      renderState({
        status: 'error',
        fullName,
        message: `Could not read review sheet: ${error.message}`
      });
    }
  }

  const observer = new MutationObserver((mutations) => {
    if (isPipelinePage()) {
      if (!isServicePipelinePage()) {
        return;
      }

      window.clearTimeout(observer.timer);
      observer.timer = window.setTimeout(refreshPipelineBadges, 500);
      return;
    }

    const root = document.getElementById(ROOT_ID);
    if (root && mutations.every((mutation) => root.contains(mutation.target))) {
      return;
    }

    if (helperHasFocus()) {
      return;
    }

    window.clearTimeout(observer.timer);
    observer.timer = window.setTimeout(refresh, 300);
  });

  // Timer also refreshes long-lived tabs; shared GM storage avoids repeat downloads on navigation.
  window.setInterval(() => { if (!document.hidden) refreshSheetAndView(); }, 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshSheetAndView(); });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  if (isServicePipelinePage()) {
    refreshPipelineBadges();
  } else if (isPipelinePage()) {
    // Wait for the specific Service Pipeline header; do not run the SMS helper on other pipelines.
  } else {
    refresh();
  }
})();
