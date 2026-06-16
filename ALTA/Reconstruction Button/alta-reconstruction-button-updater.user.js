// ==UserScript==
// @name         ALTA Reconstruction Calculator Button Updater
// @namespace    local.alta.reconstruction-button.updater
// @version      0.4
// @description  Loads and auto-updates the ALTA Reconstruction Calculator Button script from GitHub.
// @match        https://alta.farmers.com/*
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_getResourceText
// @connect      raw.githubusercontent.com
// @resource     altaReconstructionButtonRaw https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/ALTA/Reconstruction%20Button/alta-reconstruction-button.user.js
// @updateURL    https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/ALTA/Reconstruction%20Button/alta-reconstruction-button-updater.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/ALTA/Reconstruction%20Button/alta-reconstruction-button-updater.user.js
// ==/UserScript==

(function () {
  'use strict';

  const LOADER_VERSION = '0.4';
  const TARGET_ID = 'alta-reconstruction-button';
  const TARGET_LABEL = 'ALTA Reconstruction Calculator Button';
  const TARGET_FILE = 'alta-reconstruction-button.user.js';
  const RESOURCE_NAME = 'altaReconstructionButtonRaw';
  const BASE_URL = 'https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/ALTA/Reconstruction%20Button';
  const CHECK_INTERVAL_MS = 30 * 1000;
  const RELOAD_DELAY_MS = 1200;
  const FETCH_TIMEOUT_MS = 12000;
  const RETRY_DELAY_MS = 1200;
  const TARGET_WAIT_INTERVAL_MS = 300;
  const TARGET_WAIT_DURATION_MS = 90000;
  const CACHE_KEY = `tmGwpcPerScriptUpdater:${TARGET_ID}:code`;
  const VERSION_KEY = `tmGwpcPerScriptUpdater:${TARGET_ID}:version`;
  const LAST_CHECK_KEY = `tmGwpcPerScriptUpdater:${TARGET_ID}:lastCheck`;
  const RELOAD_KEY = `tmGwpcPerScriptUpdater:${TARGET_ID}:reload`;

  let executed = false;
  let executedCode = '';
  let debugEnabled = false;
  let forceRequested = false;
  let clearRequested = false;
  let reloadQueued = false;
  let pendingTarget = null;
  let targetWaitTimer = 0;
  let targetWaitStartedAt = 0;

  boot();

  function boot() {
    if (!isAlta()) return;
    applyOptionsFromUrl();

    if (clearRequested) clearCache();

    const cached = getValidCode(storageGet(CACHE_KEY, ''));
    const bundled = cached ? '' : getBundledTarget();
    const initialCode = cached || bundled;

    if (initialCode) runTargetWhenReady(initialCode, cached ? 'cache' : 'bundled resource');

    checkForUpdates({ runIfNoLocal: !initialCode, forceReload: forceRequested })
      .catch((err) => console.warn(`[${TARGET_LABEL} Updater] update check failed`, err));

    window.setInterval(() => {
      checkForUpdates({ runIfNoLocal: false, forceReload: false })
        .catch((err) => console.warn(`[${TARGET_LABEL} Updater] background update failed`, err));
    }, CHECK_INTERVAL_MS);
  }

  async function checkForUpdates(options = {}) {
    const remote = await fetchTarget();
    const cached = getValidCode(storageGet(CACHE_KEY, ''));
    const remoteVersion = extractVersion(remote);

    storageSet(LAST_CHECK_KEY, String(Date.now()));

    if (!sameCode(remote, cached)) {
      storageSet(CACHE_KEY, remote);
      storageSet(VERSION_KEY, remoteVersion);

      if (options.runIfNoLocal && !executed) {
        runTargetWhenReady(remote, 'remote');
        if (debugEnabled) showStatus(`Loaded ${TARGET_LABEL} v${remoteVersion}.`);
        return;
      }

      if (sameCode(remote, executedCode)) {
        if (debugEnabled) showStatus(`${TARGET_LABEL} cache refreshed: v${remoteVersion}.`);
        return;
      }

      if (!executed) {
        runTargetWhenReady(remote, 'remote');
        return;
      }

      if (shouldRunTargetNow()) {
        reloadOnce(remoteVersion, options.forceReload);
      }
      return;
    }

    if (debugEnabled) showStatus(`${TARGET_LABEL} already current: v${remoteVersion}.`);
  }

  function executeTarget(code, source) {
    const targetCode = getValidCode(code);
    if (executed || !targetCode) return false;

    const sourceUrl = `${BASE_URL}/${TARGET_FILE}`;
    const runnable = `${targetCode}\n//# sourceURL=${sourceUrl}`;
    console.info(`[${TARGET_LABEL} Updater] Running ${TARGET_LABEL} from ${source}.`);

    try {
      eval(runnable);
      executed = true;
      executedCode = targetCode;
      storageSet(VERSION_KEY, extractVersion(targetCode));
      return true;
    } catch (err) {
      console.error(`[${TARGET_LABEL} Updater] failed to run ${source} copy`, err);
      if (source === 'cache') storageDelete(CACHE_KEY);
      return false;
    }
  }

  function runTargetWhenReady(code, source) {
    const targetCode = getValidCode(code);
    if (executed || !targetCode) return;

    pendingTarget = {
      code: targetCode,
      source
    };

    if (shouldRunTargetNow()) {
      executePendingTarget();
      return;
    }

    startTargetWaiter();
  }

  function executePendingTarget() {
    if (!pendingTarget || executed) return;
    const target = pendingTarget;
    pendingTarget = null;
    executeTarget(target.code, target.source);
  }

  function startTargetWaiter() {
    if (targetWaitTimer) return;
    if (!targetWaitStartedAt) targetWaitStartedAt = Date.now();

    const check = () => {
      if (!pendingTarget || executed) {
        targetWaitTimer = 0;
        return;
      }

      if (shouldRunTargetNow()) {
        targetWaitTimer = 0;
        executePendingTarget();
        return;
      }

      if (Date.now() - targetWaitStartedAt >= TARGET_WAIT_DURATION_MS) {
        targetWaitTimer = 0;
        targetWaitStartedAt = 0;
        return;
      }

      targetWaitTimer = window.setTimeout(check, TARGET_WAIT_INTERVAL_MS);
    };

    check();
  }

  async function fetchTarget() {
    const errors = [];

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const url = `${BASE_URL}/${TARGET_FILE}?tmGwpcUpdater=${Date.now()}-${attempt}`;
      try {
        return await requestTarget(url);
      } catch (err) {
        errors.push(err);
        if (attempt === 0) await delay(RETRY_DELAY_MS);
      }
    }

    throw errors[errors.length - 1] || new Error(`${TARGET_LABEL} request failed`);
  }

  function requestTarget(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        timeout: FETCH_TIMEOUT_MS,
        onload: (response) => {
          if (response.status < 200 || response.status >= 300) {
            reject(new Error(`${TARGET_LABEL} returned HTTP ${response.status}`));
            return;
          }

          const text = getValidCode(response.responseText);
          if (!text) {
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
    if (reloadQueued) return;
    const signature = `${TARGET_ID}:${version}`;
    if (!force && sessionStorage.getItem(RELOAD_KEY) === signature) return;
    reloadQueued = true;
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

    const optionNames = [
      'altaReconstructionUpdaterDebug',
      'altaReconstructionUpdaterForce',
      'altaReconstructionUpdaterClear'
    ];
    const shouldCleanUrl = optionNames.some((name) => url.searchParams.has(name));

    debugEnabled = isTruthy(url.searchParams.get('altaReconstructionUpdaterDebug'));
    forceRequested = isTruthy(url.searchParams.get('altaReconstructionUpdaterForce'));
    clearRequested = isTruthy(url.searchParams.get('altaReconstructionUpdaterClear'));

    if (forceRequested || clearRequested) sessionStorage.removeItem(RELOAD_KEY);

    if (shouldCleanUrl) {
      optionNames.forEach((name) => url.searchParams.delete(name));
      history.replaceState(history.state, document.title, url.toString());
    }
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

  function isAlta() {
    return /^alta\.farmers\.com$/i.test(String(location.hostname || ''));
  }

  function shouldRunTargetNow() {
    if (!isAlta()) return false;

    const path = String(location.pathname || '');
    if (/^\/quote(?:\/|$)/i.test(path)) return true;

    try {
      return Boolean(
        document.querySelector('[data-test-id="Google_Maps_Launch"], app-home-features, .home-feature-wrapper, .titleAndAddress')
      );
    } catch {
      return false;
    }
  }

  function extractVersion(code) {
    const match = String(code || '').match(/^\/\/\s*@version\s+([^\s]+)/m);
    return match ? match[1] : 'unknown';
  }

  function sameCode(left, right) {
    return normalizeCode(left) === normalizeCode(right);
  }

  function getValidCode(value) {
    const code = normalizeCode(value);
    return code && code.includes('// ==UserScript==') && code.includes('ALTA Reconstruction Calculator Button') ? code : '';
  }

  function getBundledTarget() {
    try {
      if (typeof GM_getResourceText !== 'function') return '';
      return getValidCode(GM_getResourceText(RESOURCE_NAME));
    } catch (err) {
      console.warn(`[${TARGET_LABEL} Updater] bundled resource unavailable`, err);
      return '';
    }
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

  function delay(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }
})();
