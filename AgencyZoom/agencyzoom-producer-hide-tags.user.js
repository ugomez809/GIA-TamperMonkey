// ==UserScript==
// @name         LOCAL AgencyZoom Producer Hide Tags
// @namespace    local.agencyzoom.hidden-tags.producer
// @version      0.8
// @description  Hides manager-selected AgencyZoom card tags from producer views, syncing the hidden list at most once per day.
// @match        https://app.agencyzoom.com/*
// @exclude      https://app.agencyzoom.com/login*
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @connect      script.google.com
// @connect      script.googleusercontent.com
// @updateURL    https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/refs/heads/main/AgencyZoom/agencyzoom-producer-hide-tags.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/refs/heads/main/AgencyZoom/agencyzoom-producer-hide-tags.user.js
// ==/UserScript==

(function () {
  'use strict';

  const VERSION = '0.8';
  const SCRIPT = 'AZ Producer Hide Tags';
  const DEFAULT_ENDPOINT_URL = 'https://script.google.com/macros/s/AKfycbzKxEGakrLmc-wEQv_6cx2rLxwtp8Lb9aKxTOICDuehlGybn-u3RaNuWAJbk-Hio1x9/exec';
  const DEFAULT_READ_TOKEN = '';
  const STYLE_ID = 'tm-az-producer-hide-tags-style';
  const IMMEDIATE_STYLE_ID = 'tm-az-producer-hide-tags-immediate-style';
  const HIDDEN_CLASS = 'tm-az-producer-hidden-tag';
  const PREHIDE_CLASS = 'tm-az-producer-hide-tags-prehide';
  const COMPACT_CARD_CLASS = 'tm-az-producer-tags-compacted';
  const EMPTY_TAG_CONTAINER_CLASS = 'tm-az-producer-empty-tag-container';
  const HIDDEN_ATTR = 'data-tm-az-producer-hidden-tag';
  const CHECKED_ATTR = 'data-tm-az-producer-checked-tag';
  const CARD_SELECTORS = [
    '.dd-card.referral-container[data-id]',
    '.referral-container[data-id]',
    '[id^="referral"][data-id]',
    '.closed-ticket-card',
    '.ticket-card'
  ];
  const CARD_SELECTOR = CARD_SELECTORS.join(',');
  const TAG_SELECTOR = [
    '[data-tag-id]',
    '[data-tag]',
    '.az-tag',
    '.lead-tag',
    '.referral-tag',
    '.tag',
    '.tag-label',
    '.tag-name',
    '.label',
    '.badge'
  ].join(',');
  const STORAGE_KEYS = {
    endpointUrl: 'tmAzHiddenTagsEndpointUrl',
    readToken: 'tmAzHiddenTagsReadToken',
    cache: 'tmAzHiddenTagsCacheV1',
    lastSync: 'tmAzHiddenTagsLastSync',
    lastSyncDay: 'tmAzHiddenTagsLastSyncDay'
  };
  const DAILY_CHECK_INTERVAL_MS = 60 * 60 * 1000;

  let hiddenTags = [];
  let hiddenKeys = new Set();
  let hiddenTagIds = new Set();
  let observer = null;
  let scanTimer = 0;
  let scanQueued = false;
  let scrollQueued = false;
  let dailyCheckTimer = 0;
  let lastRefreshStartedAt = 0;

  boot();

  function boot() {
    if (!isAgencyZoom()) return;
    injectStyle();
    registerMenuCommands();
    loadCachedConfig();
    updateImmediateHideStyle();
    syncPrehideClass();

    onReady(() => {
      applyHiddenTags({ initial: true });
      startObserver();
      refreshHiddenTags({ quiet: true }).catch((err) => console.warn(`[${SCRIPT}] config load failed:`, err));
      dailyCheckTimer = window.setInterval(() => {
        refreshHiddenTags({ quiet: true }).catch((err) => console.warn(`[${SCRIPT}] scheduled refresh failed:`, err));
      }, DAILY_CHECK_INTERVAL_MS);
    });
  }

  function onReady(callback) {
    if (document.body) {
      callback();
      return;
    }
    document.addEventListener('DOMContentLoaded', callback, { once: true });
  }

  function isAgencyZoom() {
    return /(^|\.)app\.agencyzoom\.com$/i.test(String(location.hostname || ''));
  }

  function registerMenuCommands() {
    if (typeof GM_registerMenuCommand !== 'function') return;

    GM_registerMenuCommand('AZ Hidden Tags: Refresh now', () => {
      refreshHiddenTags({ quiet: false, force: true }).catch((err) => alert(`AgencyZoom hidden tag refresh failed: ${errorMessage(err)}`));
    });
  }

  function startObserver() {
    if (observer) observer.disconnect();
    observer = new MutationObserver(() => scheduleScan(120));
    observer.observe(document.documentElement || document.body, {
      childList: true,
      subtree: true
    });

    document.addEventListener('scroll', handleScrollOrWheel, true);
    document.addEventListener('wheel', handleScrollOrWheel, { capture: true, passive: true });
    window.setInterval(() => scheduleScan(0), 2500);
  }

  function handleScrollOrWheel() {
    if (scrollQueued) return;
    scrollQueued = true;
    requestAnimationFrame(() => {
      scrollQueued = false;
      hideVisibleHiddenTagsNearViewport();
      scheduleScan(180);
    });
  }

  function scheduleScan(delay) {
    if (delay <= 0) {
      if (scanQueued) return;
      scanQueued = true;
      queueSoon(() => {
        scanQueued = false;
        applyHiddenTags();
      });
      return;
    }

    window.clearTimeout(scanTimer);
    scanTimer = window.setTimeout(() => applyHiddenTags(), delay);
  }

  async function refreshHiddenTags(options = {}) {
    if (!options.force && hasSyncedToday()) {
      if (!options.quiet) alert(`AgencyZoom hidden tags already synced today.\nHidden tags: ${hiddenKeys.size}\nLast sync: ${formatLastSync()}`);
      return;
    }

    const endpointUrl = getEndpointUrl();
    if (!endpointUrl) {
      if (!options.quiet) alert('Set the AgencyZoom hidden tags Web App URL first.');
      return;
    }

    if (Date.now() - lastRefreshStartedAt < 3000) return;
    lastRefreshStartedAt = Date.now();

    const url = buildUrl(endpointUrl, {
      action: 'list',
      readToken: getReadToken(),
      _: String(Date.now())
    });

    const response = await requestJson({ method: 'GET', url });
    if (!response || response.ok !== true) {
      throw new Error(response && response.message ? response.message : 'Sheet read failed');
    }

    hiddenTags = Array.isArray(response.tags) ? response.tags : [];
    rebuildIndex();
    cacheConfig();
    updateImmediateHideStyle();
    syncPrehideClass();
    markSyncedNow();
    applyHiddenTags({ initial: true });

    if (!options.quiet) {
      alert(`AgencyZoom hidden tags loaded: ${hiddenTags.length}`);
    }
  }

  function loadCachedConfig() {
    hiddenTags = parseJson(storageGet(STORAGE_KEYS.cache, '[]')) || [];
    rebuildIndex();
  }

  function cacheConfig() {
    storageSet(STORAGE_KEYS.cache, JSON.stringify(hiddenTags));
  }

  function rebuildIndex() {
    hiddenKeys = new Set();
    hiddenTagIds = new Set();

    for (const tag of hiddenTags) {
      if (tag && tag.active === false) continue;
      const text = clean(tag && tag.text);
      const key = normalizeTagKey(tag && (tag.key || text));
      const tagId = clean(tag && tag.tagId);
      if (key) hiddenKeys.add(key);
      if (tagId) hiddenTagIds.add(tagId);
    }
  }

  function applyHiddenTags(options = {}) {
    if (!document.body) return;

    const roots = Array.isArray(options.roots) && options.roots.length ? options.roots : null;
    if (roots) clearChecksInRoots(roots);

    const candidates = findTagCandidates(roots, options);
    const seen = new Set();

    for (const el of candidates) {
      const record = extractTagRecord(el);
      const shouldHide = shouldHideTag(record);
      seen.add(el);
      setHidden(el, shouldHide, record);
    }

    const staleHidden = roots
      ? roots.flatMap((root) => safeQueryAll(root, `[${HIDDEN_ATTR}="1"]`))
      : Array.from(document.querySelectorAll(`[${HIDDEN_ATTR}="1"]`));
    for (const el of staleHidden) {
      if (!seen.has(el) || !shouldHideTag(extractTagRecord(el))) {
        setHidden(el, false);
      }
    }

    compactCards(roots);
  }

  function setHidden(el, hidden, record = null) {
    if (!(el instanceof Element)) return;

    if (hidden) {
      el.classList.add(HIDDEN_CLASS);
      el.setAttribute(HIDDEN_ATTR, '1');
      el.setAttribute(CHECKED_ATTR, 'hidden');
      el.setAttribute('aria-hidden', 'true');
      if (record && record.text) el.setAttribute('data-tm-az-hidden-tag-text', record.text);
      return;
    }

    el.setAttribute(CHECKED_ATTR, 'visible');
    if (el.getAttribute(HIDDEN_ATTR) === '1') {
      el.classList.remove(HIDDEN_CLASS);
      el.removeAttribute(HIDDEN_ATTR);
      el.removeAttribute('aria-hidden');
      el.removeAttribute('data-tm-az-hidden-tag-text');
    }
  }

  function compactCards(roots = null) {
    const cards = roots
      ? uniqueElements(roots.flatMap((root) => findCardsNearRoot(root)))
      : safeQueryAll(document, CARD_SELECTOR);

    for (const card of cards) {
      clearEmptyTagContainers(card);
      const hidden = safeQueryAll(card, `[${HIDDEN_ATTR}="1"]`);
      card.classList.toggle(COMPACT_CARD_CLASS, hidden.length > 0);
      relaxCardSize(card, hidden.length > 0);

      for (const tag of hidden) {
        markEmptyTagContainers(tag, card);
      }
    }
  }

  function clearEmptyTagContainers(root) {
    for (const el of safeQueryAll(root, `.${EMPTY_TAG_CONTAINER_CLASS}`)) {
      el.classList.remove(EMPTY_TAG_CONTAINER_CLASS);
    }
  }

  function markEmptyTagContainers(tag, card) {
    let el = tag && tag.parentElement;
    let depth = 0;
    while (el && el !== card && depth < 5) {
      if (hasTagContainerSignal(el) && !hasVisibleContentAfterHiddenTags(el)) {
        el.classList.add(EMPTY_TAG_CONTAINER_CLASS);
      }
      el = el.parentElement;
      depth += 1;
    }
  }

  function relaxCardSize(card, compacted) {
    if (!compacted) return;

    card.style.setProperty('height', 'auto', 'important');
    card.style.setProperty('min-height', '0', 'important');
    card.style.setProperty('max-height', 'none', 'important');

    const shell = card.closest('.dd-item, .grid-stack-item, .kanban-item, .pipeline-card, .ui-sortable-handle');
    if (shell && shell !== card && shell.contains(card)) {
      shell.style.setProperty('height', 'auto', 'important');
      shell.style.setProperty('min-height', '0', 'important');
      shell.style.setProperty('max-height', 'none', 'important');
    }

    requestAnimationFrame(() => {
      try { window.dispatchEvent(new Event('resize')); } catch {}
    });
  }

  function hasTagContainerSignal(el) {
    if (!(el instanceof Element)) return false;
    const signal = lower([
      el.tagName,
      el.id,
      el.className,
      attr(el, 'gs-id'),
      attr(el, 'data-name'),
      attr(el, 'data-value'),
      attr(el, 'aria-label')
    ].join(' '));

    return /tag|tags|label|badge|chip|pill/.test(signal) ||
      !!el.querySelector(`[${HIDDEN_ATTR}="1"]`);
  }

  function hasVisibleContentAfterHiddenTags(container) {
    const clone = container.cloneNode(true);
    clone.querySelectorAll(`[${HIDDEN_ATTR}="1"], .${HIDDEN_CLASS}`).forEach((node) => node.remove());
    return !!clean(clone.innerText || clone.textContent || '');
  }

  function shouldHideTag(record) {
    if (!record) return false;
    if (record.tagId && hiddenTagIds.has(record.tagId)) return true;
    return !!(record.key && hiddenKeys.has(record.key));
  }

  function findTagCandidates(roots = null, options = {}) {
    const searchRoots = roots && roots.length ? getCardRoots(roots) : getCardRoots();
    const candidates = [];

    for (const root of searchRoots) {
      const direct = root.matches && root.matches(TAG_SELECTOR) ? [root] : [];
      const nested = safeQueryAll(root, TAG_SELECTOR);
      for (const el of direct.concat(nested)) {
        if (isLikelyTagElement(el)) candidates.push(el);
      }

      const genericDirect = root.matches && root.matches('[class], [id], [data-name], [data-value], [data-tag], [data-tag-id]')
        ? [root]
        : [];
      for (const el of safeQueryAll(root, '[class], [id], [data-name], [data-value]')) {
        if (isLikelyTagElement(el)) candidates.push(el);
      }
      for (const el of genericDirect) {
        if (isLikelyTagElement(el)) candidates.push(el);
      }
    }

    const unique = uniqueElements(candidates);
    if (!options.viewportOnly) return unique;
    return unique.filter((el) => isNearViewport(el));
  }

  function getCardRoots(roots = null) {
    if (roots && roots.length) {
      const nearby = uniqueElements(roots.flatMap((root) => findCardsNearRoot(root)));
      if (nearby.length) return nearby;
      return roots.filter((root) => root && root.querySelectorAll);
    }

    const cards = safeQueryAll(document, CARD_SELECTOR);
    if (cards.length) return cards;

    const dock = document.querySelector('.az-dock__container, #serviceDetailDock, .az-dock');
    if (dock) return [dock];

    return [document.body].filter(Boolean);
  }

  function findCardsNearRoot(root) {
    const el = normalizeElement(root);
    if (!el) return [];

    const closest = el.closest?.(CARD_SELECTOR);
    if (closest) return [closest];

    const nested = safeQueryAll(el, CARD_SELECTOR);
    if (nested.length) return nested;

    return [];
  }

  function collectMutationRoots(records) {
    const roots = [];

    for (const record of records || []) {
      const target = normalizeElement(record.target);
      if (target && !isOwnScriptMutation(record, target)) roots.push(target);

      for (const node of Array.from(record.addedNodes || [])) {
        const el = normalizeElement(node);
        if (el) roots.push(el);
      }
    }

    return uniqueElements(roots.flatMap((root) => {
      const cards = findCardsNearRoot(root);
      return cards.length ? cards : [root];
    }));
  }

  function clearChecksInRoots(roots) {
    for (const root of roots) {
      const el = normalizeElement(root);
      if (!el) continue;
      const tags = uniqueElements([
        ...(el.matches?.(`[${CHECKED_ATTR}]`) ? [el] : []),
        ...safeQueryAll(el, `[${CHECKED_ATTR}]`)
      ]);
      for (const tag of tags) {
        tag.removeAttribute(CHECKED_ATTR);
      }
    }
  }

  function normalizeElement(node) {
    if (!node) return null;
    if (node.nodeType === Node.ELEMENT_NODE) return node;
    if (node.nodeType === Node.TEXT_NODE) return node.parentElement;
    return null;
  }

  function isOwnScriptMutation(record, target) {
    if (!record || record.type !== 'attributes') return false;
    if (record.attributeName === CHECKED_ATTR || record.attributeName === HIDDEN_ATTR) return true;
    if (target.classList?.contains(HIDDEN_CLASS) || target.classList?.contains(EMPTY_TAG_CONTAINER_CLASS)) return true;
    return false;
  }

  function isLikelyTagElement(el) {
    if (!(el instanceof Element) || isOwnUi(el) || !isVisible(el)) return false;

    const text = getVisibleText(el);
    if (!text || text.length > 80) return false;
    if (text.includes('\n') || text.split(/\s+/).length > 8) return false;
    if (/^[#\d,.$/\-:()\s]+$/.test(text)) return false;
    if (looksLikePhoneOrEmail(text)) return false;
    if (el.matches('button,input,textarea,select,option,script,style')) return false;

    if (el.closest('.cardes-template-item[gs-id="producer"], [gs-id="producer"]')) return false;

    const tagSignal = hasTagSignal(el);
    return tagSignal || hasTagSignal(el.parentElement);
  }

  function hasTagSignal(el) {
    if (!(el instanceof Element)) return false;
    const signal = lower([
      el.tagName,
      el.id,
      el.className,
      attr(el, 'data-tag'),
      attr(el, 'data-tag-id'),
      attr(el, 'data-name'),
      attr(el, 'data-value'),
      attr(el, 'aria-label')
    ].join(' '));

    return /\b(tag|tags|label|badge|chip|pill)\b/.test(signal) ||
      /tag|label|badge|chip|pill/.test(signal);
  }

  function extractTagRecord(el) {
    const text = clean(getVisibleText(el));
    return {
      key: normalizeTagKey(text),
      text,
      tagId: clean(
        attr(el, 'data-tag-id') ||
        attr(el, 'data-tag') ||
        attr(el, 'data-id')
      )
    };
  }

  function requestJson(options) {
    return new Promise((resolve, reject) => {
      const method = options.method || 'GET';
      const data = options.data ? JSON.stringify(options.data) : undefined;

      if (typeof GM_xmlhttpRequest === 'function') {
        GM_xmlhttpRequest({
          method,
          url: options.url,
          data,
          headers: data ? { 'Content-Type': 'application/json' } : {},
          timeout: 20000,
          onload: (response) => resolve(parseJson(response.responseText) || {}),
          onerror: () => reject(new Error('Network request failed')),
          ontimeout: () => reject(new Error('Network request timed out'))
        });
        return;
      }

      fetch(options.url, {
        method,
        body: data,
        headers: data ? { 'Content-Type': 'application/json' } : {},
        credentials: 'omit'
      })
        .then((response) => response.json())
        .then(resolve)
        .catch(reject);
    });
  }

  function getEndpointUrl() {
    return clean(storageGet(STORAGE_KEYS.endpointUrl, DEFAULT_ENDPOINT_URL));
  }

  function getReadToken() {
    return clean(storageGet(STORAGE_KEYS.readToken, DEFAULT_READ_TOKEN));
  }

  function buildUrl(base, params) {
    const url = new URL(base, location.href);
    for (const [key, value] of Object.entries(params || {})) {
      if (value) url.searchParams.set(key, value);
    }
    return url.toString();
  }

  function hasSyncedToday() {
    return getLastSyncDay() === localDateKey();
  }

  function getLastSyncDay() {
    const savedDay = clean(storageGet(STORAGE_KEYS.lastSyncDay, ''));
    if (savedDay) return savedDay;

    const lastSync = clean(storageGet(STORAGE_KEYS.lastSync, ''));
    if (!lastSync) return '';

    const parsed = new Date(lastSync);
    if (Number.isNaN(parsed.getTime())) return '';
    return localDateKey(parsed);
  }

  function markSyncedNow() {
    const now = new Date();
    storageSet(STORAGE_KEYS.lastSync, now.toISOString());
    storageSet(STORAGE_KEYS.lastSyncDay, localDateKey(now));
  }

  function formatLastSync() {
    const lastSync = clean(storageGet(STORAGE_KEYS.lastSync, ''));
    return lastSync || 'never';
  }

  function localDateKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function updateImmediateHideStyle() {
    let style = document.getElementById(IMMEDIATE_STYLE_ID);
    if (!style) {
      style = document.createElement('style');
      style.id = IMMEDIATE_STYLE_ID;
      appendStyle(style);
    }

    const scopedSelectors = [];
    for (const tagId of hiddenTagIds) {
      const escaped = cssEscape(tagId);
      for (const cardSelector of CARD_SELECTORS) {
        scopedSelectors.push(`${cardSelector} [data-tag-id="${escaped}"]`);
        scopedSelectors.push(`${cardSelector} [data-tag="${escaped}"]`);
      }
      scopedSelectors.push(`.az-dock__container [data-tag-id="${escaped}"]`);
      scopedSelectors.push(`.az-dock__container [data-tag="${escaped}"]`);
    }

    style.textContent = scopedSelectors.length
      ? `${scopedSelectors.join(',\n')} { display: none !important; }`
      : '';
  }

  function syncPrehideClass() {
    document.documentElement.classList.toggle(PREHIDE_CLASS, hiddenKeys.size > 0 || hiddenTagIds.size > 0);
  }

  function queueSoon(callback) {
    if (typeof queueMicrotask === 'function') {
      queueMicrotask(callback);
      return;
    }
    Promise.resolve().then(callback);
  }

  function getVisibleText(el) {
    if (!el) return '';
    const clone = el.cloneNode(true);
    clone.querySelectorAll('[class^="tm-az-"], [class*=" tm-az-"]').forEach((node) => node.remove());
    return clean(clone.innerText || clone.textContent || '');
  }

  function isVisible(el) {
    if (!el) return false;
    if (el.getAttribute(HIDDEN_ATTR) === '1') return true;
    const style = getComputedStyle(el);
    if (style.display === 'none' || Number(style.opacity) === 0) return false;
    if (style.visibility === 'hidden' && !isPrehiddenCandidate(el)) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 &&
      rect.height > 0 &&
      rect.bottom >= 0 &&
      rect.right >= 0 &&
      rect.top <= window.innerHeight &&
      rect.left <= window.innerWidth;
  }

  function isNearViewport(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const margin = Math.max(480, Math.round(window.innerHeight * 0.75));
    return rect.bottom >= -margin &&
      rect.right >= -120 &&
      rect.top <= window.innerHeight + margin &&
      rect.left <= window.innerWidth + 120;
  }

  function hideVisibleHiddenTagsNearViewport() {
    const checkedVisible = safeQueryAll(document, `[${CHECKED_ATTR}="visible"]`);
    let changed = false;

    for (const el of checkedVisible) {
      if (!isNearViewport(el) || !isLikelyTagElement(el)) continue;

      const record = extractTagRecord(el);
      if (!shouldHideTag(record)) continue;

      setHidden(el, true, record);
      changed = true;
    }

    if (changed) compactCards();
  }

  function isPrehiddenCandidate(el) {
    return document.documentElement.classList.contains(PREHIDE_CLASS) &&
      !!el.closest(CARD_SELECTOR) &&
      !el.closest('.cardes-template-item[gs-id="producer"], [gs-id="producer"]') &&
      (el.matches(TAG_SELECTOR) || hasTagSignal(el) || hasTagSignal(el.parentElement));
  }

  function looksLikePhoneOrEmail(text) {
    return /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text) ||
      /\+?1?[\s().-]*\d{3}[\s().-]*\d{3}[\s().-]*\d{4}/.test(text);
  }

  function isOwnUi(el) {
    return !!(el && el.closest && el.closest('[data-tm-az-producer-ui="1"]'));
  }

  function attr(el, name) {
    return el && el.getAttribute ? clean(el.getAttribute(name)) : '';
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(String(value));
    return String(value).replace(/["\\\]\[]/g, '\\$&');
  }

  function safeQueryAll(root, selector) {
    try {
      return Array.from(root.querySelectorAll(selector));
    } catch {
      return [];
    }
  }

  function uniqueElements(elements) {
    return Array.from(new Set(elements.filter(Boolean)));
  }

  function normalizeTagKey(value) {
    return clean(value)
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function clean(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }

  function lower(value) {
    return clean(value).toLowerCase();
  }

  function parseJson(text) {
    try {
      return JSON.parse(String(text || '').trim());
    } catch {
      return null;
    }
  }

  function errorMessage(err) {
    return err && err.message ? err.message : String(err);
  }

  function storageGet(key, fallback = '') {
    try {
      if (typeof GM_getValue === 'function') return GM_getValue(key, fallback);
    } catch {}
    try {
      return localStorage.getItem(key) || fallback;
    } catch {}
    return fallback;
  }

  function storageSet(key, value) {
    try {
      if (typeof GM_setValue === 'function') {
        GM_setValue(key, value);
        return;
      }
    } catch {}
    try { localStorage.setItem(key, value); } catch {}
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    const prehideSelectors = buildScopedTagSelectors([
      '[data-tag-id]',
      '[data-tag]',
      '.az-tag',
      '.lead-tag',
      '.referral-tag',
      '.tag',
      '.tag-label',
      '.tag-name',
      '.label',
      '.badge'
    ]).map((selector) => `.${PREHIDE_CLASS} ${selector}:not([${CHECKED_ATTR}])`);
    const producerRevealSelectors = buildScopedTagSelectors([
      '.cardes-template-item[gs-id="producer"] *',
      '[gs-id="producer"] *'
    ]).map((selector) => `.${PREHIDE_CLASS} ${selector}`);

    style.textContent = `
      .${HIDDEN_CLASS} {
        display: none !important;
      }
      ${prehideSelectors.join(',\n')} {
        visibility: hidden !important;
      }
      [${CHECKED_ATTR}="visible"] {
        visibility: visible !important;
      }
      ${producerRevealSelectors.join(',\n')} {
        visibility: visible !important;
      }
      .${COMPACT_CARD_CLASS} {
        height: auto !important;
        min-height: 0 !important;
        max-height: none !important;
      }
      .${COMPACT_CARD_CLASS} [${HIDDEN_ATTR}="1"] {
        display: none !important;
        width: 0 !important;
        height: 0 !important;
        min-width: 0 !important;
        min-height: 0 !important;
        margin: 0 !important;
        padding: 0 !important;
        border: 0 !important;
      }
      .${EMPTY_TAG_CONTAINER_CLASS} {
        display: none !important;
        height: 0 !important;
        min-height: 0 !important;
        margin: 0 !important;
        padding: 0 !important;
      }
    `;
    appendStyle(style);
  }

  function appendStyle(style) {
    (document.head || document.documentElement || document.body).appendChild(style);
  }

  function buildScopedTagSelectors(tagSelectors) {
    const selectors = [];
    for (const cardSelector of CARD_SELECTORS) {
      for (const tagSelector of tagSelectors) {
        selectors.push(`${cardSelector} ${tagSelector}`);
      }
    }
    return selectors;
  }

  console.debug(`[${SCRIPT}] loaded v${VERSION}`);

  window.addEventListener('beforeunload', () => {
    if (dailyCheckTimer) window.clearInterval(dailyCheckTimer);
    if (observer) observer.disconnect();
  });
})();
