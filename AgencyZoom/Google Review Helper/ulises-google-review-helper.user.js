// ==UserScript==
// @name         Ulises AgencyZoom Google Review Helper
// @namespace    local.agencyzoom.ulises-google-review-helper
// @version      0.4.2
// @description  Checks Ulises Gomez Agency Google reviews for the active AgencyZoom SMS contact and fills the right SMS draft.
// @author       Ulises Gomez Agency
// @homepageURL  https://github.com/ugomez809/GIA-TamperMonkey
// @supportURL   https://github.com/ugomez809/GIA-TamperMonkey/issues
// @match        https://app.agencyzoom.com/integration/messages/index*
// @match        https://app.agencyzoom.com/pipeline/*
// @connect      script.google.com
// @connect      docs.google.com
// @connect      googleusercontent.com
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
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

  const MATCH_SERVICE_URL = 'https://script.google.com/macros/s/AKfycbxSQX_8WnbX54WJQTqJJB9jB6x4s68yeAKAsP7nsSrMo1r-LXwPyVHSs0gTgSc0YgKt/exec'; // Deployed service; staff key is stored locally.
  const MATCH_CONFIG_KEY = 'ulisesReviewMatches:config';
  const AGENCY_NAME = 'Ulises Gomez Agency';
  const SHEET_URL = 'https://docs.google.com/spreadsheets/d/1oAcXoR9E-Qi9P7aJDCGrYLjzS1VLb5ZwEeiBEnUxYNA/export?format=csv&gid=0';
  const SHEET_CACHE_KEY = 'ulisesReviewSheet:v3:1oAcXoR9E-Qi9P7aJDCGrYLjzS1VLb5ZwEeiBEnUxYNA:0';
  const ROOT_ID = 'ugomez-google-review-helper';
  const SHEET_REFRESH_MS = 60 * 60 * 1000;
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
    write: value => { if (typeof GM_setValue === 'function') GM_setValue(SHEET_CACHE_KEY, value); },
    readConfirmation: row => typeof GM_getValue === 'function' ? GM_getValue(SHEET_CACHE_KEY + ':match:' + reviewIdentity(row), '') : '',
    writeConfirmation: (row,value) => { if (typeof GM_setValue === 'function') GM_setValue(SHEET_CACHE_KEY + ':match:' + reviewIdentity(row), value); }
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
  const surfaceStates = new WeakMap();
  const smsRowStates = new WeakMap();
  let reviewPopover = null;
  let popoverOwner = null;
  let popoverCloseTimer = 0;

  function normalizeName(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function nameWords(value) {
    return [...new Set(normalizeName(value).split(' ').filter(word => word.length > 1 && /[a-z]/.test(word)))];
  }

  function isKnownReviewName(value) {
    return Boolean(nameWords(value).length) && !/^(unknown|unmatched|no name|loading)(\b|$)/i.test(compactText(value));
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
      'at a glance',
      'visit history'
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
    const contact = document.querySelector('.tm-header-title .contact-name');
    if (contact) {
      const name = stripPhoneFromName(contact.textContent);
      return isKnownReviewName(name) ? name : '';
    }
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
      .ugomez-pipeline-review-card.ugomez-partial {
        box-shadow: inset 4px 0 0 #e0a000;
      }
      #${ROOT_ID} .ugomez-partial { background: #fff3bf; color: #664d03; }
      [data-ugomez-review-status="reviewed"] { --ugomez-review-tint: rgba(22, 128, 60, .13); --ugomez-review-border: #16803c; }
      [data-ugomez-review-status="partial"] { --ugomez-review-tint: rgba(224, 160, 0, .16); --ugomez-review-border: #d99a00; }
      [data-ugomez-review-status="missing"] { --ugomez-review-tint: rgba(198, 40, 40, .12); --ugomez-review-border: #c62828; }
      #threadContainer a.thread[data-ugomez-review-status] {
        box-shadow: inset 4px 0 0 var(--ugomez-review-border);
      }
      #threadContainer h6.thread-name { display: inline; }
      #threadContainer .ugomez-review-icon { width: 24px; height: 24px; margin-left: 6px; }
      .ugomez-confirm-review { margin: 6px 0 6px 8px; padding: 3px 7px; cursor: pointer; border: 1px solid #16803c; border-radius: 4px; background: white; color: #146c32; }
      .ugomez-confirm-feedback { display: block; font-size: 12px; white-space: normal; }
      .ugomez-review-icon {
        display: inline-flex; align-items: center; justify-content: center;
        width: 28px; height: 28px; margin-left: 8px; padding: 4px;
        border: 1px solid #dadce0; border-radius: 50%; background: #fff;
        cursor: pointer; vertical-align: middle; flex-shrink: 0;
      }
      .ugomez-review-icon svg { width: 18px; height: 18px; pointer-events: none; }
      .ugomez-review-icon:focus-visible { outline: 2px solid #4285f4; outline-offset: 2px; }
      .ugomez-review-popover {
        position: fixed; z-index: 2147483646; width: 390px; max-width: calc(100vw - 16px);
        max-height: min(480px, calc(100vh - 24px)); overflow: auto; overscroll-behavior: contain;
        box-sizing: border-box; padding: 16px; border: 1px solid #d5dbe2; border-radius: 10px;
        background: #fff; color: #202124; box-shadow: 0 8px 30px #0003;
        font: 13px/1.5 Arial, sans-serif; text-align: left;
      }
      .ugomez-review-popover h4 { font: bold 15px/1.4 Arial, sans-serif; margin: 0 0 6px; color: inherit; }
      .ugomez-review-popover .ugomez-review-disclaimer { color: #705300; margin: 0 0 10px; }
      .ugomez-review-popover article { border-top: 1px solid #e5e7eb; margin-top: 12px; padding-top: 10px; }
      .ugomez-review-match .ugomez-review-comment,
      .ugomez-review-popover .ugomez-review-comment { white-space: pre-wrap; overflow-wrap: anywhere; margin-top: 6px; }
      .ugomez-review-popover .ugomez-review-meta { color: #5f6368; font-size: 12px; }
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

        const comment = document.createElement('div');
        comment.className = 'ugomez-review-comment';
        comment.textContent = row.comment || 'No review text provided.';

        name.append(createConfirmationControl(row, activeConfirmationName));
        item.append(name, meta, comment);
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
    const statusClass = state.status === 'reviewed' ? 'ugomez-ok' : state.status === 'missing' ? 'ugomez-no' : state.status === 'partial' ? 'ugomez-partial' : 'ugomez-warn';
    const symbol = state.status === 'reviewed' ? '✓' : state.status === 'missing' ? 'X' : '...';
    const label = state.status === 'reviewed' ? 'GOOGLE REVIEW' : state.status === 'missing' ? 'NO NAME MATCH' : state.status === 'partial' ? 'POSSIBLE REVIEW' : state.status === 'stale' ? 'STALE REVIEW LIST' : 'REVIEW CHECK';
    const buttonText = state.status === 'reviewed' ? 'Thanks for the Google Review' : 'Send Google Review Request';

    root.innerHTML = '';
    if (!state.fullName) {
      const lookupStack = document.createElement('div');
      lookupStack.className = 'ugomez-review-stack';
      root.appendChild(lookupStack);
      addManualLookupBox(lookupStack, state);
      const note = document.createElement('div');
      note.className = 'ugomez-review-note';
      note.textContent = 'Missing name';
      lookupStack.appendChild(note);
      renderManualLookupResult();
      return;
    }

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
    stack.append(sheetStatus);
    renderManualLookupResult();
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

  function reviewIdentity(row) {
    return JSON.stringify([row.id || '', row.reviewer_name || '', row.original_review_date || '', row.rating || '', row.comment || '', row.page || '']);
  }

  function hasConfirmation(row, name) {
    return (row.confirmedNames || []).some(value => normalizeName(value) === normalizeName(name));
  }

  function activeConfirmationName() {
    const ticket = document.querySelector('#serviceDetailDock');
    const header = ticket && !ticket.classList.contains('d-none') && ticket.querySelector('#currentCustomerName');
    const name = header ? stripPhoneFromName(header.textContent) : findActiveFullName();
    return isKnownReviewName(name) ? name : '';
  }

  function readMatchConfig() {
    try {
      const value = JSON.parse(GM_getValue(MATCH_CONFIG_KEY, '{}'));
      return {url: value.url || MATCH_SERVICE_URL, token: value.token || ''};
    } catch { return {url: MATCH_SERVICE_URL, token: ''}; }
  }

  function configureMatchWrites() {
    const saved = readMatchConfig();
    const url = window.prompt('Shared review save URL (Apps Script /exec URL):', saved.url);
    if (url === null) return;
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[a-zA-Z0-9_-]+\/exec$/.test(url.trim())) {
      window.alert('Use the deployed Apps Script /exec URL.'); return;
    }
    const token = window.prompt('Staff review-save key (provided by your administrator):', '');
    if (token === null) return;
    if (token.trim().length < 32) { window.alert('The save key must be at least 32 characters.'); return; }
    GM_setValue(MATCH_CONFIG_KEY, JSON.stringify({url:url.trim(),token:token.trim()}));
    window.alert('Shared review saves configured. Reload AgencyZoom to apply.');
  }

  function postMatchRequests(requests) {
    const config = readMatchConfig();
    if (!config.url || !config.token) return Promise.reject(Error('Shared saves need setup. Use Tampermonkey → Configure shared review saves.'));
    return new Promise((resolve,reject) => {
      GM_xmlhttpRequest({method:'POST', url:config.url, anonymous:true, timeout:30000,
        headers:{'Content-Type':'text/plain;charset=utf-8'},
        data:JSON.stringify({token:config.token,requests}),
        onload:response => {
          try {
            if (response.status < 200 || response.status >= 300) throw Error('Save service returned HTTP ' + response.status);
            const data = JSON.parse(response.responseText);
            if (!data.ok || !Array.isArray(data.results) || data.results.length !== requests.length) throw Error(data.error || 'Invalid save response.');
            resolve(data.results);
          } catch (error) { reject(Error(error.message.startsWith('Unexpected') ? 'Save service is unavailable or requires sign-in.' : error.message)); }
        }, onerror:()=>reject(Error('Could not reach the save service. Nothing was confirmed locally.')),
        ontimeout:()=>reject(Error('Save timed out. Retry safely; duplicate confirmations are ignored.'))
      });
    });
  }

  function updateConfirmedViews() {
    lastRenderedName = '';
    findServicePipelineCards().forEach(card => { delete card.dataset.ugomezReviewName; });
    if (isServicePipelinePage()) refreshPipelineBadges();
    else refresh();
  }

  function createConfirmationControl(row, getName) {
    const wrap = document.createElement('span');
    const button = document.createElement('button');
    const feedback = document.createElement('span');
    button.type = 'button'; button.className = 'ugomez-confirm-review';
    feedback.className = 'ugomez-confirm-feedback'; feedback.setAttribute('role','status');
    const customerName = getName();
    let confirmed = hasConfirmation(row,customerName);
    const exact = normalizeName(row.reviewer_name) === normalizeName(customerName);
    function paint() {
      button.textContent = confirmed ? (exact ? '✓ Confirmed' : '✓ Confirmed · Undo') : '✓';
      button.disabled = !isKnownReviewName(customerName) || (confirmed && exact);
      button.title = !customerName ? 'Open a customer with a name to confirm this review.' :
        (confirmed ? 'Confirmed for ' : 'Confirm review for ') + customerName;
      button.setAttribute('aria-label',button.title);
    }
    paint();
    button.addEventListener('click', async event => {
      event.preventDefault(); event.stopPropagation();
      if (normalizeName(getName()) !== normalizeName(customerName)) { feedback.textContent='Customer changed. Reopen the review results.'; return; }
      button.disabled = true; feedback.textContent = 'Saving…';
      try {
        const [result] = await postMatchRequests([{review:row,customerName,action:confirmed ? 'remove' : 'confirm'}]);
        if (!result.ok || !Array.isArray(result.names)) throw Error(result.error || 'Confirmation was not saved.');
        const names = reviewStore.applyConfirmation(row,result.names,result.revision);
        row.confirmedNames = names || result.names;
        confirmed = hasConfirmation(row,customerName);
        feedback.textContent = confirmed ? 'Saved for ' + customerName : 'Confirmation removed';
        updateConfirmedViews();
      } catch (error) { feedback.textContent = error.message; }
      paint();
    });
    wrap.append(button,feedback);
    return wrap;
  }

  const automaticMatchQueue = new Map();
  const automaticMatchRetry = new Map();
  const automaticMatchAttempts = new Map();
  let automaticMatchTimer = 0, automaticMatchRunning = false;
  function queueAutomaticMatches(name, rows) {
    const config = readMatchConfig();
    if (!config.url || !config.token) return;
    rows.forEach(row => {
      if (normalizeName(row.reviewer_name) !== normalizeName(name) || hasConfirmation(row,name)) return;
      const key = reviewIdentity(row) + normalizeName(name);
      if ((automaticMatchAttempts.get(key) || 0) >= 3 || (automaticMatchRetry.get(key) || 0) > Date.now()) return;
      automaticMatchQueue.set(key,{review:row,customerName:name,action:'auto'});
    });
    if (automaticMatchQueue.size && !automaticMatchTimer && !automaticMatchRunning) automaticMatchTimer = window.setTimeout(flushAutomaticMatches,1500);
  }
  async function flushAutomaticMatches() {
    automaticMatchTimer = 0;
    if (automaticMatchRunning) return;
    automaticMatchRunning = true;
    const batch = [...automaticMatchQueue.entries()].filter(([key]) => (automaticMatchRetry.get(key) || 0) <= Date.now()).slice(0,25);
    batch.forEach(([key]) => { automaticMatchQueue.delete(key); automaticMatchRetry.set(key,Date.now()+5*60*1000); });
    let changed = false;
    try {
      if (!batch.length) return;
      const results = await postMatchRequests(batch.map(([,request])=>request));
      results.forEach((result,i) => {
        if (!result.ok || !Array.isArray(result.names)) return;
        reviewStore.applyConfirmation(batch[i][1].review,result.names,result.revision); automaticMatchAttempts.delete(batch[i][0]); changed = true;
      });
    } catch {
      batch.forEach(([key,request]) => {
        const attempts = (automaticMatchAttempts.get(key) || 0) + 1;
        automaticMatchAttempts.set(key,attempts);
        if (attempts < 3) automaticMatchQueue.set(key,request);
      });
    }
    finally {
      automaticMatchRunning = false;
      if (changed) updateConfirmedViews();
      if (automaticMatchQueue.size) {
        const next = Math.min(...[...automaticMatchQueue.keys()].map(key => automaticMatchRetry.get(key) || 0));
        automaticMatchTimer = window.setTimeout(flushAutomaticMatches,Math.max(1500,next-Date.now()));
      }
    }
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
    const commentIndex = headers.indexOf('comments');
    const pageIndex = headers.indexOf('gmb page');
    const matchesIndex = headers[8] === 'agencyzoom matches' ? 8 : -1;
    if (nameIndex < 0 || dateIndex < 0 || ratingIndex < 0) throw new Error('Sheet needs Name, Timestamp and Rating 1-5 columns.');
    const rows = grid.filter(values => values.some(value => value.trim())).map(values => {
      if (values.length !== headers.length) throw new Error('Incomplete or malformed CSV row.');
      return { reviewer_name: values[nameIndex].trim(), rating: values[ratingIndex].trim(),
        original_review_date: values[dateIndex].trim(), id: idIndex < 0 ? '' : values[idIndex].trim(),
        comment: commentIndex < 0 ? '' : values[commentIndex].trim(), page: pageIndex < 0 ? '' : values[pageIndex].trim(),
        confirmedNames: matchesIndex < 0 ? [] : values[matchesIndex].split(/\r?\n/).map(name => name.trim()).filter(isKnownReviewName) };
    }).filter(value => normalizeName(value.reviewer_name));
    if (!rows.length) throw new Error('Sheet has no reviewer names; keeping previous data.');
    rows.sort((a, b) => b.original_review_date.localeCompare(a.original_review_date));
    return rows;
  }

  function createReviewStore({ fetchCsv, read, write, readConfirmation = () => '', writeConfirmation = () => {}, now = () => Date.now() }) {
    let rows = [], index = new Map(), tokenIndex = new Map(), fetchedAt = 0, snapshotStartedAt = 0, updatedAt = 0, revision = 0, inFlight = null, retryAt = 0, error = '';
    let lastStorageRead = -Infinity;
    function savedConfirmation(row) {
      try {
        const saved = JSON.parse(readConfirmation(row) || 'null');
        return saved && Number.isFinite(saved.revision) && Number.isFinite(saved.receivedAt) && Array.isArray(saved.names) && saved.names.every(n => typeof n === 'string') ? saved : null;
      } catch { return null; }
    }
    function install(data, overlays = true) {
      rows = data.rows; fetchedAt = data.fetchedAt; snapshotStartedAt = data.fetchStartedAt || fetchedAt; updatedAt = data.updatedAt || fetchedAt; revision++;
      if (overlays) rows.forEach(row => {
        const saved = savedConfirmation(row);
        if (saved && saved.receivedAt >= snapshotStartedAt) row.confirmedNames = saved.names;
      });
      index = new Map();
      tokenIndex = new Map();
      rows.forEach(row => {
        const names = [row.reviewer_name, ...(row.confirmedNames || [])];
        [...new Set(names.map(normalizeName))].forEach(key => {
          if (!index.has(key)) index.set(key, []);
          index.get(key).push(row);
          nameWords(key).forEach(word => {
            if (!tokenIndex.has(word)) tokenIndex.set(word, new Set());
            tokenIndex.get(word).add(row);
          });
        });
      });
    }
    function loadSaved() {
      if (now() - lastStorageRead < 60000) return;
      lastStorageRead = now();
      try {
        const saved = JSON.parse(read() || 'null');
        if (saved && saved.version === 3 && Number.isFinite(saved.fetchedAt) && (saved.updatedAt || saved.fetchedAt) > updatedAt && saved.fetchedAt <= now() &&
          Array.isArray(saved.rows) && saved.rows.length && saved.rows.every(row => row && typeof row.reviewer_name === 'string' && normalizeName(row.reviewer_name) && Array.isArray(row.confirmedNames) && row.confirmedNames.every(n => typeof n === 'string'))) install(saved);
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
        const fetchStartedAt = now();
        try {
          const nextRows = parseReviewCsv(await fetchCsv());
          const data = { version: 3, fetchStartedAt, fetchedAt: now(), updatedAt: now(), rows: nextRows };
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
      applyConfirmation: (review, names, serverRevision = Math.max(now(),updatedAt+1)) => {
        const target = rows.find(row => reviewIdentity(row) === reviewIdentity(review));
        if (!target) return;
        const saved = savedConfirmation(review);
        if (saved && saved.revision > serverRevision) names = saved.names;
        else {
          try { writeConfirmation(review,JSON.stringify({revision:serverRevision,receivedAt:now(),names})); } catch { /* Keep current tab usable. */ }
        }
        target.confirmedNames = names;
        install({fetchedAt,fetchStartedAt:snapshotStartedAt,updatedAt:Math.max(now(),updatedAt+1),rows},false);
        return names;
      },
      exact: name => index.get(normalizeName(name)) || [],
      match: name => {
        const exactRows = index.get(normalizeName(name)) || [];
        const candidates = new Set(exactRows);
        nameWords(name).forEach(word => (tokenIndex.get(word) || []).forEach(row => candidates.add(row)));
        const exactSet = new Set(exactRows);
        const matches = [...exactRows, ...rows.filter(row => candidates.has(row) && !exactSet.has(row))];
        return { status: exactRows.length ? 'reviewed' : matches.length ? 'partial' : 'missing', rows: matches, exactRows };
      },
      search: name => {
        const query = normalizeName(name), result = [];
        if (!query) return result;
        for (const row of rows) {
          if (normalizeName(row.reviewer_name).includes(query)) result.push(row);
          if (result.length >= 50) break;
        }
        return result;
      },
      status: () => ({ fetchedAt, revision, count: rows.length, stale: !fetchedAt || now() - fetchedAt >= SHEET_REFRESH_MS, error })
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
    const result = reviewStore.match(fullName);
    queueAutomaticMatches(fullName, result.exactRows);
    return { ...result, reviewed: result.status === 'reviewed', reviewNames: result.rows.map(row => row.reviewer_name) };
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
    refreshReviewSurfaces();
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

  function isReviewUiMutation(mutation) {
    const owned = node => node && node.nodeType === 1 &&
      (node.matches('.ugomez-review-icon, .ugomez-review-popover') || node.closest('.ugomez-review-icon, .ugomez-review-popover'));
    if (owned(mutation.target.nodeType === 1 ? mutation.target : mutation.target.parentElement)) return true;
    const nodes = [...mutation.addedNodes, ...mutation.removedNodes];
    return nodes.length > 0 && nodes.every(owned);
  }

  function closeReviewPopover() {
    window.clearTimeout(popoverCloseTimer);
    reviewPopover?.remove();
    if (popoverOwner) popoverOwner.setAttribute('aria-expanded', 'false');
    reviewPopover = null;
    popoverOwner = null;
  }

  function schedulePopoverClose() {
    window.clearTimeout(popoverCloseTimer);
    popoverCloseTimer = window.setTimeout(closeReviewPopover, 250);
  }

  function showReviewPopover(button, name, result) {
    closeReviewPopover();
    popoverOwner = button;
    button.setAttribute('aria-expanded', 'true');
    const panel = document.createElement('div');
    panel.id = ROOT_ID + '-reviews';
    panel.className = 'ugomez-review-popover';
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', 'Matching Google reviews');
    panel.tabIndex = 0;
    const heading = document.createElement('h4');
    heading.textContent = result.status === 'unnamed' ? 'Missing name' : name + ' · ' + result.rows.length + ' matching reviews';
    const disclaimer = document.createElement('p');
    disclaimer.className = 'ugomez-review-disclaimer';
    disclaimer.textContent = result.status === 'unnamed' ? 'Use Review Lookup Name on the right to search for this customer.' : result.status === 'error' ? 'Review sheet unavailable. Try again after refreshing.' :
      result.rows.length ? 'Shared names are possible matches, not proof of identity. Exact names appear first.' :
      'No matching name words in the cached review sheet.';
    const cacheNote = document.createElement('div');
    cacheNote.className = 'ugomez-review-meta';
    cacheNote.textContent = sheetStatusText();
    panel.append(heading, disclaimer);
    if (result.status !== 'unnamed') panel.append(cacheNote);
    result.rows.forEach(row => {
      const article = document.createElement('article');
      const title = document.createElement('strong');
      title.textContent = row.reviewer_name;
      const meta = document.createElement('div');
      meta.className = 'ugomez-review-meta';
      meta.textContent = [row.rating ? row.rating + '/5 stars' : '', row.original_review_date,
        row.page, normalizeName(row.reviewer_name) === normalizeName(name) ? 'Exact name' : hasConfirmation(row, name) ? 'Confirmed match' : 'Possible match'].filter(Boolean).join(' · ');
      const comment = document.createElement('div');
      comment.className = 'ugomez-review-comment';
      comment.textContent = row.comment || 'No review text provided.';
      const reviewHeading = document.createElement('div');
      reviewHeading.append(title, createConfirmationControl(row, () => name));
      article.append(reviewHeading, meta, comment);
      panel.appendChild(article);
    });
    panel.addEventListener('mouseenter', () => window.clearTimeout(popoverCloseTimer));
    panel.addEventListener('mouseleave', schedulePopoverClose);
    panel.addEventListener('focusin', () => window.clearTimeout(popoverCloseTimer));
    panel.addEventListener('focusout', event => { if (!panel.contains(event.relatedTarget)) schedulePopoverClose(); });
    panel.addEventListener('keydown', event => { if (event.key === 'Escape') { closeReviewPopover(); button.suppressReviewFocus = true; button.focus(); } });
    document.body.appendChild(panel);
    reviewPopover = panel;
    const rect = button.getBoundingClientRect();
    const height = panel.getBoundingClientRect().height;
    panel.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - panel.offsetWidth - 8)) + 'px';
    panel.style.top = Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - height - 8)) + 'px';
  }

  function mountReviewIcon(header, name, result) {
    let button = header.parentElement.querySelector('.ugomez-review-icon');
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'ugomez-review-icon';
      button.setAttribute('aria-controls', ROOT_ID + '-reviews');
      button.setAttribute('aria-expanded', 'false');
      // Inline logo: no image fetch or tracking request on hover.
      button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.9-1.75 2.98-4.33 2.98-7.36z"/><path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.62-2.41l-3.24-2.51c-.9.6-2.05.96-3.38.96-2.61 0-4.83-1.76-5.62-4.12H3.04v2.59A10 10 0 0 0 12 22z"/><path fill="#FBBC05" d="M6.38 13.92A6 6 0 0 1 6.07 12c0-.67.11-1.32.31-1.92V7.49H3.04A10 10 0 0 0 2 12c0 1.61.38 3.14 1.04 4.51z"/><path fill="#EA4335" d="M12 5.96c1.47 0 2.79.51 3.82 1.51l2.87-2.87A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.96 5.49l3.34 2.59C7.17 7.72 9.39 5.96 12 5.96z"/></svg>';
      header.insertAdjacentElement('afterend', button);
      button.addEventListener('mouseenter', () => button.openReviews());
      button.addEventListener('mouseleave', schedulePopoverClose);
      button.addEventListener('focus', () => {
        if (button.suppressReviewFocus) button.suppressReviewFocus = false;
        else button.openReviews();
      });
      button.addEventListener('blur', event => { if (!reviewPopover?.contains(event.relatedTarget)) schedulePopoverClose(); });
      button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); button.openReviews(); reviewPopover?.focus(); });
      button.addEventListener('keydown', event => { if (event.key === 'Escape') closeReviewPopover(); });
    }
    button.setAttribute('aria-label', result.status === 'unnamed' ? 'Google reviews: Missing name' : 'Google reviews for ' + name + ': ' + result.rows.length + ' matches');
    button.openReviews = () => showReviewPopover(button, name, result);
  }

  function setSurfaceTint(background, status) {
    const value = ['reviewed', 'partial', 'missing'].includes(status) ? status : '';
    if (background.getAttribute('data-ugomez-review-status') === (value || null)) return;
    if (value) background.setAttribute('data-ugomez-review-status', value);
    else background.removeAttribute('data-ugomez-review-status');
  }

  async function refreshReviewSurface(header, background, tint = true) {
    if (!header || !background) return;
    const name = stripPhoneFromName(header.textContent);
    const signature = name + JSON.stringify(reviewStore.status());
    const previous = surfaceStates.get(header);
    if (previous?.signature === signature && previous.background === background &&
        (previous.pending || !isKnownReviewName(name) || header.parentElement.querySelector('.ugomez-review-icon'))) return;
    if (popoverOwner && header.parentElement.contains(popoverOwner)) closeReviewPopover();
    header.parentElement.querySelector('.ugomez-review-icon')?.remove();
    setSurfaceTint(background, 'loading');
    const state = { signature, background, pending: true };
    surfaceStates.set(header, state);
    if (!isKnownReviewName(name)) {
      if (header.matches('.contact-name')) mountReviewIcon(header, '', { status: 'unnamed', rows: [] });
      state.pending = false; return;
    }
    let result;
    try { result = await lookupReview(name); }
    catch { result = {status: 'error', rows: []}; }
    if (!header.isConnected || surfaceStates.get(header) !== state || stripPhoneFromName(header.textContent) !== name) return;
    const status = result.status === 'missing' && reviewStore.status().stale ? 'stale' : result.status;
    setSurfaceTint(background, tint ? status : '');
    mountReviewIcon(header, name, result);
    state.pending = false;
    state.signature = name + JSON.stringify(reviewStore.status());
  }

  function refreshReviewSurfaces() {
    if (popoverOwner && (!popoverOwner.isConnected || !popoverOwner.getClientRects().length)) closeReviewPopover();
    injectStyles();
    const ticket = document.querySelector('#serviceDetailDock');
    refreshReviewSurface(ticket?.querySelector('#currentCustomerName'), ticket, false);
    const smsHeader = document.querySelector('.tm-header-title .contact-name');
    const messages = document.querySelector('#message-container');
    if (messages) setSurfaceTint(messages, '');
    refreshReviewSurface(smsHeader, messages, false);
    document.querySelectorAll('#threadContainer a.thread').forEach(refreshSmsRow);
  }

  function extractSmsRowName(row) {
    const name = stripPhoneFromName(row.querySelector('h6.thread-name')?.textContent || '');
    return isKnownReviewName(name) ? name : '';
  }

  async function refreshSmsRow(row) {
    const name = extractSmsRowName(row);
    const signature = name + JSON.stringify(reviewStore.status());
    const previous = smsRowStates.get(row);
    if (previous?.signature === signature && (previous.pending || row.querySelector('.ugomez-review-icon'))) return;
    if (popoverOwner && row.contains(popoverOwner)) closeReviewPopover();
    row.querySelector('.ugomez-review-icon')?.remove();
    const state = { signature, pending: true };
    smsRowStates.set(row, state);
    setSurfaceTint(row, '');
    if (!name) {
      const header = row.querySelector('h6.thread-name');
      if (header) mountReviewIcon(header, '', { status: 'unnamed', rows: [] });
      state.pending = false; return;
    }
    let result;
    try { result = await lookupReview(name); }
    catch { result = { status: 'error', rows: [] }; }
    if (!row.isConnected || smsRowStates.get(row) !== state || extractSmsRowName(row) !== name) return;
    setSurfaceTint(row, result.status === 'missing' && reviewStore.status().stale ? 'stale' : result.status);
    mountReviewIcon(row.querySelector('h6.thread-name'), name, result);
    state.pending = false;
    state.signature = name + JSON.stringify(reviewStore.status());
  }

  function extractPipelineCardName(card) {
    const name = card.querySelector('.cardes-template-item[gs-id="name"] a.customer');
    if (name) return stripPhoneFromName(name.textContent);
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
    card.classList.remove('ugomez-reviewed', 'ugomez-partial', 'ugomez-missing', 'ugomez-checking');

    const statusClass = status === 'reviewed' ? 'ugomez-reviewed' : status === 'missing' ? 'ugomez-missing' : status === 'partial' ? 'ugomez-partial' : 'ugomez-checking';
    const statusLabel = status === 'reviewed' ? 'Google review found' : status === 'missing' ? 'No review name match in sheet' : status === 'partial' ? 'Possible review match — shared name word' : status === 'error' ? 'Review sheet unavailable' : status === 'stale' ? 'Stale review list; refresh needed' : 'Checking Google review';

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

          setPipelineBadge(item.card, result.status === 'missing' && reviewStore.status().stale ? 'stale' : result.status);
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

    if (card.dataset.ugomezReviewName === normalizedName && card.dataset.ugomezReviewVersion === '0.4.0' && card.classList.contains('ugomez-pipeline-review-card')) {
      return;
    }

    card.dataset.ugomezReviewName = normalizedName;
    card.dataset.ugomezReviewVersion = '0.4.0';
    setPipelineBadge(card, 'loading');
    pipelineLookupQueue.push({ card, fullName, normalizedName });
    processPipelineLookupQueue();
  }

  function refreshPipelineBadges() {
    injectStyles();
    refreshReviewSurfaces();

    findServicePipelineCards().forEach((card) => {
      const fullName = extractPipelineCardName(card);
      if (!fullName) {
        return;
      }

      queuePipelineReviewLookup(card, fullName);
    });
  }

  async function refresh() {
    refreshReviewSurfaces();
    const activeFullName = findActiveFullName();
    const fullName = activeFullName;
    if (!fullName) {
      lastRenderedName = '';
      ++lookupSequence;
      renderState({
        status: 'idle',
        fullName: '',
        message: 'Missing name'
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
        status: result.status === 'missing' && reviewStore.status().stale ? 'stale' : result.status,
        fullName,
        message: result.reviewed
          ? `${fullName} has an exact or confirmed Google review match in ${AGENCY_NAME}.`
          : result.status === 'partial' ? `${fullName} has possible matches by name. Check the Google icon before deciding.`
          : `${fullName} has no name match in the review sheet.`
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

  if (typeof GM_registerMenuCommand === 'function') GM_registerMenuCommand('Configure shared review saves', configureMatchWrites);

  const observer = new MutationObserver((mutations) => {
    if (mutations.every(mutation => isReviewUiMutation(mutation))) return;
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
  document.addEventListener('pointerdown', event => {
    if (reviewPopover && !reviewPopover.contains(event.target) && !popoverOwner?.contains(event.target)) closeReviewPopover();
  }, true);
  window.addEventListener('resize', closeReviewPopover);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  if (isServicePipelinePage()) {
    refreshPipelineBadges();
  } else if (isPipelinePage()) {
    // Wait for the specific Service Pipeline header; do not run the SMS helper on other pipelines.
  } else {
    refresh();
  }
})();
