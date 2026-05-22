// ==UserScript==
// @name         LOCAL AgencyZoom Master Updater
// @namespace    local.agencyzoom.master-updater
// @version      0.13
// @description  Retired safety stub. AgencyZoom scripts now install and auto-update individually through Tampermonkey.
// @match        https://app.agencyzoom.com/*
// @exclude      https://app.agencyzoom.com/login*
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_setClipboard
// @grant        unsafeWindow
// @connect      api.github.com
// @connect      raw.githubusercontent.com
// @connect      api.openai.com
// @connect      docs.google.com
// @connect      spreadsheets.google.com
// @connect      googleusercontent.com
// @connect      script.google.com
// @connect      script.googleusercontent.com
// @updateURL    https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/refs/heads/main/AgencyZoom/agencyzoom-master-updater.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/refs/heads/main/AgencyZoom/agencyzoom-master-updater.user.js
// ==/UserScript==

(function () {
  'use strict';

  const VERSION = '0.13';
  const SCRIPT = 'AZ Master Updater';
  const RETIRED = true;
  const BASE_URL = 'https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/refs/heads/main/AgencyZoom';
  const COMMIT_API_URL = 'https://api.github.com/repos/ugomez809/GIA-TamperMonkey/commits/main';
  const CHECK_INTERVAL_MS = 60 * 1000;
  const RELOAD_DELAY_MS = 2000;
  const DEFAULT_ROLE = 'producer';
  const DEFAULT_TOOL_MODE = 'core';
  const DEFAULT_ENABLED = false;
  const STORAGE_KEYS = {
    enabled: 'tmAzMasterUpdaterEnabled',
    role: 'tmAzMasterUpdaterRole',
    toolMode: 'tmAzMasterUpdaterToolMode',
    lastCheck: 'tmAzMasterUpdaterLastCheck',
    lastStatus: 'tmAzMasterUpdaterLastStatus'
  };
  const SESSION_RELOAD_KEY = 'tmAzMasterUpdaterReloadSignature';
  const SESSION_DEBUG_ONCE_KEY = 'tmAzMasterUpdaterDebugOnce';
  const SCRIPT_CATALOG = [
    {
      id: 'producer-hide-tags',
      label: 'Producer Hide Tags',
      file: 'agencyzoom-producer-hide-tags.user.js',
      roles: ['producer', 'all'],
      runAt: 'start',
      defaultEnabled: true
    },
    {
      id: 'phone-click-to-call',
      label: 'Click-to-Call',
      file: 'agencyzoom-phone-click-to-call.user.js',
      roles: ['producer', 'manager', 'all'],
      runAt: 'idle',
      delayMs: 1200,
      defaultEnabled: false
    },
    {
      id: 'ai-followup',
      label: 'AI Follow-Up',
      file: 'agencyzoom-ai-followup.user.js',
      roles: ['producer', 'manager', 'all'],
      runAt: 'idle',
      delayMs: 1500,
      defaultEnabled: false
    },
    {
      id: 'hidden-tag-manager',
      label: 'Hidden Tag Manager',
      file: 'agencyzoom-hidden-tag-manager.user.js',
      roles: ['manager', 'all'],
      runAt: 'idle',
      delayMs: 1800,
      defaultEnabled: true
    }
  ];

  let booted = false;
  let updateTimer = 0;
  let debugEnabled = false;
  let forceCheckRequested = false;
  let clearCacheRequested = false;
  let latestScriptBaseUrl = '';

  boot();

  function boot() {
    if (booted || !isAgencyZoom()) return;
    booted = true;

    applyOptionsFromUrl();

    if (RETIRED) {
      clearScriptCache();
      storageSet(STORAGE_KEYS.enabled, '0');
      setStatus('Retired: install AgencyZoom scripts individually.');
      if (debugEnabled) showDebugStatus('Master updater retired.');
      return;
    }

    if (!isUpdaterEnabled()) {
      setStatus('Safe mode: child scripts are disabled.');
      if (debugEnabled) showDebugStatus('Safe mode enabled.');
      return;
    }

    const role = getRole();
    const scripts = getScriptsForRole(role);
    if (!scripts.length) {
      setStatus(`No scripts configured for role "${role}".`);
      return;
    }

    loadScripts(scripts)
      .then(() => {
        runAfterPageReady(() => checkForUpdates(scripts), 2500);
        startUpdateTimer(scripts);
      })
      .catch((err) => {
        console.error(`[${SCRIPT}] boot failed`, err);
        setStatus(`Boot failed: ${errorMessage(err)}`);
      });
  }

  function isAgencyZoom() {
    return /(^|\.)app\.agencyzoom\.com$/i.test(String(location.hostname || ''));
  }

  async function loadScripts(scripts) {
    let remoteBaseUrl = '';

    for (const script of scripts) {
      try {
        const cached = storageGet(scriptCacheKey(script.id), '');
        if (cached) {
          executeScriptWhenReady(script, cached, 'cache');
          continue;
        }

        if (!remoteBaseUrl) remoteBaseUrl = await getScriptBaseUrl();
        const remote = await fetchScript(script, remoteBaseUrl);
        storageSet(scriptCacheKey(script.id), remote);
        storageSet(scriptVersionKey(script.id), extractVersion(remote));
        executeScriptWhenReady(script, remote, 'remote');
      } catch (err) {
        console.warn(`[${SCRIPT}] Could not load ${script.label}`, err);
        setStatus(`Load failed for ${script.label}: ${errorMessage(err)}`);
      }
    }

    setStatus(`Loaded ${scripts.length} AgencyZoom scripts for role "${getRole()}".`);
  }

  function startUpdateTimer(scripts) {
    if (updateTimer) window.clearInterval(updateTimer);
    updateTimer = window.setInterval(() => {
      checkForUpdates(scripts).catch((err) => {
        console.warn(`[${SCRIPT}] background update check failed`, err);
        setStatus(`Background check failed: ${errorMessage(err)}`);
      });
    }, CHECK_INTERVAL_MS);
  }

  async function checkForUpdates(scripts) {
    const changed = [];
    const remoteBaseUrl = await getScriptBaseUrl({ force: true });

    for (const script of scripts) {
      try {
        const remote = await fetchScript(script, remoteBaseUrl);
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
      if (debugEnabled) showDebugStatus('No updates found.');
      return;
    }

    const signature = changed.map((script) => `${script.id}:${storageGet(scriptVersionKey(script.id), '')}`).join('|');
    setStatus(`Updated: ${changed.map((script) => script.label).join(', ')}`);
    reloadOnce(signature);
  }

  function executeScriptWhenReady(script, code, source) {
    if (script.runAt === 'idle') {
      runAfterPageReady(() => executeScript(script, code, source), script.delayMs || 1000);
      return;
    }

    executeScript(script, code, source);
  }

  function executeScript(script, code, source) {
    try {
      const sourceUrl = `${latestScriptBaseUrl || BASE_URL}/${script.file}`;
      console.info(`[${SCRIPT}] Running ${script.label} from ${source}.`);
      const GM_registerMenuCommand = function () { return null; };
      eval(`${code}\n//# sourceURL=${sourceUrl}`);
    } catch (err) {
      console.error(`[${SCRIPT}] ${script.label} failed`, err);
      setStatus(`${script.label} failed: ${errorMessage(err)}`);
    }
  }

  function fetchScript(script, baseUrl) {
    return new Promise((resolve, reject) => {
      const url = `${baseUrl || BASE_URL}/${script.file}?tmAzUpdater=${Date.now()}`;
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

  async function getScriptBaseUrl(options = {}) {
    if (latestScriptBaseUrl && !options.force) return latestScriptBaseUrl;

    try {
      const sha = await fetchLatestCommitSha();
      latestScriptBaseUrl = `https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/${sha}/AgencyZoom`;
      return latestScriptBaseUrl;
    } catch (err) {
      console.warn(`[${SCRIPT}] Could not resolve latest commit; using branch URL`, err);
      latestScriptBaseUrl = BASE_URL;
      return latestScriptBaseUrl;
    }
  }

  function fetchLatestCommitSha() {
    return new Promise((resolve, reject) => {
      const url = `${COMMIT_API_URL}?tmAzUpdater=${Date.now()}`;
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        headers: { Accept: 'application/vnd.github+json' },
        timeout: 20000,
        onload: (response) => {
          if (response.status < 200 || response.status >= 300) {
            reject(new Error(`GitHub commit lookup returned HTTP ${response.status}`));
            return;
          }

          const data = parseJson(response.responseText);
          const sha = clean(data && data.sha);
          if (!/^[a-f0-9]{40}$/i.test(sha)) {
            reject(new Error('GitHub commit lookup did not return a valid SHA'));
            return;
          }

          resolve(sha);
        },
        onerror: () => reject(new Error('GitHub commit lookup network request failed')),
        ontimeout: () => reject(new Error('GitHub commit lookup timed out'))
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
    runAfterPageReady(() => location.reload(), RELOAD_DELAY_MS);
  }

  function runAfterPageReady(callback, delayMs = 0) {
    let ran = false;
    const run = () => {
      if (ran) return;
      ran = true;
      window.setTimeout(callback, delayMs);
    };

    if (document.readyState === 'complete') {
      run();
      return;
    }

    window.addEventListener('load', run, { once: true });
    window.setTimeout(run, 10000);
  }

  function getScriptsForRole(role) {
    const normalized = normalizeRole(role);
    const toolMode = getToolMode();
    return SCRIPT_CATALOG.filter((script) =>
      script.roles.includes(normalized) &&
      (toolMode === 'all' || script.defaultEnabled !== false)
    );
  }

  function getRole() {
    return normalizeRole(storageGet(STORAGE_KEYS.role, DEFAULT_ROLE));
  }

  function getToolMode() {
    const mode = clean(storageGet(STORAGE_KEYS.toolMode, DEFAULT_TOOL_MODE)).toLowerCase();
    return mode === 'all' ? 'all' : 'core';
  }

  function isUpdaterEnabled() {
    const value = clean(storageGet(STORAGE_KEYS.enabled, DEFAULT_ENABLED ? '1' : '0')).toLowerCase();
    return ['1', 'true', 'yes', 'on'].includes(value);
  }

  function applyOptionsFromUrl() {
    let url = null;
    try {
      url = new URL(location.href);
    } catch {
      return;
    }

    const requestedRole = clean(url.searchParams.get('azUpdaterRole'));
    const requestedToolMode = clean(url.searchParams.get('azUpdaterTools'));
    const requestedEnabled = clean(url.searchParams.get('azUpdaterEnabled'));
    const requestedOff = ['1', 'true', 'yes'].includes(clean(url.searchParams.get('azUpdaterOff')).toLowerCase());
    const requestedDebug = ['1', 'true', 'yes'].includes(clean(url.searchParams.get('azUpdaterDebug')).toLowerCase());
    forceCheckRequested = ['1', 'true', 'yes'].includes(clean(url.searchParams.get('azUpdaterForce')).toLowerCase());
    clearCacheRequested = ['1', 'true', 'yes'].includes(clean(url.searchParams.get('azUpdaterClear')).toLowerCase());

    if (requestedDebug) {
      try { sessionStorage.setItem(SESSION_DEBUG_ONCE_KEY, '1'); } catch {}
    }
    if (forceCheckRequested || clearCacheRequested) {
      try { sessionStorage.removeItem(SESSION_RELOAD_KEY); } catch {}
    }
    debugEnabled = requestedDebug || sessionStorage.getItem(SESSION_DEBUG_ONCE_KEY) === '1';

    if (requestedOff) {
      storageSet(STORAGE_KEYS.enabled, '0');
      setStatus('Updater disabled from URL.');
    } else if (requestedEnabled) {
      const enabled = ['1', 'true', 'yes', 'on'].includes(requestedEnabled.toLowerCase());
      storageSet(STORAGE_KEYS.enabled, enabled ? '1' : '0');
      setStatus(`Updater ${enabled ? 'enabled' : 'disabled'} from URL.`);
    }

    if (clearCacheRequested) {
      clearScriptCache();
      setStatus('Script cache cleared from URL.');
    }

    if (requestedRole) {
      const nextRole = normalizeRole(requestedRole);
      storageSet(STORAGE_KEYS.role, nextRole);
      setStatus(`Role set from URL: ${nextRole}`);
    }

    if (requestedToolMode) {
      const nextToolMode = requestedToolMode.toLowerCase() === 'all' ? 'all' : 'core';
      storageSet(STORAGE_KEYS.toolMode, nextToolMode);
      setStatus(`Tool mode set from URL: ${nextToolMode}`);
    }

    url.searchParams.delete('azUpdaterRole');
    url.searchParams.delete('azUpdaterTools');
    url.searchParams.delete('azUpdaterEnabled');
    url.searchParams.delete('azUpdaterOff');
    url.searchParams.delete('azUpdaterDebug');
    url.searchParams.delete('azUpdaterForce');
    url.searchParams.delete('azUpdaterClear');
    history.replaceState(history.state, document.title, url.toString());
  }

  function clearScriptCache() {
    for (const script of SCRIPT_CATALOG) {
      storageDelete(scriptCacheKey(script.id));
      storageDelete(scriptVersionKey(script.id));
    }

    storageDelete(STORAGE_KEYS.lastCheck);
    latestScriptBaseUrl = '';
  }

  function showDebugStatus(prefix) {
    const role = getRole();
    const scripts = getScriptsForRole(role);
    const lines = [
      `${prefix}`,
      `Updater: v${VERSION}`,
      `Enabled: ${isUpdaterEnabled() ? 'yes' : 'no'}`,
      `Role: ${role}`,
      `Tools: ${getToolMode()}`,
      `Checked: ${formatTimestamp(storageGet(STORAGE_KEYS.lastCheck, ''))}`,
      `Last status: ${storageGet(STORAGE_KEYS.lastStatus, 'none')}`
    ];

    for (const script of scripts) {
      lines.push(`${script.label}: ${storageGet(scriptVersionKey(script.id), 'not cached')}`);
    }

    try { sessionStorage.removeItem(SESSION_DEBUG_ONCE_KEY); } catch {}
    debugEnabled = false;
    alert(lines.join('\n'));
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

  function formatTimestamp(value) {
    const timestamp = Number(value) || 0;
    if (!timestamp) return 'never';
    try {
      return new Date(timestamp).toLocaleString();
    } catch {
      return String(timestamp);
    }
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

  function storageDelete(key) {
    try {
      if (typeof GM_deleteValue === 'function') {
        GM_deleteValue(key);
      }
    } catch {}
    try { localStorage.removeItem(key); } catch {}
  }

})();
