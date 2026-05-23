// ==UserScript==
// @name         LOCAL AgencyZoom Hidden Tag Manager
// @namespace    local.agencyzoom.hidden-tags.manager
// @version      1.8
// @description  Manager tool for selecting AgencyZoom card tags that should be hidden from producer views.
// @match        https://app.agencyzoom.com/*
// @exclude      https://app.agencyzoom.com/login*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @connect      script.google.com
// @connect      script.googleusercontent.com
// @updateURL    https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/refs/heads/main/AgencyZoom/agencyzoom-hidden-tag-manager.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/refs/heads/main/AgencyZoom/agencyzoom-hidden-tag-manager.user.js
// ==/UserScript==

(function () {
  'use strict';

  const VERSION = '1.8';
  const SCRIPT = 'AZ Hidden Tag Manager';
  const DEFAULT_ENDPOINT_URL = 'https://script.google.com/macros/s/AKfycbzKxEGakrLmc-wEQv_6cx2rLxwtp8Lb9aKxTOICDuehlGybn-u3RaNuWAJbk-Hio1x9/exec';
  const DEFAULT_MANAGER_TOKEN = '';
  const DEFAULT_READ_TOKEN = '';
  const STYLE_ID = 'tm-az-hidden-tag-manager-style';
  const PANEL_ID = 'tm-az-hidden-tag-manager-panel';
  const VERSION_BADGE_ID = 'tm-az-hidden-tag-manager-version';
  const PICKING_CLASS = 'tm-az-tag-picking-active';
  const CANDIDATE_CLASS = 'tm-az-tag-pick-candidate';
  const SELECTED_CLASS = 'tm-az-tag-pick-selected';
  const CARD_SELECTOR = [
    '.dd-card.referral-container[data-id]',
    '.referral-container[data-id]',
    '[id^="referral"][data-id]',
    '.closed-ticket-card',
    '.ticket-card'
  ].join(',');
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
    managerToken: 'tmAzHiddenTagsManagerToken',
    readToken: 'tmAzHiddenTagsReadToken',
    cache: 'tmAzHiddenTagsCacheV1',
    panelOpen: 'tmAzHiddenTagsPanelOpen'
  };

  let hiddenTags = [];
  let tagByKey = new Map();
  let observer = null;
  let scanTimer = 0;
  let picking = false;
  let lastStatus = '';
  let changeVersion = 0;
  let saveTimer = 0;
  let saveInFlight = false;
  let saveAgainAfterCurrent = false;

  boot();

  function boot() {
    if (!isAgencyZoom()) return;
    onReady(() => {
      injectStyle();
      registerMenuCommands();
      hiddenTags = loadCachedTags();
      rebuildIndex();
      mountPanel();
      renderPanel();
      startObserver();
      refreshFromServer({ quiet: true }).catch((err) => setStatus(`Load failed: ${errorMessage(err)}`, 'error'));
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

    GM_registerMenuCommand('AZ Tags: Open manager panel', () => {
      storageSet(STORAGE_KEYS.panelOpen, '1');
      mountPanel();
      renderPanel();
    });
    GM_registerMenuCommand('AZ Tags: Toggle picker', () => setPicking(!picking));
    GM_registerMenuCommand('AZ Tags: Refresh from Sheet', () => refreshFromServer({ quiet: false }));
    GM_registerMenuCommand('AZ Tags: Configure Web App URL', promptEndpointUrl);
    GM_registerMenuCommand('AZ Tags: Set manager token', promptManagerToken);
    GM_registerMenuCommand('AZ Tags: Set read token', promptReadToken);
  }

  function startObserver() {
    if (observer) observer.disconnect();
    observer = new MutationObserver(() => {
      if (picking) scheduleCandidateScan(150);
    });
    observer.observe(document.documentElement || document.body, { childList: true, subtree: true });
    window.setInterval(() => {
      ensureVersionBadge();
      if (picking) scheduleCandidateScan(0);
    }, 5000);
    window.addEventListener('resize', lockPanelToViewport, { passive: true });
  }

  function scheduleCandidateScan(delay) {
    window.clearTimeout(scanTimer);
    scanTimer = window.setTimeout(() => {
      if (picking) markCandidates();
    }, delay);
  }

  function mountPanel() {
    if (document.getElementById(PANEL_ID)) return;

    const panel = document.createElement('section');
    panel.id = PANEL_ID;
    panel.className = 'tm-az-hidden-tag-panel';
    panel.setAttribute('aria-label', 'AgencyZoom hidden tag manager');
    panel.dataset.tmAzHiddenTagManagerVersion = VERSION;
    panel.addEventListener('click', handlePanelClick);
    panel.addEventListener('submit', handlePanelSubmit);
    (document.documentElement || document.body).appendChild(panel);
    lockPanelToViewport();
    ensureVersionBadge();
  }

  function renderPanel() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;

    const rows = hiddenTags
      .map((tag) => `
        <li class="tm-az-hidden-tag-row" data-key="${escapeAttr(tag.key)}">
          <span title="${escapeAttr(tag.selectorHint || '')}">${escapeHtml(tag.text)}</span>
          <button type="button" data-action="remove" data-key="${escapeAttr(tag.key)}" aria-label="Remove ${escapeAttr(tag.text)}">x</button>
        </li>
      `)
      .join('');

    panel.innerHTML = `
      <div class="tm-az-hidden-tag-head">
        <strong>Hidden Tags <span class="tm-az-hidden-tag-version">v${escapeHtml(VERSION)}</span></strong>
        <button type="button" data-action="close" aria-label="Close">x</button>
      </div>
      <div class="tm-az-hidden-tag-actions">
        <button type="button" data-action="toggle-pick" class="${picking ? 'tm-az-tag-active' : ''}">${picking ? 'Stop Picking' : 'Pick Tags'}</button>
        <button type="button" data-action="refresh">Refresh</button>
        <button type="button" data-action="save">Save</button>
      </div>
      <form class="tm-az-hidden-tag-manual" data-action="manual-add">
        <input type="text" name="tagText" placeholder="Tag name" autocomplete="off">
        <button type="submit">Add</button>
      </form>
      <div class="tm-az-hidden-tag-status ${lastStatus ? '' : 'tm-az-hidden-tag-muted'}">${escapeHtml(lastStatus || `${hiddenTags.length} selected`)}</div>
      <ul class="tm-az-hidden-tag-list">${rows || '<li class="tm-az-hidden-tag-empty">No tags selected</li>'}</ul>
    `;
    panel.dataset.tmAzHiddenTagManagerVersion = VERSION;
    lockPanelToViewport();
    ensureVersionBadge();

  }

  function lockPanelToViewport() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;

    setImportantStyle(panel, 'position', 'fixed');
    setImportantStyle(panel, 'right', '18px');
    setImportantStyle(panel, 'bottom', '18px');
    setImportantStyle(panel, 'left', 'auto');
    setImportantStyle(panel, 'top', 'auto');
    setImportantStyle(panel, 'transform', 'none');
    setImportantStyle(panel, 'z-index', '2147483647');
  }

  function setImportantStyle(el, property, value) {
    if (el.style.getPropertyValue(property) === value &&
        el.style.getPropertyPriority(property) === 'important') {
      return;
    }

    el.style.setProperty(property, value, 'important');
  }

  function ensureVersionBadge() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;

    lockPanelToViewport();

    for (const legacy of Array.from(panel.querySelectorAll(`.tm-az-hidden-tag-meta:not(#${VERSION_BADGE_ID})`))) {
      legacy.remove();
    }

    let badge = document.getElementById(VERSION_BADGE_ID);
    if (!badge || badge.parentElement !== panel) {
      if (badge) badge.remove();
      badge = document.createElement('div');
      badge.id = VERSION_BADGE_ID;
      badge.className = 'tm-az-hidden-tag-meta';
      panel.appendChild(badge);
    }

    const badgeText = `Current version v${VERSION}`;
    if (badge.textContent !== badgeText) badge.textContent = badgeText;
  }

  function handlePanelClick(event) {
    const action = event.target && event.target.getAttribute ? event.target.getAttribute('data-action') : '';
    const key = event.target && event.target.getAttribute ? event.target.getAttribute('data-key') : '';
    if (!action) return;

    if (action === 'close') {
      document.getElementById(PANEL_ID)?.remove();
      storageSet(STORAGE_KEYS.panelOpen, '0');
      return;
    }

    if (action === 'toggle-pick') {
      setPicking(!picking);
      return;
    }

    if (action === 'refresh') {
      refreshFromServer({ quiet: false });
      renderPanel();
      return;
    }

    if (action === 'save') {
      saveToServer().catch((err) => setStatus(`Save failed: ${errorMessage(err)}`, 'error'));
      renderPanel();
      return;
    }

    if (action === 'remove' && key) {
      removeTagByKey(key);
      scheduleSaveToServer();
      renderPanel();
      markCandidates();
      return;
    }

    renderPanel();
  }

  function handlePanelSubmit(event) {
    const form = event.target;
    if (!form || form.getAttribute('data-action') !== 'manual-add') return;
    event.preventDefault();
    const input = form.querySelector('input[name="tagText"]');
    const text = clean(input && input.value);
    if (text) {
      addOrUpdateTag({
        text,
        key: normalizeTagKey(text),
        tagId: '',
        selectorHint: 'manual entry',
        sourceUrl: location.href,
        updatedAt: new Date().toISOString()
      });
      scheduleSaveToServer();
    }
    renderPanel();
    markCandidates();
  }

  function setPicking(next) {
    picking = !!next;
    document.documentElement.classList.toggle(PICKING_CLASS, picking);

    if (picking) {
      document.addEventListener('click', handlePickClick, true);
      document.addEventListener('mouseover', handlePickHover, true);
      markCandidates();
      setStatus('Click a tag to toggle it.', 'ready');
    } else {
      document.removeEventListener('click', handlePickClick, true);
      document.removeEventListener('mouseover', handlePickHover, true);
      clearCandidateMarks();
      setStatus(`${hiddenTags.length} selected`, 'ready');
    }

    renderPanel();
  }

  function handlePickClick(event) {
    const candidate = closestTagCandidate(event.target);
    if (!candidate) return;

    event.preventDefault();
    event.stopPropagation();
    if (event.stopImmediatePropagation) event.stopImmediatePropagation();

    const record = extractTagRecord(candidate);
    if (!record.key) return;

    if (tagByKey.has(record.key)) {
      removeTagByKey(record.key);
      setStatus(`Removed: ${record.text}`, 'ready');
    } else {
      addOrUpdateTag(record);
      setStatus(`Added: ${record.text}`, 'ready');
    }

    scheduleSaveToServer();
    markCandidates();
    renderPanel();
  }

  function handlePickHover(event) {
    const candidate = closestTagCandidate(event.target);
    if (!candidate) return;
    const record = extractTagRecord(candidate);
    candidate.title = record.text ? `Toggle hidden tag: ${record.text}` : 'Toggle hidden tag';
  }

  function markCandidates() {
    clearCandidateMarks();
    for (const el of findTagCandidates()) {
      const record = extractTagRecord(el);
      if (!record.key) continue;
      el.classList.add(CANDIDATE_CLASS);
      el.classList.toggle(SELECTED_CLASS, tagByKey.has(record.key));
      el.setAttribute('data-tm-az-hidden-tag-key', record.key);
    }
  }

  function clearCandidateMarks() {
    for (const el of Array.from(document.querySelectorAll(`.${CANDIDATE_CLASS}, .${SELECTED_CLASS}, [data-tm-az-hidden-tag-key]`))) {
      el.classList.remove(CANDIDATE_CLASS, SELECTED_CLASS);
      el.removeAttribute('data-tm-az-hidden-tag-key');
    }
  }

  function closestTagCandidate(target) {
    let el = target && target.nodeType === Node.ELEMENT_NODE ? target : target?.parentElement;
    while (el && el !== document.body && el !== document.documentElement) {
      if (isOwnUi(el)) return null;
      if (isLikelyTagElement(el)) return el;
      if (el.matches && el.matches(CARD_SELECTOR)) return null;
      el = el.parentElement;
    }
    return null;
  }

  function findTagCandidates() {
    const roots = getCardRoots();
    const candidates = [];
    for (const root of roots) {
      const direct = root.matches && root.matches(TAG_SELECTOR) ? [root] : [];
      const nested = safeQueryAll(root, TAG_SELECTOR);
      for (const el of direct.concat(nested)) {
        if (isLikelyTagElement(el)) candidates.push(el);
      }

      for (const el of safeQueryAll(root, '[class], [id], [data-name], [data-value]')) {
        if (isLikelyTagElement(el)) candidates.push(el);
      }
    }
    return uniqueElements(candidates);
  }

  function getCardRoots() {
    const cards = safeQueryAll(document, CARD_SELECTOR);
    if (cards.length) return cards;

    const dock = document.querySelector('.az-dock__container, #serviceDetailDock, .az-dock');
    if (dock) return [dock];

    return [document.body].filter(Boolean);
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
    const key = normalizeTagKey(text);
    const tagId = clean(
      attr(el, 'data-tag-id') ||
      attr(el, 'data-tag') ||
      attr(el, 'data-id')
    );

    return {
      key,
      text,
      tagId,
      active: true,
      updatedAt: new Date().toISOString(),
      sourceUrl: location.href,
      selectorHint: summarizeElement(el)
    };
  }

  function addOrUpdateTag(tag) {
    if (!tag || !tag.key || !tag.text) return;
    const next = {
      key: tag.key,
      text: tag.text,
      tagId: tag.tagId || '',
      active: tag.active !== false,
      updatedAt: tag.updatedAt || new Date().toISOString(),
      sourceUrl: tag.sourceUrl || location.href,
      selectorHint: tag.selectorHint || ''
    };

    tagByKey.set(next.key, next);
    hiddenTags = Array.from(tagByKey.values()).sort((a, b) => a.text.localeCompare(b.text));
    changeVersion += 1;
    cacheTags();
  }

  function removeTagByKey(key) {
    tagByKey.delete(key);
    hiddenTags = Array.from(tagByKey.values()).sort((a, b) => a.text.localeCompare(b.text));
    changeVersion += 1;
    cacheTags();
  }

  function rebuildIndex() {
    tagByKey = new Map();
    for (const tag of hiddenTags) {
      const text = clean(tag.text);
      const key = normalizeTagKey(tag.key || text);
      if (!text || !key) continue;
      tagByKey.set(key, {
        key,
        text,
        tagId: clean(tag.tagId),
        active: tag.active !== false,
        updatedAt: clean(tag.updatedAt),
        sourceUrl: clean(tag.sourceUrl),
        selectorHint: clean(tag.selectorHint)
      });
    }
    hiddenTags = Array.from(tagByKey.values()).sort((a, b) => a.text.localeCompare(b.text));
  }

  async function refreshFromServer(options = {}) {
    const startedVersion = changeVersion;
    const endpointUrl = getEndpointUrl();
    if (!endpointUrl) {
      if (!options.quiet) setStatus('Set the Web App URL first.', 'error');
      return;
    }

    const url = buildUrl(endpointUrl, {
      action: 'list',
      readToken: getReadToken(),
      _: String(Date.now())
    });

    const response = await requestJson({ method: 'GET', url });
    if (!response || response.ok !== true) {
      throw new Error(response && response.message ? response.message : 'Sheet read failed');
    }

    if (changeVersion !== startedVersion) {
      setStatus('Skipped Sheet refresh because local tag changes are pending.', 'ready');
      return;
    }

    hiddenTags = Array.isArray(response.tags) ? response.tags : [];
    rebuildIndex();
    cacheTags();
    setStatus(`Loaded ${hiddenTags.length} tags`, 'ready');
    renderPanel();
    if (picking) markCandidates();
  }

  function scheduleSaveToServer(delay = 700) {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      saveToServer().catch((err) => setStatus(`Save failed: ${errorMessage(err)}`, 'error'));
    }, delay);
  }

  async function saveToServer() {
    window.clearTimeout(saveTimer);

    if (saveInFlight) {
      saveAgainAfterCurrent = true;
      setStatus('Save queued...', 'ready');
      return;
    }

    cacheTags();
    const endpointUrl = getEndpointUrl();
    if (!endpointUrl) {
      setStatus('Saved locally. Set Web App URL to sync.', 'error');
      return;
    }

    saveInFlight = true;
    saveAgainAfterCurrent = false;
    const snapshotVersion = changeVersion;
    const snapshotTags = hiddenTags.map((tag) => ({ ...tag }));
    setStatus(`Saving ${snapshotTags.length} tags...`, 'ready');

    try {
      const response = await requestJson({
        method: 'POST',
        url: endpointUrl,
        data: {
          action: 'replace',
          managerToken: getManagerToken(),
          updatedBy: getManagerName(),
          tags: snapshotTags
        }
      });

      if (!response || response.ok !== true) {
        throw new Error(response && response.message ? response.message : 'Sheet write failed');
      }

      if (changeVersion === snapshotVersion) {
        hiddenTags = Array.isArray(response.tags) ? response.tags : snapshotTags;
        rebuildIndex();
        cacheTags();
        setStatus(`Saved ${hiddenTags.length} tags`, 'ready');
        return;
      }

      saveAgainAfterCurrent = true;
      setStatus('Saving latest tag changes...', 'ready');
    } finally {
      saveInFlight = false;
    }

    if (saveAgainAfterCurrent) {
      saveAgainAfterCurrent = false;
      await saveToServer();
    }
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

  function promptEndpointUrl() {
    const current = getEndpointUrl();
    const value = prompt('Apps Script Web App URL:', current);
    if (value == null) return;
    storageSet(STORAGE_KEYS.endpointUrl, clean(value));
    setStatus('Web App URL saved.', 'ready');
    refreshFromServer({ quiet: false }).catch((err) => setStatus(`Load failed: ${errorMessage(err)}`, 'error'));
  }

  function promptManagerToken() {
    const current = getManagerToken();
    const label = current ? `Current token: ${maskToken(current)}\nPaste replacement, leave blank to clear, or Cancel to keep:` : 'Manager write token:';
    const value = prompt(label, '');
    if (value == null) return;
    storageSet(STORAGE_KEYS.managerToken, clean(value));
    setStatus('Manager token saved.', 'ready');
  }

  function promptReadToken() {
    const current = getReadToken();
    const label = current ? `Current token: ${maskToken(current)}\nPaste replacement, leave blank to clear, or Cancel to keep:` : 'Read token, if your Apps Script requires one:';
    const value = prompt(label, '');
    if (value == null) return;
    storageSet(STORAGE_KEYS.readToken, clean(value));
    setStatus('Read token saved.', 'ready');
  }

  function getEndpointUrl() {
    return clean(storageGet(STORAGE_KEYS.endpointUrl, DEFAULT_ENDPOINT_URL));
  }

  function getManagerToken() {
    return clean(storageGet(STORAGE_KEYS.managerToken, DEFAULT_MANAGER_TOKEN));
  }

  function getReadToken() {
    return clean(storageGet(STORAGE_KEYS.readToken, DEFAULT_READ_TOKEN));
  }

  function getManagerName() {
    return clean(document.querySelector('[data-user-name]')?.getAttribute('data-user-name')) ||
      clean(document.querySelector('.user-name, .profile-name, .account-name')?.textContent) ||
      'AgencyZoom manager';
  }

  function loadCachedTags() {
    return parseJson(storageGet(STORAGE_KEYS.cache, '[]')) || [];
  }

  function cacheTags() {
    storageSet(STORAGE_KEYS.cache, JSON.stringify(hiddenTags));
  }

  function setStatus(message, kind) {
    lastStatus = clean(message);
    const panel = document.getElementById(PANEL_ID);
    if (panel) {
      panel.dataset.statusKind = kind || '';
      const status = panel.querySelector('.tm-az-hidden-tag-status');
      if (status) status.textContent = lastStatus;
    }
  }

  function buildUrl(base, params) {
    const url = new URL(base, location.href);
    for (const [key, value] of Object.entries(params || {})) {
      if (value) url.searchParams.set(key, value);
    }
    return url.toString();
  }

  function getVisibleText(el) {
    if (!el) return '';
    const clone = el.cloneNode(true);
    clone.querySelectorAll(`#${PANEL_ID}, [class^="tm-az-hidden-tag"], [class*=" tm-az-hidden-tag"]`).forEach((node) => node.remove());
    return clean(clone.innerText || clone.textContent || '');
  }

  function summarizeElement(el) {
    if (!el) return '';
    const parts = [lower(el.tagName || '')];
    if (el.id) parts.push(`#${el.id}`);
    if (el.className) {
      const classes = String(el.className).split(/\s+/).filter(Boolean).slice(0, 5);
      if (classes.length) parts.push(`.${classes.join('.')}`);
    }
    const tagId = attr(el, 'data-tag-id') || attr(el, 'data-id');
    if (tagId) parts.push(`[data-id="${tagId}"]`);
    return parts.join('');
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

  function looksLikePhoneOrEmail(text) {
    return /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text) ||
      /\+?1?[\s().-]*\d{3}[\s().-]*\d{3}[\s().-]*\d{4}/.test(text);
  }

  function isOwnUi(el) {
    return !!(el && el.closest && el.closest(`#${PANEL_ID}, [class^="tm-az-hidden-tag"], [class*=" tm-az-hidden-tag"]`));
  }

  function attr(el, name) {
    return el && el.getAttribute ? clean(el.getAttribute(name)) : '';
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

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[char]);
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, '&#96;');
  }

  function maskToken(value) {
    const text = clean(value);
    if (text.length <= 8) return text ? '********' : '';
    return `${text.slice(0, 4)}...${text.slice(-4)}`;
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
    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement('style');
      style.id = STYLE_ID;
      document.head.appendChild(style);
    }

    style.textContent = `
      .tm-az-hidden-tag-panel {
        position: fixed !important;
        right: 18px !important;
        bottom: 18px !important;
        left: auto !important;
        top: auto !important;
        transform: none !important;
        z-index: 2147483647 !important;
        box-sizing: border-box;
        width: 310px;
        max-width: calc(100vw - 24px);
        max-height: min(620px, calc(100vh - 24px));
        display: flex;
        flex-direction: column;
        overflow: hidden;
        border: 1px solid rgba(15, 23, 42, .18);
        border-radius: 8px;
        background: #ffffff;
        color: #111827;
        box-shadow: 0 18px 45px rgba(15, 23, 42, .24);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .tm-az-hidden-tag-head,
      .tm-az-hidden-tag-actions,
      .tm-az-hidden-tag-manual {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .tm-az-hidden-tag-head {
        justify-content: space-between;
        padding: 10px;
        border-bottom: 1px solid rgba(15, 23, 42, .1);
        background: #f8fafc;
        font-size: 13px;
      }
      .tm-az-hidden-tag-version {
        margin-left: 4px;
        color: #64748b;
        font-size: 11px;
        font-weight: 700;
      }
      .tm-az-hidden-tag-head button,
      .tm-az-hidden-tag-row button {
        width: 24px;
        height: 24px;
        border: 0;
        border-radius: 4px;
        background: transparent;
        color: #475569;
        cursor: pointer;
        font: 700 14px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .tm-az-hidden-tag-head button:hover,
      .tm-az-hidden-tag-row button:hover {
        background: #e2e8f0;
        color: #0f172a;
      }
      .tm-az-hidden-tag-actions {
        padding: 10px 10px 0;
      }
      .tm-az-hidden-tag-actions button,
      .tm-az-hidden-tag-manual button {
        min-height: 28px;
        border: 1px solid rgba(15, 23, 42, .16);
        border-radius: 6px;
        background: #ffffff;
        color: #0f172a;
        padding: 0 9px;
        font: 700 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        cursor: pointer;
      }
      .tm-az-hidden-tag-actions button:hover,
      .tm-az-hidden-tag-manual button:hover,
      .tm-az-hidden-tag-actions .tm-az-tag-active {
        border-color: #2563eb;
        background: #2563eb;
        color: #ffffff;
      }
      .tm-az-hidden-tag-manual {
        padding: 8px 10px 0;
      }
      .tm-az-hidden-tag-manual input {
        min-width: 0;
        flex: 1;
        height: 28px;
        box-sizing: border-box;
        border: 1px solid rgba(15, 23, 42, .16);
        border-radius: 6px;
        padding: 0 8px;
        color: #111827;
        background: #ffffff;
        font: 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .tm-az-hidden-tag-status {
        margin: 8px 10px;
        padding: 7px 8px;
        border-radius: 6px;
        background: #eff6ff;
        color: #1e3a8a;
        font-size: 12px;
        line-height: 1.35;
      }
      .tm-az-hidden-tag-muted {
        background: #f8fafc;
        color: #64748b;
      }
      .tm-az-hidden-tag-list {
        flex: 1 1 auto;
        min-height: 0;
        overflow: auto;
        margin: 0;
        padding: 0 10px 10px;
        list-style: none;
      }
      .tm-az-hidden-tag-meta {
        flex: 0 0 auto;
        padding: 7px 10px;
        border-top: 1px solid rgba(15, 23, 42, .1);
        background: #f8fafc;
        color: #475569;
        font: 700 11px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        text-align: right;
      }
      .tm-az-hidden-tag-row,
      .tm-az-hidden-tag-empty {
        min-height: 30px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        border-bottom: 1px solid rgba(15, 23, 42, .08);
        font-size: 12px;
      }
      .tm-az-hidden-tag-row span {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .tm-az-hidden-tag-empty {
        justify-content: center;
        color: #64748b;
      }
      .${PICKING_CLASS} .${CANDIDATE_CLASS} {
        outline: 2px dashed rgba(37, 99, 235, .95) !important;
        outline-offset: 2px !important;
        cursor: crosshair !important;
      }
      .${PICKING_CLASS} .${SELECTED_CLASS} {
        outline-color: rgba(220, 38, 38, .95) !important;
        box-shadow: 0 0 0 3px rgba(254, 202, 202, .72) !important;
      }
    `;
  }

  console.debug(`[${SCRIPT}] loaded v${VERSION}`);
})();
