// ==UserScript==
// @name         PolicyCenter - Hosted Mileage Calculator Updater
// @namespace    local.policycenter.hosted-mileage.updater
// @version      0.1.0
// @description  Loads and auto-updates the PolicyCenter - Hosted Mileage Calculator from GitHub.
// @author       Ulises Gomez Agency
// @homepageURL  https://github.com/ugomez809/GIA-TamperMonkey
// @supportURL   https://github.com/ugomez809/GIA-TamperMonkey/issues
// @match        https://policycenter.farmersinsurance.com/pc/*
// @match        https://policycenter-2.farmersinsurance.com/pc/*
// @connect      api.github.com
// @connect      raw.githubusercontent.com
// @connect      script.google.com
// @connect      docs.google.com
// @connect      script.googleusercontent.com
// @connect      spreadsheets.google.com
// @connect      sheets.googleapis.com
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @run-at       document-idle
// @noframes
// @updateURL    https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/General%20Utilities/Mileage%20Calculator/policycenter-mileage-calculator-updater.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/General%20Utilities/Mileage%20Calculator/policycenter-mileage-calculator-updater.user.js
// ==/UserScript==

(function loadPolicyCenterMileageCalculator() {
  'use strict';

  const LOADER_VERSION = '0.1.0';
  const TARGET_ID = 'policycenter-mileage-calculator';
  const TARGET_LABEL = 'PolicyCenter - Hosted Mileage Calculator';
  const TARGET_FILE = 'policycenter-mileage-calculator.user.js';
  const BASE_URL = 'https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/General%20Utilities/Mileage%20Calculator';
  const COMMIT_API_URL = 'https://api.github.com/repos/ugomez809/GIA-TamperMonkey/commits/main';
  const CHECK_INTERVAL_MS = 15 * 60 * 1000;

  const CACHE_KEY = `tmStaffPerScriptUpdater:${TARGET_ID}:code`;
  const VERSION_KEY = `tmStaffPerScriptUpdater:${TARGET_ID}:version`;
  const COMMIT_KEY = `tmStaffPerScriptUpdater:${TARGET_ID}:commit`;
  const LAST_CHECK_KEY = `tmStaffPerScriptUpdater:${TARGET_ID}:lastCheck`;

  const params = new URLSearchParams(window.location.search);
  const debugEnabled = hasFlag('staffUpdaterDebug') || hasFlag('mileageUpdaterDebug');
  const forceCheck = hasFlag('staffUpdaterForce') || hasFlag('mileageUpdaterForce');
  const clearRequested = hasFlag('staffUpdaterClear') || hasFlag('mileageUpdaterClear');

  let executedSource = '';
  let executedCachedScript = false;

  if (!isPolicyCenter()) {
    return;
  }

  if (clearRequested) {
    clearCache();
  }

  const cachedSource = storageGet(CACHE_KEY, '');
  if (cachedSource) {
    try {
      executedCachedScript = executeTarget(cachedSource, storageGet(VERSION_KEY, 'cache'));
    } catch (error) {
      clearCache();
      warn(`cached script failed; fetching a fresh copy: ${error.message}`);
    }
  }

  refreshTarget().catch((error) => {
    warn(`update check failed: ${error.message}`);
  });

  function hasFlag(name) {
    const value = params.get(name);
    return value === '' || ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
  }

  function isPolicyCenter() {
    return ['policycenter.farmersinsurance.com', 'policycenter-2.farmersinsurance.com'].includes(location.hostname) && location.pathname.startsWith('/pc/');
  }

  async function refreshTarget() {
    const now = Date.now();
    const lastCheck = Number(storageGet(LAST_CHECK_KEY, 0)) || 0;
    if (!forceCheck && cachedSource && executedCachedScript && now - lastCheck < CHECK_INTERVAL_MS) {
      log('skipped remote check; cache interval has not expired');
      return;
    }

    storageSet(LAST_CHECK_KEY, String(now));

    const commitSha = await fetchLatestCommitSha().catch((error) => {
      warn(`commit lookup failed; using branch raw URL: ${error.message}`);
      return '';
    });
    const remoteUrl = commitSha
      ? `https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/${commitSha}/General%20Utilities/Mileage%20Calculator/${TARGET_FILE}`
      : `${BASE_URL}/${TARGET_FILE}`;
    const remoteSource = await requestText(`${remoteUrl}?tmStaffUpdater=${Date.now()}`);
    const currentSource = storageGet(CACHE_KEY, '');
    const remoteVersion = extractVersion(remoteSource);

    validateTarget(remoteSource);

    if (sameCode(remoteSource, currentSource)) {
      log(`${TARGET_LABEL} already current: v${remoteVersion}`);
      if (!executedCachedScript) {
        executeAndCache(remoteSource, remoteVersion, commitSha);
      }
      return;
    }

    executeAndCache(remoteSource, remoteVersion, commitSha);
  }

  function executeAndCache(source, version, commitSha) {
    storageSet(CACHE_KEY, source);
    storageSet(VERSION_KEY, version);
    storageSet(COMMIT_KEY, commitSha || 'branch');
    log(`cached ${TARGET_LABEL} v${version}`);

    if (!executedCachedScript) {
      executedCachedScript = executeTarget(source, version);
      return;
    }

    log('updated cache; new target will run on the next PolicyCenter page load');
  }

  async function fetchLatestCommitSha() {
    const response = await requestText(`${COMMIT_API_URL}?tmStaffUpdater=${Date.now()}`, {
      Accept: 'application/vnd.github+json'
    });
    const payload = parseJson(response);
    const sha = clean(payload && payload.sha);
    if (!/^[a-f0-9]{40}$/i.test(sha)) {
      throw new Error('GitHub commit lookup did not return a valid SHA');
    }
    return sha;
  }

  function executeTarget(source, version) {
    if (!source || sameCode(source, executedSource)) {
      return false;
    }

    validateTarget(source);
    storageSet(VERSION_KEY, extractVersion(source));
    log(`running ${TARGET_LABEL} v${version} with loader ${LOADER_VERSION}`);
    eval(`${source}\n//# sourceURL=${BASE_URL}/${TARGET_FILE}`);
    executedSource = source;
    return true;
  }

  function validateTarget(source) {
    if (!/^\/\/ ==UserScript==\s*$/m.test(source) ||
        !/^\/\/\s*@namespace\s+local\.policycenter\.hosted-mileage\s*$/m.test(source) ||
        extractVersion(source) === 'unknown') {
      throw new Error('downloaded target is not the PolicyCenter mileage userscript');
    }
  }

  function requestText(url, headers = {}) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        headers,
        timeout: 20000,
        onload: (response) => {
          if (response.status < 200 || response.status >= 300) {
            reject(new Error(`GET ${url} returned HTTP ${response.status}`));
            return;
          }
          resolve(String(response.responseText || ''));
        },
        onerror: () => reject(new Error(`GET ${url} failed`)),
        ontimeout: () => reject(new Error(`GET ${url} timed out`))
      });
    });
  }

  function clearCache() {
    storageDelete(CACHE_KEY);
    storageDelete(VERSION_KEY);
    storageDelete(COMMIT_KEY);
    storageDelete(LAST_CHECK_KEY);
    log('cleared cached target script');
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

  function parseJson(text) {
    try {
      return JSON.parse(String(text || '').trim());
    } catch {
      return null;
    }
  }

  function clean(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }

  function storageGet(key, fallback = '') {
    try {
      if (typeof GM_getValue === 'function') {
        return GM_getValue(key, fallback);
      }
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

    try {
      localStorage.setItem(key, String(value));
    } catch {}
  }

  function storageDelete(key) {
    try {
      if (typeof GM_deleteValue === 'function') {
        GM_deleteValue(key);
      }
    } catch {}

    try {
      localStorage.removeItem(key);
    } catch {}
  }

  function log(message) {
    if (debugEnabled) {
      console.info(`[${TARGET_LABEL} Updater] ${message}`);
    }
  }

  function warn(message) {
    console.warn(`[${TARGET_LABEL} Updater] ${message}`);
  }
})();
