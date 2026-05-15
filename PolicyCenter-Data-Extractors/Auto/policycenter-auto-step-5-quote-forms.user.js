// ==UserScript==
// @name         PolicyCenter — Step 5: Quote → Forms (Totals + Vehicle Subtotals) (ALWAYS ON)
// @namespace    tm.pc.step5.quote
// @version      1.4.2
// @description  ALWAYS ON each load (STOP is session-only; reload re-enables). When Quote/Pricing header is visible: wait 5s, extract Total Cost + Discounts + per-vehicle subtotal via table sequence (Vehicle table -> next non-fee table last row/last cell), save to localStorage, then click Forms. Prevents duplicates by leaf-table scan + block de-dupe + runlock.
// @match        https://policycenter.farmersinsurance.com/pc/PolicyCenter.do*
// @match        https://policycenter-2.farmersinsurance.com/pc/PolicyCenter.do*
// @match        https://policycenter-3.farmersinsurance.com/pc/PolicyCenter.do*
// @run-at       document-idle
// @all-frames   true
// @grant        none
// @updateURL    https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/PolicyCenter-Data-Extractors/Auto/policycenter-auto-step-5-quote-forms.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/PolicyCenter-Data-Extractors/Auto/policycenter-auto-step-5-quote-forms.user.js
// ==/UserScript==

