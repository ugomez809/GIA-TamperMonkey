// ==UserScript==
// @name         LOCAL AgencyZoom AI Follow-Up Updater
// @namespace    local.agencyzoom.ai-followup.updater
// @version      0.3
// @description  Loads and auto-updates only the AgencyZoom AI Follow-Up script from GitHub.
// @match        https://app.agencyzoom.com/referral/pipeline*
// @exclude      https://app.agencyzoom.com/login*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
// @grant        unsafeWindow
// @connect      raw.githubusercontent.com
// @connect      api.openai.com
// @connect      docs.google.com
// @connect      spreadsheets.google.com
// @connect      googleusercontent.com
// @updateURL    https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/refs/heads/main/AgencyZoom/agencyzoom-ai-followup-updater.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/refs/heads/main/AgencyZoom/agencyzoom-ai-followup-updater.user.js
// ==/UserScript==

(function () {
  'use strict';

  const LOADER_VERSION = '0.3';
  const TARGET_ID = 'ai-followup';
  const TARGET_LABEL = 'AI Follow-Up';
  const TARGET_FILE = 'agencyzoom-ai-followup.user.js';
  const BASE_URL = 'https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/refs/heads/main/AgencyZoom';
  const CHECK_INTERVAL_MS = 30 * 1000;
  const RELOAD_DELAY_MS = 1200;
  const CACHE_KEY = `tmAzPerScriptUpdater:${TARGET_ID}:code`;
  const VERSION_KEY = `tmAzPerScriptUpdater:${TARGET_ID}:version`;
  const LAST_CHECK_KEY = `tmAzPerScriptUpdater:${TARGET_ID}:lastCheck`;
  const RELOAD_KEY = `tmAzPerScriptUpdater:${TARGET_ID}:reload`;

  let executed = false;
  let debugEnabled = false;
  let forceRequested = false;
  let clearRequested = false;

  boot();

  function boot() {
    if (!isAgencyZoom()) return;
    applyOptionsFromUrl();

    if (clearRequested) clearCache();

    const cached = storageGet(CACHE_KEY, '');
    if (cached) executeTarget(cached, 'cache');

    checkForUpdates({ runIfNoCache: !cached, forceReload: forceRequested })
      .catch((err) => console.warn(`[AZ ${TARGET_LABEL} Updater] update check failed`, err));

    window.setInterval(() => {
      checkForUpdates({ runIfNoCache: false, forceReload: false })
        .catch((err) => console.warn(`[AZ ${TARGET_LABEL} Updater] background update failed`, err));
    }, CHECK_INTERVAL_MS);
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
    console.info(`[AZ ${TARGET_LABEL} Updater] Running ${TARGET_LABEL} from ${source}.`);
    eval(`${code}\n//# sourceURL=${sourceUrl}`);
  }

  function fetchTarget() {
    return new Promise((resolve, reject) => {
      const url = `${BASE_URL}/${TARGET_FILE}?tmAzUpdater=${Date.now()}`;
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

    debugEnabled = isTruthy(url.searchParams.get('azUpdaterDebug')) || isTruthy(url.searchParams.get('azAiDebug'));
    forceRequested = isTruthy(url.searchParams.get('azUpdaterForce')) || isTruthy(url.searchParams.get('azAiForce'));
    clearRequested = isTruthy(url.searchParams.get('azUpdaterClear')) || isTruthy(url.searchParams.get('azAiClear'));

    if (forceRequested || clearRequested) sessionStorage.removeItem(RELOAD_KEY);

    url.searchParams.delete('azAiDebug');
    url.searchParams.delete('azAiForce');
    url.searchParams.delete('azAiClear');
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

  function isAgencyZoom() {
    return /(^|\.)app\.agencyzoom\.com$/i.test(String(location.hostname || ''));
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
      if (typeof GM_deleteValue === 'function') GM_deleteValue(key);
    } catch {}
    try { localStorage.removeItem(key); } catch {}
  }
})();
