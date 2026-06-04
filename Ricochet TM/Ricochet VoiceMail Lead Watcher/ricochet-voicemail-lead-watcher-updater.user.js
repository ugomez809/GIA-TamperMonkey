// ==UserScript==
// @name         Ricochet VoiceMail Lead Watcher Updater
// @namespace    GIA.INC
// @version      1.0.0
// @description  Checks Ricochet VoiceMail Lead Watcher for GitHub updates.
// @author       JKira & Mr.G
// @match        https://giainc.ricochet.me/*
// @updateURL    https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/Ricochet%20TM/Ricochet%20VoiceMail%20Lead%20Watcher/ricochet-voicemail-lead-watcher-updater.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/Ricochet%20TM/Ricochet%20VoiceMail%20Lead%20Watcher/ricochet-voicemail-lead-watcher-updater.user.js
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @connect      raw.githubusercontent.com
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const TARGET = {
    id: 'ricochet-voicemail-lead-watcher',
    name: 'Ricochet VoiceMail Lead Watcher',
    url: 'https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/Ricochet%20TM/Ricochet%20VoiceMail%20Lead%20Watcher/ricochet-voicemail-lead-watcher.user.js',
  };

  const PANEL_ID = 'ricochet-voicemail-lead-watcher-updater-panel';
  const STYLE_ID = 'ricochet-voicemail-lead-watcher-updater-style';
  const REQUEST_EVENT = 'ricochetUserScript:requestStatus';
  const LOADED_EVENT = 'ricochetUserScript:loaded';

  const state = {
    installedVersion: '',
    remoteVersion: '',
    error: '',
    checking: false,
    panelOpen: false,
    lastChecked: '',
  };

  bindEvents();
  registerMenuCommands();
  requestInstalledStatus();

  window.setTimeout(() => {
    requestInstalledStatus();
    checkForUpdate(false);
  }, 1000);

  window.setTimeout(requestInstalledStatus, 3000);

  function bindEvents() {
    window.addEventListener(LOADED_EVENT, (event) => {
      const detail = event.detail || {};
      if (detail.id !== TARGET.id) return;

      state.installedVersion = String(detail.version || '');
      renderPanel();
    });
  }

  function registerMenuCommands() {
    if (typeof GM_registerMenuCommand !== 'function') return;

    GM_registerMenuCommand(`Check ${TARGET.name} update`, () => {
      state.panelOpen = true;
      renderPanel();
      checkForUpdate(true);
    });

    GM_registerMenuCommand(`Open ${TARGET.name} installer`, openTargetUrl);
  }

  function requestInstalledStatus() {
    window.dispatchEvent(new CustomEvent(REQUEST_EVENT, {
      detail: { id: TARGET.id },
    }));
  }

  async function checkForUpdate(showPanel) {
    if (state.checking) return;

    state.checking = true;
    state.error = '';
    if (showPanel) state.panelOpen = true;
    renderPanel();

    try {
      const text = await fetchText(TARGET.url);
      const version = parseVersion(text);
      if (!version) throw new Error('Missing @version metadata.');
      state.remoteVersion = version;
    } catch (error) {
      state.error = error.message || String(error);
    }

    state.checking = false;
    state.lastChecked = formatTime(new Date());

    if (needsAttention()) {
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

  function getStatus() {
    if (state.error) return { label: 'Check failed', tone: 'bad' };
    if (!state.installedVersion) return { label: 'Not detected', tone: 'warn' };
    if (!state.remoteVersion) return { label: state.checking ? 'Checking' : 'Ready', tone: 'neutral' };
    if (compareVersions(state.remoteVersion, state.installedVersion) > 0) {
      return { label: 'Update available', tone: 'warn' };
    }
    if (compareVersions(state.remoteVersion, state.installedVersion) < 0) {
      return { label: 'Installed newer', tone: 'good' };
    }

    return { label: 'Up to date', tone: 'good' };
  }

  function needsAttention() {
    const status = getStatus();
    return status.tone === 'warn' || status.tone === 'bad';
  }

  function renderPanel() {
    injectStyles();

    let panel = document.getElementById(PANEL_ID);
    if (!state.panelOpen && !needsAttention()) {
      if (panel) panel.remove();
      return;
    }

    if (!panel) {
      panel = document.createElement('div');
      panel.id = PANEL_ID;
      document.body.appendChild(panel);
    }

    const status = getStatus();
    const actionLabel = status.label === 'Update available'
      ? 'Update'
      : status.label === 'Not detected'
        ? 'Install'
        : 'Open';

    panel.textContent = '';
    const card = createEl('div', 'rsu-card');

    const header = createEl('div', 'rsu-header');
    header.appendChild(createEl('strong', '', 'VoiceMail Updater'));

    const headerActions = createEl('div', 'rsu-header-actions');
    headerActions.appendChild(createButton(state.checking ? 'Checking...' : 'Check', () => checkForUpdate(true), 'rsu-secondary'));
    headerActions.appendChild(createButton('x', () => {
      state.panelOpen = false;
      renderPanel();
    }, 'rsu-icon'));
    header.appendChild(headerActions);
    card.appendChild(header);

    const row = createEl('div', 'rsu-row');
    const body = createEl('div', 'rsu-row-body');
    body.appendChild(createEl('div', 'rsu-name', TARGET.name));

    const versions = createEl('div', 'rsu-version');
    versions.appendChild(createEl('span', '', `Installed: ${state.installedVersion || 'not detected'}`));
    versions.appendChild(createEl('span', '', `Latest: ${state.remoteVersion || 'unknown'}`));
    body.appendChild(versions);
    body.appendChild(createEl('span', `rsu-badge rsu-${status.tone}`, status.label));

    row.appendChild(body);
    row.appendChild(createButton(actionLabel, openTargetUrl, 'rsu-primary'));
    card.appendChild(row);

    const footerText = state.error || (state.lastChecked ? `Last checked ${state.lastChecked}` : 'Waiting for first check');
    card.appendChild(createEl('div', 'rsu-footer', footerText));
    panel.appendChild(card);
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
        width: min(360px, calc(100vw - 28px));
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
        margin-top: 7px;
        padding: 3px 7px;
        border-radius: 999px;
        font-size: 11px;
        font-weight: 700;
      }

      #${PANEL_ID} .rsu-good { background: #e8f7ee; color: #166534; }
      #${PANEL_ID} .rsu-warn { background: #fff3d6; color: #8a5a00; }
      #${PANEL_ID} .rsu-bad { background: #fde8e8; color: #a61b1b; }
      #${PANEL_ID} .rsu-neutral { background: #eef3f7; color: #405266; }

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

  function openTargetUrl() {
    window.open(TARGET.url, '_blank', 'noopener');
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
