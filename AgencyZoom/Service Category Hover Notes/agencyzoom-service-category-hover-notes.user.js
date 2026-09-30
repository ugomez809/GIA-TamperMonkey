// ==UserScript==
// @name         AgencyZoom Service Category Hover Notes
// @namespace    local.agencyzoom.service-category-hover-notes
// @version      0.14
// @description  Shows test explanation notes when hovering AgencyZoom service category options.
// @match        https://app.agencyzoom.com/*
// @exclude      https://app.agencyzoom.com/login*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @connect      docs.google.com
// @updateURL    https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/AgencyZoom/Service%20Category%20Hover%20Notes/agencyzoom-service-category-hover-notes.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/AgencyZoom/Service%20Category%20Hover%20Notes/agencyzoom-service-category-hover-notes.user.js
// ==/UserScript==

(function () {
  'use strict';

  const SCRIPT = 'AZ Service Category Notes';
  const STYLE_ID = 'tm-az-service-category-notes-style';
  const TOOLTIP_ID = 'tm-az-service-category-notes-tooltip';
  const INFO_ID = 'tm-az-service-category-info';
  const COLOR_CLASS = 'tm-az-service-category-colored';
  const NOTE_ATTR = 'data-tm-az-service-category-note';
  const LABEL_ATTR = 'data-tm-az-service-category-label';
  const SCAN_DELAY_MS = 150;
  const CATEGORY_CONTEXT_TTL_MS = 5000;
  const SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSoO19AJiWlA-OCOgH3t8G44FRr8yZB9gcZzqOm6tnAwT3FIuXZTChryq0LkxEUsVGYHj-04xYxftZX/pub?gid=0&single=true&output=csv';
  const NOTES_CACHE_KEY = 'tmAzServiceCategoryNotes.cache.v3';
  const NOTES_REFRESH_MS = 5 * 60 * 1000;
  const SECTION_COLORS = {
    Service: '#DCEEFF',
    Billing: '#FFF0BF',
    Claims: '#FFE1E1',
    Doc: '#EEE2FF',
    Renewals: '#DCF6E5',
    Other: '#E9EDF2'
  };
  const SECTION_HOVER_COLORS = {
    Service: '#C7E2FA',
    Billing: '#EBDCA8',
    Claims: '#F4CCCC',
    Doc: '#DCCBFA',
    Renewals: '#C7E8D2',
    Other: '#D5DAE2'
  };

  const CATEGORY_NOTES = {
    'Service: Address / Contact Update': 'The customer mailing, billing or garaging address, phone, email or name changed. Update it on the policy. Type: You pick.',
    'Service: Auto Vehicle / Driver Change': 'Adding, removing or replacing a car or driver on an auto policy, including permitted or excluded drivers. Type: You pick.',
    'Service: Billing Change': 'The customer changes how or when they pay: autopay or EFT, card or bank, pay plan or due date. Type: You pick.',
    'Service: Carrier Request': 'The carrier asks us for something that does not fit another category, like an agent action needed alert. Type: You pick.',
    'Service: COI/EOI Request': 'Someone only needs proof of insurance: a dec page, EOI, COI, ID cards or a policy copy. Type: You pick.',
    'Service: Coverage Change': 'Changing what the policy covers: deductibles, limits, coverages, endorsements, discounts or policy details. Type: You pick.',
    'Service: Inspection': 'A carrier inspection or its results, such as roof or tree problems and photos to send. Type: You pick.',
    'Service: Mileage Change': 'Only the annual mileage changes, usually with odometer photos. Type: You pick.',
    'Service: Mortgagee Change': 'Adding, changing or removing a mortgagee, lender or lienholder, no matter who asked. Type: You pick.',
    'Service: Payment Taken': 'The customer asked to pay and we took the payment for them. Type: You pick.',
    'Service: Policy Cancellation': 'A policy is being cancelled because the customer asked or the carrier confirmed it. Type: You pick.',
    'Service: Policy Review / FFR': 'An FFR or policy review with the customer. It stays here even if the review ends in changes. Type: You pick.',
    'Service: Policy Transfer': 'Policies moving into our agency from another agent or agency. Type: You pick.',
    'Service: Quote / Requote / Rewrite': 'Quoting new coverage for an existing customer, requoting with another carrier, or rewriting a policy. Type: You pick.',
    'Service: UW Issue / Retention': 'The carrier wants to non-renew or surcharge, or needs underwriting items. We work to keep the policy. Type: You pick.',
    'Billing: 1 pay': 'Carrier alert that a payment is due on a policy paid in full once a year. Type: Carrier alert.',
    'Billing: 2 pay': 'Carrier alert that an installment is due on a policy paid in two payments. Type: Carrier alert.',
    'Billing: 3 pay': 'Carrier alert that an installment is due on a policy paid in three payments. Type: Carrier alert.',
    'Billing: 4 pay': 'Carrier alert that an installment is due on a policy paid in four payments. Type: Rarely used.',
    'Billing: CEA Payments': 'California Earthquake Authority payments that are due, missing or causing a cancellation notice. Type: Carrier alert.',
    'Billing: CFP Mortgagee': 'CFP payment-due alerts when the mortgage company or escrow pays the FAIR Plan bill. Type: Carrier alert.',
    'Billing: CFP Payments': 'California FAIR Plan payment-due alerts and CFP billing problems. Type: Carrier alert.',
    'Billing: Invalid Payment': 'A payment failed, was declined, returned or NSF, or the carrier sent a non-pay notice. Type: Carrier alert.',
    'Billing: Life Policy': 'Billing items on a life insurance policy, such as withdrawals or payments due. Type: Carrier alert.',
    'Billing: Monthly': 'Carrier alert that a monthly-pay policy has a payment due, or a billing question with no change and no payment. Type: Carrier alert.',
    'Claims: Commercial': 'A claim on a business policy. Type: Rarely used.',
    'Claims: Life Insurance': 'A claim on a life insurance policy. Type: Rarely used.',
    'Claims: Personal': 'A claim on a personal policy, like glass, towing or an accident. Type: You pick.',
    'Doc: (New Biz) Condo Water Sensor (Leak Doc)': 'A new condo policy needs proof of a water leak sensor. Type: Carrier alert.',
    'Doc: (New Biz) General Documents NO Auto': 'A new policy without auto is missing signed paperwork or items, like an application or the Aegis DIC form. Type: Carrier alert.',
    'Doc: (New Biz) General Documents WITH Auto': 'A new policy that includes auto is missing paperwork, like registration, odometer or vehicle photos. Type: Carrier alert.',
    'Doc: (New Biz) Water Device': 'A new home policy needs proof of a water shut-off device, invoice and photos. Type: Carrier alert.',
    'Doc: (Renewal) Affinity Discount Doc': 'Proof needed at renewal to keep an affinity or group discount. Type: Rarely used.',
    'Doc: (Renewal) Auto UW': 'Documents the carrier needs to renew an auto policy, like good student grades. Type: Carrier alert.',
    'Doc: (Renewal) Home UW': 'Documents the carrier needs to renew a home policy, like a signed renewal form. Type: Carrier alert.',
    'Doc: (Renewal) Other Carrier Decs (Umbrella)': 'Dec pages from another carrier needed to keep an umbrella policy at renewal. Type: Rarely used.',
    'Doc: (Renewal) Senior Course': 'A mature or senior driver course certificate needed for the discount. Type: Carrier alert.',
    'Doc: (Renewal) Water Device': 'Proof of a water shut-off device needed at renewal. Type: Rarely used.',
    'Doc: Discovered Driver': 'The carrier found a household driver who is not on the policy. We add or exclude them. Type: Carrier alert.',
    'Doc: Fair Plan Dec': 'The carrier needs a copy of the customer California FAIR Plan dec page. Type: Rarely used.',
    'Doc: Payment Auth Form (EFT)': 'The only open item is a missing signed EFT or payment authorization form. Type: Rarely used.',
    'Renewals: Commercial': 'Business policy renewal tickets. Type: Rarely used.',
    'Mono-Line Home Renewals': 'Renewal tickets for customers who only have a home policy with us. Type: Carrier alert.',
    'Renewals: Personal': 'Personal policy renewal tickets that automation creates. Do not pick this by hand. Type: Automatic.',
    'Commercial Policy Change': 'Any change to a business or commercial policy. Type: You pick.',
    'General': 'Do not use. Pick the category that matches what the customer or carrier needed. Type: Do not use.',
    'Unknown': 'Do not use. If you cannot tell what a ticket is about, ask before saving it. Type: Do not use.'
  };

  const OPTION_SELECTOR = [
    '[role="option"]',
    '.select2-results__option',
    '.ng-option',
    '.mat-option',
    '.dropdown-menu li',
    '.dropdown-menu .dropdown-item',
    '.select2-results li',
    'li[aria-selected]'
  ].join(',');

  const CATEGORY_CONTROL_SELECTOR = [
    '[aria-label*="category" i]',
    '[placeholder*="category" i]',
    '[name*="category" i]',
    '[id*="category" i]',
    '[formcontrolname*="category" i]'
  ].join(',');

  let scanTimer = 0;
  let activeTarget = null;
  let activeOption = null;
  let hideInfoTimer = 0;
  let categoryDropdownArmed = false;
  let lastCategoryInteractionAt = 0;
  let lastNotesRefreshAt = 0;
  let notesRefreshPromise = null;
  const decoratedOptions = new WeakSet();
  const coloredOptions = new WeakMap();

  boot();

  function boot() {
    if (!isAgencyZoom()) return;
    injectStyle();
    ensureTooltip();
    ensureInfoMarker();
    installCategoryContextListeners();
    loadCachedCategoryNotes();
    console.info(`[${SCRIPT}] loaded test hover notes`, Object.keys(CATEGORY_NOTES));
  }

  function isAgencyZoom() {
    return /(^|\.)app\.agencyzoom\.com$/i.test(String(location.hostname || ''));
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${TOOLTIP_ID} {
        position: fixed;
        z-index: 2147483647;
        display: none;
        max-width: 320px;
        padding: 9px 11px;
        border: 1px solid rgba(25, 31, 40, 0.14);
        border-radius: 6px;
        background: #ffffff;
        color: #1f2933;
        box-shadow: 0 10px 28px rgba(16, 24, 40, 0.18);
        font: 13px/1.35 Arial, Helvetica, sans-serif;
        pointer-events: none;
      }
      #${TOOLTIP_ID} strong {
        display: block;
        margin: 0 0 4px;
        font-size: 12px;
        color: #30445f;
      }
      #${INFO_ID} {
        position: fixed;
        z-index: 2147483647;
        display: none;
        align-items: center;
        justify-content: center;
        width: 15px;
        height: 15px;
        border: 1px solid rgba(48, 68, 95, 0.32);
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.96);
        color: #30445f;
        cursor: help !important;
        font: 700 10px/1 Arial, Helvetica, sans-serif;
        pointer-events: auto;
      }
      #${INFO_ID}:hover,
      #${INFO_ID}:focus {
        border-color: #30445f;
        background: #eef4fb;
      }
      .${COLOR_CLASS} {
        background-color: var(--tm-az-service-category-color) !important;
      }
      .${COLOR_CLASS} > * {
        background-color: transparent !important;
      }
      .${COLOR_CLASS}:hover > *,
      .${COLOR_CLASS}:focus > * {
        background-color: transparent !important;
      }
    `;

    appendToHead(style);
  }

  function appendToHead(node) {
    const target = document.head || document.documentElement;
    if (target) {
      target.appendChild(node);
      return;
    }

    document.addEventListener('DOMContentLoaded', () => appendToHead(node), { once: true });
  }

  function ensureTooltip() {
    let tooltip = document.getElementById(TOOLTIP_ID);
    if (tooltip) return tooltip;

    tooltip = document.createElement('div');
    tooltip.id = TOOLTIP_ID;
    tooltip.setAttribute('role', 'tooltip');
    document.documentElement.appendChild(tooltip);
    return tooltip;
  }

  function ensureInfoMarker() {
    let info = document.getElementById(INFO_ID);
    if (info) return info;

    info = document.createElement('span');
    info.id = INFO_ID;
    info.textContent = 'i';
    info.tabIndex = 0;
    info.setAttribute('role', 'img');
    info.setAttribute('aria-label', 'Service category information');
    info.addEventListener('mouseenter', handlePointerEnter);
    info.addEventListener('mousemove', handlePointerMove);
    info.addEventListener('mouseleave', hideTooltip);
    info.addEventListener('focus', handleFocus);
    info.addEventListener('blur', hideTooltip);
    info.addEventListener('pointerenter', () => window.clearTimeout(hideInfoTimer));
    info.addEventListener('pointerleave', scheduleHideInfoMarker);
    document.documentElement.appendChild(info);
    return info;
  }

  function installCategoryContextListeners() {
    document.addEventListener('pointerdown', rememberIfCategoryControl, true);
    document.addEventListener('focusin', rememberIfCategoryControl, true);
    document.addEventListener('keydown', rememberIfCategoryControl, true);
  }

  function rememberIfCategoryControl(event) {
    const target = event.target;
    if (!(target instanceof Element)) return;

    if (isPipelineOrStageControl(target)) {
      categoryDropdownArmed = false;
      lastCategoryInteractionAt = 0;
      hideTooltip();
      return;
    }

    if (isCategoryControl(target)) {
      categoryDropdownArmed = true;
      lastCategoryInteractionAt = Date.now();
      refreshCategoryNotesFromSheet();
      scheduleCategoryDropdownScans();
      return;
    }

    if (isLikelyDropdownControl(target)) {
      categoryDropdownArmed = false;
      lastCategoryInteractionAt = 0;
      hideTooltip();
    }
  }

  function scheduleScan(delay) {
    window.clearTimeout(scanTimer);
    scanTimer = window.setTimeout(scanForOptions, delay);
  }

  function scheduleCategoryDropdownScans() {
    scheduleScan(40);
    window.setTimeout(scanForOptions, 180);
    window.setTimeout(scanForOptions, 450);
  }

  function scanForOptions() {
    if (!isCategoryDropdownLikelyOpen()) return;

    for (const option of document.querySelectorAll(OPTION_SELECTOR)) {
      attachNoteToCategoryOption(option);
    }
  }

  function attachNoteToCategoryOption(option) {
    if (!(option instanceof HTMLElement)) return;
    if (option.closest(`#${TOOLTIP_ID}`)) return;
    if (option.closest(`#${INFO_ID}`)) return;
    if (option.closest('[aria-hidden="true"], [hidden]')) return;
    if (!isVisible(option)) return;

    const categoryName = getOptionLabel(option);
    if (!categoryName) return;
    if (!isKnownCategoryOption(categoryName)) return;

    applyOptionColor(option, categoryName);
    if (decoratedOptions.has(option)) return;

    decoratedOptions.add(option);
    option.addEventListener('mouseenter', () => {
      applyOptionColor(option, categoryName, true);
      showInfoMarkerForOption(option, categoryName);
    });
    option.addEventListener('mousemove', () => showInfoMarkerForOption(option, categoryName));
    option.addEventListener('mouseleave', () => {
      applyOptionColor(option, categoryName, false);
      scheduleHideInfoMarker();
    });
    option.addEventListener('focus', () => {
      applyOptionColor(option, categoryName, true);
      showInfoMarkerForOption(option, categoryName);
    });
    option.addEventListener('blur', () => {
      applyOptionColor(option, categoryName, false);
      scheduleHideInfoMarker();
    });
  }

  function isCategoryDropdownLikelyOpen() {
    return categoryDropdownArmed &&
      (Date.now() - lastCategoryInteractionAt < CATEGORY_CONTEXT_TTL_MS || isCategoryControl(document.activeElement));
  }

  function isCategoryControl(element) {
    if (!(element instanceof Element)) return false;

    const text = normalizeText(getElementOwnText(element));
    if (text === 'category') return true;

    const fieldLabel = getNearbyFieldLabel(element);
    if (fieldLabel) return fieldLabel === 'category';

    return Boolean(element.closest?.(CATEGORY_CONTROL_SELECTOR));
  }

  function isPipelineOrStageControl(element) {
    if (!(element instanceof Element)) return false;

    const text = normalizeText(getElementOwnText(element));
    if (text === 'pipeline' || text === 'stage') return true;

    const fieldLabel = getNearbyFieldLabel(element);
    return fieldLabel === 'pipeline' || fieldLabel === 'stage';
  }

  function isLikelyDropdownControl(element) {
    if (!(element instanceof Element)) return false;
    return Boolean(element.closest?.('[role="combobox"], .select2, .select2-container, .ng-select, .mat-select, .dropdown-toggle, select'));
  }

  function getNearbyFieldLabel(element) {
    let current = element;
    for (let depth = 0; current && depth < 5; depth += 1, current = current.parentElement) {
      const label = findFieldLabelText(current);
      if (label) return label;
    }

    return '';
  }

  function findFieldLabelText(root) {
    const labelSelectors = [
      'label',
      '.control-label',
      '.form-label',
      '.field-label',
      '[class*="label" i]'
    ].join(',');

    for (const label of root.querySelectorAll?.(labelSelectors) || []) {
      const text = normalizeText(getElementOwnText(label) || label.textContent);
      if (text === 'category' || text === 'pipeline' || text === 'stage') return text;
    }

    return '';
  }

  function getElementOwnText(element) {
    if (!(element instanceof Element)) return '';

    let text = '';
    for (const node of element.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) text += node.textContent || '';
    }

    return text || element.getAttribute('aria-label') || element.getAttribute('placeholder') || '';
  }

  function getOptionLabel(option) {
    return String(option.textContent || '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function getCategoryEntry(categoryName) {
    const exact = CATEGORY_NOTES[categoryName];
    if (exact && typeof exact === 'object') {
      const note = stripTypeSuffix(exact.note || exact.meaning || exact.text);
      if (note) {
        return {
          note,
          section: cleanCell(exact.section) || inferSection(categoryName),
          colorEnabled: Boolean(exact.colorEnabled)
        };
      }
    }

    if (exact) {
      return {
        note: stripTypeSuffix(exact),
        section: inferSection(categoryName),
        colorEnabled: true
      };
    }

    return {
      note: `No note found for "${categoryName}" in the service category notes sheet.`,
      section: 'Other',
      colorEnabled: false
    };
  }

  function getCategoryNote(categoryName) {
    return getCategoryEntry(categoryName).note;
  }

  function isKnownCategoryOption(categoryName) {
    const value = cleanCell(categoryName);
    if (CATEGORY_NOTES[value]) return true;
    if (/^(Service|Billing|Claims|Doc|Renewals):/i.test(value)) return true;
    return value === 'Mono-Line Home Renewals' ||
      value === 'Commercial Policy Change' ||
      value === 'General' ||
      value === 'Unknown';
  }

  function getCategoryColor(categoryName) {
    const entry = getCategoryEntry(categoryName);
    if (!entry.colorEnabled) return '';

    return SECTION_COLORS[entry.section] || SECTION_COLORS.Other || '';
  }

  function getCategoryHoverColor(categoryName) {
    const entry = getCategoryEntry(categoryName);
    if (!entry.colorEnabled) return '';

    return SECTION_HOVER_COLORS[entry.section] || SECTION_HOVER_COLORS.Other || '';
  }

  function stripTypeSuffix(value) {
    return String(value || '').replace(/\s+Type:\s*[^.]+\.?$/i, '').trim();
  }

  function inferSection(categoryName) {
    const value = cleanCell(categoryName);
    if (/^Service:/i.test(value)) return 'Service';
    if (/^Billing:/i.test(value)) return 'Billing';
    if (/^Claims:/i.test(value)) return 'Claims';
    if (/^Doc:/i.test(value)) return 'Doc';
    if (/^Renewals:/i.test(value) || value === 'Mono-Line Home Renewals') return 'Renewals';

    return 'Other';
  }

  function loadCachedCategoryNotes() {
    try {
      const cached = JSON.parse(localStorage.getItem(NOTES_CACHE_KEY) || '{}');
      if (cached && cached.notes && typeof cached.notes === 'object') {
        Object.assign(CATEGORY_NOTES, cached.notes);
        lastNotesRefreshAt = Number(cached.loadedAt || 0);
      }
    } catch (error) {
      console.warn(`[${SCRIPT}] could not load cached notes`, error);
    }
  }

  function refreshCategoryNotesFromSheet() {
    if (notesRefreshPromise) return notesRefreshPromise;
    if (Date.now() - lastNotesRefreshAt < NOTES_REFRESH_MS) return Promise.resolve(CATEGORY_NOTES);

    notesRefreshPromise = requestText(SHEET_CSV_URL)
      .then((csvText) => {
        const sheetNotes = buildNotesFromCsv(csvText);
        if (Object.keys(sheetNotes).length === 0) {
          throw new Error('No category notes found in sheet CSV');
        }

        Object.assign(CATEGORY_NOTES, sheetNotes);
        lastNotesRefreshAt = Date.now();
        localStorage.setItem(NOTES_CACHE_KEY, JSON.stringify({
          loadedAt: lastNotesRefreshAt,
          notes: sheetNotes
        }));
        console.info(`[${SCRIPT}] loaded notes from sheet`, Object.keys(sheetNotes).length);
        scanForOptions();
        return CATEGORY_NOTES;
      })
      .catch((error) => {
        console.warn(`[${SCRIPT}] using cached/fallback notes because sheet fetch failed`, error);
        return CATEGORY_NOTES;
      })
      .finally(() => {
        notesRefreshPromise = null;
      });

    return notesRefreshPromise;
  }

  function requestText(url) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== 'function') {
        fetch(url, { credentials: 'include' })
          .then((response) => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.text();
          })
          .then(resolve, reject);
        return;
      }

      GM_xmlhttpRequest({
        method: 'GET',
        url,
        timeout: 10000,
        onload: (response) => {
          if (response.status < 200 || response.status >= 300) {
            reject(new Error(`HTTP ${response.status}`));
            return;
          }
          resolve(response.responseText || '');
        },
        onerror: () => reject(new Error('Sheet request failed')),
        ontimeout: () => reject(new Error('Sheet request timed out'))
      });
    });
  }

  function buildNotesFromCsv(csvText) {
    const rows = parseCsv(csvText);
    const notes = {};

    for (const row of rows.slice(1)) {
      const category = cleanCell(row[0]);
      const meaning = cleanCell(row[1]);
      const section = cleanCell(row[3]);
      const colorEnabled = parseBooleanCell(row[4]);
      if (!category || !meaning) continue;

      notes[category] = {
        note: meaning,
        section: section || inferSection(category),
        colorEnabled
      };
    }

    return notes;
  }

  function parseBooleanCell(value) {
    const normalized = normalizeText(value);
    return normalized === 'true' ||
      normalized === 'yes' ||
      normalized === 'y' ||
      normalized === '1' ||
      normalized === 'on';
  }

  function parseCsv(csvText) {
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;

    for (let index = 0; index < csvText.length; index += 1) {
      const char = csvText[index];
      const next = csvText[index + 1];

      if (char === '"') {
        if (quoted && next === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = !quoted;
        }
        continue;
      }

      if (char === ',' && !quoted) {
        row.push(cell);
        cell = '';
        continue;
      }

      if ((char === '\n' || char === '\r') && !quoted) {
        if (char === '\r' && next === '\n') index += 1;
        row.push(cell);
        rows.push(row);
        row = [];
        cell = '';
        continue;
      }

      cell += char;
    }

    row.push(cell);
    if (row.some((value) => value)) rows.push(row);
    return rows;
  }

  function cleanCell(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function isVisible(element) {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function showInfoMarkerForOption(option, categoryName) {
    if (!isKnownCategoryOption(categoryName)) return;

    window.clearTimeout(hideInfoTimer);
    activeOption = option;
    applyOptionColor(option, categoryName, true);

    const info = ensureInfoMarker();
    const rect = option.getBoundingClientRect();
    const note = getCategoryNote(categoryName);
    const size = 15;
    const margin = 6;
    const left = Math.max(margin, Math.min(window.innerWidth - size - margin, rect.right - size - margin));
    const top = Math.max(margin, Math.min(window.innerHeight - size - margin, rect.top + (rect.height - size) / 2));

    info.setAttribute(NOTE_ATTR, note);
    info.setAttribute(LABEL_ATTR, categoryName);
    info.setAttribute('aria-label', `Information about ${categoryName}`);
    info.style.left = `${Math.round(left)}px`;
    info.style.top = `${Math.round(top)}px`;
    info.style.display = 'inline-flex';
  }

  function applyOptionColor(option, categoryName, hovering = false) {
    const color = hovering ? getCategoryHoverColor(categoryName) : getCategoryColor(categoryName);
    if (color) {
      if (!coloredOptions.has(option)) {
        coloredOptions.set(option, {
          value: option.style.getPropertyValue('background-color') || '',
          priority: option.style.getPropertyPriority('background-color') || '',
          customColor: option.style.getPropertyValue('--tm-az-service-category-color') || '',
          hadColorClass: option.classList.contains(COLOR_CLASS)
        });
      }
      option.classList.add(COLOR_CLASS);
      option.style.setProperty('--tm-az-service-category-color', color);
      option.style.setProperty('background-color', color, 'important');
      option.style.setProperty('background-image', 'none', 'important');
      return;
    }

    if (coloredOptions.has(option)) {
      const previous = coloredOptions.get(option);
      option.style.setProperty('background-color', previous.value, previous.priority);
      option.style.setProperty('--tm-az-service-category-color', previous.customColor);
      if (!previous.hadColorClass) option.classList.remove(COLOR_CLASS);
      coloredOptions.delete(option);
    }
  }

  function scheduleHideInfoMarker() {
    window.clearTimeout(hideInfoTimer);
    hideInfoTimer = window.setTimeout(() => {
      const info = ensureInfoMarker();
      if (document.activeElement === info || info.matches(':hover')) return;
      activeOption = null;
      info.style.display = 'none';
      hideTooltip();
    }, 120);
  }

  function handlePointerEnter(event) {
    activeTarget = event.currentTarget;
    showTooltip(activeTarget, event.clientX, event.clientY);
  }

  function handlePointerMove(event) {
    if (event.currentTarget !== activeTarget) return;
    positionTooltip(event.clientX, event.clientY);
  }

  function handleFocus(event) {
    activeTarget = event.currentTarget;
    const rect = activeTarget.getBoundingClientRect();
    showTooltip(activeTarget, rect.left + rect.width / 2, rect.bottom);
  }

  function showTooltip(target, x, y) {
    const tooltip = ensureTooltip();
    const note = target.getAttribute(NOTE_ATTR);
    const label = target.getAttribute(LABEL_ATTR) || 'Service Category';
    if (!note) return;

    tooltip.innerHTML = `<strong>${escapeHtml(label)}</strong>${escapeHtml(note)}`;
    tooltip.style.display = 'block';
    positionTooltip(x, y);
  }

  function positionTooltip(x, y) {
    const tooltip = ensureTooltip();
    const offset = 14;
    const margin = 8;
    const rect = tooltip.getBoundingClientRect();
    let left = x + offset;
    let top = y + offset;

    if (left + rect.width + margin > window.innerWidth) {
      left = Math.max(margin, x - rect.width - offset);
    }

    if (top + rect.height + margin > window.innerHeight) {
      top = Math.max(margin, y - rect.height - offset);
    }

    tooltip.style.left = `${Math.round(left)}px`;
    tooltip.style.top = `${Math.round(top)}px`;
  }

  function hideTooltip(event) {
    if (event && event.currentTarget !== activeTarget) return;

    activeTarget = null;
    const tooltip = ensureTooltip();
    tooltip.style.display = 'none';
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
})();
