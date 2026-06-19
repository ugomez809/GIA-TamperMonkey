// ==UserScript==
// @name         Ricochet Spam Guru Reveal Actual Risk Ratings
// @namespace    local.ricochet.spam-guru-risk
// @version      4.13
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
  const CONTROL_NAV_ITEM_ID = `${CONTROL_ID}-nav-item`;
  const FLOATING_CONTROL_CLASS = 'spam-guru-risk-floating';
  const INLINE_CELL_CLASS = 'spam-guru-risk-inline-cell';
  const CELL_ID_PREFIX = 'spam-guru-cell';
  const RISK_CLASS_NAMES = [
    'spam-guru-risk-high',
    'spam-guru-risk-moderate',
    'spam-guru-risk-low',
  ];
  const PHONE_COL_INDEX = 1;
  const HIYA_COL_INDEX = 5;
  const TNS_COL_INDEX = 6;
  const DECISION_COL_INDEX = 8;
  const FALLBACK_DELAY_MS = 3000;

  let enabled = true;
  let defaultRevealPending = true;
  let attachQueued = false;
  let onSpamGuruPage = false;
  let spamGuruEnteredAt = 0;
  let lastRevealSignature = '';
  let lastRevealComplete = false;
  let lastRetrySignature = '';
  let lastRerenderSignature = '';
  const inlineLabels = new Map();
  const retryTimers = [];

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
    const seenObjects = new WeakSet();
    const arrays = [];
    let scannedObjects = 0;

    function addArray(records, path) {
      if (!Array.isArray(records)) return;
      if (seen.has(records)) return;
      if (!records.some(isPhoneRecord)) return;

      seen.add(records);
      arrays.push({ path, records });
    }

    function scan(value, path, depth) {
      if (!value || typeof value !== 'object') return;
      if (value instanceof Element || value === window || value === document) return;
      if (seenObjects.has(value)) return;
      if (scannedObjects > 3000) return;

      seenObjects.add(value);
      scannedObjects += 1;

      if (Array.isArray(value)) {
        addArray(value, path);
        if (depth <= 0) return;

        value.slice(0, 50).forEach((item, index) => {
          scan(item, `${path}[${index}]`, depth - 1);
        });

        return;
      }

      if (depth <= 0) return;

      for (const [key, child] of safeEntries(value)) {
        if (shouldSkipScanKey(key, child)) continue;
        scan(child, `${path}.${key}`, depth - 1);
      }
    }

    getVueObjects().forEach((obj, index) => {
      addArray(obj.phones, `vue${index}.phones`);
      addArray(obj.phones_for_flag_cases, `vue${index}.phones_for_flag_cases`);

      for (const [key, value] of safeEntries(obj)) {
        addArray(value, `vue${index}.${key}`);
      }

      scan(obj, `vue${index}`, 3);
    });

    return arrays;
  }

  function shouldSkipScanKey(key, value) {
    if (!value || typeof value !== 'object') return true;
    if (typeof value === 'function') return true;
    if (value instanceof Element || value === window || value === document) return true;

    return [
      '$el',
      '$parent',
      '$root',
      '$children',
      '$refs',
      '$vnode',
      '_vnode',
      'vnode',
      'subTree',
      'parent',
      'root',
      'appContext',
      'provides',
      'effect',
      'scope',
    ].includes(key);
  }

  function getPhoneRows() {
    const rows = [];

    document.querySelectorAll('table.performance-report-table tr').forEach((tr) => {
      const cells = Array.from(tr.children).filter((cell) =>
        /^(TH|TD)$/.test(cell.tagName)
      );

      if (cells.length <= DECISION_COL_INDEX) return;

      const phone = normalizePhone(textOf(cells[PHONE_COL_INDEX]));
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
    return rows.map((row) => `${row.key}|${getDecisionSignature(row)}`).join('||');
  }

  function getDecisionSignature(row) {
    const cell = row.cells[DECISION_COL_INDEX];
    if (!cell) return '';

    return [
      decisionTextOf(cell).toLowerCase(),
      getDecisionState(cell),
    ].join('|');
  }

  function decisionTextOf(cell) {
    if (!cell || !(cell instanceof Element)) return '';

    const select = cell.querySelector('select');
    if (select) {
      return Array.from(select.selectedOptions || [])
        .map((option) => textOf(option))
        .filter(Boolean)
        .join(' ');
    }

    const checkedControl = cell.querySelector('input[type="checkbox"]:checked, input[type="radio"]:checked');
    if (checkedControl) {
      const label = checkedControl.closest('label');
      if (label && cell.contains(label)) return textOf(label);
      return checkedControl.value || 'on';
    }

    const visibleSelected = Array.from(
      cell.querySelectorAll(
        '.dropdown-toggle, button, [role="button"], .selected, .is-selected, [aria-selected="true"]'
      )
    ).find((el) => isVisible(el) && textOf(el));

    if (visibleSelected) {
      return textOf(visibleSelected).replace(/\b(caret|open|close)\b/gi, '').trim();
    }

    return textOf(cell);
  }

  function applyRowCellIds(row) {
    const phoneId = row.phone;

    setManagedCellId(row.cells[PHONE_COL_INDEX], `${CELL_ID_PREFIX}-${phoneId}-phone`, row, 'phone');
    setManagedCellId(row.cells[HIYA_COL_INDEX], `${CELL_ID_PREFIX}-${phoneId}-hiya`, row, 'hiya');
    setManagedCellId(row.cells[TNS_COL_INDEX], `${CELL_ID_PREFIX}-${phoneId}-tns`, row, 'tns');
    setManagedCellId(row.cells[DECISION_COL_INDEX], `${CELL_ID_PREFIX}-${phoneId}-decision`, row, 'decision');

    if (row.tr && row.tr instanceof Element) {
      row.tr.dataset.spamGuruPhone = phoneId;
      row.tr.dataset.spamGuruRowKey = row.key;
    }
  }

  function setManagedCellId(cell, id, row, role) {
    if (!cell || !(cell instanceof Element)) return;

    if (!cell.id || cell.dataset.spamGuruManagedId === '1' || cell.id.startsWith(`${CELL_ID_PREFIX}-`)) {
      cell.id = id;
      cell.dataset.spamGuruManagedId = '1';
    }

    cell.dataset.spamGuruPhone = row.phone;
    cell.dataset.spamGuruRowKey = row.key;
    cell.dataset.spamGuruCellRole = role;
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
    return rankPhoneArrays(arrays, rows)[0];
  }

  function rankPhoneArrays(arrays, rows) {
    return arrays
      .map((candidate, order) => ({
        ...candidate,
        order,
        ...scoreCandidate(candidate, rows),
      }))
      .sort((a, b) => b.score - a.score || a.order - b.order);
  }

  function buildRecordIndex(candidates) {
    const seen = new WeakSet();
    const records = [];

    candidates.forEach((candidate) => {
      candidate.records.forEach((record) => {
        if (!isPhoneRecord(record)) return;
        if (seen.has(record)) return;

        seen.add(record);
        records.push({
          record,
          sourcePath: candidate.path,
          sourceScore: candidate.score,
          sourceMatches: candidate.matches,
        });
      });
    });

    return records;
  }

  function getRecordForRow(row, recordIndex) {
    let best = null;

    recordIndex.forEach((item) => {
      const score = scoreRecordForRow(row, item);
      if (!score) return;
      if (!best || score > best.score) best = { ...item, score };
    });

    return best ? best.record : null;
  }

  function scoreRecordForRow(row, item) {
    const record = item.record;
    const phone = normalizePhone(record.phone_number);
    const name = normalizeName(record.phone_name);

    let score = 0;

    if (phone && phone === row.phone) score += 10000;
    if (name && name === row.nameKey) score += 1000;
    if (!score) return 0;

    if (riskLabel(record.hiya_risk_rating)) score += 50;
    if (riskLabel(record.tns_risk_rating)) score += 50;
    if (item.sourcePath.endsWith('.phones')) score += 25;
    if (item.sourcePath.includes('phones_for_flag_cases')) score -= 10;

    score += Math.min(Number(item.sourceScore) || 0, 500);
    score += Math.min(Number(item.sourceMatches) || 0, 25);

    return score;
  }

  function clearRiskLabels() {
    inlineLabels.forEach((entry, cell) => {
      restoreInlineLabel(cell, entry);
    });
    inlineLabels.clear();
    clearRiskClassResidues();
  }

  function removeRiskLabels() {
    clearRiskLabels();
  }

  function clearRiskClassResidues(root = document) {
    const selector = [
      `.${INLINE_CELL_CLASS}`,
      ...RISK_CLASS_NAMES.map((className) => `.${className}`),
    ].join(',');

    root.querySelectorAll(selector).forEach((cell) => {
      clearRiskCellVisualState(cell);
    });
  }

  function clearRiskCellVisualState(cell) {
    if (!cell || !(cell instanceof Element)) return;

    clearRiskClasses(cell);
    cell.classList.remove(INLINE_CELL_CLASS);

    if (/\bvisual only\b/i.test(cell.getAttribute('title') || '')) {
      cell.removeAttribute('title');
    }
  }

  function clearRiskClasses(cell) {
    if (!cell || !(cell instanceof Element)) return;
    cell.classList.remove(...RISK_CLASS_NAMES);
  }

  function clearManagedCellIds() {
    document.querySelectorAll('[data-spam-guru-phone]').forEach((cell) => {
      if (!(cell instanceof Element)) return;

      if (cell.dataset.spamGuruManagedId === '1' && cell.id.startsWith(`${CELL_ID_PREFIX}-`)) {
        cell.removeAttribute('id');
      }

      delete cell.dataset.spamGuruManagedId;
      delete cell.dataset.spamGuruPhone;
      delete cell.dataset.spamGuruRowKey;
      delete cell.dataset.spamGuruCellRole;
      delete cell.dataset.spamGuruCellIndex;
    });

    document.querySelectorAll('[data-spam-guru-row-key]').forEach((row) => {
      if (!(row instanceof Element)) return;

      delete row.dataset.spamGuruPhone;
      delete row.dataset.spamGuruRowKey;
    });
  }

  function isSafeRatingCell(cell, row, role) {
    if (!cell || !(cell instanceof Element)) return false;
    if (!isVisible(cell)) return false;

    const interactiveSelector = [
      'input',
      'button',
      'select',
      'textarea',
      'a',
      '[role="button"]',
      '[role="switch"]',
      '[role="checkbox"]',
      '[onclick]',
      '[data-toggle]',
      '.switch',
      '.toggle',
      '.custom-control',
      '.bootstrap-switch',
      '.dropdown',
      '.dropdown-menu',
      '.dropdown-toggle',
      '.btn',
      '.form-control',
      '[role="option"]',
      '[role="listbox"]',
    ].join(',');

    if (cell.matches(interactiveSelector) || cell.querySelector(interactiveSelector)) return false;

    if (row && role && cell.dataset.spamGuruPhone === row.phone && cell.dataset.spamGuruCellRole === role) {
      return true;
    }

    return /\bRMD\b/i.test(textOf(cell));
  }

  function getRiskCells(row) {
    applyRowCellIds(row);

    return [
      isSafeRatingCell(row.cells[HIYA_COL_INDEX], row, 'hiya') ? row.cells[HIYA_COL_INDEX] : null,
      isSafeRatingCell(row.cells[TNS_COL_INDEX], row, 'tns') ? row.cells[TNS_COL_INDEX] : null,
    ];
  }

  function getDecisionRoles(row) {
    const cell = row.cells[DECISION_COL_INDEX];
    if (!cell || !(cell instanceof Element) || !isVisible(cell)) return [];

    const state = getDecisionState(cell);
    const text = decisionTextOf(cell).toLowerCase();
    const hasHiya = /\bhiya\b/.test(text);
    const hasTns = /\btns\b/.test(text);

    if (state === 'off') return [];

    if (hasHiya || hasTns) {
      return [
        hasHiya ? 'hiya' : null,
        hasTns ? 'tns' : null,
      ].filter(Boolean);
    }

    if (state === 'on') return ['hiya', 'tns'];

    const trimmedText = text.trim();
    if (/^(off|no|false|disabled|none|skip|0)$/i.test(trimmedText)) return [];
    if (/^(on|yes|true|enabled|both|all|1)$/i.test(trimmedText)) return ['hiya', 'tns'];

    if (
      /\b(on|yes|true|enabled|both|all)\b/.test(text) &&
      !/\b(off|no|false|disabled|none|skip)\b/.test(text)
    ) {
      return ['hiya', 'tns'];
    }

    return [];
  }

  function getDecisionState(cell) {
    const ariaControl = cell.querySelector('[aria-checked]');
    const ariaChecked = String(ariaControl?.getAttribute('aria-checked') || '').toLowerCase();
    if (['true', '1', 'on', 'yes'].includes(ariaChecked)) return 'on';
    if (['false', '0', 'off', 'no'].includes(ariaChecked)) return 'off';

    const switchLabelText = Array.from(cell.querySelectorAll('.v-switch-label'))
      .filter((el) => isVisible(el))
      .map((el) => textOf(el).toLowerCase())
      .find(Boolean);
    if (switchLabelText === 'on') return 'on';
    if (switchLabelText === 'off') return 'off';

    const checkedControl = cell.querySelector('input[type="checkbox"], input[type="radio"]');
    if (checkedControl) {
      if (checkedControl.checked) return 'on';
      if (isVisible(checkedControl)) return 'off';
    }

    const classText = String(cell.className || '').toLowerCase();
    const descendantClasses = Array.from(cell.querySelectorAll('*'))
      .filter((el) => isVisible(el))
      .map((el) => String(el.className || '').toLowerCase())
      .join(' ');
    const classes = `${classText} ${descendantClasses}`;

    if (/\b(bootstrap-switch-off|switch-off|toggle-off|is-off|unchecked|is-unchecked)\b/.test(classes)) return 'off';
    if (/\b(bootstrap-switch-on|switch-on|toggle-on|is-on|checked|is-checked)\b/.test(classes)) return 'on';

    return '';
  }

  function hasKnownDecision(row) {
    const cell = row.cells[DECISION_COL_INDEX];
    if (!cell) return false;

    if (getDecisionState(cell)) return true;
    if (hasDecisionSignal(cell)) return true;

    return /\b(hiya|tns|off|no|false|disabled|none|skip|on|yes|true|enabled|both|all|rmd|remediate)\b/i.test(
      decisionTextOf(cell)
    );
  }

  function hasDecisionSignal(cell) {
    if (!cell || !(cell instanceof Element) || !isVisible(cell)) return false;
    if (decisionTextOf(cell)) return true;

    return Array.from(
      cell.querySelectorAll(
        [
          'select',
          'input',
          'button',
          '[role="switch"]',
          '[role="checkbox"]',
          '[aria-checked]',
          '.bootstrap-switch',
          '.switch',
          '.toggle',
          '.custom-control',
        ].join(',')
      )
    ).some((el) => isVisible(el));
  }

  function setRiskCellText(cell, label, sourceName, rawValue, row, role) {
    if (!label || !isSafeRatingCell(cell, row, role)) return false;

    const target = findRiskTextTarget(cell);
    if (!target) return false;

    const originalText = /\bRMD\b/i.test(target.originalText)
      ? target.originalText
      : 'RMD';

    inlineLabels.set(cell, {
      node: target.node,
      originalText,
      originalTitle: cell.getAttribute('title'),
      phone: row?.phone || '',
      role: role || '',
    });

    setNodeText(target.node, replaceRiskText(target.originalText, label));
    clearRiskClasses(cell);
    cell.classList.add(INLINE_CELL_CLASS);
    if (row) {
      cell.dataset.spamGuruPhone = row.phone;
      cell.dataset.spamGuruRowKey = row.key;
    }
    if (role) cell.dataset.spamGuruCellRole = role;

    if (!hasVisibleRiskLabel(cell, label)) return false;

    cell.classList.add(riskClass(label));
    cell.title = `${sourceName}: ${rawValue || '(blank/none)'} -> ${label} (visual only)`;

    return true;
  }

  function findRiskTextTarget(cell) {
    const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return isRiskText(node.nodeValue)
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_SKIP;
      }
    });

    const textNode = walker.nextNode();
    if (textNode) {
      return { node: textNode, originalText: textNode.nodeValue };
    }

    const fallbackWalker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return String(node.nodeValue || '').trim()
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_SKIP;
      }
    });

    const fallbackNode = fallbackWalker.nextNode();
    if (fallbackNode && cell.classList.contains(INLINE_CELL_CLASS)) {
      return { node: fallbackNode, originalText: 'RMD' };
    }

    return null;
  }

  function isRiskText(value) {
    return /\b(RMD|Low Risk|Moderate Risk|High Risk)\b/i.test(String(value || ''));
  }

  function replaceRiskText(value, label) {
    const text = String(value || '');

    if (/\bRMD\b/i.test(text)) return text.replace(/\bRMD\b/i, label);
    if (/\bLow Risk\b/i.test(text)) return text.replace(/\bLow Risk\b/i, label);
    if (/\bModerate Risk\b/i.test(text)) return text.replace(/\bModerate Risk\b/i, label);
    if (/\bHigh Risk\b/i.test(text)) return text.replace(/\bHigh Risk\b/i, label);

    return label;
  }

  function setNodeText(node, value) {
    if (!node) return;
    if (node.nodeType === Node.TEXT_NODE) {
      node.nodeValue = value;
    } else {
      node.textContent = value;
    }
  }

  function restoreInlineLabel(cell, entry) {
    if (!cell || !entry) return;

    const currentPhone = getCellRowPhone(cell);
    const isSameRow = !entry.phone || !currentPhone || currentPhone === entry.phone;

    if (isSameRow && entry.node && cell.contains(entry.node)) {
      setNodeText(entry.node, entry.originalText);
    }

    clearRiskClasses(cell);
    cell.classList.remove(INLINE_CELL_CLASS);

    if (entry.originalTitle == null) {
      cell.removeAttribute('title');
    } else {
      cell.setAttribute('title', entry.originalTitle);
    }
  }

  function getCellRowPhone(cell) {
    const row = cell?.closest?.('tr');
    if (!row) return '';

    const cells = Array.from(row.children).filter((candidate) =>
      /^(TH|TD)$/.test(candidate.tagName)
    );

    return normalizePhone(textOf(cells[PHONE_COL_INDEX]));
  }

  function riskClass(label) {
    if (label === 'High Risk') return 'spam-guru-risk-high';
    if (label === 'Moderate Risk') return 'spam-guru-risk-moderate';
    return 'spam-guru-risk-low';
  }

  function hasVisibleRiskLabel(cell, label) {
    const escapedLabel = escapeRegExp(label);
    return new RegExp(`\\b${escapedLabel}\\b`, 'i').test(textOf(cell));
  }

  function escapeRegExp(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function revealRatings(options = {}) {
    const rows = options.rows || getPhoneRows();
    if (!rows.length) {
      if (!options.silentNoData) flashLabel('No data');
      return false;
    }

    const arrays = findPhoneArrays();
    const rankedArrays = rankPhoneArrays(arrays, rows);
    const selected = rankedArrays[0];

    if (!selected) {
      if (!options.silentNoData) flashLabel('No data');
      return false;
    }

    const recordIndex = buildRecordIndex(rankedArrays);
    let changed = 0;
    let expected = 0;
    let skippedByDecision = 0;
    let unknownDecision = 0;

    clearRiskLabels();

    rows.forEach((row) => {
      const record = getRecordForRow(row, recordIndex);
      if (!record) return;

      const hiyaLabel = riskLabel(record.hiya_risk_rating);
      const tnsLabel = riskLabel(record.tns_risk_rating);
      const riskCells = getRiskCells(row);
      const decisionRoles = getDecisionRoles(row);

      if (!decisionRoles.length) {
        clearRiskCellVisualState(row.cells[HIYA_COL_INDEX]);
        clearRiskCellVisualState(row.cells[TNS_COL_INDEX]);
        if (!hasKnownDecision(row)) unknownDecision += 1;
        skippedByDecision += 1;
        return;
      }

      if (decisionRoles.includes('hiya') && hiyaLabel) {
        expected += 1;
        if (setRiskCellText(riskCells[0], hiyaLabel, 'Hiya', record.hiya_risk_rating, row, 'hiya')) changed += 1;
      }

      if (decisionRoles.includes('tns') && tnsLabel) {
        expected += 1;
        if (setRiskCellText(riskCells[1], tnsLabel, 'TNS', record.tns_risk_rating, row, 'tns')) changed += 1;
      }
    });

    console.log('[Spam Guru Reveal]', {
      changed,
      expected,
      skippedByDecision,
      unknownDecision,
      managedRmdCells: countManagedRmdCells(),
      rows: rows.length,
      selectedArray: selected.path,
      selectedLength: selected.records.length,
      selectedMatches: selected.matches,
      sourceCount: rankedArrays.length,
      recordCount: recordIndex.length,
    });

    flashLabel(changed ? stateLabel() : 'No labels');
    lastRevealSignature = getRowsSignature(rows);
    lastRevealComplete = unknownDecision === 0 && changed >= expected;
    scheduleManagedCellCheck(lastRevealSignature);
    if (!lastRevealComplete) scheduleRevealRetries(lastRevealSignature);
    defaultRevealPending = false;
    return true;
  }

  function restoreRatings(options = {}) {
    removeRiskLabels();
    clearManagedCellIds();
    lastRevealSignature = '';
    lastRevealComplete = false;
    lastRerenderSignature = '';
    if (!options.skipLabel) flashLabel(stateLabel());
  }

  function setEnabled(next) {
    enabled = Boolean(next);
    updateControlState();

    if (enabled) {
      revealRatings();
    } else {
      restoreRatings();
    }
  }

  function updateControlState() {
    const control = document.getElementById(CONTROL_ID);
    if (!control) return;

    control.dataset.enabled = enabled ? '1' : '0';
    control.setAttribute('aria-pressed', enabled ? 'true' : 'false');

    const label = control.querySelector('.risk-switch-label');
    if (label) label.textContent = stateLabel();
  }

  function makeDebugPayload() {
    const rows = getPhoneRows();
    const arrays = findPhoneArrays();
    const rankedArrays = rankPhoneArrays(arrays, rows);
    const selected = rankedArrays[0];
    const recordIndex = buildRecordIndex(rankedArrays);

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
        applyRowCellIds(row);

        const record = getRecordForRow(row, recordIndex);
        const riskCells = getRiskCells(row);

        return {
          name: row.name,
          phoneLast4: row.phone.slice(-4),
          domRating1: textOf(row.cells[HIYA_COL_INDEX]),
          domRating2: textOf(row.cells[TNS_COL_INDEX]),
          decisionText: decisionTextOf(row.cells[DECISION_COL_INDEX]),
          decisionFullText: textOf(row.cells[DECISION_COL_INDEX]),
          decisionAriaChecked: row.cells[DECISION_COL_INDEX]?.querySelector('[aria-checked]')?.getAttribute('aria-checked') ?? null,
          decisionSwitchLabel: Array.from(row.cells[DECISION_COL_INDEX]?.querySelectorAll('.v-switch-label') || [])
            .map((el) => textOf(el))
            .filter(Boolean)
            .join(' '),
          decisionState: getDecisionState(row.cells[DECISION_COL_INDEX]),
          decisionHasSignal: hasDecisionSignal(row.cells[DECISION_COL_INDEX]),
          decisionRoles: getDecisionRoles(row),
          phoneCellId: row.cells[PHONE_COL_INDEX]?.id || null,
          hiyaCellId: row.cells[HIYA_COL_INDEX]?.id || null,
          tnsCellId: row.cells[TNS_COL_INDEX]?.id || null,
          decisionCellId: row.cells[DECISION_COL_INDEX]?.id || null,
          hiyaCellPhone: row.cells[HIYA_COL_INDEX]?.dataset?.spamGuruPhone || null,
          tnsCellPhone: row.cells[TNS_COL_INDEX]?.dataset?.spamGuruPhone || null,
          safeRatingCells: riskCells.length,
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
        position: relative;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        margin: 0 10px;
        padding: 0;
        border: 0;
        background: transparent;
        font: 12px Arial, sans-serif;
        color: #fff;
        cursor: pointer;
        user-select: none;
        vertical-align: middle;
        white-space: nowrap;
        line-height: 18px;
        pointer-events: auto;
        box-sizing: border-box;
      }

      #${CONTROL_ID}.${FLOATING_CONTROL_CLASS} {
        position: fixed;
        z-index: 900;
        margin: 0;
      }

      #${CONTROL_NAV_ITEM_ID} {
        display: inline-flex;
        align-items: center;
        list-style: none;
      }

      .navbar-nav > #${CONTROL_NAV_ITEM_ID} {
        float: left;
      }

      #${CONTROL_ID} * {
        pointer-events: none;
      }

      #${CONTROL_ID}:focus {
        outline: none;
      }

      #${CONTROL_ID}:focus-visible {
        outline: 2px solid rgba(117, 199, 145, .85);
        outline-offset: 3px;
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

      #${CONTROL_ID}[data-enabled="1"] .risk-switch-track {
        background: #75c791;
      }

      #${CONTROL_ID}[data-enabled="1"] .risk-switch-track::after {
        transform: translateX(18px);
      }

      #${CONTROL_ID} .risk-switch-label {
        min-width: 58px;
        text-align: right;
      }

      .${INLINE_CELL_CLASS} {
        white-space: nowrap;
      }

      .${INLINE_CELL_CLASS}.spam-guru-risk-high,
      .${INLINE_CELL_CLASS}.spam-guru-risk-high * {
        color: #d9534f !important;
      }

      .${INLINE_CELL_CLASS}.spam-guru-risk-moderate,
      .${INLINE_CELL_CLASS}.spam-guru-risk-moderate * {
        color: rgb(183, 183, 1) !important;
      }

      .${INLINE_CELL_CLASS}.spam-guru-risk-low,
      .${INLINE_CELL_CLASS}.spam-guru-risk-low * {
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
      moveControlToBody(control);
      control.classList.add(FLOATING_CONTROL_CLASS);
      control.style.left = '';
      control.style.right = '12px';
      control.style.top = '12px';
      return;
    }

    control.classList.remove(FLOATING_CONTROL_CLASS);
    control.style.left = '';
    control.style.right = '';
    control.style.top = '';

    if (isClockAnchor(target)) {
      removeEmptyControlNavItem(control);
      insertAfter(control, target);
    } else {
      insertBeforeHelpNavItem(control, target);
    }
  }

  function getSwitchAnchor() {
    return getClockAnchor() || getHelpAnchor();
  }

  function getClockAnchor() {
    const clock = document.querySelector('.rc-call-clock-value[data-rc-clock-value]');
    return isVisible(clock) ? clock : null;
  }

  function isClockAnchor(target) {
    return Boolean(
      target?.matches?.('.rc-call-clock-value[data-rc-clock-value]')
    );
  }

  function insertAfter(node, referenceNode) {
    if (!node || !referenceNode?.parentNode) return;
    if (referenceNode.nextSibling === node) return;
    referenceNode.parentNode.insertBefore(node, referenceNode.nextSibling);
  }

  function moveControlToBody(control) {
    const navItem = document.getElementById(CONTROL_NAV_ITEM_ID);
    if (control.parentElement !== document.body) {
      document.body.appendChild(control);
    }

    if (navItem && !navItem.contains(control)) navItem.remove();
  }

  function removeEmptyControlNavItem(control) {
    const navItem = document.getElementById(CONTROL_NAV_ITEM_ID);
    if (!navItem) return;

    if (navItem.contains(control)) {
      navItem.parentNode?.insertBefore(control, navItem);
    }

    navItem.remove();
  }

  function insertBeforeHelpNavItem(control, helpAnchor) {
    const helpItem = helpAnchor?.closest?.('li') || helpAnchor;
    const parent = helpItem?.parentNode;
    if (!parent) return;

    let navItem = document.getElementById(CONTROL_NAV_ITEM_ID);
    if (!navItem) {
      navItem = document.createElement('li');
      navItem.id = CONTROL_NAV_ITEM_ID;
    }

    if (!navItem.contains(control)) {
      navItem.appendChild(control);
    }

    if (navItem.parentNode !== parent || navItem.nextSibling !== helpItem) {
      parent.insertBefore(navItem, helpItem);
    }
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
      label = document.createElement('button');
      label.id = CONTROL_ID;
      label.type = 'button';
      label.title = 'Reveal actual Spam Guru risk ratings. Shortcut: Alt+Shift+R. Debug copy: Alt+Shift+D.';
      label.setAttribute('aria-label', 'Reveal actual Spam Guru risk ratings');

      const text = document.createElement('span');
      text.className = 'risk-switch-label';
      text.textContent = stateLabel();

      const track = document.createElement('span');
      track.className = 'risk-switch-track';

      const toggleFromClick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        setEnabled(!enabled);
      };

      label.addEventListener('click', toggleFromClick);

      label.appendChild(text);
      label.appendChild(track);

      document.body.appendChild(label);
    }

    updateControlState();
    positionSwitch();

    maybeRevealRatings();
  }

  function maybeRevealRatings() {
    if (!enabled) return;

    const rows = getPhoneRows();
    const signature = getRowsSignature(rows);

    if (signature && signature !== lastRevealSignature) {
      scheduleRevealRetries(signature);
    }

    if (
      !defaultRevealPending &&
      signature &&
      signature === lastRevealSignature &&
      lastRevealComplete
    ) {
      return;
    }

    revealRatings({ rows, silentNoData: true });
  }

  function scheduleRevealRetries(signature) {
    if (!signature || signature === lastRetrySignature) return;

    clearRevealRetries();
    lastRetrySignature = signature;

    [120, 400, 900, 1600].forEach((delay) => {
      const timer = window.setTimeout(() => {
        if (!enabled || !syncRouteState()) return;

        const rows = getPhoneRows();
        if (getRowsSignature(rows) !== signature) return;

        revealRatings({ rows, silentNoData: true });
      }, delay);

      retryTimers.push(timer);
    });
  }

  function scheduleManagedCellCheck(signature) {
    if (!signature) return;
    if (signature === lastRerenderSignature) return;

    [80, 250, 700].forEach((delay) => {
      window.setTimeout(() => {
        if (!enabled || !syncRouteState()) return;

        const rows = getPhoneRows();
        if (getRowsSignature(rows) !== signature) return;
        if (!hasManagedRmdCells()) return;

        lastRevealComplete = false;
        lastRerenderSignature = signature;
        revealRatings({ rows, silentNoData: true });
      }, delay);
    });
  }

  function hasManagedRmdCells() {
    return countManagedRmdCells() > 0;
  }

  function countManagedRmdCells() {
    let count = 0;

    document.querySelectorAll(`.${INLINE_CELL_CLASS}`).forEach((cell) => {
      if (!/\bRMD\b/i.test(textOf(cell))) return;

      clearRiskClasses(cell);
      count += 1;
    });

    return count;
  }

  function clearRevealRetries() {
    while (retryTimers.length) {
      window.clearTimeout(retryTimers.pop());
    }

    lastRetrySignature = '';
  }

  function syncRouteState() {
    const nextOnSpamGuruPage = isSpamGuruPage();

    if (nextOnSpamGuruPage && !onSpamGuruPage) {
      spamGuruEnteredAt = Date.now();
      defaultRevealPending = true;
      lastRevealSignature = '';
      lastRevealComplete = false;
      lastRerenderSignature = '';
      clearRevealRetries();
    } else if (!nextOnSpamGuruPage && onSpamGuruPage) {
      restoreRatings({ skipLabel: true });
      removeSwitch();
      defaultRevealPending = true;
      lastRevealSignature = '';
      lastRevealComplete = false;
      lastRerenderSignature = '';
      clearRevealRetries();
    }

    onSpamGuruPage = nextOnSpamGuruPage;
    return onSpamGuruPage;
  }

  function removeSwitch() {
    const navItem = document.getElementById(CONTROL_NAV_ITEM_ID);
    const control = document.getElementById(CONTROL_ID);
    if (navItem) {
      navItem.remove();
      return;
    }

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
      if (mutations.some(isManagedRmdMutation)) {
        lastRevealComplete = false;
        queueAttachSwitch();
        return;
      }

      if (mutations.every(isControlMutation)) return;
      queueAttachSwitch();
    });

    observer.observe(root, {
      attributes: true,
      attributeFilter: ['class', 'data-rc-clock-value', 'hidden', 'style'],
      characterData: true,
      childList: true,
      subtree: true,
    });
  }

  function mutationElement(mutation) {
    const rawTarget = mutation && mutation.target;
    return rawTarget instanceof Element ? rawTarget : rawTarget?.parentElement;
  }

  function isManagedRmdMutation(mutation) {
    const target = mutationElement(mutation);
    const cell = target?.closest?.(`.${INLINE_CELL_CLASS}`);
    const changedBackToRmd = Boolean(
      cell &&
      ['hiya', 'tns'].includes(cell.dataset.spamGuruCellRole) &&
      /\bRMD\b/i.test(textOf(cell))
    );

    if (changedBackToRmd) clearRiskClasses(cell);

    return changedBackToRmd;
  }

  function isControlMutation(mutation) {
    const target = mutationElement(mutation);

    return Boolean(
      target &&
      (
        target.id === CONTROL_ID ||
        target.id === CONTROL_NAV_ITEM_ID ||
        target.classList.contains(INLINE_CELL_CLASS) ||
        target.closest(`#${CONTROL_ID}, #${CONTROL_NAV_ITEM_ID}, .${INLINE_CELL_CLASS}`)
      )
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
  window.addEventListener('resize', positionSwitch, { passive: true });
  window.addEventListener('scroll', positionSwitch, { passive: true });
  window.setTimeout(queueAttachSwitch, FALLBACK_DELAY_MS);
  window.setInterval(queueAttachSwitch, 1500);
})();
