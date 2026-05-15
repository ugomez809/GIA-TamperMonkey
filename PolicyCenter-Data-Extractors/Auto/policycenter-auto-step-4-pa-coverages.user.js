// ==UserScript==
// @name         PolicyCenter — Step 4: PA Coverages → 1-row export + Quote click (ALWAYS ON)
// @namespace    tm.pc.step4.pacoverages
// @version      1.1.4
// @description  ALWAYS ON each load (STOP is session-only). When PA Coverages header visible: extract "all vehicles in CA" + per-vehicle coverages across Next pages, build ONE ROW (v1..v10), save JSON+TXT exports to localStorage, then click Quote. Won’t re-run again until header disappears and comes back.
// @match        https://policycenter.farmersinsurance.com/pc/PolicyCenter.do*
// @match        https://policycenter-2.farmersinsurance.com/pc/PolicyCenter.do*
// @match        https://policycenter-3.farmersinsurance.com/pc/PolicyCenter.do*
// @run-at       document-idle
// @all-frames   true
// @grant        none
// @updateURL    https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/PolicyCenter-Data-Extractors/Auto/policycenter-auto-step-4-pa-coverages.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/PolicyCenter-Data-Extractors/Auto/policycenter-auto-step-4-pa-coverages.user.js
// ==/UserScript==

