// ==UserScript==
// @name         AZ-LEX Bus Updater
// @namespace    local.jr.az-lex-localbus.updater
// @version      0.2
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
// @connect      raw.githubusercontent.com
// @updateURL    https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/JR/AZ-LEX-LocalBus/AZ-LEX-LocalBus-updater.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/JR/AZ-LEX-LocalBus/AZ-LEX-LocalBus-updater.user.js
// ==/UserScript==

(function () {
  'use strict';

  const LOADER_VERSION = '0.2';
  const TARGET_ID = 'az-lex-localbus';
  const TARGET_LABEL = 'AZ-LEX Bus';
  const TARGET_FILE = 'AZ-LEX-LocalBus.user.js';
  const BASE_URL = 'https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/JR/AZ-LEX-LocalBus';
  const CHECK_INTERVAL_MS = 1000;
  const RELOAD_DELAY_MS = 1200;
  const CACHE_KEY = `tmGiaPerScriptUpdater:${TARGET_ID}:code`;
  const VERSION_KEY = `tmGiaPerScriptUpdater:${TARGET_ID}:version`;
  const LAST_CHECK_KEY = `tmGiaPerScriptUpdater:${TARGET_ID}:lastCheck`;
  const RELOAD_KEY = `tmGiaPerScriptUpdater:${TARGET_ID}:reload`;

  let executed = false;
  let debugEnabled = false;
  let forceRequested = false;
  let clearRequested = false;
  let updateCheckRunning = false;

  boot();

  function boot() {
    if (!isAllowedHost()) return;
    applyOptionsFromUrl();

    if (clearRequested) clearCache();

    const cached = storageGet(CACHE_KEY, '');
    if (cached) executeTarget(cached, 'cache');

    queueUpdateCheck('startup', { runIfNoCache: !cached, forceReload: forceRequested });

    window.setInterval(() => {
      queueUpdateCheck('background', { runIfNoCache: false, forceReload: false });
    }, CHECK_INTERVAL_MS);

    window.addEventListener('focus', () => queueUpdateCheck('focus'));
    window.addEventListener('online', () => queueUpdateCheck('online'));
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) queueUpdateCheck('visible');
    });
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

  async function checkForUpdates(options = {}) {
    const remote = await fetchTarget();
    const cached = storageGet(CACHE_KEY, '');
    const remoteVersion = extractVersion(remote);

    storageSet(LAST_CHECK_KEY, String(Date.now()));

    if (!sameCode(remote, cached)) {
      storageSet(CACHE_KEY, remote);
      storageSet(VERSION_KEY, remoteVersion);

      if (options.runIfNoCache && !executed) {
        executeTarget(remote, 'remote');
        if (debugEnabled) showStatus(`Loaded ${TARGET_LABEL} v${remoteVersion}.`);
        return;
      }

      reloadOnce(remoteVersion, options.forceReload);
      return;
    }

    if (debugEnabled) showStatus(`${TARGET_LABEL} already current: v${remoteVersion}.`);
  }

  function executeTarget(code, source) {
    if (executed) return;
    executed = true;
    storageSet(VERSION_KEY, extractVersion(code));
    const sourceUrl = `${BASE_URL}/${TARGET_FILE}`;
    console.info(`[${TARGET_LABEL} Updater] Running ${TARGET_LABEL} from ${source}.`);
    eval(`${code}\n//# sourceURL=${sourceUrl}`);
  }

  function fetchTarget() {
    return new Promise((resolve, reject) => {
      const url = `${BASE_URL}/${TARGET_FILE}?tmGiaUpdater=${Date.now()}`;
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        timeout: 20000,
        onload: (response) => {
          if (response.status < 200 || response.status >= 300) {
            reject(new Error(`${TARGET_LABEL} returned HTTP ${response.status}`));
            return;
          }

          const text = String(response.responseText || '').trim();
          if (!text || !text.includes('// ==UserScript==')) {
            reject(new Error(`${TARGET_LABEL} did not look like a userscript`));
            return;
          }

          resolve(text);
        },
        onerror: () => reject(new Error(`${TARGET_LABEL} network request failed`)),
        ontimeout: () => reject(new Error(`${TARGET_LABEL} request timed out`))
      });
    });
  }

  function reloadOnce(version, force) {
    const signature = `${TARGET_ID}:${version}`;
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
      `Last check: ${formatTimestamp(storageGet(LAST_CHECK_KEY, ''))}`
    ].join('\n'));
  }

  function clearCache() {
    storageDelete(CACHE_KEY);
    storageDelete(VERSION_KEY);
    storageDelete(LAST_CHECK_KEY);
  }

  function isAllowedHost() {
    const host = String(location.hostname || '').toLowerCase();
    return host.includes('agencyzoom.com') || host.includes('lightning.force.com');
  }

  function extractVersion(code) {
    const match = String(code || '').match(/^\/\/\s*@version\s+([^\s]+)/m);
    return match ? match[1] : 'unknown';
  }

  function sameCode(left, right) {
    return normalizeCode(left) === normalizeCode(right);
  }

  function normalizeCode(value) {
    return String(value || '').replace(/\r\n?/g, '\n').trim();
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
