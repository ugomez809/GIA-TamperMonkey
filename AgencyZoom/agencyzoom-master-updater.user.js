// ==UserScript==
// @name         LOCAL AgencyZoom Master Updater
// @namespace    local.agencyzoom.master-updater
// @version      0.3
// @description  Checks GitHub for AgencyZoom script updates, caches the newest scripts, and runs the latest versions.
// @match        https://app.agencyzoom.com/*
// @exclude      https://app.agencyzoom.com/login*
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_setClipboard
// @grant        unsafeWindow
// @connect      raw.githubusercontent.com
// @connect      api.openai.com
// @connect      docs.google.com
// @connect      spreadsheets.google.com
// @connect      googleusercontent.com
// @connect      script.google.com
// @connect      script.googleusercontent.com
// @updateURL    https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/AgencyZoom/agencyzoom-master-updater.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/AgencyZoom/agencyzoom-master-updater.user.js
// ==/UserScript==

(function () {
  'use strict';

  const VERSION = '0.3';
  const SCRIPT = 'AZ Master Updater';
  const BASE_URL = 'https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/AgencyZoom';
  const CHECK_INTERVAL_MS = 5 * 60 * 1000;
  const RELOAD_DELAY_MS = 900;
  const DEFAULT_ROLE = 'producer';
  const STORAGE_KEYS = {
    role: 'tmAzMasterUpdaterRole',
    lastCheck: 'tmAzMasterUpdaterLastCheck',
    lastStatus: 'tmAzMasterUpdaterLastStatus'
  };
  const SESSION_RELOAD_KEY = 'tmAzMasterUpdaterReloadSignature';
  const SCRIPT_CATALOG = [
    {
      id: 'producer-hide-tags',
      label: 'Producer Hide Tags',
      file: 'agencyzoom-producer-hide-tags.user.js',
      roles: ['producer', 'manager', 'all']
    },
    {
      id: 'phone-click-to-call',
      label: 'Click-to-Call',
      file: 'agencyzoom-phone-click-to-call.user.js',
      roles: ['producer', 'manager', 'all']
    },
    {
      id: 'ai-followup',
      label: 'AI Follow-Up',
      file: 'agencyzoom-ai-followup.user.js',
      roles: ['producer', 'manager', 'all']
    },
    {
      id: 'hidden-tag-manager',
      label: 'Hidden Tag Manager',
      file: 'agencyzoom-hidden-tag-manager.user.js',
      roles: ['manager', 'all']
    }
  ];

  let executedAnyCachedScript = false;
  let booted = false;

  boot();

  function boot() {
    if (booted || !isAgencyZoom()) return;
    booted = true;

    const role = getRole();
    const scripts = getScriptsForRole(role);
    if (!scripts.length) {
      setStatus(`No scripts configured for role "${role}".`);
      return;
    }

    loadScripts(scripts)
      .then(() => maybeCheckForUpdates(scripts))
      .catch((err) => {
        console.error(`[${SCRIPT}] boot failed`, err);
        setStatus(`Boot failed: ${errorMessage(err)}`);
      });
  }

  function isAgencyZoom() {
    return /(^|\.)app\.agencyzoom\.com$/i.test(String(location.hostname || ''));
  }

  async function loadScripts(scripts) {
    for (const script of scripts) {
      const cached = storageGet(scriptCacheKey(script.id), '');
      if (cached) {
        executedAnyCachedScript = true;
        executeScript(script, cached, 'cache');
        continue;
      }

      const remote = await fetchScript(script);
      storageSet(scriptCacheKey(script.id), remote);
      storageSet(scriptVersionKey(script.id), extractVersion(remote));
      executeScript(script, remote, 'remote');
    }

    setStatus(`Loaded ${scripts.length} AgencyZoom scripts for role "${getRole()}".`);
  }

  async function maybeCheckForUpdates(scripts) {
    const lastCheck = Number(storageGet(STORAGE_KEYS.lastCheck, 0)) || 0;
    if (Date.now() - lastCheck < CHECK_INTERVAL_MS) return;
    await checkForUpdates(scripts, { forceReload: false, forceFetch: true });
  }

  async function checkForUpdates(scripts, options = {}) {
    const changed = [];

    for (const script of scripts) {
      try {
        const remote = await fetchScript(script);
        const cached = storageGet(scriptCacheKey(script.id), '');
        if (!sameCode(remote, cached)) {
          storageSet(scriptCacheKey(script.id), remote);
          storageSet(scriptVersionKey(script.id), extractVersion(remote));
          changed.push(script);
        }
      } catch (err) {
        console.warn(`[${SCRIPT}] Could not update ${script.label}:`, err);
      }
    }

    storageSet(STORAGE_KEYS.lastCheck, String(Date.now()));

    if (!changed.length) {
      setStatus(`No AgencyZoom updates found. Role: ${getRole()}.`);
      if (options.forceReload) alert('AgencyZoom scripts are already up to date.');
      return;
    }

    const signature = changed.map((script) => `${script.id}:${storageGet(scriptVersionKey(script.id), '')}`).join('|');
    setStatus(`Updated: ${changed.map((script) => script.label).join(', ')}`);

    if (options.forceReload || executedAnyCachedScript) {
      reloadOnce(signature);
    }
  }

  function executeScript(script, code, source) {
    try {
      const sourceUrl = `${BASE_URL}/${script.file}`;
      console.info(`[${SCRIPT}] Running ${script.label} from ${source}.`);
      const GM_registerMenuCommand = function () { return null; };
      eval(`${code}\n//# sourceURL=${sourceUrl}`);
    } catch (err) {
      console.error(`[${SCRIPT}] ${script.label} failed`, err);
      setStatus(`${script.label} failed: ${errorMessage(err)}`);
    }
  }

  function fetchScript(script) {
    return new Promise((resolve, reject) => {
      const url = `${BASE_URL}/${script.file}?tmAzUpdater=${Date.now()}`;
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        timeout: 20000,
        onload: (response) => {
          if (response.status < 200 || response.status >= 300) {
            reject(new Error(`${script.label} returned HTTP ${response.status}`));
            return;
          }
          const text = String(response.responseText || '').trim();
          if (!text || !text.includes('// ==UserScript==')) {
            reject(new Error(`${script.label} did not look like a userscript`));
            return;
          }
          resolve(text);
        },
        onerror: () => reject(new Error(`${script.label} network request failed`)),
        ontimeout: () => reject(new Error(`${script.label} request timed out`))
      });
    });
  }

  function reloadOnce(signature) {
    const prior = sessionStorage.getItem(SESSION_RELOAD_KEY);
    if (prior === signature) {
      setStatus('Updates were cached; reload was skipped to avoid a loop.');
      return;
    }

    sessionStorage.setItem(SESSION_RELOAD_KEY, signature);
    setStatus('AgencyZoom scripts updated. Reloading once...');
    window.setTimeout(() => location.reload(), RELOAD_DELAY_MS);
  }

  function getScriptsForRole(role) {
    const normalized = normalizeRole(role);
    return SCRIPT_CATALOG.filter((script) => script.roles.includes(normalized));
  }

  function getRole() {
    return normalizeRole(storageGet(STORAGE_KEYS.role, DEFAULT_ROLE));
  }

  function normalizeRole(value) {
    const role = clean(value).toLowerCase();
    if (['manager', 'admin'].includes(role)) return 'manager';
    if (role === 'all') return 'all';
    return 'producer';
  }

  function scriptCacheKey(id) {
    return `tmAzMasterUpdaterScript:${id}`;
  }

  function scriptVersionKey(id) {
    return `tmAzMasterUpdaterVersion:${id}`;
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

  function setStatus(message) {
    const status = clean(message);
    storageSet(STORAGE_KEYS.lastStatus, status);
    console.info(`[${SCRIPT}] ${status}`);
  }

  function clean(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
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

})();