(() => {
  'use strict';
  if (window.top !== window.self) return;

  const CFG = {
    gateHeaderSel: 'div.gw-TitleBar--title[role="heading"][aria-level="1"]',
    gateTextPrefix: 'PA Cover',
    postGateWaitMs: 1200,

    nextBtnId: 'PolicyFile_PersonalAuto-PolicyFile_PA_Coverages_Screen-PAPerVehicle_ExtPanelSet-next',
    maxNextClicks: 8,
    afterNextWaitMs: 2000,
    waitPageChangeMaxMs: 12000,
    waitPageChangePollMs: 300,

    maxVehicles: 10,
    maxRunMs: 140_000,

    k_payload_json: 'tm_pc_pacoverages_row_v1',
    k_payload_row:  'tm_pc_pacoverages_row_values_v1',
    k_payload_txt:  'tm_pc_pacoverages_export_txt_v1',
    k_ready:        'tm_pc_pacoverages_ready_v1',
    k_stage:        'tm_pc_stage_v1',
    stageValue:     'pa_coverages_done',

    // session-enabled flag (STOP toggles this, but we force it ON at load)
    k_enabled: 'tm_pc_step4_enabled_v1',

    // prevents multi-instance overlaps
    k_runlock: 'tm_pc_step4_runlock_v1',
    runLockTtlMs: 120_000,

    // ✅ prevents re-running while header stays visible
    k_cooldown: 'tm_pc_step4_cooldown_v1',

    hostId: 'tm_pc_step4_host',
    bubbleId: 'tm_pc_step4_bubble',
    uiRightPx: 1010,
    uiBottomPx: 14,
    maxLogLines: 520,

    quoteLabel: 'Quote',
  };

  const FRAME_ID = `pc4_${Math.random().toString(16).slice(2)}_${Date.now()}`;

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

  const isVisible = (el) => {
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    if (Number(cs.opacity || '1') <= 0.05) return false;
    return true;
  };

  // ✅ FORCE AUTO ON EVERY LOAD (Stop not persisted)
  // Also clears run lock + cooldown so it never starts "stuck" after reload.
  try {
    lsSet(CFG.k_enabled, '1');
    lsDel(CFG.k_runlock);
    lsSet(CFG.k_cooldown, '0');
  } catch {}

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

  function getCooldown() { return (lsGet(CFG.k_cooldown) ?? '0') === '1'; }
  function setCooldown(on) { lsSet(CFG.k_cooldown, on ? '1' : '0'); log(`Copied → ${CFG.k_cooldown} = ${on ? '1' : '0'}`); }

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

  function findGateHeader() {
    const els = Array.from(document.querySelectorAll(CFG.gateHeaderSel));
    for (const el of els) {
      if (!isVisible(el)) continue;
      const t = norm(el.textContent);
      if (!t) continue;
      if (!t.toLowerCase().startsWith(CFG.gateTextPrefix.toLowerCase())) continue;
      return { el, text: t };
    }
    return null;
  }

  function titleBarText() {
    const els = Array.from(document.querySelectorAll(CFG.gateHeaderSel)).filter(isVisible);
    return norm(els[0]?.textContent || '');
  }

  const VEH_RE = /^(\d+)\.\s+/;

  function getVisiblePanelTexts() {
    const candidates = Array.from(document.querySelectorAll('.gw-PanelWidget, .gw-DetailViewWidget, .gw-InputGroup, .gw-InputColumnWidget, .gw-RowWidget, .gw-ListViewWidget, [role="region"], [role="group"]'))
      .filter(isVisible);

    let best = null;
    let bestScore = -1;
    for (const c of candidates) {
      const t = norm(c.textContent || '');
      if (!t) continue;
      const score =
        (t.includes('Coverages applied per vehicle') ? 50 : 0) +
        (t.includes('Coverages applied to all vehicles') ? 20 : 0) +
        (t.includes('Comprehensive') ? 10 : 0) +
        Math.min(40, Math.floor(t.length / 400));
      if (score > bestScore) { bestScore = score; best = c; }
    }
    return { best, text: best ? (best.innerText || best.textContent || '') : '' };
  }

  function extractAllVehiclesCA(text) {
    const lines = String(text || '').split('\n').map(s => norm(s)).filter(Boolean);
    const startIdx = lines.findIndex(l => lc(l) === lc('Coverages applied to all vehicles in California'));
    if (startIdx < 0) return { label: 'Coverages applied to all vehicles in California', block: '' };

    let endIdx = lines.findIndex((l, i) => i > startIdx && lc(l).includes('coverages applied per vehicle'));
    if (endIdx < 0) endIdx = lines.length;

    const blockLines = lines.slice(startIdx + 1, endIdx).filter(l => {
      const low = lc(l);
      return !(low === 'next >' || low === 'next>' || low === 'next');
    });

    return { label: lines[startIdx] || 'Coverages applied to all vehicles in California', block: blockLines.join('\n') };
  }

  function splitVehicleBlocks(text) {
    const rawLines = String(text || '').split('\n');
    const lines = rawLines.map(s => norm(s)).filter(Boolean);

    const perIdx = lines.findIndex(l => lc(l).includes('coverages applied per vehicle'));
    const slice = (perIdx >= 0) ? lines.slice(perIdx + 1) : lines.slice();

    const work = slice.filter(l => {
      const low = lc(l);
      return !(low === 'next >' || low === 'next>' || low === 'next');
    });

    const idxs = [];
    for (let i = 0; i < work.length; i++) {
      if (VEH_RE.test(work[i])) idxs.push(i);
    }
    if (!idxs.length) return [];

    const blocks = [];
    for (let b = 0; b < idxs.length; b++) {
      const start = idxs[b];
      const end = (b + 1 < idxs.length) ? idxs[b + 1] : work.length;
      const vehicle = work[start];
      const coverageLines = work.slice(start + 1, end);

      const cleaned = coverageLines.filter(l => {
        const low = lc(l);
        if (low.includes('coverages applied')) return false;
        if (low === 'coverages' || low === 'additional coverages') return false;
        return true;
      });

      blocks.push({ vehicle, coverage: cleaned.join('\n') });
    }
    return blocks;
  }

  function signatureOfVehicles(blocks) {
    return blocks.map(b => b.vehicle).join('||');
  }

  function getNextButton() {
    let el = null;
    try { el = document.getElementById(CFG.nextBtnId); } catch { el = null; }
    if (!el) {
      try { el = document.querySelector('[id*="PAPerVehicle_ExtPanelSet-next"]'); } catch { el = null; }
    }
    return el;
  }

  function isNextEnabled(btn) {
    if (!btn || !isVisible(btn)) return false;
    const aria = btn.getAttribute('aria-disabled');
    if (aria && aria.toLowerCase() === 'true') return false;
    const tb = btn.getAttribute('tabindex');
    if (tb === '-1') return false;
    const cls = String(btn.className || '');
    if (cls.includes('gw-disabled')) return false;
    if (!cls.includes('gw-actionable')) return false;
    return true;
  }

  async function waitVehicleChange(prevSig) {
    const t0 = Date.now();
    while ((Date.now() - t0) < CFG.waitPageChangeMaxMs) {
      const { text } = getVisiblePanelTexts();
      const blocks = splitVehicleBlocks(text);
      const sig = signatureOfVehicles(blocks);
      if (sig && sig !== prevSig) return { changed: true, blocks, sig };
      await sleep(CFG.waitPageChangePollMs);
    }
    const { text } = getVisiblePanelTexts();
    const blocks = splitVehicleBlocks(text);
    return { changed: false, blocks, sig: signatureOfVehicles(blocks) };
  }

  function findQuoteEl() {
    const pool = Array.from(document.querySelectorAll('.gw-WestPanelMenuItem, .gw-MenuItemWidget, [role="menuitem"], [role="tab"], button, a, div, span'))
      .filter(isVisible);

    let hit = pool.find(el => lc(el.textContent) === lc(CFG.quoteLabel));
    if (hit) return hit.closest('[role="menuitem"],[role="tab"],.gw-WestPanelMenuItem,.gw-MenuItemWidget,button,a') || hit;

    hit = pool.find(el => lc(el.textContent).includes('quote'));
    if (hit) return hit.closest('[role="menuitem"],[role="tab"],.gw-WestPanelMenuItem,.gw-MenuItemWidget,button,a') || hit;

    hit = pool.find(el => lc(el.getAttribute('aria-label')).includes('quote') || lc(el.getAttribute('data-gw-tooltip')).includes('quote'));
    if (hit) return hit.closest('[role="menuitem"],[role="tab"],.gw-WestPanelMenuItem,.gw-MenuItemWidget,button,a') || hit;

    return null;
  }

  async function clickQuoteBestEffort() {
    const el = findQuoteEl();
    if (!el) { log('Quote NOT found (skipping click).'); return false; }

    const inner = el.querySelector('.gw-action--inner') || el.querySelector('[class*="gw-action--inner"]') || null;

    const hrefBefore = String(location.href || '');
    const headerBefore = titleBarText();
    log(`Clicking Quote… (before header="${headerBefore}")`);

    let ok = false;
    if (inner && isVisible(inner)) ok = await realClickRetry(inner, 2, 260);
    if (!ok) ok = await realClickRetry(el, 2, 260);

    await sleep(1200);

    const hrefAfter = String(location.href || '');
    const headerAfter = titleBarText();
    const changed = hrefAfter !== hrefBefore;
    const headerLooks = lc(headerAfter).includes('quote') && lc(headerAfter) !== lc(headerBefore);

    log(`Quote click done. verify: changed=${changed} headerLooks=${headerLooks} headerAfter="${headerAfter}"`);
    return ok;
  }

  function buildOneRow(allLabel, allBlock, vehiclesArr) {
    const columns = [
      'all_label','all_coverages',
      'v1_vehicle','v1_coverages',
      'v2_vehicle','v2_coverages',
      'v3_vehicle','v3_coverages',
      'v4_vehicle','v4_coverages',
      'v5_vehicle','v5_coverages',
      'v6_vehicle','v6_coverages',
      'v7_vehicle','v7_coverages',
      'v8_vehicle','v8_coverages',
      'v9_vehicle','v9_coverages',
      'v10_vehicle','v10_coverages',
    ];

    const row = new Array(columns.length).fill('');
    row[0] = allLabel || 'Coverages applied to all vehicles in California';
    row[1] = allBlock || '';

    for (let i = 0; i < CFG.maxVehicles; i++) {
      const v = vehiclesArr[i];
      const base = 2 + (i * 2);
      row[base] = v?.vehicle || '';
      row[base + 1] = v?.coverage || '';
    }
    return { columns, row };
  }

  function buildTxtExport(oneRowObj) {
    const { columns, row } = oneRowObj;
    const get = (name) => {
      const idx = columns.indexOf(name);
      return idx >= 0 ? (row[idx] || '') : '';
    };

    const out = [];
    out.push(`extracted_at: ${nowIso()}`);
    out.push('');

    out.push(get('all_label'));
    out.push(get('all_coverages') || '(empty)');
    out.push('');

    for (let i = 1; i <= CFG.maxVehicles; i++) {
      const veh = get(`v${i}_vehicle`);
      const cov = get(`v${i}_coverages`);
      if (!veh && !cov) continue;

      out.push(`Vehicle ${i}`);
      out.push(veh || '(empty)');
      out.push(cov || '(empty)');
      out.push('');
    }
    return out.join('\n').trim() + '\n';
  }

  const STATE = { armed: false, running: false, pollTimer: null, gateWaitTimer: null, runStartAt: 0 };

  const UI = (() => {
    let host, panel, bubble, pre, statusEl, logWrap, btnStart, btnStop, btnForce, titleEl;

    function inject() {
      if (document.getElementById(CFG.hostId)) return;

      try { document.getElementById(CFG.hostId)?.remove(); } catch {}
      try { document.getElementById(CFG.bubbleId)?.remove(); } catch {}

      host = document.createElement('div');
      host.id = CFG.hostId;
      host.style.cssText = `position:fixed;right:${CFG.uiRightPx}px;bottom:${CFG.uiBottomPx}px;z-index:2147483647;font:12px/1.2 system-ui,Segoe UI,Roboto,Arial;color:#111;`;
      document.documentElement.appendChild(host);

      bubble = document.createElement('button');
      bubble.id = CFG.bubbleId;
      bubble.type = 'button';
      bubble.textContent = 'PC4';
      bubble.style.cssText = `position:fixed;right:${CFG.uiRightPx}px;bottom:${CFG.uiBottomPx}px;width:44px;height:44px;border-radius:999px;border:0;background:#111;color:#fff;font-weight:800;cursor:pointer;display:none;box-shadow:0 10px 30px rgba(0,0,0,.25);`;
      document.documentElement.appendChild(bubble);

      panel = document.createElement('div');
      panel.style.cssText = `width:320px;border:1px solid rgba(0,0,0,.15);border-radius:12px;background:#fff;box-shadow:0 10px 30px rgba(0,0,0,.15);overflow:hidden;`;
      host.appendChild(panel);

      const top = document.createElement('div');
      top.style.cssText = `display:flex;align-items:center;justify-content:space-between;padding:10px 10px;border-bottom:1px solid rgba(0,0,0,.08);user-select:none;`;
      titleEl = document.createElement('div');
      titleEl.textContent = 'PC Step4 — PA Coverages';
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

    return { inject, setStatus, log, paintButtons, getButtons: () => ({ btnStart, btnStop, btnForce }) };
  })();

  function log(msg) { UI.log(msg); }
  function setStatus(s) { UI.setStatus(s); }

  function arm() {
    if (STATE.armed) return;
    STATE.armed = true;
    setStatus('ARMED');
    log('ARMED. Waiting for PA Coverages header…');

    if (STATE.pollTimer) clearInterval(STATE.pollTimer);
    STATE.pollTimer = setInterval(() => {
      if (!getEnabled()) return;
      if (!STATE.armed || STATE.running) return;
      if (STATE.gateWaitTimer) return;

      const gate = findGateHeader();

      // ✅ cooldown: do not re-run while header stays visible
      if (getCooldown()) {
        if (!gate) {
          setCooldown(false);
          log('Header not visible → cooldown cleared.');
        }
        return;
      }

      if (!gate) return;

      log(`Gate visible (“${gate.text}”) → wait ${CFG.postGateWaitMs}ms…`);
      STATE.gateWaitTimer = setTimeout(() => {
        STATE.gateWaitTimer = null;
        if (!getEnabled() || !STATE.armed || STATE.running) return;
        if (getCooldown()) return;
        run(false);
      }, CFG.postGateWaitMs);
    }, 750);

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
    STATE.runStartAt = Date.now();
    setStatus('RUNNING');

    const token = acquireRunLock();
    if (!token) {
      log('Another instance is running (lock active).');
      STATE.running = false;
      setStatus('ARMED');
      return;
    }

    let success = false;

    try {
      log(force ? 'FORCE RUN requested…' : 'RUN start…');

      if (!force) {
        const gate = findGateHeader();
        if (!gate) {
          log('Gate not found. Staying ARMED.');
          setStatus('ARMED');
          return;
        }
      } else {
        // force ignores cooldown
        setCooldown(false);
      }

      await sleep(550);

      const { text } = getVisiblePanelTexts();
      const all = extractAllVehiclesCA(text);

      const collectedMap = new Map();
      const addBlocks = (arr) => {
        for (const b of arr) {
          const key = norm(b.vehicle);
          if (!key) continue;
          if (!collectedMap.has(key)) collectedMap.set(key, b.coverage || '');
        }
      };

      let blocksA = splitVehicleBlocks(text);
      let sig = signatureOfVehicles(blocksA);
      addBlocks(blocksA);

      log(`Page A vehicles found: ${blocksA.length} (${blocksA.map(b => b.vehicle).join(' | ') || '(none)'})`);

      let nextClicks = 0;

      while ((Date.now() - STATE.runStartAt) < CFG.maxRunMs) {
        if (collectedMap.size >= CFG.maxVehicles) break;

        const nextBtn = getNextButton();
        if (!isNextEnabled(nextBtn)) { log('Next > not enabled (done paging).'); break; }
        if (nextClicks >= CFG.maxNextClicks) { log(`Max Next clicks reached (${CFG.maxNextClicks}).`); break; }

        nextClicks++;
        log(`Clicking Next > (${nextClicks}/${CFG.maxNextClicks})…`);
        await realClickRetry(nextBtn, 2, 240);
        await sleep(CFG.afterNextWaitMs);

        const res = await waitVehicleChange(sig);
        log(`Change detected? ${res.changed} | prevSig==newSig? ${res.sig === sig}`);

        const { text: textB } = getVisiblePanelTexts();
        const blocksB = splitVehicleBlocks(textB);
        const sigB = signatureOfVehicles(blocksB);

        log(`Page ${String.fromCharCode(65 + nextClicks)} vehicles found: ${blocksB.length} (${blocksB.map(b => b.vehicle).join(' | ') || '(none)'})`);
        addBlocks(blocksB);

        if (sigB && sigB !== sig) sig = sigB;
        else if (!res.changed) {
          log('No page change detected → retry Next once…');
          await sleep(500);
          await realClickRetry(nextBtn, 2, 280);
          await sleep(CFG.afterNextWaitMs);

          const res2 = await waitVehicleChange(sig);
          log(`Retry change detected? ${res2.changed}`);

          const { text: textC } = getVisiblePanelTexts();
          const blocksC = splitVehicleBlocks(textC);
          addBlocks(blocksC);

          const sigC = signatureOfVehicles(blocksC);
          if (sigC && sigC !== sig) sig = sigC;

          if (!res2.changed) { log('Still no change after retry → stopping paging.'); break; }
        }
      }

      const vehiclesArr = Array.from(collectedMap.entries()).map(([vehicle, coverage]) => ({ vehicle, coverage }));
      vehiclesArr.sort((a, b) => {
        const ma = String(a.vehicle).match(/^(\d+)\./);
        const mb = String(b.vehicle).match(/^(\d+)\./);
        const na = ma ? Number(ma[1]) : 9999;
        const nb = mb ? Number(mb[1]) : 9999;
        return na - nb;
      });

      const trimmed = vehiclesArr.slice(0, CFG.maxVehicles);
      log(`Vehicles collected total = ${trimmed.length} | next_clicks=${nextClicks}`);

      const oneRow = buildOneRow(all.label, all.block, trimmed);
      const txt = buildTxtExport(oneRow);

      const payload = {
        extracted_at: nowIso(),
        columns: oneRow.columns,
        row: oneRow.row,
        meta: { vehicles_collected: trimmed.length, next_clicks: nextClicks }
      };

      lsSet(CFG.k_payload_json, JSON.stringify(payload)); log(`Copied → ${CFG.k_payload_json}`);
      lsSet(CFG.k_payload_row, JSON.stringify(oneRow.row)); log(`Copied → ${CFG.k_payload_row}`);
      lsSet(CFG.k_payload_txt, txt); log(`Copied → ${CFG.k_payload_txt}`);
      lsSet(CFG.k_ready, String(Date.now())); log(`Copied → ${CFG.k_ready}`);
      lsSet(CFG.k_stage, CFG.stageValue); log(`Copied → ${CFG.k_stage} = ${CFG.stageValue}`);

      success = true;

      setStatus('DONE');
      log('DONE. Clicking Quote…');
      await clickQuoteBestEffort();

      // ✅ do not run again until header disappears and comes back
      setCooldown(true);

      setStatus('ARMED');
      log('Back to ARMED (cooldown active until header disappears).');

    } catch (e) {
      log(`ERROR: ${e?.message || e}`);
      setStatus('ARMED');
    } finally {
      releaseRunLock(token);
      STATE.running = false;
      UI.paintButtons();

      // If run failed, allow retries (no cooldown)
      if (!success) {
        try { setCooldown(false); } catch {}
      }
    }
  }

  UI.inject();
  const { btnStart, btnStop, btnForce } = UI.getButtons();

  btnStart?.addEventListener('click', () => {
    setEnabled(true);
    setCooldown(false);
    arm();
  });

  btnStop?.addEventListener('click', () => {
    setEnabled(false);
    disarm(true);
    log('STOPPED (session-only; reload will auto-enable).');
  });

  btnForce?.addEventListener('click', () => {
    setEnabled(true);
    setCooldown(false);
    if (!STATE.armed) arm();
    run(true);
  });

  // ✅ AUTO forced ON at load
  setEnabled(true);
  setCooldown(false);
  setStatus('ARMED');
  log('Loaded → ALWAYS ON this load (STOP is session-only).');
  arm();

  window.tmPcStep4 = {
    runOnce: () => run(true),
    getLastJson: () => safeJsonParse(lsGet(CFG.k_payload_json) || 'null', null),
    getLastTxt: () => lsGet(CFG.k_payload_txt) || '',
  };
})();
