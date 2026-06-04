// ==UserScript==
// @name         Ricochet Script Updater
// @namespace    GIA.INC
// @version      1.0.0
// @description  Checks the Ricochet Tampermonkey scripts for GitHub updates.
// @author       JKira & Mr.G
// @match        https://giainc.ricochet.me/*
// @updateURL    https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/Ricochet%20TM/Ricochet%20Script%20Updater/ricochet-script-updater.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/Ricochet%20TM/Ricochet%20Script%20Updater/ricochet-script-updater.user.js
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @connect      raw.githubusercontent.com
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const PANEL_ID = 'ricochet-script-updater-panel';
  const STYLE_ID = 'ricochet-script-updater-style';
  const REQUEST_EVENT = 'ricochetUserScript:requestStatus';
  const LOADED_EVENT = 'ricochetUserScript:loaded';

  const SCRIPTS = [
    {
      id: 'ricochet-counters',
      name: 'Ricochet Pickup / Hangup Counters',
      url: 'https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/Ricochet%20TM/Ricochet%20Pickup%20Hangup%20Counters/ricochet-counters.user.js',
    },
    {
      id: 'ricochet-voicemail-lead-watcher',
      name: 'Ricochet VoiceMail Lead Watcher',
      url: 'https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/Ricochet%20TM/Ricochet%20VoiceMail%20Lead%20Watcher/ricochet-voicemail-lead-watcher.user.js',
    },
  ];

  const state = {
    installed: new Map(),
    remote: new Map(),
    errors: new Map(),
    checking: false,
    panelOpen: false,
    lastChecked: '',
  };

  bindEvents();
  registerMenuCommands();
  requestInstalledStatus();

  window.setTimeout(() => {
    requestInstalledStatus();
    checkForUpdates(false);
  }, 1000);

  window.setTimeout(requestInstalledStatus, 3000);

  function bindEvents() {
    window.addEventListener(LOADED_EVENT, (event) => {
      const detail = event.detail || {};
      if (!SCRIPTS.some((script) => script.id === detail.id)) return;

      state.installed.set(detail.id, {
        name: detail.name || getScript(detail.id).name,
        version: String(detail.version || ''),
        updateUrl: detail.updateUrl || getScript(detail.id).url,
      });

      renderPanel();
    });
  }

  function registerMenuCommands() {
    if (typeof GM_registerMenuCommand !== 'function') return;

    GM_registerMenuCommand('Check Ricochet script updates', () => {
      state.panelOpen = true;
      renderPanel();
      checkForUpdates(true);
    });

    for (const script of SCRIPTS) {
      GM_registerMenuCommand(`Open ${script.name}`, () => {
        openScriptUrl(script);
      });
    }
  }

  function requestInstalledStatus(id) {
    window.dispatchEvent(new CustomEvent(REQUEST_EVENT, {
      detail: id ? { id } : {},
    }));
  }

  async function checkForUpdates(showPanel) {
    if (state.checking) return;

    state.checking = true;
    state.errors.clear();
    if (showPanel) state.panelOpen = true;
    renderPanel();

    await Promise.all(SCRIPTS.map(async (script) => {
      try {
        const text = await fetchText(script.url);
        const version = parseVersion(text);
        if (!version) throw new Error('Missing @version metadata.');
        state.remote.set(script.id, { version, checkedAt: new Date() });
      } catch (error) {
        state.errors.set(script.id, error.message || String(error));
      }
    }));

    state.checking = false;
    state.lastChecked = formatTime(new Date());

    if (hasAttentionStatus()) {
      state.panelOpen = true;
    }

    renderPanel();
  }

  function fetchText(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        timeout: 15000,
        onload(response) {
          if (response.status >= 200 && response.status < 300) {
            resolve(response.responseText || '');
          } else {
            reject(new Error(`GitHub returned ${response.status}.`));
          }
        },
        onerror() {
          reject(new Error('GitHub request failed.'));
        },
        ontimeout() {
          reject(new Error('GitHub request timed out.'));
        },
      });
    });
  }

  function parseVersion(text) {
    const match = String(text || '').match(/^\s*\/\/\s*@version\s+(.+?)\s*$/m);
    return match ? match[1].trim() : '';
  }

  function getStatus(script) {
    const installed = state.installed.get(script.id);
    const remote = state.remote.get(script.id);
    const error = state.errors.get(script.id);

    if (error) return { label: 'Check failed', tone: 'bad' };
    if (!installed) return { label: 'Not detected', tone: 'warn' };
    if (!remote) return { label: state.checking ? 'Checking' : 'Ready', tone: 'neutral' };
    if (compareVersions(remote.version, installed.version) > 0) {
      return { label: 'Update available', tone: 'warn' };
    }

    return { label: 'Up to date', tone: 'good' };
  }

  function hasAttentionStatus() {
    return SCRIPTS.some((script) => {
      const status = getStatus(script);
      return status.tone === 'warn' || status.tone === 'bad';
    });
  }

  function renderPanel() {
    injectStyles();

    let panel = document.getElementById(PANEL_ID);
    if (!state.panelOpen && !hasAttentionStatus()) {
      if (panel) panel.remove();
      return;
    }

    if (!panel) {
      panel = document.createElement('div');
      panel.id = PANEL_ID;
      document.body.appendChild(panel);
    }

    panel.textContent = '';

    const card = createEl('div', 'rsu-card');
    const header = createEl('div', 'rsu-header');
    header.appendChild(createEl('strong', '', 'Ricochet Updater'));

    const headerActions = createEl('div', 'rsu-header-actions');
    headerActions.appendChild(createButton(state.checking ? 'Checking...' : 'Check', () => checkForUpdates(true), 'rsu-secondary'));
    headerActions.appendChild(createButton('x', () => {
      state.panelOpen = false;
      renderPanel();
    }, 'rsu-icon'));
    header.appendChild(headerActions);
    card.appendChild(header);

    for (const script of SCRIPTS) {
      card.appendChild(renderScriptRow(script));
    }

    const footer = createEl('div', 'rsu-footer', state.lastChecked ? `Last checked ${state.lastChecked}` : 'Waiting for first check');
    card.appendChild(footer);
    panel.appendChild(card);
  }

  function renderScriptRow(script) {
    const installed = state.installed.get(script.id);
    const remote = state.remote.get(script.id);
    const status = getStatus(script);

    const row = createEl('div', 'rsu-row');
    const body = createEl('div', 'rsu-row-body');
    body.appendChild(createEl('div', 'rsu-name', script.name));

    const versions = createEl('div', 'rsu-version');
    versions.appendChild(createEl('span', '', `Installed: ${installed && installed.version ? installed.version : 'not detected'}`));
    versions.appendChild(createEl('span', '', `Latest: ${remote && remote.version ? remote.version : 'unknown'}`));
    body.appendChild(versions);

    const badge = createEl('span', `rsu-badge rsu-${status.tone}`, status.label);
    body.appendChild(badge);

    const actionLabel = status.label === 'Update available'
      ? 'Update'
      : status.label === 'Not detected'
        ? 'Install'
        : 'Open';
    const action = createButton(actionLabel, () => openScriptUrl(script), 'rsu-primary');
    row.appendChild(body);
    row.appendChild(action);
    return row;
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${PANEL_ID} {
        position: fixed;
        right: 14px;
        bottom: 14px;
        z-index: 2147483647;
        width: min(380px, calc(100vw - 28px));
        color: #172033;
        font: 13px/1.35 Arial, Helvetica, sans-serif;
      }

      #${PANEL_ID} .rsu-card {
        background: #ffffff;
        border: 1px solid #c8d3df;
        border-radius: 8px;
        box-shadow: 0 12px 32px rgba(14, 24, 36, 0.22);
        overflow: hidden;
      }

      #${PANEL_ID} .rsu-header,
      #${PANEL_ID} .rsu-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }

      #${PANEL_ID} .rsu-header {
        padding: 10px 12px;
        background: #f5f8fb;
        border-bottom: 1px solid #d9e2ec;
      }

      #${PANEL_ID} .rsu-header-actions {
        display: flex;
        gap: 6px;
      }

      #${PANEL_ID} .rsu-row {
        padding: 11px 12px;
        border-bottom: 1px solid #e6edf4;
      }

      #${PANEL_ID} .rsu-row-body {
        min-width: 0;
      }

      #${PANEL_ID} .rsu-name {
        font-weight: 700;
        color: #172033;
      }

      #${PANEL_ID} .rsu-version {
        display: flex;
        flex-wrap: wrap;
        gap: 4px 10px;
        margin-top: 3px;
        color: #516174;
        font-size: 12px;
      }

      #${PANEL_ID} .rsu-badge {
        display: inline-flex;
        align-items: center;
        margin-top: 7px;
        padding: 3px 7px;
        border-radius: 999px;
        font-size: 11px;
        font-weight: 700;
      }

      #${PANEL_ID} .rsu-good {
        background: #e8f7ee;
        color: #166534;
      }

      #${PANEL_ID} .rsu-warn {
        background: #fff3d6;
        color: #8a5a00;
      }

      #${PANEL_ID} .rsu-bad {
        background: #fde8e8;
        color: #a61b1b;
      }

      #${PANEL_ID} .rsu-neutral {
        background: #eef3f7;
        color: #405266;
      }

      #${PANEL_ID} button {
        border: 1px solid transparent;
        border-radius: 6px;
        cursor: pointer;
        font: inherit;
        font-weight: 700;
        min-height: 30px;
        white-space: nowrap;
      }

      #${PANEL_ID} .rsu-primary {
        background: #135d85;
        color: #ffffff;
        padding: 0 10px;
      }

      #${PANEL_ID} .rsu-secondary,
      #${PANEL_ID} .rsu-icon {
        background: #ffffff;
        border-color: #c8d3df;
        color: #26384b;
        padding: 0 9px;
      }

      #${PANEL_ID} .rsu-icon {
        width: 30px;
        padding: 0;
        text-transform: uppercase;
      }

      #${PANEL_ID} .rsu-footer {
        padding: 8px 12px;
        color: #65758a;
        font-size: 12px;
        background: #fbfcfd;
      }
    `;

    document.head.appendChild(style);
  }

  function createEl(tagName, className, text) {
    const node = document.createElement(tagName);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function createButton(label, onClick, className) {
    const button = createEl('button', className, label);
    button.type = 'button';
    button.addEventListener('click', onClick);
    return button;
  }

  function openScriptUrl(script) {
    window.open(script.url, '_blank', 'noopener');
  }

  function getScript(id) {
    return SCRIPTS.find((script) => script.id === id);
  }

  function compareVersions(left, right) {
    const leftParts = splitVersion(left);
    const rightParts = splitVersion(right);
    const length = Math.max(leftParts.length, rightParts.length);

    for (let index = 0; index < length; index += 1) {
      const leftValue = leftParts[index] || 0;
      const rightValue = rightParts[index] || 0;
      if (leftValue > rightValue) return 1;
      if (leftValue < rightValue) return -1;
    }

    return 0;
  }

  function splitVersion(version) {
    return String(version || '')
      .split(/[^\d]+/)
      .filter(Boolean)
      .map((part) => Number(part));
  }

  function formatTime(date) {
    return date.toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
    });
  }
})();