(() => {
  'use strict';
  if (window.top !== window.self) return;

  const CFG = {
    gateHeaderSel: 'div.gw-TitleBar--title[role="heading"][aria-level="1"]',
    gateRe: /(quote|pricing)/i,

    gateDelayMs: 5000,
    pollMs: 750,

    k_payload:   'tm_pc_quote_v1',
    k_ready:     'tm_pc_quote_ready_v1',
    k_stepStage: 'tm_pc_step5_stage_v1',
    k_enabled:   'tm_pc_step5_enabled_v1',

    k_runlock: 'tm_pc_step5_runlock_v1',
    runLockTtlMs: 120_000,

    // UI (match Step4)
    hostId: 'tm_pc_step5_host',
    bubbleId: 'tm_pc_step5_bubble',
    uiWidthPx: 320,
    maxLogLines: 520,

    // position next to Step4
    step4HostId: 'tm_pc_step4_host',
    step4BubbleId: 'tm_pc_step4_bubble',
    gapPx: 332,
    fallbackRightPx: 1342,
    fallbackBottomPx: 14,

    // Total Cost selectors
    totalSelectors: [
      '#PolicyFile_Pricing-PolicyFile_PricingScreen-PolicyFile_Quote_SummaryDV-TotalCost_Input .gw-value-readonly-wrapper',
      '#PolicyFile_Pricing-PolicyFile_PricingScreen-PolicyFile_Quote_SummaryDV-TotalCost_Input',
      '[id*="Quote_SummaryDV-TotalCost"] .gw-value-readonly-wrapper',
      '[id*="TotalCost"] .gw-value-readonly-wrapper',
      '[id*="TotalPremium"] .gw-value-readonly-wrapper',
    ],

    // Discounts container
    discountsSel: '#PolicyFile_Pricing-PolicyFile_PricingScreen-PolicyFile_Quote_SummaryDV-8',

    // Vehicle table (Table 1) headers - stable
    vehHdr4: ['model year', 'make', 'model', 'vin'],

    // Fees table (Table 3) markers - stable
    feeBadPhrases: ['fee description'],

    // Table pairing
    lookaheadMax: 10,     // how far to search for Table2 after Table1
    maxVehicles: 10,

    // Forms click
    formsText: 'Forms',
    formsClickMaxTries: 16,
    formsVerifyMaxMs: 14_000,
  };

  const FRAME_ID = `pc5_${Math.random().toString(16).slice(2)}_${Date.now()}`;

  const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); return true; } catch { return false; } };
  const lsDel = (k) => { try { localStorage.removeItem(k); return true; } catch { return false; } };
  const safeJsonParse = (s, fb = null) => { try { return JSON.parse(s); } catch { return fb; } };

  const pad2 = (n) => String(n).padStart(2, '0');
  const ts = () => { const d = new Date(); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`; };
  const nowIso = () => new Date().toISOString();
  const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
  const lc = (s) => norm(s).toLowerCase();
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  // ✅ FORCE AUTO ON EVERY LOAD (Stop not persisted)
  try {
    lsSet(CFG.k_enabled, '1');
    lsDel(CFG.k_runlock);
  } catch {}

  const isVisible = (el) => {
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    if (!r || r.width < 2 || r.height < 2) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    if (Number(cs.opacity || '1') <= 0.05) return false;
    return true;
  };

  function realClick(el) {
    if (!el) return false;
    try { el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }); } catch {}
    const rect = el.getBoundingClientRect?.();
    const x = rect ? Math.max(1, Math.floor(rect.left + rect.width / 2)) : 1;
    const y = rect ? Math.max(1, Math.floor(rect.top + rect.height / 2)) : 1;
    const common = { bubbles: true, cancelable: true, composed: true, view: window, button: 0, buttons: 1, clientX: x, clientY: y };
    try { el.dispatchEvent(new PointerEvent('pointerdown', { ...common, pointerId: 1, pointerType: 'mouse', isPrimary: true })); } catch {}
    try { el.dispatchEvent(new MouseEvent('mousedown', common)); } catch {}
    try { el.dispatchEvent(new PointerEvent('pointerup',   { ...common, pointerId: 1, pointerType: 'mouse', isPrimary: true, buttons: 0 })); } catch {}
    try { el.dispatchEvent(new MouseEvent('mouseup', { ...common, buttons: 0 })); } catch {}
    try { el.dispatchEvent(new MouseEvent('click',   { ...common, buttons: 0 })); } catch {}
    return true;
  }

  async function realClickRetry(el, tries = 2, waitMs = 220) {
    for (let i = 1; i <= tries; i++) {
      if (realClick(el)) return true;
      await sleep(waitMs * i);
    }
    return false;
  }

  function getEnabled() { return (lsGet(CFG.k_enabled) ?? '1') === '1'; }
  function setEnabled(on) { lsSet(CFG.k_enabled, on ? '1' : '0'); log(`Copied → ${CFG.k_enabled} = ${on ? '1' : '0'}`); UI.paintButtons(); }

  function acquireRunLock() {
    const now = Date.now();
    const token = `${FRAME_ID}:${now}`;
    const cur = lsGet(CFG.k_runlock);
    if (cur) {
      const [, expStr] = cur.split('|');
      const exp = Number(expStr || '0');
      if (exp > now) return null;
    }
    const val = `${token}|${now + CFG.runLockTtlMs}`;
    if (!lsSet(CFG.k_runlock, val)) return null;
    return (lsGet(CFG.k_runlock) === val) ? token : null;
  }

  function releaseRunLock(token) {
    const cur = lsGet(CFG.k_runlock) || '';
    if (cur.startsWith(token)) lsDel(CFG.k_runlock);
  }

  function titleBarText() {
    const el = document.querySelector(CFG.gateHeaderSel);
    if (el && isVisible(el)) return norm(el.textContent || '');
    const els = Array.from(document.querySelectorAll(CFG.gateHeaderSel)).filter(isVisible);
    return norm(els[0]?.textContent || '');
  }

  function findGateHeader() {
    const els = Array.from(document.querySelectorAll(CFG.gateHeaderSel));
    for (const el of els) {
      if (!isVisible(el)) continue;
      const t = norm(el.textContent || '');
      if (!t) continue;
      if (!CFG.gateRe.test(t)) continue;
      return { el, text: t };
    }
    return null;
  }

  function parseMoney(raw) {
    const s = norm(raw);
    if (!s) return { raw: '', num: '' };
    const cleaned = s.replace(/[^0-9.\-]/g, '');
    const n = Number(cleaned);
    if (!Number.isFinite(n)) return { raw: s, num: '' };
    return { raw: s, num: n.toFixed(2) };
  }

  function extractTotal() {
    for (const sel of CFG.totalSelectors) {
      let el = null;
      try { el = document.querySelector(sel); } catch { el = null; }
      if (!el || !isVisible(el)) continue;

      const t = norm(el.textContent || '');
      const m = parseMoney(t);
      if (m.raw) return { found: true, raw: m.raw, num: m.num, via: sel };

      const w = el.querySelector?.('.gw-value-readonly-wrapper');
      const t2 = norm(w?.textContent || '');
      const m2 = parseMoney(t2);
      if (m2.raw) return { found: true, raw: m2.raw, num: m2.num, via: sel + '->wrapper' };

      if (t) return { found: true, raw: t, num: '', via: sel };
    }
    return { found: false, raw: '', num: '', via: 'none' };
  }

  function extractDiscounts() {
    let el = null;
    try { el = document.querySelector(CFG.discountsSel); } catch { el = null; }
    if (!el || !isVisible(el)) {
      try { el = document.querySelector('[id*="PolicyFile_Pricing"][id*="Quote_SummaryDV-8"]'); } catch { el = null; }
    }
    if (!el || !isVisible(el)) return { found: false, list: [], raw: '' };

    let wraps = [];
    try { wraps = Array.from(el.querySelectorAll('.gw-value-readonly-wrapper')); } catch { wraps = []; }

    const list = [];
    const seen = new Set();
    for (const w of wraps) {
      if (!isVisible(w)) continue;
      const t = norm(w.textContent || '');
      if (!t) continue;
      if (!/discount/i.test(t)) continue;
      const key = t.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      list.push(t);
    }

    const raw = norm(el.innerText || el.textContent || '');
    return { found: true, list, raw };
  }

  function buildVehicles10() {
    return Array.from({ length: 10 }, (_, i) => ({ idx: i + 1, vehicle: '', subtotal_raw: '', subtotal_number: '' }));
  }

  function isLeafTable(tbl) {
    // outer layout tables often contain nested tables (causes duplicates)
    try { return !tbl.querySelector('table'); } catch { return true; }
  }

  function isTableVisibleEnough(tbl) {
    if (!tbl || !tbl.getBoundingClientRect) return false;
    if (!isVisible(tbl)) return false;
    const r = tbl.getBoundingClientRect();
    if (r.width < 120 || r.height < 30) return false;
    return true;
  }

  function getAllTablesInOrderLeafVisible() {
    let tables = [];
    try { tables = Array.from(document.querySelectorAll('table')); } catch { tables = []; }
    tables = tables.filter(isLeafTable).filter(isTableVisibleEnough);

    tables.sort((a, b) => {
      const ra = a.getBoundingClientRect?.() || { top: 0, left: 0 };
      const rb = b.getBoundingClientRect?.() || { top: 0, left: 0 };
      if (ra.top !== rb.top) return ra.top - rb.top;
      return ra.left - rb.left;
    });

    return tables;
  }

  function hasHeaders(tbl, words) {
    if (!tbl) return false;
    let cells = [];
    try { cells = Array.from(tbl.querySelectorAll('th,td')).slice(0, 80); } catch { cells = []; }
    const hdr = lc(cells.map(c => norm(c.textContent || '')).join(' | '));
    return words.every(w => hdr.includes(w));
  }

  function isVehicleTable(tbl) {
    return hasHeaders(tbl, CFG.vehHdr4);
  }

  function isFeeTable(tbl) {
    const t = lc(tbl?.innerText || tbl?.textContent || '');
    if (!t) return false;
    return CFG.feeBadPhrases.some(p => t.includes(p));
  }

  function tableKey(tbl) {
    if (!tbl) return '';
    const id = tbl.id || '';
    if (id) return `id:${id}`;
    const a = tbl.closest?.('[id]')?.id || '';
    if (a) return `anc:${a}`;
    const r = tbl.getBoundingClientRect?.() || { top: 0, left: 0, width: 0, height: 0 };
    return `pos:${Math.round(r.top)}:${Math.round(r.left)}:${Math.round(r.width)}:${Math.round(r.height)}`;
  }

  // ✅ never treat header row as vehicle label
  function getVehicleLabelFrom4Col(tbl) {
    let rows = [];
    try { rows = Array.from(tbl.querySelectorAll('tr')); } catch { rows = []; }
    if (rows.length < 2) return '';

    const headerWords = CFG.vehHdr4.map(w => w.toLowerCase());
    const isHeaderRow = (tr) => {
      let cells = [];
      try { cells = Array.from(tr.querySelectorAll('th,td')); } catch { cells = []; }
      const txt = lc(cells.map(c => norm(c.textContent || '')).join(' '));
      return headerWords.every(w => txt.includes(w));
    };

    let valueRow = null;

    // find header row then next non-header row
    for (let i = 0; i < rows.length; i++) {
      if (!isHeaderRow(rows[i])) continue;
      for (let j = i + 1; j < rows.length; j++) {
        if (!isHeaderRow(rows[j])) { valueRow = rows[j]; break; }
      }
      break;
    }

    // fallback: 2nd row
    if (!valueRow) valueRow = rows[1] || null;
    if (!valueRow) return '';

    let cells = [];
    try { cells = Array.from(valueRow.querySelectorAll('td,th')); } catch { cells = []; }

    const vals = cells.map(c => norm(c.textContent || '')).filter(Boolean);
    const joined = vals.join(' ');
    if (!joined) return '';
    if (lc(joined) === 'model year make model vin') return '';
    return joined;
  }

  // ✅ Table2 subtotal: last non-empty row's last cell (last column)
  function readLastCellAsSubtotal(tbl) {
    if (!tbl) return { raw: '', num: '' };

    let rows = [];
    try { rows = Array.from(tbl.querySelectorAll('tr')); } catch { rows = []; }
    if (!rows.length) return { raw: '', num: '' };

    for (let i = rows.length - 1; i >= 0; i--) {
      let cells = [];
      try { cells = Array.from(rows[i].querySelectorAll('td,th')); } catch { cells = []; }
      if (!cells.length) continue;

      const last = norm(cells[cells.length - 1]?.textContent || '');
      if (!last) continue;

      // avoid grabbing pure header words like "Premium" etc.
      if (!/[$\d\-]/.test(last)) continue;

      const m = parseMoney(last);
      return { raw: m.raw || last, num: m.num || '' };
    }

    return { raw: '', num: '' };
  }

  // ✅ Core: vehicle blocks by sequence (Table1 -> Table2 -> ignore Table3 fees)
  async function extractVehicleSubtotalsBySequence() {
    const tables = getAllTablesInOrderLeafVisible();
    const autos = [];
    const seen = new Set();

    let matchedVeh = 0;
    let paired2 = 0;
    let skippedFeeDuringSeek = 0;
    let skippedDup = 0;

    for (let i = 0; i < tables.length; i++) {
      const t1 = tables[i];
      if (!isVehicleTable(t1)) continue;

      matchedVeh++;

      // Find Table2: next non-fee, non-vehicle table (stop if we hit next vehicle table)
      let t2 = null;
      for (let j = i + 1; j < Math.min(i + 1 + CFG.lookaheadMax, tables.length); j++) {
        const cand = tables[j];

        if (isFeeTable(cand)) { skippedFeeDuringSeek++; continue; }
        if (isVehicleTable(cand)) break;

        t2 = cand;
        break;
      }

      if (!t2) continue;
      paired2++;

      let vehicleLabel = getVehicleLabelFrom4Col(t1);
      if (!vehicleLabel) vehicleLabel = `Vehicle ${autos.length + 1}`;

      // small nudge for GW lazy content
      await realClickRetry(t1, 1, 120);
      await sleep(140);

      const sub = readLastCellAsSubtotal(t2);

      const key = [
        lc(vehicleLabel),
        norm(sub.raw || ''),
        tableKey(t1),
        tableKey(t2),
      ].join('||');

      if (seen.has(key)) { skippedDup++; continue; }
      seen.add(key);

      autos.push({
        vehicle: vehicleLabel,
        subtotal_raw: sub.raw || '',
        subtotal_number: sub.num || '',
      });

      if (autos.length >= CFG.maxVehicles) break;
    }

    return {
      found: autos.length > 0,
      autos,
      rows: autos.length,
      why: autos.length ? 'OK' : 'No vehicle blocks found',
      debug: { matchedVeh, paired2, skippedFeeDuringSeek, skippedDup, totalTables: tables.length }
    };
  }

  function isFormsScreen() {
    const h = lc(titleBarText());
    if (h.includes('forms')) return true;

    const markers = [
      '[id*="FormsScreen"]',
      '[id*="PolicyFile_Forms"]',
      '[id*="Forms_Screen"]',
      '[id*="FormsScreen-"]',
    ];
    for (const sel of markers) {
      let el = null;
      try { el = document.querySelector(sel); } catch { el = null; }
      if (el && isVisible(el)) return true;
    }
    return false;
  }

  function findFormsClickable() {
    const want = lc(CFG.formsText);

    const clickParents = (node) => {
      if (!node) return null;
      const chain = [];
      let cur = node;
      for (let i = 0; i < 8 && cur; i++) { chain.push(cur); cur = cur.parentElement; }
      for (const el of chain) {
        const cls = (el.className || '');
        const role = (el.getAttribute?.('role') || '');
        if (el.tagName === 'BUTTON' || el.tagName === 'A') return el;
        if (cls.includes('gw-action--inner')) return el;
        if (role === 'menuitem' || role === 'tab') return el;
      }
      return chain[0] || null;
    };

    // prefer menu inner
    let inners = [];
    try { inners = Array.from(document.querySelectorAll('.gw-action--inner')); } catch { inners = []; }
    for (const el of inners) {
      if (!isVisible(el)) continue;
      if (lc(el.textContent).includes(want)) return clickParents(el);
    }

    // role menu/tab
    let menuRows = [];
    try { menuRows = Array.from(document.querySelectorAll('.gw-WestPanelMenuItem, [role="menuitem"], [role="tab"]')); } catch { menuRows = []; }
    for (const el of menuRows) {
      if (!isVisible(el)) continue;
      if (lc(el.textContent || '').includes(want)) return clickParents(el);
    }

    return null;
  }

  async function clickFormsAndVerify() {
    for (let i = 1; i <= CFG.formsClickMaxTries; i++) {
      if (!getEnabled() || !STATE.armed) return false;

      const hit = findFormsClickable();
      if (!hit) { log(`FORMS: try ${i}/${CFG.formsClickMaxTries} — not found`); await sleep(260 + i * 120); continue; }

      log(`FORMS: try ${i}/${CFG.formsClickMaxTries} — clicking "${norm(hit.textContent || hit.getAttribute?.('aria-label') || '')}"`);
      await realClickRetry(hit, 2, 240);

      const t0 = Date.now();
      while (Date.now() - t0 < CFG.formsVerifyMaxMs) {
        if (!getEnabled() || !STATE.armed) return false;
        if (isFormsScreen()) { log('FORMS verify: OK'); return true; }
        await sleep(250);
      }
      log('FORMS verify: not yet');
      await sleep(420);
    }
    log('FORMS: FAIL');
    return false;
  }

  const STATE = {
    armed: false,
    running: false,
    pollTimer: null,
    gateWaitTimer: null,
    gateSeen: false,
  };

  const UI = (() => {
    let panel, bubble, pre, statusEl, logWrap, btnStart, btnStop, btnForce, titleEl;

    function readStep4Anchor() {
      const step4 = document.getElementById(CFG.step4HostId) || document.getElementById(CFG.step4BubbleId);
      if (!step4) return null;
      try {
        const cs = getComputedStyle(step4);
        const right = parseInt(cs.right || '0', 10);
        const bottom = parseInt(cs.bottom || '0', 10);
        if (Number.isFinite(right) && Number.isFinite(bottom)) return { right, bottom };
      } catch {}
      return null;
    }

    function calcMyAnchor() {
      const a = readStep4Anchor();
      if (!a) return { right: CFG.fallbackRightPx, bottom: CFG.fallbackBottomPx };
      return { right: a.right + CFG.gapPx, bottom: a.bottom };
    }

    function inject() {
      if (document.getElementById(CFG.hostId)) return;

      try { document.getElementById(CFG.hostId)?.remove(); } catch {}
      try { document.getElementById(CFG.bubbleId)?.remove(); } catch {}

      const anchor = calcMyAnchor();

      const host = document.createElement('div');
      host.id = CFG.hostId;
      host.style.cssText = `position:fixed;right:${anchor.right}px;bottom:${anchor.bottom}px;z-index:2147483647;font:12px/1.2 system-ui,Segoe UI,Roboto,Arial;color:#111;`;
      document.documentElement.appendChild(host);

      bubble = document.createElement('button');
      bubble.id = CFG.bubbleId;
      bubble.type = 'button';
      bubble.textContent = 'PC5';
      bubble.style.cssText = `position:fixed;right:${anchor.right}px;bottom:${anchor.bottom}px;width:44px;height:44px;border-radius:999px;border:0;background:#111;color:#fff;font-weight:800;cursor:pointer;display:none;box-shadow:0 10px 30px rgba(0,0,0,.25);`;
      document.documentElement.appendChild(bubble);

      panel = document.createElement('div');
      panel.style.cssText = `width:${CFG.uiWidthPx}px;border:1px solid rgba(0,0,0,.15);border-radius:12px;background:#fff;box-shadow:0 10px 30px rgba(0,0,0,.15);overflow:hidden;`;
      host.appendChild(panel);

      const top = document.createElement('div');
      top.style.cssText = `display:flex;align-items:center;justify-content:space-between;padding:10px 10px;border-bottom:1px solid rgba(0,0,0,.08);user-select:none;`;
      titleEl = document.createElement('div');
      titleEl.textContent = 'PC Step5 — Quote';
      titleEl.style.cssText = `font-weight:800;`;
      statusEl = document.createElement('div');
      statusEl.textContent = 'IDLE';
      statusEl.style.cssText = `font-weight:800;opacity:.75;`;
      top.appendChild(titleEl);
      top.appendChild(statusEl);
      panel.appendChild(top);

      titleEl.addEventListener('dblclick', () => { panel.style.display = 'none'; bubble.style.display = 'block'; });
      bubble.addEventListener('click', () => { panel.style.display = 'block'; bubble.style.display = 'none'; });

      const btnRow = document.createElement('div');
      btnRow.style.cssText = `display:flex;gap:8px;padding:10px;border-bottom:1px solid rgba(0,0,0,.08);`;

      function mkBtn(t) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = t;
        b.style.cssText = `flex:1;padding:10px 8px;border-radius:10px;border:1px solid rgba(0,0,0,.18);background:#f7f7f7;font-weight:800;cursor:pointer;`;
        return b;
      }

      btnStart = mkBtn('START');
      btnStop  = mkBtn('STOP');
      btnForce = mkBtn('FORCE RUN');

      btnRow.appendChild(btnStart);
      btnRow.appendChild(btnStop);
      btnRow.appendChild(btnForce);
      panel.appendChild(btnRow);

      logWrap = document.createElement('div');
      logWrap.style.cssText = `max-height:260px;overflow:auto;padding:10px;`;
      pre = document.createElement('pre');
      pre.style.cssText = `margin:0;white-space:pre-wrap;word-break:break-word;font:11px/1.35 ui-monospace,Consolas,monospace;`;
      logWrap.appendChild(pre);
      panel.appendChild(logWrap);
    }

    function setStatus(s) {
      if (statusEl) statusEl.textContent = s;
      paintButtons();
    }

    function appendLog(line) {
      if (!pre) return;
      const lines = pre.textContent ? pre.textContent.split('\n') : [];
      lines.push(line);
      pre.textContent = lines.slice(-CFG.maxLogLines).join('\n');
      if (logWrap) logWrap.scrollTop = logWrap.scrollHeight;
    }

    function log(msg) { appendLog(`[${ts()}] ${msg}`); }

    function paintButtons() {
      if (!btnStart || !btnStop || !btnForce) return;
      const enabled = getEnabled();
      btnStop.disabled = !enabled && !STATE.running;
      btnStop.style.opacity = btnStop.disabled ? '0.55' : '1';
      btnForce.disabled = STATE.running;
      btnForce.style.opacity = btnForce.disabled ? '0.55' : '1';
      btnStart.disabled = enabled && !STATE.running;
      btnStart.style.opacity = btnStart.disabled ? '0.7' : '1';
    }

    function resnapIfNeeded() {
      const step4 = document.getElementById(CFG.step4HostId) || document.getElementById(CFG.step4BubbleId);
      const h = document.getElementById(CFG.hostId);
      const b = document.getElementById(CFG.bubbleId);
      if (!step4 || !h || !b) return;

      let right = null, bottom = null;
      try {
        const cs = getComputedStyle(step4);
        right = parseInt(cs.right || '0', 10);
        bottom = parseInt(cs.bottom || '0', 10);
      } catch {}
      if (!Number.isFinite(right) || !Number.isFinite(bottom)) return;

      const wantRight = right + CFG.gapPx;
      const wantBottom = bottom;

      const curRight = parseInt(h.style.right || '0', 10);
      const curBottom = parseInt(h.style.bottom || '0', 10);

      if (curRight !== wantRight || curBottom !== wantBottom) {
        h.style.right = `${wantRight}px`;
        h.style.bottom = `${wantBottom}px`;
        b.style.right = `${wantRight}px`;
        b.style.bottom = `${wantBottom}px`;
      }
    }

    return { inject, setStatus, log, paintButtons, resnapIfNeeded, getButtons: () => ({ btnStart, btnStop, btnForce }) };
  })();

  function log(msg) { UI.log(msg); }
  function setStatus(s) { UI.setStatus(s); }

  function arm() {
    if (STATE.armed) return;
    STATE.armed = true;
    setStatus('ARMED');
    log('ARMED. Waiting for Quote/Pricing header…');

    if (STATE.pollTimer) clearInterval(STATE.pollTimer);
    STATE.pollTimer = setInterval(() => {
      if (!getEnabled()) return;
      if (!STATE.armed || STATE.running) return;

      const gate = findGateHeader();

      // reset when header not visible (so it can run again next time Quote appears)
      if (!gate) {
        if (STATE.gateWaitTimer) {
          clearTimeout(STATE.gateWaitTimer);
          STATE.gateWaitTimer = null;
          log('QUOTE lost → timer canceled.');
        }
        if (STATE.gateSeen) {
          STATE.gateSeen = false;
          log('Gate not visible → ready for next appearance.');
        }
        return;
      }

      // do not re-run while header stays visible (same behavior style as Step4)
      if (STATE.gateSeen) return;

      // schedule run
      log(`QUOTE visible (“${gate.text}”) → wait ${CFG.gateDelayMs}ms…`);
      STATE.gateSeen = true;
      STATE.gateWaitTimer = setTimeout(() => {
        STATE.gateWaitTimer = null;
        if (!getEnabled() || !STATE.armed || STATE.running) return;

        const gate2 = findGateHeader();
        if (!gate2) {
          log('QUOTE lost before extract.');
          STATE.gateSeen = false;
          return;
        }

        run(false);
      }, CFG.gateDelayMs);

    }, CFG.pollMs);

    UI.paintButtons();
  }

  function disarm(toIdle) {
    STATE.armed = false;
    if (STATE.pollTimer) clearInterval(STATE.pollTimer);
    STATE.pollTimer = null;
    if (STATE.gateWaitTimer) clearTimeout(STATE.gateWaitTimer);
    STATE.gateWaitTimer = null;
    if (toIdle) setStatus('IDLE');
    UI.paintButtons();
  }

  async function run(force) {
    if (STATE.running) return;
    STATE.running = true;
    setStatus('RUNNING');

    const token = acquireRunLock();
    if (!token) {
      log('Another instance is running (lock active).');
      STATE.running = false;
      setStatus('ARMED');
      return;
    }

    try {
      log(force ? 'FORCE RUN requested…' : 'RUN start…');

      if (!force) {
        const gate = findGateHeader();
        if (!gate) {
          log('Gate not found. Staying ARMED.');
          setStatus('ARMED');
          STATE.gateSeen = false;
          return;
        }
      }

      const payload = {
        step: 'quote',
        extracted_at: nowIso(),

        total_cost_raw: '',
        total_cost_number: '',
        total_via: '',

        discounts_list: [],
        discounts_raw: '',

        vehicles: buildVehicles10(),
        meta: {
          ok: false,
          note: '',
          found: { total: false, discounts: false, subtotals: false },
          debug: {}
        }
      };

      const t = extractTotal();
      payload.total_cost_raw = t.raw || '';
      payload.total_cost_number = t.num || '';
      payload.total_via = t.via || '';
      payload.meta.found.total = !!t.found;
      log(`TotalCost: ${t.found ? `${payload.total_cost_raw} (${payload.total_cost_number})` : 'NOT FOUND'}`);

      const d = extractDiscounts();
      payload.meta.found.discounts = !!d.found;
      payload.discounts_list = Array.isArray(d.list) ? d.list : [];
      payload.discounts_raw = d.raw || '';
      log(d.found ? `Discounts: ${payload.discounts_list.length || 0}` : 'Discounts: NOT FOUND');

      const s = await extractVehicleSubtotalsBySequence();
      payload.meta.debug.subtotalsWhy = s.why || '';
      payload.meta.debug.vehicleBlocks = s.rows || 0;
      payload.meta.debug.tablesTotal = s.debug?.totalTables ?? '';
      payload.meta.debug.matchedVeh = s.debug?.matchedVeh ?? '';
      payload.meta.debug.paired2 = s.debug?.paired2 ?? '';
      payload.meta.debug.skippedFeeDuringSeek = s.debug?.skippedFeeDuringSeek ?? '';
      payload.meta.debug.skippedDup = s.debug?.skippedDup ?? '';

      if (!s.found) {
        log(`Subtotals: NOT FOUND (${s.why})`);
      } else {
        for (let i = 0; i < Math.min(CFG.maxVehicles, s.autos.length); i++) {
          payload.vehicles[i].vehicle = s.autos[i].vehicle || '';
          payload.vehicles[i].subtotal_raw = s.autos[i].subtotal_raw || '';
          payload.vehicles[i].subtotal_number = s.autos[i].subtotal_number || '';
        }
        payload.meta.found.subtotals = true;
        log(`Subtotals: mapped=${Math.min(CFG.maxVehicles, s.autos.length)} (dupSkipped=${s.debug?.skippedDup ?? 0})`);
      }

      payload.meta.ok = !!(payload.meta.found.total || payload.meta.found.discounts || payload.meta.found.subtotals);
      payload.meta.note = payload.meta.ok ? 'OK' : 'No extractable fields found.';

      lsSet(CFG.k_payload, JSON.stringify(payload)); log(`Copied → ${CFG.k_payload}`);
      lsSet(CFG.k_ready, String(Date.now())); log(`Copied → ${CFG.k_ready}`);
      lsSet(CFG.k_stepStage, 'quote_done'); log(`Copied → ${CFG.k_stepStage} = quote_done`);

      setStatus('DONE');
      log(`DONE. ok=${payload.meta.ok ? 'true' : 'false'}`);

      log('FORMS: clicking…');
      const okForms = await clickFormsAndVerify();
      log(okForms ? 'FORMS: done.' : 'FORMS: failed.');

      setStatus('ARMED');
      log('Back to ARMED. Waiting for Quote/Pricing header…');
    } catch (e) {
      log(`ERROR: ${e?.message || e}`);
      setStatus('ARMED');
      STATE.gateSeen = false;
    } finally {
      releaseRunLock(token);
      STATE.running = false;
      UI.paintButtons();
    }
  }

  // ---- boot ----
  UI.inject();
  const { btnStart, btnStop, btnForce } = UI.getButtons();

  btnStart?.addEventListener('click', () => { setEnabled(true); arm(); });
  btnStop?.addEventListener('click', () => {
    setEnabled(false);
    disarm(true);
    STATE.gateSeen = false;
    log('STOPPED (session-only; reload will auto-enable).');
  });
  btnForce?.addEventListener('click', () => {
    setEnabled(true);
    if (!STATE.armed) arm();
    run(true);
  });

  // ✅ AUTO forced ON at load
  setEnabled(true);
  setStatus('ARMED');
  log('Loaded → ALWAYS ON this load (STOP is session-only).');
  arm();

  setInterval(() => { try { UI.resnapIfNeeded(); } catch {} }, 900);

  window.tmPcStep5 = {
    runOnce: () => run(true),
    getLastJson: () => safeJsonParse(lsGet(CFG.k_payload) || 'null', null),
    getStage: () => lsGet(CFG.k_stepStage) || '',
  };
})();
