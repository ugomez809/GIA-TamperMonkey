// ==UserScript==
// @name         AZ-LEX Bus Updater
// @namespace    local.jr.az-lex-localbus.updater
// @version      0.5
// @description  Loads and auto-updates only the AZ-LEX Bus script from GitHub.
// @match        https://app.agencyzoom.com/*
// @match        https://farmersagent.lightning.force.com/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_addValueChangeListener
// @grant        GM_removeValueChangeListener
// @grant        GM_openInTab
// @connect      api.github.com
// @connect      raw.githubusercontent.com
// @updateURL    https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/JR/AZ-LEX-LocalBus/AZ-LEX-LocalBus-updater.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/JR/AZ-LEX-LocalBus/AZ-LEX-LocalBus-updater.user.js
// ==/UserScript==

(function () {
  'use strict';

  const LOADER_VERSION = '0.5';
  const TARGET_ID = 'az-lex-localbus';
  const TARGET_LABEL = 'AZ-LEX Bus';
  const REPOSITORY = 'ugomez809/GIA-TamperMonkey';
  const BRANCH = 'main';
  const TARGET_PATH = 'JR/AZ-LEX-LocalBus/AZ-LEX-LocalBus.user.js';
  const SELF_PATH = 'JR/AZ-LEX-LocalBus/AZ-LEX-LocalBus-updater.user.js';
  const TARGET_FILE = 'AZ-LEX-LocalBus.user.js';
  const SELF_FILE = 'AZ-LEX-LocalBus-updater.user.js';
  const BASE_URL = 'https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/JR/AZ-LEX-LocalBus';
  const SELF_URL = `${BASE_URL}/${SELF_FILE}`;
  const TARGET_API_URL = `https://api.github.com/repos/${REPOSITORY}/contents/${TARGET_PATH}?ref=${BRANCH}`;
  const SELF_API_URL = `https://api.github.com/repos/${REPOSITORY}/contents/${SELF_PATH}?ref=${BRANCH}`;
  const CHECK_INTERVAL_MS = 1000;
  const API_CHECK_INTERVAL_MS = 60000;
  const SELF_API_CHECK_INTERVAL_MS = 300000;
  const RELOAD_DELAY_MS = 1200;
  const CACHE_KEY = `tmGiaPerScriptUpdater:${TARGET_ID}:code`;
  const VERSION_KEY = `tmGiaPerScriptUpdater:${TARGET_ID}:version`;
  const SOURCE_KEY = `tmGiaPerScriptUpdater:${TARGET_ID}:source`;
  const LAST_CHECK_KEY = `tmGiaPerScriptUpdater:${TARGET_ID}:lastCheck`;
  const RELOAD_KEY = `tmGiaPerScriptUpdater:${TARGET_ID}:reload`;
  const SELF_LAST_CHECK_KEY = `tmGiaPerScriptUpdater:${TARGET_ID}:selfLastCheck`;
  const SELF_PROMPT_KEY = `tmGiaPerScriptUpdater:${TARGET_ID}:selfPromptVersion`;
  const SELF_BANNER_ID = `tmGiaPerScriptUpdater-${TARGET_ID}-selfUpdate`;
  const STATUS_BANNER_ID = `tmGiaPerScriptUpdater-${TARGET_ID}-status`;

  let executed = false;
  let debugEnabled = false;
  let forceRequested = false;
  let clearRequested = false;
  let updateCheckRunning = false;
  let selfUpdateCheckRunning = false;
  let lastApiTargetCheck = 0;
  let lastApiSelfCheck = 0;

  boot();

  function boot() {
    if (!isAllowedHost()) return;
    applyOptionsFromUrl();

    if (clearRequested) clearCache();

    const cached = storageGet(CACHE_KEY, '');
    if (cached) executeTarget(cached, 'cache');

    queueUpdateCheck('startup', { runIfNoCache: !cached, forceReload: forceRequested });
    queueSelfUpdateCheck('startup');

    window.setInterval(() => {
      queueUpdateCheck('background', { runIfNoCache: false, forceReload: false });
      queueSelfUpdateCheck('background');
    }, CHECK_INTERVAL_MS);

    window.addEventListener('focus', () => queueWakeChecks('focus'));
    window.addEventListener('online', () => queueWakeChecks('online'));
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) queueWakeChecks('visible');
    });
  }

  function queueWakeChecks(source) {
    queueUpdateCheck(source, { forceApi: true });
    queueSelfUpdateCheck(source, { forceApi: true });
  }

  function queueUpdateCheck(source, options = {}) {
    if (updateCheckRunning) return;
    updateCheckRunning = true;
    checkForUpdates(options)
      .catch((err) => console.warn(`[${TARGET_LABEL} Updater] ${source} update check failed`, err))
      .finally(() => {
        updateCheckRunning = false;
      });
  }

  function queueSelfUpdateCheck(source, options = {}) {
    if (selfUpdateCheckRunning) return;
    selfUpdateCheckRunning = true;
    checkForSelfUpdate(options)
      .catch((err) => console.warn(`[${TARGET_LABEL} Updater] ${source} self-update check failed`, err))
      .finally(() => {
        selfUpdateCheckRunning = false;
      });
  }

  async function checkForUpdates(options = {}) {
    const payload = await fetchTarget(options);
    const remote = payload.text;
    const cached = storageGet(CACHE_KEY, '');
    const remoteVersion = extractVersion(remote);
    const remoteHash = hashCode(remote);

    storageSet(LAST_CHECK_KEY, String(Date.now()));
    storageSet(SOURCE_KEY, payload.source);

    if (!sameCode(remote, cached)) {
      storageSet(CACHE_KEY, remote);
      storageSet(VERSION_KEY, remoteVersion);
      console.info(`[${TARGET_LABEL} Updater] Cached ${TARGET_LABEL} v${remoteVersion} (${remoteHash}) from ${payload.source}.`);

      if (options.runIfNoCache && !executed) {
        executeTarget(remote, 'remote');
        if (debugEnabled) showStatus(`Loaded ${TARGET_LABEL} v${remoteVersion}.`);
        return;
      }

      showUpdateStatus(`Updating ${TARGET_LABEL} to v${remoteVersion}...`, 4000);
      reloadOnce(remoteVersion, remoteHash, options.forceReload);
      return;
    }

    if (debugEnabled) showStatus(`${TARGET_LABEL} already current: v${remoteVersion}.`);
  }

  async function checkForSelfUpdate(options = {}) {
    const payload = await fetchSelfUpdater(options);
    const remote = payload.text;
    const remoteVersion = extractVersion(remote);
    storageSet(SELF_LAST_CHECK_KEY, String(Date.now()));

    if (compareVersions(remoteVersion, LOADER_VERSION) <= 0) return;

    showSelfUpdateBanner(remoteVersion);
    maybeOpenSelfInstall(remoteVersion);
  }

  function executeTarget(code, source) {
    if (executed) return;
    executed = true;
    storageSet(VERSION_KEY, extractVersion(code));
    const sourceUrl = `${BASE_URL}/${TARGET_FILE}`;
    console.info(`[${TARGET_LABEL} Updater] Running ${TARGET_LABEL} from ${source}.`);
    eval(`${code}\n//# sourceURL=${sourceUrl}`);
  }

  function fetchTarget(options = {}) {
    return fetchUserscriptWithApiFallback({
      apiUrl: TARGET_API_URL,
      rawUrl: `${BASE_URL}/${TARGET_FILE}`,
      label: TARGET_LABEL,
      forceApi: options.forceApi,
      apiEveryMs: API_CHECK_INTERVAL_MS,
      getLastApiCheck: () => lastApiTargetCheck,
      setLastApiCheck: (ts) => { lastApiTargetCheck = ts; },
    });
  }

  async function fetchUserscriptWithApiFallback(opts) {
    const shouldTryApi = opts.forceApi || (Date.now() - opts.getLastApiCheck() >= opts.apiEveryMs);
    if (shouldTryApi) {
      opts.setLastApiCheck(Date.now());
      try {
        return await fetchGitHubApiFile(opts.apiUrl, opts.label);
      } catch (err) {
        console.warn(`[${TARGET_LABEL} Updater] GitHub API fetch failed for ${opts.label}; falling back to raw`, err);
      }
    }

    return await fetchRawUserscript(opts.rawUrl, opts.label);
  }

  function fetchRawUserscript(rawUrl, label) {
    return new Promise((resolve, reject) => {
      const url = `${rawUrl}?tmGiaUpdater=${Date.now()}`;
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        timeout: 20000,
        onload: (response) => {
          if (response.status < 200 || response.status >= 300) {
            reject(new Error(`${label} returned HTTP ${response.status}`));
            return;
          }

          const text = String(response.responseText || '').trim();
          if (!text || !text.includes('// ==UserScript==')) {
            reject(new Error(`${label} did not look like a userscript`));
            return;
          }

          resolve({ text, source: 'raw' });
        },
        onerror: () => reject(new Error(`${label} network request failed`)),
        ontimeout: () => reject(new Error(`${label} request timed out`))
      });
    });
  }

  function fetchGitHubApiFile(apiUrl, label) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url: apiUrl,
        headers: {
          Accept: 'application/vnd.github+json'
        },
        timeout: 20000,
        onload: (response) => {
          if (response.status < 200 || response.status >= 300) {
            reject(new Error(`${label} API returned HTTP ${response.status}`));
            return;
          }

          let payload = null;
          try { payload = JSON.parse(String(response.responseText || '{}')); } catch {}
          const text = decodeBase64Utf8(String(payload?.content || '').replace(/\s+/g, '')).trim();
          if (!text || !text.includes('// ==UserScript==')) {
            reject(new Error(`${label} API content did not look like a userscript`));
            return;
          }

          resolve({ text, source: `api:${String(payload?.sha || '').slice(0, 8) || 'unknown'}` });
        },
        onerror: () => reject(new Error(`${label} API request failed`)),
        ontimeout: () => reject(new Error(`${label} API request timed out`))
      });
    });
  }

  function fetchSelfUpdater(options = {}) {
    return fetchUserscriptWithApiFallback({
      apiUrl: SELF_API_URL,
      rawUrl: SELF_URL,
      label: 'Updater',
      forceApi: options.forceApi,
      apiEveryMs: SELF_API_CHECK_INTERVAL_MS,
      getLastApiCheck: () => lastApiSelfCheck,
      setLastApiCheck: (ts) => { lastApiSelfCheck = ts; },
    });
  }

  function showSelfUpdateBanner(remoteVersion) {
    let banner = document.getElementById(SELF_BANNER_ID);
    if (!banner) {
      banner = document.createElement('div');
      banner.id = SELF_BANNER_ID;
      banner.style.cssText = [
        'position:fixed',
        'right:16px',
        'top:16px',
        'z-index:2147483647',
        'max-width:360px',
        'padding:12px',
        'border-radius:8px',
        'background:#111827',
        'color:#fff',
        'box-shadow:0 12px 30px rgba(0,0,0,.28)',
        'font:13px/1.35 Arial,sans-serif'
      ].join(';');
      document.documentElement.appendChild(banner);
    }

    banner.innerHTML = '';

    const message = document.createElement('div');
    message.textContent = `${TARGET_LABEL} Updater ${remoteVersion} is available. Install it once so updater changes can apply immediately.`;
    banner.appendChild(message);

    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:8px;margin-top:10px;justify-content:flex-end';

    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.textContent = 'Later';
    dismiss.style.cssText = 'border:1px solid rgba(255,255,255,.35);border-radius:6px;padding:7px 10px;background:transparent;color:#fff;cursor:pointer';
    dismiss.addEventListener('click', () => {
      try { banner.remove(); } catch {}
    });

    const install = document.createElement('button');
    install.type = 'button';
    install.textContent = 'Install updater';
    install.style.cssText = 'border:0;border-radius:6px;padding:7px 10px;background:#2563eb;color:#fff;font-weight:700;cursor:pointer';
    install.addEventListener('click', () => openSelfInstall(remoteVersion));

    actions.appendChild(dismiss);
    actions.appendChild(install);
    banner.appendChild(actions);
  }

  function maybeOpenSelfInstall(remoteVersion) {
    if (storageGet(SELF_PROMPT_KEY, '') === remoteVersion) return;
    storageSet(SELF_PROMPT_KEY, remoteVersion);
    openSelfInstall(remoteVersion);
  }

  function openSelfInstall(remoteVersion) {
    const url = `${SELF_URL}?tmGiaSelfInstall=${Date.now()}`;
    console.info(`[${TARGET_LABEL} Updater] Updater v${remoteVersion} available. Opening installer.`);
    try {
      if (typeof GM_openInTab === 'function') {
        GM_openInTab(url, { active: true, insert: true, setParent: true });
        return;
      }
    } catch {}

    try { window.open(url, '_blank', 'noopener'); } catch {}
  }

  function showUpdateStatus(message, ms = 3000) {
    let banner = document.getElementById(STATUS_BANNER_ID);
    if (!banner) {
      banner = document.createElement('div');
      banner.id = STATUS_BANNER_ID;
      banner.style.cssText = [
        'position:fixed',
        'right:16px',
        'bottom:292px',
        'z-index:2147483647',
        'padding:8px 10px',
        'border-radius:8px',
        'background:#14532d',
        'color:#fff',
        'box-shadow:0 10px 24px rgba(0,0,0,.25)',
        'font:12px/1.25 Arial,sans-serif'
      ].join(';');
      document.documentElement.appendChild(banner);
    }

    banner.textContent = message;
    window.setTimeout(() => {
      try { banner.remove(); } catch {}
    }, ms);
  }

  function reloadOnce(version, hash, force) {
    const signature = `${TARGET_ID}:${version}:${hash || 'unknown'}`;
    if (!force && sessionStorage.getItem(RELOAD_KEY) === signature) return;
    sessionStorage.setItem(RELOAD_KEY, signature);
    window.setTimeout(() => location.reload(), RELOAD_DELAY_MS);
  }

  function applyOptionsFromUrl() {
    let url = null;
    try {
      url = new URL(location.href);
    } catch {
      return;
    }

    debugEnabled = isTruthy(url.searchParams.get('giaUpdaterDebug')) || isTruthy(url.searchParams.get('azLexBusDebug'));
    forceRequested = isTruthy(url.searchParams.get('giaUpdaterForce')) || isTruthy(url.searchParams.get('azLexBusForce'));
    clearRequested = isTruthy(url.searchParams.get('giaUpdaterClear')) || isTruthy(url.searchParams.get('azLexBusClear'));

    if (forceRequested || clearRequested) sessionStorage.removeItem(RELOAD_KEY);

    url.searchParams.delete('azLexBusDebug');
    url.searchParams.delete('azLexBusForce');
    url.searchParams.delete('azLexBusClear');
    history.replaceState(history.state, document.title, url.toString());
  }

  function showStatus(message) {
    alert([
      `Updater: ${TARGET_LABEL} loader v${LOADER_VERSION}`,
      message,
      `Cached: ${storageGet(VERSION_KEY, 'none')}`,
      `Source: ${storageGet(SOURCE_KEY, 'unknown')}`,
      `Last check: ${formatTimestamp(storageGet(LAST_CHECK_KEY, ''))}`,
      `Updater check: ${formatTimestamp(storageGet(SELF_LAST_CHECK_KEY, ''))}`
    ].join('\n'));
  }

  function clearCache() {
    storageDelete(CACHE_KEY);
    storageDelete(VERSION_KEY);
    storageDelete(SOURCE_KEY);
    storageDelete(LAST_CHECK_KEY);
    storageDelete(SELF_LAST_CHECK_KEY);
  }

  function isAllowedHost() {
    const host = String(location.hostname || '').toLowerCase();
    return host.includes('agencyzoom.com') || host.includes('lightning.force.com');
  }

  function extractVersion(code) {
    const match = String(code || '').match(/^\/\/\s*@version\s+([^\s]+)/m);
    return match ? match[1] : 'unknown';
  }

  function compareVersions(left, right) {
    const a = String(left || '').split('.').map((part) => Number.parseInt(part, 10));
    const b = String(right || '').split('.').map((part) => Number.parseInt(part, 10));
    const max = Math.max(a.length, b.length);
    for (let i = 0; i < max; i++) {
      const av = Number.isFinite(a[i]) ? a[i] : 0;
      const bv = Number.isFinite(b[i]) ? b[i] : 0;
      if (av > bv) return 1;
      if (av < bv) return -1;
    }
    return 0;
  }

  function sameCode(left, right) {
    return normalizeCode(left) === normalizeCode(right);
  }

  function normalizeCode(value) {
    return String(value || '').replace(/\r\n?/g, '\n').trim();
  }

  function hashCode(value) {
    const text = normalizeCode(value);
    let hash = 5381;
    for (let i = 0; i < text.length; i++) {
      hash = ((hash << 5) + hash) ^ text.charCodeAt(i);
    }
    return (hash >>> 0).toString(16);
  }

  function decodeBase64Utf8(value) {
    const binary = atob(value || '');
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    try {
      return new TextDecoder('utf-8').decode(bytes);
    } catch {
      let out = '';
      for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
      return out;
    }
  }

  function isTruthy(value) {
    return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
  }

  function formatTimestamp(value) {
    const timestamp = Number(value) || 0;
    if (!timestamp) return 'never';
    try {
      return new Date(timestamp).toLocaleString();
    } catch {
      return String(timestamp);
    }
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

  function storageDelete(key) {
    try {
      if (typeof GM_deleteValue === 'function') {
        GM_deleteValue(key);
        return;
      }
    } catch {}
    try { localStorage.removeItem(key); } catch {}
  }
})();
