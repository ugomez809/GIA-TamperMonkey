// ==UserScript==
// @name         PolicyCenter — Step 2: Drivers (extract + stop)
// @namespace    tm.pc.pa.extractor.step2
// @version      1.5.4
// @description  Step2: ON by default every page load → auto-start when Drivers header visible → wait 5s → extract up to 7 drivers → store to localStorage → real-click Vehicles. STOP only stops this session; reload always re-arms.
// @match        https://policycenter.farmersinsurance.com/pc/PolicyCenter.do*
// @match        https://policycenter-2.farmersinsurance.com/pc/PolicyCenter.do*
// @match        https://policycenter-3.farmersinsurance.com/pc/PolicyCenter.do*
// @run-at       document-idle
// @all-frames   true
// @grant        none
// @updateURL    https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/PolicyCenter-Data-Extractors/Auto/policycenter-auto-step-2-drivers.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/PolicyCenter-Data-Extractors/Auto/policycenter-auto-step-2-drivers.user.js
// ==/UserScript==

(() => {
  'use strict';

  const UI_RIGHT_PX = 346;
  const UI_BOTTOM_PX = 14;

  const LS = {
    enabled: 'tm_pc_step2_enabled_v1',
    lock: 'tm_pc_step2_lock_v1',
    payload: 'tm_pc_drivers_v1',
    ready: 'tm_pc_drivers_ready_v1',
    stage: 'tm_pc_stage_v1',
    collapsed: 'tm_pc_step2_collapsed_v1',
  };

  const RUN = {
    headerText: 'Drivers',
    headerSel: 'div.gw-TitleBar--title[role="heading"][aria-level="1"]',
    waitAfterHeaderMs: 5000,
    maxRows: 7,
    lockTtlMs: 30000,
    headerTimeoutMs: 240000,
    tableTimeoutMs: 60000,
    recentDoneSkipMs: 12000,
  };

  // 1-based columns (your confirmed mapping)
  // c2 Name
  // c3 License (masked) -> last4
  // c6 Non Driver Reason
  // c7 MVR Status
  // c9 DPS Score
  const COL_1 = { name: 2, dl: 3, non_driver_reason: 6, mvr: 7, dps: 9 };
  const COL = {
    name: COL_1.name - 1,
    dl: COL_1.dl - 1,
    non_driver_reason: COL_1.non_driver_reason - 1,
    mvr: COL_1.mvr - 1,
    dps: COL_1.dps - 1,
  };

  const SELF = {
    id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
    status: 'IDLE',
    running: false,
    stopped: false,
    mo: null,
    kickTimer: null,
    lastGateLog: { key: '', ts: 0 },
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const textNorm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const lc = (s) => String(s || '').toLowerCase();

  function nowHHMMSS() {
    const d = new Date();
    const p2 = (n) => String(n).padStart(2, '0');
    return `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
  }

  function safeJsonParse(s) { try { return JSON.parse(s); } catch { return null; } }
  function isTop() { try { return window.top === window; } catch { return false; } }

  function isVisible(el) {
    if (!el) return false;
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity || 1) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function waitFor(fn, { timeoutMs = 60000, initialDelayMs = 200, maxDelayMs = 1200 } = {}) {
    const started = Date.now();
    let delay = initialDelayMs;
    return new Promise((resolve) => {
      const tick = async () => {
        if (SELF.stopped) return resolve(null);
        let val = null;
        try { val = fn(); } catch { val = null; }
        if (val) return resolve(val);
        if (Date.now() - started >= timeoutMs) return resolve(null);
        await sleep(delay);
        delay = Math.min(maxDelayMs, Math.round(delay * 1.25));
        tick();
      };
      tick();
    });
  }

  function stageGateAllows(force) {
    if (force) return true;
    const stage = localStorage.getItem(LS.stage) || '';
    // Allowed: empty (manual), policyinfo_done (normal chain), drivers_done (skip logic handles)
    const allowed = new Set(['', 'policyinfo_done', 'drivers_done']);
    if (!stage) return true;
    return allowed.has(stage);
  }

  function isRecentlyDone() {
    const readyTs = Number(localStorage.getItem(LS.ready) || 0);
    const stage = localStorage.getItem(LS.stage) || '';
    return (stage === 'drivers_done' && readyTs && (Date.now() - readyTs) < RUN.recentDoneSkipMs);
  }

  function gateLogOnce(msg, key) {
    const now = Date.now();
    if (SELF.lastGateLog.key === key && (now - SELF.lastGateLog.ts) < 8000) return;
    SELF.lastGateLog = { key, ts: now };
    log(msg);
  }

  // ===== LOCK =====
  function lockAcquire() {
    const cur = safeJsonParse(localStorage.getItem(LS.lock) || '');
    const now = Date.now();
    if (cur && cur.ts && (now - cur.ts) < RUN.lockTtlMs && cur.id && cur.id !== SELF.id) return false;
    localStorage.setItem(LS.lock, JSON.stringify({ id: SELF.id, ts: now }));
    return true;
  }
  function lockRelease() {
    const cur = safeJsonParse(localStorage.getItem(LS.lock) || '');
    if (cur && cur.id === SELF.id) localStorage.removeItem(LS.lock);
  }

  // ===== UI (Step1 clone) =====
  const UI = { host:null,panel:null,status:null,btnStop:null,pre:null,logWrap:null,bubble:null };

  function uiEnsure() {
    if (!isTop()) return;
    if (UI.host && document.contains(UI.host)) return;

    const host = document.createElement('div');
    host.id = 'tm_pc_step2_host';
    host.style.cssText = `position:fixed;right:${UI_RIGHT_PX}px;bottom:${UI_BOTTOM_PX}px;z-index:2147483647;font:12px/1.2 system-ui, Segoe UI, Roboto, Arial;color:#111`;

    const panel = document.createElement('div');
    panel.id = 'tm_pc_step2_panel';
    panel.style.cssText = 'width:320px;border:1px solid rgba(0,0,0,.15);border-radius:12px;background:#fff;box-shadow:0 10px 30px rgba(0,0,0,.15);overflow:hidden';

    const top = document.createElement('div');
    top.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:10px 10px;border-bottom:1px solid rgba(0,0,0,.10);user-select:none;cursor:default';

    const title = document.createElement('div');
    title.id = 'tm_pc_step2_title';
    title.textContent = 'PC Step2 — Drivers';
    title.style.fontWeight = '800';

    const status = document.createElement('div');
    status.id = 'tm_pc_step2_status';
    status.textContent = 'IDLE';
    status.style.fontWeight = '800';
    status.style.opacity = '0.8';

    top.appendChild(title);
    top.appendChild(status);

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:8px;padding:10px 10px;border-bottom:1px solid rgba(0,0,0,.08)';

    function mkBtn(txt) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = txt;
      b.style.cssText = 'border-radius:10px;border:1px solid rgba(0,0,0,.18);background:#f7f7f7;font-weight:700;cursor:pointer;padding:8px 10px;flex:1';
      return b;
    }

    const btnStart = mkBtn('START');
    const btnStop  = mkBtn('STOP');
    const btnForce = mkBtn('FORCE RUN');
    btnRow.appendChild(btnStart);
    btnRow.appendChild(btnStop);
    btnRow.appendChild(btnForce);

    const logWrap = document.createElement('div');
    logWrap.style.cssText = 'max-height:260px;overflow:auto';

    const pre = document.createElement('pre');
    pre.id = 'tm_pc_step2_log';
    pre.style.cssText = 'margin:0;padding:10px;font:11px/1.25 ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;white-space:pre-wrap';
    logWrap.appendChild(pre);

    panel.appendChild(top);
    panel.appendChild(btnRow);
    panel.appendChild(logWrap);

    const bubble = document.createElement('button');
    bubble.type = 'button';
    bubble.id = 'tm_pc_step2_bubble';
    bubble.textContent = 'PC2';
    bubble.style.cssText = `position:fixed;right:${UI_RIGHT_PX}px;bottom:${UI_BOTTOM_PX}px;width:44px;height:44px;border-radius:999px;border:0;background:#111;color:#fff;box-shadow:0 10px 30px rgba(0,0,0,.25);font:12px/1.2 system-ui, Segoe UI, Roboto, Arial;font-weight:800;cursor:pointer;display:none`;

    function uiCollapse(collapsed) {
      if (collapsed) {
        panel.style.display = 'none';
        bubble.style.display = 'block';
        localStorage.setItem(LS.collapsed, '1');
      } else {
        panel.style.display = 'block';
        bubble.style.display = 'none';
        localStorage.setItem(LS.collapsed, '0');
      }
    }

    top.addEventListener('dblclick', () => uiCollapse(true));
    bubble.addEventListener('click', () => uiCollapse(false));

    btnStart.addEventListener('click', () => {
      localStorage.setItem(LS.enabled, '1');
      SELF.stopped = false;
      setStatus('ARMED');
      log('START pressed → ARMED');
      watchersStart();
      kick();
    });

    btnStop.addEventListener('click', () => {
      localStorage.setItem(LS.enabled, '0');
      SELF.stopped = true;
      setStatus('IDLE');
      log('STOP pressed → IDLE (will re-enable on next page load).');
      watchersStop();
      paintButtons();
    });

    btnForce.addEventListener('click', () => {
      localStorage.setItem(LS.enabled, '1');
      SELF.stopped = false;
      log('FORCE RUN pressed → attempting now');
      watchersStart();
      runOnce({ force: true });
    });

    host.appendChild(panel);
    document.documentElement.appendChild(host);
    document.documentElement.appendChild(bubble);

    UI.host = host; UI.panel = panel; UI.status = status; UI.btnStop = btnStop; UI.pre = pre; UI.logWrap = logWrap; UI.bubble = bubble;

    uiCollapse(localStorage.getItem(LS.collapsed) === '1');
    paintButtons();
  }

  function log(msg) {
    const line = `[${nowHHMMSS()}] ${msg}`;
    console.log(`[TM-PC-Step2] ${line}`);
    if (!isTop() || !UI.pre) return;
    UI.pre.textContent += (UI.pre.textContent ? '\n' : '') + line;
    if (UI.logWrap) UI.logWrap.scrollTop = UI.logWrap.scrollHeight;
  }

  function setStatus(s) {
    SELF.status = s;
    if (isTop() && UI.status) UI.status.textContent = s;
    paintButtons();
  }

  function paintButtons() {
    if (!isTop() || !UI.btnStop) return;
    const armedOrMore = (SELF.status === 'ARMED' || SELF.status === 'RUNNING' || SELF.status === 'DONE');
    UI.btnStop.disabled = !armedOrMore;
    UI.btnStop.style.opacity = armedOrMore ? '1' : '0.55';
  }

  // ===== REAL CLICK =====
  function dispatch(el, evt) { try { el.dispatchEvent(evt); return true; } catch { return false; } }
  function realClick(el) {
    if (!el) return false;
    try { el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }); } catch {}
    const r = el.getBoundingClientRect();
    const x = Math.round(r.left + r.width / 2);
    const y = Math.round(r.top + r.height / 2);
    const common = { bubbles:true,cancelable:true,composed:true,clientX:x,clientY:y,screenX:x,screenY:y,button:0,buttons:1,pointerId:1,pointerType:'mouse',isPrimary:true };
    dispatch(el, new PointerEvent('pointerdown', common));
    dispatch(el, new MouseEvent('mousedown', common));
    dispatch(el, new PointerEvent('pointerup', { ...common, buttons: 0 }));
    dispatch(el, new MouseEvent('mouseup', { ...common, buttons: 0 }));
    dispatch(el, new MouseEvent('click', { ...common, buttons: 0 }));
    return true;
  }

  // ===== START CONDITION =====
  function findDriversHeader() {
    const nodes = Array.from(document.querySelectorAll(RUN.headerSel));
    for (const n of nodes) {
      if (!isVisible(n)) continue;
      if (textNorm(n.textContent) === RUN.headerText) return n;
    }
    return null;
  }

  // ===== TABLE =====
  function findDriversTbody() {
    const selectors = [
      '#PolicyFile_Drivers-DriversScreen-DriversDV-DriversLV table tbody',
      '#PolicyFile_Drivers-DriversScreen-DriversDV-DriversLV .gw-ListViewWidget--table tbody',
      '#PolicyFile_Drivers-DriversScreen-DriversDV-DriversLV .gw-ListViewWidget table tbody',
      'table[id*="DriversLV"] tbody',
      'div[id*="DriversLV"] table tbody',
    ];
    for (const sel of selectors) {
      const tb = document.querySelector(sel);
      if (tb) return tb;
    }
    return null;
  }

  function cellText(td) { return textNorm(td ? (td.innerText || td.textContent || '') : ''); }

  function last4Masked(s) {
    const cleaned = String(s || '').replace(/[^a-z0-9]/gi, '');
    if (cleaned.length < 4) return '';
    return cleaned.slice(-4).toUpperCase();
  }

  function isHeaderRowByCells(tds) {
    const name = lc(cellText(tds[COL.name]));
    const dl   = lc(cellText(tds[COL.dl]));
    const mvr  = lc(cellText(tds[COL.mvr]));
    const dps  = lc(cellText(tds[COL.dps]));
    if (name === 'name') return true;
    if (dl.includes('license')) return true;
    if (mvr.includes('mvr')) return true;
    if (dps.includes('dps')) return true;
    return false;
  }

  function extractDriversRows(tbody) {
    const trs = Array.from(tbody.querySelectorAll('tr'));
    const out = [];

    log(`Cols (1-based) → name:c${COL_1.name} dl:c${COL_1.dl} nonDriver:c${COL_1.non_driver_reason} mvr:c${COL_1.mvr} dps:c${COL_1.dps}`);

    for (const tr of trs) {
      const tds = Array.from(tr.querySelectorAll('td'));
      if (!tds.length) continue;

      const need = Math.max(COL.name, COL.dl, COL.non_driver_reason, COL.mvr, COL.dps);
      if (tds.length <= need) continue;

      if (isHeaderRowByCells(tds)) continue;

      const name = cellText(tds[COL.name]);
      const licCell = cellText(tds[COL.dl]);
      const dl4 = last4Masked(licCell);
      const nonDriverReason = cellText(tds[COL.non_driver_reason]) || '';
      const mvr = cellText(tds[COL.mvr]);
      const dps = cellText(tds[COL.dps]);

      if (!name && !licCell && !nonDriverReason && !mvr && !dps) continue;

      out.push({
        driver_name: name,
        dl_last4: dl4,
        non_driver_reason: nonDriverReason,
        mvr_status: mvr,
        dps_score: dps,
      });

      if (out.length >= RUN.maxRows) break;
    }

    return out;
  }

  function lsSet(key, value) {
    localStorage.setItem(key, value);
    log(`Copied → ${key} = ${value}`);
  }

  // ===== VEHICLES TAB =====
  function bestClickable(el) {
    if (!el) return null;
    return el.closest('[role="tab"], .gw-TabBarWidget--tab, .gw-TabBar--tab, button, a') || el;
  }

  function listTabs() {
    const tabs = Array.from(document.querySelectorAll('[role="tab"], .gw-TabBarWidget--label, .gw-TabBar--label'));
    const names = [];
    for (const el of tabs) {
      const t = textNorm(el.textContent || '');
      if (t && isVisible(el)) names.push(t);
    }
    return Array.from(new Set(names)).slice(0, 40);
  }

  function findVehiclesTab() {
    const wanted = 'vehicles';
    for (const el of Array.from(document.querySelectorAll('[role="tab"]'))) {
      const t = lc(textNorm(el.textContent || ''));
      if (t.includes(wanted) && isVisible(el)) return bestClickable(el);
    }
    for (const el of Array.from(document.querySelectorAll('.gw-TabBarWidget--label, .gw-TabBar--label'))) {
      const t = lc(textNorm(el.textContent || ''));
      if (t.includes(wanted) && isVisible(el)) return bestClickable(el);
    }
    for (const el of Array.from(document.querySelectorAll('button,a,div,span'))) {
      const t = lc(textNorm(el.textContent || ''));
      if (t === 'vehicles' && isVisible(el)) return bestClickable(el);
    }
    return null;
  }

  // ===== WATCHERS =====
  function watchersStart() {
    if (SELF.mo) return;
    try {
      SELF.mo = new MutationObserver(() => {
        if (SELF.running || SELF.stopped) return;
        if (localStorage.getItem(LS.enabled) === '0') return;

        // If we already just finished, don't spam kicks
        if (isRecentlyDone()) return;

        const hdr = findDriversHeader();
        if (hdr && SELF.status !== 'RUNNING') {
          if (SELF.status !== 'ARMED') setStatus('ARMED');
          kick();
        }
      });
      SELF.mo.observe(document.documentElement, { subtree: true, childList: true });
    } catch {}
  }

  function watchersStop() {
    try { if (SELF.mo) SELF.mo.disconnect(); } catch {}
    SELF.mo = null;
  }

  function kick() {
    if (SELF.kickTimer) return;
    SELF.kickTimer = setTimeout(() => {
      SELF.kickTimer = null;
      runOnce({ force: false });
    }, 220);
  }

  async function runOnce({ force }) {
    if (SELF.running || SELF.stopped) return;

    if (localStorage.getItem(LS.enabled) === '0') {
      if (SELF.status !== 'IDLE') setStatus('IDLE');
      return;
    }

    if (!stageGateAllows(force)) {
      const st = localStorage.getItem(LS.stage) || '';
      gateLogOnce(`Stage gate: stage="${st}" → skipping Step2 on purpose.`, `stage:${st}`);
      setStatus('IDLE');
      return;
    }

    if (!force && isRecentlyDone()) {
      setStatus('DONE');
      return;
    }

    SELF.running = true;
    setStatus('RUNNING');

    try {
      if (!lockAcquire()) {
        log('Another frame is running Step2 → ARMED.');
        setStatus('ARMED');
        return;
      }

      if (!force) {
        log('Waiting for Drivers header…');
        const header = await waitFor(findDriversHeader, { timeoutMs: RUN.headerTimeoutMs });
        if (!header) {
          log('Drivers header not found (timeout) → IDLE.');
          setStatus('IDLE');
          return;
        }
      } else {
        log('FORCE: skipping header gate (still requires table).');
      }

      log('Drivers header visible/forced → wait 5s…');
      await sleep(RUN.waitAfterHeaderMs);
      if (SELF.stopped) return;

      log('Finding Drivers table…');
      const tbody = await waitFor(() => findDriversTbody(), { timeoutMs: RUN.tableTimeoutMs });

      let rows = [];
      let meta = { ok: true, note: '' };

      if (!tbody) {
        meta = { ok: false, note: 'Drivers table tbody not found' };
        log('WARNING: table not found → saving empty payload.');
      } else {
        rows = extractDriversRows(tbody);
        log(`Extracted rows = ${rows.length}`);
        if (rows[0]) {
          log(`Row1 sample → name="${rows[0].driver_name}" dl4="${rows[0].dl_last4}" nonDriver="${rows[0].non_driver_reason}" mvr="${rows[0].mvr_status}" dps="${rows[0].dps_score}"`);
        }
      }

      const payloadObj = {
        step: 'drivers',
        extracted_at: new Date().toISOString(),
        count: rows.length,
        rows,
        meta,
        col_1_based: COL_1,
      };

      lsSet(LS.payload, JSON.stringify(payloadObj));
      lsSet(LS.ready, String(Date.now()));
      lsSet(LS.stage, 'drivers_done');

      log('Clicking Vehicles tab…');
      const vehiclesTab = findVehiclesTab();
      if (!vehiclesTab) {
        log(`ERROR: Vehicles tab not found. Visible tabs: ${listTabs().join(' | ')}`);
        setStatus('DONE');
        return;
      }

      realClick(vehiclesTab);
      log('Vehicles clicked → staying ARMED (STOP button is the only manual stop).');
      setStatus('DONE');

      // Stay always-running: re-arm after a short beat (so UI shows DONE briefly)
      setTimeout(() => {
        if (SELF.stopped) return;
        if (localStorage.getItem(LS.enabled) === '0') return;
        setStatus('ARMED');
      }, 900);

    } finally {
      lockRelease();
      SELF.running = false;
    }
  }

  // ===== BOOT =====
  uiEnsure();

  // ✅ ON BY DEFAULT EACH PAGE LOAD (overrides any previous STOP)
  localStorage.setItem(LS.enabled, '1');
  SELF.stopped = false;

  setStatus('ARMED');
  log('Loaded → AUTO-ARMED (Step2 ON by default each page load).');
  watchersStart();
  kick();

  window.tmPcStep2 = { runOnce };
})();
