// ==UserScript==
// @name         Ricochet Spam Guru Reveal Actual Risk Ratings
// @namespace    local.ricochet.spam-guru-risk
// @version      3.0
// @description  Visually reveal Hiya/TNS risk ratings hidden behind RMD without changing Remediate.
// @author       JKira & Mr.G
// @match        https://giainc.ricochet.me/*
// @updateURL    https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/Admins/Spam%20Guru%20Risk%20Ratings/ricochet-spam-guru-risk-ratings.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/Admins/Spam%20Guru%20Risk%20Ratings/ricochet-spam-guru-risk-ratings.user.js
// @run-at       document-idle
// @grant        none
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  const PAGE_ORIGIN = 'https://giainc.ricochet.me';
  const PAGE_PATH = '/dashboard/config/spam-guru';
  const CONTROL_ID = 'spam-guru-risk-switch';
  const OVERLAY_ID = 'spam-guru-risk-overlay';
  const FALLBACK_DELAY_MS = 3000;

  let enabled = true;
  let defaultRevealPending = true;
  let attachQueued = false;
  let onSpamGuruPage = false;
  let spamGuruEnteredAt = 0;
  let lastRevealSignature = '';

  function isSpamGuruPage() {
    const path = String(location.pathname || '').replace(/\/+$/, '');

    return (
      String(location.origin || '').toLowerCase() === PAGE_ORIGIN &&
      path === PAGE_PATH
    );
  }

  syncRouteState();

  function textOf(el) {
    return String(el?.textContent || '').trim().replace(/\s+/g, ' ');
  }

  function normalizePhone(value) {
    const digits = String(value || '').replace(/\D/g, '');
    return digits.length > 10 ? digits.slice(-10) : digits;
  }

  function normalizeName(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
  }

  function riskLabel(raw) {
    const value = String(raw ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');

    if (
      !value ||
      value === 'none' ||
      value === '0' ||
      value === 'false' ||
      value === 'low' ||
      value === 'low_risk' ||
      value.includes('not_likely') ||
      value.includes('unlikely')
    ) {
      return 'Low Risk';
    }

    if (
      value === 'possible' ||
      value === 'possibly' ||
      value === 'possible_spam' ||
      value === 'medium' ||
      value === 'moderate' ||
      value === 'moderate_risk' ||
      value.includes('possible') ||
      value.includes('moderate')
    ) {
      return 'Moderate Risk';
    }

    if (
      value === 'likely' ||
      value === 'very_likely' ||
      value === 'highly_likely' ||
      value === 'high' ||
      value === 'high_risk' ||
      value === 'spam' ||
      value === 'spam_likely' ||
      value === 'fraud' ||
      value.includes('high') ||
      value.includes('likely')
    ) {
      return 'High Risk';
    }

    return null;
  }

  function safeEntries(obj) {
    try {
      return obj && typeof obj === 'object' ? Object.entries(obj) : [];
    } catch {
      return [];
    }
  }

  function isPhoneRecord(item) {
    return Boolean(
      item &&
      typeof item === 'object' &&
      ('phone_number' in item || 'phone_name' in item) &&
      ('hiya_risk_rating' in item || 'tns_risk_rating' in item)
    );
  }

  function getVueObjects() {
    const objects = new Set();

    function add(obj) {
      if (obj && typeof obj === 'object') objects.add(obj);
    }

    document.querySelectorAll('*').forEach((el) => {
      add(el.__vue__);

      const component = el.__vueParentComponent;
      add(component);
      add(component?.proxy);
      add(component?.ctx);
    });

    Array.from(objects).forEach((obj) => {
      add(obj.$vnode?.context);
      add(obj.$data);
      add(obj._data);
      add(obj.$props);
      add(obj.$root);
      add(obj.$store?.state);
    });

    return Array.from(objects);
  }

  function findPhoneArrays() {
    const seen = new WeakSet();
    const arrays = [];

    function addArray(records, path) {
      if (!Array.isArray(records)) return;
      if (seen.has(records)) return;
      if (!records.some(isPhoneRecord)) return;

      seen.add(records);
      arrays.push({ path, records });
    }

    getVueObjects().forEach((obj, index) => {
      addArray(obj.phones, `vue${index}.phones`);
      addArray(obj.phones_for_flag_cases, `vue${index}.phones_for_flag_cases`);

      for (const [key, value] of safeEntries(obj)) {
        addArray(value, `vue${index}.${key}`);
      }
    });

    return arrays;
  }

  function getPhoneRows() {
    const rows = [];

    document.querySelectorAll('table.performance-report-table tr').forEach((tr) => {
      const cells = Array.from(tr.children).filter((cell) =>
        /^(TH|TD)$/.test(cell.tagName)
      );

      if (cells.length < 7) return;

      const phone = normalizePhone(textOf(cells[1]));
      if (phone.length !== 10) return;

      rows.push({
        tr,
        cells,
        name: textOf(cells[0]),
        nameKey: normalizeName(textOf(cells[0])),
        phone,
        key: `${phone}|${normalizeName(textOf(cells[0]))}`,
      });
    });

    return rows;
  }

  function getRowsSignature(rows) {
    return rows.map((row) => row.key).join('||');
  }

  function scoreCandidate(candidate, rows) {
    const phones = new Set(
      candidate.records.map((record) => normalizePhone(record.phone_number)).filter(Boolean)
    );

    const names = new Set(
      candidate.records.map((record) => normalizeName(record.phone_name)).filter(Boolean)
    );

    const matches = rows.filter((row) =>
      phones.has(row.phone) || names.has(row.nameKey)
    ).length;

    let score = matches * 100;

    if (candidate.path.endsWith('.phones')) score += 50;
    if (candidate.records.length === rows.length) score += 25;
    if (candidate.path.includes('phones_for_flag_cases')) score -= 10;

    return { score, matches };
  }

  function choosePhoneArray(arrays, rows) {
    return arrays
      .map((candidate) => ({
        ...candidate,
        ...scoreCandidate(candidate, rows),
      }))
      .sort((a, b) => b.score - a.score)[0];
  }

  function buildMaps(records) {
    const byPhone = new Map();
    const byName = new Map();

    records.forEach((record) => {
      const phone = normalizePhone(record.phone_number);
      const name = normalizeName(record.phone_name);

      if (phone) byPhone.set(phone, record);
      if (name) byName.set(name, record);
    });

    return { byPhone, byName };
  }

  function getRecordForRow(row, maps) {
    return maps.byPhone.get(row.phone) || maps.byName.get(row.nameKey) || null;
  }

  function getOverlayLayer() {
    let layer = document.getElementById(OVERLAY_ID);

    if (!layer) {
      layer = document.createElement('div');
      layer.id = OVERLAY_ID;
      layer.setAttribute('aria-hidden', 'true');
      document.body.appendChild(layer);
    }

    return layer;
  }

  function clearRiskOverlays() {
    const layer = document.getElementById(OVERLAY_ID);
    if (layer) layer.textContent = '';
  }

  function removeRiskOverlays() {
    const layer = document.getElementById(OVERLAY_ID);
    if (layer) layer.remove();
  }

  function isSafeOverlayCell(cell) {
    if (!cell || !(cell instanceof Element)) return false;
    if (!isVisible(cell)) return false;
    if (textOf(cell) !== 'RMD') return false;

    // Rating cells are plain text. Any child element could be a Vue control.
    if (cell.childElementCount > 0) return false;

    return !cell.matches(
      [
        'input',
        'button',
        'select',
        'textarea',
        'a',
        '[role="button"]',
        '[role="switch"]',
        '[role="checkbox"]',
        '[onclick]',
        '[tabindex]',
      ].join(',')
    );
  }

  function makeOverlay(cell, label, sourceName, rawValue) {
    if (!label || !isSafeOverlayCell(cell)) return false;

    const overlay = document.createElement('span');
    overlay.className = `spam-guru-risk-overlay-label ${riskClass(label)}`;
    overlay.textContent = label;
    overlay.title = `${sourceName}: ${rawValue || '(blank/none)'} -> ${label} (visual only)`;
    overlay._spamGuruCell = cell;

    getOverlayLayer().appendChild(overlay);
    positionOverlay(overlay);

    return true;
  }

  function riskClass(label) {
    if (label === 'High Risk') return 'spam-guru-risk-high';
    if (label === 'Moderate Risk') return 'spam-guru-risk-moderate';
    return 'spam-guru-risk-low';
  }

  function positionOverlay(overlay) {
    const cell = overlay?._spamGuruCell;

    if (!cell || !document.documentElement.contains(cell) || !isSafeOverlayCell(cell)) {
      if (overlay) overlay.remove();
      return;
    }

    const rect = cell.getBoundingClientRect();
    const style = getComputedStyle(cell);

    overlay.style.left = `${rect.left}px`;
    overlay.style.top = `${rect.top}px`;
    overlay.style.width = `${rect.width}px`;
    overlay.style.height = `${rect.height}px`;
    overlay.style.font = style.font;
    overlay.style.backgroundColor = solidBackgroundFor(cell);
  }

  function positionRiskOverlays() {
    document
      .querySelectorAll(`#${OVERLAY_ID} .spam-guru-risk-overlay-label`)
      .forEach(positionOverlay);
  }

  function solidBackgroundFor(el) {
    let node = el;

    while (node && node instanceof Element) {
      const color = getComputedStyle(node).backgroundColor;
      if (color && color !== 'transparent' && color !== 'rgba(0, 0, 0, 0)') {
        return color;
      }
      node = node.parentElement;
    }

    return '#fff';
  }

  function revealRatings(options = {}) {
    const rows = options.rows || getPhoneRows();
    if (!rows.length) {
      if (!options.silentNoData) flashLabel('No data');
      return false;
    }

    const arrays = findPhoneArrays();
    const selected = choosePhoneArray(arrays, rows);

    if (!selected) {
      if (!options.silentNoData) flashLabel('No data');
      return false;
    }

    const maps = buildMaps(selected.records);
    let changed = 0;

    clearRiskOverlays();

    rows.forEach((row) => {
      const record = getRecordForRow(row, maps);
      if (!record) return;

      const hiyaLabel = riskLabel(record.hiya_risk_rating);
      const tnsLabel = riskLabel(record.tns_risk_rating);

      if (makeOverlay(row.cells[5], hiyaLabel, 'Hiya', record.hiya_risk_rating)) changed += 1;
      if (makeOverlay(row.cells[6], tnsLabel, 'TNS', record.tns_risk_rating)) changed += 1;
    });

    console.log('[Spam Guru Reveal]', {
      changed,
      rows: rows.length,
      selectedArray: selected.path,
      selectedLength: selected.records.length,
      selectedMatches: selected.matches,
    });

    flashLabel(stateLabel());
    lastRevealSignature = getRowsSignature(rows);
    defaultRevealPending = false;
    return true;
  }

  function restoreRatings(options = {}) {
    removeRiskOverlays();
    lastRevealSignature = '';
    if (!options.skipLabel) flashLabel(stateLabel());
  }

  function setEnabled(next) {
    enabled = Boolean(next);

    const input = document.querySelector(`#${CONTROL_ID} input`);
    if (input) input.checked = enabled;

    if (enabled) {
      revealRatings();
    } else {
      restoreRatings();
    }
  }

  function makeDebugPayload() {
    const rows = getPhoneRows();
    const arrays = findPhoneArrays();
    const selected = choosePhoneArray(arrays, rows);
    const maps = selected ? buildMaps(selected.records) : null;

    return {
      url: location.href,
      enabled,
      rowCount: rows.length,
      selectedArray: selected
        ? {
            path: selected.path,
            length: selected.records.length,
            matches: selected.matches,
            score: selected.score,
          }
        : null,
      arrays: arrays
        .map((candidate) => ({
          path: candidate.path,
          length: candidate.records.length,
          ...scoreCandidate(candidate, rows),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 10),
      sampleRows: rows.slice(0, 20).map((row) => {
        const record = maps ? getRecordForRow(row, maps) : null;

        return {
          name: row.name,
          phoneLast4: row.phone.slice(-4),
          domRating1: textOf(row.cells[5]),
          domRating2: textOf(row.cells[6]),
          hiyaRaw: record?.hiya_risk_rating ?? null,
          hiyaLabel: record ? riskLabel(record.hiya_risk_rating) : null,
          tnsRaw: record?.tns_risk_rating ?? null,
          tnsLabel: record ? riskLabel(record.tns_risk_rating) : null,
          remediate: record?.remediate ?? null,
        };
      }),
    };
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();

      const copied = document.execCommand('copy');
      textarea.remove();

      return copied;
    }
  }

  async function copyDebug() {
    const payload = makeDebugPayload();
    const copied = await copyText(JSON.stringify(payload, null, 2));

    console.log('[Spam Guru Reveal Debug]', payload);
    flashLabel(copied ? 'Copied' : 'Copy failed');
  }

  function addStyles() {
    if (document.getElementById(`${CONTROL_ID}-style`)) return;

    const style = document.createElement('style');
    style.id = `${CONTROL_ID}-style`;
    style.textContent = `
      #${CONTROL_ID} {
        position: fixed;
        z-index: 999999;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font: 12px Arial, sans-serif;
        color: #fff;
        user-select: none;
      }

      #${CONTROL_ID} input {
        position: absolute;
        opacity: 0;
        pointer-events: none;
      }

      #${CONTROL_ID} .risk-switch-track {
        width: 36px;
        height: 18px;
        border-radius: 999px;
        background: #8b8b8b;
        position: relative;
        transition: background .16s ease;
        box-shadow: inset 0 0 0 1px rgba(0,0,0,.18);
      }

      #${CONTROL_ID} .risk-switch-track::after {
        content: "";
        position: absolute;
        top: 2px;
        left: 2px;
        width: 14px;
        height: 14px;
        border-radius: 50%;
        background: #fff;
        transition: transform .16s ease;
        box-shadow: 0 1px 3px rgba(0,0,0,.25);
      }

      #${CONTROL_ID} input:checked + .risk-switch-track {
        background: #75c791;
      }

      #${CONTROL_ID} input:checked + .risk-switch-track::after {
        transform: translateX(18px);
      }

      #${CONTROL_ID} .risk-switch-label {
        min-width: 58px;
        text-align: right;
      }

      #${OVERLAY_ID} {
        position: fixed;
        inset: 0;
        z-index: 999998;
        pointer-events: none;
      }

      #${OVERLAY_ID} .spam-guru-risk-overlay-label {
        position: fixed;
        display: flex;
        align-items: center;
        justify-content: center;
        box-sizing: border-box;
        overflow: hidden;
        white-space: nowrap;
        padding: 0 4px;
        pointer-events: none;
      }

      #${OVERLAY_ID} .spam-guru-risk-high {
        color: #d9534f;
      }

      #${OVERLAY_ID} .spam-guru-risk-moderate {
        color: rgb(183, 183, 1);
      }

      #${OVERLAY_ID} .spam-guru-risk-low {
        color: inherit;
      }
    `;

    document.head.appendChild(style);
  }

  function flashLabel(message) {
    const label = document.querySelector(`#${CONTROL_ID} .risk-switch-label`);
    if (!label) return;

    label.textContent = message;
    window.clearTimeout(label._spamGuruTimer);

    label._spamGuruTimer = window.setTimeout(() => {
      label.textContent = stateLabel();
    }, 1200);
  }

  function stateLabel() {
    return enabled ? 'RMD On' : 'RMD Off';
  }

  function positionSwitch() {
    const control = document.getElementById(CONTROL_ID);
    const target = getSwitchAnchor();

    if (!control) return;

    if (!target) {
      control.style.left = '';
      control.style.right = '12px';
      control.style.top = '12px';
      return;
    }

    const rect = target.getBoundingClientRect();
    const controlRect = control.getBoundingClientRect();

    control.style.right = '';
    control.style.left = `${Math.max(4, rect.left - controlRect.width - 10)}px`;
    control.style.top = `${rect.top + (rect.height - controlRect.height) / 2}px`;
  }

  function getSwitchAnchor() {
    return getClockAnchor() || getHelpAnchor();
  }

  function getClockAnchor() {
    const clock = document.querySelector('.rc-call-clock-value[data-rc-clock-value]');
    return isVisible(clock) ? clock : null;
  }

  function getHelpAnchor() {
    const links = document.querySelectorAll('a.dropdown-toggle[data-toggle="dropdown"]');

    for (const link of links) {
      if (!isVisible(link)) continue;
      if (/\bHelp\b/i.test(textOf(link))) return link;
    }

    return null;
  }

  function isVisible(el) {
    if (!el || !(el instanceof Element)) return false;

    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }

    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function attachSwitch() {
    if (!syncRouteState()) return;

    const target = getSwitchAnchor();
    const fallbackReady = Date.now() - spamGuruEnteredAt >= FALLBACK_DELAY_MS;
    if (!target && !fallbackReady) return;

    addStyles();

    let label = document.getElementById(CONTROL_ID);

    if (!label) {
      label = document.createElement('label');
      label.id = CONTROL_ID;
      label.title = 'Reveal actual Spam Guru risk ratings. Shortcut: Alt+Shift+R. Debug copy: Alt+Shift+D.';

      const text = document.createElement('span');
      text.className = 'risk-switch-label';
      text.textContent = stateLabel();

      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = enabled;
      input.setAttribute('aria-label', 'Reveal actual Spam Guru risk ratings');

      const track = document.createElement('span');
      track.className = 'risk-switch-track';

      input.addEventListener('change', () => setEnabled(input.checked));

      label.appendChild(text);
      label.appendChild(input);
      label.appendChild(track);

      document.body.appendChild(label);
    }

    positionSwitch();

    maybeRevealRatings();
  }

  function maybeRevealRatings() {
    if (!enabled) return;

    const rows = getPhoneRows();
    const signature = getRowsSignature(rows);

    if (!defaultRevealPending && signature && signature === lastRevealSignature) return;

    revealRatings({ rows, silentNoData: true });
  }

  function syncRouteState() {
    const nextOnSpamGuruPage = isSpamGuruPage();

    if (nextOnSpamGuruPage && !onSpamGuruPage) {
      spamGuruEnteredAt = Date.now();
      defaultRevealPending = true;
      lastRevealSignature = '';
    } else if (!nextOnSpamGuruPage && onSpamGuruPage) {
      restoreRatings({ skipLabel: true });
      removeSwitch();
      defaultRevealPending = true;
      lastRevealSignature = '';
    }

    onSpamGuruPage = nextOnSpamGuruPage;
    return onSpamGuruPage;
  }

  function removeSwitch() {
    const control = document.getElementById(CONTROL_ID);
    if (control) control.remove();
  }

  function queueAttachSwitch() {
    if (attachQueued) return;
    attachQueued = true;

    window.requestAnimationFrame(() => {
      attachQueued = false;
      attachSwitch();
    });
  }

  function observeSwitchAnchors() {
    const root = document.documentElement || document.body;
    if (!root || typeof MutationObserver !== 'function') return;

    const observer = new MutationObserver((mutations) => {
      if (mutations.every(isControlMutation)) return;
      queueAttachSwitch();
    });

    observer.observe(root, {
      attributes: true,
      attributeFilter: ['class', 'data-rc-clock-value', 'hidden', 'style'],
      childList: true,
      subtree: true,
    });
  }

  function isControlMutation(mutation) {
    const target = mutation && mutation.target;
    return Boolean(
      target &&
      target instanceof Element &&
      (target.id === CONTROL_ID || target.closest(`#${CONTROL_ID}`))
    );
  }

  function patchHistoryForRouteChanges() {
    ['pushState', 'replaceState'].forEach((methodName) => {
      const original = history[methodName];
      if (typeof original !== 'function') return;
      if (original._spamGuruRiskPatched) return;

      const patched = function (...args) {
        const result = original.apply(this, args);
        queueAttachSwitch();
        return result;
      };

      patched._spamGuruRiskPatched = true;
      history[methodName] = patched;
    });
  }

  document.addEventListener('keydown', (event) => {
    if (!syncRouteState()) return;
    if (!event.altKey || !event.shiftKey) return;

    const key = event.key.toLowerCase();

    if (key === 'r') {
      event.preventDefault();
      setEnabled(!enabled);
    } else if (key === 'd') {
      event.preventDefault();
      copyDebug();
    }
  });

  queueAttachSwitch();
  patchHistoryForRouteChanges();
  observeSwitchAnchors();
  window.addEventListener('popstate', queueAttachSwitch);
  window.addEventListener('hashchange', queueAttachSwitch);
  window.addEventListener('resize', () => {
    positionSwitch();
    positionRiskOverlays();
  }, { passive: true });
  window.addEventListener('scroll', () => {
    positionSwitch();
    positionRiskOverlays();
  }, { passive: true });
  window.setTimeout(queueAttachSwitch, FALLBACK_DELAY_MS);
  window.setInterval(queueAttachSwitch, 1500);
})();
